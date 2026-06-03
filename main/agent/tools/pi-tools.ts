/**
 * EverFern Desktop — Pi Coding Tools Adapter
 *
 * Wraps @mariozechner/pi-coding-agent standard tools into EverFern's AgentTool schema.
 * Dynamically loads the ESM package to sidestep CJS runtime errors (ERR_PACKAGE_PATH_NOT_EXPORTED).
 */

import type { AgentTool, ToolResult } from '../runner/types';
import { runInLinuxVM, isLinuxVMAvailable } from './linux-vm-executor';
import { getRollbackManager } from '../persistence/rollback-manager';
import * as fs from 'fs';
import * as path from 'path';

// Global map to store pending local execution request resolvers
// Maps requestId -> resolver function
let globalLocalExecutionResolvers: Map<string, (response: { approved: boolean; alwaysAllow: boolean }) => void> | null = null;

// Export for testing and IPC handler access
export function getLocalExecutionResolvers() {
  if (!globalLocalExecutionResolvers) {
    globalLocalExecutionResolvers = new Map();
  }
  return globalLocalExecutionResolvers;
}

// Strip ANSI escape sequences (color codes, cursor movement, etc.)
// These garble the chat UI and confuse the model's context window.
function stripAnsi(str: string): string {
  // Covers: SGR params, cursor movement, erase, scroll, OSC, etc.
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');
}

// File tool names that run on the host and need Linux→Windows path translation
const HOST_FILE_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls']);

/**
 * Translates Linux-style paths in tool args to host-native paths.
 * Platform-specific:
 * - Windows: /mnt/c/... → C:\, /home/... → \\wsl.localhost\Ubuntu\...
 * - macOS: /host/Users/... → /Users/...
 * - Linux: pass-through (already native paths)
 */
