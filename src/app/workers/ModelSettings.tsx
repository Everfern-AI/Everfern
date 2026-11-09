"use client";

import { useDialogFocus } from "@/lib/use-dialog-focus";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Worker } from '@/lib/workers';
import { API_URL, LANDING_URL, cloudFetch, cloudToken, type CloudVm, type Limits, type Paywall } from "@/lib/cloud-vms";
import {
  Check, Cloud, KeyRound, Cpu, Eye, EyeOff, RefreshCw, MousePointerClick, Brain,
  Monitor, CircleCheck, CircleAlert, LoaderCircle, Terminal, Download, Package, Lock,
  Play, Square, Trash2, Plus, X, ExternalLink, Server, Maximize2, Minimize2,
} from "lucide-react";

/**
 * AI model and machine settings for the workers settings page.
 * Reads and writes the same ~/.everfern/config.json as the chat settings, so both stay in sync.
 */

type Api = any;
const api = (): Api => (typeof window !== "undefined" ? (window as any).electronAPI : undefined);

type Engine = "everfern" | "online" | "local";
type Prov = { id: string; name: string; logo: string; invert?: boolean };

const ONLINE: Prov[] = [
  { id: "openai", name: "OpenAI", logo: "/images/ai-providers/openai.svg", invert: true },
  { id: "anthropic", name: "Anthropic", logo: "/images/ai-providers/claude.svg" },
  { id: "gemini", name: "Gemini", logo: "/images/ai-providers/gemini.svg" },
  { id: "deepseek", name: "DeepSeek", logo: "/images/ai-providers/deepseek.svg" },
  { id: "openrouter", name: "OpenRouter", logo: "/images/ai-providers/openrouter.svg", invert: true },
  { id: "nvidia", name: "NVIDIA NIM", logo: "/images/ai-providers/nvidia.svg" },
  { id: "minimax", name: "MiniMax", logo: "/images/ai-providers/minimax.svg" },
  { id: "ollama-cloud", name: "Ollama Cloud", logo: "/images/ai-providers/ollama.svg", invert: true },
  { id: "huggingface", name: "Hugging Face", logo: "/images/ai-providers/hf-logo.svg" },
];
const LOCAL: (Prov & { url: string })[] = [
  { id: "ollama", name: "Ollama", logo: "/images/ai-providers/ollama.svg", invert: true, url: "http://localhost:11434" },
  { id: "lmstudio", name: "LM Studio", logo: "/images/ai-providers/lm-studio.png", url: "http://localhost:1234/v1" },
  { id: "llamacpp", name: "llama.cpp", logo: "/images/ai-providers/llamacpp.png", url: "http://localhost:8080/v1" },
];
const VISION: Prov[] = [
  { id: "everfern", name: "EverFern Cloud", logo: "/images/logos/black-logo-withoutbg.png" },
  { id: "openrouter", name: "OpenRouter", logo: "/images/ai-providers/openrouter.svg", invert: true },
  { id: "gemini", name: "Gemini", logo: "/images/ai-providers/gemini.svg" },
  { id: "openai", name: "OpenAI", logo: "/images/ai-providers/openai.svg", invert: true },
  { id: "anthropic", name: "Anthropic", logo: "/images/ai-providers/claude.svg" },
  { id: "minimax", name: "MiniMax", logo: "/images/ai-providers/minimax.svg" },
  { id: "nvidia", name: "NVIDIA NIM", logo: "/images/ai-providers/nvidia.svg" },
  { id: "ollama", name: "Ollama", logo: "/images/ai-providers/ollama.svg", invert: true },
];
/** Providers whose model id the user picks; the others use EverFern's tuned default. */
const CUSTOM_MODEL = new Set(["nvidia", "openrouter", "ollama-cloud"]);

const VISION_MODEL: Record<string, string> = {
  everfern: "everfern-tars-v1", openrouter: "openai/gpt-5.6-luna", minimax: "MiniMax-M3", openai: "gpt-5.5",
  anthropic: "claude-opus-4.6", gemini: "gemini-2.5-computer-use-preview-10-2025", ollama: "qwen3-vl:235b-cloud", nvidia: "qwen3-vl:235b-cloud",
};
const VISION_URL: Record<string, string> = {
  minimax: "https://api.minimax.io/v1", ollama: "https://ollama.com", openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com", nvidia: "https://integrate.api.nvidia.com/v1",
};

