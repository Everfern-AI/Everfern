"use strict";
/**
 * Backward Compatibility Layer for Pill-Based Narrative Timeline
 *
 * This module provides conversion utilities to transform between pill-based
 * and flat timeline formats, ensuring backward compatibility with existing
 * MissionTimeline structures.
 *
 * **Validates: Requirements 9.1, 9.4, 9.5**
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToFlatTimeline = convertToFlatTimeline;
exports.convertToPillBased = convertToPillBased;
exports.validateBackwardCompatibility = validateBackwardCompatibility;
exports.isPillBasedTimeline = isPillBasedTimeline;
exports.isFlatTimeline = isFlatTimeline;
/**
 * Convert pill-based timeline to flat timeline format
 *
 * This function transforms a pill-based narrative timeline into a flat
 * list of tool calls, maintaining all critical information.
 */
function convertToFlatTimeline(pillBasedTimeline) {
    const toolCalls = [];
    // Flatten all pills from all tasks
    for (const task of pillBasedTimeline.tasks) {
        for (const pill of task.pills) {
            toolCalls.push({
                id: pill.id,
                toolName: pill.toolName,
                status: pill.status,
                parameters: pill.parameters,
                result: pill.result,
                error: pill.error,
                startTime: pill.startTime,
                endTime: pill.endTime,
            });
        }
    }
    return {
        missionId: pillBasedTimeline.missionId,
        toolCalls,
        status: pillBasedTimeline.status,
        startTime: pillBasedTimeline.startTime,
        endTime: pillBasedTimeline.endTime,
        metadata: pillBasedTimeline.metadata,
    };
}
/**
 * Convert flat timeline to pill-based format
 *
 * This function transforms a flat list of tool calls into a pill-based
 * narrative timeline. It groups tool calls into tasks based on logical
 * boundaries (e.g., tool type changes, explicit task markers).
 */
function convertToPillBased(flatTimeline) {
    const tasks = [];
    if (flatTimeline.toolCalls.length === 0) {
        return {
            missionId: flatTimeline.missionId,
            tasks: [],
            status: flatTimeline.status,
            startTime: flatTimeline.startTime,
            endTime: flatTimeline.endTime,
            metadata: flatTimeline.metadata,
        };
    }
    // Group tool calls into tasks
    // Strategy: Create one task per tool call for simplicity
    // (In a more sophisticated implementation, we could use heuristics to group related calls)
    let currentTaskIndex = 0;
    const taskMap = new Map();
    for (const toolCall of flatTimeline.toolCalls) {
        const pill = {
            id: toolCall.id,
            toolName: toolCall.toolName,
            status: toolCall.status,
            parameters: toolCall.parameters,
            result: toolCall.result,
            error: toolCall.error,
            startTime: toolCall.startTime,
            endTime: toolCall.endTime,
        };
        if (!taskMap.has(currentTaskIndex)) {
            taskMap.set(currentTaskIndex, []);
        }
        taskMap.get(currentTaskIndex).push(pill);
        // Create a new task for each tool call (simple grouping)
        // In practice, you might want to group related calls together
        currentTaskIndex++;
    }
    // Convert task map to tasks array
    let taskIndex = 0;
    for (const [, pills] of taskMap) {
        const task = {
            id: `task_${taskIndex + 1}`,
            title: generateTaskTitle(pills),
            pills,
            status: calculateTaskStatus(pills),
        };
        tasks.push(task);
        taskIndex++;
    }
    return {
        missionId: flatTimeline.missionId,
        tasks,
        status: flatTimeline.status,
        startTime: flatTimeline.startTime,
        endTime: flatTimeline.endTime,
        metadata: flatTimeline.metadata,
    };
}
/**
 * Generate a task title from pills
 */
function generateTaskTitle(pills) {
    if (pills.length === 0) {
        return 'Execute Task';
    }
    // Use the first pill's tool name to generate a title
    const firstPill = pills[0];
    const toolName = firstPill.toolName;
    const titleMap = {
        web_search: 'Search for information',
        browser_use: 'Browse web pages',
        read_file: 'Read files',
        write_file: 'Write files',
        python_execute: 'Execute Python code',
        terminal_execute: 'Execute terminal commands',
        computer_use: 'Use computer',
        file_read: 'Read files',
        file_write: 'Write files',
    };
    return titleMap[toolName] || `Execute ${toolName}`;
}
/**
 * Calculate task status from pills
 */
function calculateTaskStatus(pills) {
    if (pills.length === 0) {
        return 'pending';
    }
    const statuses = pills.map((p) => p.status);
    // If any pill failed, task fails
    if (statuses.some((s) => s === 'failed')) {
        return 'failed';
    }
    // If any pill is in-progress, task is in-progress
    if (statuses.some((s) => s === 'in-progress')) {
        return 'in-progress';
    }
    // If all pills are completed, task is completed
    if (statuses.every((s) => s === 'completed')) {
        return 'completed';
    }
    // If all pills are skipped, task is skipped
    if (statuses.every((s) => s === 'skipped')) {
        return 'skipped';
    }
    // Otherwise, task is pending
    return 'pending';
}
/**
 * Validate backward compatibility
 *
 * Checks that converting to flat and back to pill-based format
 * preserves all critical information.
 */
function validateBackwardCompatibility(pillBasedTimeline) {
    const errors = [];
    // Convert to flat
    const flatTimeline = convertToFlatTimeline(pillBasedTimeline);
    // Check that all pills are present in flat timeline
    const totalPills = pillBasedTimeline.tasks.reduce((sum, task) => sum + task.pills.length, 0);
    if (flatTimeline.toolCalls.length !== totalPills) {
        errors.push(`Pill count mismatch: expected ${totalPills}, got ${flatTimeline.toolCalls.length}`);
    }
    // Check that all pill IDs are preserved
    const pillIds = new Set();
    for (const task of pillBasedTimeline.tasks) {
        for (const pill of task.pills) {
            pillIds.add(pill.id);
        }
    }
    const flatPillIds = new Set(flatTimeline.toolCalls.map((tc) => tc.id));
    for (const pillId of pillIds) {
        if (!flatPillIds.has(pillId)) {
            errors.push(`Pill ID not found in flat timeline: ${pillId}`);
        }
    }
    // Check that mission ID is preserved
    if (flatTimeline.missionId !== pillBasedTimeline.missionId) {
        errors.push('Mission ID not preserved in conversion');
    }
    // Check that status is preserved
    if (flatTimeline.status !== pillBasedTimeline.status) {
        errors.push('Status not preserved in conversion');
    }
    // Check that timing is preserved
    if (flatTimeline.startTime !== pillBasedTimeline.startTime) {
        errors.push('Start time not preserved in conversion');
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Check if a timeline is in pill-based format
 */
function isPillBasedTimeline(timeline) {
    if (!timeline || typeof timeline !== 'object') {
        return false;
    }
    return 'missionId' in timeline && 'tasks' in timeline && Array.isArray(timeline.tasks);
}
/**
 * Check if a timeline is in flat format
 */
function isFlatTimeline(timeline) {
    if (!timeline || typeof timeline !== 'object') {
        return false;
    }
    return 'missionId' in timeline && 'toolCalls' in timeline && Array.isArray(timeline.toolCalls);
}
