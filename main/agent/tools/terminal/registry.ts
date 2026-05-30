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

  private constructor() {}

  public static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  private async checkWslAvailable(): Promise<boolean> {
    if (this.wslAvailable !== null) {
      console.log(`[CommandRegistry] checkWslAvailable: cached=${this.wslAvailable}`);
      return this.wslAvailable;
    }
    try {
      const { execSync } = require('child_process');
      console.log('[CommandRegistry] checkWslAvailable: testing wsl.exe...');
      execSync('wsl -e echo ok', { stdio: 'ignore', timeout: 3000 });
      this.wslAvailable = true;
      console.log('[CommandRegistry] checkWslAvailable: wsl.exe OK');
    } catch (err: any) {
      console.warn(`[CommandRegistry] wsl.exe not found or not working, falling back to cmd... Error: ${err.message || err}`);
      this.wslAvailable = false;
    }
    return this.wslAvailable;
  }

  public async execute(id: string, command: string, cwd: string = path.join(os.homedir(), '.everfern'), onData?: (data: string) => void): Promise<CommandInfo> {
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
        shell = 'wsl';
        const { translateWindowsPathToLinux } = require('../linux-vm-executor');
        const linuxCwd = translateWindowsPathToLinux(cwd);
        const wslCommand = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin" && cd "${linuxCwd}" && ${command}`;
        args = ['--exec', 'bash', '-c', wslCommand];
        spawnOptions = { shell: true, env: { ...process.env, WSL_UTF8: '1', WSLENV: '' } }; // DO NOT pass Windows path as cwd to wsl spawnOptions, use shell for WSL
      } else {
        console.log('[CommandRegistry] execute: WSL not available, using Host Fallback (CMD)');
        shell = 'cmd.exe';
        args = ['/c', command];
        spawnOptions.shell = true;
      }
    }

    // Create a detailed debug header to prepend to output
    const environmentType = process.platform === 'win32'
      ? (shell === 'wsl' ? 'WSL (Ubuntu)' : 'Host Fallback (CMD)')
      : process.platform === 'darwin'
      ? 'Host (macOS)'
      : 'Native Linux';

    const debugHeader = `[EverFern VM Debug - Environment: ${environmentType}]\n` +
      `Command: ${command}\n` +
      `--------------------------------------------------\n`;

    info.output = debugHeader;

    const proc = spawn(shell, args, spawnOptions);
    this.processes.set(id, proc);
    info.pid = proc.pid;

    const MAX_OUTPUT_LENGTH = 50000;

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
      const decoded = decodeBuffer(data);
      console.log(`[Terminal] ${decoded.trimEnd()}`);
      info.output += decoded;
      onData?.(decoded);
      if (info.output.length > MAX_OUTPUT_LENGTH) {
        info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.stderr?.on('data', (data) => {
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
        info.status = code === 0 ? 'completed' : 'failed';
        info.exitCode = code ?? -1;
        this.processes.delete(id);
        resolve(info);
      });

      proc.on('error', (err) => {
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
