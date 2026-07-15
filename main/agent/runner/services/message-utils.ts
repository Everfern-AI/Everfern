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
 * Normalizes an array of messages, filtering out narrative messages.
 * Narrative messages are system messages marked with isNarrative=true
 * and should not be sent to the AI model.
 */
export function normalizeMessages(messages: any[]): ChatMessage[] {
  const normalized = messages
    .filter(m => {
      // Filter out narrative messages - they're for UI display only
      const metadata = m.metadata || (m as any)._metadata;
      if (metadata?.isNarrative === true) {
        console.debug(`[MessageUtils] Filtering out narrative message: ${m.content?.substring(0, 50)}`);
        return false;
      }
      return true;
    })
    .map(normalizeMessage);

  return consolidateHistory(normalized);
}

/**
 * Cognitive History Consolidation (CHC)
 * 
 * 1. Truncates long successful terminal/command logs (>2,000 chars) while preserving errors.
 * 2. Prunes dead-end tool call retries once a later turn succeeds, replacing them with
 *    a system-level memory consolidation note to conserve context budget.
 */
export function consolidateHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;

  const consolidated: ChatMessage[] = [];
  
  // Task 1: Truncate large tool outputs
  const processed = messages.map(msg => {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      const toolName = msg.name || '';
      const isTerminalTool = ['run_command', 'terminal_execute', 'executePwsh', 'command_status'].includes(toolName);
      
      if (isTerminalTool && msg.content.length > 2000) {
        const originalLength = msg.content.length;
        const lowerContent = msg.content.toLowerCase();
        
        const hasError = lowerContent.includes('error') || 
                         lowerContent.includes('failed') || 
                         lowerContent.includes('exception') ||
                         lowerContent.includes('exit code: 1') ||
                         lowerContent.includes('exit code: 2');
                         
        if (!hasError) {
          // Success output - keep first 600 and last 600 characters
          const firstPart = msg.content.slice(0, 600);
          const lastPart = msg.content.slice(-600);
          return {
            ...msg,
            content: `${firstPart}\n\n... [Truncated ${originalLength - 1200} characters of successful output logs] ...\n\n${lastPart}`
          };
        } else if (msg.content.length > 8000) {
          // Failure output, but extremely long - keep first 1000 and last 3000 (errors are usually at the bottom)
          const firstPart = msg.content.slice(0, 1000);
          const lastPart = msg.content.slice(-3000);
          return {
            ...msg,
            content: `${firstPart}\n\n... [Truncated ${originalLength - 4000} characters of long error logs] ...\n\n${lastPart}`
          };
        }
      }
    }
    return msg;
  });

  // Task 2: Collapse failed tool call retries when a later one succeeds
  let i = 0;
  while (i < processed.length) {
    const msg = processed[i];
    
    // Check if this is an assistant message with tool calls
    if (
      msg.role === 'assistant' && 
      msg.tool_calls && 
      msg.tool_calls.length === 1 && 
      i + 1 < processed.length && 
      processed[i + 1].role === 'tool'
    ) {
      const toolCall = msg.tool_calls[0];
      const toolName = toolCall.name;
      const toolResult = processed[i + 1];
      
      // Check if this tool run was a failure
      const isFailure = toolResult.content && 
                        typeof toolResult.content === 'string' && 
                        (toolResult.content.toLowerCase().includes('failed') || 
                         toolResult.content.toLowerCase().includes('error') ||
                         toolResult.content.toLowerCase().includes('exit code: 1'));
                         
      if (isFailure) {
        // Look ahead to see if there is a later successful run of the SAME tool
        let foundSuccessIndex = -1;
        let scanIndex = i + 2;
        
        while (scanIndex < processed.length) {
          const nextMsg = processed[scanIndex];
          if (
            nextMsg.role === 'assistant' && 
            nextMsg.tool_calls && 
            nextMsg.tool_calls.length === 1 && 
            nextMsg.tool_calls[0].name === toolName &&
            scanIndex + 1 < processed.length &&
            processed[scanIndex + 1].role === 'tool'
          ) {
            const nextResult = processed[scanIndex + 1];
            const nextIsFailure = nextResult.content && 
                                  typeof nextResult.content === 'string' && 
                                  (nextResult.content.toLowerCase().includes('failed') || 
                                   nextResult.content.toLowerCase().includes('error') ||
                                   nextResult.content.toLowerCase().includes('exit code: 1'));
            if (!nextIsFailure) {
              foundSuccessIndex = scanIndex;
              break;
            }
          }
          scanIndex++;
        }
        
        if (foundSuccessIndex !== -1) {
          const retriesCount = (foundSuccessIndex - i) / 2;
          consolidated.push({
            role: 'system',
            content: `[System Memory Consolidation: ${retriesCount} intermediate attempts of tool "${toolName}" failed with errors before succeeding. Failed logs collapsed to preserve context budget.]`
          });
          
          // Skip to the successful run
          i = foundSuccessIndex;
          continue;
        }
      }
    }
    
    consolidated.push(msg);
    i++;
  }

  return consolidated;
}
