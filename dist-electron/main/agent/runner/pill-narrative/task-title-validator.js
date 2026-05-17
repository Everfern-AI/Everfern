"use strict";
/**
 * Task Title Validation Module
 *
 * This module provides validation functions for task titles to ensure they are:
 * - Non-empty and distinct
 * - Business-focused (no tool names)
 * - Properly formatted
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTaskTitle = validateTaskTitle;
exports.containsToolName = containsToolName;
exports.hasBusinessLanguage = hasBusinessLanguage;
exports.areTaskTitlesDistinct = areTaskTitlesDistinct;
exports.validateTaskTitles = validateTaskTitles;
exports.generateTaskTitle = generateTaskTitle;
exports.sanitizeTaskTitle = sanitizeTaskTitle;
/**
 * List of tool names to exclude from task titles
 */
const TOOL_NAMES = [
    'web_search',
    'browser_use',
    'read_file',
    'write_file',
    'python_execute',
    'terminal_execute',
    'computer_use',
    'file_read',
    'file_write',
    'execute_python',
    'execute_terminal',
    'search_web',
    'use_browser',
];
/**
 * Validate a single task title
 *
 * Checks that:
 * - Title is non-empty
 * - Title does not contain tool names
 * - Title uses business language
 */
function validateTaskTitle(title) {
    const errors = [];
    // Check non-empty
    if (!title || title.trim().length === 0) {
        errors.push('Task title must be non-empty');
    }
    // Check for tool names
    if (containsToolName(title)) {
        errors.push('Task title should not contain tool names (e.g., web_search, browser_use)');
    }
    // Check for business language
    if (!hasBusinessLanguage(title)) {
        errors.push('Task title should use business-focused language');
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Check if a title contains tool names
 */
function containsToolName(title) {
    const lowerTitle = title.toLowerCase();
    for (const toolName of TOOL_NAMES) {
        // Use word boundary matching to avoid false positives
        const regex = new RegExp(`\\b${toolName}\\b`, 'gi');
        if (regex.test(lowerTitle)) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a title uses business language
 */
function hasBusinessLanguage(title) {
    const businessKeywords = [
        'search',
        'find',
        'analyze',
        'generate',
        'create',
        'review',
        'validate',
        'process',
        'extract',
        'transform',
        'compile',
        'read',
        'write',
        'execute',
        'run',
        'browse',
        'fetch',
        'retrieve',
        'collect',
        'gather',
        'organize',
        'structure',
        'format',
        'parse',
        'convert',
        'build',
        'develop',
        'implement',
        'test',
        'verify',
        'check',
        'monitor',
        'track',
        'report',
        'summarize',
        'document',
        'prepare',
        'plan',
        'schedule',
        'manage',
        'handle',
        'process',
        'handle',
        'deal',
        'address',
        'resolve',
        'fix',
        'repair',
        'improve',
        'optimize',
        'enhance',
        'update',
        'modify',
        'adjust',
        'configure',
        'setup',
        'install',
        'deploy',
        'launch',
        'start',
        'stop',
        'pause',
        'resume',
        'restart',
        'reload',
        'refresh',
        'sync',
        'backup',
        'restore',
        'recover',
        'migrate',
        'transfer',
        'export',
        'import',
        'upload',
        'download',
        'share',
        'publish',
        'release',
        'distribute',
    ];
    const lowerTitle = title.toLowerCase();
    for (const keyword of businessKeywords) {
        if (lowerTitle.includes(keyword)) {
            return true;
        }
    }
    return false;
}
/**
 * Check if task titles are distinct
 */
function areTaskTitlesDistinct(tasks) {
    const titles = tasks.map((t) => t.title);
    const uniqueTitles = new Set(titles);
    return titles.length === uniqueTitles.size;
}
/**
 * Validate all task titles in a list
 */
function validateTaskTitles(tasks) {
    const errors = [];
    // Validate each task title
    for (const task of tasks) {
        const result = validateTaskTitle(task.title);
        if (!result.isValid) {
            errors.push({
                taskId: task.id,
                errors: result.errors,
            });
        }
    }
    // Check for distinct titles
    if (!areTaskTitlesDistinct(tasks)) {
        errors.push({
            taskId: 'all',
            errors: ['Task titles must be distinct (no duplicates)'],
        });
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Generate a business-focused task title from context
 */
function generateTaskTitle(context) {
    // Remove tool names from context
    let cleanedContext = context;
    for (const toolName of TOOL_NAMES) {
        const regex = new RegExp(`\\b${toolName}\\b`, 'gi');
        cleanedContext = cleanedContext.replace(regex, '');
    }
    // Clean up extra whitespace
    cleanedContext = cleanedContext.replace(/\s+/g, ' ').trim();
    // If context is empty, use a generic title
    if (cleanedContext.length === 0) {
        return 'Execute Task';
    }
    // Capitalize first letter
    return cleanedContext.charAt(0).toUpperCase() + cleanedContext.slice(1);
}
/**
 * Sanitize a task title to ensure it's business-focused
 */
function sanitizeTaskTitle(title) {
    // Remove tool names
    let sanitized = title;
    for (const toolName of TOOL_NAMES) {
        const regex = new RegExp(`\\b${toolName}\\b`, 'gi');
        sanitized = sanitized.replace(regex, '');
    }
    // Clean up extra whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    // If empty after sanitization, use original
    if (sanitized.length === 0) {
        return title.trim();
    }
    return sanitized;
}
