import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { warnOnceEnvKeyFallback } from '../../lib/env-key-fallback';

export function getOllamaBinary(): string {
  const isWin = process.platform === 'win32';
  if (isWin) {
    const home = os.homedir();
    const ollamaPath = path.join(home, 'AppData', 'Local', 'Programs', 'ollama', 'ollama.exe');
    if (fs.existsSync(ollamaPath)) return ollamaPath;
    return 'ollama';
  }
  const isMac = process.platform === 'darwin';
  if (isMac) {
    const siliconPath = '/opt/homebrew/bin/ollama';
    const intelPath = '/usr/local/bin/ollama';
    if (fs.existsSync(siliconPath)) return siliconPath;
    if (fs.existsSync(intelPath)) return intelPath;
    return 'ollama';
  }
  const linuxPaths = ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'ollama';
}

// Allow-list terminal-bound identifiers: blocks shell metacharacter injection
// through titles and model tags coming from the renderer.
function isSafeTerminalText(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9 ._:\/\\-]{0,80}$/.test(value);
}

/**
 * MP-SEC-20: pinned Ollama installer sources.
 *
 * ollama.com does not publish immutable SHA256 digests for its rolling
 * install scripts (install.sh / install.ps1), and no versioned artifact
 * URL exists for them — the only published URLs are the rolling ones.
 * So the pin lives here: a clearly-marked PINNED_INSTALLER_SHA256 map keyed
 * by platform. The check is real, not theater: the installer is downloaded
 * to a temp file and executed ONLY if its digest matches the pin, and the
 * pin can be rotated deliberately (a single, reviewed constant, or via the
 * EVERFERN_OLLAMA_INSTALLER_SHA256_* env override during release testing)
 * rather than silently drifting to whatever the CDN serves today.
 *
 * These are ROLLING scripts pinned at their 2026-09-06 capture date; they
 * change upstream without notice, so a digest mismatch after an upstream
 * rotation is expected and must fail closed until the pin is refreshed.
 * Rotation = re-download both scripts, re-hash with
 * `shasum -a 256` / `Get-FileHash -Algorithm SHA256`, update
 * this map in a single reviewed commit, and note it in the release notes.
 * (User-facing rotation commands, not executed by this process:
 * `curl -fsSL https://ollama.com/install.sh -o install.sh` then hash the
 * file; never pipe a remote script straight into a shell.)
 */
const PINNED_INSTALLER_SHA256: Record<'win32' | 'darwin' | 'linux', string> = {
  // Captured 2026-09-06 from https://ollama.com/install.ps1 (22627 bytes)
  win32: '8b0882ca390fc06629ef24e2b821159ec64c6e328b602fef5ffa87f26d4f02e1',
  // Captured 2026-09-06 from https://ollama.com/install.sh (15902 bytes)
  darwin: '25f64b810b947145095956533e1bdf56eacea2673c55a7e586be4515fc882c9f',
  linux: '25f64b810b947145095956533e1bdf56eacea2673c55a7e586be4515fc882c9f',
};

function getExpectedInstallerSha256(): string {
  const platform = process.platform as 'win32' | 'darwin' | 'linux';
  const pinned = PINNED_INSTALLER_SHA256[platform] || PINNED_INSTALLER_SHA256.linux;
  // Deliberate override for release testing / pin rotation. Setting the env
  // var disables the pin's tamper-evidence for that run, so it is logged.
  const override =
    (process.platform === 'win32'
      ? process.env.EVERFERN_OLLAMA_INSTALLER_SHA256_WIN
      : process.env.EVERFERN_OLLAMA_INSTALLER_SHA256_UNIX) || '';
  if (override && /^[a-fA-F0-9]{64}$/.test(override)) {
    console.warn('[System] MP-SEC-20: using env-overridden installer SHA256 pin (test/release only).');
    return override.toLowerCase();
  }
  return pinned;
}

function getInstallerPlan() {
  const isWin = process.platform === 'win32';
  return {
    url: isWin ? 'https://ollama.com/install.ps1' : 'https://ollama.com/install.sh',
    sha256: getExpectedInstallerSha256(),
    command: isWin
      ? 'powershell -NoProfile -ExecutionPolicy Bypass -File <verified temp install.ps1>'
      : 'sh <verified everfern-ollama-install.sh>',
  };
}

