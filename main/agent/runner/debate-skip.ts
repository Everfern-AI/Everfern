const skippedDebates = new Set<string>();
const skipWaiters = new Map<string, Set<() => void>>();

export function requestDebateSkip(debateId: string): boolean {
  if (!debateId) return false;

  skippedDebates.add(debateId);
  const waiters = skipWaiters.get(debateId);
  if (waiters) {
    for (const resolve of waiters) resolve();
    skipWaiters.delete(debateId);
  }

  return true;
}

export function isDebateSkipped(debateId: string): boolean {
  return skippedDebates.has(debateId);
}

export function waitForDebateSkip(debateId: string): Promise<void> {
  if (skippedDebates.has(debateId)) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const waiters = skipWaiters.get(debateId) ?? new Set<() => void>();
    waiters.add(resolve);
    skipWaiters.set(debateId, waiters);
  });
}

export function clearDebateSkip(debateId: string): void {
  skippedDebates.delete(debateId);
  skipWaiters.delete(debateId);
}
