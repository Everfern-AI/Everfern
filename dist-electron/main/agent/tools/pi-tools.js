"use strict";
/**
 * EverFern Desktop — Pi Coding Tools Adapter
 *
 * Wraps @mariozechner/pi-coding-agent standard tools into EverFern's AgentTool schema.
 * Dynamically loads the ESM package to sidestep CJS runtime errors (ERR_PACKAGE_PATH_NOT_EXPORTED).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalExecutionResolvers = getLocalExecutionResolvers;
exports.__setPiCodingAgentModule = __setPiCodingAgentModule;
exports.getPiCodingTools = getPiCodingTools;
exports.resetPiCodingToolsCache = resetPiCodingToolsCache;
const linux_vm_executor_1 = require("./linux-vm-executor");
// Global map to store pending local execution request resolvers
// Maps requestId -> resolver function
let globalLocalExecutionResolvers = null;
// Export for testing and IPC handler access
function getLocalExecutionResolvers() {
    if (!globalLocalExecutionResolvers) {
        globalLocalExecutionResolvers = new Map();
    }
    return globalLocalExecutionResolvers;
}
// Strip ANSI escape sequences (color codes, cursor movement, etc.)
// These garble the chat UI and confuse the model's context window.
function stripAnsi(str) {
    // Covers: SGR params, cursor movement, erase, scroll, OSC, etc.
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');
}
// Helper to convert pi-coding-agent tool into EverFern AgentTool
function adaptTool(definition, executor, customName) {
    let name = customName ?? definition.name;
    let description = definition.description;
    let parameters = definition.parameters;
    // Enhance descriptions to enforce engineering standards from SYSTEM_PROMPT
    if (name === 'read') {
        description = `[EXPLORE-FIRST] ${description} Mandatory before any edit. For large files, use start_line/end_line to maintain context efficiency.`;
        if (parameters.properties) {
            parameters.properties.start_line = { type: 'number', description: 'Start line to read (1-indexed, inclusive)' };
            parameters.properties.end_line = { type: 'number', description: 'End line to read (1-indexed, inclusive)' };
        }
    }
    else if (name === 'edit') {
        description = `[SURGICAL-EDIT] ${description} ALWAYS PREFERRED over 'write' for existing files. Identify exact lines to change and provide minimal targeted diffs.`;
    }
    else if (name === 'write') {
        description = `[DISCIPLINED-WRITE] ${description} Use ONLY for new files or total structural rewrites. NEVER use for minor changes to existing files; use 'edit' instead.`;
    }
    else if (name === 'grep' || name === 'find') {
        description = `[REPO-TRIAGE] ${description} Use for mandatory triage and convention matching before writing any code.`;
    }
    else if (name === 'executePwsh') {
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
        execute: async (args, onUpdate, emitEvent, toolCallId) => {
            try {
                const id = toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                // Special handling for executePwsh tool - route through Linux VM by default
                if (name === 'executePwsh') {
                    const command = args.command;
                    const timeout = args.timeout;
                    const local = args.local;
                    const reason = args.reason;
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
                            const approvalPromise = new Promise((resolve) => {
                                // Store the resolver so the IPC handler can resolve it
                                const resolvers = getLocalExecutionResolvers();
                                resolvers.set(requestId, resolve);
                            });
                            // Wait for the user's response
                            const response = await approvalPromise;
                            // Clean up the resolver
                            const resolvers = getLocalExecutionResolvers();
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
                        // Route through Linux VM by default
                        try {
                            const result = await (0, linux_vm_executor_1.runInLinuxVM)(command);
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
                        }
                        catch (vmError) {
                            // If VM execution fails, fall back to native execution
                            console.warn('Linux VM execution failed, falling back to native:', vmError);
                            // Continue to native execution below
                        }
                    }
                    // For local=true (approved) or VM fallback, use the original executor
                    const result = await executor(id, args);
                    let outputText = '';
                    if (result.content && Array.isArray(result.content)) {
                        outputText = result.content
                            .filter((c) => c.type === 'text')
                            .map((c) => c.text)
                            .join('\n');
                    }
                    else if (typeof result.output === 'string') {
                        outputText = result.output;
                    }
                    else {
                        outputText = JSON.stringify(result);
                    }
                    if (result.isError) {
                        return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText) };
                    }
                    return { success: true, output: stripAnsi(outputText) };
                }
                // For all other tools, use the original logic
                const result = await executor(id, args);
                let outputText = '';
                if (result.content && Array.isArray(result.content)) {
                    outputText = result.content
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join('\n');
                }
                else if (typeof result.output === 'string') {
                    outputText = result.output;
                }
                else {
                    outputText = JSON.stringify(result);
                }
                if (result.isError) {
                    return { success: false, output: stripAnsi(outputText), error: stripAnsi(outputText) };
                }
                return { success: true, output: stripAnsi(outputText) };
            }
            catch (err) {
                const msg = err.message ?? String(err);
                return { success: false, output: stripAnsi(msg), error: stripAnsi(msg) };
            }
        },
    };
}
let loadedCodingTools = null;
// File read cache: path → { content, mtime }
const fileReadCache = new Map();
// Allow dependency injection for testing
let piCodingAgentModule = null;
function __setPiCodingAgentModule(module) {
    piCodingAgentModule = module;
    loadedCodingTools = null; // Reset cache when module is injected
}
// Wrap executor with caching for read operations
function withReadCache(executor) {
    return async (toolCallId, params) => {
        const path = params.path;
        if (!path)
            return executor(toolCallId, params);
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
                    ? result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
                    : '';
                if (content) {
                    fileReadCache.set(path, { content, mtime: stat.mtimeMs });
                }
            }
            return result;
        }
        catch (err) {
            return executor(toolCallId, params);
        }
    };
}
async function getPiCodingTools() {
    if (loadedCodingTools)
        return loadedCodingTools;
    // Use injected module for testing, or dynamic import for production
    let m;
    if (piCodingAgentModule) {
        m = piCodingAgentModule;
    }
    else {
        // Use a Function to prevent TS from transpiling this into require()
        // Since the pi package is pure ESM (type: module, no require exports).
        const loader = new Function('return import("@mariozechner/pi-coding-agent")');
        m = await loader();
    }
    loadedCodingTools = [
        adaptTool(m.readToolDefinition, withReadCache(m.readTool.execute)),
        adaptTool(m.writeToolDefinition, m.writeTool.execute),
        adaptTool(m.editToolDefinition, m.editTool.execute),
        adaptTool(m.findToolDefinition, m.findTool.execute),
        adaptTool(m.grepToolDefinition, m.grepTool.execute),
        adaptTool(m.lsToolDefinition, m.lsTool.execute),
        adaptTool(m.bashToolDefinition, m.bashTool.execute, 'executePwsh'),
    ];
    return loadedCodingTools;
}
// Export for testing - allows tests to reset the cache
function resetPiCodingToolsCache() {
    loadedCodingTools = null;
    fileReadCache.clear();
}
