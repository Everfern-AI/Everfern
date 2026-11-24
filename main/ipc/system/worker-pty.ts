/**
 * Worker Terminal: a real pseudo-terminal on the worker's computer, so full-screen
 * programs (btop, htop, vim, less, top) render exactly as in a Linux terminal.
 *
 * A small Python bridge runs inside the VM, opens a PTY and starts the shell:
 *  - local worker (WSL / Docker): the bridge talks over the spawned process's pipes;
 *  - cloud worker: the VM only offers request/response commands, so the bridge runs
 *    detached, reads keystrokes from a FIFO and appends screen output to a file that
 *    this side polls.
 * Sessions are per worker and outlive the window, so a minimized btop keeps running.
 *
 *  workers:pty-open (workerId, cols, rows) -> { id, backlog } | { error }
 *  workers:pty-write (id, data) / workers:pty-resize (id, cols, rows) / workers:pty-kill (id)
 *  events: worker:pty-data { id, data }, worker:pty-exit { id }
 */
import { ipcMain, type WebContents } from 'electron';
import { StringDecoder } from 'string_decoder';
import { spawnAsWorker } from '../../agent/tools/worker-sandbox';
import { workspaceExec, workspaceIsCloud } from '../../agent/tools/worker-tools';

const BRIDGE = String.raw`
import os, sys, pty, select, struct, fcntl, termios, signal, re
RC = r'''
[ -f /etc/bash/bashrc ] && . /etc/bash/bashrc
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f ~/.bashrc ] && . ~/.bashrc
PS1='\[\e[32m\]worker@everfern\[\e[0m\] \[\e[1m\]\W\[\e[0m\] % '
alias ls='ls --color=auto' 2>/dev/null
alias grep='grep --color=auto' 2>/dev/null
'''
cols, rows = int(sys.argv[1]), int(sys.argv[2])
mode = sys.argv[3] if len(sys.argv) > 3 else 'stdio'
rc = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'everfern-bashrc-%d' % os.getpid())
with open(rc, 'w') as f:
    f.write(RC)
pid, fd = pty.fork()
if pid == 0:
    os.environ.update(TERM='xterm-256color', COLORTERM='truecolor', LANG=os.environ.get('LANG') or 'C.UTF-8')
    for sh in ('/bin/bash', '/usr/bin/bash'):
        if os.path.exists(sh):
            os.execv(sh, [sh, '--rcfile', rc, '-i'])
    os.environ['PS1'] = 'worker@everfern % '
    os.execv('/bin/sh', ['sh', '-i'])

def size(c, r):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    except OSError:
        pass

def put(dst, b):
    while b:
        n = os.write(dst, b)
        b = b[n:]

size(cols, rows)
if mode == 'stdio':
    inp, out = 0, 1
else:
    os.makedirs(mode, exist_ok=True)
    p = os.path.join(mode, 'in')
    if not os.path.exists(p):
        os.mkfifo(p)
    inp = os.open(p, os.O_RDWR)
    out = os.open(os.path.join(mode, 'out'), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with open(os.path.join(mode, 'pid'), 'w') as f:
        f.write(str(os.getpid()))

pat = re.compile(rb'\x1b\]777;resize;(\d+);(\d+)\x07')
buf = b''
while True:
    try:
        r, _, _ = select.select([fd, inp], [], [], 30)
    except InterruptedError:
        continue
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        put(out, data)
    if inp in r:
        data = os.read(inp, 65536)
        if not data:
            break
        buf += data
        while True:
            m = pat.search(buf)
            if not m:
                break
            put(fd, buf[:m.start()])
            size(int(m.group(1)), int(m.group(2)))
            buf = buf[m.end():]
        keep = b''
        i = buf.rfind(b'\x1b]777;')
        if i >= 0 and b'\x07' not in buf[i:] and len(buf) - i < 40:
            keep, buf = buf[i:], buf[:i]
        if buf:
            put(fd, buf)
        buf = keep
for f in (lambda: os.kill(pid, signal.SIGHUP), lambda: os.remove(rc)):
    try:
        f()
    except OSError:
        pass
if mode != 'stdio':
    with open(os.path.join(mode, 'exit'), 'w') as f:
        f.write('1')
`;
const BRIDGE_B64 = Buffer.from(BRIDGE, 'utf-8').toString('base64');
const runBridge = (args: string) => `python3 -c "$(printf %s '${BRIDGE_B64}' | base64 -d)" ${args}`;

