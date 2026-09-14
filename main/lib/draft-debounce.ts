// AI-ARCH-01: trailing-idle debouncer that coalesces draft autosave writes
// during streaming (at most one save per idle window instead of one per chunk).
export interface DraftSaveDebouncer {
  schedule(): void;
  cancel(): void;
}

const WARN_EVERY_MS = 10_000;

export function createDraftSaveDebouncer(
  saveFn: () => Promise<void> | void,
  intervalMs = 600,
): DraftSaveDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWarnAt = -WARN_EVERY_MS;

  const warnRateLimited = (err: unknown) => {
    const now = Date.now();
    if (now - lastWarnAt >= WARN_EVERY_MS) {
      lastWarnAt = now;
      console.warn('[DraftSave] Debounced draft save failed:', err);
    }
  };

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          Promise.resolve(saveFn()).catch(warnRateLimited);
        } catch (err) {
          warnRateLimited(err);
        }
      }, intervalMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
