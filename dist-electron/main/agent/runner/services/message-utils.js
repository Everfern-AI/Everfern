"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMessage = normalizeMessage;
exports.normalizeMessages = normalizeMessages;
/**
 * Normalizes a LangChain or internal message object into a standard ChatMessage.
 */
function normalizeMessage(m) {
    // If it's already a standard ChatMessage plain object with role
    if (m.role && (m.content !== undefined)) {
        return {
            role: m.role,
            content: m.content,
            name: m.name || m.tool_name || m.toolName,
            tool_call_id: m.tool_call_id || m.toolCallId,
            tool_calls: m.tool_calls || m.toolCalls,
            reasoning_content: m.reasoning_content || m.thought
        };
    }
    // Handle LangChain message objects or other formats
    let role = 'user';
    const type = m.type || m._getType?.();
    if (type === 'human')
        role = 'user';
    else if (type === 'ai')
        role = 'assistant';
    else if (type === 'system')
        role = 'system';
    else if (type === 'tool')
        role = 'tool';
    else if (m.role === 'user')
        role = 'user';
    else if (m.role === 'assistant')
        role = 'assistant';
    else if (m.role === 'system')
        role = 'system';
    else if (m.role === 'tool')
        role = 'tool';
    return {
        role,
        content: m.content || '',
        name: m.name || m.tool_name || m.toolName,
        tool_call_id: m.tool_call_id || m.tool_call_id || m.toolCallId,
        tool_calls: m.tool_calls || m.tool_calls || m.toolCalls,
        reasoning_content: m.reasoning_content || m.reasoning_content || m.thought
    };
}
/**
 * Normalizes an array of messages.
 */
function normalizeMessages(messages) {
    return messages.map(normalizeMessage);
}
