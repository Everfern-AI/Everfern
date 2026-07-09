export type WorkflowPhase =
  | 'exploration'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'testing'
  | 'complete';

export interface WorkflowGate {
  description: string;
  validate: (context: WorkflowContext) => boolean | Promise<boolean>;
  failMessage?: string;
}

export interface WorkflowTransition {
  from: WorkflowPhase;
  to: WorkflowPhase;
  gates: WorkflowGate[];
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  phases: WorkflowPhase[];
  transitions: WorkflowTransition[];
  toolsPerPhase: Record<WorkflowPhase, string[]>;
  phasePrompts: Record<WorkflowPhase, string>;
}

export interface WorkflowContext {
  currentPhase: WorkflowPhase;
  completedPhases: WorkflowPhase[];
  phaseArtifacts: Record<string, any>;
  phaseAttempts: Record<string, number>;
  toolCallHistory: any[];
  metadata: Record<string, any>;
}

export const CODING_HARNESS: WorkflowDefinition = {
  name: 'coding_harness',
  description: 'Full coding workflow: explore → plan → implement → review → test',
  phases: ['exploration', 'planning', 'implementation', 'review', 'testing', 'complete'],
  transitions: [
    {
      from: 'exploration',
      to: 'planning',
      gates: [
        {
          description: 'Exploration phase complete — LLM-driven transition',
          validate: () => true,
          failMessage: undefined
        }
      ]
    },
    {
      from: 'planning',
      to: 'implementation',
      gates: [
        {
          description: 'Planning phase complete — LLM-driven transition',
          validate: () => true,
          failMessage: undefined
        }
      ]
    },
    {
      from: 'implementation',
      to: 'review',
      gates: [
        {
          description: 'Implementation phase complete — LLM-driven transition',
          validate: () => true,
          failMessage: undefined
        }
      ]
    },
    {
      from: 'review',
      to: 'testing',
      gates: [
        {
          description: 'Review phase complete — LLM-driven transition',
          validate: () => true,
          failMessage: undefined
        }
      ]
    },
    {
      from: 'testing',
      to: 'complete',
      gates: [
        {
          description: 'Testing phase complete — LLM-driven transition',
          validate: () => true,
          failMessage: undefined
        }
      ]
    }
  ],
  toolsPerPhase: {
    exploration: ['terminal_execute', 'terminal_status', 'read', 'grep', 'find', 'ls', 'glob', 'executePwsh', 'write'],
    planning: ['read', 'write', 'todo_write', 'memory_save', 'ls', 'terminal_execute'],
    implementation: ['read', 'write', 'edit', 'terminal_execute', 'terminal_status', 'grep', 'find', 'ls', 'executePwsh'],
    review: ['read', 'grep', 'diff', 'terminal_execute', 'terminal_status', 'ls', 'write', 'edit', 'executePwsh'],
    testing: ['terminal_execute', 'terminal_status', 'read', 'grep', 'ls', 'write', 'edit', 'executePwsh'],
    complete: []
  },
  phasePrompts: {
    exploration: `You are in the EXPLORATION phase. Your goal is to understand the codebase:
- Run discovery commands to learn structure, stack, entry points, tests, and conventions
- You must identify: directory structure, language/framework, test runner, coding style, lint config
- Do NOT start writing code yet — you are gathering information only
When ALL exploration goals are met, output exactly on its own line: [PHASE_COMPLETE: planning]`,
    planning: `You are in the PLANNING phase. Your goal is to design the implementation:
- Review the exploration findings to understand the codebase
- Create a step-by-step development plan with file paths, dependencies, and verification steps
- Write the plan to a file
- Get user approval if the task is complex or destructive
When the plan is ready and approved, output exactly on its own line: [PHASE_COMPLETE: implementation]`,
    implementation: `You are in the IMPLEMENTATION phase. Your goal is to write code:
- Follow the development plan from the planning phase
- Write complete, working code — no placeholders or TODOs
- Run builds and type checks after each logical change
- Do NOT move to the next file until the current one compiles
When all implementation is done and builds pass, output exactly on its own line: [PHASE_COMPLETE: review]`,
    review: `You are in the REVIEW phase. Your goal is to verify the implementation:
- Review all changed files for correctness, edge cases, and security issues
- Check for: type safety, error handling, naming conventions, missing imports
- Log any critical issues found that must be fixed
When review is complete, output exactly on its own line: [PHASE_COMPLETE: testing]`,
    testing: `You are in the TESTING phase. Your goal is to validate everything works:
- Run existing tests to check for regressions
- Run the build to confirm compilation
- Report pass/fail for each test suite
When testing is complete, output exactly on its own line: [PHASE_COMPLETE: complete]`,
    complete: `You are in the COMPLETION phase. Summarize what was done, what changed, and any follow-up items.
The task is wrapping up — no more code changes needed.`
  }
};