/** Live EverFern Cloud session, with an in-place Google sign-in that never leaves settings. */
export function useCloudAuth() {
  const [signedIn, setSignedIn] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const code = useRef<string | null>(null);

  const refresh = useCallback(() => setSignedIn(!!cloudToken()), []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); };
  }, [refresh]);

  const poll = useCallback(async () => {
    if (!code.current) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/desktop-poll?code=${code.current}`);
      if (res.status === 202 || !res.ok) return;
      const data = await res.json();
      if (data.status !== "complete") return;
      localStorage.setItem("everfern_cloud_session", JSON.stringify({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user }));
      code.current = null;
      setWaiting(false);
      setSignedIn(true);
    } catch { /* keep polling */ }
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(poll, 2500);
    const a = api();
    const onLink = () => { poll(); };
    a?.on?.("acp:protocol-link", onLink);
    return () => { clearInterval(t); a?.off?.("acp:protocol-link", onLink); };
  }, [waiting, poll]);

  const signIn = useCallback(async () => {
    setErr("");
    try {
      code.current = crypto.randomUUID();
      const url = `${LANDING_URL}/login?source=desktop&desktop_code=${code.current}`;
      if (api()?.shell?.openExternal) await api().shell.openExternal(url);
      else window.open(url, "_blank");
      setWaiting(true);
    } catch { setErr("Couldn't open the sign-in page."); }
  }, []);
  const cancel = useCallback(() => { code.current = null; setWaiting(false); }, []);

  return { signedIn, waiting, err, signIn, cancel };
}

/** Shown wherever EverFern Cloud is picked without a session. */
export function CloudGate({ auth, what }: { auth: ReturnType<typeof useCloudAuth>; what: string }) {
  return (
    <div className="st-gate">
      <span className="st-gate-ico">{auth.waiting ? <LoaderCircle size={16} className="st-spin" /> : <Lock size={16} />}</span>
      <div className="st-gate-txt">
        <div className="st-label">{auth.waiting ? "Finish signing in in your browser" : "Sign in to use EverFern Cloud"}</div>
        <div className="st-help">{auth.waiting ? "This updates on its own once you are signed in." : auth.err || `${what} runs on your EverFern account and credits.`}</div>
      </div>
      {auth.waiting
        ? <button type="button" className="st-btn" onClick={auth.cancel}>Cancel</button>
        : <button type="button" className="st-btn is-dark" onClick={auth.signIn}>Sign in</button>}
    </div>
  );
}

function ProvTiles({ items, value, onPick, locked }: { items: Prov[]; value: string; onPick: (id: string) => void; locked?: Set<string> }) {
  return (
    <div className="st-provs">
      {items.map((p) => (
        <button key={p.id} type="button" className={`st-prov${value === p.id ? " is-on" : ""}`} onClick={() => onPick(p.id)}>
          <span className={`st-prov-logo${p.id === "everfern" ? " is-brand" : ""}`}><Image unoptimized src={p.logo} alt="" width={p.id === "everfern" ? 22 : 18} height={p.id === "everfern" ? 22 : 18} /></span>
          <span>{p.name}</span>
          {value === p.id ? <Check size={12} className="st-prov-check" /> : locked?.has(p.id) ? <Lock size={11} className="st-prov-check is-lock" aria-label="Sign in required" /> : null}
        </button>
      ))}
    </div>
  );
}

function Secret({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="st-secret">
      <input className="st-input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="st-row">
      <div><div className="st-label">{label}</div>{help && <div className="st-help">{help}</div>}</div>
      <div className="st-field">{children}</div>
    </div>
  );
}

function Status({ tone, children }: { tone: "ok" | "warn" | "busy" | "off"; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "busy" ? LoaderCircle : CircleAlert;
  return <span className={`st-status is-${tone}`}><Icon size={12} className={tone === "busy" ? "st-spin" : ""} /> {children}</span>;
}

/* ── AI model ─────────────────────────────────────────────────────── */

export function ModelTab() {
  const [sub, setSub] = useState<"brain" | "vision">("brain");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [engine, setEngine] = useState<Engine>("everfern");
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [localProv, setLocalProv] = useState("ollama");
  const [localUrl, setLocalUrl] = useState("");
  const [localModel, setLocalModel] = useState("");

  const [vEnabled, setVEnabled] = useState(true);
  const [vMode, setVMode] = useState<"local" | "cloud">("cloud");
  const [vProv, setVProv] = useState("everfern");
  const [vModel, setVModel] = useState("");
  const [vKey, setVKey] = useState("");
  const [vUrl, setVUrl] = useState("");

  const auth = useCloudAuth();
  const signedIn = auth.signedIn;
  const cloudLocked = useMemo(() => (signedIn ? undefined : new Set(["everfern"])), [signedIn]);
  const hasApi = !!api()?.loadConfig;

  useEffect(() => {
    (async () => {
      try {
        const c = (await api()?.loadConfig?.())?.config ?? {};
        const eng: Engine = c.engine === "local" || c.engine === "online" || c.engine === "everfern" ? c.engine : c.provider === "everfern" ? "everfern" : "online";
        setEngine(eng);
        if (eng === "online") { setProvider(c.provider || "openai"); setApiKey(c.apiKey || ""); setModel(c.customModel || ""); }
        if (eng === "local") {
          const lp = LOCAL.find((p) => p.id === c.provider) ?? LOCAL[0];
          setLocalProv(lp.id); setLocalUrl(c.baseUrl || lp.url); setLocalModel(c.model || "");
        }
        const v = c.vlm;
        if (v) {
          setVEnabled(v.enabled !== false);
          setVMode(v.engine === "local" ? "local" : "cloud");
          if (v.engine !== "local") { setVProv(v.provider || "everfern"); setVModel(v.model || ""); setVKey(v.apiKey || ""); setVUrl(v.baseUrl || ""); }
        }
      } catch { /* defaults */ }
      setLoaded(true);
    })();
  }, []);

  const touch = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); setError(""); };

  /* Local models on this computer */
  const [lm, setLm] = useState<{ busy: boolean; running: boolean | null; models: { name: string; size_gb?: number }[]; err?: string }>({ busy: false, running: null, models: [] });
  const seq = useRef(0);
  const queryLocal = useCallback(async (prov: string, url: string) => {
    const sys = api()?.system;
    if (!sys?.getLocalModels) { setLm({ busy: false, running: null, models: [], err: "Open the desktop app to see models on this computer." }); return; }
    const n = ++seq.current;
    setLm((s) => ({ ...s, busy: true, err: undefined }));
    try {
      const res = await sys.getLocalModels({ provider: prov, baseUrl: url });
      if (n !== seq.current) return;
      setLm({ busy: false, running: !!res?.running, models: Array.isArray(res?.installedModels) ? res.installedModels : [], err: res?.running ? undefined : res?.error });
    } catch (e: any) {
      if (n === seq.current) setLm({ busy: false, running: false, models: [], err: e?.message });
    }
  }, []);
  useEffect(() => { if (loaded && engine === "local") queryLocal(localProv, localUrl || LOCAL.find((p) => p.id === localProv)!.url); }, [loaded, engine, localProv]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true); setError("");
    try {
      const cur = (await api()?.loadConfig?.())?.config ?? {};
      const next: any = { ...cur, engine };
      const needCloud = engine === "everfern" ? "the main model" : vEnabled && vMode === "cloud" && vProv === "everfern" ? "computer use" : "";
      if (needCloud && !cloudToken()) throw new Error(`Sign in to use EverFern Cloud for ${needCloud}.`);
      if (engine === "everfern") { next.provider = "everfern"; next.apiKey = cloudToken() || undefined; delete next.customModel; }
      if (engine === "online") {
        if (!apiKey.trim()) throw new Error("Add an API key for " + (ONLINE.find((p) => p.id === provider)?.name ?? provider) + ".");
        next.provider = provider; next.apiKey = apiKey.trim();
        next.customModel = CUSTOM_MODEL.has(provider) ? model.trim() || undefined : undefined;
      }
      if (engine === "local") {
        const lp = LOCAL.find((p) => p.id === localProv)!;
        next.provider = lp.id; next.model = localModel || cur.model; next.baseUrl = localUrl.trim() || lp.url;
        if (lp.id === "llamacpp") next.apiKey = "";
      }
      if (vMode === "cloud") {
        const omitUrl = vProv === "everfern" || vProv === "openrouter";
        next.vlm = {
          enabled: vEnabled, engine: "cloud", provider: vProv, model: vModel.trim() || VISION_MODEL[vProv] || VISION_MODEL.ollama,
          baseUrl: omitUrl ? undefined : vUrl.trim() || undefined,
          apiKey: vKey.trim() || (vProv === "everfern" ? cloudToken() : "") || undefined,
        };
      } else {
        next.vlm = { enabled: vEnabled, engine: "local", provider: "ollama", model: "qwen3-vl:2b", baseUrl: "http://localhost:11434" };
      }
      if (!api()?.saveConfig) throw new Error("Settings can only be saved in the desktop app.");
      const res = await api().saveConfig(next);
      if (res && res.success === false) throw new Error(res.error || "Couldn't save settings.");
      if (engine === "local") await api()?.agent?.setProvider?.({ provider: next.provider, model: next.model, baseUrl: next.baseUrl, ...(next.provider === "llamacpp" && { apiKey: "" }) });
      setDirty(false);
    } catch (e: any) {
      setError(e?.message || "Couldn't save settings.");
    } finally { setSaving(false); }
  };

  const engines: { id: Engine; title: string; desc: string; icon: React.ElementType }[] = [
    { id: "everfern", title: "EverFern Cloud", desc: "Frontier models, no keys to manage.", icon: Cloud },
    { id: "online", title: "Your API key", desc: "Bring a key from OpenAI, Anthropic and more.", icon: KeyRound },
    { id: "local", title: "On this computer", desc: "Private and free, runs through Ollama or LM Studio.", icon: Cpu },
  ];

  return (
    <>
      <div className="st-seg" role="tablist">
        <button role="tab" aria-selected={sub === "brain"} className={sub === "brain" ? "is-on" : ""} onClick={() => setSub("brain")}><Brain size={12} /> Main model</button>
        <button role="tab" aria-selected={sub === "vision"} className={sub === "vision" ? "is-on" : ""} onClick={() => setSub("vision")}><MousePointerClick size={12} /> Computer use</button>
      </div>

      {sub === "brain" && (
        <div className="st-stack">
          <div className="st-cards">
            {engines.map(({ id, title, desc, icon: Icon }) => (
              <button key={id} type="button" className={`st-card${engine === id ? " is-on" : ""}`} onClick={() => touch(setEngine)(id)}>
                {id === "everfern"
                  ? <span className="st-card-ico is-brand"><Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={28} height={28} /></span>
                  : <span className="st-card-ico"><Icon size={16} /></span>}
                <span className="st-card-t">{title}</span>
                <span className="st-card-d">{desc}</span>
                <span className="st-card-radio">{engine === id && <Check size={11} strokeWidth={3} />}</span>
                {id === "everfern" && !signedIn && <span className="st-card-lock"><Lock size={10} /> Sign in required</span>}
              </button>
            ))}
          </div>

          {engine === "everfern" && (signedIn ? (
            <div className="st-list">
              <Field label="Account" help="Workers think with EverFern's best model for each step. Usage comes from your credits.">
                <Status tone="ok">Signed in</Status>
              </Field>
            </div>
          ) : <CloudGate auth={auth} what="The main model" />)}

          {engine === "online" && (
            <>
              <div className="st-sub">Provider</div>
              <ProvTiles items={ONLINE} value={provider} onPick={touch(setProvider)} />
              <div className="st-list">
                <Field label="API key" help="Stored on this computer in ~/.everfern/keys.">
                  <Secret value={apiKey} onChange={touch(setApiKey)} placeholder="Paste your key" />
                </Field>
                {CUSTOM_MODEL.has(provider) && (
                  <Field label="Model" help="The model id from your provider.">
                    <input className="st-input" value={model} onChange={(e) => touch(setModel)(e.target.value)} placeholder={provider === "openrouter" ? "anthropic/claude-opus-4.6" : "model id"} spellCheck={false} />
                  </Field>
                )}
              </div>
            </>
          )}

          {engine === "local" && (
            <>
              <div className="st-sub">Runs with</div>
              <ProvTiles items={LOCAL} value={localProv} onPick={(id) => { touch(setLocalProv)(id); setLocalUrl(LOCAL.find((p) => p.id === id)!.url); setLocalModel(""); }} />
              <div className="st-list">
                <Field label="Server address" help={lm.running === false ? lm.err || "Not reachable. Make sure it is running." : "Where the model server listens."}>
                  <input className="st-input" value={localUrl} onChange={(e) => touch(setLocalUrl)(e.target.value)} onBlur={() => queryLocal(localProv, localUrl)} spellCheck={false} />
                </Field>
                <div className="st-row st-row-col">
                  <div className="st-row-head">
                    <div><div className="st-label">Model</div><div className="st-help">Installed on this computer.</div></div>
                    <div className="st-row-tools">
                      {lm.busy ? <Status tone="busy">Checking</Status> : lm.running ? <Status tone="ok">Running</Status> : lm.running === false ? <Status tone="warn">Offline</Status> : null}
                      <button type="button" className="st-iconbtn" onClick={() => queryLocal(localProv, localUrl)} aria-label="Refresh models"><RefreshCw size={13} /></button>
                    </div>
                  </div>
                  {lm.models.length > 0 ? (
                    <div className="st-models">
                      {lm.models.map((m) => (
                        <button key={m.name} type="button" className={`st-model${localModel === m.name ? " is-on" : ""}`} onClick={() => touch(setLocalModel)(m.name)}>
                          <span className="st-model-n">{m.name}</span>
                          {m.size_gb ? <span className="st-model-s">{m.size_gb} GB</span> : null}
                          {localModel === m.name && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="st-empty">{lm.busy ? "Looking for models..." : lm.err && lm.running === null ? lm.err : "No models found. Download one in " + (LOCAL.find((p) => p.id === localProv)?.name ?? "your model app") + ", then refresh."}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {sub === "vision" && (
        <div className="st-stack">
          <div className="st-list">
            <Field label="Let workers see and use apps" help="A vision model reads the screen so workers can click, type and scroll like you do.">
              <button type="button" role="switch" aria-checked={vEnabled} aria-label="Computer use" className={`st-toggle${vEnabled ? " is-on" : ""}`} onClick={() => touch(setVEnabled)(!vEnabled)}><span /></button>
            </Field>
          </div>
          <div className={`st-cards is-2${vEnabled ? "" : " is-dim"}`}>
            {([
              { id: "cloud", title: "Cloud vision", desc: "Most accurate. Best for busy apps and small text.", icon: Cloud },
              { id: "local", title: "On this computer", desc: "Qwen3-VL 2B through Ollama. Private, lighter.", icon: Monitor },
            ] as const).map(({ id, title, desc, icon: Icon }) => (
              <button key={id} type="button" className={`st-card${vMode === id ? " is-on" : ""}`} onClick={() => touch(setVMode)(id)} disabled={!vEnabled}>
                <span className="st-card-ico"><Icon size={16} /></span>
                <span className="st-card-t">{title}</span>
                <span className="st-card-d">{desc}</span>
                <span className="st-card-radio">{vMode === id && <Check size={11} strokeWidth={3} />}</span>
              </button>
            ))}
          </div>
          {vEnabled && vMode === "cloud" && (
            <>
              <div className="st-sub">Vision provider</div>
              <ProvTiles items={VISION} value={vProv} locked={cloudLocked} onPick={(id) => { touch(setVProv)(id); setVModel(""); setVUrl(""); }} />
              {vProv === "everfern" && !signedIn && <CloudGate auth={auth} what="Computer use" />}
              <div className="st-list">
                <Field label="Model" help="Leave empty for the recommended one.">
                  <input className="st-input" value={vModel} onChange={(e) => touch(setVModel)(e.target.value)} placeholder={VISION_MODEL[vProv] ?? "model id"} spellCheck={false} />
                </Field>
                {vProv !== "everfern" && (
                  <Field label="API key">
                    <Secret value={vKey} onChange={touch(setVKey)} placeholder="Paste your key" />
                  </Field>
                )}
                {vProv !== "everfern" && vProv !== "openrouter" && (
                  <Field label="Endpoint" help="Only change this for a self-hosted or proxy server.">
                    <input className="st-input" value={vUrl} onChange={(e) => touch(setVUrl)(e.target.value)} placeholder={VISION_URL[vProv] ?? "https://"} spellCheck={false} />
                  </Field>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="st-actions">
        {error && <span className="st-error"><CircleAlert size={13} /> {error}</span>}
        {!hasApi && !error && <span className="st-note">Open the desktop app to change models.</span>}
        <button className="st-save" onClick={save} disabled={!dirty || saving || !loaded}>
          {saving ? <LoaderCircle size={13} className="st-spin" /> : <Check size={13} />} {saving ? "Saving" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </>
  );
}

/* ── Virtual machine ──────────────────────────────────────────────── */

type VmState = { phase: "checking" | "missing" | "ready" | "unhealthy" | "unavailable"; os?: string; uptime?: string };
type Log = { message: string; level?: string };

/* ── EverFern Cloud VMs ───────────────────────────────────────────── */


const PLAN_VMS: { id: string; name: string; vms: string; size: string; hours: string }[] = [
  { id: "free", name: "Free", vms: "1 cloud VM", size: "1 vCPU, 1 GB memory, 3 GB disk", hours: "2 hours a month" },
  { id: "pro", name: "Pro", vms: "3 cloud VMs, 2 at once", size: "1 vCPU, 1 GB memory, 3 GB disk", hours: "50 hours a month" },
  { id: "max", name: "Max", vms: "10 cloud VMs, 5 at once", size: "1 vCPU, 1 GB memory, 3 GB disk", hours: "Unlimited hours" },
];
const MACHINE_KEY = "everfern_worker_machine";

function hours(min: number) {
  if (min < 0) return "unlimited";
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

const openOut = (url: string) => (api()?.shell?.openExternal ? api().shell.openExternal(url) : window.open(url, "_blank"));

export function PaywallView({ info, onClose }: { info: Paywall; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const current = info.plan || "free";
  const title = info.reason === "hours" ? "You're out of cloud VM hours" : info.reason === "running" ? "Too many VMs running" : "You've reached your cloud VM limit";
  return (
    <div className="st-pw" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="st-pw-card" role="alertdialog" aria-modal="true" aria-labelledby="st-pw-t">
        <button type="button" className="st-pw-x" onClick={onClose} aria-label="Close"><X size={14} /></button>
        <div className="st-pw-head">
          <span className="st-pw-logo"><Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={34} height={34} /></span>
          <div id="st-pw-t" className="st-pw-t">{title}</div>
          <div className="st-pw-d">{info.error} Upgrade to give your workers more cloud machines, bigger ones, and more hours.</div>
        </div>
        <div className="st-pw-plans">
          {PLAN_VMS.map((p) => (
            <div key={p.id} className={`st-pw-plan${p.id === current ? " is-current" : ""}${p.id === "pro" && current !== "pro" ? " is-pick" : ""}`}>
              <div className="st-pw-plan-top">
                <span className="st-pw-plan-n">{p.name}</span>
                {p.id === current ? <span className="st-pw-tag">Current</span> : p.id === "pro" ? <span className="st-pw-tag is-dark">Popular</span> : null}
              </div>
              <ul>
                <li><Server size={12} /> {p.vms}</li>
                <li><Cpu size={12} /> {p.size}</li>
                <li><Monitor size={12} /> {p.hours}</li>
              </ul>
            </div>
          ))}
        </div>
        <div className="st-pw-actions">
          <button type="button" className="st-btn" onClick={onClose}>Not now</button>
          <button type="button" className="st-btn is-dark" onClick={() => { openOut(`${LANDING_URL}/pricing`); onClose(); }}>See plans <ExternalLink size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export function DesktopView({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setLoaded(false); setSlow(false);
    const timer = setTimeout(() => setSlow(true), 25000);
    return () => clearTimeout(timer);
  }, [url, attempt]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className={`st-pw st-desktop-overlay${expanded ? " is-expanded" : ""}`} onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="st-vmview" role="dialog" aria-modal="true" aria-label={`${name} desktop`}>
        <div className="st-vmview-bar">
          <span className="st-desktop-identity"><span className="st-desktop-icon"><Monitor size={16} /></span><span><strong>{name}</strong><small>Virtual desktop</small></span></span>
          <div className="st-desktop-tools">
            <button type="button" className="st-btn is-icon" title="Reload desktop" aria-label="Reload desktop" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} /></button>
            <button type="button" className="st-btn is-icon" title={expanded ? "Restore size" : "Expand desktop"} aria-label={expanded ? "Restore size" : "Expand desktop"} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
            <button type="button" className="st-btn is-icon" title="Open in browser" aria-label="Open in browser" onClick={() => openOut(url)}><ExternalLink size={14} /></button>
            <span className="st-desktop-divider" />
            <button ref={closeRef} type="button" className="st-btn is-icon" onClick={onClose} aria-label="Close desktop" title="Close desktop"><X size={16} /></button>
          </div>
        </div>
        <div className="st-desktop-canvas">
          {!loaded && <div className="st-desktop-loading" role="status" aria-live="polite"><span className="st-desktop-loading-icon"><LoaderCircle size={24} className="st-spin" /></span><strong>{slow ? "Still opening your desktop" : "Opening your desktop"}</strong><p>{slow ? "The machine is taking longer than usual. You can reload to try again." : "Your machine’s desktop will appear here."}</p>{slow && <button className="st-btn" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={13} /> Try again</button>}</div>}
          <iframe key={`${url}-${attempt}`} src={url} title={`${name} desktop`} onLoad={() => setLoaded(true)} allow="clipboard-read; clipboard-write; fullscreen" style={{ opacity: loaded ? 1 : 0 }} />
        </div>
        <div className="st-desktop-footer"><span><Lock size={11} /> Apps and files run on this machine</span><span>Closing this view keeps your machine running</span></div>
      </div>
    </div>
  );
}

function CloudVms({ workers = [], onSaveWorker }: { workers?: Worker[]; onSaveWorker?: (worker: Worker) => void }) {
  const [deleteVm, setDeleteVm] = useState<CloudVm | null>(null);
  const [data, setData] = useState<{ plan: string; limits: Limits; vms: CloudVm[]; usage: { minutes_used: number; monthly_minutes: number } } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const [desktop, setDesktop] = useState<{ url: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await cloudFetch("/api/cloud-vms");
      if (!r.ok) { setErr(r.data?.error || "Couldn't load your cloud VMs."); return; }
      setErr(""); setData(r.data);
    } catch { setErr("Couldn't reach EverFern Cloud."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.vms.some((v) => ["creating", "starting", "stopping"].includes(v.status))) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [data, load]);

  const act = async (key: string, path: string, method = "POST", body?: unknown) => {
    setBusy(key); setErr("");
    try {
      const r = await cloudFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 402) setPaywall({ reason: r.data.reason, error: r.data.error, plan: r.data.plan, limits: r.data.limits });
      else if (!r.ok) setErr(r.data?.error || "That didn't work.");
      await load();
      return r.ok;
    } catch { setErr("Couldn't reach EverFern Cloud."); return false; }
    finally { setBusy(""); }
  };

  const openDesktop = async (vm: CloudVm) => {
    setBusy(`desk-${vm.id}`); setErr("");
    try {
      const r = await cloudFetch(`/api/cloud-vms/${vm.id}/desktop`);
      if (r.ok && r.data.url) setDesktop({ url: r.data.url, name: vm.name });
      else setErr(r.data?.error || "Couldn't open the desktop.");
    } catch { setErr("Couldn't reach EverFern Cloud."); }
    setBusy("");
  };

  if (!data) {
    return err
      ? <div className="st-error is-block"><CircleAlert size={13} /> {err} <button type="button" className="st-btn" onClick={load}><RefreshCw size={12} /> Retry</button></div>
      : <div className="st-help st-cvm-loading"><LoaderCircle size={12} className="st-spin" /> Loading cloud VMs...</div>;
  }

  const { limits, usage, vms } = data;
  const cap = usage.monthly_minutes;
  const pct = cap > 0 ? Math.min(100, Math.round((usage.minutes_used / cap) * 100)) : 0;
  const full = vms.length >= limits.max_vms;
  const tone = (s: string) => (s === "started" ? "ok" : s === "stopped" ? "off" : s === "error" ? "warn" : "busy") as "ok" | "off" | "warn" | "busy";
  const label: Record<string, string> = { started: "Running", stopped: "Stopped", creating: "Creating", starting: "Starting", stopping: "Stopping", error: "Error" };
  const planName = data.plan.charAt(0).toUpperCase() + data.plan.slice(1);

  return (
    <div className="st-stack">
      {deleteVm && <ConfirmDialog title={`Delete ${deleteVm.name}?`} description="This permanently removes this VM and its files." onClose={() => setDeleteVm(null)} onConfirm={async () => {
        if (workers.some(worker => worker.cloudVmId === deleteVm.id && worker.status === 'running')) throw new Error('Pause assigned workers before deleting their VM.');
        if (!await act(`del-${deleteVm.id}`, `/api/cloud-vms/${deleteVm.id}`, 'DELETE')) throw new Error('Couldn’t delete this VM. Please try again.');
      }} />}

      <div className="st-cvm-usage">
        <div className="st-cvm-usage-top">
          <span className="st-label">{planName} plan</span>
          <span className="st-help">{vms.length} of {limits.max_vms} VMs · {hours(usage.minutes_used)} of {hours(cap)} this month</span>
        </div>
        {cap > 0 && <div className="st-cvm-meter"><i style={{ width: `${pct}%` }} className={pct >= 90 ? "is-hot" : ""} /></div>}
        <div className="st-help">Each VM is a Linux desktop with {limits.cpu} vCPU, {limits.memory_gb} GB memory and {limits.disk_gb} GB disk. It stops after {limits.auto_stop_minutes} idle minutes so it doesn't use up your hours.</div>
      </div>

      <div className="st-list">
        {vms.length === 0 && (
          <div className="st-row"><div><div className="st-label">No cloud VMs yet</div><div className="st-help">Create a cloud desktop for your workers. Keep EverFern open to control it.</div></div></div>
        )}
        {vms.map((vm) => (
          <div key={vm.id} className="st-row st-cvm">
            <div className="st-cvm-main">
              <span className="st-cvm-ico"><Server size={14} /></span>
              <div>
                <div className="st-label">{vm.name}</div>
                <div className="st-help">{vm.cpu} vCPU · {vm.memory_gb} GB{vm.region ? ` · ${vm.region.toUpperCase()}` : ""}</div>
              </div>
            </div>
            <div className="st-cvm-actions">
              <Status tone={tone(vm.status)}>{label[vm.status] ?? vm.status}</Status>
              {vm.status === "started" && (
                <button type="button" className="st-btn" onClick={() => openDesktop(vm)} disabled={!!busy}>
                  {busy === `desk-${vm.id}` ? <LoaderCircle size={12} className="st-spin" /> : <Monitor size={12} />} Desktop
                </button>
              )}
              {vm.status === "started" && (
                <button type="button" className="st-btn is-icon" title="Stop" aria-label="Stop VM" onClick={() => act(`stop-${vm.id}`, `/api/cloud-vms/${vm.id}/stop`)} disabled={!!busy}>
                  {busy === `stop-${vm.id}` ? <LoaderCircle size={12} className="st-spin" /> : <Square size={11} />}
                </button>
              )}
              {(vm.status === "stopped" || vm.status === "error") && (
                <button type="button" className="st-btn is-icon" title="Start" aria-label="Start VM" onClick={() => act(`start-${vm.id}`, `/api/cloud-vms/${vm.id}/start`)} disabled={!!busy}>
                  {busy === `start-${vm.id}` ? <LoaderCircle size={12} className="st-spin" /> : <Play size={12} />}
                </button>
              )}
              <button type="button" className="st-btn is-icon is-danger" title="Delete" aria-label="Delete VM" disabled={!!busy}
                onClick={() => setDeleteVm(vm)}>
                {busy === `del-${vm.id}` ? <LoaderCircle size={12} className="st-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
            <MachineWorkers machineId={vm.id} workers={workers} onSaveWorker={onSaveWorker} />
          </div>
        ))}
        <div className="st-row">
          <div><div className="st-label">New cloud VM</div><div className="st-help">{full ? `Your plan includes ${limits.max_vms}. Upgrade for more.` : "Takes about a minute to start."}</div></div>
          <button type="button" className="st-btn is-dark" disabled={!!busy}
            onClick={() => full
              ? setPaywall({ reason: "count", plan: data.plan, limits, error: `The ${planName} plan includes ${limits.max_vms} cloud VM${limits.max_vms === 1 ? "" : "s"}.` })
              : act("create", "/api/cloud-vms", "POST", {})}>
            {busy === "create" ? <LoaderCircle size={13} className="st-spin" /> : full ? <Lock size={12} /> : <Plus size={13} />} {busy === "create" ? "Creating" : "Create VM"}
          </button>
        </div>
      </div>

      {err && <div className="st-error is-block"><CircleAlert size={13} /> {err}</div>}
      {paywall && <PaywallView info={paywall} onClose={() => setPaywall(null)} />}
      {desktop && <DesktopView url={desktop.url} name={desktop.name} onClose={() => setDesktop(null)} />}
    </div>
  );
}

export function MachineTab({ workers = [], onSaveWorker }: { workers?: Worker[]; onSaveWorker?: (worker: Worker) => void }) {
  const auth = useCloudAuth();
  const [where, setWhere] = useState<"local" | "cloud">("local");
  useEffect(() => { if (localStorage.getItem(MACHINE_KEY) === "cloud") setWhere("cloud"); }, []);
  const pick = (w: "local" | "cloud") => { setWhere(w); localStorage.setItem(MACHINE_KEY, w); };

  return (
    <div className="st-stack st-machine">
      <div className="st-cards is-2">
        <button type="button" className={`st-card${where === "local" ? " is-on" : ""}`} onClick={() => pick("local")}>
          <span className="st-card-ico"><Monitor size={16} /></span>
          <span className="st-card-t">This computer</span>
          <span className="st-card-d">An Alpine Linux VM on your machine. Free, private, works offline.</span>
          <span className="st-card-radio">{where === "local" && <Check size={11} strokeWidth={3} />}</span>
        </button>
        <button type="button" className={`st-card${where === "cloud" ? " is-on" : ""}`} onClick={() => pick("cloud")}>
          <span className="st-card-ico is-brand"><Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={28} height={28} /></span>
          <span className="st-card-t">EverFern Cloud VM</span>
          <span className="st-card-d">A Linux desktop in the cloud. Keep EverFern open while workers run.</span>
          <span className="st-card-radio">{where === "cloud" && <Check size={11} strokeWidth={3} />}</span>
          {!auth.signedIn && <span className="st-card-lock"><Lock size={10} /> Sign in required</span>}
        </button>
      </div>
      {where === "local" ? <LocalMachine /> : auth.signedIn ? <><CloudMachines workers={workers} onSaveWorker={onSaveWorker} /><CloudVms workers={workers} onSaveWorker={onSaveWorker} /></> : <CloudGate auth={auth} what="Cloud VMs" />}
    </div>
  );
}

function CloudMachines({ workers, onSaveWorker }: { workers: Worker[]; onSaveWorker?: (worker: Worker) => void }) {
  const [machines, setMachines] = useState<any[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const r = await cloudFetch('/api/cloud-machines'); if (!r.ok) throw Error(r.data.error || 'Could not load machines.'); setMachines(r.data.machines || []); setError(''); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  return <div className="st-stack">
    <div className="st-row"><div><div className="st-label">Cloud assignment</div><div className="st-help">New cloud workers automatically use an available machine.</div></div><button className="st-btn" onClick={load}><RefreshCw size={12} /> Refresh</button></div>
    {machines.map(machine => <div className="st-auto-assignment" key={machine.id}>
      
      <MachineWorkers machineId={machine.id} workers={workers} onSaveWorker={onSaveWorker} onAssigned={load} />
    </div>)}
    {error && <div className="st-error is-block" role="alert">{error}</div>}
  </div>;
}

function MachineWorkers({ machineId, workers, onSaveWorker, onAssigned }: { machineId: string; workers: Worker[]; onSaveWorker?: (worker: Worker) => void; onAssigned?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [moveWorker, setMoveWorker] = useState<Worker | null>(null);
  const [error, setError] = useState('');
  const assigned = workers.filter(worker => worker.machine === 'cloud' && worker.cloudVmId === machineId);
  const change = async (worker: Worker, remove = false) => {
    setBusy(true); setError('');
    try {
      const response = await cloudFetch('/api/cloud-machines/assign', { method: remove ? 'DELETE' : 'POST', body: JSON.stringify({ worker_id: worker.id, name: worker.name, machine_id: machineId }) });
      if (!response.ok) throw Error(response.data.error || 'Could not change assignment.');
      onSaveWorker?.({ ...worker, machine: remove ? 'local' : 'cloud', cloudVmId: remove ? undefined : machineId });
      onAssigned?.();
    } catch (error: any) { setError(error.message); throw error; }
    finally { setBusy(false); }
  };
  return <div className="st-machine-workers">
    {moveWorker && <ConfirmDialog title={`Move ${moveWorker.name}?`} description="This worker will use this computer’s Alpine VM. Its cloud app windows will reconnect when reopened." confirmLabel="Move worker" onClose={() => setMoveWorker(null)} onConfirm={async () => {
      if (workers.find(worker => worker.id === moveWorker.id)?.status === 'running') throw new Error('Pause this worker before moving it.');
      await change(moveWorker, true);
    }} />}

    <span className="st-machine-workers-label">Assigned workers</span>
    <div className="st-machine-worker-chips">{assigned.length ? assigned.map(worker => <span className="st-machine-worker-chip" key={worker.id}><i style={{ background: `hsl(${worker.hue} 55% 65%)` }} /><span>{worker.name}</span><button aria-label={`Unassign ${worker.name}`} title="Move to this computer" disabled={busy || worker.status === 'running'} onClick={() => setMoveWorker(worker)}><X size={10} /></button></span>) : <span className="st-help">No workers assigned</span>}
      <select aria-label="Assign a worker to this machine" className="st-machine-assign" value="" disabled={busy || !onSaveWorker} onChange={event => { const worker = workers.find(w => w.id === event.target.value); if (worker) void change(worker).catch(() => {}); }}><option value="">{busy ? 'Assigning…' : '+ Assign worker'}</option>{workers.filter(worker => !assigned.some(w => w.id === worker.id)).map(worker => <option key={worker.id} value={worker.id} disabled={worker.status === 'running'}>{worker.name}{worker.status === 'running' ? ' · Running' : ''}</option>)}</select>
    </div>
    {error && <span className="st-error" role="alert">{error}</span>}
  </div>;
}

function LocalMachine() {
  const [platform, setPlatform] = useState<string>("");
  const [vm, setVm] = useState<VmState>({ phase: "checking" });
  const [deps, setDeps] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "vm" | "deps" | "desk">("");
  const [desk, setDesk] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [msg, setMsg] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async () => {
    const sys = api()?.system;
    if (!sys?.getPlatform) { setVm({ phase: "unavailable" }); return; }
    setVm({ phase: "checking" });
    const plat = (await sys.getPlatform()) || "win32";
    setPlatform(plat);
    let next: VmState;
    if (plat === "linux") next = { phase: "ready", os: "Native Linux", uptime: "Active" };
    else if (plat === "darwin") next = (await sys.checkDocker?.()) ? { phase: "ready", os: "Alpine Linux VM", uptime: "Active" } : { phase: "missing" };
    else if (await sys.checkWSL?.()) {
      const info = await sys.getWSLInfo?.();
      next = { phase: info?.healthy === false ? "unhealthy" : "ready", os: info?.osName || "Alpine Linux", uptime: info?.uptime };
    } else next = { phase: "missing" };
    setVm(next);
    if (next.phase === "ready") { try { setDeps(await sys.checkEnvironmentDependencies?.()); } catch { /* shown as unknown */ } }
  }, []);

  useEffect(() => {
    check();
    const sys = api()?.system;
    sys?.onVMSetupLog?.((d: Log) => setLogs((l) => [...l.slice(-200), d]));
    return () => sys?.removeVMSetupLogListeners?.();
  }, [check]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs.length]);

  const install = async () => {
    const sys = api()?.system;
    setBusy("vm"); setMsg(""); setLogs([]);
    try {
      // One pass: create the Alpine VM, then install everything inside it.
      const res = platform === "darwin" ? await sys.setupDockerUbuntu?.() : platform === "win32" ? await sys.installWSL?.() : { success: true };
      if (res?.success === false) setMsg(res.error || "Setup didn't finish.");
      else {
        const res2 = await sys.setupEnvironmentDependencies?.();
        if (res2?.success === false) setMsg(res2.error || "Some tools didn't install.");
      }
      await check();
    } catch (e: any) { setMsg(e?.message || "Setup didn't finish."); }
    setBusy("");
  };
  const installDeps = async () => {
    const sys = api()?.system;
    setBusy("deps"); setMsg(""); setLogs([]);
    try {
      const res = await sys.setupEnvironmentDependencies?.();
      if (res?.success === false) setMsg(res.error || "Some tools didn't install.");
      setDeps(await sys.checkEnvironmentDependencies?.());
    } catch (e: any) { setMsg(e?.message || "Some tools didn't install."); }
    setBusy("");
  };

  const openDesktop = async () => {
    setBusy("desk"); setMsg("");
    try {
      const res = await api()?.system?.startVMDesktop?.();
      if (res?.success && res.url) setDesk(res.url);
      else setMsg(res?.error || "The VM desktop didn't start. Try Repair, then open it again.");
    } catch (e: any) { setMsg(e?.message || "The VM desktop didn't start."); }
    setBusy("");
  };

  const runtimeOk = !!(deps?.pythonInstalled && deps?.nodeInstalled && deps?.venvReady);
  const pkgsOk = !!deps?.pipPackagesInstalled;
    const tone = vm.phase === "ready" ? "ok" : vm.phase === "checking" ? "busy" : vm.phase === "unavailable" ? "off" : "warn";
  const label = { checking: "Checking", missing: "Not installed", ready: "Running", unhealthy: "Needs attention", unavailable: "Desktop app only" }[vm.phase];

  return (
    <div className="st-stack">
      <div className={`st-vm is-${vm.phase}`}>
        <div className="st-vm-screen" aria-hidden>
          <span className="st-vm-bar"><i /><i /><i /></span>
          <span className="st-vm-prompt"><Terminal size={12} /><b>worker</b>:~$<em /></span>
        </div>
        <div className="st-vm-info">
          <div className="st-vm-t">Worker machine</div>
          <div className="st-help">
            {vm.phase === "unavailable"
              ? "Your workers get their own Linux machine to run code, files and tools. Open the desktop app to set it up."
              : vm.phase === "missing"
                ? "Workers and the apps they open run in a small isolated Alpine Linux VM with Python, Node.js, LibreOffice, Chromium and the skill libraries. Set it up once; the first run downloads about 1 GB."
                : `${vm.os ?? "Linux"}${vm.uptime && vm.uptime !== "Active" ? ` · up ${vm.uptime}` : ""}. Code and files from workers stay inside it.`}
          </div>
          <div className="st-vm-row">
            <Status tone={tone}>{label}</Status>
            {vm.phase === "missing" && <button className="st-btn is-dark" onClick={install} disabled={!!busy}>{busy === "vm" ? <LoaderCircle size={13} className="st-spin" /> : <Download size={13} />} {busy === "vm" ? "Setting up" : "Set up machine"}</button>}
            {vm.phase === "unhealthy" && <button className="st-btn is-dark" onClick={install} disabled={!!busy}>{busy === "vm" ? <LoaderCircle size={13} className="st-spin" /> : <RefreshCw size={13} />} Repair</button>}
            {vm.phase === "ready" && platform === "win32" && <button className="st-btn is-dark" onClick={openDesktop} disabled={!!busy}>{busy === "desk" ? <LoaderCircle size={13} className="st-spin" /> : <Monitor size={13} />} {busy === "desk" ? "Starting desktop" : "Open desktop"}</button>}
            {vm.phase !== "unavailable" && vm.phase !== "checking" && <button className="st-btn" onClick={check} disabled={!!busy}><RefreshCw size={12} /> Check again</button>}
          </div>
        </div>
      </div>

      {vm.phase === "ready" && (
        <div className="st-list">
          <Field label="Python and Node.js" help={deps ? `${deps.pythonVersion || "Python 3"} · ${deps.nodeVersion || "Node.js"} · ~/.everfern/venv` : "Checking tools..."}>
            {deps ? <Status tone={runtimeOk ? "ok" : "warn"}>{runtimeOk ? "Ready" : "Missing"}</Status> : <Status tone="busy">Checking</Status>}
          </Field>
          <Field label="Document and data packages" help="pandas, openpyxl, python-docx, LibreOffice, pandoc and OCR, for working with files.">
            {deps ? <Status tone={pkgsOk ? "ok" : "warn"}>{pkgsOk ? "Ready" : "Missing"}</Status> : <Status tone="busy">Checking</Status>}
          </Field>
          {deps && (!runtimeOk || !pkgsOk) && (
            <div className="st-row">
              <div><div className="st-label">Install what's missing</div><div className="st-help">Downloads into the Alpine VM only.</div></div>
              <button className="st-btn is-dark" onClick={installDeps} disabled={!!busy}>{busy === "deps" ? <LoaderCircle size={13} className="st-spin" /> : <Package size={13} />} {busy === "deps" ? "Installing" : "Install"}</button>
            </div>
          )}
        </div>
      )}

      <div className="st-list">
        <Field label="Worker browsers" help="Cloud workers use separate browser profiles with local cookie backups, so sign-ins can carry over to replacement VMs." >
          <Status tone="ok">Isolated</Status>
        </Field>
      </div>

      {msg && <div className="st-error is-block"><CircleAlert size={13} /> {msg}</div>}
      {desk && <DesktopView url={desk} name="Worker machine" onClose={() => setDesk(null)} />}
      {((busy && busy !== "desk") || logs.length > 0) && (
        <div className="st-log" ref={logRef}>
          {logs.length === 0 && <div className="st-log-l">Starting...</div>}
          {logs.map((l, i) => <div key={i} className={`st-log-l is-${l.level ?? "info"}`}>{l.message}</div>)}
        </div>
      )}
    </div>
  );
}
