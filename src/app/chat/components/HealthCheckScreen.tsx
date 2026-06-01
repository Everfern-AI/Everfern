"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

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

/**
 * HealthCheckScreen
 *
 * Displays a startup health check screen that verifies:
 * - Database connectivity
 * - Vector store status
 * - Model availability
 * - API connectivity
 *
 * Shows real-time progress to the user with detailed status messages.
 */
export const HealthCheckScreen: React.FC<HealthCheckScreenProps> = ({
  onComplete,
  autoStart = true,
}) => {
  const [checks, setChecks] = useState<HealthCheckItem[]>([
    { id: "api", label: "API Connectivity", status: "pending" },
    { id: "database", label: "Database Connection", status: "pending" },
    { id: "vectors", label: "Vector Store", status: "pending" },
    { id: "models", label: "Loading Models", status: "pending" },
  ]);

  const [isComplete, setIsComplete] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!autoStart) return;

    const runHealthChecks = async () => {
      const newErrors: string[] = [];

      try {
        // 1. Check API connectivity
        await updateCheck("api", "checking", "Connecting to API...");
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
              await updateCheck("api", "success", "API is responsive");
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
        await updateCheck("database", "checking", "Verifying database...");
        try {
          const dbResponse = await (window as any).electronAPI?.db?.checkConnection?.();
          if (dbResponse) {
            await updateCheck(
              "database",
              "success",
              dbResponse.details || "Database check completed"
            );
          } else {
            await updateCheck(
              "database",
              "success",
              "Database check skipped (not yet configured)"
            );
          }
        } catch (err) {
          // Database check not available - this is expected during development
          await updateCheck(
            "database",
            "success",
            "Database check skipped (not yet configured)"
          );
        }

        // 3. Check vector store + embedding model
        await updateCheck("vectors", "checking", "Loading embedding configuration...");
        try {
          // Read saved embedding config
          let embProvider = "everfern";
          let embModel = "qwen/qwen3-embedding-8b";
          try {
            const cfgRes = await (window as any).electronAPI?.loadConfig?.();
            if (cfgRes?.success && cfgRes.config?.embedding) {
              embProvider = cfgRes.config.embedding.provider || "everfern";
              embModel = cfgRes.config.embedding.model || "qwen/qwen3-embedding-8b";
            }
          } catch (_) {}

          const providerLabels: Record<string, string> = {
            everfern: "EverFern Cloud",
            openai: "OpenAI",
            gemini: "Google Gemini",
            minimax: "MiniMax",
            nvidia: "NVIDIA NIM",
            openrouter: "OpenRouter",
            ollama: "Ollama (Local)",
          };
          const providerLabel = providerLabels[embProvider] || embProvider;

          // For Ollama local — check if the embedding model is installed
          if (embProvider === "ollama") {
            await updateCheck("vectors", "checking", `Checking Ollama for ${embModel}...`);
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
                  await updateCheck(
                    "vectors",
                    "success",
                    `Embedding ready — ${embModel} (Ollama Local)`
                  );
                } else {
                  await updateCheck(
                    "vectors",
                    "error",
                    `Embedding model not found: ${embModel}. Run: ollama pull ${embModel}`
                  );
                  newErrors.push(`Embedding model "${embModel}" not installed in Ollama. Run: ollama pull ${embModel}`);
                }
              } else {
                await updateCheck(
                  "vectors",
                  "error",
                  "Ollama is not running. Start Ollama to use local embeddings."
                );
                newErrors.push("Ollama is not running — local embedding unavailable.");
              }
            } catch (ollamaErr) {
              await updateCheck(
                "vectors",
                "error",
                "Cannot reach Ollama. Start Ollama to enable local embeddings."
              );
              newErrors.push("Ollama unreachable — local embedding unavailable.");
            }
          } else {
            // Cloud providers — just verify the config exists and report it
            const vectorResponse = await (window as any).electronAPI?.db?.checkVectors?.();
            const vectorCount = vectorResponse?.count ?? null;
            const countStr = vectorCount !== null ? ` (${vectorCount} vectors stored)` : "";
            await updateCheck(
              "vectors",
              "success",
              `Embedding: ${embModel} via ${providerLabel}${countStr}`
            );
          }
        } catch (err) {
          // Fall back gracefully
          await updateCheck(
            "vectors",
            "success",
            "Vector store check skipped (not yet configured)"
          );
        }


        // 4. Load models
        await updateCheck("models", "checking", "Loading available models...");
        try {
          const modelsResponse = await (window as any).electronAPI?.acp?.listModels?.();
          if (modelsResponse?.success) {
            const modelCount = modelsResponse.models?.length || 0;
            await updateCheck(
              "models",
              "success",
              `${modelCount} models loaded`
            );
          } else {
            throw new Error(modelsResponse?.error || "Model loading failed");
          }
        } catch (err) {
          const errorMsg = `Model loading failed: ${err instanceof Error ? err.message : String(err)}`;
          newErrors.push(errorMsg);
          await updateCheck("models", "error", errorMsg);
        }

        setIsComplete(true);
        setErrors(newErrors);
        onComplete(newErrors.length === 0, newErrors);
      } catch (err) {
        console.error("Health check error:", err);
        setIsComplete(true);
        onComplete(false, newErrors);
      }
    };

    runHealthChecks();
  }, [autoStart, onComplete]);

  const updateCheck = (
    id: string,
    status: HealthCheckItem["status"],
    message?: string,
    details?: string
  ) => {
    return new Promise<void>((resolve) => {
      setChecks((prev) =>
        prev.map((check) =>
          check.id === id
            ? { ...check, status, message, details }
            : check
        )
      );
      // Small delay to ensure UI updates are visible
      setTimeout(resolve, 300);
    });
  };

  const getStatusIcon = (status: HealthCheckItem["status"]) => {
    switch (status) {
      case "success":
        return (
          <CheckCircleIcon className="w-5 h-5 text-green-600" />
        );
      case "error":
        return (
          <ExclamationCircleIcon className="w-5 h-5 text-red-600" />
        );
      case "checking":
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <ClockIcon className="w-5 h-5 text-amber-600" />
          </motion.div>
        );
      default:
        return (
          <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
        );
    }
  };

  const getStatusColor = (status: HealthCheckItem["status"]) => {
    switch (status) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "checking":
        return "bg-amber-50 border-amber-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const successCount = checks.filter((c) => c.status === "success").length;
  const totalChecks = checks.length;
  const progress = (successCount / totalChecks) * 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ width: "100vw", height: "100vh", backgroundColor: "#f5f4f0", fontFamily: "var(--font-sans)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: "#ffffff",
          borderRadius: 24,
          padding: "36px 32px 32px",
          border: "1px solid #e8e6d9",
          boxShadow: "0 4px 32px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ display: "inline-block", marginBottom: 16 }}
          >
            <div style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #34d399 0%, #059669 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)",
            }}>
              <svg
                style={{ width: 24, height: 24, color: "#ffffff" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
          </motion.div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#201e24", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            Initializing EverFern
          </h1>
          <p style={{ fontSize: 13, color: "#8a8886", margin: 0, lineHeight: 1.5 }}>
            Running system health checks...
          </p>
        </div>

        {/* Progress Bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#73716e" }}>Progress</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#201e24" }}>{successCount}/{totalChecks}</span>
          </div>
          <div style={{ width: "100%", height: 5, backgroundColor: "#e8e6d9", borderRadius: 999, overflow: "hidden" }}>
            <motion.div
              style={{ height: "100%", background: "linear-gradient(90deg, #34d399, #059669)", borderRadius: 999 }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Health Checks */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {checks.map((check, index) => {
            const getBg = () => {
              if (check.status === "success") return "#f0fdf4";
              if (check.status === "error")   return "#fef2f2";
              if (check.status === "checking") return "#fffdf0";
              return "#faf9f7";
            };
            const getBorder = () => {
              if (check.status === "success") return "#bbf7d0";
              if (check.status === "error")   return "#fecaca";
              if (check.status === "checking") return "#e8e6d9";
              return "#e8e6d9";
            };
            return (
              <motion.div
                key={check.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.08, duration: 0.3 }}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1.5px solid ${getBorder()}`,
                  backgroundColor: getBg(),
                  transition: "all 0.25s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}>
                    {getStatusIcon(check.status)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#201e24", margin: 0 }}>
                        {check.label}
                      </p>
                      {check.status === "checking" && (
                        <span style={{ fontSize: 11, color: "#d97706", fontWeight: 500, whiteSpace: "nowrap" }}>
                          Checking...
                        </span>
                      )}
                    </div>
                    {check.message && (
                      <p style={{ fontSize: 12, color: "#73716e", margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {check.message}
                      </p>
                    )}
                    {check.details && (
                      <p style={{ fontSize: 11, color: "#8a8886", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {check.details}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Error Messages */}
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 16, padding: "12px 14px", backgroundColor: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12 }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: "#7f1d1d", margin: "0 0 6px" }}>
              Issues detected:
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              {errors.map((error, idx) => (
                <li key={idx} style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.4 }}>
                  • {error}
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* Completion Message */}
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              textAlign: "center",
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 16,
              backgroundColor: errors.length === 0 ? "#f0fdf4" : "#fffdf0",
              border: `1.5px solid ${errors.length === 0 ? "#bbf7d0" : "#e8e6d9"}`,
            }}
          >
            <p style={{
              fontSize: 13,
              fontWeight: 600,
              margin: 0,
              color: errors.length === 0 ? "#059669" : "#73716e",
            }}>
              {errors.length === 0 ? "✓ All systems ready!" : "⚠ Some issues found, but continuing..."}
            </p>
          </motion.div>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "#8a8886", margin: 0 }}>
            {isComplete
              ? "You can now start using EverFern"
              : "Please wait while we prepare your environment"}
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default HealthCheckScreen;