export class WorkflowEngine {
  private definitions: Map<string, WorkflowDefinition> = new Map();
  private contexts: Map<string, WorkflowContext> = new Map();

  constructor() {
    this.register(CODING_HARNESS);
  }

  register(def: WorkflowDefinition): void {
    this.definitions.set(def.name, def);
  }

  getDefinition(name: string): WorkflowDefinition | undefined {
    return this.definitions.get(name);
  }

  getContext(sessionId: string): WorkflowContext {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, {
        currentPhase: 'exploration',
        completedPhases: [],
        phaseArtifacts: {},
        phaseAttempts: {},
        toolCallHistory: [],
        metadata: {}
      });
    }
    return this.contexts.get(sessionId)!;
  }

  async canTransition(sessionId: string, defName: string, toPhase: WorkflowPhase): Promise<{ allowed: boolean; reason?: string }> {
    const def = this.definitions.get(defName);
    if (!def) return { allowed: false, reason: `Unknown workflow: ${defName}` };

    const ctx = this.getContext(sessionId);
    const currentIdx = def.phases.indexOf(ctx.currentPhase);
    const targetIdx = def.phases.indexOf(toPhase);

    if (targetIdx <= currentIdx) {
      return { allowed: false, reason: `Cannot transition backward from ${ctx.currentPhase} to ${toPhase}` };
    }

    const transition = def.transitions.find(t => t.from === ctx.currentPhase && t.to === toPhase);
    if (!transition) {
      return { allowed: false, reason: `No transition defined from ${ctx.currentPhase} to ${toPhase}` };
    }

    for (const gate of transition.gates) {
      const passed = await gate.validate(ctx);
      if (!passed) {
        return { allowed: false, reason: gate.failMessage || `Gate "${gate.description}" not passed` };
      }
    }

    return { allowed: true };
  }

  async transitionTo(sessionId: string, defName: string, toPhase: WorkflowPhase): Promise<{ success: boolean; reason?: string }> {
    const check = await this.canTransition(sessionId, defName, toPhase);
    if (!check.allowed) {
      return { success: false, reason: check.reason };
    }

    const ctx = this.getContext(sessionId);
    ctx.completedPhases.push(ctx.currentPhase);
    ctx.currentPhase = toPhase;
    return { success: true };
  }

  getPhasePrompt(sessionId: string, defName: string): string {
    const def = this.definitions.get(defName);
    if (!def) return '';

    const ctx = this.getContext(sessionId);
    return def.phasePrompts[ctx.currentPhase] || '';
  }

  getAllowedTools(sessionId: string, defName: string): string[] {
    const def = this.definitions.get(defName);
    if (!def) return [];

    const ctx = this.getContext(sessionId);
    return def.toolsPerPhase[ctx.currentPhase] || [];
  }

  recordArtifact(sessionId: string, phase: WorkflowPhase, key: string, value: any): void {
    const ctx = this.getContext(sessionId);
    if (!ctx.phaseArtifacts[phase]) {
      ctx.phaseArtifacts[phase] = {};
    }
    ctx.phaseArtifacts[phase][key] = value;
  }

  recordToolCall(sessionId: string, toolName: string, args: any, result: any): void {
    const ctx = this.getContext(sessionId);
    ctx.toolCallHistory.push({ toolName, args, result, phase: ctx.currentPhase, timestamp: Date.now() });

    if (ctx.currentPhase === 'exploration') {
      if (toolName === 'ls' || toolName === 'find' || toolName === 'read' || toolName === 'grep') {
        const existing = ctx.phaseArtifacts['exploration'] || {};
        existing.toolsUsed = (existing.toolsUsed || 0) + 1;
        ctx.phaseArtifacts['exploration'] = existing;
      }
    }

    if (ctx.currentPhase === 'implementation') {
      if (toolName === 'write' || toolName === 'edit') {
        const existing = ctx.phaseArtifacts['implementation'] || {};
        existing.filesChanged = (existing.filesChanged || 0) + 1;
        ctx.phaseArtifacts['implementation'] = existing;
      }
    }
  }

  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId);
  }
}

export const workflowEngine = new WorkflowEngine();
