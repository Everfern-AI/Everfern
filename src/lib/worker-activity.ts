/** Conversation activity is independent of whether its saved workflow is paused. */
export function isWorkerChatBusy(messages: readonly { kind: string; live?: boolean; streaming?: boolean }[]): boolean {
  return messages.some(message => message.kind === 'thinking'
    || (message.kind === 'reason' && message.live === true)
    || (message.kind === 'ai' && message.streaming === true));
}
