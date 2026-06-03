import { spawn, ChildProcess } from 'child_process';
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
    resolve: (info: CommandInfo) => void;
    timeoutId?: NodeJS.Timeout;
    startTime: number;
  } | null;
  queue: {
    id: string;
    command: string;
    cwd: string;
    timeoutMs?: number;
    onData?: (data: string) => void;
    resolve: (info: CommandInfo) => void;
  }[];
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

  private constructor() {}

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
        console.warn(`[CommandRegistry] wsl.exe not found or not working, falling back to cmd... Error: ${err2.message || err2}`);
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
        executable = 'cmd.exe';
        args = ['/q'];
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
      proc.stdin?.write('@echo off\n');
    } else {
      proc.stdin?.write('export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin"\n');
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

    proc.stdout?.on('data', (data) => {
      const decoded = decodeBuffer(data);
      const active = newShell.activeExecution;
      if (active) {
        console.log(`[Terminal ${target}] ${decoded.trimEnd()}`);
        active.output += decoded;
        active.onData?.(decoded);

        if (active.output.length > MAX_OUTPUT_LENGTH) {
          active.output = '...[Output truncated]...\n' + active.output.slice(-MAX_OUTPUT_LENGTH);
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

            const cleanOutput = active.output.substring(0, markerIndex);

            if (active.timeoutId) clearTimeout(active.timeoutId);

            const info: CommandInfo = {
              id: active.id,
              command: active.command,
              cwd: newShell.currentCwd,
              pid: proc.pid,
              status: exitCode === 0 ? 'completed' : 'failed',
              output: cleanOutput,
              exitCode,
              startTime: active.startTime
            };

            this.commands.set(active.id, info);
            this.processes.delete(active.id);

            newShell.activeExecution = null;
            active.resolve(info);

            this.processQueue(target);
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

        if (active.output.length > MAX_OUTPUT_LENGTH) {
          active.output = '...[Output truncated]...\n' + active.output.slice(-MAX_OUTPUT_LENGTH);
        }
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
        const info: CommandInfo = {
          id: active.id,
          command: active.command,
          cwd: newShell.currentCwd,
          pid: proc.pid,
          status: 'failed',
          output: active.output + `\n[Shell exited unexpectedly with code ${code}]`,
          exitCode: code ?? -1,
          startTime: active.startTime
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
          startTime: Date.now()
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

    shell.activeExecution = {
      id: req.id,
      command: req.command,
      cwd: req.cwd,
      marker,
      output: '',
      onData: req.onData,
      resolve: req.resolve,
      startTime: Date.now()
    };

    this.processes.set(req.id, shell.proc);

    const timeoutMs = req.timeoutMs || 60000;
    shell.activeExecution.timeoutId = setTimeout(() => {
      console.log(`[CommandRegistry] Command ${req.id} timed out. Terminating shell.`);
      const active = shell.activeExecution;
      if (active) {
        active.output += `\n[Timeout: Command produced no output for ${timeoutMs/1000} seconds and was terminated.]`;
        const info: CommandInfo = {
          id: active.id,
          command: active.command,
          cwd: shell.currentCwd,
          pid: shell.proc.pid,
          status: 'failed',
          output: active.output,
          exitCode: -1,
          startTime: active.startTime
        };
        this.commands.set(active.id, info);
        this.processes.delete(active.id);
        active.resolve(info);
      }
      shell.activeExecution = null;
      shell.proc.kill('SIGKILL');
    }, timeoutMs);

    const isWin = process.platform === 'win32';
    const isCmd = target === 'main' && isWin;

    const needCd = req.cwd !== shell.lastRequestedCwd;
    if (needCd) {
      shell.lastRequestedCwd = req.cwd;
    }

    if (isCmd) {
      shell.proc.stdin?.write(`@set "EF_M=${marker}"\n`);
      if (needCd) {
        shell.proc.stdin?.write(`cd /d "${req.cwd}"\n`);
      }
      shell.proc.stdin?.write(`${req.command}\n`);
      shell.proc.stdin?.write(`@echo %EF_M% %errorlevel%\n`);
      shell.proc.stdin?.write(`@cd\n`);
    } else {
      const { translateWindowsPathToLinux } = require('../linux-vm-executor');
      const linuxCwd = isWin ? translateWindowsPathToLinux(req.cwd) : req.cwd;
      shell.proc.stdin?.write(`export EF_M="${marker}"\n`);
      if (needCd) {
        shell.proc.stdin?.write(`cd "${linuxCwd}"\n`);
      }
      shell.proc.stdin?.write(`${req.command}\n`);
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
    onData?: (data: string) => void
  ): Promise<CommandInfo> {
    const info: CommandInfo = {
      id,
      command,
      cwd,
      status: 'running',
      output: '',
      startTime: Date.now()
    };
    this.commands.set(id, info);

    try {
      const shell = await this.getOrCreateShell(target, cwd);

      return new Promise<CommandInfo>((resolve) => {
        shell.queue.push({
          id,
          command,
          cwd,
          timeoutMs,
          onData,
          resolve
        });

        this.processQueue(target);
      });
    } catch (err: any) {
      const failedInfo: CommandInfo = {
        id,
        command,
        cwd,
        status: 'failed',
        output: `Error: ${err.message || err}`,
        exitCode: -1,
        startTime: Date.now()
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
          startTime: active.startTime
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
          startTime: Date.now()
        };
        this.commands.set(id, info);
        req.resolve(info);
        return true;
      }
    }
    return false;
  }
}
