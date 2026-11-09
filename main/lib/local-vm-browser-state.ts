import { app, safeStorage } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { ALPINE_DISTRO } from '../agent/tools/alpine-vm';

const exec = promisify(execFile);
const cloneFile = () => path.join(app.getPath('userData'), 'vm', process.env.EVERFERN_SHELL === 'tauri' ? 'browser-cookies.native' : 'browser-cookies.bin');
let saving: Promise<void> | null = null;

// SQLite's backup API includes committed WAL changes while Chromium is running.
const exportScript = `
import base64, gzip, os, sqlite3, tempfile
p = '/root/.config/ef-chromium/Default/Cookies'
if not os.path.isfile(p):
    p = '/root/.config/ef-chromium/Default/Network/Cookies'
if os.path.isfile(p):
    fd, tmp = tempfile.mkstemp()
    os.close(fd)
    try:
        src = sqlite3.connect('file:' + p + '?mode=ro', uri=True, timeout=5)
        dst = sqlite3.connect(tmp)
        src.backup(dst)
        dst.close()
        src.close()
        with open(tmp, 'rb') as f:
            print(base64.b64encode(gzip.compress(f.read())).decode())
    finally:
        os.unlink(tmp)
`;

/** An encrypted host copy survives deleting/reinstalling the local Alpine VM. */
export function saveLocalVmBrowserState(): Promise<void> {
  if (saving) return saving;
  saving = (async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    const { stdout } = await exec('wsl.exe', ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', 'python3', '-c', exportScript],
      { windowsHide: true, timeout: 15_000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' });
    const data = stdout.trim();
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return;
    const file = cloneFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, safeStorage.encryptString(data));
    fs.renameSync(`${file}.tmp`, file);
  })().catch(() => { /* Keep the previous clone when the VM is unavailable. */ }).finally(() => { saving = null; });
  return saving;
}

/** Only a fresh profile is seeded. Existing cookies (including explicit logouts) win. */
export async function restoreLocalVmBrowserState(): Promise<void> {
  if (!fs.existsSync(cloneFile()) || !safeStorage.isEncryptionAvailable()) return;
  const data = safeStorage.decryptString(fs.readFileSync(cloneFile()));
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return;
  // Send the potentially large clone over stdin instead of the process command line.
  const script = `
import base64, gzip, os, sys
root = '/root/.config/ef-chromium/Default'
if not any(os.path.exists(root + '/' + p) for p in ('Cookies', 'Network/Cookies')):
    raw = gzip.decompress(base64.b64decode(sys.stdin.read()))
    if not raw.startswith(b'SQLite format 3\\x00'):
        raise ValueError('Invalid cookie clone')
    os.makedirs(root, exist_ok=True)
    with open(root + '/Cookies.tmp', 'wb') as f:
        f.write(raw)
    os.replace(root + '/Cookies.tmp', root + '/Cookies')
`;
  const { spawn } = await import('child_process');
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('wsl.exe', ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', 'python3', '-c', script],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Cookie restore timed out')); }, 15_000);
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.stdin.on('error', () => { /* Exit status below reports a failed restore. */ });
    proc.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Cookie restore failed')); });
    proc.stdin.end(data);
  });
}
