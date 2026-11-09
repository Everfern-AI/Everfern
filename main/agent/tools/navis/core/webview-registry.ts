/**
 * Navis — worker browser windows
 *
 * The Workers screen shows each web app in a window. On this computer that is a
 * real <webview> (partition "persist:worker-<id>"); on a cloud worker it is the
 * screen of its EverFern Cloud VM, whose Chromium runs every web app. The renderer
 * registers those windows here so that a Navis call made by that worker's
 * conversation ("worker-<id>") drives the window the user is watching instead of
 * a separate browser.
 */
import { webContents, type WebContents } from 'electron';
import { WebviewDriver, type PageDriver } from './page-driver';
import { CloudVmDriver } from './cloud-vm-driver';
import { LocalVmDriver } from './local-vm-driver';

type Entry = { app: string; wcId: number; at: number };
type VmEntry = { app: string; at: number; driver: CloudVmDriver };
type Vm = { vmId: string; apiUrl: string; token: string };

const byWorker = new Map<string, Map<string, Entry>>();
const localByWorker = new Map<string, Map<string, { app: string; driver: LocalVmDriver; at: number; url: string }>>();

export function registerWorkerLocalVm(partition: unknown, app: unknown, url: unknown): boolean {
  const key = workerKeyForPartition(partition);
  if (!key || !okApp(app) || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  vmByWorker.delete(key);
  const apps = localByWorker.get(key) ?? new Map();
  apps.set(app, { app, driver: apps.get(app)?.driver ?? new LocalVmDriver(url), at: Date.now(), url });
  localByWorker.set(key, apps);
  return true;
}
export function unregisterWorkerLocalVm(partition: unknown, app: unknown): void {
  const key = workerKeyForPartition(partition);
  if (!key || typeof app !== 'string') return;
  localByWorker.get(key)?.delete(app);
  if (!localByWorker.get(key)?.size) localByWorker.delete(key);
}
/** Cloud workers: the VM, plus which of its app windows are open. */
const vmByWorker = new Map<string, { vm: Vm; apps: Map<string, VmEntry> }>();

/** "persist:worker-<id>" -> "worker-<id>" (the worker's conversation id). */
export function workerKeyForPartition(partition: unknown): string | null {
  const m = typeof partition === 'string' ? partition.match(/^persist:(worker-[A-Za-z0-9-]{1,64})$/) : null;
  return m ? m[1] : null;
}

/**
 * Worker runs use a fresh conversation per task ("worker-<id>-run-<timestamp>") so
 * one task never resumes another's thread. Windows, VM registrations and workspaces
 * are still keyed by the worker, so callers normalize through this first.
 */
export function baseWorkerKey(conversationId: unknown): string | null {
  if (typeof conversationId !== 'string' || !conversationId.startsWith('worker-')) return null;
  const m = conversationId.match(/^(worker-.+?)-run-\d{10,}$/);
  return m ? m[1] : conversationId;
}

function alive(id: number): WebContents | null {
  const wc = webContents.fromId(id);
  return wc && !wc.isDestroyed() && wc.getType() === 'webview' ? wc : null;
}

const okApp = (app: unknown): app is string => typeof app === 'string' && /^[\w-]{1,40}$/.test(app);

export function registerWorkerWebview(partition: unknown, app: unknown, wcId: unknown): boolean {
  const key = workerKeyForPartition(partition);
  if (!key || !okApp(app) || typeof wcId !== 'number') return false;
  if (!alive(wcId)) return false;
  let apps = byWorker.get(key);
  if (!apps) byWorker.set(key, (apps = new Map()));
  apps.set(app, { app, wcId, at: Date.now() });
  return true;
}

export function unregisterWorkerWebview(partition: unknown, app: unknown, wcId?: unknown): void {
  const key = workerKeyForPartition(partition);
  const apps = key ? byWorker.get(key) : undefined;
  if (!apps || typeof app !== 'string') return;
  const e = apps.get(app);
  if (e && (wcId === undefined || e.wcId === wcId)) apps.delete(app);
}

/** The API the renderer talks to: EverFern's, or a local one while developing. */
function okApiUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    if (url.protocol === 'https:' && (url.hostname === 'everfern.app' || url.hostname.endsWith('.everfern.app'))) return true;
    return url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  } catch { return false; }
}

