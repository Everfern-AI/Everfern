import { ChatMessage } from '../../../lib/ai-client';

/**
 * Normalizes a LangChain or internal message object into a standard ChatMessage.
 */
export function normalizeMessage(m: any): ChatMessage {
  // If it's already a standard ChatMessage plain object with role
  if (m.role && (m.content !== undefined)) {
    return {
      role: m.role,
      content: m.content,
      name: m.name || (m as any).tool_name || (m as any).toolName,
      tool_call_id: m.tool_call_id || (m as any).toolCallId,
      tool_calls: m.tool_calls || (m as any).toolCalls,
      reasoning_content: m.reasoning_content || (m as any).thought
    };
  }

  // Handle LangChain message objects or other formats
  let role: 'system' | 'user' | 'assistant' | 'tool' = 'user';
  const type = m.type || m._getType?.();

  if (type === 'human') role = 'user';
  else if (type === 'ai') role = 'assistant';
  else if (type === 'system') role = 'system';
  else if (type === 'tool') role = 'tool';
  else if (m.role === 'user') role = 'user';
  else if (m.role === 'assistant') role = 'assistant';
  else if (m.role === 'system') role = 'system';
  else if (m.role === 'tool') role = 'tool';

  return {
    role,
    content: m.content || '',
    name: m.name || (m as any).tool_name || (m as any).toolName,
    tool_call_id: m.tool_call_id || (m as any).tool_call_id || (m as any).toolCallId,
    tool_calls: m.tool_calls || (m as any).tool_calls || (m as any).toolCalls,
    reasoning_content: m.reasoning_content || (m as any).reasoning_content || (m as any).thought
  };
}

/**
 * Normalizes an array of messages.
 */
export function normalizeMessages(messages: any[]): ChatMessage[] {
  return messages.map(normalizeMessage);
}
