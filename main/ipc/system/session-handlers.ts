/**
 * Keeps the EverFern Cloud sign-in (access and refresh tokens) encrypted with the OS keychain,
 * instead of in the page's localStorage where any script in the renderer could read it
 * and it sat on disk in plain text.
 *
 * The renderer gets its copy once, synchronously, from the preload script (so screens that
 * read the session on their first render still see it), and writes changes back here.
 */
import { app, ipcMain, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** The only keys this store holds. */
const KEYS = new Set(['everfern_cloud_session', 'everfern_auth_token']);
const MAX_VALUE = 64 * 1024;

type Values = Record<string, string>;

const file = () => path.join(app.getPath('userData'), 'cloud-session.bin');
let cache: Values | null = null;

function load(): Values {
  if (cache) return cache;
  cache = {};
  try {
    if (fs.existsSync(file()) && safeStorage.isEncryptionAvailable()) {
      const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
      for (const [k, v] of Object.entries(parsed ?? {})) if (KEYS.has(k) && typeof v === 'string') cache[k] = v;
    }
  } catch (e) {
    console.warn('[Session] Could not read the saved sign-in; you may need to sign in again.', e);
  }
  return cache;
}

function persist(values: Values): void {
  // Without the OS keychain the sign-in lasts until EverFern closes; it is never written in plain text.
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(values)), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (e) {
    console.warn('[Session] Could not save the sign-in.', e);
  }
}

export function registerSessionHandlers(): void {
  // Synchronous on purpose: the preload script needs the values before the page's first render.
  ipcMain.on('secure-session:load', (event) => {
    event.returnValue = { ...load() };
  });

  ipcMain.handle('secure-session:set', (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !KEYS.has(key)) return { success: false, error: 'Unknown key.' };
    const values = load();
    if (value === null || value === undefined) delete values[key];
    else if (typeof value === 'string' && value.length <= MAX_VALUE) values[key] = value;
    else return { success: false, error: 'Value too large or not text.' };
    persist(values);
    return { success: true };
  });
}
