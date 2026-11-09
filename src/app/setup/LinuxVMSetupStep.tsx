"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader, Terminal, RefreshCw, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

/** The Alpine Linux mark (from simple-icons), in Alpine's brand blue. */
export const AlpineLogo = ({ size = 32, color = "#0D597F" }: { size?: number; color?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Alpine Linux">
    <path fill={color} d="M5.998 1.607L0 12l5.998 10.393h12.004L24 12 18.002 1.607H5.998zM9.965 7.12L12.66 9.9l1.598 1.595.002-.002 2.41 2.363c-.2.14-.386.252-.563.344a3.756 3.756 0 01-.496.217 2.702 2.702 0 01-.425.111c-.131.023-.25.034-.358.034-.13 0-.242-.014-.338-.034a1.317 1.317 0 01-.24-.072.95.95 0 01-.2-.113l-1.062-1.092-3.039-3.041-1.1 1.053-3.07 3.072a.974.974 0 01-.2.111 1.274 1.274 0 01-.237.073c-.096.02-.209.033-.338.033-.108 0-.227-.009-.358-.031a2.7 2.7 0 01-.425-.114 3.748 3.748 0 01-.496-.217 5.228 5.228 0 01-.563-.343l6.803-6.727zm4.72.785l4.579 4.598 1.382 1.353a5.24 5.24 0 01-.564.344 3.73 3.73 0 01-.494.217 2.697 2.697 0 01-.426.111c-.13.023-.251.034-.36.034-.129 0-.241-.014-.337-.034a1.285 1.285 0 01-.385-.146c-.033-.02-.05-.036-.053-.04l-1.232-1.218-2.111-2.111-.334.334L12.79 9.8l1.896-1.897zm-5.966 4.12v2.529a2.128 2.128 0 01-.356-.035 2.765 2.765 0 01-.422-.116 3.708 3.708 0 01-.488-.214 5.217 5.217 0 01-.555-.34l1.82-1.825Z" />
  </svg>
);

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  level?: "info" | "success" | "warn" | "error";
}

interface LinuxVMSetupStepProps {
  onComplete: () => void;
  onSkip: () => void;
}

type Status = "checking" | "ready" | "missing" | "installing" | "restart" | "error";

const INSIDE = ["Python 3", "Node.js", "LibreOffice", "Chromium", "pandoc", "OCR", "Skill libraries"];

const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.system : undefined);

