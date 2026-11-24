"use client";

import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, RotateCw, Maximize2, Minimize2, Minus, X, Lock, WifiOff, ShieldAlert, Frown, FileX2, Cloud, Monitor, Volume2, VolumeX, Clipboard } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { APPS, startUrlFor } from "@/lib/apps";
import { WriteApp, loadDoc } from "./WriteApp";
import { FilesApp } from "./FilesApp";
import { TerminalApp, terminalTail, type TerminalLine } from "./TerminalApp";
import { SearchApp, SearchThumb } from "./SearchApp";
import { SheetsApp, cellRef, cellValue, colName, type SheetData } from "./SheetsApp";
import { API_URL, cloudFetch, closeCloudApp, cloudDesktopUrl, cloudToken, saveCloudBrowserState } from "@/lib/cloud-vms";
import type { Machine } from "@/lib/workers";
import { captureCloudAppPreview, captureLocalAppPreview } from '@/lib/app-preview';
import { AiPointer, pillSide } from "./native-cursor";

/**
 * The worker's computer: floating app windows over the wallpaper, with minimized
 * windows as tilted 3D thumbnails along the left edge.
 *
 * In the desktop app every web app is a real browser (<webview>) with its own
 * persistent session per worker (partition "persist:worker-<id>"), so you sign in
 * once and the worker stays signed in. Terminal and Files run in the worker's Linux VM.
 * In a plain browser tab (no Electron) the windows show what they'd load instead.
 */

export type Win = { app: string; min: boolean; max: boolean; z: number };
/** A page to show in an app window. `agent`: the worker's own run asked for it, not you. */
export type NavTo = { app: string; url: string; n: number; agent?: boolean } | null;

/** "mail.google.com" -> "google.com": the site a URL belongs to. */
const siteOf = (u: string) => {
  try {
    const parts = new URL(u).hostname.replace(/^www\./, "").split(".");
    const take = parts.length > 2 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
    return parts.slice(-take).join(".");
  } catch { return ""; }
};

const EASE = [0.16, 1, 0.3, 1] as const;
const isElectron = () => typeof window !== "undefined" && !!(window as any).electronAPI;
const workersApi = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);

export { startUrlFor };

/** Electron's default UA makes Google and others refuse sign-in ("browser not secure"); present as plain Chrome. */
const chromeUA = () => (typeof navigator === "undefined" ? undefined : navigator.userAgent.replace(/\s(Electron|everfern[\w-]*)\/[\d.]+/gi, ""));

/** Last frame of each app's page, shown on its minimized 3D thumbnail. */
const snaps: Record<string, string> = {};
const snapSubs = new Set<() => void>();
function setSnap(key: string, url: string) { snaps[key] = url; snapSubs.forEach((f) => f()); }
function useSnap(key: string) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); snapSubs.add(f); return () => { snapSubs.delete(f); }; }, []);
  return snaps[key];
}

export function windowsForApps(apps: string[]): Win[] {
  const web = apps.filter((a) => a !== "browser" && a !== "websearch" && startUrlFor(a));
  const open = web[0] ?? apps.find((a) => a !== "files") ?? apps[0];
  return apps.map((app, i) => ({ app, min: app !== open, max: false, z: app === open ? 10 : i }));
}

/* ── window bodies ─────────────────────────────────────────────── */

/** Frosted glass with three pulsing dots, over a page while it loads. */
function SiteLoader({ show, label }: { show: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="wk-siteload"
          role="status"
          aria-label={label ?? "Loading"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2 } }}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: EASE } }}
        >
          <span className="wk-siteload-dots" aria-hidden><i /><i /><i /></span>
          {label && <span className="wk-siteload-label">{label}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BrowserBody({ app, partition, navTo }: { app: string; partition?: string; navTo: NavTo }) {
  const start = startUrlFor(app)!;
  const [initial] = useState(start); // set once; later navigation goes through loadURL
  const [field, setField] = useState(start);
  const [loading, setLoading] = useState(true);
  // The frosted three-dot veil: up while a page navigation loads, down once it has painted.
  const [veil, setVeil] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);
  const ref = useRef<any>(null);
  const electron = isElectron() && !!partition;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    let http = 0;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const blank = () => Promise.resolve(wv.executeJavaScript("(document.body && document.body.innerText || '').trim().length", false)).then((n: number) => !n).catch(() => true);
    const nav = (e: any) => { setField(e.url); http = e.httpResponseCode || 0; };
    const navStart = (e: any) => { if (e.isMainFrame !== false && !e.isInPlace && !e.isSameDocument) setVeil(true); };
    const painted = () => setVeil(false);
    // Chrome gives up with ERR_TIMED_OUT; a page still blank after 30s gets the same page.
    const start = () => {
      setLoading(true);
      clearTimeout(stall);
      stall = setTimeout(() => {
        void blank().then((empty) => empty && setFailure({ url: wv.getURL?.() || "", code: -7, desc: "ERR_TIMED_OUT" }));
      }, 30_000);
    };
    // Main-frame load failures only; -3 (ERR_ABORTED) is a redirect or a navigation we replaced.
    const fail = (e: any) => {
      if (!e.isMainFrame || e.errorCode === -3) return;
      clearTimeout(stall);
      setFailure({ url: e.validatedURL, code: e.errorCode, desc: e.errorDescription });
      setLoading(false);
      setVeil(false);
    };
    // Like Chrome's "HTTP ERROR 500": an error status with nothing on the page.
    const ok = (e: any) => {
      if (e.isMainFrame === false) return;
      setFailure(null);
      if (http >= 400) { const code = http; void blank().then((empty) => empty && setFailure({ url: wv.getURL?.() || "", code: 0, desc: `HTTP ERROR ${code}`, http: code })); }
    };
    const gone = () => setFailure({ url: "", code: 0, desc: "The page stopped responding." });
    const snap = () => {
      try {
        Promise.resolve(wv.capturePage()).then((img: any) => {
          if (!img || img.isEmpty?.()) return;
          setSnap(`${partition}|${app}`, img.resize({ width: 520 }).toDataURL());
        }).catch(() => { });
      } catch { /* not attached yet */ }
    };
    const stop = () => { clearTimeout(stall); setLoading(false); setVeil(false); setTimeout(snap, 400); };
    const tick = setInterval(snap, 4000);
    // Tell the app this window exists, so the worker's browser runs (Navis) drive it.
    const api = (window as any).electronAPI?.workers;
    let wcId = 0;
    const reg = () => {
      try { wcId = wv.getWebContentsId(); void api?.registerWebview?.(partition, app, wcId); } catch { /* not attached yet */ }
    };
    wv.addEventListener("dom-ready", reg);
    wv.addEventListener("dom-ready", painted);
    wv.addEventListener("did-start-navigation", navStart);
    wv.addEventListener("focus", reg);
    wv.addEventListener("did-navigate", nav);
    wv.addEventListener("did-navigate-in-page", nav);
    wv.addEventListener("did-start-loading", start);
    wv.addEventListener("did-fail-load", fail);
    wv.addEventListener("did-finish-load", ok);
    wv.addEventListener("render-process-gone", gone);
    wv.addEventListener("did-stop-loading", stop);
    return () => {
      wv.removeEventListener("did-navigate", nav);
      wv.removeEventListener("did-navigate-in-page", nav);
      wv.removeEventListener("did-start-loading", start);
      wv.removeEventListener("did-fail-load", fail);
      wv.removeEventListener("did-finish-load", ok);
      wv.removeEventListener("render-process-gone", gone);
      wv.removeEventListener("did-stop-loading", stop);
      wv.removeEventListener("dom-ready", reg);
      wv.removeEventListener("dom-ready", painted);
      wv.removeEventListener("did-start-navigation", navStart);
      wv.removeEventListener("focus", reg);
      if (wcId) void api?.unregisterWebview?.(partition, app, wcId);
      clearInterval(tick);
      clearTimeout(stall);
    };
  }, [electron, app, partition]);

  // The agent opened a URL for this app: follow it so you see what the worker sees.
  useEffect(() => {
    if (navTo && navTo.app === app && ref.current?.loadURL) ref.current.loadURL(navTo.url).catch(() => { });
  }, [navTo, app]);

  const go = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const target = /^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) ? `https://${v}` : `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
    if (ref.current?.loadURL) ref.current.loadURL(target).catch(() => { });
    setField(target);
  };

  const def = APPS[app];
  return (
    <>
      <div className="wk-nav">
        <button className="wk-nav-btn" aria-label="Back" onClick={() => ref.current?.canGoBack?.() && ref.current.goBack()} disabled={!electron}><ArrowLeft size={13} /></button>
        <button className="wk-nav-btn" aria-label="Forward" onClick={() => ref.current?.canGoForward?.() && ref.current.goForward()} disabled={!electron}><ArrowRight size={13} /></button>
        <button className="wk-nav-btn" aria-label="Reload" onClick={() => ref.current?.reload?.()} disabled={!electron}><RotateCw size={12} className={loading && electron ? "wk-spin" : ""} /></button>
        <span className="wk-app-nav-label">{APPS[app]?.name ?? "App"}</span>
      </div>
      {electron ? (
        <div className="wk-webwrap">
          {React.createElement("webview", {
            ref,
            src: initial,
            partition,
            className: "wk-webview",
            allowpopups: "true",
            useragent: chromeUA(),
          })}
          <SiteLoader show={veil && !failure} />
          {failure && <LoadError failure={failure} offline={typeof navigator !== "undefined" && !navigator.onLine}
            onRetry={() => { setFailure(null); failure.url ? ref.current?.loadURL(failure.url).catch(() => { }) : ref.current?.reload?.(); }}
            onBack={() => { setFailure(null); if (ref.current?.canGoBack?.()) ref.current.goBack(); else ref.current?.loadURL(start).catch(() => { }); }} />}
        </div>
      ) : (
        <div className="wk-win-body is-page">
          <AppLogo app={app} size={44} />
          <h3 className="wk-win-h">Log in to {def?.name}</h3>
          <p className="wk-win-p">
            In the EverFern desktop app this window is a real browser on the worker&apos;s computer. Sign in once and the worker stays signed in.
          </p>
          <div className="wk-fake-input">Enter your email address…</div>
          <div className="wk-fake-btn">Continue</div>
        </div>
      )}
    </>
  );
}

type Failure = { url: string; code: number; desc: string; http?: number; host?: string; note?: string };

/** What to say for a failed load, in the shape Chrome uses: heading, one line, things to try. */
function describeFailure(f: Failure, offline: boolean, host: string) {
  const H = host || "This site";
  const net = ["Checking the connection", "Checking the proxy, firewall and DNS settings"];
  if (offline || f.code === -106 || f.code === -21) {
    return { icon: "offline" as const, title: "No internet", line: "The worker's computer isn't connected to the internet.", tries: ["Checking the network cables, modem and router", "Reconnecting to Wi-Fi"] };
  }
  if (f.http) {
    return { icon: "site" as const, title: "This page isn't working", line: f.http === 404 ? `${H} couldn't find this page.` : f.http >= 500 ? `${H} is currently unable to handle this request.` : `${H} won't show this page right now.`, tries: f.http >= 500 ? ["Reloading the page"] : [] };
  }
  if (f.code === 0) {
    return { icon: "crash" as const, title: "This page stopped working", line: "Something went wrong while displaying this page.", tries: [] };
  }
  if (f.code <= -200 && f.code > -300) {
    return { icon: "cert" as const, title: "Your connection is not private", line: `Someone might be trying to read what you send to ${H}. The site's security certificate isn't valid.`, tries: [] };
  }
  const byCode: Record<number, string> = {
    [-105]: `${H}'s server IP address could not be found.`,
    [-137]: `${H}'s server IP address could not be found.`,
    [-102]: `${H} refused to connect.`,
    [-118]: `${H} took too long to respond.`,
    [-7]: `${H} took too long to respond.`,
    [-109]: `${H} is unreachable.`,
    [-101]: "The connection was reset.",
    [-100]: `${H} unexpectedly closed the connection.`,
    [-324]: `${H} didn't send any data.`,
  };
  const line = byCode[f.code];
  if (line) return { icon: "site" as const, title: "This site can't be reached", line, tries: f.code === -105 || f.code === -137 ? [`Checking if there is a typo in ${host || "the address"}`, ...net] : net };
  return { icon: "site" as const, title: "This page isn't working", line: `${H} couldn't be loaded right now.`, tries: ["Reloading the page", ...net] };
}