/** Download the pinned installer URL to a temp file (no pipe-to-shell). */
function downloadInstallerToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const file = fs.createWriteStream(destPath, { mode: 0o700 });
    const req = https.get(url, { headers: { 'User-Agent': 'EverFern-Desktop' } }, (res: any) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers?.location) {
        file.close(() => fs.unlink(destPath, () => {}));
        downloadInstallerToFile(new URL(res.headers.location, url).href, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(destPath, () => {}));
        reject(new Error(`Failed to download installer: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err: Error) => {
      try { fs.unlinkSync(destPath); } catch { /* temp file may not exist */ }
      reject(err);
    });
  });
}

/** MP-SEC-20: verify the downloaded installer digest against the pin. */
function verifyInstallerChecksum(filePath: string, expectedSha256: string): void {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch: installer SHA256 ${actual} does not match pinned ${expectedSha256}. ` +
      'The download may have been tampered with, or the upstream script changed — refusing to execute.'
    );
  }
  console.log('[System] MP-SEC-20: installer checksum verified against pin.');
}

export function launchNativeTerminalCommand(title: string, cmd: string): boolean {
  try {
    if (!isSafeTerminalText(title)) {
      console.warn('[System] Blocked terminal launch: unsafe characters in title.');
      return false;
    }
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWin) {
      const safeTitle = title.replace(/"/g, '');
      const fullCmd = `start cmd.exe /k "echo ==================================================== && echo [EverFern] ${safeTitle} && echo ==================================================== && ${cmd} && echo ==================================================== && echo Process finished! You can close this window now. && pause"`;
      exec(fullCmd);
      return true;
    } else if (isMac) {
      const escapedScript = `tell app "Terminal" to do script "echo \\"====================================================\\"; echo \\"[EverFern] ${title}\\"; echo \\"====================================================\\"; ${cmd.replace(/"/g, '\\"')}" activate`;
      exec(`osascript -e '${escapedScript}'`);
      return true;
    } else {
      const terminalScript = `bash -c "echo '===================================================='; echo '[EverFern] ${title}'; echo '===================================================='; ${cmd}; echo '===================================================='; echo 'Process finished. Press Enter to exit.'; read; exec bash"`;
      exec(`which gnome-terminal 2>/dev/null`, (err: any, stdout: string) => {
        if (!err && stdout.trim()) {
          exec(`gnome-terminal -- ${terminalScript}`);
        } else {
          exec(`which konsole 2>/dev/null`, (kErr: any, kStdout: string) => {
            if (!kErr && kStdout.trim()) {
              exec(`konsole -e ${terminalScript}`);
            } else {
              exec(`which x-terminal-emulator 2>/dev/null`, (xErr: any, xStdout: string) => {
                if (!xErr && xStdout.trim()) {
                  exec(`x-terminal-emulator -e "${terminalScript}"`);
                } else {
                  exec(`xterm -e "${terminalScript}"`);
                }
              });
            }
          });
        }
      });
      return true;
    }
  } catch (err) {
    console.error('[System] Failed to launch native terminal:', err);
    return false;
  }
}

let localSttPort: number | null = null;
let localSttProcess: any = null;

async function checkWsl(): Promise<boolean> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    await execAsync('wsl.exe -e echo ok', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function translateWindowsPathToLinux(windowsPath: string): string {
  if (!windowsPath) return '';
  const clean = windowsPath.replace(/\\/g, '/');
  const match = clean.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2];
    return `/mnt/${drive}/${rest}`;
  }
  return clean;
}

function getUnusedPort(): Promise<number> {
  return new Promise((resolve) => {
    const netModule = require('net');
    const server = netModule.createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 8010;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(8010));
  });
}

/**
 * MP-CORR-10: resolve local_stt_server.py across dev and packaged layouts.
 * `app.getAppPath()/../..` is wrong once packaged (lands inside asar parent),
 * so probe a candidate list (mirrors main/ocr/ocr.ts) and throw an actionable
 * error when the script is missing instead of spawning ENOENT.
 */
