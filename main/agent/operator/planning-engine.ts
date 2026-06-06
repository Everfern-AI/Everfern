import { AIClient } from '../../lib/ai-client';
import { ExecutionPlan, GoalDefinition, OperatorTask, OperatorSession } from './types';

function stripLLMWrappers(raw: string): string {
    let text = raw.trim();
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    const jsonFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonFenceMatch) return jsonFenceMatch[1].trim();
    return text;
}

function extractJSONObject(text: string): string | null {
    const cleaned = stripLLMWrappers(text);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1);
    }
    return null;
}

const PLANNING_PROMPT = `You are the Operator Planning Engine. Your job is to decompose a high-level business objective into a structured execution plan.

An execution plan consists of a goal and a list of specific, measurable tasks.
The tasks will be executed by specialized agents:
- 'web_explorer': for researching, reading web pages, looking for opportunities.
- 'coding_specialist': for writing code, scripts, or building software.
- 'data_analyst': for processing data or reading analytics.
- 'desktop': for any desktop native UI interaction.

Respond with ONLY valid JSON in this exact format:
{
  "goal": {
    "description": "The exact objective",
    "successCriteria": ["measurable outcome 1", "measurable outcome 2"]
  },
  "tasks": [
    {
      "taskId": "task_1",
      "description": "Specific action to take",
      "successCriteria": ["how to know if this task succeeded"],
      "executorType": "web_explorer|coding_specialist|data_analyst|desktop"
    }
  ]
}

Objective to decompose:
"{OBJECTIVE}"

Respond with ONLY the JSON object.`;

export async function planOperatorObjective(objective: string, client: AIClient): Promise<ExecutionPlan> {
    const prompt = PLANNING_PROMPT.replace('{OBJECTIVE}', objective);

    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            maxTokens: 2500,
        }) as any;

        const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
        const jsonStr = extractJSONObject(rawContent);
        
        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            
            const tasks: OperatorTask[] = (parsed.tasks || []).map((t: any, i: number) => ({
                taskId: t.taskId || `task_${i + 1}`,
                description: t.description,
                successCriteria: t.successCriteria || [],
                status: 'pending',
                executorType: t.executorType || 'web_explorer',
            }));

            const plan: ExecutionPlan = {
                planId: `plan_${Date.now()}`,
                planningTimestamp: Date.now(),
                goal: {
                    description: parsed.goal?.description || objective,
                    successCriteria: parsed.goal?.successCriteria || [],
                },
                tasks
            };
            
            return plan;
        }
        throw new Error('No JSON object found in response');
    } catch (err) {
        console.warn(`[Operator Planning] Failed to decompose: ${err instanceof Error ? err.message : String(err)}`);
        // Fallback simple plan
        return {
            planId: `plan_${Date.now()}`,
            planningTimestamp: Date.now(),
            goal: {
                description: objective,
                successCriteria: []
            },
            tasks: [{
                taskId: 'task_1',
                description: objective,
                successCriteria: [],
                status: 'pending',
                executorType: 'web_explorer'
            }]
        };
    }
}

export async function replanObjective(session: OperatorSession, failedTask: OperatorTask, client: AIClient): Promise<ExecutionPlan> {
    const prompt = `You are the Operator Replanning Engine.
The goal is: "${session.goal.description}"

The current plan failed or stalled at task:
"${failedTask.description}"

We need a NEW plan from this point forward.

Respond with ONLY valid JSON in this exact format:
{
  "tasks": [
    {
      "taskId": "task_X",
      "description": "Specific action to take",
      "successCriteria": ["how to know if this task succeeded"],
      "executorType": "web_explorer|coding_specialist|data_analyst|desktop"
    }
  ]
}

Respond with ONLY the JSON object.`;

    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            maxTokens: 2500,
        }) as any;

        const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
        const jsonStr = extractJSONObject(rawContent);
        
        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            const newTasks: OperatorTask[] = (parsed.tasks || []).map((t: any, i: number) => ({
                taskId: t.taskId || `task_replan_${Date.now()}_${i}`,
                description: t.description,
                successCriteria: t.successCriteria || [],
                status: 'pending',
                executorType: t.executorType || 'web_explorer',
            }));

            const plan: ExecutionPlan = {
                planId: `plan_${Date.now()}`,
                planningTimestamp: Date.now(),
                goal: session.goal,
                tasks: newTasks
            };
            return plan;
        }
        throw new Error('No JSON object found in response');
    } catch (err) {
        console.warn(`[Operator Replanning] Failed to replan: ${err instanceof Error ? err.message : String(err)}`);
        return session.currentPlan!;
    }
}
