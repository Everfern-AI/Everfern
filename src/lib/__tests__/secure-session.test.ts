import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { delete (window as any).electronAPI; localStorage.clear(); vi.resetModules(); });

it('moves an old localStorage sign-in into the encrypted store and keeps it out of localStorage (audit 21)', async () => {
  const values: Record<string, string> = {};
  (window as any).electronAPI = { secureSession: {
    getItem: (k: string) => values[k] ?? null,
    setItem: vi.fn(async (k: string, v: string) => { values[k] = v; }),
    removeItem: vi.fn(async (k: string) => { delete values[k]; }),
  } };
  localStorage.setItem('everfern_cloud_session', '{"accessToken":"old"}');
  const { secureSession } = await import('../secure-session');
  expect(secureSession.getItem('everfern_cloud_session')).toBe('{"accessToken":"old"}');
  expect(localStorage.getItem('everfern_cloud_session')).toBeNull();
  secureSession.setItem('everfern_auth_token', 'new');
  expect(values.everfern_auth_token).toBe('new');
  expect(localStorage.getItem('everfern_auth_token')).toBeNull();
});

it('uses localStorage outside the desktop app', async () => {
  const { secureSession } = await import('../secure-session');
  secureSession.setItem('everfern_auth_token', 'web');
  expect(localStorage.getItem('everfern_auth_token')).toBe('web');
});
