/**
 * Worker sandbox: the boundary around a local worker's computer.
 *
 * Every local worker command (worker_bash, Files, Terminal, watchers, file transfer)
 * runs in the worker VM (EverFern's Alpine distro on Windows, its Docker container on
 * macOS and Linux, never the host) as that worker's own Linux user. The user's home is
 * the worker's workspace, mode 700, so a worker cannot read another worker's files,
 * the main chat's workspace, or root's files.
 *
 * Host access is closed off in the VM itself: /mnt (Windows drives), /host (the Docker
 * bind mounts) and /run/WSL (the sockets that start Windows programs) are root-only,
 * and Windows interop is turned off in wsl.conf from the next VM start.
 *
 * File transfer never lets root follow a path the worker controls: bytes are piped
 * through `cat` running as the worker, so a symlink in the workspace can only reach
 * what the worker could read anyway.
 */
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { ALPINE_HOME } from './alpine-vm';
import { runInWorkerVM, spawnInWorkerVM, type LinuxVMExecutionResult } from './linux-vm-executor';

export const shq = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

const ok = (id: string) => /^[A-Za-z0-9-]{1,64}$/.test(id);
function check(workerId: string): void {
  if (!ok(workerId)) throw new Error('Invalid worker id');
}

/** The worker's Linux user: stable, short, and never a name the VM already uses. */
export const workerUser = (workerId: string) => 'efw' + createHash('sha256').update(workerId).digest('hex').slice(0, 13);

/** The worker's workspace inside the VM (its user's home). */
export const workerHome = (workerId: string) => `${ALPINE_HOME}/everfern-workers/${workerId}`;

const H = ALPINE_HOME;
const VM_PREP = [
  `mkdir -p ${H}/everfern-workers ${H}/.everfern/workspace ${H}/.everfern/exec ${H}/.everfern/artifacts ${H}/.everfern/uploads`,
  // Workers may pass through root's home to reach their own workspace and the shared
  // Python/Node tools, and nothing else in it.
  `chmod 711 ${H} ${H}/everfern-workers ${H}/.everfern`,
  `for e in ${H}/* ${H}/.[!.]*; do case "$e" in ${H}/everfern-workers|${H}/.everfern) ;; *) [ -e "$e" ] && chmod go-rwx "$e" 2>/dev/null ;; esac; done`,
  `for e in ${H}/.everfern/* ${H}/.everfern/.[!.]*; do case "$e" in ${H}/.everfern/venv|${H}/.everfern/node_modules) ;; *) [ -e "$e" ] && chmod go-rwx "$e" 2>/dev/null ;; esac; done`,
  `chmod 700 ${H}/.everfern/workspace ${H}/.everfern/exec ${H}/.everfern/artifacts ${H}/.everfern/uploads`,
  `[ -e ${H}/.everfern/.worker-perms ] || { for d in ${H}/.everfern/venv ${H}/.everfern/node_modules; do [ -d "$d" ] && chmod -R o+rX "$d"; done; touch ${H}/.everfern/.worker-perms; }`,
  // No way out to this computer: its drives, its bind mounts, its program launcher.
  `for d in /mnt /host /run/WSL; do [ -d "$d" ] && chmod 700 "$d"; done`,
  `if [ -f /etc/wsl.conf ] && ! grep -q '^enabled=false' /etc/wsl.conf; then sed -i 's/^\\[interop\\]$/[interop]\\nenabled=false/' /etc/wsl.conf; fi`,
  'command -v adduser >/dev/null && test -x /bin/su',
].join(' && ');

let vmReady: Promise<void> | null = null;
const workerReady = new Map<string, Promise<void>>();

async function must(p: Promise<LinuxVMExecutionResult>, what: string): Promise<LinuxVMExecutionResult> {
  const r = await p;
  if (r.exitCode !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 400)}`);
  return r;
}

function prepareVm(): Promise<void> {
  vmReady ??= must(runInWorkerVM(VM_PREP), 'Could not prepare the worker VM').then(() => undefined, (e) => { vmReady = null; throw e; });
  return vmReady;
}

/** Creates the worker's user and hands it its workspace (once per app run). */
export function prepareWorker(workerId: string): Promise<void> {
  check(workerId);
  let p = workerReady.get(workerId);
  if (!p) {
    const u = workerUser(workerId), ws = shq(workerHome(workerId));
    p = prepareVm().then(() => must(runInWorkerVM([
      `mkdir -p ${ws}`,
      `{ id -u ${u} >/dev/null 2>&1 || adduser -D -H -h ${ws} -s /bin/bash -g 'EverFern worker' ${u}; }`,
      // -h: never follow a symlink the worker planted to chown something outside.
      `{ [ "$(stat -c %U ${ws})" = ${u} ] || chown -Rh ${u}:${u} ${ws}; }`,
      `chmod 700 ${ws}`,
    ].join(' && ')), 'Could not set up the worker\'s account')).then(() => undefined, (e) => { workerReady.delete(workerId); throw e; });
    workerReady.set(workerId, p);
  }
  return p;
}

/** Forget a worker's prepared state (after deleting it). */
export function forgetWorker(workerId: string): void {
  workerReady.delete(workerId);
}

/**
 * A shell line (run as root in the VM) that runs `command` as the worker, in its
 * workspace, with a clean environment.
 */
export function asWorker(workerId: string, command: string, opts: { exec?: boolean } = {}): string {
  check(workerId);
  const ws = workerHome(workerId);
  const inner = [
    `cd ${shq(ws)}`,
    `export HOME=${shq(ws)} VIRTUAL_ENV=${H}/.everfern/venv NODE_PATH=${H}/.everfern/node_modules ` +
      `PATH=${H}/.everfern/venv/bin:${H}/.everfern/node_modules/.bin:${shq(ws)}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    command,
  ].join(' && ');
  return `${opts.exec ? 'exec ' : ''}env -i TERM="\${TERM:-xterm-256color}" LANG=C.UTF-8 /bin/su -s /bin/bash ${workerUser(workerId)} -c ${shq(inner)}`;
}

