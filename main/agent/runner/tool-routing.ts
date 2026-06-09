import type { GraphStateType } from './state';

type PendingToolCall = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
};

const WEB_OR_BOOKING_TASK_PATTERN =
  /\b(book(?:ing)?|reserve|reservation|flight|hotel|ticket|train|bus|cab|taxi|trip|itinerary|airline|airport|one[-\s]?way|round[-\s]?trip|checkout|purchase|buy|order|cart|price|prices|pricing|live\s+prices?|booking\s+platform|google\s+flights|kayak|skyscanner|expedia|airbnb|booking\.com|website|web\s*site|browser|web\s+app|gmail|webmail|google\s+(docs|drive|sheets)|url|https?:\/\/|www\.|form|forms|listing|listings|dashboard|login|sign\s*in|open\s+.*platform)\b/i;

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

  const context = [
    params.currentIntent || '',
    params.userText || '',
    params.planText || '',
    stringifyForRouting(params.args || {}),
  ].join('\n');

  if (params.currentIntent === 'research') return true;
  if (params.currentIntent === 'automate' && !WEB_OR_BOOKING_TASK_PATTERN.test(context)) return false;
  return WEB_OR_BOOKING_TASK_PATTERN.test(context);
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
