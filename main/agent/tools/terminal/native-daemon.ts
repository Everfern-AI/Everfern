/**
 * Thin JSONL client for the persistent Rust terminal runtime. Process ownership,
 * shell state, streaming, command status and termination live in src-tauri.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import type { CommandInfo } from './registry';

type Callbacks = { onData?: (data: string) => void; emitEvent?: (event: any) => void };
type PendingCall = { resolve: (value: any) => void; reject: (error: Error) => void };

class NativeTerminalDaemon {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRid = 1;
  private pending = new Map<number, PendingCall>();
  private callbacks = new Map<string, Callbacks>();
  private commands = new Map<string, CommandInfo>();
  private stderr = '';

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return this.child;
    const executable = process.env.EF_NATIVE_EXE;
    if (!executable) throw new Error('Rust terminal runtime is unavailable: EF_NATIVE_EXE is not set');
    const child = spawn(executable, ['--ef-terminal-daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    const fail = (error: Error) => {
      if (this.child === child) this.child = null;
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const call of pending) call.reject(error);
      for (const info of this.commands.values()) {
        if (info.status !== 'running') continue;
        info.status = 'failed';
        info.exitCode = -1;
        info.output = `${info.output || ''}\n[Terminal runtime exited unexpectedly]`;
        this.callbacks.delete(info.id);
      }
    };
    child.on('error', (error) => fail(new Error(`Could not start Rust terminal runtime: ${error.message}`)));
    child.on('exit', (code, signal) => {
      fail(new Error(`Rust terminal runtime exited (${code ?? signal}) ${this.stderr.trim()}`.trim()));
    });
    return child;
  }

  private handleLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'response') {
      const call = this.pending.get(message.rid);
      if (!call) return;
      this.pending.delete(message.rid);
      call.resolve(message.result);
      return;
    }
    if (message.type === 'update' && message.info?.id) {
      const info = message.info as CommandInfo;
      this.commands.set(info.id, info);
      if (info.status !== 'running') this.callbacks.delete(info.id);
      return;
    }
    const callbacks = this.callbacks.get(message.commandId);
    if (!callbacks) return;
    if (message.type === 'chunk' && typeof message.data === 'string') {
      const current = this.commands.get(message.commandId);
      if (current) {
        current.output = `${current.output || ''}${message.data}`;
        if (current.output.length > 50_000) current.output = `...[Output truncated]...\n${current.output.slice(-50_000)}`;
      }
      callbacks.onData?.(message.data);
    } else if (message.type === 'stream' && message.event) {
      callbacks.onData?.(message.event.logs || '');
      callbacks.emitEvent?.(message.event);
    }
  }

  private call<T>(request: Record<string, unknown>): Promise<T> {
    let child: ChildProcessWithoutNullStreams;
    try { child = this.ensureChild(); } catch (error) { return Promise.reject(error); }
    const rid = this.nextRid++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ rid, ...request })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(rid);
        reject(error);
      });
    });
  }

  async execute(request: {
    id: string; command: string; cwd: string; timeoutMs?: number; target: 'main' | 'vm';
  }, callbacks: Callbacks): Promise<CommandInfo> {
    this.callbacks.set(request.id, callbacks);
    try {
      const info = await this.call<CommandInfo>({ op: 'execute', ...request });
      if (info?.id) {
        this.commands.set(info.id, info);
        if (info.status !== 'running') this.callbacks.delete(info.id);
        if (info.status === 'failed' && (info.exitCode ?? 0) !== 0) {
          try {
            const { appendPythonHintIfImportError } = require('../pi-tools');
            info.output = appendPythonHintIfImportError(info.output, info.target);
          } catch (error) {
            console.warn('[Terminal] Could not load Python recovery hint helper:', error);
          }
        }
      }
      return info;
    } catch (error) {
      this.callbacks.delete(request.id);
      const info: CommandInfo = {
        id: request.id,
        command: request.command,
        cwd: request.cwd,
        status: 'failed',
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: -1,
        startTime: Date.now(),
        target: request.target,
      };
      this.commands.set(info.id, info);
      return info;
    }
  }

  listCommands(): CommandInfo[] { return [...this.commands.values()]; }

  remember(info: CommandInfo): void { this.commands.set(info.id, info); }

  terminate(id: string): boolean {
    const info = this.commands.get(id);
    if (!info || info.status !== 'running') return false;
    void this.call<boolean>({ op: 'terminate', id }).catch((error) => console.error('[Terminal] Rust termination failed:', error));
    return true;
  }
}

const daemon = new NativeTerminalDaemon();

export function hasNativeTerminal(): boolean {
  return process.env.EVERFERN_SHELL === 'tauri' && !!process.env.EF_NATIVE_EXE;
}

export function getNativeTerminalDaemon(): NativeTerminalDaemon { return daemon; }
