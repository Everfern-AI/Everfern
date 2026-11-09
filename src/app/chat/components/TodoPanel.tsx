"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Circle, Loader2, X, Minus, ListTodo } from "lucide-react";

export interface TodoPanelStep {
  id: string;
  title?: string;
  description?: string;
  tool?: string;
  status?: "pending" | "in_progress" | "in-progress" | "completed" | "failed" | "skipped" | "blocked";
}

interface TodoPanelProps {
  steps: TodoPanelStep[];
  title?: string;
  live?: boolean;
}

const isDone = (s?: string) => s === "completed";
const isActive = (s?: string) => s === "in_progress" || s === "in-progress" || s === "running";
const isFailed = (s?: string) => s === "failed" || s === "blocked";
const isSkipped = (s?: string) => s === "skipped";

const StatusIcon: React.FC<{ status?: string }> = ({ status }) => {
  if (isDone(status)) {
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        style={{ width: 20, height: 20, borderRadius: 999, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.5)", display: "grid", placeItems: "center", flexShrink: 0 }}
      >
        <Check size={12} strokeWidth={3} color="#22c55e" />
      </motion.span>
    );
  }
  if (isFailed(status)) {
    return (
      <span style={{ width: 20, height: 20, borderRadius: 999, background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.45)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <X size={11} strokeWidth={2.8} color="#ef4444" />
      </span>
    );
  }
  if (isSkipped(status)) {
    return (
      <span style={{ width: 20, height: 20, borderRadius: 999, background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.35)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Minus size={11} strokeWidth={2.6} color="rgba(148,163,184,0.9)" />
      </span>
    );
  }
  if (isActive(status)) {
    return (
      <span style={{ width: 20, height: 20, borderRadius: 999, background: "rgba(59,130,246,0.16)", border: "1px solid rgba(59,130,246,0.55)", display: "grid", placeItems: "center", flexShrink: 0, boxShadow: "0 0 14px rgba(59,130,246,0.35)" }}>
        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }} style={{ display: "grid", placeItems: "center" }}>
          <Loader2 size={12} strokeWidth={2.6} color="#60a5fa" />
        </motion.span>
      </span>
    );
  }
  return (
    <span style={{ width: 20, height: 20, borderRadius: 999, border: "1px solid rgba(226,232,240,0.28)", display: "grid", placeItems: "center", flexShrink: 0 }}>
      <Circle size={7} strokeWidth={2} color="rgba(226,232,240,0.45)" />
    </span>
  );
};

const TodoRow: React.FC<{ step: TodoPanelStep; index: number }> = ({ step, index }) => {
  const active = isActive(step.status);
  const done = isDone(step.status);
  const failed = isFailed(step.status);
  const label = step.title || step.description || `Step ${index + 1}`;
  const detail = step.title && step.description ? step.description : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.25), duration: 0.25 }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 10px",
        borderRadius: 12,
        background: active ? "rgba(59,130,246,0.08)" : "transparent",
        border: active ? "1px solid rgba(59,130,246,0.22)" : "1px solid transparent",
      }}
    >
      <StatusIcon status={step.status} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13,
          lineHeight: 1.45,
          fontWeight: active ? 600 : 500,
          color: done ? "var(--color-text-tertiary)" : failed ? "#ef4444" : "var(--color-text-primary)",
          textDecoration: done ? "line-through" : "none",
          textDecorationColor: "rgba(34,197,94,0.55)",
          overflowWrap: "anywhere",
        }}>
          {label}
        </div>
        {detail && (
          <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: "var(--color-text-tertiary)", overflowWrap: "anywhere" }}>
            {detail}
          </div>
        )}
      </div>
      {step.tool && (
        <span style={{
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 999,
          color: "var(--color-text-secondary)",
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-border)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          marginTop: 2,
        }}>
          {step.tool}
        </span>
      )}
    </motion.div>
  );
};

const SkeletonRow: React.FC<{ delay: number }> = ({ delay }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px" }}>
    <span style={{ width: 20, height: 20, borderRadius: 999, border: "1px solid rgba(226,232,240,0.18)", flexShrink: 0 }} />
    <motion.span
      animate={{ opacity: [0.25, 0.6, 0.25] }}
      transition={{ repeat: Infinity, duration: 1.6, delay }}
      style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.12)", width: `${58 - delay * 18}%` }}
    />
  </div>
);

export const TodoPanel: React.FC<TodoPanelProps> = ({ steps, title = "Task plan", live = false }) => {
  const total = steps.length;
  const completed = steps.filter(s => isDone(s.status)).length;
  const failed = steps.filter(s => isFailed(s.status)).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (!live && total === 0) return null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="liquid-glass"
      style={{
        width: "100%",
        maxWidth: 860,
        margin: "0 auto 18px",
        borderRadius: 24,
        padding: "16px 18px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          width: 28, height: 28, borderRadius: 999, flexShrink: 0,
          display: "grid", placeItems: "center",
          background: "rgba(96,165,250,0.16)",
          border: "1px solid rgba(96,165,250,0.35)",
          boxShadow: "0 0 18px rgba(96,165,250,0.25)",
        }}>
          <ListTodo size={15} color="#93c5fd" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--color-text-primary)", letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {total > 0 ? `${completed}/${total} completed${failed ? ` · ${failed} failed` : ""}` : "Planning the steps…"}
          </div>
        </div>
        {live && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>
            <motion.span
              animate={{ opacity: [0.35, 1, 0.35], scale: [0.9, 1.1, 0.9] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
              style={{ width: 7, height: 7, borderRadius: 999, background: "#60a5fa", boxShadow: "0 0 10px #60a5fa" }}
            />
            Working
          </span>
        )}
      </div>

      <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 8 }}>
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 24 }}
          style={{
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, #34d399, #60a5fa 55%, #a78bfa)",
            boxShadow: "0 0 12px rgba(96,165,250,0.5)",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
        <AnimatePresence initial={false}>
          {total === 0 && live ? (
            <>
              <SkeletonRow key="s0" delay={0} />
              <SkeletonRow key="s1" delay={0.18} />
              <SkeletonRow key="s2" delay={0.36} />
            </>
          ) : (
            steps.map((step, i) => <TodoRow key={step.id || `step-${i}`} step={step} index={i} />)
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default TodoPanel;

