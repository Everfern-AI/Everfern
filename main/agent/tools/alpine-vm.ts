import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * EverFern's Linux VM: one Alpine Linux distro that workers (and the apps they
 * open) run in. On Windows it is a WSL 2 distro imported from Alpine's official
 * minirootfs, so it needs no Microsoft Store and no Ubuntu. On macOS it is a
 * Docker container built from the alpine image.
 */
export const ALPINE_DISTRO = 'EverFern-Alpine';
export const ALPINE_CONTAINER = 'everfern-alpine';
export const ALPINE_HOME = '/root';

const ALPINE_CDN = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases';

/** Packages a worker needs. The first group must install; the rest are best effort. */
export const ALPINE_CORE_PACKAGES = [
  'bash', 'coreutils', 'findutils', 'grep', 'sed', 'gawk', 'tar', 'xz', 'zip', 'unzip',
  'ca-certificates', 'curl', 'wget', 'git', 'jq', 'openssh-client', 'tzdata',
  'python3', 'py3-pip', 'python3-dev', 'nodejs', 'npm', 'build-base', 'libffi-dev', 'openssl-dev',
];

/** The worker's desktop: XFCE on a virtual screen, streamed to EverFern over noVNC. */
export const ALPINE_DESKTOP_PACKAGES = [
  'xfce4', 'xfce4-terminal', 'adwaita-icon-theme', 'xvfb', 'x11vnc', 'novnc', 'websockify',
  'dbus', 'dbus-x11', 'xdotool', 'setxkbmap', 'xrandr', 'mesa-dri-gallium',
];

export const ALPINE_EXTRA_PACKAGES = [
  // Python data / document stack from apk, so nothing heavy compiles under musl.
  'py3-numpy', 'py3-pandas', 'py3-matplotlib', 'py3-pillow', 'py3-lxml', 'py3-requests',
  'py3-beautifulsoup4', 'py3-reportlab', 'py3-openpyxl', 'py3-cryptography', 'py3-cffi',
  // Document and media tools.
  'pandoc-cli', 'poppler-utils', 'tesseract-ocr', 'tesseract-ocr-data-eng', 'imagemagick', 'ffmpeg',
  'pango', 'libreoffice',
  // Apps: a browser and fonts so pages and documents render properly.
  'chromium', 'chromium-chromedriver', 'nss', 'font-noto', 'font-noto-emoji', 'ttf-dejavu', 'fontconfig',
  ...ALPINE_DESKTOP_PACKAGES,
];

type Log = (message: string, level?: 'info' | 'success' | 'warn' | 'error') => void;

function wslCmd(): string {
  return 'wsl.exe';
}

function decode(out: Buffer | string): string {
  if (typeof out === 'string') return out.replace(/\0/g, '');
  const utf16 = (out.length >= 2 && out[0] === 0xff && out[1] === 0xfe) || (out.length > 3 && out[1] === 0 && out[3] === 0);
  return out.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').replace(/\0/g, '');
}

/** True once the EverFern-Alpine distro is registered with WSL. */
export async function isAlpineInstalled(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execFileAsync(wslCmd(), ['--list', '--quiet'], { encoding: 'buffer', timeout: 8000 } as any) as any;
    return decode(stdout).split(/[\r\n]+/).some((n) => n.trim().toLowerCase() === ALPINE_DISTRO.toLowerCase());
  } catch {
    return false;
  }
}

function vmDir(): string {
  let base: string;
  try {
    base = require('electron').app.getPath('userData');
  } catch {
    base = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(), 'EverFern');
  }
  return path.join(base, 'vm');
}

function alpineArch(): string {
  return process.arch === 'arm64' ? 'aarch64' : 'x86_64';
}

/** Finds the current minirootfs release from Alpine's own release index. */
async function resolveMinirootfs(): Promise<{ url: string; file: string; sha256: string }> {
  const arch = alpineArch();
  const res = await fetch(`${ALPINE_CDN}/${arch}/latest-releases.yaml`);
  if (!res.ok) throw new Error(`Alpine release index returned ${res.status}`);
  const yaml = await res.text();
  const block = yaml.split(/\n-\s*\n|\n-\s/).find((b) => /flavor:\s*alpine-minirootfs/.test(b));
  const file = block?.match(/file:\s*(\S+)/)?.[1];
  const sha256 = block?.match(/sha256:\s*([a-f0-9]{64})/)?.[1];
  if (!file || !sha256) throw new Error('Could not find the Alpine minirootfs in the release index');
  return { url: `${ALPINE_CDN}/${arch}/${file}`, file, sha256 };
}