function LoadError({ failure, offline, onRetry, onBack }: { failure: Failure; offline: boolean; onRetry: () => void; onBack?: () => void }) {
  const [details, setDetails] = useState(false);
  let host = "";
  try { host = failure.url ? new URL(failure.url).host : ""; } catch { /* keep blank */ }
  const d = describeFailure(failure, offline, failure.host ?? host);
  if (failure.note) d.line = failure.note;
  const Icon = d.icon === "offline" ? WifiOff : d.icon === "cert" ? ShieldAlert : d.icon === "crash" ? Frown : FileX2;
  const code = failure.http ? `HTTP ERROR ${failure.http}` : offline && failure.code !== -106 ? "ERR_INTERNET_DISCONNECTED" : failure.desc && /^ERR_/.test(failure.desc) ? failure.desc : failure.code ? `ERR_FAILED (${failure.code})` : "";
  return (
    <div className={`wk-neterr${d.icon === "cert" ? " is-cert" : ""}`} role="alert">
      <div className="wk-neterr-in">
        <Icon className="wk-neterr-ico" size={56} strokeWidth={1.25} />
        <h1>{d.title}</h1>
        <p>{d.line}</p>
        {d.tries.length > 0 && (
          <>
            <p className="wk-neterr-try">Try:</p>
            <ul>{d.tries.map((t) => <li key={t}>{t}</li>)}</ul>
          </>
        )}
        {code && <div className="wk-neterr-code">{code}</div>}
        {details && (
          <p className="wk-neterr-details">
            {failure.url ? <>The worker tried to open <span>{failure.url}</span>. </> : null}
            {d.icon === "cert" ? "Only continue if you trust this site and the network the worker is on." : "If other sites open fine, this one may be down or blocking automated browsers."}
          </p>
        )}
        <div className="wk-neterr-actions">
          <button className="wk-neterr-link" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
          {d.icon === "cert" && onBack
            ? <button className="wk-neterr-btn" onClick={onBack}>Back to safety</button>
            : <button className="wk-neterr-btn" onClick={onRetry}>Reload</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * The Browser app when the worker has a machine: the VM's own screen over noVNC.
 * Local: EverFern's Alpine VM (Chromium on its XFCE desktop). Cloud: the user's EverFern Cloud VM.
 * The address bar opens pages in the VM's browser; if the local VM can't start, fall back to the webview.
 */
/** live: the stream is up (KasmVNC said "connected", or the Browserbase live view loaded); until then the window shows EverFern booting.
 *  engine: what the URL shows, "browserbase" (a live view of the VM's Browserbase browser) or the VM's own screen. */
type VmBoot = {
  url: string | null; engine: string | null; error: string | null; fallback: boolean; retry: () => void; bootUrl: string;
  /** The app window the VM booted for: with Browserbase, `url` is that window's own tab. */
  bootApp: string;
  live: boolean; onStream: (state: string) => void;
};
const VmCtx = React.createContext<VmBoot | null>(null);

/** The local VM's X screen, which noVNC scales (letterboxed) into the window. */
const LOCAL_VM_SCREEN = { w: 1440, h: 900 };

/** Apps whose window shows the worker's VM screen instead of a local webview. */
export const usesVm = (app: string, machine?: Machine) =>
  !NATIVE_APPS.has(app) && !!machine && !!startUrlFor(app);

/** EverFern's own apps: drawn in the renderer and driven by name, never through a VM screen. */
export const NATIVE_APPS = new Set(["sheets", "write", "files", "terminal", "websearch"]);
/** Native apps whose AI steps are replayed by the app itself with its own cursor. */
const SELF_CURSOR_APPS = new Set(["files", "terminal", "websearch"]);

/**
 * Boot the worker's VM once, as soon as its desktop opens, so app windows can
 * show it the moment it is up instead of each waiting on its own connection.
 */
/** "persist:worker-<id>" -> "<id>": whose cloud browser (cookies, logins) to use. */
const workerOf = (partition?: string) => partition?.match(/^persist:worker-(.+)$/)?.[1];

function useVmBoot(machine: Machine | undefined, cloudVmId: string | undefined, bootUrl: string, bootApp: string, worker?: string): VmBoot | null {
  const [url, setUrl] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  // Reconnects since the stream was last up; each one asks the API to bring the VM's desktop back.
  const drops = useRef(0);

  useEffect(() => {
    if (!machine) return;
    let alive = true;
    setUrl(null); setEngine(null); setError(null); setFallback(false); setLive(false);
    (async () => {
      if (machine === "cloud") {
        if (!cloudVmId) { if (alive) setError("This worker has no cloud computer yet."); return; }
        const r = await cloudDesktopUrl(cloudVmId, bootUrl, bootApp, worker);
        if (!alive) return;
        if (r.url) { setEngine(r.engine ?? null); setUrl(r.url); } else setError(r.error || "Couldn't open the cloud computer.");
      } else {
        const sys = (window as any).electronAPI?.system;
        if (!sys?.startVMDesktop) { if (alive) setError("The Alpine VM is unavailable. Open EverFern desktop and set up its local VM."); return; }
        const r = await sys.startVMDesktop({ openUrl: bootUrl, app: bootApp });
        if (!alive) return;
        if (r?.success && r.url) setUrl(r.url);
        else setError(r?.error || "Couldn't start the Alpine VM. Set up the VM and retry.");
      }
    })().catch((e) => { if (alive) setError(e?.message || "Couldn't start the worker's VM browser."); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, cloudVmId, worker, attempt]);

  // The cloud VM can take a minute on first open (it sets up its desktop); past 3 minutes, say so like Chrome does.
  useEffect(() => {
    if (!machine || url || error || fallback) return;
    const t = setTimeout(() => setError(`${machine === "cloud" ? "EverFern Cloud VM" : "This computer's VM"} took too long to respond.`), 180_000);
    return () => clearTimeout(t);
  }, [machine, url, error, fallback, attempt]);

  const where = machine === "cloud" ? "EverFern Cloud VM" : "This computer's VM";
  const reconnect = () => {
    drops.current += 1;
    if (drops.current > 3) { setError(`${where} stopped responding.`); return; }
    setAttempt((n) => n + 1);
  };

  // A cloud stream that never comes up (its server is down, so the page is an error) is
  // reconnected rather than left on screen; the user keeps seeing EverFern booting meanwhile.
  useEffect(() => {
    if (machine !== "cloud" || !url || live || error) return;
    const t = setTimeout(reconnect, 30_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, url, live, error]);

  const onStream = (state: string) => {
    if (state === "connected") { drops.current = 0; setLive(true); }
    else if (state === "disconnected") { setLive(false); setTimeout(reconnect, 1500); }
  };

  // Keep a copy of the browser's cookies on this computer (per worker with Browserbase),
  // so when the worker moves to a new VM its browser starts signed in.
  useEffect(() => {
    if (machine !== "cloud" || !cloudVmId || !url) return;
    const save = () => void saveCloudBrowserState(cloudVmId, { engine: engine ?? undefined, worker });
    save();
    const t = setInterval(save, 15_000);
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [machine, cloudVmId, url, engine, worker]);

  if (!machine) return null;
  // Only the cloud stream (KasmVNC) reports its state; the local VM's noVNC is live once it has a URL.
  return {
    url, engine, error, fallback, bootUrl, bootApp, onStream,
    live: machine === "cloud" ? live : !!url,
    retry: () => { drops.current = 0; setAttempt((n) => n + 1); },
  };
}

/** Bottom-of-screen notice while the worker's computer starts up. */
function BootPill({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="wk-boot"
          role="status"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } }}
          exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.3 } }}
        >
          <span className="wk-boot-logo"><img src="/images/logos/everfern-withoutbg.png" alt="" /></span>
          <span className="wk-boot-text">EverFern is still booting</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The Browser app when the worker has a machine: the VM's own screen over noVNC.
 * Local: EverFern's Alpine VM (Chromium on its XFCE desktop). Cloud: the user's EverFern Cloud VM.
 * The VM itself is booted once per desktop (useVmBoot); this window shows it.
 * With Browserbase every app window has its own tab and live view (and Navis drives that tab),
 * so two windows never show or drive the same page. KasmVNC/noVNC have one screen for all.
 * The address bar opens pages in the VM's browser; if the local VM can't start, fall back to the webview.
 */
function VmScreen({ app, machine, cloudVmId, partition, navTo }: { app: string; machine: Machine; cloudVmId?: string; partition?: string; navTo: NavTo }) {
  const start = startUrlFor(app) ?? "https://duckduckgo.com";
  const vm = React.useContext(VmCtx);
  const bb = machine === "cloud" && app !== "chrome";
  // Browserbase: this window's own tab. The window the VM booted for already has it; others ask once the VM is up.
  const [own, setOwn] = useState<{ url: string; live: boolean; engine?: string; warning?: string } | null>(null);
  const [ownErr, setOwnErr] = useState<string | null>(null);
  const [ownTry, setOwnTry] = useState(0);
  useEffect(() => {
    if (ownTry === 0) setOwn(null);
    setOwnErr(null);
    if (machine !== "cloud" || !cloudVmId) return;
    if (app === vm?.bootApp && vm.url && ownTry === 0) { setOwn({ url: vm.url, live: false, engine: vm.engine ?? undefined }); return; }
    let alive = true;
    void cloudDesktopUrl(cloudVmId, ownTry > 0 ? undefined : start, app, workerOf(partition)).then((r) => {
      if (!alive) return;
      if (r.url) setOwn((previous) => ({ url: r.url!, live: !!previous && previous.url === r.url && previous.live, engine: r.engine, warning: r.warning })); else setOwnErr(r.error || "Couldn't open this app on the cloud computer.");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, vm?.url, cloudVmId, app, partition, ownTry]);

  useEffect(() => {
    if (own?.engine !== "vps" && own?.engine !== "browserless") return;
    const renew = setTimeout(() => setOwnTry((n) => n + 1), own?.engine === "browserless" ? 60_000 : 25 * 60_000);
    return () => clearTimeout(renew);
  }, [own?.engine, own?.url, ownTry]);
  useEffect(() => {
    const worker = workerOf(partition);
    if (machine !== 'cloud' || app !== 'files' || own?.engine !== 'vps' || !cloudVmId || !worker) return;
    const sync = () => { void cloudFetch(`/api/cloud-vms/${encodeURIComponent(cloudVmId)}/browser-control`, {
      method: 'POST', body: JSON.stringify({ worker, app: 'files', engine: 'vm', calls: [{ method: 'ef.sleep', params: { ms: 0 } }] }),
    }).catch(() => {}); };
    sync();
    const timer = setInterval(sync, 15000);
    return () => clearInterval(timer);
  }, [machine, app, own?.engine, cloudVmId, partition]);
  const url = machine === "cloud" ? own?.url ?? null : vm?.url ?? null;
  useEffect(() => {
    if (!url || own?.engine !== 'vps') return;
    const show = (event: Event) => {
      if ((event as CustomEvent).detail?.app !== app) return;
      frame.current?.contentWindow?.postMessage({ type: 'everfern-vps-clipboard' }, new URL(url).origin);
    };
    window.addEventListener('everfern-app-clipboard', show);
    return () => window.removeEventListener('everfern-app-clipboard', show);
  }, [url, own?.engine, app]);
  const live = machine === "cloud" ? !!own?.live : !!vm?.live;
  const error = machine === "cloud" ? ownErr ?? (app === vm?.bootApp ? vm?.error : null) : vm?.error;
  const [field, setField] = useState(start);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastNav = useRef<number>(-1);
  const opened = useRef(false);

  const open = (target: string) => {
    setField(target);
    if (machine === "cloud" && cloudVmId) void cloudDesktopUrl(cloudVmId, target, app, workerOf(partition)).then((r) => {
      if (r.url) { setOwn((previous) => ({ url: r.url!, live: !!previous && previous.url === r.url && previous.live, engine: r.engine, warning: r.warning })); setOwnErr(null); }
      else setOwnErr(r.error || "Couldn't open this page.");
    });
    else void (window as any).electronAPI?.system?.openVMBrowser?.(target, app);
  };

  // The VM booted on another app's page: bring this window's page up.
  useEffect(() => {
    if (!url || opened.current) return;
    opened.current = true;
    // (A Browserbase window's own tab was opened on its page already.)
    if (machine !== "cloud" && vm && start !== vm.bootUrl) open(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Tell the app this window shows the cloud VM, so the worker's browser runs (Navis) drive the
  // VM's browser on this screen. Re-sent now and then so it has a fresh sign-in token.
  useEffect(() => {
    if (machine !== "cloud" || !cloudVmId || !partition || !url) return;
    const api = (window as any).electronAPI?.workers;
    if (!api?.registerCloudVm) return;
    const reg = () => { const t = cloudToken(); if (t) void api.registerCloudVm(partition, app, cloudVmId, API_URL, t, startUrlFor(app) ?? undefined); };
    reg();
    const tick = setInterval(reg, 5 * 60_000);
    return () => { clearInterval(tick); void api.unregisterCloudVm?.(partition, app); };
  }, [machine, cloudVmId, partition, app, url]);

  useEffect(() => {
    if (machine !== "local" || !partition || !url) return;
    const api = workersApi();
    void api?.registerLocalVm?.(partition, app, start);
    return () => { void api?.unregisterLocalVm?.(partition, app); };
  }, [machine, partition, app, url, start]);

  useEffect(() => {
    if (machine !== "cloud" || !cloudVmId || !url) return;
    const save = () => void saveCloudBrowserState(cloudVmId, { engine: bb ? "browserbase" : own?.engine || "vm", worker: workerOf(partition), app: bb || own?.engine === 'vps' ? app : undefined });
    save();
    const timer = setInterval(save, 15_000);
    return () => { clearInterval(timer); save(); };
  }, [machine, cloudVmId, url, bb, partition, own?.engine]);

  // KasmVNC tells its parent page how the stream is doing (connecting, connected, disconnected);
  // the Browserbase live view only says when its session ended.
  useEffect(() => {
    if (!url) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data === 'everfern-vps-connected') { setOwn(o => o ? { ...o, live: true } : o); vm?.onStream('connected'); return; }
      if (e.data === 'everfern-vps-disconnected') { setOwnTry(n => n + 1); return; }
      if (e.data === "browserbase-disconnected") { vm?.onStream("disconnected"); return; }
      const d = e.data as { action?: string; value?: unknown } | null;
      if (d?.action === "connection_state" && typeof d.value === "string") {
        setOwn((o) => o ? { ...o, live: d.value === "connected" } : o);
        vm?.onStream(d.value);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // The agent opened a URL in the browser: show it on the VM.
  useEffect(() => {
    if (!navTo || navTo.app !== app || navTo.n === lastNav.current || !url) return;
    lastNav.current = navTo.n;
    if (navTo.agent) {
      // On this computer the run drives the VM's page itself; opening it here too made a second window.
      // And an app window keeps to its own site: the run can't use it to open another one.
      if (machine !== "cloud" || app === "chrome" || siteOf(navTo.url) !== siteOf(start)) return;
    }
    open(navTo.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTo, app, url]);

  if (!vm) return <div className="wk-vm-boot" role="alert">The worker&apos;s VM is unavailable. Set up the VM and retry.</div>;

  const go = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    open(/^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) ? `https://${v}` : `https://duckduckgo.com/?q=${encodeURIComponent(v)}`);
  };
  const where = machine === "cloud" ? "EverFern Cloud VM" : "this computer's VM";

  return (
    <>
      <div className="wk-nav">
        <span className="wk-vm-tag">{machine === "cloud" ? <Cloud size={12} /> : <Monitor size={12} />}{machine === "cloud" ? "Cloud" : "Local"}</span>
        <button className="wk-nav-btn" aria-label="Reconnect" onClick={() => (ownErr ? setOwnTry((n) => n + 1) : vm.retry())}><RotateCw size={12} /></button>
        <span className="wk-app-nav-label">{APPS[app]?.name ?? "App"}</span>
      </div>
      {own?.warning && <div role="status" style={{ padding: '8px 12px', fontSize: 12, background: '#fff5d6', color: '#51431e' }}>{own.warning}</div>}
      <div className={`wk-vmscreen${!live && !error ? " is-connecting" : ""}`}>
        {url && (
          <iframe
            ref={frame} src={url} className={live ? "" : "is-hidden"} title={`${APPS[app]?.name ?? "Browser"} on ${where}`}
            data-screen-aspect={machine === "local" ? String(LOCAL_VM_SCREEN.w / LOCAL_VM_SCREEN.h) : undefined}
            allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            // The Browserbase live view sends no stream state: it is up once it has loaded.
            onLoad={() => { if (bb) { setOwn((o) => (o ? { ...o, live: true } : o)); vm.onStream("connected"); } }}
          />
        )}
        {url && !live && !error && (
          <div className="wk-vm-boot" role="status">
            <span className="wk-boot-logo"><img src="/images/logos/everfern-withoutbg.png" alt="" /></span>
            <span className="wk-boot-text">EverFern is booting</span>
          </div>
        )}
        {!url && !error && (
          <SiteLoader show label={`Connecting to ${where}`} />
        )}
        {error && (
          <LoadError failure={{ url: "", code: -109, desc: "ERR_CONNECTION_FAILED", host: where, note: error }}
            offline={typeof navigator !== "undefined" && !navigator.onLine}
            onRetry={() => (vm.error ? vm.retry() : setOwnTry((n) => n + 1))} />
        )}
      </div>
    </>
  );
}

/** Files / Terminal. On a cloud machine their workspace is the cloud VM, so this window registers it. */
/**
 * Files / Terminal. Both work on the worker's own computer, so the window connects first:
 * a cloud worker registers its VM, then one real command proves the workspace answers.
 * Only then does the app mount and read folders or take commands.
 */
function NativeWorkspaceApp({ app, workerId, machine, cloudVmId, partition }: { app: "files" | "terminal"; workerId?: string; machine?: Machine; cloudVmId?: string; partition?: string }) {
  const [conn, setConn] = useState<{ state: "connecting" | "ready" | "error"; note: string }>({ state: "connecting", note: "" });
  const [attempt, setAttempt] = useState(0);

  // Keep the cloud VM registered while the window is open.
  useEffect(() => {
    if (machine !== "cloud" || !cloudVmId || !partition) return;
    const api = workersApi();
    if (!api?.registerCloudVm) return;
    const tick = setInterval(() => { const t = cloudToken(); if (t) void api.registerCloudVm(partition, app, cloudVmId, API_URL, t); }, 5 * 60_000);
    return () => { clearInterval(tick); void api.unregisterCloudVm?.(partition, app); };
  }, [machine, cloudVmId, partition, app]);

  useEffect(() => {
    const api = workersApi();
    let alive = true;
    const set = (state: "connecting" | "ready" | "error", note: string) => { if (alive) setConn({ state, note }); };
    void (async () => {
      if (!api?.vmExec || !workerId) { set("error", "Files and Terminal run on the worker's computer in the EverFern desktop app."); return; }
      if (machine === "cloud") {
        if (!cloudVmId || !partition) {
          set("connecting", "Waiting for the worker's cloud computer to start");
          // The VM id arrives with the worker; if it never does, say so instead of spinning forever.
          await new Promise((res) => setTimeout(res, 45_000));
          set("error", "This worker's cloud computer hasn't started. Open one of its apps, then try again.");
          return;
        }
        const token = cloudToken();
        if (!token) { set("error", "Sign in to EverFern to reach this worker's cloud computer."); return; }
        set("connecting", "Connecting to the cloud computer");
        try { await api.registerCloudVm(partition, app, cloudVmId, API_URL, token); }
        catch (e) { set("error", e instanceof Error ? e.message : String(e)); return; }
      } else {
        set("connecting", "Starting the worker's Linux computer");
      }
      // The VM may still be booting: retry the probe for about a minute.
      let last = "";
      for (let i = 0; i < 12 && alive; i++) {
        try {
          // A probe that never answers must not hold the window on "Connecting".
          const r = await Promise.race([
            api.vmExec(workerId, "pwd"),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The worker's computer is taking too long to answer.")), 20_000)),
          ]);
          if (r?.exitCode === 0) { set("ready", ""); return; }
          last = String(r?.stderr || "").trim();
        } catch (e) { last = e instanceof Error ? e.message : String(e); }
        set("connecting", "Waiting for the workspace to answer");
        await new Promise((res) => setTimeout(res, 5000));
      }
      set("error", last || "The worker's computer did not answer.");
    })();
    return () => { alive = false; };
  }, [app, workerId, machine, cloudVmId, partition, attempt]);

  if (conn.state !== "ready") {
    return (
      <div className={`wk-native-connect is-${app}`} data-worker-app={app} role="status">
        {conn.state === "error" ? <WifiOff size={22} /> : <span className="wk-native-connect-spin" aria-hidden="true" />}
        <strong>{conn.state === "error" ? "Couldn't reach the worker's computer" : `Connecting ${app === "files" ? "Files" : "Terminal"}`}</strong>
        {conn.note && <span>{conn.note}</span>}
        {conn.state === "error" && <button onClick={() => { setConn({ state: "connecting", note: "" }); setAttempt((n) => n + 1); }}><RotateCw size={13} /> Try again</button>}
      </div>
    );
  }
  return app === "files" ? <FilesApp workerId={workerId} /> : <TerminalApp workerId={workerId} />;
}

function WindowBody({ app, partition, workerId, navTo, machine, cloudVmId }: { app: string; partition?: string; workerId?: string; navTo: NavTo; machine?: Machine; cloudVmId?: string }) {
  const def = APPS[app];
  if (!def) return null;
  // Native EverFern apps always render in the renderer so the AI can drive them
  // with pixel coordinates (worker_click / worker_type) and fast typed writes.
  if (app === "sheets") return <SheetsApp workerId={workerId} />;
  if (app === "write") return <WriteApp workerId={workerId} />;
  // Files and Terminal are AI-native: the AI names the step, the app replays it with a cursor.
  if (app === "files" || app === "terminal") return <NativeWorkspaceApp app={app} workerId={workerId} machine={machine} cloudVmId={cloudVmId} partition={partition} />;
  // EverFern Search shows the web_search tool: the cursor types each query, results land here.
  if (app === "websearch") return <SearchApp workerId={workerId} />;
  // On a cloud machine every web app runs in the VM's browser (one signed-in profile, kept in sync).
  if (machine && usesVm(app, machine)) return <VmScreen app={app} machine={machine} cloudVmId={cloudVmId} partition={partition} navTo={navTo} />;
  if (startUrlFor(app)) return <BrowserBody app={app} partition={partition} navTo={navTo} />;
  return (
    <div className="wk-win-body">
      <AppLogo app={app} size={52} />
      <h3 className="wk-win-h">{def.name}</h3>
      <p className="wk-win-p">{def.blurb}. The worker opens this when a step needs it.</p>
    </div>
  );
}

/* ── AI at work: a soft glow, a liquid-glass cursor and a pill saying what it's doing ── */

/** `space: "window"`: x/y are 0..1 of the whole app window (worker_click); otherwise of the page shown inside it. */
/** `aspect`: the VM screen's width/height when x/y are on the whole screen, which the window letterboxes. */
export type AiAct = { app?: string; label: string; x?: number; y?: number; space?: "window"; aspect?: number; n: number } | null;

/** Where the cursor waits before the first action with a point: the middle of the page. */
const RESTING = { x: 0.5, y: 0.46 };

/** Click-like actions press the cursor; reading, typing and waiting don't. */
const PRESS_VERBS = /^(click|tap|press|select|open|choose|check|toggle|double|right)/i;

/** The page area inside a window that action points are fractions of, in px of the overlay.
 *  A webview or VM stream when there is one (skipping the address bar); the whole frame otherwise.
 *  The local VM's noVNC scales its whole screen to fit, so points land in the letterboxed screen. */
function stageOf(overlay: HTMLElement, space?: "window", screenAspect?: number) {
  const o = overlay.getBoundingClientRect();
  const sx = overlay.offsetWidth / Math.max(1, o.width), sy = overlay.offsetHeight / Math.max(1, o.height);
  const frame = overlay.parentElement;
  let r: DOMRect | null = null;
  let aspect = 0;
  if (space === "window") r = overlay.closest(".wk-win")?.getBoundingClientRect() ?? null;
  else if (frame) {
    const el = frame.querySelector<HTMLElement>("webview, .wk-vmscreen iframe:not(.is-hidden)");
    // A VM screen (VNC) is fitted into the window with bands: the point is on the fitted screen, not the frame.
    if (el) { r = el.getBoundingClientRect(); aspect = Number(el.dataset.screenAspect) || (el.tagName === "IFRAME" ? screenAspect ?? 0 : 0); }
  }
  if (!r || r.width < 2 || r.height < 2) return { left: 0, top: 0, width: overlay.offsetWidth, height: overlay.offsetHeight };
  let { left, top, width, height } = r;
  if (aspect > 0) {
    const fitW = Math.min(width, height * aspect), fitH = fitW / aspect;
    left += (width - fitW) / 2; top += (height - fitH) / 2; width = fitW; height = fitH;
  }
  return { left: (left - o.left) * sx, top: (top - o.top) * sy, width: width * sx, height: height * sy };
}

function AiOverlay({ ai }: { ai: NonNullable<AiAct> }) {
  const self = !!ai.app && SELF_CURSOR_APPS.has(ai.app);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  // Native apps (Sheets cells, worker_click) say the exact spot on screen: it wins until the next action with a point.
  const [exact, setExact] = useState<{ x: number; y: number; n: number; press: number } | null>(null);
  const [press, setPress] = useState(0);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(el);
    const stage = el.querySelector("webview, .wk-vmscreen");
    if (stage) ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (ai.x !== undefined && PRESS_VERBS.test(ai.label.trim())) setPress((p) => p + 1);
  }, [ai.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPoint = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; clientX: number; clientY: number; press?: boolean }>).detail;
      const el = ref.current;
      if (!d || !el || (d.app && d.app !== ai.app)) return;
      const o = el.getBoundingClientRect();
      const x = ((d.clientX - o.left) / Math.max(1, o.width)) * el.offsetWidth;
      const y = ((d.clientY - o.top) / Math.max(1, o.height)) * el.offsetHeight;
      setExact((c) => ({ x, y, n: ai.n, press: (c?.press ?? 0) + (d.press ? 1 : 0) }));
    };
    window.addEventListener("everfern-ai-pointer", onPoint);
    return () => window.removeEventListener("everfern-ai-pointer", onPoint);
  }, [ai.app, ai.n]);

  if (self) {
    return (
      <div className="wk-ai" aria-hidden="true">
        <motion.div className="wk-ai-glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
      </div>
    );
  }

  const el = ref.current;
  let pt: { x: number; y: number } | null = null;
  let w = 0;
  if (el) {
    void size;
    w = el.offsetWidth;
    if (exact && exact.n === ai.n) pt = exact;
    else {
      const s = stageOf(el, ai.space, ai.aspect);
      const f = ai.x !== undefined && ai.y !== undefined ? { x: ai.x, y: ai.y } : RESTING;
      pt = { x: s.left + f.x * s.width, y: s.top + f.y * s.height };
    }
  }
  const presses = press + (exact?.press ?? 0);
  // Keep the pill inside the window: it goes to the roomier side and never grows past the edge.
  const side = pt && w > 0 ? pillSide(pt.x, w) : { flip: false, room: 0 };
  return (
    <div className="wk-ai" ref={ref} aria-live="polite">
      <motion.div className="wk-ai-glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
      {pt && (
        <motion.div
          className="wk-ai-cursor"
          initial={{ left: pt.x, top: pt.y, opacity: 0, scale: 0.6 }}
          animate={{ left: pt.x, top: pt.y, opacity: 1, scale: 1 }}
          transition={{ left: { type: "spring", bounce: 0, duration: 0.5 }, top: { type: "spring", bounce: 0, duration: 0.5 }, default: { duration: 0.3, ease: EASE } }}
        >
          <AiPointer press={presses} label={ai.label} flip={side.flip} room={side.room || undefined} pressDelay={0.42} />
        </motion.div>
      )}
    </div>
  );
}

/* ── window chrome ─────────────────────────────────────────────── */

function AppWindow({
  win, index, focused, full, bounds, partition, workerId, navTo, machine, cloudVmId, ai, locked, onFocus, onMin, onFull, onClose,
}: {
  win: Win; index: number; focused: boolean; full?: boolean; bounds: React.RefObject<HTMLDivElement | null>; ai?: AiAct; locked?: boolean;
  partition?: string; workerId?: string; navTo: NavTo; machine?: Machine; cloudVmId?: string;
  onFocus: () => void; onMin: () => void; onFull: () => void; onClose: () => void;
}) {
  const def = APPS[win.app];
  const windowRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sound, setSound] = useState(false);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  useEffect(() => {
    const connected = (event: MessageEvent) => {
      const iframe = windowRef.current?.querySelector('iframe');
      if (event.data !== 'everfern-vps-connected' || !iframe || event.source !== iframe.contentWindow) return;
      const url = new URL(iframe.src);
      if (event.origin !== url.origin || !url.pathname.startsWith('/api/vps-browser/')) return;
      setSoundUrl(new URL('./audio', url).href);
    };
    window.addEventListener('message', connected);
    return () => window.removeEventListener('message', connected);
  }, []);
  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio || !soundUrl) return;
    if (sound) { audio.pause(); audio.removeAttribute('src'); audio.load(); setSound(false); }
    else { audio.src = soundUrl; try { await audio.play(); setSound(true); } catch { setSound(false); } }
  };

  // Full size: one big white card over a dimmed desktop (the same window, so the page keeps its state).
  const isAiOperating = (!!ai && (ai.app === win.app || (!ai.app && focused))) || locked;
  // Windows have one fixed size, centred on the desktop and not movable; the only other size is Full.
  const W = "min(800px, 45%)", H = "min(600px, calc(77% - 110px))";
  const pos = full
    ? { left: 20, top: 56, width: "calc(var(--ef-vw) - 40px)", height: "calc(var(--ef-vh) - 76px)" }
    : { left: `calc(50% - ${W} / 2)`, top: `calc(50% - ${H} / 2)`, width: W, height: H };
  const windowView = (
    <motion.div
      ref={windowRef}
      className={`wk-win${focused || full ? " is-focused" : ""}${ai ? " is-ai" : ""}${full ? " is-full" : ""}`}
      data-worker-app={win.app}
      style={{ ...pos, zIndex: full ? 9000 : isAiOperating ? 800 : win.z }}
      layout
      transition={{ layout: { duration: 0.65, ease: EASE } }}
      onPointerDown={onFocus}
      initial={{ opacity: 0, rotateX: 14, rotateY: -10, z: -220, y: 40 }}
      animate={{
        opacity: 1, y: 0,
        rotateX: 0, rotateY: focused || full ? 0 : 7, z: focused || full ? 0 : -90, ...(full ? { x: 0 } : {}),
        transition: { duration: 0.7, ease: EASE },
      }}
      exit={{ opacity: 0, rotateY: 38, z: -260, x: -260, transition: { duration: 0.42, ease: EASE } }}
    >
      <div className="wk-win-bar" onDoubleClick={() => { if (!locked && !ai) onFull(); }}>
        <span className="wk-win-icon"><AppLogo app={win.app} size={20} radius={5} /></span>
        <span className="wk-win-name">{def?.name}</span>
        {locked && <span className="wk-control-lock" role="status">Worker in control - pause to interact</span>}
        {soundUrl && <button className="wk-win-btn" aria-label="Copy and paste" title="Copy and paste" disabled={locked} onPointerDown={event => event.stopPropagation()} onClick={() => window.dispatchEvent(new CustomEvent('everfern-app-clipboard', { detail: { app: win.app } }))}><Clipboard size={14} /></button>}
        {soundUrl && <button className="wk-win-btn" aria-label={sound ? "Mute sound" : "Enable sound"} title={sound ? "Mute sound" : "Enable sound"} aria-pressed={sound} onPointerDown={e => e.stopPropagation()} onClick={toggleSound}>{sound ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>}
        <button className="wk-win-btn" disabled={locked || !!ai} aria-label={full ? "Exit full size" : "Full size"} title={full ? "Exit full size (Esc)" : "Full size"} onPointerDown={(e) => e.stopPropagation()} onClick={onFull}>
          {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {!full && <button className="wk-win-btn" disabled={locked || !!ai} aria-label="Minimize" title="Minimize" onPointerDown={(e) => e.stopPropagation()} onClick={onMin}><Minus size={15} /></button>}
        <button className="wk-win-btn" disabled={locked || !!ai} aria-label="Close" title="Close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}><X size={15} /></button>
      </div>
      <audio ref={audioRef} preload="none" />
      <div className="wk-win-frame">
        <div className="wk-app-content"><WindowBody app={win.app} partition={partition} workerId={workerId} navTo={navTo} machine={machine} cloudVmId={cloudVmId} /></div>
        <AnimatePresence>{ai && <AiOverlay key="ai" ai={{ ...ai, app: ai.app ?? win.app }} />}</AnimatePresence>
      </div>
    </motion.div>
  );
  return full && typeof document !== 'undefined' ? createPortal(windowView, document.body) : windowView;
}


/** Miniature live preview of the native Sheets app for the minimized 3D stack. */
/** Files in the 3D stack: the worker's home folder, read from its machine. */
function FilesThumb({ workerId }: { workerId?: string }) {
  const api = workersApi();
  const [items, setItems] = useState<{ name: string; dir: boolean }[] | null>(null);
  useEffect(() => {
    if (!api?.vmLs || !workerId) return;
    let alive = true;
    const load = () => {
      Promise.resolve(api.vmLs(workerId))
        .then((r: { files?: string[] } | null) => {
          if (!alive || !r?.files) return;
          const list = r.files.filter((f) => f && !f.startsWith(".")).map((f) => ({ name: f.replace(/\/$/, ""), dir: f.endsWith("/") }));
          list.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
          setItems(list.slice(0, 12));
        })
        .catch(() => { /* thumbnail only */ });
    };
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [api, workerId]);
  return (
    <div className="wk-thumb-files">
      <div className="wk-thumb-files-side"><span className="is-on">Home</span><span>Documents</span><span>Downloads</span><span>Trash</span></div>
      <div className="wk-thumb-files-grid">
        {(items ?? []).map((it) => (
          <div key={it.name} className="wk-thumb-files-item">
            {it.dir
              ? <svg width="22" height="18" viewBox="0 0 80 64" aria-hidden="true"><path d="M4 10a6 6 0 0 1 6-6h20l7 7h33a6 6 0 0 1 6 6v37a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="#4f9bec" /><path d="M4 22a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="#7dbcf8" /></svg>
              : <svg width="15" height="18" viewBox="0 0 30 38" aria-hidden="true"><path d="M2 3a3 3 0 0 1 3-3h14l9 9v26a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#fff" stroke="#c9d1da" /><path d="M19 0v7a2 2 0 0 0 2 2h7" fill="#e8edf2" stroke="#c9d1da" /></svg>}
            <b>{it.name}</b>
          </div>
        ))}
        {items && !items.length && <span style={{ gridColumn: "1 / -1", opacity: .55 }}>Empty folder</span>}
      </div>
    </div>
  );
}

/** Terminal in the 3D stack: the last lines of the worker's session. */
function TerminalThumb({ workerId }: { workerId?: string }) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  useEffect(() => {
    if (!workerId) return;
    const read = () => setLines(terminalTail.get(workerId)?.lines.slice(-9) ?? []);
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, [workerId]);
  return (
    <div className="wk-thumb-term">
      {lines.map((l, i) => (
        <pre key={i}>{l.kind === "cmd" ? <><span className="is-prompt">worker@everfern %</span> {l.text}</> : l.text.split("\n").slice(-4).join("\n")}</pre>
      ))}
      {!lines.length && <pre><span className="is-prompt">worker@everfern ~ %</span> <span className="wk-thumb-term-caret" /></pre>}
    </div>
  );
}

/** Write in the 3D stack: the start of the document as plain text. */
function WriteThumb({ workerId }: { workerId?: string }) {
  const [doc, setDoc] = useState<{ name: string; text: string }>({ name: "Untitled", text: "" });
  useEffect(() => {
    const read = () => {
      const d = loadDoc(workerId);
      const el = document.createElement("div");
      el.innerHTML = d.html;
      setDoc({ name: d.name, text: (el.innerText || el.textContent || "").trim().slice(0, 600) });
    };
    read();
    const t = setInterval(read, 3000);
    return () => clearInterval(t);
  }, [workerId]);
  return (
    <div className="wk-thumb-write">
      <div className="wk-thumb-write-page">
        <strong>{doc.name}</strong>
        <p>{doc.text || "Empty document"}</p>
      </div>
    </div>
  );
}

function SheetsThumb({ workerId }: { workerId?: string }) {
  const api = workersApi();
  const [data, setData] = useState<SheetData | null>(null);
  useEffect(() => {
    if (!api?.sheetLoad || !workerId) return;
    let alive = true;
    const load = () => {
      Promise.resolve(api.sheetLoad(workerId))
        .then((d: SheetData | null) => { if (alive && d?.cells) setData(d); })
        .catch(() => { /* thumbnail only */ });
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [api, workerId]);

  if (!data) {
    return (
      <div className="wk-thumb-placeholder">
        <AppLogo app="sheets" size={34} radius={8} />
        <span className="wk-thumb-placeholder-name">Sheets</span>
        <span className="wk-thumb-placeholder-note">Open to view this spreadsheet</span>
      </div>
    );
  }

  const cols = Math.min(4, Math.max(3, data.columns || 3));
  const rows = Math.min(5, Math.max(4, data.rows || 4));
  return (
    <div className="wk-thumb-sheets">
      <div className="wk-thumb-sheets-bar">
        <span className="wk-thumb-sheets-dot" />
        <span className="wk-thumb-sheets-name">{data.name || "Sheet1"}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th />
            {Array.from({ length: cols }, (_, c) => <th key={c}>{colName(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <th>{r + 1}</th>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>{cellValue(data.cells, cellRef(r, c), new Set()).slice(0, 12)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ThumbBody({ app, snapKey, machine, cloudVmId, partition }: { app: string; snapKey: string; machine?: Machine; cloudVmId?: string; partition?: string }) {
  const snap = useSnap(snapKey);
  const name = APPS[app]?.name ?? app;
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    const worker = workerOf(partition);
    if (NATIVE_APPS.has(app)) return; // drawn live from their own data instead
    if (!worker || !machine || (machine === 'cloud' ? !cloudVmId : !startUrlFor(app))) return;
    let alive = true;
    const capture = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      if (!alive) return;
      if (document.visibilityState === 'hidden') { timer = setTimeout(update, 12_000); return; }
      let delay = 12_000;
      try {
        const image = machine === 'cloud'
          ? await captureCloudAppPreview(cloudVmId!, worker, app, startUrlFor(app), capture.signal)
          : await captureLocalAppPreview(worker, app, startUrlFor(app)!, capture.signal);
        if (alive) { setSnap(snapKey, image); setPreviewError(false); }
      } catch { if (alive) setPreviewError(true); delay = 20_000; }
      if (alive) timer = setTimeout(update, delay);
    };
    void update();
    return () => { alive = false; capture.abort(); clearTimeout(timer); };
  }, [app, snapKey, machine, cloudVmId, partition]);

  // Native Sheets lives in the renderer, so capture-based previews do not apply.
  // Show a miniature live grid instead of the generic placeholder.
  if (app === "sheets" || app === "files" || app === "terminal" || app === "write" || app === "websearch") {
    const wid = workerOf(partition);
    return (
      <div className="wk-thumb-card" data-preview-state={app}>
        <div className={`wk-thumb-preview is-${app}`}>
          {app === "sheets" ? <SheetsThumb workerId={wid} />
            : app === "files" ? <FilesThumb workerId={wid} />
            : app === "terminal" ? <TerminalThumb workerId={wid} />
            : app === "websearch" ? <SearchThumb />
            : <WriteThumb workerId={wid} />}
        </div>
      </div>
    );
  }

  return (
    <div className="wk-thumb-card" data-preview-state={snap ? 'snapshot' : 'unavailable'}>
      <div className={`wk-thumb-preview${snap ? ' is-live' : ' is-placeholder'}`}>
        {snap ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={snap} alt={`${name} last captured preview`} draggable={false} className="w-full h-full object-cover object-top block" />
        ) : (
          <div className="wk-thumb-placeholder">
            <AppLogo app={app} size={34} radius={8} />
            <span className="wk-thumb-placeholder-name">{name}</span>
            <span className="wk-thumb-placeholder-note">{machine && (machine === 'cloud' || startUrlFor(app)) ? previewError ? 'Retrying app preview…' : 'Loading app preview…' : 'Open to view this app'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkerDesktop({
  wins, setWins, hideThumbs, behind, onPick, adding, partition, navTo = null, machine, cloudVmId, ai = null, locked = false,
}: {
  wins: Win[]; setWins: (fn: (w: Win[]) => Win[]) => void; hideThumbs?: boolean; behind?: boolean; onPick?: () => void; partition?: string; navTo?: NavTo;
  machine?: Machine; cloudVmId?: string;
  onRemove?: (app: string) => void; adding?: string; locked?: boolean;
  /** What the AI is doing right now; shown on its window (or the front one). */
  ai?: AiAct;
}) {
  const bounds = useRef<HTMLDivElement>(null);
  const topZ = () => Math.max(0, ...wins.map((w) => w.z)) + 1;
  const patch = (app: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.app === app ? { ...w, ...p } : w)));
  const firstVmApp = wins.find((w) => usesVm(w.app, machine))?.app;
  const vm = useVmBoot(firstVmApp ? machine : undefined, cloudVmId, (firstVmApp && startUrlFor(firstVmApp)) || "https://duckduckgo.com", firstVmApp || "browser", workerOf(partition));
  const settling = !!vm && !vm.error && !vm.fallback;
  // Windows on the VM wait for its URL, then open (their stream stays covered until it is live).
  const noUrl = settling && !vm.url;
  const booting = settling && !vm.live;
  const open = wins.filter((w) => !w.min && !(noUrl && usesVm(w.app, machine)));
  const minimized = wins.filter((w) => w.min);
  // Closing an app shuts its window (and the app on a cloud machine); it stays installed on the worker.
  const closeApp = (app: string) => {
    const drop = () => setWins(ws => ws.filter(x => x.app !== app));
    if (machine === "cloud" && cloudVmId) void closeCloudApp(cloudVmId, workerOf(partition), app, drop);
    else drop();
  };
  const focusedZ = Math.max(-1, ...open.map((w) => w.z));
  const workerId = partition?.replace(/^persist:worker-/, "");
  const [fullApp, setFullApp] = useState<string | null>(null);
  const full = fullApp && open.some((w) => w.app === fullApp) ? fullApp : null;
  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFullApp(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);

  // Window focus: when the worker operates an app, bring its window to the front and un-minimize it.
  // EverFern window focus: when the worker operates an app, bring its window to the front and un-minimize it.
  useEffect(() => {
    if (ai?.app) {
      setWins((ws) => {
        const top = Math.max(0, ...ws.map((w) => w.z)) + 1;
        const target = ws.find((w) => w.app === ai.app);
        if (!target) {
          return [...ws.map((w) => ({ ...w, min: true, max: false })), { app: ai.app!, min: false, max: false, z: top }];
        }
        if (target.min || ws.some((w) => w.app !== ai.app && !w.min)) {
          return ws.map((w) => (w.app === ai.app ? { ...w, min: false, z: top } : { ...w, min: true, max: false }));
        }
        return ws;
      });
    }
  }, [ai?.app, ai?.n, setWins]);

  // In-app pixel automation: the AI's worker_click / worker_type tools send
  // normalized 0-1000 coordinates; map them onto the focused app window's DOM.
  // Web app windows are real <webview>s, so clicks there go through the main
  // process (sendInputEvent); synthetic DOM events only work for React apps.
  useEffect(() => {
    const api = workersApi();
    if (!api?.onPointer && !api?.onType && !api?.onDescribe) return;
    const findApp = (app: string) => document.querySelector<HTMLElement>(`[data-worker-app="${CSS.escape(app)}"]`);
    const pointFor = (app: string, x: number, y: number) => {
      const root = findApp(app);
      if (!root) return null;
      const rect = root.getBoundingClientRect();
      return {
        root,
        rect,
        content: root.querySelector<HTMLElement>(".wk-app-content"),
        clientX: rect.left + (x / 1000) * rect.width,
        clientY: rect.top + (y / 1000) * rect.height,
      };
    };
    /** The webview element covering this point, with normalized coords inside its guest viewport. */
    const webviewAt = (root: HTMLElement, clientX: number, clientY: number) => {
      for (const wv of Array.from(root.querySelectorAll("webview"))) {
        const r = wv.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
        const wcId = (wv as any).getWebContentsId?.();
        if (typeof wcId !== "number") continue;
        return {
          wcId,
          nx: Math.round(((clientX - r.left) / r.width) * 1000),
          ny: Math.round(((clientY - r.top) / r.height) * 1000),
        };
      }
      return null;
    };
    // One action at a time, in order: the cursor reaches the spot, presses, then the click lands.
    let chain: Promise<void> = Promise.resolve();
    const queue = (fn: () => void | Promise<void>) => { chain = chain.then(fn).catch(() => {}); };
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const showPointer = (app: string, clientX: number, clientY: number, press: boolean) =>
      window.dispatchEvent(new CustomEvent("everfern-ai-pointer", { detail: { app, clientX, clientY, press } }));
    const click = async (app: string, x: number, y: number, action: string) => {
      const p = pointFor(app, x, y);
      if (!p) return;
      showPointer(app, p.clientX, p.clientY, true);
      await wait(320);
      const wv = webviewAt(p.root, p.clientX, p.clientY);
      if (wv) {
        api.workers?.webviewClick?.(wv.wcId, action, wv.nx, wv.ny);
        return;
      }
      const stack = document.elementsFromPoint(p.clientX, p.clientY) as HTMLElement[];
      const inside = p.content ?? p.root;
      const el = stack.find((n) => inside.contains(n)) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const target = el ?? p.root;
      const base = { bubbles: true, cancelable: true, clientX: p.clientX, clientY: p.clientY, view: window };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1, isPrimary: true }));
      target.dispatchEvent(new MouseEvent("mousedown", base));
      target.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1, isPrimary: true }));
      target.dispatchEvent(new MouseEvent("mouseup", base));
      target.dispatchEvent(new MouseEvent("click", base));
      if (action === "double_click") target.dispatchEvent(new MouseEvent("dblclick", base));
      if (action === "right_click") target.dispatchEvent(new MouseEvent("contextmenu", base));
    };
    const typeInto = (app: string, text: string, submit: boolean) => {
      // Sheets types into its selected cell itself: Tab moves right, Enter moves down.
      if (app === "sheets") {
        window.dispatchEvent(new CustomEvent("everfern-sheet-type", { detail: { text, submit } }));
        return;
      }
      const root = findApp(app);
      if (!root) return;
      const wv = root.querySelector("webview") as any;
      const wcId = wv?.getWebContentsId?.();
      if (typeof wcId === "number") {
        api.workers?.webviewType?.(wcId, text, submit);
        return;
      }
      // The field the AI just clicked first; the window's first field only when nothing in it has focus.
      const active = document.activeElement as HTMLElement | null;
      const editable = (n: HTMLElement | null) => !!n && (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n.isContentEditable);
      const focusable = editable(active) && root.contains(active) ? active : root.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [contenteditable="true"]');
      const el = focusable;
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = el.value.slice(0, start) + text + el.value.slice(end);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable) {
        el.textContent = `${el.textContent ?? ""}${text}`;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      }
      if (submit) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      }
    };
    /** Lists host-window controls + guest-page controls for worker_describe. */
    const handleDescribe = async (req: { app?: string; requestId?: string }) => {
      if (!req?.app || !req?.requestId) return;
      const root = findApp(req.app);
      if (!root || !api) {
        api?.describeResult?.({ requestId: req.requestId, app: req.app, elements: [] });
        return;
      }
      const rect = root.getBoundingClientRect();
      const elements: Array<{ role: string; label: string; x: number; y: number }> = [];
      const nodes = root.querySelectorAll<HTMLElement>(
        'button, a[href], input, textarea, select, [role="button"], [data-ef-file], [data-sheet-cell], [contenteditable="true"]',
      );
      for (const el of Array.from(nodes).slice(0, 200)) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.bottom < rect.top || r.top > rect.bottom) continue;
        const label = (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.getAttribute("data-ef-file") ||
          el.getAttribute("data-sheet-cell") ||
          (el as HTMLInputElement).value ||
          el.textContent ||
          ""
        ).trim().slice(0, 60);
        elements.push({
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          label,
          x: Math.round((((r.left + r.width / 2) - rect.left) / rect.width) * 1000),
          y: Math.round((((r.top + r.height / 2) - rect.top) / rect.height) * 1000),
        });
      }
      const wv = root.querySelector("webview") as any;
      const wcId = wv?.getWebContentsId?.();
      if (typeof wcId === "number") {
        try {
          const guest = await api.workers?.webviewDescribe?.(wcId);
          if (guest && guest.w > 0 && guest.h > 0) {
            const wr = wv.getBoundingClientRect();
            const scaleX = wr.width / guest.w;
            const scaleY = wr.height / guest.h;
            for (const el of guest.items ?? []) {
              elements.push({
                role: el.role,
                label: el.label,
                x: Math.round((((wr.left + el.xpx * scaleX) - rect.left) / rect.width) * 1000),
                y: Math.round((((wr.top + el.ypx * scaleY) - rect.top) / rect.height) * 1000),
              });
            }
          }
        } catch { /* guest not ready */ }
      }
      api.describeResult?.({ requestId: req.requestId, app: req.app, elements: elements.slice(0, 200) });
    };
    const offs: Array<() => void> = [];
    offs.push(api.onPointer?.((e: { app?: string; x?: number; y?: number; action?: string }) => {
      if (typeof e?.app === "string" && typeof e.x === "number" && typeof e.y === "number") {
        const { app, x, y } = e;
        queue(() => click(app, x, y, e.action ?? "click"));
      }
    }) ?? (() => {}));
    offs.push(api.onType?.((e: { app?: string; text?: string; submit?: boolean }) => {
      if (typeof e?.app === "string" && typeof e.text === "string") { const { app, text } = e; queue(() => typeInto(app, text, !!e.submit)); }
    }) ?? (() => {}));
    offs.push(api.onDescribe?.((req: { app?: string; requestId?: string }) => { void handleDescribe(req); }) ?? (() => {}));
    return () => offs.forEach((off) => off());
  }, []);

  const aiApp = ai ? (wins.some((w) => w.app === ai.app) ? ai.app : open.find((w) => w.z === focusedZ)?.app) : undefined;

  return (
    <VmCtx.Provider value={vm}>
      <div className={`wk-desk${behind ? " is-behind" : ""}`} ref={bounds}>
        <BootPill show={booting} />
        <AnimatePresence>
          {full && (
            <motion.div key="full-scrim" className="wk-full-scrim" onClick={() => setFullApp(null)}
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.35 } }} exit={{ opacity: 0, transition: { duration: 0.25 } }} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {open.map((w, i) => (
            <AppWindow
              key={w.app}
              win={w}
              index={i}
              focused={w.z === focusedZ}
              full={w.app === full}
              bounds={bounds}
              partition={partition}
              workerId={workerId}
              navTo={navTo}
              machine={machine}
              cloudVmId={cloudVmId}
              locked={!!ai && w.app === aiApp}
              ai={w.app === aiApp ? ai : null}
              onFocus={() => w.z < topZ() - 1 && patch(w.app, { z: topZ() })}
              onMin={() => { if (w.app === full) setFullApp(null); patch(w.app, { min: true, max: false }); }}
              onFull={() => { setFullApp(full === w.app ? null : w.app); patch(w.app, { z: topZ() }); }}
              onClose={() => closeApp(w.app)}
            />
          ))}
        </AnimatePresence>

        {!hideThumbs && (
          <div className="wk-thumbs">
            <AnimatePresence>
              {/* With the chat open, the open windows step aside into this stack too (front-most first). */}
              {(behind ? [...[...open].sort((a, b) => b.z - a.z), ...minimized] : minimized).map(w => (
                <motion.button
                  key={w.app}
                  className="wk-thumb"
                  onClick={() => { const z = topZ(); setWins((ws) => ws.map((x) => (x.app === w.app ? { ...x, min: false, z } : { ...x, min: true, max: false }))); onPick?.(); }}
                  initial={{ opacity: 0, x: -60, rotateY: 50 }}
                  animate={{ opacity: 1, x: 0, rotateY: 16, scale: 1, transition: { type: "spring", duration: 0.38, bounce: 0 } }}
                  exit={{ opacity: 0, x: -40, rotateY: 40, transition: { duration: 0.22, ease: EASE } }}
                  whileHover={{ rotateY: 5, x: 6, scale: 1.015, transition: { type: "spring", duration: 0.3, bounce: 0 } }}
                  layout
                  title={`Open ${APPS[w.app]?.name ?? w.app}`}
                >
                  {adding === w.app && <span className="wk-app-adding" aria-label="Adding app"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" /></svg></span>}
                  <span
                    className="wk-app-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${APPS[w.app]?.name ?? w.app}`}
                    title={`Close ${APPS[w.app]?.name ?? w.app}`}
                    onClick={e => { e.stopPropagation(); closeApp(w.app); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); closeApp(w.app); } }}
                  >
                    <X size={11} strokeWidth={2.4} aria-hidden="true" />
                  </span>
                  <div className="wk-thumb-bar">
                    <AppLogo app={w.app} size={15} radius={3.5} />
                    <span className="wk-thumb-name">{APPS[w.app]?.name ?? w.app}</span>
                  </div>
                  <ThumbBody app={w.app} snapKey={`${partition}|${w.app}`} machine={machine} cloudVmId={cloudVmId} partition={partition} />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}

      </div>
    </VmCtx.Provider>
  );
}
