import { spawn, type ChildProcess } from 'child_process';

const children = new Set<ChildProcess>();
process.once('exit', () => {
  for (const child of children) child.kill();
});

/** Native request helpers share the compatibility backend's lifetime. */
export function spawnNative(executable: string, args: string[]) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}