function isWslMissing(msg: string): boolean {
  return /0x8007019e|0x80370102|0x8004032d|not installed|virtual machine platform|wsl --install|enable the virtual/i.test(msg);
}

/**
 * Imports Alpine as a WSL 2 distro. If WSL itself is not on the machine, asks
 * Windows (with a UAC prompt) to enable it and reports that a restart is needed.
 */
export async function installAlpineVM(log: Log = () => {}): Promise<{ success: boolean; needsRestart?: boolean; error?: string }> {
  if (process.platform !== 'win32') return { success: false, error: 'Alpine WSL install is only for Windows' };
  if (await isAlpineInstalled()) return { success: true };

  const dir = vmDir();
  const diskDir = path.join(dir, ALPINE_DISTRO);
  fs.mkdirSync(diskDir, { recursive: true });

  try {
    log('Finding the latest Alpine Linux release...');
    const rel = await resolveMinirootfs();
    const tarPath = path.join(dir, rel.file);

    let have = fs.existsSync(tarPath) && crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex') === rel.sha256;
    if (!have) {
      log(`Downloading ${rel.file}...`);
      const res = await fetch(rel.url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sum = crypto.createHash('sha256').update(buf).digest('hex');
      if (sum !== rel.sha256) throw new Error('Downloaded Alpine image failed its checksum');
      fs.writeFileSync(tarPath, buf);
    }

    log('Creating the Alpine VM...');
    try {
      await execFileAsync(wslCmd(), ['--import', ALPINE_DISTRO, diskDir, tarPath, '--version', '2'], { timeout: 180000 });
    } catch (e: any) {
      const msg = decode(e?.stdout || '') + decode(e?.stderr || '') + (e?.message || '');
      if (!isWslMissing(msg)) throw new Error(msg.trim() || 'wsl --import failed');
      log('WSL is not enabled on this PC. Asking Windows to turn it on...', 'warn');
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
        "Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait"], { timeout: 600000 }).catch(() => {});
      try {
        await execFileAsync(wslCmd(), ['--import', ALPINE_DISTRO, diskDir, tarPath, '--version', '2'], { timeout: 180000 });
      } catch {
        return { success: false, needsRestart: true, error: 'Restart Windows to finish turning on WSL, then set up the VM again.' };
      }
    }

    // Keep the VM self-contained: root user, no Windows PATH leaking in.
    const wslConf = '[user]\\ndefault=root\\n\\n[interop]\\nappendWindowsPath=false\\n\\n[network]\\nhostname=everfern\\n';
    await execFileAsync(wslCmd(), ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', '/bin/sh', '-c', `printf '${wslConf}' > /etc/wsl.conf`], { timeout: 30000 }).catch(() => {});
    await execFileAsync(wslCmd(), ['--terminate', ALPINE_DISTRO], { timeout: 15000 }).catch(() => {});
    log('Alpine VM created.', 'success');
    return { success: true };
  } catch (e: any) {
    const error = e?.message || String(e);
    log(`Alpine VM install failed: ${error}`, 'error');
    return { success: false, error };
  }
}

/**
 * POSIX sh (Alpine has no bash until this runs) that installs every package and
 * the ~/.everfern Python venv and Node modules. Safe to run again.
 */
