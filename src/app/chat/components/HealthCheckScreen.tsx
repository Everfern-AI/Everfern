"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/components/ThemeProvider";

export interface HealthCheckItem {
  id: string;
  label: string;
  status: "pending" | "checking" | "success" | "error";
  message?: string;
  details?: string;
}

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

    const runHealthChecks = async () => {
      const newErrors: string[] = [];

      try {
        // 1. Check API connectivity
        await updateCheck("api", "checking");
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          try {
            const apiResponse = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/health`,
              { method: "GET", signal: controller.signal }
            );
            clearTimeout(timeoutId);

            if (apiResponse.ok) {
              await updateCheck("api", "success");
            } else {
              throw new Error(`API returned ${apiResponse.status}`);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (err) {
          const errorMsg = `API connection failed: ${err instanceof Error ? err.message : String(err)}`;
          newErrors.push(errorMsg);
          await updateCheck("api", "error", errorMsg);
        }

        // 2. Check database
        await updateCheck("database", "checking");
        try {
          const dbResponse = await (window as any).electronAPI?.db?.checkConnection?.();
          if (dbResponse && dbResponse.success) {
            await updateCheck("database", "success");
          } else {
            const errorMsg = dbResponse?.error || "Database connection failed";
            newErrors.push(errorMsg);
            await updateCheck("database", "error", errorMsg);
          }
        } catch (err) {
          const errorMsg = `Database check failed: ${err instanceof Error ? err.message : String(err)}`;
          newErrors.push(errorMsg);
          await updateCheck("database", "error", errorMsg);
        }

        // 3. Check vector store + embedding model
        await updateCheck("vectors", "checking");
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
                  if (vectorResponse && vectorResponse.success) {
                    await updateCheck("vectors", "success");
                  } else {
                    const errStr = vectorResponse?.error || "Failed to check vector store";
                    newErrors.push(errStr);
                    await updateCheck("vectors", "error", errStr);
                  }
                } else {
                  newErrors.push(`Embedding model "${embModel}" not installed. Run: ollama pull ${embModel}`);
                  await updateCheck("vectors", "error", `Model not found: ${embModel}`);
                }
              } else {
                newErrors.push("Ollama is not running.");
                await updateCheck("vectors", "error", "Ollama not running");
              }
            } catch {
              newErrors.push("Ollama unreachable.");
              await updateCheck("vectors", "error", "Ollama unreachable");
            }
          } else {
            const vectorResponse = await (window as any).electronAPI?.db?.checkVectors?.();
            if (vectorResponse && vectorResponse.success) {
              await updateCheck("vectors", "success");
            } else {
              const errStr = vectorResponse?.error || "Failed to check vector store";
              newErrors.push(errStr);
              await updateCheck("vectors", "error", errStr);
            }
          }
        } catch (err) {
          const errorMsg = `Vector store check failed: ${err instanceof Error ? err.message : String(err)}`;
          newErrors.push(errorMsg);
          await updateCheck("vectors", "error", errorMsg);
        }

        // 4. Load models
        await updateCheck("models", "checking");
        try {
          const modelsResponse = await (window as any).electronAPI?.acp?.listModels?.();
          if (modelsResponse?.success) {
            await updateCheck("models", "success");
          } else {
            throw new Error(modelsResponse?.error || "Model loading failed");
          }
        } catch (err) {
          const errorMsg = `Model loading failed: ${err instanceof Error ? err.message : String(err)}`;
          newErrors.push(errorMsg);
          await updateCheck("models", "error", errorMsg);
        }

        setLogoDim(true);
        setIsComplete(true);
        setErrors(newErrors);

        // Brief pause after completion before dismissing
        await new Promise((r) => setTimeout(r, 800));
        onCompleteRef.current(newErrors.length === 0, newErrors);
      } catch (err) {
        console.error("Health check error:", err);
        setLogoDim(true);
        setIsComplete(true);
        await new Promise((r) => setTimeout(r, 800));
        onCompleteRef.current(false, newErrors);
      }
    };

    runHealthChecks();
  }, [autoStart]);

  const updateCheck = (
    id: string,
    status: HealthCheckItem["status"],
    message?: string
  ) => {
    return new Promise<void>((resolve) => {
      setChecks((prev) =>
        prev.map((check) =>
          check.id === id ? { ...check, status, message } : check
        )
      );
      setTimeout(resolve, 250);
    });
  };

  const successCount = checks.filter((c) => c.status === "success").length;
  const totalChecks = checks.length;
  const progress = (successCount / totalChecks) * 100;
  const currentError = errors.length > 0 ? errors[errors.length - 1] : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
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
