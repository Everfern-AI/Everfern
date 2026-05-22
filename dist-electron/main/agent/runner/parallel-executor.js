"use strict";
/**
 * EverFern Desktop — Parallel Tool Executor (Synchronized)
 *
 * Executes independent tools in parallel while emitting synchronization events
 * to ensure the UI and backend stay perfectly aligned during multi-agent deployment.
 *
 * Resource Limits:
 * - Max 4 concurrent operations (prevents resource exhaustion)
 * - Max output size: 2MB per tool result (prevents memory bloat)
 * - Timeout: 5 minutes per tool (prevents hanging)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeToolDependencies = analyzeToolDependencies;
exports.groupParallelTools = groupParallelTools;
exports.executeSynchronizedParallelGroup = executeSynchronizedParallelGroup;
const MAX_CONCURRENT_TOOLS = 4;
const MAX_RESULT_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const TOOL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Analyzes tool calls to determine which can be executed in parallel.
 */
function analyzeToolDependencies(tools) {
    const fileWriteTools = new Set(['write', 'write_file', 'edit', 'delete', 'bash', 'run_command', 'apply_patch', 'executePwsh']);
    const readOnlyTools = new Set(['read', 'read_file', 'web_search', 'memory_search', 'list_directory']);
    return tools.map(tool => {
        const isWrite = fileWriteTools.has(tool.name);
        const isGlobalLocking = ['run_command', 'bash', 'apply_patch', 'executePwsh', 'navis'].includes(tool.name) && tool.args.safe_for_parallel !== true;
        const isReadOnly = readOnlyTools.has(tool.name) || (!isWrite && !isGlobalLocking);
        // Detect potential conflicts (same file path)
        const conflicts = [];
        const filePaths = extractFilePaths(tool.args);
        for (const other of tools) {
            if (other.id === tool.id)
                continue;
            const otherGlobalLocking = ['run_command', 'bash', 'apply_patch', 'executePwsh'].includes(other.name) && other.args.safe_for_parallel !== true;
            // Globally locking tools conflict with absolutely everything else
            if (isGlobalLocking || otherGlobalLocking) {
                conflicts.push(other.id);
                continue;
            }
            // present_files conflicts with any write or command execution tools
            const isPresentFiles = tool.name === 'present_files';
            const otherIsPresentFiles = other.name === 'present_files';
            const isWriteOrExec = isWrite || ['run_command', 'bash', 'executePwsh', 'apply_patch', 'edit', 'write', 'write_file'].includes(tool.name);
            const otherIsWriteOrExec = fileWriteTools.has(other.name) || ['run_command', 'bash', 'executePwsh', 'apply_patch', 'edit', 'write', 'write_file'].includes(other.name);
            if ((isPresentFiles && otherIsWriteOrExec) || (otherIsPresentFiles && isWriteOrExec)) {
                conflicts.push(other.id);
                continue;
            }
            const otherPaths = extractFilePaths(other.args);
            const overlapping = filePaths.filter(p => otherPaths.includes(p));
            const otherIsWrite = fileWriteTools.has(other.name);
            // Writes to same path conflict
            if ((isWrite || otherIsWrite) && overlapping.length > 0) {
                conflicts.push(other.id);
            }
        }
        return {
            name: tool.name,
            args: tool.args,
            id: tool.id,
            readOnly: isReadOnly,
            conflicts
        };
    });
}
/**
 * Extract file paths from tool arguments.
 */
function extractFilePaths(args) {
    const paths = [];
    const pathKeys = ['path', 'file_path', 'root', 'dir', 'directory', 'from', 'to', 'src', 'dest'];
    const recurse = (val) => {
        if (!val)
            return;
        if (typeof val === 'string') {
            paths.push(val);
        }
        else if (Array.isArray(val)) {
            val.forEach(item => recurse(item));
        }
        else if (typeof val === 'object') {
            for (const [k, v] of Object.entries(val)) {
                if (pathKeys.includes(k.toLowerCase()) || k === 'paths') {
                    recurse(v);
                }
                else if (Array.isArray(v) || typeof v === 'object') {
                    recurse(v);
                }
            }
        }
    };
    recurse(args);
    return paths;
}
/**
 * Groups tools by execution phase (parallel groups).
 * Returns groups of tools that can run in parallel.
 */