export function alpineProvisionScript(pythonDeps: string, nodeDeps: string): string {
  const core = ALPINE_CORE_PACKAGES.join(' ');
  const extra = ALPINE_EXTRA_PACKAGES.join(' ');
  return `
set -u
REL=$(cut -d. -f1,2 /etc/alpine-release 2>/dev/null)
if [ -n "$REL" ] && ! grep -q '/community' /etc/apk/repositories 2>/dev/null; then
  echo "https://dl-cdn.alpinelinux.org/alpine/v$REL/community" >> /etc/apk/repositories
fi
echo "STEP Updating package index"
apk update -q || exit 10
echo "STEP Installing core tools"
apk add -q ${core} || exit 11
echo "STEP Installing document, media and app packages"
if ! apk add -q ${extra}; then
  for p in ${extra}; do apk add -q "$p" >/dev/null 2>&1 || echo "SKIP $p"; done
fi
mkdir -p "$HOME/.everfern/workspace" "$HOME/.everfern/exec" "$HOME/.everfern/artifacts"
echo "STEP Creating Python environment"
if [ ! -x "$HOME/.everfern/venv/bin/python" ]; then
  python3 -m venv --system-site-packages "$HOME/.everfern/venv" || exit 12
fi
"$HOME/.everfern/venv/bin/python" -m pip install -q --disable-pip-version-check --upgrade pip >/dev/null 2>&1 || true
"$HOME/.everfern/venv/bin/python" -m pip install -q --disable-pip-version-check ${pythonDeps} || echo "WARN some Python packages failed"
echo "STEP Installing Node packages"
cd "$HOME/.everfern" || exit 13
[ -f package.json ] || npm init -y >/dev/null 2>&1
npm install ${nodeDeps} --no-audit --no-fund -q >/dev/null 2>&1 || echo "WARN some Node packages failed"
if command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  ln -sf "$(command -v chromium-browser)" /usr/local/bin/chromium
fi
echo "DONE"
`.trim();
}

/** Runs the provisioning script as root and streams its progress lines to log. */
export function provisionAlpine(script: string, log: Log, target: 'wsl' | 'docker'): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, args] = target === 'wsl'
      ? [wslCmd(), ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', '/bin/sh', '-c', script]]
      : ['docker', ['exec', '-u', 'root', ALPINE_CONTAINER, '/bin/sh', '-c', script]];
    const proc = spawn(cmd as string, args as string[], { shell: false, env: { ...process.env, WSL_UTF8: '1', WSLENV: '' } });
    let buf = '';
    const onData = (d: Buffer) => {
      buf += decode(d);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('STEP ')) log(`${line.slice(5)}...`);
        else if (line.startsWith('SKIP ')) log(`Skipped unavailable package ${line.slice(5)}`, 'warn');
        else if (line.startsWith('WARN ')) log(line.slice(5), 'warn');
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', (d: Buffer) => {
      const t = decode(d).trim();
      if (t && /error|failed|unable/i.test(t)) log(t.split('\n').slice(-1)[0], 'warn');
    });
    const timer = setTimeout(() => proc.kill(), 30 * 60 * 1000);
    proc.on('close', (code) => { clearTimeout(timer); resolve(code ?? -1); });
    proc.on('error', () => { clearTimeout(timer); resolve(-1); });
  });
}

/**
 * POSIX sh that runs the worker's desktop in the foreground: XFCE on a virtual
 * X screen, x11vnc on it (loopback only, password protected) and noVNC served
 * by websockify. WSL forwards the loopback port to Windows, so EverFern can show
 * the desktop at http://127.0.0.1:<webPort>/vnc.html. Prints
 * `DESKTOP_READY <webPort> <password>` once it is up, and stops everything when
 * the wsl.exe process that runs it ends.
 */
