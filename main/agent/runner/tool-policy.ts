/**
 * EverFern Desktop — Tool Policy Pipeline
 * 
 * Multi-stage policy enforcement for tool calls.
 * Implements OpenClaw-style allowlist/deny/owner-only policies.
 */

export type ToolPolicyResult = 'allow' | 'deny' | 'owner_only' | 'pending';

export interface ToolPolicyContext {
    toolName: string;
    args: Record<string, unknown>;
    sessionKey: string;
    userId?: string;
    model?: string;
    provider?: string;
}

export interface ToolPolicy {
    name: string;
    check: (ctx: ToolPolicyContext) => ToolPolicyResult | Promise<ToolPolicyResult>;
    priority: number;
}

export interface ToolPolicyPipeline {
    policies: ToolPolicy[];
    addPolicy: (policy: ToolPolicy) => void;
    removePolicy: (name: string) => void;
    check: (ctx: ToolPolicyContext) => Promise<ToolPolicyResult>;
    checkSync: (ctx: ToolPolicyContext) => ToolPolicyResult;
}

export function createToolPolicyPipeline(): ToolPolicyPipeline {
    const policies: ToolPolicy[] = [];

    async function check(ctx: ToolPolicyContext): Promise<ToolPolicyResult> {
        for (const policy of policies) {
            const result = await policy.check(ctx);
            if (result !== 'allow') {
                console.log(`[ToolPolicy] ${policy.name}: ${ctx.toolName} → ${result}`);
                return result;
            }
        }
        return 'allow';
    }

    function checkSync(ctx: ToolPolicyContext): ToolPolicyResult {
        for (const policy of policies) {
            const result = policy.check(ctx);
            if (result !== 'allow' && result !== Promise.resolve('allow')) {
                console.log(`[ToolPolicy] ${policy.name}: ${ctx.toolName} → ${result}`);
                return result as ToolPolicyResult;
            }
        }
        return 'allow';
    }

    return {
        get policies() { return [...policies]; },
        addPolicy(policy: ToolPolicy) {
            policies.push(policy);
            policies.sort((a, b) => b.priority - a.priority);
            console.log(`[ToolPolicy] Added policy: ${policy.name}`);
        },
        removePolicy(name: string) {
            const idx = policies.findIndex(p => p.name === name);
            if (idx !== -1) {
                policies.splice(idx, 1);
                console.log(`[ToolPolicy] Removed policy: ${name}`);
            }
        },
        check,
        checkSync
    };
}

// Pre-built policies
export const builtInPolicies = {
    // Deny high-risk tools by default
    createDenyPolicy(deniedTools: string[]): ToolPolicy {
        return {
            name: 'deny_high_risk',
            priority: 100,
            check: (ctx) => {
                if (deniedTools.includes(ctx.toolName)) {
                    return 'deny';
                }
                return 'allow';
            }
        };
    },

    // Allow only specific tools
    createAllowlistPolicy(allowedTools: string[]): ToolPolicy {
        return {
            name: 'allowlist',
            priority: 90,
            check: (ctx) => {
                if (!allowedTools.includes(ctx.toolName)) {
                    return 'deny';
                }
                return 'allow';
            }
        };
    },

    // Owner-only tools (require user confirmation)
    createOwnerOnlyPolicy(ownerOnlyTools: string[]): ToolPolicy {
        return {
            name: 'owner_only',
            priority: 80,
            check: (ctx) => {
                // High-risk command patterns for terminal/bash
                const dangerousCommands = [
                  'del ', 'rm ', 'rmdir ', 'rd ', 'format ', 'mkfs ', 'dd ', 
                  '> /dev/', 'shred ', 'wipe ', 'mount ', 'umount '
                ];
                
                const isDangerousTerminal = (cmd: string) => {
                  const lower = cmd.toLowerCase();
                  return dangerousCommands.some(d => lower.includes(d));
                };

                // Smart check for terminal/bash tools
                if (['terminal_execute', 'executePwsh', 'bash', 'exec'].includes(ctx.toolName)) {
                    const target = ctx.args.target || 'main';

                    // 1. Check auto-approval store (Allow Always / Allow Prefix)
                    try {
                        const { toolApprovalStore } = require('../../store/tool-approvals');
                        if (toolApprovalStore.isApproved(ctx.toolName, ctx.args)) {
                            console.log(`[ToolPolicy] Command auto-approved via toolApprovalStore`);
                            return 'allow';
                        }
                    } catch (e) {
                        console.error('[ToolPolicy] Error checking toolApprovalStore:', e);
                    }

                    // 2. VM execution is isolated and doesn't require permission
                    if (target === 'vm') {
                        return 'allow';
                    }

                    // 3. Main host execution ALWAYS requires permission
                    console.log(`[ToolPolicy] Command on main host detected → Requiring approval`);
                    return 'owner_only';
                }

                if (ownerOnlyTools.includes(ctx.toolName)) {
                    return 'owner_only';
                }
                return 'allow';
            }
        };
    },

    // Model compatibility check
    createModelCompatibilityPolicy(requiredCapabilities: Record<string, string[]>): ToolPolicy {
        return {
            name: 'model_compatibility',
            priority: 70,
            check: (ctx) => {
                if (!ctx.model) return 'allow';
                
                const modelCaps = requiredCapabilities[ctx.model];
                if (!modelCaps) return 'allow'; // Unknown model, allow
                
                if (!modelCaps.includes(ctx.toolName)) {
                    console.log(`[ToolPolicy] Model ${ctx.model} may not support ${ctx.toolName}`);
                    return 'deny';
                }
                return 'allow';
            }
        };
    },

    // Provider-specific filtering
    createProviderFilterPolicy(providerDenials: Record<string, string[]>): ToolPolicy {
        return {
            name: 'provider_filter',
            priority: 60,
            check: (ctx) => {
                if (!ctx.provider) return 'allow';
                
                const denied = providerDenials[ctx.provider];
                if (denied && denied.includes(ctx.toolName)) {
                    return 'deny';
                }
                return 'allow';
            }
        };
    }
};

// Default policy configuration
export function createDefaultPolicyPipeline(): ToolPolicyPipeline {
    const pipeline = createToolPolicyPipeline();

    // Add default policies
    pipeline.addPolicy(builtInPolicies.createDenyPolicy([
        'rm_rf', 'format', 'drop_database', 'delete_all'
    ]));

    // Updated: edit and write require approval, but terminal is now "smart" (only dangerous cmds)
    pipeline.addPolicy(builtInPolicies.createOwnerOnlyPolicy([
        'edit', 'write', 'write_file', 'write_to_file', 'apply_patch', 'system_files', 'delete'
    ]));

    return pipeline;
}

// Singleton
let defaultPipeline: ToolPolicyPipeline | null = null;

export function getDefaultToolPolicyPipeline(): ToolPolicyPipeline {
    if (!defaultPipeline) {
        defaultPipeline = createDefaultPolicyPipeline();
    }
    return defaultPipeline;
}