const ghostButton: React.CSSProperties = {
  flex: 1,
  minWidth: 120,
  height: 48,
  background: "transparent",
  color: "var(--color-text-tertiary)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = {
  flex: 2,
  minWidth: 160,
  height: 48,
  background: "var(--color-text-primary)",
  color: "var(--color-bg-base)",
  border: "none",
  borderRadius: 999,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

/**
 * One step: EverFern's Alpine Linux VM. Workers and the apps they open run in
 * it. Built from Alpine's official minirootfs image. Everything (Python, Node, LibreOffice, Chromium...)
 * is installed inside it in a single pass.
 */
export default function LinuxVMSetupStep({ onComplete, onSkip }: LinuxVMSetupStepProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [platform, setPlatform] = useState<string>("win32");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).toLowerCase();
    setLogs((prev) => (prev.length && prev[prev.length - 1].message === message ? prev : [...prev, { id: Date.now() + Math.random(), timestamp, message, level }]));
  }, []);

  useEffect(() => {
    const sys = api();
    sys?.onVMSetupLog?.((d: any) => d?.message && addLog(d.message, d.level || "info"));
    return () => sys?.removeVMSetupLogListeners?.();
  }, [addLog]);

  useEffect(() => {
    const box = logEndRef.current?.parentElement;
    if (logsOpen && box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [logs, logsOpen]);

  const check = useCallback(async () => {
    const sys = api();
    setStatus("checking");
    setError("");
    if (!sys) {
      setStatus("ready");
      return;
    }
    try {
      const plat: string = (await sys.getPlatform?.()) || "win32";
      setPlatform(plat);
      if (plat === "linux") {
        setDetail("Runs natively on this Linux machine");
        setStatus("ready");
        return;
      }
      const installed = plat === "win32" ? await sys.checkWSL?.() : !!(await sys.checkDocker?.());
      if (!installed) {
        setStatus("missing");
        return;
      }
      const deps = await sys.checkEnvironmentDependencies?.();
      if (deps?.vmReady && deps?.pipPackagesInstalled && deps?.nodePackagesInstalled) {
        if (plat === "win32") {
          const info = await sys.getWSLInfo?.();
          setDetail([info?.osName, info?.uptime].filter(Boolean).join(" · "));
        } else {
          setDetail("Alpine Linux VM running");
        }
        setStatus("ready");
      } else {
        setDetail(deps?.missingList?.length ? `Missing: ${deps.missingList.join(", ")}` : "");
        setStatus("missing");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const install = async () => {
    const sys = api();
    if (!sys) return;
    setStatus("installing");
    setError("");
    setLogsOpen(true);
    try {
      if (platform === "win32") {
        addLog("Setting up the Alpine Linux VM...");
        const res = await sys.installWSL?.();
        if (res && !res.success) {
          if (res.needsRestart) {
            setError(res.error || "Restart your PC to finish turning on WSL, then come back to this step.");
            setStatus("restart");
          } else {
            setError(res.error || "Could not create the Alpine VM.");
            setStatus("error");
          }
          return;
        }
        const res2 = await sys.setupEnvironmentDependencies?.();
        if (res2 && !res2.success) throw new Error(res2.error || "Installing tools inside the VM failed.");
      } else if (platform === "darwin") {
        if (!(await sys.checkDocker?.())) {
          setError("Install Docker Desktop and start it, then try again.");
          setStatus("error");
          return;
        }
        addLog("Creating the Alpine container...");
        const res = await sys.setupDockerUbuntu?.();
        if (res && !res.success) throw new Error(res.error || "Could not create the Alpine container.");
        await sys.setupEnvironmentDependencies?.();
      } else {
        await sys.setupEnvironmentDependencies?.();
      }
      await check();
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("error");
    }
  };

  const copyLogs = () => {
    navigator.clipboard?.writeText(logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const busy = status === "checking" || status === "installing";
  const levelColor = (l?: LogEntry["level"]) =>
    l === "error" ? "#f87171" : l === "warn" ? "#fbbf24" : l === "success" ? "#4ade80" : "rgba(255,255,255,0.72)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div style={{ textAlign: "center", marginBottom: 20, width: "100%" }}>
        <div style={{ width: 64, height: 64, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 18, background: "#ffffff", boxShadow: "0 6px 24px rgba(13,89,127,0.35)" }}>
          <AlpineLogo size={44} />
        </div>
        <h1 className="ef-title">Alpine Linux VM</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", lineHeight: 1.55, maxWidth: 480, margin: "0 auto" }}>
          Workers, and the apps they open, run inside a small isolated Alpine Linux VM. Everything they need is installed inside it in one pass.
        </p>
      </div>

      {/* The one row */}
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "14px 16px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${status === "ready" ? "rgba(34,197,94,0.3)" : status === "error" || status === "restart" ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)"}`,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ marginTop: 2, flexShrink: 0 }}>
          {busy ? (
            <Loader size={18} className="animate-spin" style={{ color: "var(--color-text-tertiary)" }} />
          ) : status === "ready" ? (
            <CheckCircle2 size={18} style={{ color: "#22c55e" }} />
          ) : status === "error" || status === "restart" ? (
            <AlertCircle size={18} style={{ color: "#ef4444" }} />
          ) : (
            <AlpineLogo size={18} color="#3b9ed3" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {platform === "linux" ? "Native Linux" : "Alpine Linux VM"}
            </span>
            <span style={{ fontSize: 12, color: status === "ready" ? "#22c55e" : "var(--color-text-tertiary)" }}>
              {status === "checking" ? "Checking" : status === "installing" ? "Installing" : status === "ready" ? "Ready" : status === "restart" ? "Restart needed" : status === "error" ? "Failed" : "Not installed"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4, lineHeight: 1.45 }}>
            {detail || (status === "installing" ? "First run downloads about 1 GB. This can take several minutes." : "About 1 GB once installed.")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {INSIDE.map((t) => (
              <span key={t} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--color-text-secondary)" }}>
                {t}
              </span>
            ))}
          </div>
          {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 10, lineHeight: 1.45 }}>{error}</div>}
        </div>
      </div>

      {/* Live log */}
      {logs.length > 0 && (
        <div style={{ width: "100%", marginTop: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.35)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: logsOpen ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <Terminal size={13} style={{ color: "var(--color-text-tertiary)" }} />
            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", flex: 1, fontFamily: "ui-monospace, monospace" }}>root@everfern</span>
            <button onClick={copyLogs} title="Copy log" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 2, display: "flex" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button onClick={() => setLogsOpen((v) => !v)} title={logsOpen ? "Hide log" : "Show log"} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 2, display: "flex" }}>
              {logsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {logsOpen && (
            <div style={{ maxHeight: 180, overflowY: "auto", padding: "8px 12px", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.6, textAlign: "left" }}>
              {logs.map((l) => (
                <div key={l.id} style={{ color: levelColor(l.level), wordBreak: "break-word" }}>
                  <span style={{ opacity: 0.45, marginRight: 8 }}>{l.timestamp}</span>
                  {l.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 18, flexWrap: "wrap" }}>
        {status === "ready" && (
          <button onClick={onComplete} style={primaryButton}>
            Continue
          </button>
        )}
        {status === "missing" && (
          <button onClick={install} style={primaryButton}>
            <AlpineLogo size={16} color="currentColor" /> Set up Alpine VM
          </button>
        )}
        {(status === "error" || status === "restart") && (
          <button onClick={status === "restart" ? check : install} style={primaryButton}>
            <RefreshCw size={14} /> {status === "restart" ? "Check again" : "Retry"}
          </button>
        )}
        {busy && (
          <button disabled style={{ ...primaryButton, opacity: 0.6, cursor: "default" }}>
            <Loader size={15} className="animate-spin" /> {status === "checking" ? "Checking" : "Installing"}
          </button>
        )}
        {status !== "ready" && (
          <button onClick={onSkip} style={ghostButton}>
            Skip for now
          </button>
        )}
      </div>

      <div style={{ marginTop: 18, padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box" }}>
        <Terminal size={14} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
        <p style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.4, margin: 0, textAlign: "left" }}>
          You can check or reinstall the VM anytime in <strong>Workers &gt; Settings &gt; Machine</strong>.
        </p>
      </div>
    </motion.div>
  );
}
