"use client";

import React, { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface CostLine {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  share: number;
}

export interface CostMeterProps extends Omit<ComponentProps<"div">, "children"> {
  runCost: string;
  sessionCost: string;
  lines: readonly CostLine[];
  className?: string;
}

function pct(value: number): string {
  const bounded = Math.max(0, Math.min(1, value));
  return `${Math.round(bounded * 100)}%`;
}

function formatTokens(t: number): string {
  if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`;
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
  return String(t);
}

export function CostMeter({
  runCost,
  sessionCost,
  lines,
  className,
  ...props
}: CostMeterProps) {
  // Sort lines largest share first
  const sortedLines = [...lines].sort((a, b) => (b.share || 0) - (a.share || 0));

  const colors = [
    "#3b82f6", // blue
    "#10b981", // emerald
    "#8b5cf6", // purple
    "#f59e0b", // amber
    "#f43f5e", // rose
    "#06b6d4", // cyan
  ];

  return (
    <div
      data-slot="cost-meter"
      className={cn(
        "flex w-full flex-col rounded-2xl border shadow-sm glossy",
        className
      )}
      style={{
        backgroundColor: "var(--color-bg-surface, var(--color-bg-base))",
        borderColor: "var(--color-border)",
        borderTop: "1px solid var(--glossy-highlight)",
        boxShadow: "var(--glossy-inner), var(--glossy-outer)",
        padding: "20px 24px",
        gap: 16,
      }}
      {...props}
    >
      {/* Header with Run Cost & Session Cost spaced to opposite ends */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", width: "100%", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {runCost}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, fontFamily: "var(--font-sans, sans-serif)", color: "var(--color-text-secondary)" }}>
            this run
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {sessionCost} <span style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>session</span>
          </span>
        </div>
      </div>

      {/* Stacked Progress Bar */}
      <div
        style={{
          height: 8,
          width: "100%",
          borderRadius: 999,
          overflow: "hidden",
          display: "flex",
          backgroundColor: "var(--color-bg-subtle, rgba(0,0,0,0.06))",
        }}
      >
        {sortedLines.map((line, i) => (
          <span
            key={`${line.model}-${i}`}
            style={{
              height: "100%",
              width: pct(line.share),
              backgroundColor: colors[i % colors.length],
              transition: "width 0.5s ease",
            }}
            title={`${line.model}: ${line.cost} (${pct(line.share)})`}
          />
        ))}
      </div>

      {/* Model Breakdown List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
        {sortedLines.map((line, i) => (
          <div
            key={`${line.model}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              gap: 16,
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: colors[i % colors.length],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {line.model}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-text-secondary)",
                  flexShrink: 0,
                }}
              >
                ({formatTokens(line.inputTokens)} in / {formatTokens(line.outputTokens)} out)
              </span>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
                marginLeft: "auto",
              }}
            >
              {line.cost}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CostMeter;