const BACKLOG = 256 * 1024;
const resizeSeq = (c: number, r: number) => `\x1b]777;resize;${c};${r}\x07`;
const clampSize = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};

type Session = {
  id: string;
  workerId: string;
  sender?: WebContents;
  backlog: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

const sessions = new Map<string, Session>(); // by workerId
let nextId = 1;

function emit(s: Session, data: string) {
  s.backlog = (s.backlog + data).slice(-BACKLOG);
  if (s.sender && !s.sender.isDestroyed()) s.sender.send('worker:pty-data', { id: s.id, data });
}
function ended(s: Session) {
  if (sessions.get(s.workerId) === s) sessions.delete(s.workerId);
  if (s.sender && !s.sender.isDestroyed()) s.sender.send('worker:pty-exit', { id: s.id });
}

/** Local worker: the bridge's stdio is the terminal. */
async function openLocal(workerId: string, cols: number, rows: number): Promise<Session> {
  // As the worker's own user, in its workspace (worker-sandbox.ts), never on the host.
  const proc = await spawnAsWorker(workerId, `exec ${runBridge(`${cols} ${rows}`)}`);
  const s: Session = {
    id: `pty-${nextId++}`, workerId, backlog: '',
    write: (d) => { if (proc.stdin.writable) proc.stdin.write(d); },
    resize: (c, r) => { if (proc.stdin.writable) proc.stdin.write(resizeSeq(c, r)); },
    kill: () => { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } },
  };
  const dec = new StringDecoder('utf8');
  proc.stdout.on('data', (b: Buffer) => emit(s, dec.write(b)));
  let err = '';
  proc.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-2000); });
  proc.on('exit', () => {
    if (err.trim() && !s.backlog) emit(s, `\r\n${err.trim().replace(/\n/g, '\r\n')}\r\n`);
    ended(s);
  });
  proc.on('error', (e) => { emit(s, `\r\nTerminal could not start: ${e.message}\r\n`); ended(s); });
  return s;
}

