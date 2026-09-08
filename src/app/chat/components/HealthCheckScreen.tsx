"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/components/common/ThemeProvider";

/** State of one startup probe stage, as painted by the paced UI sequence. */
export interface HealthCheckItem {
  id: string;
  label: string;
  status: "pending" | "checking" | "success" | "error";
  message?: string;
  details?: string;
}

/** Props for HealthCheckScreen. `onComplete` receives overall success and
 * per-stage error messages once all checks settle. */
interface HealthCheckScreenProps {
  onComplete: (success: boolean, errors: string[]) => void;
  autoStart?: boolean;
}

const PRO_TIPS = [
  "Hold Ctrl+Alt to activate voice mode anywhere",
  "Use /help in chat to discover all commands",
  "Pin frequently used tools in Settings for faster access",
  "Ask Fern to schedule tasks for later",
  "Right-click any message to edit or retry it",
  "Drag files directly into the chat to analyze them",
  "Use @ to mention projects for context-aware assistance",
  "Fern can browse the web — just ask it to look something up",
];

/**
 * Full-screen startup health-check splash: runs API/database/vector/model
 * probes sequentially with animated stage transitions, cycling pro tips
 * while the user waits. Calls `onComplete(success, errors)` when all
 * stages settle. Renders the EverFern logo, rotating tips, the latest
 * error, and a bottom progress bar.
 */
