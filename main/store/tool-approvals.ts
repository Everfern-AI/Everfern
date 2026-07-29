import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tool Approval Policy
 */
export interface ToolApprovalPolicy {
  id: string;
  type: 'exact' | 'prefix';
  toolName: string;
  pattern: string;
  createdAt: string;
}

const POLICIES_FILE_PATH = path.join(os.homedir(), '.everfern', 'tool-approvals.json');

export class ToolApprovalStore {
  private policies: ToolApprovalPolicy[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || POLICIES_FILE_PATH;
    this.policies = this.load();
  }

  private load(): ToolApprovalPolicy[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[ToolApprovalStore] ⚠️ Malformed tool-approvals.json — resetting to empty:', err);
      return [];
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.policies, null, 2), 'utf-8');
  }

  /**
   * Add a new auto-approval policy
   */
  addPolicy(policy: Omit<ToolApprovalPolicy, 'id' | 'createdAt'>): ToolApprovalPolicy {
    const newPolicy: ToolApprovalPolicy = {
      ...policy,
      id: Math.random().toString(36).substring(2, 11),
      createdAt: new Date().toISOString(),
    };
    
    // Avoid duplicates
    const exists = this.policies.some(p => 
      p.type === newPolicy.type && 
      p.toolName === newPolicy.toolName && 
      p.pattern === newPolicy.pattern
    );
    
    if (!exists) {
      this.policies.push(newPolicy);
      this.save();
    }
    
    return newPolicy;
  }

  /**
   * Check if a tool call matches any auto-approval policy
   */
  isApproved(toolName: string, args: Record<string, any>): boolean {
    const cmdTools = ['terminal_execute', 'executePwsh', 'run_command', 'bash'];

    // Auto-approve common safe read-only terminal commands
    if (cmdTools.includes(toolName)) {
      const cmd = (args.command || args.CommandLine || args.cmd || '').trim().toLowerCase();
      const safePrefixes = [
        'git status', 'git diff', 'git log', 'git branch', 'git show',
        'ls', 'dir', 'pwd', 'whoami', 'date',
        'node -v', 'npm -v', 'pnpm -v', 'yarn -v', 'python --version', 'git --version',
        'npx tsc --noEmit', 'echo '
      ];
      if (safePrefixes.some(sp => cmd === sp || cmd.startsWith(sp))) {
        return true;
      }
    }

    for (const policy of this.policies) {
      if (policy.toolName !== toolName) continue;
      
      if (cmdTools.includes(toolName)) {
        const cmd = (args.command || args.CommandLine || args.cmd || '').trim();
        if (typeof cmd !== 'string' || !cmd) continue;
        
        const normCmd = cmd.toLowerCase();
        const normPattern = policy.pattern.trim().toLowerCase();

        if (policy.type === 'exact' && normCmd === normPattern) return true;
        if (policy.type === 'prefix' && normCmd.startsWith(normPattern)) return true;
      } else {
        // For non-command tools, matching toolName auto-approves
        if (policy.type === 'exact' || policy.type === 'prefix') return true;
      }
    }
    
    return false;
  }

  /**
   * List all policies
   */
  getPolicies(): ToolApprovalPolicy[] {
    return [...this.policies];
  }

  /**
   * Update an existing policy by ID
   */
  updatePolicy(id: string, updates: Partial<Omit<ToolApprovalPolicy, 'id' | 'createdAt'>>): ToolApprovalPolicy | null {
    const index = this.policies.findIndex(p => p.id === id);
    if (index === -1) return null;

    this.policies[index] = {
      ...this.policies[index],
      ...updates,
    };
    this.save();
    return this.policies[index];
  }

  /**
   * Delete a policy by ID
   */
  deletePolicy(id: string): void {
    this.policies = this.policies.filter(p => p.id !== id);
    this.save();
  }

  /**
   * Clear all policies
   */
  clearAllPolicies(): void {
    this.policies = [];
    this.save();
  }
}

export const toolApprovalStore = new ToolApprovalStore();