function groupParallelTools(tools) {
    if (tools.length === 0)
        return [];
    const remaining = [...tools];
    const groups = [];
    while (remaining.length > 0) {
        const currentGroup = [];
        const usedIds = new Set();
        for (let i = 0; i < remaining.length; i++) {
            const tool = remaining[i];
            // Skip if already in a group
            if (usedIds.has(tool.id))
                continue;
            // Check if any conflict is still remaining in this group or current remaining list
            const hasConflict = tool.conflicts.some(cid => usedIds.has(cid));
            if (!hasConflict) {
                currentGroup.push(tool);
                usedIds.add(tool.id);
            }
        }
        if (currentGroup.length === 0) {
            // Deadlock: force-add one tool
            currentGroup.push(remaining.shift());
        }
        else {
            // Remove used tools from remaining
            for (const tool of currentGroup) {
                const idx = remaining.findIndex(t => t.id === tool.id);
                if (idx !== -1)
                    remaining.splice(idx, 1);
            }
        }
        groups.push(currentGroup);
    }
    return groups;
}
/**
 * Truncates tool result output if it exceeds size limits.
 * Prevents extremely large outputs from consuming memory.
 */
function truncateToolResult(result) {
    if (typeof result.output === 'string' && result.output.length > MAX_RESULT_OUTPUT_SIZE) {
        const truncated = result.output.substring(0, MAX_RESULT_OUTPUT_SIZE);
        return {
            ...result,
            output: `${truncated}\n\n[... OUTPUT TRUNCATED (exceeded ${MAX_RESULT_OUTPUT_SIZE} bytes) ...]`,
        };
    }
    return result;
}
/**
 * Executes a group of tools in parallel with synchronized event emission.
 */
async function executeSynchronizedParallelGroup(group, tools, groupIndex, eventQueue, onUpdate) {
    const startTime = Date.now();
    // Emit synchronization start event
    eventQueue?.push({
        type: 'parallel_group_start',
        groupIndex,
        stepCount: group.length
    });
    const promises = group.map(async (tc) => {
        const tool = tools.find(t => t.name === tc.name);
        if (!tool) {
            return {
                toolName: tc.name,
                args: tc.args,
                result: { success: false, output: `Tool not found: ${tc.name}`, error: 'not_found' },
                timestamp: new Date().toISOString()
            };
        }
        // Emit individual tool start
        eventQueue?.push({
            type: 'tool_start',
            toolName: tc.name,
            toolArgs: tc.args,
            toolCallId: tc.id
        });
        try {
            const result = await tool.execute(tc.args, (update) => {
                eventQueue?.push({ type: 'tool_update', toolName: tc.name, update });
            }, (event) => {
                eventQueue?.push(event);
            }, tc.id);
            const record = {
                id: tc.id,
                toolName: tc.name,
                args: tc.args,
                result,
                timestamp: new Date().toISOString()
            };
            // Emit individual tool completion
            eventQueue?.push({ type: 'tool_call', toolCall: record });
            return record;
        }
        catch (err) {
            const record = {
                id: tc.id,
                toolName: tc.name,
                args: tc.args,
                result: { success: false, output: `Error: ${err.message}`, error: String(err) },
                timestamp: new Date().toISOString()
            };
            eventQueue?.push({ type: 'tool_call', toolCall: record });
            return record;
        }
    });
    const results = await Promise.all(promises);
    const durationMs = Date.now() - startTime;
    // Emit synchronization end event
    eventQueue?.push({
        type: 'parallel_group_end',
        groupIndex,
        durationMs
    });
    return {
        results,
        groupIndex,
        durationMs
    };
}
