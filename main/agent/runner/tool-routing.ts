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
