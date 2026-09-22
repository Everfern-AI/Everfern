import type { GraphStateType } from './state';

type PendingToolCall = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
};

function stringifyForRouting(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getLatestUserTextFromState(state: Pick<GraphStateType, 'messages'>): string {
  const messages = state.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    const role = msg.role || msg.type || msg._getType?.();
    if (role === 'user' || role === 'human') {
      return stringifyForRouting(msg.content);
    }
  }
  return '';
}

export function shouldRouteComputerUseToNavis(params: {
  toolName: string;
  args?: Record<string, unknown>;
  currentIntent?: string;
  userText?: string;
  planText?: string;
}): boolean {
  if (params.toolName !== 'computer_use') return false;
  return params.currentIntent === 'research';
}

export function buildNavisTaskFromState(state: GraphStateType, originalArgs?: Record<string, unknown>): string {
  const userText = getLatestUserTextFromState(state);
  const planSteps = state.decomposedTask?.steps
    ?.map((step: any) => `- ${step.title || step.id}: ${step.description}`)
    .join('\n');

  return [
    'Use Navis for this browser/web workflow. Do not use OS-level computer_use.',
    userText ? `Original user request:\n${userText}` : '',
    planSteps ? `Relevant execution plan:\n${planSteps}` : '',
    originalArgs ? `Misrouted computer_use arguments for context:\n${stringifyForRouting(originalArgs)}` : '',
    'Open the relevant websites or booking platforms, interact with page forms through DOM-first browser automation, and extract live structured results. For booking or purchasing flows, stop before payment or irreversible confirmation unless the user explicitly approves.',
  ].filter(Boolean).join('\n\n');
}

/**
 * Sanitizes and optimizes a computer_use task prompt so the vision model receives
 * either the user's original prompt (for direct desktop automation) or a concise one-liner goal.
 *
 * Prevents over-prescribed step-by-step navigation recipes (e.g. "navigate to Apps > Default apps...")
 * that confuse the vision model when UI layout, OS version, or locale differs.
 */
export function sanitizeComputerUseTask(params: {
  currentTask: string;
  userText: string;
  currentIntent?: string;
  isDirectComputerUse?: boolean;
}): string {
  const { currentTask, userText, currentIntent, isDirectComputerUse } = params;
  const cleanUserText = (userText || '').trim();
  const cleanCurrentTask = (currentTask || '').trim();

  // 1. Direct computer use / automation intent:
  // If the intent is automate, or the user's prompt is a direct desktop command,
  // pass the user's original request directly to the computer use agent!
  const isDirect = isDirectComputerUse ?? (
    currentIntent === 'automate' ||
    (cleanUserText.length > 0 && !['coding', 'build', 'fix'].includes(currentIntent || ''))
  );

  if (isDirect && cleanUserText.length > 0) {
    return cleanUserText;
  }

  // 2. Checking / coding / verification tasks:
  // Ensure the prompt is a concise one-liner telling the AI what to accomplish
  if (!cleanCurrentTask) {
    return cleanUserText || 'Accomplish the requested desktop action.';
  }

  // If the AI generated a convoluted multi-sentence recipe (> 100 chars with multiple sentences/periods):
  if (cleanCurrentTask.length > 100 || cleanCurrentTask.includes('\n') || (cleanCurrentTask.match(/[.?!]\s+[A-Z]/g) || []).length >= 1) {
    // Extract the first concise sentence (up to 120 chars)
    const sentences = cleanCurrentTask.split(/(?<=[.?!])\s+/);
    if (sentences.length > 0 && sentences[0].length >= 10 && sentences[0].length <= 120) {
      return sentences[0].trim();
    }
    // If the original user text was short and clear, fall back to it
    if (cleanUserText.length > 0 && cleanUserText.length <= 120) {
      return cleanUserText;
    }
  }

  return cleanCurrentTask;
}

export function redirectComputerUseCallsToNavis(
  calls: PendingToolCall[],
  state: GraphStateType
): { calls: PendingToolCall[]; redirected: number } {
  let redirected = 0;
  const userText = getLatestUserTextFromState(state);
  const planText = state.decomposedTask?.steps?.map((step: any) => `${step.description} ${step.tool}`).join('\n') || '';

  const routed = calls.map((call) => {
    const args = (call.arguments || call.args || {}) as Record<string, unknown>;
    if (!shouldRouteComputerUseToNavis({
      toolName: call.name,
      args,
      currentIntent: state.currentIntent,
      userText,
      planText,
    })) {
      // Optimize computer_use task prompt
      if (call.name === 'computer_use') {
        // If it's a specific atomic action like left_click, type, etc., don't inject task
        if (args.action && args.action !== 'execute_actions' && args.action !== 'task') {
          return call;
        }
        const rawTask = String(args.task || args.goal || args.text || '');
        if (rawTask || userText) {
          const optimizedTask = sanitizeComputerUseTask({
            currentTask: rawTask,
            userText,
            currentIntent: state.currentIntent,
          });
          return {
            ...call,
            arguments: {
              ...args,
              task: optimizedTask,
            },
            args: {
              ...args,
              task: optimizedTask,
            },
          };
        }
      }
      return call;
    }

    redirected += 1;
    return {
      ...call,
      name: 'navis',
      arguments: {
        task: buildNavisTaskFromState(state, args),
      },
    };
  });

  return { calls: routed, redirected };
}