function translateLinuxPathsToHostPaths(args: Record<string, unknown>): Record<string, unknown> {
  const pathKeys = ['path', 'file_path', 'root', 'dir', 'directory', 'from', 'to', 'src', 'dest', 'destination', 'pattern', 'glob', 'include', 'exclude'];
  const translated = { ...args };

  for (const key of pathKeys) {
    const val = translated[key];
    if (typeof val !== 'string') continue;

    let p = val.replace(/\\/g, '/');

    if (process.platform === 'win32') {
      // Translate /mnt/c/... → C:\...
      const mntMatch = p.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/);
      if (mntMatch) {
        const drive = mntMatch[1].toUpperCase();
        const rest = mntMatch[2] ? mntMatch[2].replace(/\//g, '\\') : '\\';
        translated[key] = `${drive}:${rest}`;
        continue;
      }

      // Translate /home/... → \\wsl.localhost\Ubuntu\home\...
      if (p.startsWith('/home/') || p.startsWith('/root/') || p.startsWith('/tmp/')) {
        const relativePath = p.startsWith('/') ? p.substring(1) : p;
        translated[key] = `\\\\wsl.localhost\\Ubuntu\\${relativePath.replace(/\//g, '\\')}`;
        continue;
      }

      // Normalize remaining forward slashes to backslashes
      if (p.includes('/')) {
        translated[key] = p.replace(/\//g, '\\');
      }
    } else if (process.platform === 'darwin') {
      // Translate /host/Users/... → /Users/...
      if (p.startsWith('/host/Users/')) {
        translated[key] = p.replace('/host/Users/', '/Users/');
      }
    }
    // Linux: pass-through, paths are already native
  }

  return translated;
}

// Helper to convert pi-coding-agent tool into EverFern AgentTool
function adaptTool(
  definition: { name: string; description: string; parameters: any },
  executor: (toolCallId: string, params: any) => Promise<any>,
  customName?: string
): AgentTool {
  let name = customName ?? definition.name;
  let description = definition.description;
  let parameters = definition.parameters as any;

  // Enhance descriptions to enforce engineering standards from SYSTEM_PROMPT
  if (name === 'read') {
    description = `[EXPLORE-FIRST] ${description} Mandatory before any edit. For large files, use start_line/end_line to maintain context efficiency.`;
    if (parameters.properties) {
      parameters.properties.start_line = { type: 'number', description: 'Start line to read (1-indexed, inclusive)' };
      parameters.properties.end_line = { type: 'number', description: 'End line to read (1-indexed, inclusive)' };
    }
  } else if (name === 'edit') {
    description = `[SURGICAL-EDIT] ${description} ALWAYS PREFERRED over 'write' for existing files. Identify exact lines to change and provide minimal targeted diffs.`;
  } else if (name === 'write') {
    description = `[DISCIPLINED-WRITE] ${description} Use ONLY for new files or total structural rewrites. NEVER use for minor changes to existing files; use 'edit' instead.`;
  } else if (name === 'grep' || name === 'find') {
    description = `[REPO-TRIAGE] ${description} Use for mandatory triage and convention matching before writing any code.`;
  } else if (name === 'executePwsh') {
    // Add local parameter to the terminal tool schema
    description = `${description} Executes commands in Linux VM by default. Set local=true to run on host machine (requires user permission).`;
    if (parameters.properties) {
      parameters.properties.local = {
        type: 'boolean',
        description: 'Set to true to execute on local machine instead of Linux VM (requires user permission)',
        default: false
      };
      parameters.properties.reason = {
        type: 'string',
        description: 'Required when local=true. Explain why local execution is needed.'
      };
    }
  }

  return {
    name,
    description,
    parameters,
    execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
      try {
        const id = toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Special handling for executePwsh tool - route through Linux VM by default
        if (name === 'executePwsh') {
          const command = args.command as string;
          const timeout = args.timeout as number | undefined;
          const local = args.local as boolean | undefined;
          const reason = args.reason as string | undefined;

          // Validate reason field when local execution is requested
          if (local === true && !reason) {
            return {
              success: false,
              output: 'ERROR: local execution requires a reason field'
            };
          }

          // When local=true and reason is present, emit event and pause execution
          if (local === true && reason) {
            if (emitEvent) {
              const requestId = `local-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

              // Emit the local_execution_request event
              emitEvent({
                type: 'local_execution_request',
                requestId,
                command,
                shellType: 'Bash', // Default to Bash, could be enhanced to detect PowerShell
                reason,
                conversationId: undefined // Will be set by the runner if available
              });

              // Create a promise that will be resolved when the user responds
              const approvalPromise = new Promise<{ approved: boolean; alwaysAllow: boolean }>((resolve) => {
                // Store the resolver so the IPC handler can resolve it
                const resolvers = getLocalExecutionResolvers();
                console.log(`[pi-tools] 🔑 Registering resolver for requestId: ${requestId}. Map size before: ${resolvers.size}`);
                resolvers.set(requestId, resolve);
              });

              // Wait for the user's response
              const response = await approvalPromise;

              // Clean up the resolver
              const resolvers = getLocalExecutionResolvers();
              console.log(`[pi-tools] 🔓 Resolving requestId: ${requestId}, approved: ${response.approved}. Map size before delete: ${resolvers.size}`);
              resolvers.delete(requestId);

              // If denied, return error
              if (!response.approved) {
                return {
                  success: false,
                  output: 'Local execution denied by user.'
                };
              }

              // If approved, continue to execute locally
            }
          }

          if (!local) {
            // First check if Linux VM is available
            console.log(`[executePwsh] local=${local}, checking VM availability for command: "${command.slice(0, 100)}..."`);
            const vmCheck = await isLinuxVMAvailable();
            console.log(`[executePwsh] isLinuxVMAvailable result: available=${vmCheck.available}, reason="${vmCheck.reason || '(none)'}"`);
            if (vmCheck.available) {
              // Route through Linux VM when available
              try {
                console.log(`[executePwsh] VM available, calling runInLinuxVM()`);

                // Create streaming handler that emits updates and passes through onUpdate
                const streamHandler = (chunk: string) => {
                  if (onUpdate) {
                    onUpdate(chunk);
                  }
                  if (emitEvent) {
                    emitEvent({
                      type: 'command-output-stream',
                      toolCallId: id,
                      chunk,
                      timestamp: Date.now()
                    });
                  }
                };

                // Requirements 5.1, 5.2: Track command execution via RollbackManager
                const vmResult = await withCommandTracking(command, async () => {
                  const result = await runInLinuxVM(command, undefined, streamHandler);
                  console.log(`[executePwsh] runInLinuxVM result: exitCode=${result.exitCode}, stdout=${result.stdout.length} chars, stderr=${result.stderr.length} chars`);

                  // Format output to match pi-tools format exactly
                  // Success case: use stdout
                  if (result.exitCode === 0) {
                    return {
                      success: true,
                      output: stripAnsi(result.stdout)
                    };
                  }

                  // Failure case: prefer stderr, fallback to stdout if stderr is empty
                  const errorOutput = result.stderr || result.stdout;
                  return {
                    success: false,
                    output: stripAnsi(errorOutput),
                    error: stripAnsi(errorOutput)
                  };
                });
                return vmResult;
              } catch (vmError) {
                // If VM execution fails, fall back to native execution
                console.warn('[executePwsh] Linux VM execution failed, falling back to native:', vmError);
                // Continue to native execution below
              }
            } else {
              // VM not available, fall back to native execution
              console.log(`[executePwsh] VM not available (${vmCheck.reason}), falling back to native execution`);
              // Continue to native execution below
            }
          }

          // For local=true (approved) or VM fallback, use native exec to ensure output is captured
          // Requirements 5.1, 5.2: Track command execution via RollbackManager
          return await withCommandTracking(command, async () => {
            try {
              const { exec } = require('child_process');
              const { promisify } = require('util');
              const execAsync = promisify(exec);

              // Use powershell.exe on Windows, bash otherwise
              const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';

              const { stdout, stderr } = await execAsync(command, { shell, timeout: timeout || 300000 });

              const combined = [stdout, stderr].filter(Boolean).join('\n');
              const output = combined.trim() || '(Command succeeded with no output)';

              return {
                success: true,
                output: stripAnsi(output)
              };
            } catch (execError: any) {
              // Execution failed or returned non-zero exit code
              const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n');
              const output = combined.trim() || '(Command failed with no output)';

              return {
                success: false,
                output: stripAnsi(output),
                error: stripAnsi(output)
              };
            }
          });
        }

        // For host-side file tools, translate Linux paths to Windows paths
        if (HOST_FILE_TOOL_NAMES.has(name)) {
          args = translateLinuxPathsToHostPaths(args);
        }

        // For all other tools, use the original logic
        const result = await executor(id, args);

        let outputText = '';
        if (result.content && Array.isArray(result.content)) {
          outputText = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        } else if (typeof result.output === 'string') {
          outputText = result.output;
        } else {
          outputText = JSON.stringify(result);
        }

        if (result.isError) {
          return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText) };
        }
        return { success: true, output: stripAnsi(outputText) };
      } catch (err: any) {
        const msg = err.message ?? String(err);
        return { success: false, output: stripAnsi(msg), error: stripAnsi(msg) };
      }
    },
  };
}

let loadedCodingTools: AgentTool[] | null = null;

// File read cache: path → { content, mtime }
const fileReadCache = new Map<string, { content: string; mtime: number }>();

/**
 * Get current agent context for rollback tracking.
 * This should be set by the agent runtime when executing tasks.
 */
let currentAgentContext: { taskId?: string; stepNumber?: number } = {};

/**
 * Set the current agent context for rollback tracking.
 * Called by the agent runtime before tool execution.
 */
export function setAgentContext(taskId: string, stepNumber: number): void {
  currentAgentContext = { taskId, stepNumber };
}

/**
 * Clear the current agent context.
 */
export function clearAgentContext(): void {
  currentAgentContext = {};
}

/**
 * Get the current agent context for rollback tracking.
 * Used by other tools (e.g. batch_write) that need to track operations.
 */
export function getAgentContext(): { taskId?: string; stepNumber?: number } {
  return { ...currentAgentContext };
}

/**
 * Wrapper for file operations that tracks changes for rollback.
 * Captures file state before modification and tracks the operation.
 */
async function withRollbackTracking(
  toolName: string,
  args: Record<string, unknown>,
  executor: (toolCallId: string, params: any) => Promise<any>,
  toolCallId: string
): Promise<any> {
  const rollbackManager = getRollbackManager();

  // Initialize rollback manager if needed
  try {
    await rollbackManager.initialize();
  } catch (error) {
    console.warn('[pi-tools] Failed to initialize rollback manager:', error);
  }

  const { taskId, stepNumber } = currentAgentContext;

  // Only track if we have agent context
  if (!taskId || stepNumber === undefined) {
    console.warn('[pi-tools] No agent context available for rollback tracking');
    return executor(toolCallId, args);
  }

  // Handle different file operations
  if (toolName === 'write') {
    const filePath = args.path as string;
    if (!filePath) {
      return executor(toolCallId, args);
    }

    try {
      // Check if file exists and capture content before write
      let contentBefore = '';
      let fileExists = false;

      try {
        if (fs.existsSync(filePath)) {
          contentBefore = fs.readFileSync(filePath, 'utf-8');
          fileExists = true;
        }
      } catch (readError) {
        // File might not be readable, continue anyway
        console.warn(`[pi-tools] Could not read file before write: ${filePath}`, readError);
      }

      // Execute the write operation
      const result = await executor(toolCallId, args);

      // Track the operation after successful execution
      if (!result.isError) {
        try {
          const contentAfter = args.text as string || '';

          if (fileExists) {
            // File modification
            await rollbackManager.trackFileModification(
              path.resolve(filePath),
              contentBefore,
              contentAfter,
              taskId,
              stepNumber
            );
          } else {
            // File creation
            await rollbackManager.trackFileCreation(
              path.resolve(filePath),
              taskId,
              stepNumber
            );
          }
        } catch (trackError) {
          console.warn(`[pi-tools] Failed to track write operation for ${filePath}:`, trackError);
        }
      }

      return result;
    } catch (error) {
      console.error(`[pi-tools] Error in write operation for ${filePath}:`, error);
      throw error;
    }
  } else if (toolName === 'edit') {
    const filePath = args.path as string;
    if (!filePath) {
      return executor(toolCallId, args);
    }

    try {
      // Capture content before edit
      let contentBefore = '';

      try {
        if (fs.existsSync(filePath)) {
          contentBefore = fs.readFileSync(filePath, 'utf-8');
        }
      } catch (readError) {
        console.warn(`[pi-tools] Could not read file before edit: ${filePath}`, readError);
      }

      // Execute the edit operation
      const result = await executor(toolCallId, args);

      // Track the operation after successful execution
      if (!result.isError) {
        try {
          // Read content after edit
          let contentAfter = '';
          try {
            if (fs.existsSync(filePath)) {
              contentAfter = fs.readFileSync(filePath, 'utf-8');
            }
          } catch (readError) {
            console.warn(`[pi-tools] Could not read file after edit: ${filePath}`, readError);
          }

          if (contentBefore !== contentAfter) {
            await rollbackManager.trackFileModification(
              path.resolve(filePath),
              contentBefore,
              contentAfter,
              taskId,
              stepNumber
            );
          }
        } catch (trackError) {
          console.warn(`[pi-tools] Failed to track edit operation for ${filePath}:`, trackError);
        }
      }

      return result;
    } catch (error) {
      console.error(`[pi-tools] Error in edit operation for ${filePath}:`, error);
      throw error;
    }
  }

  // For non-file operations, just execute normally
  return executor(toolCallId, args);
}

/**
 * Wrapper for command execution that tracks commands for rollback.
 */
async function withCommandTracking(
  command: string,
  executor: () => Promise<ToolResult>
): Promise<ToolResult> {
  const rollbackManager = getRollbackManager();

  // Initialize rollback manager if needed
  try {
    await rollbackManager.initialize();
  } catch (error) {
    console.warn('[pi-tools] Failed to initialize rollback manager:', error);
  }

  const { taskId, stepNumber } = currentAgentContext;

  // Execute the command
  const result = await executor();

  // Track the command if we have agent context
  if (taskId && stepNumber !== undefined) {
    try {
      const exitCode = result.success ? 0 : 1;
      const output = result.output || '';

      await rollbackManager.trackCommandExecution(
        command,
        output,
        exitCode,
        taskId,
        stepNumber
      );
    } catch (trackError) {
      console.warn(`[pi-tools] Failed to track command execution: ${command}`, trackError);
    }
  }

  return result;
}

// Allow dependency injection for testing
let piCodingAgentModule: any = null;

export function __setPiCodingAgentModule(module: any) {
  piCodingAgentModule = module;
  loadedCodingTools = null; // Reset cache when module is injected
}

// Wrap executor with caching for read operations
function withReadCache(executor: (toolCallId: string, params: any) => Promise<any>) {
  return async (toolCallId: string, params: any) => {
    const path = params.path as string;
    if (!path) return executor(toolCallId, params);

    try {
      const fs = require('fs');
      const stat = fs.statSync(path);
      const cached = fileReadCache.get(path);

      if (cached && cached.mtime === stat.mtimeMs) {
        return { content: [{ type: 'text', text: cached.content }] };
      }

      const result = await executor(toolCallId, params);

      if (result.content && !result.isError) {
        const content = Array.isArray(result.content)
          ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : '';
        if (content) {
          fileReadCache.set(path, { content, mtime: stat.mtimeMs });
        }
      }

      return result;
    } catch (err) {
      return executor(toolCallId, params);
    }
  };
}

export async function getPiCodingTools(): Promise<AgentTool[]> {
  if (loadedCodingTools) return loadedCodingTools;

  // Use injected module for testing, or dynamic import for production
  let m: any;
  if (piCodingAgentModule) {
    m = piCodingAgentModule;
  } else {
    // Use a Function to prevent TS from transpiling this into require()
    // Since the pi package is pure ESM (type: module, no require exports).
    const loader = new Function('return import("@mariozechner/pi-coding-agent")');
    m = await loader();
  }

  // Wrap write and edit executors with rollback tracking
  const writeExecutorWithTracking = (toolCallId: string, params: any) =>
    withRollbackTracking('write', params, m.writeTool.execute, toolCallId);
  const editExecutorWithTracking = (toolCallId: string, params: any) =>
    withRollbackTracking('edit', params, m.editTool.execute, toolCallId);

  loadedCodingTools = [
    adaptTool(m.readToolDefinition, withReadCache(m.readTool.execute)),
    adaptTool(m.writeToolDefinition, writeExecutorWithTracking),
    adaptTool(m.editToolDefinition, editExecutorWithTracking),
    adaptTool(m.findToolDefinition, m.findTool.execute),
    adaptTool(m.grepToolDefinition, m.grepTool.execute),
    adaptTool(m.lsToolDefinition, m.lsTool.execute),
    adaptTool(m.bashToolDefinition, m.bashTool.execute, 'executePwsh'),
  ];

  return loadedCodingTools;
}

// Export for testing - allows tests to reset the cache
export function resetPiCodingToolsCache() {
  loadedCodingTools = null;
  fileReadCache.clear();
}