/** Runs a command as the worker in its workspace. */
export async function runAsWorker(workerId: string, command: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  await prepareWorker(workerId);
  return runInWorkerVM(asWorker(workerId, command), onUpdate);
}

/** Starts a long-lived process as the worker (Terminal, folder watcher). */
export async function spawnAsWorker(workerId: string, command: string) {
  await prepareWorker(workerId);
  return spawnInWorkerVM(asWorker(workerId, command, { exec: true }));
}

function finish(proc: import('child_process').ChildProcessWithoutNullStreams, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-1000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${what} (exit ${code})`))));
  });
}

/** Copies a file on this computer to `rel` in the workspace, written by the worker itself. */
export async function pipeIntoWorkspace(workerId: string, hostPath: string, rel: string): Promise<void> {
  const r = shq(rel);
  const proc = await spawnAsWorker(workerId,
    `mkdir -p -- "$(dirname -- ${r})" && t=$(mktemp -p "$(dirname -- ${r})" .efpart.XXXXXX) && { cat > "$t" && mv -f -- "$t" ${r}; } || { rm -f -- "$t"; exit 1; }`);
  const done = finish(proc, `Could not save ${rel}`);
  const src = createReadStream(hostPath);
  src.on('error', (e) => { proc.stdin.destroy(e); proc.kill(); });
  src.pipe(proc.stdin);
  await done;
}

/** Copies `rel` from the workspace to a file on this computer, read by the worker itself. */
export async function pipeOutOfWorkspace(workerId: string, rel: string, hostPath: string, maxBytes: number): Promise<void> {
  const proc = await spawnAsWorker(workerId, `test -f ${shq(rel)} && exec cat -- ${shq(rel)}`);
  const done = finish(proc, `${rel} is not a file in this worker's workspace`);
  const out = createWriteStream(hostPath);
  let size = 0, tooBig = false;
  proc.stdout.on('data', (b: Buffer) => {
    size += b.length;
    if (size > maxBytes && !tooBig) { tooBig = true; proc.kill(); }
  });
  proc.stdout.pipe(out);
  try {
    await done;
  } catch (e) {
    if (tooBig) throw new Error('File is too large to open here.');
    throw e;
  } finally {
    await new Promise<void>((res) => (out.writableFinished ? res() : out.end(res)));
  }
  if (tooBig) throw new Error('File is too large to open here.');
}

/**
 * A copy of a workspace file that the VM's own browser (running as root) can upload.
 * The copy is made by the worker, so a symlink cannot hand the browser a file the
 * worker could not read.
 */
export async function stageForVmBrowser(workerId: string, rel: string): Promise<string> {
  await prepareWorker(workerId);
  const name = rel.split('/').pop()!.replace(/[^\w.\- ()]+/g, '_') || 'file';
  const r = await runInWorkerVM(
    `d=$(mkdir -p ${H}/.everfern/uploads/${workerId} && mktemp -d ${H}/.everfern/uploads/${workerId}/XXXXXX) && ` +
    `${asWorker(workerId, `test -f ${shq(rel)} && cat -- ${shq(rel)}`)} > "$d"/${shq(name)} && printf %s "$d"/${shq(name)}`);
  const p = r.stdout.trim();
  if (r.exitCode !== 0 || !p.startsWith(`${H}/.everfern/uploads/`)) throw new Error(r.stderr.trim() || `${rel} is not a file in this worker's workspace`);
  return p;
}

/** Removes the worker's workspace, staged uploads and Linux user from the VM. */
export async function destroyWorkerVm(workerId: string): Promise<void> {
  check(workerId);
  const u = workerUser(workerId);
  forgetWorker(workerId);
  await must(runInWorkerVM([
    `pkill -KILL -u ${u} 2>/dev/null; true`,
    `rm -rf -- ${shq(workerHome(workerId))} ${H}/.everfern/uploads/${workerId}`,
    `{ ! id -u ${u} >/dev/null 2>&1 || deluser ${u} 2>/dev/null || true; }`,
  ].join(' && ')), 'Could not remove the worker\'s files');
}