function resolveLocalSttScriptPath(): string {
  const STT_SCRIPT = 'local_stt_server.py';
  const candidates: string[] = [
    path.join(__dirname, STT_SCRIPT),
    path.join(__dirname, '..', '..', STT_SCRIPT),            // dev: dist-electron/main/ipc/system → repo root
    path.join(__dirname, '..', '..', '..', STT_SCRIPT),      // dev: main/ipc/system → repo root
    path.join(process.cwd(), STT_SCRIPT),
    path.join(process.cwd(), 'main', STT_SCRIPT),
    path.join(app.getAppPath(), '..', '..', STT_SCRIPT),     // legacy location (kept last-ish for compat)
    path.join(os.homedir(), '.everfern', STT_SCRIPT),
  ];
  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, STT_SCRIPT),
      path.join(process.resourcesPath, 'stt', STT_SCRIPT),
      path.join(process.resourcesPath, 'app.asar.unpacked', STT_SCRIPT),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', STT_SCRIPT),
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* probe next */ }
  }
  throw new Error(
    `local_stt_server.py not found. Looked in: ${candidates.join('; ')}. ` +
    'Reinstall EverFern or place local_stt_server.py in ~/.everfern/ to use local speech-to-text.'
  );
}
async function startLocalSttServer(): Promise<number> {
  if (localSttProcess && localSttPort) {
    return localSttPort;
  }

  const port = await getUnusedPort();
  console.log(`[LocalSTT] Dynamic port selected: ${port}`);

  // MP-CORR-10: env-aware resolution + existence check (throws actionable error).
  const scriptPath = resolveLocalSttScriptPath();
  console.log(`[LocalSTT] Python script path: ${scriptPath}`);

  const isWin = process.platform === 'win32';
  const hasWsl = isWin && (await checkWsl());

  let pythonBin = 'python';
  let args: string[] = [];

  if (hasWsl) {
    const translatedScript = translateWindowsPathToLinux(scriptPath);
    pythonBin = 'wsl.exe';
    args = ['--exec', 'bash', '-c', `~/.everfern/venv/bin/python "${translatedScript}" ${port}`];
    console.log(`[LocalSTT] Spawning uvicorn server in WSL: wsl.exe ${args.join(' ')}`);
  } else {
    // MP-CORR-10: probe the venv python with the same candidate logic as the
    // script — `app.getAppPath()/../..` breaks in packaged builds.
    const venvPythonCandidates = isWin
      ? [
          path.join(__dirname, '..', '..', '..', '.venv', 'Scripts', 'python.exe'),
          path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
          path.join(app.getAppPath(), '..', '..', '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(__dirname, '..', '..', '..', '.venv', 'bin', 'python'),
          path.join(process.cwd(), '.venv', 'bin', 'python'),
          path.join(app.getAppPath(), '..', '..', '.venv', 'bin', 'python'),
        ];
    const venvPythonPath = venvPythonCandidates.find((c) => { try { return fs.existsSync(c); } catch { return false; } });

    if (venvPythonPath) {
      pythonBin = venvPythonPath;
    } else if (process.platform !== 'win32') {
      pythonBin = 'python3';
    }
    args = [scriptPath, port.toString()];
    console.log(`[LocalSTT] Spawning uvicorn server on Host: ${pythonBin} ${args.join(' ')}`);
  }
  
  try {
    const { spawn } = require('child_process');
    const child = spawn(pythonBin, args, {
      shell: false,
      stdio: 'pipe'
    });
    
    child.stdout.on('data', (data: Buffer) => {
      console.log(`[LocalSTT Server]: ${data.toString().trim()}`);
    });
    
    child.stderr.on('data', (data: Buffer) => {
      console.error(`[LocalSTT Server Error]: ${data.toString().trim()}`);
    });
    
    child.on('error', (err: any) => {
      console.error('[LocalSTT Spawn Error]:', err);
    });
    
    child.on('close', (code: number) => {
      console.log(`[LocalSTT Server closed] Code: ${code}`);
      if (localSttProcess === child) {
        localSttProcess = null;
        localSttPort = null;
      }
    });

    localSttProcess = child;
    localSttPort = port;
    
    // Poll /health to wait for server to start up
    let ready = false;
    const startTime = Date.now();
    const timeoutMs = 12000;
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (e) {
        // ignore connection refused/failed errors during boot
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (!ready) {
      // MP-CORR-10: don't return a dead port — the failure would only surface
      // 12s later as an opaque "fetch failed" in transcribe. Kill the zombie
      // child and throw so the IPC handler returns an actionable error.
      console.error(`[LocalSTT] Server did not become ready within ${timeoutMs}ms — aborting.`);
      try { child.kill(); } catch { /* already dead */ }
      localSttProcess = null;
      localSttPort = null;
      throw new Error('Local STT server failed to start within 12s. Check that Python and the .everfern venv are installed.');
    } else {
      console.log(`[LocalSTT] Server is ready and accepting requests on port ${port}.`);
    }
    
    return port;
  } catch (err) {
    console.error('[LocalSTT] Failed to start local STT server:', err);
    throw err;
  }
}

app.on('will-quit', () => {
  shutdownLocalStt();
});

// Exported so the before-quit shutdown chain can terminate the child even when
// quitting via app.exit() (which skips will-quit listeners).
export function shutdownLocalStt(): void {
  if (localSttProcess) {
    console.log('[LocalSTT] Terminating local STT server...');
    try {
      localSttProcess.kill();
    } catch (err) {
      console.warn('[LocalSTT] Failed to kill local STT server:', err);
    }
    localSttProcess = null;
  }
}

export function registerOllamaAudioHandlers(): void {
  ipcMain.handle('system:ollama-status', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const bin = getOllamaBinary();

      try {
        await execAsync(`"${bin}" -v`);
      } catch {
        return { installed: false, modelInstalled: false };
      }

      try {
        const { stdout } = await execAsync(`"${bin}" list`, { encoding: 'utf8' });
        const modelInstalled = stdout.includes('qwen3-vl:2b');
        return { installed: true, modelInstalled };
      } catch {
        return { installed: true, modelInstalled: false };
      }
    } catch {
      return { installed: false, modelInstalled: false };
    }
  });

  // MP-SEC-20: consent step — expose the exact pinned URL + SHA256 the
  // install will verify, so the UI can show the plan before running it.
  ipcMain.handle('system:ollama-install-plan', async () => {
    const plan = getInstallerPlan();
    return { url: plan.url, sha256: plan.sha256, command: plan.command };
  });

  ipcMain.handle('system:ollama-install', async (event) => {
    // MP-SEC-20: no pipe-to-shell. Download the installer to a temp file,
    // verify its SHA256 against the pinned constant, and only then execute
    // the verified file. Refuse to run on any checksum mismatch.
    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      const isWin = process.platform === 'win32';
      const plan = getInstallerPlan();
      const expectedSha256 = plan.sha256;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-ollama-'));
      const installerPath = path.join(tempDir, isWin ? 'everfern-ollama-install.ps1' : 'everfern-ollama-install.sh');

      const fail = (error: string) => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
        resolve({ success: false, code: -1, error });
      };

      downloadInstallerToFile(plan.url, installerPath)
        .then(() => {
          try {
            verifyInstallerChecksum(installerPath, expectedSha256);
          } catch (err: any) {
            event.sender.send('system:ollama-install-line', { line: err.message, type: 'stderr' });
            fail(err.message);
            return;
          }

          const shellCmd = isWin ? 'powershell.exe' : 'sh';
          const args = isWin
            ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerPath]
            : [installerPath];

          const proc = spawn(shellCmd, args, { shell: false });

          proc.stdout.on('data', (d: Buffer) => {
            d.toString().split('\n').filter(Boolean).forEach((line: string) => {
              event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stdout' });
            });
          });

          proc.stderr.on('data', (d: Buffer) => {
            d.toString().split('\n').filter(Boolean).forEach((line: string) => {
              event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stderr' });
            });
          });

          proc.on('error', (err: any) => {
            fail(err.message);
          });

          proc.on('close', (code: number) => {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
            resolve({ success: code === 0, code });
          });
        })
        .catch((err: any) => {
          event.sender.send('system:ollama-install-line', { line: `Installer download failed: ${err.message}`, type: 'stderr' });
          fail(err.message);
        });
    });
  });

  ipcMain.handle('system:ollama-pull', async (event, modelName: string) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const bin = getOllamaBinary();
      const isWin = process.platform === 'win32';

      const proc = spawn(bin, ['pull', modelName], { shell: isWin && bin !== 'ollama' });

      proc.on('error', (err: any) => {
        console.error('[System] Ollama pull spawn error:', err);
        resolve({ success: false, code: -1, error: err.message });
      });

      proc.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stdout' });
        });
      });

      proc.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stderr' });
        });
      });

      proc.on('close', (code: number) => resolve({ success: code === 0 || code === null, code }));
    });
  });

  ipcMain.handle('system:pull-local-model-terminal', async (_event, params: { provider?: 'ollama' | 'lmstudio'; modelTag: string }) => {
    const provider = params?.provider || 'ollama';
    const modelTag = params?.modelTag || 'llama3.2:3b';

    if (!/^[A-Za-z0-9._:\/@-]{1,100}$/.test(modelTag)) {
      console.warn('[System] Rejected pull-local-model-terminal: unsafe model tag.');
      return { success: false, provider, modelTag, error: 'Invalid model tag: contains unsafe characters.' };
    }

    let cmd = '';
    let title = '';
    if (provider === 'lmstudio') {
      title = `Pulling model ${modelTag} via LM Studio CLI lms...`;
      cmd = `lms get ${modelTag} || lms load ${modelTag}`;
    } else {
      title = `Pulling model ${modelTag} via Ollama...`;
      cmd = `ollama run ${modelTag} || ollama pull ${modelTag}`;
    }

    const success = launchNativeTerminalCommand(title, cmd);
    return { success, provider, modelTag };
  });

  ipcMain.handle('system:open-terminal-installer', async (_event, action: 'install-all' | 'pull-model' | string, modelTag?: string) => {
    const isWin = process.platform === 'win32';
    const tag = modelTag || 'qwen3-vl:2b';

    if (!/^[A-Za-z0-9._:\/@-]{1,100}$/.test(tag)) {
      console.warn('[System] Rejected open-terminal-installer: unsafe model tag.');
      return { success: false, error: 'Invalid model tag: contains unsafe characters.' };
    }

    if (action === 'install-all') {
      // MP-SEC-20: the terminal flow also refuses pipe-to-shell. It downloads
      // the installer, echoes the pinned digest, and gates execution behind a
      // `sha256sum -c -` (Unix) / `Get-FileHash …SHA256` (Windows) check of the
      // same PINNED_INSTALLER_SHA256 constant used by the IPC flow.
      const expectedSha256 = getExpectedInstallerSha256();
      const winCmd =
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
        `irm https://ollama.com/install.ps1 -OutFile $env:TEMP\\everfern-ollama-install.ps1; ` +
        `$h = (Get-FileHash $env:TEMP\\everfern-ollama-install.ps1 -Algorithm SHA256).Hash.ToLower(); ` +
        `if ($h -ne '${expectedSha256}') { echo 'Checksum mismatch: refusing to run installer.'; exit 1 }; ` +
        `& $env:TEMP\\everfern-ollama-install.ps1" && ollama pull ${tag}`;
      const unixCmd =
        `curl -fsSL https://ollama.com/install.sh -o /tmp/everfern-ollama-install.sh && ` +
        `echo '${expectedSha256}  /tmp/everfern-ollama-install.sh' | sha256sum -c - && ` +
        `sh /tmp/everfern-ollama-install.sh && ollama pull ${tag}`;
      const ok = launchNativeTerminalCommand('DOWNLOADING AND INSTALLING OLLAMA AND VISION MODEL', isWin ? winCmd : unixCmd);
      return { success: ok };
    } else {
      launchNativeTerminalCommand(`PULLING MODEL: ${tag}`, `ollama run ${tag} || ollama pull ${tag}`);
    }
    return { success: true };
  });

  ipcMain.handle('system:transcribe-local', async (event, audioBuffer: ArrayBuffer) => {
    try {
      const port = await startLocalSttServer();
      const buffer = Buffer.from(audioBuffer);
      
      const response = await fetch(`http://127.0.0.1:${port}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm'
        },
        body: buffer
      });
      
      if (response.ok) {
        const result = (await response.json()) as any;
        return { success: true, transcription: result.transcription || '' };
      } else {
        return { success: false, error: `Local STT server returned status ${response.status}` };
      }
    } catch (err: any) {
      console.error('[LocalSTT] Transcription error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('system:transcribe-audio', async (event, audioBuffer: ArrayBuffer, userApiKey?: string) => {
    try {
      let apiKey = (userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) || process.env.DEEPGRAM_API_KEY || '';
      if (!apiKey) {
        return { success: false, error: 'Deepgram API key not configured. Please set your API key in Settings.' };
      }
      if (!(userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) && process.env.DEEPGRAM_API_KEY) {
        warnOnceEnvKeyFallback('deepgram');
      }
      const buffer = Buffer.from(audioBuffer);
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'audio/webm'
        },
        body: buffer
      });
      if (response.ok) {
        const result = (await response.json()) as any;
        const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        return { success: true, transcript };
      } else {
        const errBody = await response.text().catch(() => '');
        return { success: false, error: `Deepgram API returned status ${response.status}: ${errBody}` };
      }
    } catch (err: any) {
      console.error('[Voice] Main process transcription error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });
}