export function alpineDesktopScript(opts: { display?: number; width?: number; height?: number; webPort?: number; password: string }): string {
  const d = opts.display ?? 1;
  const w = opts.width ?? 1440;
  const h = opts.height ?? 900;
  const web = opts.webPort ?? 16080;
  const vnc = 5900 + d;
  const pw = opts.password.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return `
set -u
# WSLg points apps at its own Wayland/X display; keep everything on our virtual screen.
unset WAYLAND_DISPLAY PULSE_SERVER XDG_SESSION_TYPE
export DISPLAY=:${d} HOME=/root XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR" /root/.vnc && chmod 700 "$XDG_RUNTIME_DIR"
# Match by process name: a -f pattern would also match this script's own command line.
pkill -x Xvfb 2>/dev/null; pkill -x x11vnc 2>/dev/null; pkill -f 'python3? .*/websockify' 2>/dev/null; pkill -x xfce4-session 2>/dev/null
rm -f /tmp/.X${d}-lock /tmp/.X11-unix/X${d} 2>/dev/null
Xvfb :${d} -screen 0 ${w}x${h}x24 -nolisten tcp >/tmp/ef-xvfb.log 2>&1 &
XPID=$!
# Under WSLg /tmp/.X11-unix is a read-only mount, so Xvfb only gets its abstract
# socket. Ask the server itself whether it is up rather than looking for the file.
i=0; until xdotool getdisplaygeometry >/dev/null 2>&1 || [ $i -ge 50 ]; do sleep 0.2; i=$((i+1)); done
xdotool getdisplaygeometry >/dev/null 2>&1 || { echo "DESKTOP_ERROR Xvfb did not start"; exit 20; }
dbus-launch --exit-with-session startxfce4 >/tmp/ef-xfce.log 2>&1 &
x11vnc -storepasswd '${pw}' /root/.vnc/passwd >/dev/null 2>&1
x11vnc -display :${d} -rfbport ${vnc} -localhost -rfbauth /root/.vnc/passwd -forever -shared -noxdamage -quiet >/tmp/ef-x11vnc.log 2>&1 &
NOVNC=/usr/share/novnc; [ -d "$NOVNC" ] || NOVNC=/usr/share/webapps/novnc
websockify --web "$NOVNC" 127.0.0.1:${web} 127.0.0.1:${vnc} >/tmp/ef-websockify.log 2>&1 &
i=0; while ! nc -z 127.0.0.1 ${web} 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done
echo "DESKTOP_READY ${web} ${pw}"
trap 'kill 0' INT TERM HUP
wait $XPID
`.trim();
}

/** Starts the desktop and resolves with the noVNC URL. Kill the returned process to stop it. */
export function startAlpineDesktop(opts: { webPort?: number } = {}): Promise<{ url: string; password: string; proc: ReturnType<typeof spawn> }> {
  const password = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
  const script = alpineDesktopScript({ password, webPort: opts.webPort });
  const proc = spawn(wslCmd(), ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', '/bin/sh', '-c', script], {
    shell: false, windowsHide: true, env: { ...process.env, WSL_UTF8: '1', WSLENV: '' },
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('The VM desktop did not start in time')); }, 60000);
    proc.stdout?.on('data', (b: Buffer) => {
      out += decode(b);
      const ready = out.match(/DESKTOP_READY (\d+) (\S+)/);
      const failed = out.match(/DESKTOP_ERROR (.+)/);
      if (ready) {
        clearTimeout(timer);
        const port = ready[1];
        resolve({ url: `http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale&reconnect=1&quality=8&compression=0&show_dot=1&password=${ready[2]}`, password: ready[2], proc });
      } else if (failed) {
        clearTimeout(timer);
        proc.kill();
        reject(new Error(failed[1]));
      }
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); reject(new Error(`VM desktop exited (${code})`)); });
  });
}


/**
 * Shows `url` in Chromium on the VM desktop (display :1): a new tab when Chromium is
 * already open, otherwise a new maximized window. The URL is passed as an argument,
 * never spliced into the script.
 */
export function openAlpineBrowser(url: string, display = 1): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve();
  const script = [
    `export DISPLAY=:${display} HOME=/root`,
    'unset WAYLAND_DISPLAY',
    'B=$(command -v chromium || command -v chromium-browser)',
    '[ -n "$B" ] || exit 0',
    // Upgrade an already running VM browser to DevTools control without touching the host browser.
    'python3 -c "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:19222/json/version\', timeout=2)" >/dev/null 2>&1 || { pkill -f "^[^ ]*chrom[^ ]* .*--user-data-dir=/root/.config/ef-chromium" 2>/dev/null || true; sleep 1; }',
    'F="--no-sandbox --test-type --no-first-run --no-default-browser-check --start-maximized --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port=19222 --user-data-dir=/root/.config/ef-chromium"',
    'setsid nohup "$B" $F "$1" >>/tmp/ef-browser.log 2>&1 &',
    'i=0; until python3 -c "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:19222/json/version\', timeout=1)" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 40 ] || exit 21; sleep 0.25; done',
  ].join('\n') + '\n';
  return new Promise((resolve, reject) => {
    const p = spawn(wslCmd(), ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', '/bin/sh', '-c', script, 'sh', url], {
      shell: false, windowsHide: true, env: { ...process.env, WSL_UTF8: '1', WSLENV: '' },
    });
    const timer = setTimeout(() => { p.kill(); reject(new Error('The Alpine browser did not start in time')); }, 20_000);
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('The browser inside Alpine could not start')); });
    p.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