export const HealthCheckScreen: React.FC<HealthCheckScreenProps> = ({
  onComplete,
  autoStart = true,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [checks, setChecks] = useState<HealthCheckItem[]>([
    { id: "api", label: "API Connectivity", status: "pending" },
    { id: "database", label: "Database Connection", status: "pending" },
    { id: "vectors", label: "Vector Store", status: "pending" },
    { id: "models", label: "Loading Models", status: "pending" },
  ]);

  const [isComplete, setIsComplete] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * PRO_TIPS.length));
  const [logoDim, setLogoDim] = useState(false);
  // Ref mirror so the async probe sequence always calls the latest onComplete
  // without being captured stale by the effect closure.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Cycle tips every 3s
  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % PRO_TIPS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isComplete]);

  useEffect(() => {
    if (!autoStart) return;

    const STAGE_PACE_MS = 350;
    const COMPLETION_PAUSE_MS = 300;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const STAGE_ORDER = ["api", "database", "vectors", "models"] as const;
    type ProbeResult = string | null;

    // Shared error map (id -> message): populated by probes AND by runStage,
    // so collectErrors() can build the final report in STAGE_ORDER even if
    // a probe threw before recording its own error.
    const errorById = new Map<string, string>();

    const checkApi = async (): Promise<ProbeResult> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const apiResponse = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/health`,
            { method: "GET", signal: controller.signal }
          );

          if (apiResponse.ok) return null;
          return `API connection failed: API returned ${apiResponse.status}`;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        return `API connection failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const checkDatabase = async (): Promise<ProbeResult> => {
      try {
        const dbResponse = await (window as any).electronAPI?.db?.checkConnection?.();
        if (dbResponse && dbResponse.success) return null;
        return dbResponse?.error || "Database connection failed";
      } catch (err) {
        return `Database check failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const checkVectors = async (): Promise<ProbeResult> => {
      try {
        let embProvider = "everfern";
        let embModel = "qwen/qwen3-embedding-8b";
        try {
          const cfgRes = await (window as any).electronAPI?.loadConfig?.();
          if (cfgRes?.success && cfgRes.config?.embedding) {
            embProvider = cfgRes.config.embedding.provider || "everfern";
            embModel = cfgRes.config.embedding.model || "qwen/qwen3-embedding-8b";
          }
        } catch (_) {}

        if (embProvider === "ollama") {
          // Local ollama embeddings: the vector store check is only meaningful
          // if the configured embedding model is actually installed, so probe
          // the ollama tags API first and short-circuit with a pull hint.
          try {
            const ollamaRes = await fetch("http://localhost:11434/api/tags", {
              method: "GET",
              signal: AbortSignal.timeout(3000),
            });
            if (ollamaRes.ok) {
              const data = await ollamaRes.json();
              const models: string[] = (data.models || []).map((m: any) =>
                m.name?.toLowerCase() || ""
              );
              const modelName = embModel.toLowerCase().replace(":latest", "");
              const isInstalled = models.some(
                (m) => m.includes(modelName) || m.startsWith(modelName)
              );
              if (isInstalled) {
                const vectorResponse = await (window as any).electronAPI?.db?.checkVectors?.();
                if (vectorResponse && vectorResponse.success) return null;
                const errStr = vectorResponse?.error || "Failed to check vector store";
                errorById.set("vectors", errStr);
                return errStr;
              }
              errorById.set("vectors", `Embedding model "${embModel}" not installed. Run: ollama pull ${embModel}`);
              return `Model not found: ${embModel}`;
            }
            errorById.set("vectors", "Ollama is not running.");
            return "Ollama not running";
          } catch {
            errorById.set("vectors", "Ollama unreachable.");
            return "Ollama unreachable";
          }
        }

        const vectorResponse = await (window as any).electronAPI?.db?.checkVectors?.();
        if (vectorResponse && vectorResponse.success) return null;
        const errStr = vectorResponse?.error || "Failed to check vector store";
        errorById.set("vectors", errStr);
        return errStr;
      } catch (err) {
        return `Vector store check failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const checkModels = async (): Promise<ProbeResult> => {
      try {
        const modelsResponse = await (window as any).electronAPI?.acp?.listModels?.();
        if (modelsResponse?.success) return null;
        return `Model loading failed: ${modelsResponse?.error || "Model loading failed"}`;
      } catch (err) {
        return `Model loading failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const collectErrors = (): string[] =>
      STAGE_ORDER.map((id) => errorById.get(id)).filter(
        (msg): msg is string => typeof msg === "string"
      );

    const runHealthChecks = async () => {
      let lastAdvanceAt = Date.now() - STAGE_PACE_MS;

      // Pacing gate: stages may finish out of order (probes run in
      // parallel via Promise.allSettled), but status paints are serialized
      // at >= STAGE_PACE_MS apart so the UI advances in a steady cadence.
      const paint = async (
        id: string,
        status: HealthCheckItem["status"],
        message?: string
      ) => {
        const now = Date.now();
        const earliest = lastAdvanceAt + STAGE_PACE_MS;
        const wait = Math.max(0, earliest - now);
        lastAdvanceAt = Math.max(now, earliest);
        if (wait > 0) await sleep(wait);
        setChecks((prev) =>
          prev.map((check) =>
            check.id === id ? { ...check, status, message } : check
          )
        );
      };

      const runStage = async (
        id: string,
        nextId: string | null,
        probe: () => Promise<ProbeResult>
      ) => {
        const displayMsg = await probe();
        if (displayMsg && !errorById.has(id)) errorById.set(id, displayMsg);
        await paint(
          id,
          displayMsg ? "error" : "success",
          displayMsg ?? undefined
        );
        if (nextId) {
          setChecks((prev) =>
            prev.map((check) =>
              check.id === nextId && check.status === "pending"
                ? { ...check, status: "checking" }
                : check
            )
          );
        }
      };

      try {
        setChecks((prev) =>
          prev.map((check) =>
            check.id === "api" ? { ...check, status: "checking" } : check
          )
        );

        // Probes run concurrently, but `paint` pacing keeps the visible
        // stage transitions sequential; "checking" flips early so the
        // spinner shows while earlier stages are still painting.
        await Promise.allSettled([
          runStage("api", "database", checkApi),
          runStage("database", "vectors", checkDatabase),
          runStage("vectors", "models", checkVectors),
          runStage("models", null, checkModels),
        ]);

        const newErrors = collectErrors();

        setLogoDim(true);
        setIsComplete(true);
        setErrors(newErrors);

        await sleep(COMPLETION_PAUSE_MS);
        onCompleteRef.current(newErrors.length === 0, newErrors);
      } catch (err) {
        console.error("Health check error:", err);
        setLogoDim(true);
        setIsComplete(true);
        await sleep(COMPLETION_PAUSE_MS);
        onCompleteRef.current(false, collectErrors());
      }
    };

    runHealthChecks();
  }, [autoStart]);

  const successCount = checks.filter((c) => c.status === "success").length;
  const totalChecks = checks.length;
  const progress = (successCount / totalChecks) * 100;
  const currentError = errors.length > 0 ? errors[errors.length - 1] : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 'var(--z-chrome)',
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg-base, #0a0a0a)",
        fontFamily: '"Figtree", -apple-system, BlinkMacSystemFont, sans-serif',
        overflow: "hidden",
      }}
    >
      {/* Logo + Brand */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          marginTop: -60,
        }}
      >
        <motion.img
          src="/images/logos/black-logo-withoutbg.png"
          alt="EverFern"
          animate={{
            opacity: logoDim ? 0.5 : 1,
            scale: logoDim ? 0.95 : 1,
          }}
          transition={{ duration: 0.5 }}
          style={{
            width: 100,
            height: 100,
            objectFit: "contain",
            filter: isDark ? "invert(1) brightness(0.9)" : "none",
          }}
        />
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--color-text-primary, #ffffff)",
            margin: 0,
            letterSpacing: "-0.03em",
            opacity: logoDim ? 0.5 : 1,
            transition: "opacity 0.5s ease",
          }}
        >
          EverFern
        </h1>
      </motion.div>

      {/* Pro Tip */}
      <div style={{ height: 60, display: "flex", alignItems: "center", marginTop: 28 }}>
        <AnimatePresence mode="wait">
          <motion.p
            key={tipIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary, rgba(255,255,255,0.5))",
              margin: 0,
              textAlign: "center",
              maxWidth: 380,
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--color-text-tertiary, rgba(255,255,255,0.35))", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>
              Pro Tip
            </span>
            {PRO_TIPS[tipIndex]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Error display */}
      <div style={{ height: 40, display: "flex", alignItems: "center", marginTop: 4 }}>
        <AnimatePresence mode="wait">
          {currentError && (
            <motion.p
              key={currentError}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                fontSize: 12,
                color: "var(--color-error, #ef4444)",
                margin: 0,
                textAlign: "center",
                maxWidth: 400,
                opacity: 0.8,
              }}
            >
              {currentError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom progress bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: "rgba(255,255,255,0.05)",
        }}
      >
        <motion.div
          style={{
            height: "100%",
            background: "linear-gradient(90deg, #10b981, #059669)",
          }}
          initial={{ width: "0%" }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
};

export default HealthCheckScreen;
