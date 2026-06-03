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

export class CommandRegistry {
  private static instance: CommandRegistry;
  private commands: Map<string, CommandInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private wslAvailable: boolean | null = null;
  private wslCmdName: string = 'wsl.exe';

  private constructor() {}

  public static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  private lastWslCheck: number = 0;
  private readonly WSL_RECHECK_MS: number = 30000; // Retry WSL after 30 seconds if previously unavailable

  private async checkWslAvailable(): Promise<boolean> {
    if (this.wslAvailable !== null && this.wslAvailable) {
      return this.wslAvailable;
    }
    // If cached as unavailable, retry after cooldown period
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
      // First attempt failed. Try ensureWSLSetup as second chance — it confirms WSL works
      // by running `command -v python3` inside WSL, which is more lenient if WSL is slow.
      // Wrap with 30s timeout to avoid blocking on apt install (180s) — if setup is slow,
      // it continues in background and next command retries.
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

  public async execute(id: string, command: string, cwd: string = path.join(os.homedir(), '.everfern'), timeoutMs?: number, onData?: (data: string) => void): Promise<CommandInfo> {
    const info: CommandInfo = {
      id,
      command,
      cwd,
      status: 'running',
      output: '',
      startTime: Date.now()
    };
    this.commands.set(id, info);

    const isWin = process.platform === 'win32';

    // Ensure cwd exists
    const fs = require('fs');
    if (!fs.existsSync(cwd)) {
      try {
        fs.mkdirSync(cwd, { recursive: true });
        console.log(`[CommandRegistry] Created missing cwd: ${cwd}`);
      } catch (err) {
        console.warn(`[CommandRegistry] Failed to create cwd: ${cwd}. Falling back to home directory. Error: ${err}`);
        cwd = os.homedir();
      }
    }

    let shell = 'bash';
    let args = ['-c', command];
    let spawnOptions: any = { cwd, shell: false, env: { ...process.env } };

    // Robust shell detection for Windows (cached result)
    if (isWin) {
      const isWslAvailable = await this.checkWslAvailable();
      console.log(`[CommandRegistry] execute: Windows detected, WSL available=${isWslAvailable}, command="${command.slice(0, 100)}..."`);

      if (isWslAvailable) {
        shell = this.wslCmdName;
        console.log(`[CommandRegistry] Using WSL command: ${shell}`);
        const { translateWindowsPathToLinux } = require('../linux-vm-executor');
        const linuxCwd = translateWindowsPathToLinux(cwd);
        const wslCommand = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin" && cd "${linuxCwd}" && ${command}`;
        args = ['--exec', 'bash', '-c', wslCommand];
        spawnOptions = { cwd, shell: false, env: { ...process.env, WSL_UTF8: '1', WSLENV: '' } };
      } else {
        console.log('[CommandRegistry] execute: WSL not available, using Host Fallback (CMD)');
        shell = 'cmd.exe';
        args = ['/c', command];
        spawnOptions.shell = true;
      }
    }

    info.output = '';

    const proc = spawn(shell, args, spawnOptions);
    this.processes.set(id, proc);
    info.pid = proc.pid;

    const MAX_OUTPUT_LENGTH = 50000;

    let timeoutId: NodeJS.Timeout | null = null;
    const IDLE_TIMEOUT_MS = timeoutMs || 60000;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        info.status = 'failed';
        info.output += `\n[Timeout: Command produced no output for ${IDLE_TIMEOUT_MS/1000} seconds and was terminated.]`;
        proc.kill('SIGKILL');
      }, IDLE_TIMEOUT_MS);
    };

    resetTimeout();

    const decodeBuffer = (buf: Buffer): string => {
      if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
        return buf.toString('utf16le');
      }
      if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
        return buf.toString('utf16le');
      }
      return buf.toString('utf8').replace(/\0/g, '');
    };

    proc.stdout?.on('data', (data) => {
      resetTimeout();
      const decoded = decodeBuffer(data);
      console.log(`[Terminal] ${decoded.trimEnd()}`);
      info.output += decoded;
      onData?.(decoded);
      if (info.output.length > MAX_OUTPUT_LENGTH) {
        info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.stderr?.on('data', (data) => {
      resetTimeout();
      const decoded = decodeBuffer(data);
      console.error(`[Terminal Error] ${decoded.trimEnd()}`);
      info.output += decoded;
      onData?.(decoded);
      if (info.output.length > MAX_OUTPUT_LENGTH) {
        info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    return new Promise((resolve) => {
      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        // Only override status if it's not already failed due to timeout
        if (info.status !== 'failed' || !info.output.includes('[Timeout:')) {
          info.status = code === 0 ? 'completed' : 'failed';
        }
        info.exitCode = code ?? -1;
        this.processes.delete(id);
        resolve(info);
      });

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        info.status = 'failed';
        info.output += `\nError: ${err.message}`;
        this.processes.delete(id);
        resolve(info);
      });
    });
  }

  public listCommands(): CommandInfo[] {
    return Array.from(this.commands.values());
  }

  public terminate(id: string): boolean {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      const info = this.commands.get(id);
      if (info) info.status = 'terminated';
      this.processes.delete(id);
      return true;
    }
    return false;
  }
}
