import { toolApprovalStore } from '../../store/tool-approvals';
import { getLocalExecutionResolvers } from './pi-tools';

export type MachineTarget = 'host' | 'vm';

/** Tools that can run on this PC or inside EverFern's Alpine VM; the user picks per request. */
const MACHINE_CHOICE_TOOLS = new Set(['navis', 'computer_use']);

/** The machine picked with "Always allow", reused while the app runs. */
const rememberedTarget = new Map<string, MachineTarget>();

/** Where an always-allowed tool runs when no prompt is shown: the last choice, else this PC (the old behavior). */
function defaultTarget(toolName: string): MachineTarget | undefined {
  if (!MACHINE_CHOICE_TOOLS.has(toolName)) return undefined;
  return rememberedTarget.get(toolName) ?? 'host';
}

/**
 * A one-time approval handed from one tool to another for the same request, e.g. computer_use
 * approved for the VM hands the task to Navis in the VM without asking the user twice.
 */
const pendingHandoff = new Map<string, { target: MachineTarget; expires: number }>();

export function grantHandoff(toolName: string, target: MachineTarget): void {
  pendingHandoff.set(toolName, { target, expires: Date.now() + 3 * 60_000 });
}

export async function checkToolPermission(
  toolName: string,
  args: any,
  onUpdate?: (msg: string) => void,
  emitEvent?: (event: any) => void
): Promise<{ approved: boolean; error?: string; target?: MachineTarget }> {
  const handoff = pendingHandoff.get(toolName);
  if (handoff) {
    pendingHandoff.delete(toolName);
    if (handoff.expires > Date.now()) return { approved: true, target: handoff.target };
  }

  // Check if auto-approved in toolApprovalStore
  if (toolApprovalStore.isApproved(toolName, args)) {
    console.log(`[PermissionCheck] Tool ${toolName} auto-approved via toolApprovalStore`);
    return { approved: true, target: defaultTarget(toolName) };
  }

  if (!emitEvent) {
    console.warn(`[PermissionCheck] No emitEvent available for ${toolName}, proceeding with execution`);
    return { approved: true, target: defaultTarget(toolName) };
  }

  const requestId = `perm-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let actionDesc = '';
  let shellTypeLabel = '';
  let reasonText = '';

  const explicitNarrative = typeof args?._narrative === 'string' ? args._narrative.trim() :
                            typeof args?.thought === 'string' ? args.thought.trim() :
                            typeof args?.reason === 'string' ? args.reason.trim() : '';

  if (toolName === 'navis') {
    actionDesc = typeof args?.task === 'string' ? args.task : 'Browser Automation Task';
    shellTypeLabel = 'Navis Browser';
    reasonText = explicitNarrative || `Navis browser automation needs your permission to interact with the browser.`;
  } else if (toolName === 'computer_use') {
    actionDesc = typeof args?.task === 'string' ? args.task : (args?.action ? `Action: ${args.action}` : 'Desktop Automation Task');
    shellTypeLabel = 'Computer Use';
    reasonText = explicitNarrative || `Computer Use desktop automation needs your permission to control mouse/keyboard.`;
  } else if (toolName === 'synthesize_tool') {
    actionDesc = `Synthesize Tool: ${args?.name || 'unknown'}`;
    shellTypeLabel = 'Tool Creation';
    reasonText = explicitNarrative || `The agent wants to create a new dynamic tool to fulfill your request.`;
  } else if (toolName === 'synthesize_skill') {
    actionDesc = `Synthesize Skill: ${args?.name || 'unknown'}`;
    shellTypeLabel = 'Skill Creation';
    reasonText = explicitNarrative || `The agent wants to create a new reusable skill to remember instructions.`;
  } else {
    actionDesc = 'Unknown Action';
    shellTypeLabel = toolName;
    reasonText = explicitNarrative || `${toolName} needs your permission to execute.`;
  }

  console.log(`[PermissionCheck] 🔐 Requesting in-place permission for ${toolName} (requestId: ${requestId})`);

  emitEvent({
    type: 'local_execution_request',
    requestId,
    command: `${shellTypeLabel}: ${actionDesc}`,
    shellType: shellTypeLabel,
    reason: reasonText,
    conversationId: undefined,
    machineChoice: MACHINE_CHOICE_TOOLS.has(toolName),
    defaultTarget: defaultTarget(toolName),
  });

  onUpdate?.(`⏳ Requesting user permission for ${shellTypeLabel}...`);

  const approvalPromise = new Promise<{ approved: boolean; alwaysAllow: boolean; target?: MachineTarget }>((resolve) => {
    const resolvers = getLocalExecutionResolvers();
    resolvers.set(requestId, resolve);
  });

  const response = await approvalPromise;
  const resolvers = getLocalExecutionResolvers();
  resolvers.delete(requestId);

  const target: MachineTarget | undefined = MACHINE_CHOICE_TOOLS.has(toolName)
    ? (response.target === 'vm' ? 'vm' : 'host')
    : undefined;
  console.log(`[PermissionCheck] Permission response for ${toolName}: approved=${response.approved}, alwaysAllow=${response.alwaysAllow}, target=${target ?? '-'}`);

  if (!response.approved) {
    return { approved: false, error: `Permission denied by user for ${toolName}.` };
  }

  if (response.alwaysAllow) {
    if (target) rememberedTarget.set(toolName, target);
    toolApprovalStore.addPolicy({
      type: 'exact',
      toolName,
      pattern: toolName
    });
    console.log(`[PermissionCheck] Added policy 'exact' for ${toolName} in toolApprovalStore`);
  }

  return { approved: true, target };
}
