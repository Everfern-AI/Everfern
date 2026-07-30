import { spawn, ChildProcess, execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface CommandInfo {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  status: 'running' | 'completed' | 'failed' | 'terminated';
  output: string;
  exitCode?: number;
  startTime: number;
  target: 'main' | 'vm';
}

interface PersistentShell {
  proc: ChildProcess;
  target: 'main' | 'vm';
  currentCwd: string;
  lastRequestedCwd: string;
  activeExecution: {
    id: string;
    command: string;
    cwd: string;
    marker: string;
    output: string;
    onData?: (data: string) => void;
    emitEvent?: (event: any) => void;
    resolve: (info: CommandInfo) => void;
    timeoutId?: NodeJS.Timeout;
    streamIntervalId?: NodeJS.Timeout;
    startTime: number;
  } | null;
  queue: {
    id: string;
    command: string;
    cwd: string;
    timeoutMs?: number;
    onData?: (data: string) => void;
    emitEvent?: (event: any) => void;
    resolve: (info: CommandInfo) => void;
  }[];
}

function cleanTerminalOutput(raw: string, isWin: boolean): string {
  if (!raw) return '';
  if (!isWin) return raw.trim();

  const lines = raw.split(/\r?\n/);
  const cleanLines = lines.filter((line) => {
    let trimmed = line.trim();
    // Strip PowerShell prompt preamble if prepended on the line (e.g. "PS C:\path> command")
    trimmed = trimmed.replace(/^PS\s+[A-Za-z]:\\[^>]*>\s*/i, '').trim();

    if (!trimmed) return false;
    if (trimmed.startsWith('>>')) return false;
    if (trimmed.startsWith('$global:EF_') || trimmed.startsWith('[Console]::OutputEncoding') || trimmed.startsWith('$OutputEncoding') || trimmed.startsWith('$ProgressPreference')) return false;
    if (trimmed.startsWith('try {') || trimmed.startsWith('& {') || trimmed.startsWith('Set-Location -LiteralPath')) return false;
    if (trimmed.startsWith('if ($LASTEXITCODE') || trimmed.startsWith('} catch {') || trimmed.startsWith('Write-Output')) return false;
    if (trimmed.includes('__EF_DONE_') || trimmed.includes('$global:EF_M') || trimmed.includes('$global:EF_EXIT')) return false;
    return true;
  });

  return cleanLines.join('\n').trim();
}

export class CommandRegistry {
  private static instance: CommandRegistry;
  private commands: Map<string, CommandInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map(); // Keep for compatibility
  private shells: Map<'main' | 'vm', PersistentShell> = new Map();
  private wslAvailable: boolean | null = null;
  private wslCmdName: string = 'wsl.exe';
  private lastWslCheck: number = 0;
  private readonly WSL_RECHECK_MS: number = 30000;
  private pendingMarkers: Map<'main' | 'vm', { id: string; marker: string; output: string; target: 'main' | 'vm' } | null> = new Map();

  private constructor() {}

  private resolvePowerShellExecutable(): string {
    if (process.platform !== 'win32') return process.env.SHELL || 'bash';
    try {
      execSync('where pwsh.exe', { stdio: 'ignore', timeout: 3000 });
      return 'pwsh.exe';
    } catch {
      return 'powershell.exe';
    }
  }

  private psSingleQuote(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  public static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  private async checkWslAvailable(): Promise<boolean> {
    if (this.wslAvailable !== null && this.wslAvailable) {
      return this.wslAvailable;
    }
    if (this.wslAvailable === false && Date.now() - this.lastWslCheck < this.WSL_RECHECK_MS) {
      console.log(`[CommandRegistry] checkWslAvailable: cached=false, skipping retry (cooldown ${this.WSL_RECHECK_MS}ms)`);
      return false;
    }
    try {
      const { execSync } = require('child_process');
      this.wslCmdName = (() => {
        try {
          execSync('where wsl.exe', { stdio: 'ignore', timeout: 3000 });
          return 'wsl.exe';
        } catch {
          return 'wsl';
        }
      })();
      this.lastWslCheck = Date.now();
      console.log(`[CommandRegistry] checkWslAvailable: testing ${this.wslCmdName} with 15s timeout...`);
      execSync(`${this.wslCmdName} -e echo ok`, { stdio: 'ignore', timeout: 15000 });
      this.wslAvailable = true;
      console.log(`[CommandRegistry] checkWslAvailable: ${this.wslCmdName} OK`);
    } catch (err: any) {
      console.warn(`[CommandRegistry] First WSL check failed: ${err.message || err}. Trying ensureWSLSetup as second chance...`);
      try {
        const { ensureWSLSetup } = require('../linux-vm-executor');
        await Promise.race([
          ensureWSLSetup(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('ensureWSLSetup timed out after 30s')), 30000))
        ]);
        this.wslAvailable = true;
        console.log(`[CommandRegistry] checkWslAvailable: ${this.wslCmdName} OK (via ensureWSLSetup)`);
      } catch (err2: any) {
        console.warn(`[CommandRegistry] wsl.exe not found or not working. Error: ${err2.message || err2}`);
        this.wslAvailable = false;
      }
    }
    return this.wslAvailable;
  }

  private async getOrCreateShell(target: 'main' | 'vm', cwd: string): Promise<PersistentShell> {
    let shell = this.shells.get(target);
    const isWin = process.platform === 'win32';

    if (
      shell &&
      shell.proc.exitCode === null &&
      shell.proc.signalCode === null &&
      shell.proc.killed === false
    ) {
      return shell;
    }

    console.log(`[CommandRegistry] Spawning persistent shell for target=${target} in cwd=${cwd}`);

    const fs = require('fs');
    let targetCwd = cwd;
    if (!fs.existsSync(targetCwd)) {
      try {
        fs.mkdirSync(targetCwd, { recursive: true });
      } catch (err) {
        console.warn(`[CommandRegistry] Failed to create cwd ${targetCwd}. Falling back to home.`, err);
        targetCwd = os.homedir();
      }
    }

    let executable = 'bash';
    let args: string[] = [];
    let spawnOptions: any = { cwd: targetCwd, shell: false, env: { ...process.env } };

    if (isWin) {
      if (target === 'vm') {
        const isWslAvailable = await this.checkWslAvailable();
        if (!isWslAvailable) {
          throw new Error('Linux VM (WSL) is not available on this system.');
        }
        executable = this.wslCmdName;
        args = ['--exec', 'bash'];
        spawnOptions.env = { ...process.env, WSL_UTF8: '1', WSLENV: '' };
      } else {
        executable = this.resolvePowerShellExecutable();
        args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'];
      }
    } else {
      executable = 'bash';
      args = [];
    }

    const proc = spawn(executable, args, spawnOptions);

    const newShell: PersistentShell = {
      proc,
      target,
      currentCwd: targetCwd,
      lastRequestedCwd: targetCwd,
      activeExecution: null,
      queue: []
    };

    this.shells.set(target, newShell);

    if (isWin && target === 'main') {
      proc.stdin?.write('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n');
      proc.stdin?.write('$OutputEncoding = [System.Text.Encoding]::UTF8\n');
      proc.stdin?.write('$ProgressPreference = "SilentlyContinue"\n');
    } else {
      proc.stdin?.write('export PATH="$HOME/.everfern/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin"\n');
    }

    const decodeBuffer = (buf: Buffer): string => {
      if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
        return buf.toString('utf16le');
      }
      if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
        return buf.toString('utf16le');
      }
      return buf.toString('utf8').replace(/\0/g, '');
    };

    const MAX_OUTPUT_LENGTH = 50000;

    const syncOutputToCommands = (decoded: string) => {
      const active = newShell.activeExecution;
      if (active) {
        const cmdInfo = this.commands.get(active.id);
        if (cmdInfo && cmdInfo.status === 'running') {
          cmdInfo.output = active.output;
        }
      }
    };

    proc.stdout?.on('data', (data) => {
      const decoded = decodeBuffer(data);
      const active = newShell.activeExecution;
      if (active) {
        console.log(`[Terminal ${target}] ${decoded.trimEnd()}`);
        active.output += decoded;
        active.onData?.(decoded);
        syncOutputToCommands(decoded);

        if (active.output.length > MAX_OUTPUT_LENGTH) {
          active.output = '...[Output truncated]...\n' + active.output.slice(-MAX_OUTPUT_LENGTH);
        }

        // Early return for long-running dev servers when server ready patterns are output
        const isDevServerCmd = /\b(npm\s+run\s+dev|next\s+dev|vite|npm\s+start|yarn\s+dev|pnpm\s+dev|gatsby\s+develop)\b/i.test(active.command);
        const hasServerReady = /(?:ready\s+in|local:\s*http|http:\/\/localhost:\d+|server\s+running|compiled\s+successfully|vite\s+v\d+)/i.test(active.output);
        if (isDevServerCmd && hasServerReady && !(active as any).resolvedEarly) {
          (active as any).resolvedEarly = true;
          console.log(`[CommandRegistry] Dev server ready detected for ${active.id} ("${active.command}"). Resolving turn early while server continues in background.`);
          
          const info: CommandInfo = {
            id: active.id,
            command: active.command,
            cwd: newShell.currentCwd,
            pid: proc.pid,
            status: 'running',
            output: active.output + `\n[Dev Server active in background. Logs will stream live.]`,
            startTime: active.startTime,
            target
          };

          this.commands.set(active.id, info);
          this.pendingMarkers.set(target, {
            id: active.id,
            marker: active.marker,
            output: active.output,
            target
          });

          newShell.activeExecution = null;
          active.resolve(info);
          this.processQueue(target);
          return;
        }

        const markerIndex = active.output.indexOf(active.marker);
        if (markerIndex !== -1) {
          const afterMarker = active.output.substring(markerIndex + active.marker.length);
          const lines = afterMarker.split(/\r?\n/);
          if (lines.length >= 3) {
            const exitCodeStr = lines[0].trim();
            const exitCode = parseInt(exitCodeStr, 10);
            const newCwd = lines[1].trim();

            if (newCwd) {
              newShell.currentCwd = newCwd;
              if (target === 'vm' && isWin) {
                const { translateLinuxPathToHost } = require('../linux-vm-executor');
                newShell.currentCwd = translateLinuxPathToHost(newCwd);
              }
            }

            let cleanOutput = active.output.substring(0, markerIndex);
            cleanOutput = cleanTerminalOutput(cleanOutput, isWin);

            if (active.timeoutId) clearTimeout(active.timeoutId);
            if (active.streamIntervalId) clearInterval(active.streamIntervalId);

            if (exitCode !== 0) {
              try {
                const { appendPythonHintIfImportError } = require('../pi-tools');
                cleanOutput = appendPythonHintIfImportError(cleanOutput, target);
              } catch (err) {
                console.warn('[CommandRegistry] Failed to load recovery hint helper:', err);
              }
            }

            const info: CommandInfo = {
              id: active.id,
              command: active.command,
              cwd: newShell.currentCwd,
              pid: proc.pid,
              status: exitCode === 0 ? 'completed' : 'failed',
              output: cleanOutput,
              exitCode,
              startTime: active.startTime,
              target
            };

            this.commands.set(active.id, info);
            this.processes.delete(active.id);

            newShell.activeExecution = null;
            active.resolve(info);

            this.processQueue(target);
          }
        }
      }

      // Check pending markers (timed-out commands still running in background)
      const pending = this.pendingMarkers.get(target);
      if (pending && !active) {
        pending.output += decoded;
        const markerIndex = pending.output.indexOf(pending.marker);
        if (markerIndex !== -1) {
          const afterMarker = pending.output.substring(markerIndex + pending.marker.length);
          const lines = afterMarker.split(/\r?\n/);
          if (lines.length >= 3) {
            const exitCodeStr = lines[0].trim();
            const exitCode = parseInt(exitCodeStr, 10);
            let cleanOutput = pending.output.substring(0, markerIndex);

            const existing = this.commands.get(pending.id);
            if (existing) {
              existing.status = exitCode === 0 ? 'completed' : 'failed';
              existing.output = cleanOutput;
              existing.exitCode = exitCode;
              this.commands.set(pending.id, { ...existing });
              console.log(`[CommandRegistry] Background command ${pending.id} completed with exit code ${exitCode}`);
            }
            this.pendingMarkers.delete(target);
          }
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      const decoded = decodeBuffer(data);
      const active = newShell.activeExecution;
      if (active) {
        console.error(`[Terminal Error ${target}] ${decoded.trimEnd()}`);
        active.output += decoded;
        active.onData?.(decoded);
        syncOutputToCommands(decoded);

        if (active.output.length > MAX_OUTPUT_LENGTH) {
          active.output = '...[Output truncated]...\n' + active.output.slice(-MAX_OUTPUT_LENGTH);
        }
      }

      // Also capture stderr for pending markers
      const pending = this.pendingMarkers.get(target);
      if (pending && !active) {
        pending.output += decoded;
      }
    });

    proc.on('close', (code) => {
      console.log(`[CommandRegistry] Persistent shell ${target} closed with code ${code}`);
      if (this.shells.get(target) === newShell) {
        this.shells.delete(target);
      }

      const active = newShell.activeExecution;
      if (active) {
        if (active.timeoutId) clearTimeout(active.timeoutId);
        if (active.streamIntervalId) clearInterval(active.streamIntervalId);
        const info: CommandInfo = {
          id: active.id,
          command: active.command,
          cwd: newShell.currentCwd,
          pid: proc.pid,
          status: 'failed',
          output: active.output + `\n[Shell exited unexpectedly with code ${code}]`,
          exitCode: code ?? -1,
          startTime: active.startTime,
          target
        };
        this.commands.set(active.id, info);
        this.processes.delete(active.id);
        active.resolve(info);
        newShell.activeExecution = null;
      }

      const queue = newShell.queue;
      newShell.queue = [];
      for (const req of queue) {
        const info: CommandInfo = {
          id: req.id,
          command: req.command,
          cwd: newShell.currentCwd,
          status: 'failed',
          output: 'Shell exited unexpectedly before command execution',
          exitCode: -1,
          startTime: Date.now(),
          target
        };
        this.commands.set(req.id, info);
        req.resolve(info);
      }
    });

    proc.on('error', (err) => {
      console.error(`[CommandRegistry] Persistent shell ${target} process error:`, err);
    });

    return newShell;
  }

  private processQueue(target: 'main' | 'vm'): void {
    const shell = this.shells.get(target);
    if (!shell) return;
    if (shell.activeExecution) return;
    if (shell.queue.length === 0) return;

    const req = shell.queue.shift()!;
    const marker = `__EF_DONE_${Date.now()}_${Math.random().toString(36).substring(2, 10)}__`;

    let lastStreamedLength = 0;
    const STREAM_INTERVAL_MS = 2000; // Fast 2-second live terminal log updates to AI & UI

    const streamIntervalId = setInterval(() => {
      const active = shell.activeExecution;
      if (!active || active.id !== req.id) {
        clearInterval(streamIntervalId);
        return;
      }
      const currentOutput = active.output;
      if (currentOutput.length > lastStreamedLength) {
        const rawChunk = currentOutput.substring(lastStreamedLength);
        lastStreamedLength = currentOutput.length;

        const cleanChunk = cleanTerminalOutput(rawChunk, process.platform === 'win32');

        if (cleanChunk) {
          active.onData?.(cleanChunk);
          active.emitEvent?.({
            type: 'terminal_log_stream',
            id: req.id,
            command: req.command,
            logs: cleanChunk,
            timestamp: Date.now()
          });
        }
      }
    }, STREAM_INTERVAL_MS);

    shell.activeExecution = {
      id: req.id,
      command: req.command,
      cwd: req.cwd,
      marker,
      output: '',
      onData: req.onData,
      emitEvent: req.emitEvent,
      resolve: req.resolve,
      streamIntervalId,
      startTime: Date.now()
    };

    this.processes.set(req.id, shell.proc);

    const timeoutMs = req.timeoutMs || 300000;
    shell.activeExecution.timeoutId = setTimeout(() => {
      console.log(`[CommandRegistry] Command ${req.id} timed out after ${timeoutMs/1000}s. Returning partial output — command continues in background.`);
      const active = shell.activeExecution;
      if (active) {
        if (active.streamIntervalId) clearInterval(active.streamIntervalId);
        const cleanedOutput = cleanTerminalOutput(active.output, process.platform === 'win32');
        const timeoutMsg = `\n[⏱ Timeout after ${timeoutMs/1000}s — command is still running. Check with terminal_status(id="${active.id}").]`;
        const finalOutput = cleanedOutput ? `${cleanedOutput}\n${timeoutMsg}` : timeoutMsg;
        active.onData?.(timeoutMsg);

        const info: CommandInfo = {
          id: active.id,
          command: active.command,
          cwd: shell.currentCwd,
          pid: shell.proc.pid,
          status: 'running',
          output: finalOutput,
          startTime: active.startTime,
          target
        };
        this.commands.set(active.id, info);
        this.processes.delete(active.id);
        active.resolve(info);

        // Set up pending marker tracking: when the command eventually finishes,
        // the stdout handler will detect the marker and update the command info.
        this.pendingMarkers.set(target, {
          id: active.id,
          marker: active.marker,
          output: active.output,
          target
        });

        shell.activeExecution = null;
        this.processQueue(target);
      }
    }, timeoutMs);

    const isWin = process.platform === 'win32';
    const isPowerShell = target === 'main' && isWin;

    const needCd = req.cwd !== shell.currentCwd;
    if (needCd) {
      shell.lastRequestedCwd = req.cwd;
    }

    if (isPowerShell) {
      const base64Marker = Buffer.from(marker).toString('base64');
      const formattedCommand = req.command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      shell.proc.stdin?.write(`$global:EF_M = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Marker}'))\n`);
      shell.proc.stdin?.write('$global:EF_EXIT = 0\n');
      if (needCd) {
        shell.proc.stdin?.write(`Set-Location -LiteralPath ${this.psSingleQuote(req.cwd)}\n`);
      }
      shell.proc.stdin?.write(`try {\n  & {\n    $global:LASTEXITCODE = $null\n    ${formattedCommand}\n  }\n  if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { $global:EF_EXIT = $LASTEXITCODE } elseif (-not $?) { $global:EF_EXIT = 1 } else { $global:EF_EXIT = 0 }\n} catch { Write-Error $_; $global:EF_EXIT = 1 }\n`);
      shell.proc.stdin?.write('Write-Output "$global:EF_M $global:EF_EXIT"\n');
      shell.proc.stdin?.write('Write-Output (Get-Location).Path\n\n');
    } else {
      const { translateWindowsPathToLinux } = require('../linux-vm-executor');
      const linuxCwd = isWin ? translateWindowsPathToLinux(req.cwd) : req.cwd;
      const formattedCommand = req.command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      shell.proc.stdin?.write(`export EF_M="${marker}"\n`);
      if (needCd) {
        shell.proc.stdin?.write(`cd "${linuxCwd}"\n`);
      }
      shell.proc.stdin?.write(`${formattedCommand}\n`);
      shell.proc.stdin?.write(`echo "$EF_M \$?"\n`);
      shell.proc.stdin?.write(`pwd\n`);
    }
  }

  public async execute(
    id: string,
    command: string,
    cwd: string = path.join(os.homedir(), '.everfern'),
    timeoutMs?: number,
    target: 'main' | 'vm' = 'main',
    onData?: (data: string) => void,
    emitEvent?: (event: any) => void
  ): Promise<CommandInfo> {
    let actualTarget = target;
    if (process.platform === 'win32' && target === 'main') {
      const normalizedCmd = command.trim().toLowerCase();
      const hasLinuxIndicators = normalizedCmd.includes('/mnt/') ||
        normalizedCmd.includes('/home/') ||
        normalizedCmd.includes('/tmp/') ||
        /\bsource\b/.test(normalizedCmd) ||
        /\b(python|pip|apt-get)\b/.test(normalizedCmd) ||
        ((normalizedCmd.includes('&&') || normalizedCmd.includes('||')) &&
         !/^(npm|npx|yarn|node|git|powershell|pwsh|cmd)\b/.test(normalizedCmd));

      if (hasLinuxIndicators) {
        console.log(`[CommandRegistry] Auto-routing Linux/WSL command to VM: "${command.slice(0, 100)}..."`);
        actualTarget = 'vm';
      }
    }

    const info: CommandInfo = {
      id,
      command,
      cwd,
      status: 'running',
      output: '',
      startTime: Date.now(),
      target: actualTarget
    };
    this.commands.set(id, info);

    try {
      const shell = await this.getOrCreateShell(actualTarget, cwd);

      return new Promise<CommandInfo>((resolve) => {
        shell.queue.push({
          id,
          command,
          cwd,
          timeoutMs,
          onData,
          emitEvent,
          resolve
        });

        this.processQueue(actualTarget);
      });
    } catch (err: any) {
      const failedInfo: CommandInfo = {
        id,
        command,
        cwd,
        status: 'failed',
        output: `Error: ${err.message || err}`,
        exitCode: -1,
        startTime: Date.now(),
        target: actualTarget
      };
      this.commands.set(id, failedInfo);
      return failedInfo;
    }
  }

  public listCommands(): CommandInfo[] {
    return Array.from(this.commands.values());
  }

  public terminate(id: string): boolean {
    for (const [target, shell] of this.shells.entries()) {
      const active = shell.activeExecution;
      if (active && active.id === id) {
        console.log(`[CommandRegistry] Terminating active command ${id} by killing shell process.`);
        if (active.timeoutId) clearTimeout(active.timeoutId);

        const info: CommandInfo = {
          id: active.id,
          command: active.command,
          cwd: shell.currentCwd,
          pid: shell.proc.pid,
          status: 'terminated',
          output: active.output + '\n[Command terminated by user/agent]',
          exitCode: -1,
          startTime: active.startTime,
          target
        };
        this.commands.set(id, info);
        this.processes.delete(id);
        active.resolve(info);
        shell.activeExecution = null;

        shell.proc.kill('SIGKILL');
        return true;
      }

      const queueIndex = shell.queue.findIndex(req => req.id === id);
      if (queueIndex !== -1) {
        const req = shell.queue[queueIndex];
        shell.queue.splice(queueIndex, 1);
        const info: CommandInfo = {
          id: req.id,
          command: req.command,
          cwd: shell.currentCwd,
          status: 'terminated',
          output: 'Command terminated before execution started',
          exitCode: -1,
          startTime: Date.now(),
          target
        };
        this.commands.set(id, info);
        req.resolve(info);
        return true;
      }
    }
    return false;
  }
}