/** A cloud worker's app window, showing its VM. The token is the user's EverFern session, kept in memory only. */
export function registerWorkerCloudVm(partition: unknown, app: unknown, vmId: unknown, apiUrl: unknown, token: unknown): boolean {
  const key = workerKeyForPartition(partition);
  if (!key || !okApp(app) || typeof vmId !== 'string' || !/^[\w-]{1,64}$/.test(vmId) || !okApiUrl(apiUrl)) return false;
  if (typeof token !== 'string' || !token || token.length > 8192) return false;
  localByWorker.delete(key);
  const base = apiUrl.replace(/\/+$/, '');
  let rec = vmByWorker.get(key);
  if (!rec || rec.vm.vmId !== vmId || rec.vm.apiUrl !== base) {
    rec = { vm: { vmId, apiUrl: base, token }, apps: new Map() };
    vmByWorker.set(key, rec);
  }
  rec.vm.token = token;
  // One driver per app window: each drives its own tab, the one that window shows.
  const vm = rec.vm;
  const driver = rec.apps.get(app)?.driver ?? new CloudVmDriver({ vmId, apiUrl: base, token: () => vm.token, app, worker: key.slice('worker-'.length) });
  rec.apps.set(app, { app, at: Date.now(), driver });
  return true;
}

export function unregisterWorkerCloudVm(partition: unknown, app: unknown): void {
  const key = workerKeyForPartition(partition);
  const rec = key ? vmByWorker.get(key) : undefined;
  if (!rec || typeof app !== 'string') return;
  rec.apps.delete(app);
  if (!rec.apps.size) vmByWorker.delete(key!);
}

const hostOf = (url?: string) => {
  try { return url ? new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};
const sameSite = (a: string, b: string) => Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));

/**
 * The window a worker's Navis run should drive: the one already on the start URL's
 * site if there is one, otherwise the one the user used last. A cloud worker's
 * windows each show their own tab of its VM's browser, and drive that tab.
 */
export function pickWorkerWindow(conversationId: unknown, startUrl?: string, app?: string): { app: string; driver: PageDriver } | null {
  if (typeof conversationId !== 'string') return null;
  const key = baseWorkerKey(conversationId) ?? conversationId;
  const want = hostOf(startUrl);
  const local = localByWorker.get(key);
  if (local?.size) {
    const apps = [...local.values()];
    const pick = app ? apps.find(e => e.app === app) : apps.find((e) => sameSite(hostOf(e.url), want)) ?? apps.sort((a, b) => b.at - a.at)[0];
    if (!pick) return null;
    return { app: pick.app, driver: pick.driver };
  }

  const vm = vmByWorker.get(key);
  if (vm && vm.apps.size) {
    const list = [...vm.apps.values()];
    // The app window for the start URL's site (its name is the app id, e.g. "notion"), else the latest.
    const site = want.split('.').slice(-2, -1)[0] || '';
    const pick = app ? list.find(e => e.app === app) : list.find((e) => site && e.app === site) ?? list.sort((a, b) => b.at - a.at)[0];
    if (!pick) return null;
    return { app: pick.app, driver: pick.driver };
  }

  // Workers may never fall back to Electron/host browser views.
  if (key.startsWith('worker-')) return null;
  const apps = byWorker.get(key);
  if (!apps) return null;
  const live: Array<Entry & { wc: WebContents }> = [];
  for (const e of apps.values()) {
    const wc = alive(e.wcId);
    if (wc) live.push({ ...e, wc }); else apps.delete(e.app);
  }
  if (!live.length) return null;
  const same = want ? live.find((e) => sameSite(hostOf(e.wc.getURL()), want)) : undefined;
  const pick = same ?? live.sort((a, b) => b.at - a.at)[0];
  return { app: pick.app, driver: new WebviewDriver(pick.wc) };
}
