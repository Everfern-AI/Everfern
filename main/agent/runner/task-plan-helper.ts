import * as fs from 'fs';
import * as path from 'path';

/**
 * Clean up alphanumeric characters and convert to lowercase for comparison.
 */
function cleanString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Update a checkbox line matching a step description.
 */
function updateTaskPlanCheckbox(content: string, stepDesc: string, checkbox: string): string {
  const lines = content.split('\n');
  const cleanDesc = cleanString(stepDesc);
  if (!cleanDesc) return content;

  let bestMatchIdx = -1;
  let maxSimilarity = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('- [')) {
      const itemText = line.replace(/^-\s*\[[ xX/]*\]\s*/, '').trim();
      const cleanItemText = cleanString(itemText);

      // 1. Exact match
      if (cleanDesc === cleanItemText) {
        bestMatchIdx = i;
        break;
      }

      // 2. Substring match
      if (cleanDesc.includes(cleanItemText) || cleanItemText.includes(cleanDesc)) {
        bestMatchIdx = i;
        maxSimilarity = 1.0;
        continue;
      }

      // 3. Prefix/Fuzzy match (minimum prefix length of 8)
      if (cleanDesc.length >= 8 && cleanItemText.length >= 8) {
        if (cleanDesc.startsWith(cleanItemText.substring(0, 8)) || cleanItemText.startsWith(cleanDesc.substring(0, 8))) {
          const similarity = 0.8;
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            bestMatchIdx = i;
          }
        }
      }
    }
  }

  if (bestMatchIdx !== -1) {
    const line = lines[bestMatchIdx];
    lines[bestMatchIdx] = line.replace(/^(-\s*\[)[ xX/]*(\])/, `$1${checkbox.substring(1, 2)}$2`);
  }

  return lines.join('\n');
}

/**
 * Dynamically initialize task_plan.md in .everfern/ directory.
 */
