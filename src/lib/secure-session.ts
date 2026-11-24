/**
 * Where the EverFern Cloud sign-in lives. In the desktop app it is kept encrypted by the
 * main process (OS keychain) and never in localStorage; in a plain browser (web dev) it
 * falls back to localStorage. Same getItem / setItem / removeItem shape as localStorage,
 * so callers only change the object they talk to.
 */
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): unknown; removeItem(key: string): unknown };

export const SESSION_KEYS = ['everfern_cloud_session', 'everfern_auth_token'] as const;

function native(): Store | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).electronAPI?.secureSession as Store | undefined) ?? null;
}

let migrated = false;
/** Moves a sign-in left in localStorage by an older version into the encrypted store, once. */
function migrate(store: Store) {
  if (migrated) return;
  migrated = true;
  try {
    for (const key of SESSION_KEYS) {
      const old = localStorage.getItem(key);
      if (old === null) continue;
      if (store.getItem(key) === null) void store.setItem(key, old);
      localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

const fallback: Store = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or unavailable */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* unavailable */ } },
};

function store(): Store {
  const n = native();
  if (!n) return fallback;
  migrate(n);
  return n;
}

export const secureSession = {
  getItem: (key: string): string | null => store().getItem(key),
  setItem: (key: string, value: string): void => { void store().setItem(key, value); },
  removeItem: (key: string): void => { void store().removeItem(key); },
};
