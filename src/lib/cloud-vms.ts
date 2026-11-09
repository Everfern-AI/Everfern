"use client";

/**
 * EverFern Cloud VMs (Daytona, via api.everfern.app). Shared by Settings > Machine,
 * worker onboarding and the worker's Browser window.
 */

export const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "https://everfern.app";
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";

export type Limits = { plan: string; max_vms: number; max_running: number; cpu: number; memory_gb: number; disk_gb: number; monthly_minutes: number; auto_stop_minutes: number };
export type CloudVm = { id: string; name: string; status: string; region?: string; cpu: number; memory_gb: number; disk_gb: number; created_at: string; worker_id?: string | null };
export type Paywall = { reason: string; error: string; plan: string; limits?: Limits };

export function cloudToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const s = JSON.parse(localStorage.getItem("everfern_cloud_session") || "null");
    return s?.accessToken || localStorage.getItem("everfern_auth_token") || "";
  } catch {
    return localStorage.getItem("everfern_auth_token") || "";
  }
}

export async function cloudFetch(path: string, init: RequestInit = {}) {
  const native = typeof window !== "undefined" ? (window as any).__TAURI__?.core : undefined;
  if (native && API_URL === "https://api.everfern.app") {
    return native.invoke("ef_cloud_request", {
      path, method: (init.method || "GET").toUpperCase(), token: cloudToken(),
      body: typeof init.body === "string" ? init.body : null,
    }) as Promise<{ status: number; ok: boolean; data: any }>;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cloudToken()}`, ...(init.headers || {}) },
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, ok: res.ok, data };
}

const paywallOf = (d: any): Paywall => ({ reason: d.reason, error: d.error, plan: d.plan, limits: d.limits });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type EnsureResult = { vm: CloudVm } | { paywall: Paywall } | { error: string };

/**
 * The user's cloud computer for a worker: reuses their existing VM (one per user is the
 * default; Free includes one), starting it if it is stopped, or creates one.
 */
export async function ensureCloudVm(opts: { preferId?: string; name?: string; workerId?: string } = {}): Promise<EnsureResult> {
  try {
    if (opts.workerId) {
      const assigned = await cloudFetch('/api/cloud-machines/assign', { method: 'POST', body: JSON.stringify({ worker_id: opts.workerId, name: opts.name, machine_id: opts.preferId?.startsWith('vps-') ? opts.preferId : undefined }) });
      if (assigned.ok && assigned.data.vm) return { vm: assigned.data.vm };
      if (assigned.status !== 404 && assigned.status !== 405) return { error: assigned.data?.error || 'No cloud machine is available.' };
    }
    const list = await cloudFetch("/api/cloud-vms");
    if (!list.ok) return { error: list.data?.error || "Couldn't load your cloud VMs." };
    const vms: CloudVm[] = (list.data.vms ?? []).filter((v: CloudVm) => v.status !== "deleted" && v.status !== "error");
    let vm = vms.find((v) => v.id === opts.preferId) ?? vms.find((v) => v.status === "started") ?? vms[0];
    if (!vm) {
      const r = await cloudFetch("/api/cloud-vms", { method: "POST", body: JSON.stringify({ name: opts.name, worker_id: opts.workerId }) });
      if (r.status === 402) return { paywall: paywallOf(r.data) };
      if (!r.ok) return { error: r.data?.error || "Couldn't create your cloud VM." };
      vm = r.data.vm as CloudVm;
    } else if (vm.status === "stopped" || vm.status === "archived") {
      const r = await cloudFetch(`/api/cloud-vms/${vm.id}/start`, { method: "POST" });
      if (r.status === 402) return { paywall: paywallOf(r.data) };
      if (!r.ok) return { error: r.data?.error || "Couldn't start your cloud VM." };
      vm = (r.data.vm as CloudVm) ?? { ...vm, status: "starting" };
    }
    // Wait (briefly) for it to come up so the desktop can open straight away.
    for (let i = 0; i < 30 && vm.status !== "started"; i++) {
      await wait(2000);
      const r = await cloudFetch("/api/cloud-vms");
      const now = (r.data?.vms ?? []).find((v: CloudVm) => v.id === vm!.id);
      if (!now) return { error: "Your cloud VM disappeared while starting." };
      vm = now;
      if (vm.status === "error") return { error: "Your cloud VM failed to start." };
    }
    return { vm };
  } catch {
    return { error: "Couldn't reach EverFern Cloud." };
  }
}

/* ── VM browser cookies, kept on this computer ──────────────────────
 * The VM browser's cookies are copied to this computer (encrypted by the desktop app)
 * and put into any VM that doesn't have them yet, so a new cloud VM starts signed in. */

type BrowserState = { id: string; data: string; kind?: string };
const workersApi = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);

/** One cookie jar per EverFern account on this computer. */
function stateScope(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem("everfern_cloud_session") || "null");
    const id = String(s?.user?.id ?? "");
    return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A worker's own Browserbase browser has its own jar ("<account>.bb.<worker>"; "shared" without a worker). */
const bbScope = (worker?: string, app?: string) => {
  const account = stateScope();
  return account ? `${account}.bb.${(worker || "shared").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}${app ? `.app.${app.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}` : ''}` : null;
};

async function loadBrowserState(scope = stateScope()): Promise<BrowserState | null> {
  if (!scope) return null;
  try {
    const api = workersApi();
    return api?.browserStateLoad ? (await api.browserStateLoad(scope)) ?? null : await webBrowserState(scope);
  } catch { return null; }
}

/** Web/cloud edition: a local clone in this browser's IndexedDB, scoped like the desktop copy. */
function webBrowserState(scope: string, value?: BrowserState): Promise<BrowserState | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("everfern-browser-clones", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("states");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("states", value ? "readwrite" : "readonly");
      const store = tx.objectStore("states");
      const request = value ? store.put(value, scope) : store.get(scope);
      tx.oncomplete = () => { db.close(); resolve(value ?? request.result ?? null); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

// Serialize backups for each profile: an older request must never overwrite newer cookies.
const stateSaves = new Map<string, Promise<boolean>>();

/** Copies the VM browser's cookies to this computer if they changed. Best effort.
 *  engine "browserbase": the cookies of `worker`'s own browser, so a new VM puts them back. */
export async function saveCloudBrowserState(vmId: string, opts: { engine?: string; worker?: string; app?: string } = {}): Promise<boolean> {
  const key = opts.engine === "browserbase" || (opts.engine === "vps" || opts.engine === "browserless") || !opts.engine ? bbScope(opts.worker, opts.app) : stateScope();
  if (!key) return false;
  const pending = stateSaves.get(key);
  if (pending) return pending;
  const task = saveBrowserState(vmId, opts).finally(() => stateSaves.delete(key));
  stateSaves.set(key, task);
  return task;
}

async function saveBrowserState(vmId: string, opts: { engine?: string; worker?: string; app?: string }): Promise<boolean> {
  const api = workersApi();
  try {
    const bb = !opts.engine || opts.engine === "browserbase" || (opts.engine === "vps" || opts.engine === "browserless");
    const scope = bb ? bbScope(opts.worker, opts.app) : stateScope();
    if (!scope) return false;
    const have = await loadBrowserState(scope);
    const q = new URLSearchParams();
    q.set("engine", bb ? "browserbase" : opts.engine || "vm");
    if (bb) { q.set("engine", "browserbase"); if (opts.worker) q.set("worker", opts.worker); }
    if (have) q.set("since", have.id);
    if (opts.app) q.set("app", opts.app);
    const r = await cloudFetch(`/api/cloud-vms/${vmId}/browser-state${q.size ? `?${q}` : ""}`);
    if (r.ok && r.data?.unchanged) return true;
    if (!r.ok || !r.data?.id || !r.data.data) return false;
    if (api?.browserStateSave) {
      const result = await api.browserStateSave(scope, r.data.id, r.data.data, bb ? "cookies" : undefined);
      if (!result?.success) return false;
    } else {
      await webBrowserState(scope, { id: r.data.id, data: r.data.data, ...(bb ? { kind: "cookies" } : {}) });
    }
    return true;
  } catch {
    return false;
  }
}

/** A short-lived URL for the VM's screen. `open` shows that page in the VM's browser. */
/** engine: "browserbase" (a Browserbase live view), "kasmvnc" or "novnc" (the VM's own screen).
 *  app: the window asking. With Browserbase each app window has its own tab and live view, so windows never mix. */
/** `app`: the window asking (its own tab); `worker`: whose browser (its own cookies and logins). */
export async function cloudDesktopUrl(vmId: string, open?: string, app?: string, worker?: string): Promise<{ url?: string; engine?: string; warning?: string; error?: string; status?: string }> {
  try {
    const engine = app === "chrome" ? "vm" : "browserbase";
    const [state, appState, legacyState] = await Promise.all([loadBrowserState(), loadBrowserState(bbScope(worker, app)), loadBrowserState(bbScope(worker))]);
    const bbState = appState ?? legacyState;
    const req = async () => {
      const r = await cloudFetch(`/api/cloud-vms/${vmId}/desktop`, { method: "POST", body: JSON.stringify({
        engine, open: open || undefined, app: app || undefined, worker: worker || undefined,
        browser_state: state || undefined,
        // The worker's Browserbase cookies: put back once when this VM's browser for it is new.
        bb_state: bbState?.kind === "cookies" ? bbState : undefined,
      }) });
      // A server without cookie sync only takes GET.
      const q = new URLSearchParams({ engine });
      if (open) q.set("open", open);
      if (app) q.set("app", app);
      if (worker) q.set("worker", worker);
      return r.status === 405 ? cloudFetch(`/api/cloud-vms/${vmId}/desktop?${q}`) : r;
    };
    let r = await req();
    if (r.status === 409) {
      // Stopped (auto-stop after idle): start it and try again.
      const s = await ensureCloudVm({ preferId: vmId });
      if ("error" in s) return { error: s.error };
      if ("paywall" in s) return { error: s.paywall.error };
      r = await req();
    }
    if (r.ok && r.data.url) {
      if (engine === "browserbase" && !["browserbase", "vps", "browserless"].includes(r.data.engine)) {
        return { error: "The cloud server returned a shared desktop instead of this app's browser. Update the cloud API to enable separate app windows." };
      }
      return { url: r.data.url, engine: typeof r.data.engine === "string" ? r.data.engine : undefined, warning: r.data.warning || undefined };
    }
    return { error: r.data?.error || "Couldn't open the cloud desktop.", status: r.data?.status };
  } catch {
    return { error: "Couldn't reach EverFern Cloud." };
  }
}

/** Persist the current cookies before releasing this app's VPS desktop. */
export async function closeCloudApp(vmId: string, worker: string | undefined, app: string, onBackedUp?: () => void): Promise<void> {
  const saved = await saveCloudBrowserState(vmId, { worker, app });
  onBackedUp?.();
  // Disconnect the viewer before stopping; otherwise it may auto-reconnect.
  await new Promise(resolve => setTimeout(resolve, 0));
  // Retain the remote profile if the local backup could not be confirmed.
  if (!saved) return;
  await cloudFetch(`/api/cloud-vms/${encodeURIComponent(vmId)}/close-app`, { method: 'POST', body: JSON.stringify({ worker, app }) });
}
