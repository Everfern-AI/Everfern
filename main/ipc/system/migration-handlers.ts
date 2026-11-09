import { app, ipcMain, safeStorage } from 'electron';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Included in the final Electron bridge release before the framework switch. */
export function registerMigrationHandlers(): void {
  ipcMain.handle('system:export-tauri-migration', (_event, storage: Record<string, string>) => {
    const source = _event.senderFrame?.url || '';
    if (!source.startsWith('everfern-app://') && !/^http:\/\/(localhost|127\.0\.0\.1):3001\//.test(source)) return { success: false };
    if (process.env.EVERFERN_SHELL === 'tauri' || process.platform !== 'win32') return { success: false };
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'everfern.exe')
      : path.join(app.getAppPath(), 'src-tauri', 'target', 'debug', 'everfern.exe');
    if (!fs.existsSync(executable)) return { success: false, error: 'Migration helper is not bundled' };
    if (!storage || typeof storage !== 'object' || Object.values(storage).some(v => typeof v !== 'string')) return { success: false };
    const bytes = Buffer.from(JSON.stringify(storage));
    if (bytes.length > 30 * 1024 * 1024) return { success: false };
    const root = app.getPath('userData');
    const save = (file: string, plaintext: Buffer) => {
      const encrypted = execFileSync(executable, ['--ef-encrypt'], { input: plaintext, windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
      fs.writeFileSync(file + '.tmp', Buffer.concat([Buffer.from('EFDPAPI1'), encrypted]));
      fs.renameSync(file + '.tmp', file);
    };
    try {
      const localClone = path.join(root, 'vm', 'browser-cookies.bin');
      if (fs.existsSync(localClone) && safeStorage.isEncryptionAvailable()) {
        const plaintext = safeStorage.decryptString(fs.readFileSync(localClone));
        save(path.join(root, 'vm', 'browser-cookies.native'), Buffer.from(plaintext));
      }
      const directory = path.join(root, 'cloud-browser');
      if (fs.existsSync(directory) && safeStorage.isEncryptionAvailable()) {
        for (const name of fs.readdirSync(directory)) {
          if (!/^[A-Za-z0-9_.-]+\.bin$/.test(name)) continue;
          try {
            const raw = fs.readFileSync(path.join(directory, name));
            const text = safeStorage.decryptString(raw);
            JSON.parse(text);
            save(path.join(directory, name.replace(/\.bin$/, '.native')), Buffer.from(text));
          } catch { /* Preserve unreadable source clones for recovery. */ }
        }
      }
      // Publish readiness only after the dependent profile exports finish.
      save(path.join(root, 'renderer-migration.native'), bytes);
      return { success: true };
    } catch { return { success: false, error: 'Could not export encrypted migration data' }; }
  });
}