export async function initializeTaskPlan(
  runner: any,
  decomposed: any,
  userRequest: string
): Promise<void> {
  try {
    const workspaceDir = runner?.workspaceDir;
    if (!workspaceDir) {
      console.log('[TaskPlan] Skipped initialization: no workspace directory defined');
      return;
    }

    const everfernDir = path.join(workspaceDir, '.everfern');
    if (!fs.existsSync(everfernDir)) {
      fs.mkdirSync(everfernDir, { recursive: true });
    }

    const taskPlanPath = path.join(everfernDir, 'task_plan.md');

    // Simple template mapping decomposed steps to markdown list items
    const stepsDesc = decomposed.steps
      .map((s: any) => `- [ ] ${s.title || s.description}`)
      .join('\n');

    const prompt = `You are a professional software architect. Create a structured 'task_plan.md' in the exact style of:

# Task Plan: [Title of task]

## 🎯 High-Level Objective
[High-level objective description based on user request]

---

## 🏗️ Project Architecture & Status
- **Current Phase:** Phase 1: Setup and Initialization
- **Next Milestone:** Setup completed successfully.
- **Blockers:** None.

---

## 📋 Phase Breakdown

### Phase 1: Setup and Initialization
- [ ] Create project directory and virtual environment.
- [ ] Initialize Manus tracking files (task_plan.md, findings.md, progress.md).
- [ ] Any other setup steps...

### Phase 2: [Phase 2 Title]
- [ ] [Step 1]
- [ ] [Step 2]

...Other phases and steps mapping to the decomposed tasks...

---

## 🔄 Active Session Focus
- **Current Task:** [First task]
- **Immediate Next Step:** [First step action]

Decomposed steps:
${JSON.stringify(decomposed.steps, null, 2)}

User request:
"${userRequest}"

Provide ONLY the raw markdown content for the task plan. Do not include markdown code block backticks (\`\`\`).`;

    const client = runner.client;
    if (!client) {
      console.warn('[TaskPlan] AIClient not found on runner, skipping LLM task plan generation');
      // Simple fallback generation
      const fallbackContent = `# Task Plan: ${decomposed.title || 'Coding Task'}\n\n## 🎯 High-Level Objective\n${userRequest}\n\n---\n\n## 📋 Phase Breakdown\n\n### Phase 1: Tasks\n${stepsDesc}\n`;
      fs.writeFileSync(taskPlanPath, fallbackContent, 'utf-8');
      return;
    }

    const response = await client.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 2000,
    }) as any;

    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '');
    content = content.replace(/^```markdown\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

    fs.writeFileSync(taskPlanPath, content, 'utf-8');
    console.log(`[TaskPlan] Created task_plan.md successfully at ${taskPlanPath}`);
  } catch (err) {
    console.warn('[TaskPlan] Failed to initialize task_plan.md:', err);
  }
}

/**
 * Dynamically sync task_plan.md checkboxes and session status.
 */
export async function syncTaskPlan(runner: any, missionTracker: any): Promise<void> {
  try {
    const workspaceDir = runner?.workspaceDir;
    if (!workspaceDir) return;

    const taskPlanPath = path.join(workspaceDir, '.everfern', 'task_plan.md');
    if (!fs.existsSync(taskPlanPath)) return;

    if (!missionTracker) return;

    let content = fs.readFileSync(taskPlanPath, 'utf-8');
    const steps = missionTracker.getSteps() || [];
    if (steps.length === 0) return;

    let activeStepDesc = '';
    let nextStepDesc = '';

    // 1. Process step statuses and update checkboxes
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.status === 'completed') {
        content = updateTaskPlanCheckbox(content, step.description, '[x]');
      } else if (step.status === 'in-progress') {
        activeStepDesc = step.description;
        content = updateTaskPlanCheckbox(content, step.description, '[/]');

        // Find the next pending step
        const nextPending = steps.slice(i + 1).find((s: any) => s.status === 'pending');
        if (nextPending) {
          nextStepDesc = nextPending.description;
        }
      } else if (step.status === 'pending') {
        content = updateTaskPlanCheckbox(content, step.description, '[ ]');
      }
    }

    // 2. Update Active Session Focus
    if (activeStepDesc) {
      content = content.replace(
        /-\s*\*\*Current Task:\*\*\s*[^\n]*/gi,
        `- **Current Task:** ${activeStepDesc}`
      );
    }
    if (nextStepDesc) {
      content = content.replace(
        /-\s*\*\*Immediate Next Step:\*\*\s*[^\n]*/gi,
        `- **Immediate Next Step:** ${nextStepDesc}`
      );
    }

    // 3. Update Current Phase in Project Architecture & Status
    if (activeStepDesc) {
      const lines = content.split('\n');
      let currentPhaseText = '';
      let currentPhaseIdx = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('### ') && line.toLowerCase().includes('phase')) {
          currentPhaseText = line.replace('###', '').trim();
        }
        if (currentPhaseText && line.trim().startsWith('- [')) {
          const itemText = line.replace(/^-\s*\[[ xX/]*\]\s*/, '').trim();
          const cleanItemText = cleanString(itemText);
          const cleanActiveDesc = cleanString(activeStepDesc);

          if (cleanActiveDesc.includes(cleanItemText) || cleanItemText.includes(cleanActiveDesc)) {
            // Find active phase header index
            for (let j = i; j >= 0; j--) {
              if (lines[j].trim().startsWith('### ') && lines[j].toLowerCase().includes('phase')) {
                currentPhaseIdx = j;
                break;
              }
            }
            break;
          }
        }
      }

      // Update Phase breakdown headers
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('### ') && lines[i].toLowerCase().includes('phase')) {
          const baseHeader = lines[i].replace(/🚧.*/gi, '').trim();
          if (i === currentPhaseIdx) {
            lines[i] = `${baseHeader} 🚧 (IN PROGRESS)`;
            const cleanPhaseName = baseHeader.replace(/^###\s*/i, '').trim();
            content = content.replace(
              /-\s*\*\*Current Phase:\*\*\s*[^\n]*/gi,
              `- **Current Phase:** ${cleanPhaseName} 🚧 (IN PROGRESS)`
            );
          } else {
            lines[i] = baseHeader;
          }
        }
      }
      content = lines.join('\n');
    }

    fs.writeFileSync(taskPlanPath, content, 'utf-8');
    console.log('[TaskPlan] Synced task_plan.md successfully');
  } catch (err) {
    console.warn('[TaskPlan] Failed to sync task_plan.md:', err);
  }
}