/** Cloud worker: detached bridge, keystrokes through a FIFO, output polled from a file. */
async function openCloud(workerId: string, cols: number, rows: number): Promise<Session> {
  const dir = `/tmp/everfern-pty-${workerId}`;
  // Reuse a bridge that is still running on the VM (the app restarted, the window reopened).
  const probe = await workspaceExec(workerId, `p=$(cat ${dir}/pid 2>/dev/null); if [ -n "$p" ] && [ ! -e ${dir}/exit ] && kill -0 "$p" 2>/dev/null; then stat -c %s ${dir}/out; else echo new; fi`);
  let offset = 0;
  const out = probe.stdout.trim();
  if (out === 'new' || !/^\d+$/.test(out)) {
    const r = await workspaceExec(workerId, `rm -rf ${dir} && mkdir -p ${dir} && (setsid ${runBridge(`${cols} ${rows} ${dir}`)} </dev/null >${dir}/log 2>&1 &) ; for i in 1 2 3 4 5 6 7 8 9 10; do [ -e ${dir}/pid ] && break; sleep 0.2; done; [ -e ${dir}/pid ] && echo ok || cat ${dir}/log`);
    if (r.stdout.trim() !== 'ok') throw new Error(r.stdout.trim() || r.stderr.trim() || 'The terminal could not start on the cloud computer.');
  } else {
    offset = Math.max(0, Number(out) - BACKLOG);
  }

  let alive = true;
  let pending = '';
  let flushing = false;
  let delay = 120;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dec = new StringDecoder('utf8');

  const s: Session = {
    id: `pty-${nextId++}`, workerId, backlog: '',
    write: (d) => { pending += d; void flush(); poke(); },
    resize: (c, r) => { pending += resizeSeq(c, r); void flush(); },
    kill: () => { alive = false; clearTimeout(timer); void workspaceExec(workerId, `kill $(cat ${dir}/pid 2>/dev/null) 2>/dev/null; rm -rf ${dir}`).catch(() => {}); },
  };

  // Keystrokes: batched so fast typing is one request.
  async function flush() {
    if (flushing || !pending || !alive) return;
    flushing = true;
    await new Promise((r) => setTimeout(r, 25));
    const data = pending; pending = '';
    try { await workspaceExec(workerId, `printf %s '${Buffer.from(data, 'utf-8').toString('base64')}' | base64 -d > ${dir}/in`); } catch { /* next poll reports */ }
    flushing = false;
    if (pending) void flush();
  }
  // Output: fast right after activity, slower when the screen is quiet.
  function poke() { delay = 80; clearTimeout(timer); timer = setTimeout(poll, 60); }
  async function poll() {
    if (!alive) return;
    try {
      const r = await workspaceExec(workerId, `n=$(stat -c %s ${dir}/out 2>/dev/null || echo 0); echo "$n"; if [ "$n" -gt ${offset} ]; then tail -c +${offset + 1} ${dir}/out | head -c 524288 | base64 | tr -d '\\n'; fi; echo; [ -e ${dir}/exit ] && echo EXIT`);
      const [, b64 = '', flag = ''] = r.stdout.split('\n');
      if (b64) {
        const buf = Buffer.from(b64, 'base64');
        offset += buf.length;
        emit(s, dec.write(buf));
        delay = 80;
      } else {
        delay = Math.min(700, delay * 1.5);
      }
      if (flag.trim() === 'EXIT') { alive = false; ended(s); return; }
    } catch {
      delay = 2000;
    }
    if (alive) timer = setTimeout(poll, delay);
  }
  void poll();
  return s;
}

export function registerWorkerPtyHandlers(safeId: (id: unknown) => string | null): void {
  ipcMain.handle('workers:pty-open', async (e, workerId: string, cols: number, rows: number) => {
    const id = safeId(workerId);
    if (!id) return { error: 'Invalid worker' };
    const c = clampSize(cols, 20, 500, 100), r = clampSize(rows, 5, 200, 30);
    let s = sessions.get(id);
    if (s) {
      s.sender = e.sender;
      s.resize(c, r);
      return { id: s.id, backlog: s.backlog };
    }
    try {
      s = workspaceIsCloud(id) ? await openCloud(id, c, r) : await openLocal(id, c, r);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    s.sender = e.sender;
    sessions.set(id, s);
    return { id: s.id, backlog: s.backlog };
  });
  const byId = (id: unknown) => [...sessions.values()].find((s) => s.id === id);
  ipcMain.on('workers:pty-write', (_e, id: string, data: string) => {
    if (typeof data === 'string' && data.length <= 1_000_000) byId(id)?.write(data);
  });
  ipcMain.on('workers:pty-resize', (_e, id: string, cols: number, rows: number) => {
    byId(id)?.resize(clampSize(cols, 20, 500, 100), clampSize(rows, 5, 200, 30));
  });
  ipcMain.handle('workers:pty-kill', (_e, id: string) => {
    const s = byId(id);
    if (s) { s.kill(); sessions.delete(s.workerId); }
    return true;
  });
}

/** Stop every terminal (app quit). */
/** Ends one worker's terminal (when the worker is deleted). */
export function killWorkerPty(workerId: string): void {
  const s = sessions.get(workerId);
  if (s) { s.kill(); sessions.delete(workerId); }
}

export function killWorkerPtys(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}
