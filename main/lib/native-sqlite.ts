/**
 * A stand-in for `sqlite3.Database` backed by the Tauri shell (src-tauri/src/sqlite_server.rs),
 * so the sidecar doesn't load the sqlite3 native addon. Each database is one long-running
 * `everfern --ef-sqlite <file>` process; requests are JSON lines answered in order.
 *
 * Only the parts of the sqlite3 API this app uses are here: run/get/all/exec with the same
 * callback shapes (run's callback gets `this.lastID` / `this.changes`), serialize, parallelize,
 * loadExtension and close. Electron builds keep using the sqlite3 addon.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";
import type sqlite3 from "sqlite3";

export function hasNativeSqlite(): boolean {
  return process.env.EVERFERN_SHELL === "tauri" && !!process.env.EF_NATIVE_EXE;
}

type Callback = (this: any, err: Error | null, result?: any) => void;
type Reply = { id: number; error?: string; code?: string; lastID?: number; changes?: number; row?: any; rows?: any[] };

const BLOB_KEY = "$b";

function encodeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (Buffer.isBuffer(value)) return { [BLOB_KEY]: value.toString("base64") };
  if (ArrayBuffer.isView(value)) {
    return { [BLOB_KEY]: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  }
  if (value instanceof ArrayBuffer) return { [BLOB_KEY]: Buffer.from(value).toString("base64") };
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value);
  return value;
}

function encodeParams(params: unknown): unknown {
  if (Array.isArray(params)) return params.map(encodeParam);
  if (params && typeof params === "object" && !ArrayBuffer.isView(params) && !Buffer.isBuffer(params)) {
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, encodeParam(v)]));
  }
  return [];
}

function decodeRow(row: any): any {
  if (!row) return row;
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value && typeof value === "object" && typeof value[BLOB_KEY] === "string") {
      row[key] = Buffer.from(value[BLOB_KEY], "base64");
    }
  }
  return row;
}

/** sqlite3 accepts `(sql, cb)`, `(sql, [params], cb)`, `(sql, {named}, cb)` and `(sql, p1, p2, cb)`. */
function splitArgs(args: unknown[]): { params: unknown; callback?: Callback } {
  const callback = typeof args[args.length - 1] === "function" ? (args.pop() as Callback) : undefined;
  if (args.length === 1 && args[0] !== null && typeof args[0] === "object"
    && !Buffer.isBuffer(args[0]) && !ArrayBuffer.isView(args[0]) && !(args[0] instanceof Date)) {
    return { params: args[0], callback };
  }
  return { params: args, callback };
}

function toError(reply: { error?: string; code?: string }): Error {
  const error = new Error(reply.error || "SQLITE_ERROR: unknown error") as Error & { code?: string; errno?: number };
  error.code = reply.code || "SQLITE_ERROR";
  return error;
}

export class NativeDatabase {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (reply: Reply) => void>();
  private closed = false;
  private stderr = "";

  constructor(readonly filename: string, modeOrCallback?: number | Callback, maybeCallback?: Callback) {
    const onOpen = typeof modeOrCallback === "function" ? modeOrCallback : maybeCallback;
    this.child = spawn(process.env.EF_NATIVE_EXE!, ["--ef-sqlite", filename], { windowsHide: true });
    this.pending.set(0, (reply) => {
      if (reply.error) this.closed = true;
      onOpen?.call(this, reply.error ? toError(reply) : null);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let reply: Reply;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      const handler = this.pending.get(reply.id);
      if (!handler) return;
      this.pending.delete(reply.id);
      if (this.pending.size === 0) this.setBusy(false);
      handler(reply);
    });
    this.child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-2000); });
    const fail = (message: string) => {
      this.closed = true;
      const waiting = [...this.pending.values()];
      this.pending.clear();
      for (const handler of waiting) handler({ id: -1, error: `SQLITE_MISUSE: ${message}`, code: "SQLITE_MISUSE" });
    };
    this.child.on("error", (e) => fail(`could not start the database process: ${e.message}`));
    this.child.on("exit", (code) => {
      if (this.pending.size) fail(`database process exited (code ${code}) ${this.stderr.trim()}`.trim());
      this.closed = true;
    });
    // Keep Node alive only while a request is waiting, not for an idle database.
    (this.child.stderr as any).unref?.();
    (this.child.stdin as any).unref?.();
    this.setBusy(true);
  }

  private setBusy(busy: boolean): void {
    const method = busy ? "ref" : "unref";
    this.child[method]();
    (this.child.stdout as any)[method]?.();
  }

  private send(request: Record<string, unknown>, onReply: (reply: Reply) => void): void {
    if (this.closed) {
      const reply = { id: -1, error: "SQLITE_MISUSE: Database is closed", code: "SQLITE_MISUSE" };
      process.nextTick(() => onReply(reply));
      return;
    }
    const id = this.nextId++;
    if (this.pending.size === 0) this.setBusy(true);
    this.pending.set(id, onReply);
    this.child.stdin.write(JSON.stringify({ id, ...request }) + "\n");
  }

  private query(op: "run" | "get" | "all", sql: string, args: unknown[]): this {
    const { params, callback } = splitArgs(args);
    this.send({ op, sql, params: encodeParams(params) }, (reply) => {
      if (reply.error) {
        if (callback) callback.call(this, toError(reply));
        else console.error(`[sqlite] ${op} failed: ${reply.error}`);
        return;
      }
      if (op === "run") callback?.call({ lastID: reply.lastID, changes: reply.changes, sql }, null);
      else if (op === "get") callback?.call(this, null, reply.row === null ? undefined : decodeRow(reply.row));
      else callback?.call(this, null, (reply.rows || []).map(decodeRow));
    });
    return this;
  }

  run(sql: string, ...args: unknown[]): this { return this.query("run", sql, args); }
  get(sql: string, ...args: unknown[]): this { return this.query("get", sql, args); }
  all(sql: string, ...args: unknown[]): this { return this.query("all", sql, args); }

  exec(sql: string, callback?: Callback): this {
    this.send({ op: "exec", sql }, (reply) => {
      if (reply.error && !callback) console.error(`[sqlite] exec failed: ${reply.error}`);
      callback?.call(this, reply.error ? toError(reply) : null);
    });
    return this;
  }

  loadExtension(path: string, callback?: Callback): this {
    this.send({ op: "loadExtension", path }, (reply) => callback?.call(this, reply.error ? toError(reply) : null));
    return this;
  }

  /** Requests already run one at a time, in order. */
  serialize(fn?: () => void): void { fn?.(); }
  parallelize(fn?: () => void): void { fn?.(); }

  close(callback?: Callback): void {
    if (this.closed) {
      process.nextTick(() => callback?.call(this, toError({ error: "SQLITE_MISUSE: Database is closed", code: "SQLITE_MISUSE" })));
      return;
    }
    this.send({ op: "close" }, (reply) => {
      this.closed = true;
      this.child.stdin.end();
      callback?.call(this, reply.error ? toError(reply) : null);
    });
  }
}

/**
 * The Database class to open databases with: the Rust-backed one under the Tauri shell,
 * otherwise the sqlite3 addon (loaded only then).
 */
export function sqliteDatabaseClass(): typeof sqlite3.Database {
  if (hasNativeSqlite()) return NativeDatabase as unknown as typeof sqlite3.Database;
  return (require("sqlite3") as typeof sqlite3).Database;
}
