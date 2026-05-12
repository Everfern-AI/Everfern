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

  private constructor() {}

  public static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  public async execute(id: string, command: string, cwd: string = path.join(os.homedir(), '.everfern')): Promise<CommandInfo> {
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

    let shell = isWin ? 'wsl.exe' : 'bash';
    let args = isWin ? ['--exec', 'bash', '-c', command] : ['-c', command];
    let spawnOptions: any = { cwd, shell: false };

    // Robust shell detection for Windows
    if (isWin) {
      try {
        // Test if wsl.exe is available
        const { execSync } = require('child_process');
        execSync('wsl.exe --status', { stdio: 'ignore' });
      } catch (e) {
        console.warn('[CommandRegistry] wsl.exe not found or not working, falling back to powershell...');
        shell = 'powershell.exe';
        args = ['-NoProfile', '-Command', command];
      }
    }

    const proc = spawn(shell, args, spawnOptions);
    this.processes.set(id, proc);
    info.pid = proc.pid;

    const MAX_OUTPUT_LENGTH = 50000;

    proc.stdout?.on('data', (data) => {
      info.output += data.toString();
      if (info.output.length > MAX_OUTPUT_LENGTH) {
        info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.stderr?.on('data', (data) => {
      info.output += data.toString();
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
