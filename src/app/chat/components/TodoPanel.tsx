"use client";

import React from "react";
import { Check, X, Minus } from "lucide-react";

// A plain checklist under the reply, like the task list in the Claude desktop app:
// no card, no progress bar, and nothing at all until the model has real steps.

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

const BOX = 14;

const StatusMark: React.FC<{ status?: string; live: boolean }> = ({ status, live }) => {
  const base: React.CSSProperties = {
    width: BOX, height: BOX, borderRadius: 999, flexShrink: 0, display: "grid", placeItems: "center", marginTop: 3,
  };
  if (isDone(status)) {
    return (
      <span style={{ ...base, background: "var(--color-text-primary)" }}>
        <Check size={9} strokeWidth={3.5} color="var(--color-text-inverse, #111)" />
      </span>
    );
  }
  if (isFailed(status)) {
    return (
      <span style={{ ...base, background: "var(--color-error, #ef4444)" }}>
        <X size={9} strokeWidth={3.5} color="#fff" />
      </span>
    );
  }
  if (isSkipped(status)) {
    return (
      <span style={{ ...base, border: "1.5px solid var(--color-text-tertiary)" }}>
        <Minus size={8} strokeWidth={3} color="var(--color-text-tertiary)" />
      </span>
    );
  }
  if (isActive(status)) {
    return (
      <span style={{ ...base, border: "1.5px solid var(--color-text-primary)" }}>
        <span className={live ? "ef-tl-pulse" : undefined}
          style={{ width: 6, height: 6, borderRadius: 999, background: "var(--color-text-primary)" }} />
      </span>
    );
  }
  return <span style={{ ...base, border: "1.5px solid var(--color-text-tertiary)", opacity: 0.7 }} />;
};

export const TodoPanel: React.FC<TodoPanelProps> = ({ steps, title, live = false }) => {
  const total = steps.length;
  if (total === 0) return null;

  const completed = steps.filter((s) => isDone(s.status)).length;
  const failed = steps.filter((s) => isFailed(s.status)).length;
  const heading = title && title !== "Task plan" ? title : "Tasks";

  return (
    <section aria-label={heading} style={{ width: "100%", maxWidth: 860, margin: "0 auto 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, fontSize: 12.5 }}>
        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {heading}
        </span>
        <span style={{ color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {completed} of {total} done{failed ? `, ${failed} failed` : ""}
        </span>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((step, i) => {
          const active = isActive(step.status);
          const done = isDone(step.status);
          const failedStep = isFailed(step.status);
          const label = step.title || step.description || `Step ${i + 1}`;
          return (
            <li key={step.id || `step-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <StatusMark status={step.status} live={live} />
              <span style={{
                fontSize: 13.5, lineHeight: 1.5, overflowWrap: "anywhere",
                fontWeight: active ? 600 : 400,
                color: failedStep ? "var(--color-error, #ef4444)"
                  : done || isSkipped(step.status) ? "var(--color-text-tertiary)"
                  : "var(--color-text-primary)",
              }}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default TodoPanel;
