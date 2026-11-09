/** A compact, readable preview of the latest assistant reply, never a user prompt. */
export function latestAssistantPreview(messages: readonly { kind: string; text?: string }[]): string | null {
  const message = [...messages].reverse().find(item => item.kind === 'ai' && item.text?.trim());
  if (!message?.text) return null;
  const text = message.text
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`/g, '$1$2$3')
    .replace(/\s+/g, ' ').trim();
  return text || null;
}

const LANDSCAPES = ['/images/worker-landscape.jpg', '/images/worker-misty-lake.jpg', '/images/worker-dunes.jpg'];
/** Stable per-worker imagery, including after an app restart. */
export function workerLandscape(id: string): string {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return LANDSCAPES[hash % LANDSCAPES.length];
}
