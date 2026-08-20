import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

export function launchNativeTerminalCommand(title: string, cmd: string): boolean {
  try {
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

async function startLocalSttServer(): Promise<number> {
  if (localSttProcess && localSttPort) {
    return localSttPort;
  }
  
  const port = await getUnusedPort();
  console.log(`[LocalSTT] Dynamic port selected: ${port}`);
  
  const scriptPath = path.join(app.getAppPath(), '..', '..', 'local_stt_server.py');
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
    const venvPythonPath = isWin
      ? path.join(app.getAppPath(), '..', '..', '.venv', 'Scripts', 'python.exe')
      : path.join(app.getAppPath(), '..', '..', '.venv', 'bin', 'python');
      
    if (fs.existsSync(venvPythonPath)) {
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
      console.warn(`[LocalSTT] Server did not become ready within ${timeoutMs}ms.`);
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
  if (localSttProcess) {
    console.log('[LocalSTT] Terminating local STT server...');
    localSttProcess.kill();
    localSttProcess = null;
  }
});

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

  ipcMain.handle('system:ollama-install', async (event) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      const isWin = process.platform === 'win32';
      const shellCmd = isWin ? 'powershell.exe' : 'sh';
      const command = isWin
        ? 'irm https://ollama.com/install.ps1 | Invoke-Expression'
        : 'curl -fsSL https://ollama.com/install.sh | sh';

      const args = isWin
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-c', command];

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

      proc.on('close', (code: number) => {
        resolve({ success: code === 0, code });
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

    let cmd = '';
    let title = '';
    if (provider === 'lmstudio') {
      title = `Pulling model "${modelTag}" via LM Studio CLI (lms)...`;
      cmd = `lms get ${modelTag} || lms load ${modelTag}`;
    } else {
      title = `Pulling model "${modelTag}" via Ollama...`;
      cmd = `ollama run ${modelTag} || ollama pull ${modelTag}`;
    }

    const success = launchNativeTerminalCommand(title, cmd);
    return { success, provider, modelTag };
  });

  ipcMain.handle('system:open-terminal-installer', async (_event, action: 'install-all' | 'pull-model' | string, modelTag?: string) => {
    const isWin = process.platform === 'win32';
    const tag = modelTag || 'qwen3-vl:2b';

    if (action === 'install-all') {
      const winCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://ollama.com/install.ps1 | Invoke-Expression" && ollama pull ${tag}`;
      const unixCmd = `curl -fsSL https://ollama.com/install.sh | sh && ollama pull ${tag}`;
      launchNativeTerminalCommand('DOWNLOADING AND INSTALLING OLLAMA & VISION MODEL', isWin ? winCmd : unixCmd);
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
      const apiKey = (userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) || process.env.DEEPGRAM_API_KEY || '';
      if (!apiKey) {
        return { success: false, error: 'Deepgram API key not configured. Please set your API key in Settings.' };
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
