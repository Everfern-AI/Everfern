"use client";

import React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Clock3, CircleDollarSign, Sparkles, Lock } from "lucide-react";

export interface RunSummaryCardProps {
  status?: "finished" | "stopped" | "error";
  durationMs?: number;
  costLabel?: string;
  summary?: string;
  tierLabel?: string;
  onUpgrade?: () => void;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins >= 1) return `${mins} min${mins === 1 ? "" : "s"}`;
  const secs = Math.max(1, Math.round(ms / 1000));
  return `${secs}s`;
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ color: "rgba(255,255,255,0.96)", fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function renderSummary(text: string): React.ReactNode {
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (blocks.length === 0) {
    return <p style={{ margin: 0, color: "rgba(226,232,240,0.55)" }}>The agent completed this run without a written summary.</p>;
  }
  return blocks.map((block, i) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    const isList = lines.length > 0 && lines.every(l => /^([-*•]|\d+\.)\s+/.test(l));
    if (isList) {
      return (
        <ul key={i} style={{ margin: i === 0 ? 0 : "10px 0 0", paddingLeft: 20, listStyle: "disc" }}>
          {lines.map((line, j) => (
            <li key={j} style={{ margin: "4px 0", lineHeight: 1.6 }}>
              {renderInline(line.replace(/^([-*•]|\d+\.)\s+/, ""))}
            </li>
          ))}
        </ul>
      );
    }
    if (/^#{1,6}\s/.test(block)) {
      return (
        <p key={i} style={{ margin: i === 0 ? 0 : "12px 0 0", fontWeight: 700, color: "rgba(255,255,255,0.95)" }}>
          {renderInline(block.replace(/^#{1,6}\s+/, ""))}
        </p>
      );
    }
    return (
      <p key={i} style={{ margin: i === 0 ? 0 : "10px 0 0", lineHeight: 1.65 }}>
        {renderInline(block.replace(/\n/g, " "))}
      </p>
    );
  });
}

const STATUS_META = {
  finished: { label: "Finished", color: "#22c55e", soft: "rgba(34,197,94,0.14)" },
  stopped: { label: "Stopped", color: "#f59e0b", soft: "rgba(245,158,11,0.14)" },
  error: { label: "Error", color: "#ef4444", soft: "rgba(239,68,68,0.14)" },
} as const;

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}> = ({ icon, label, value, sub, valueColor }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.045)",
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: 14,
      padding: "14px 16px",
      minWidth: 0,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, color: "rgba(226,232,240,0.55)", fontSize: 12 }}>
      <span style={{ display: "inline-flex", opacity: 0.8 }}>{icon}</span>
      <span style={{ letterSpacing: "0.02em" }}>{label}</span>
    </div>
    <div style={{ fontSize: 17, fontWeight: 600, color: valueColor || "rgba(255,255,255,0.95)", lineHeight: 1.25, overflowWrap: "anywhere" }}>
      {value}
    </div>
    {sub && (
      <div style={{ marginTop: 4, fontSize: 12, color: "rgba(226,232,240,0.45)" }}>{sub}</div>
    )}
  </div>
);

export const RunSummaryCard: React.FC<RunSummaryCardProps> = ({
  status = "finished",
  durationMs,
  costLabel = "Not reported",
  summary = "",
  tierLabel = "Lite intelligence",
  onUpgrade,
}) => {
  const meta = STATUS_META[status] || STATUS_META.finished;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 760,
        margin: "18px 0 8px",
        borderRadius: 26,
        padding: 1,
        background:
          "linear-gradient(135deg, rgba(45,212,191,0.55), rgba(96,165,250,0.35) 40%, rgba(168,85,247,0.5) 100%)",
        boxShadow: "0 24px 60px -30px rgba(15,23,42,0.9)",
      }}
    >
      <div
        style={{
          borderRadius: 25,
          padding: "26px 26px 20px",
          background:
            "radial-gradient(120% 150% at 8% 0%, rgba(45,212,191,0.18), transparent 58%), radial-gradient(100% 130% at 95% 0%, rgba(139,92,246,0.2), transparent 55%), linear-gradient(135deg, rgba(15,23,42,0.97), rgba(23,32,47,0.95) 45%, rgba(38,28,64,0.9))",
          color: "rgba(226,232,240,0.9)",
          overflow: "hidden",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "rgba(226,232,240,0.58)", letterSpacing: "0.01em" }}>
            The agent finished this run. Review its report below.
          </div>
          <div style={{ marginTop: 8, fontSize: 32, fontWeight: 650, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.97)" }}>
            Run finished
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            marginTop: 22,
          }}
          className="run-summary-stats"
        >
          <StatTile
            icon={<CheckCircle2 size={14} />}
            label="Status"
            value={meta.label}
            valueColor={meta.color}
            sub={status === "finished" ? "Run completed" : undefined}
          />
          <StatTile
            icon={<Clock3 size={14} />}
            label="Time Worked"
            value={formatDuration(durationMs)}
            sub="Duration"
          />
          <StatTile
            icon={<CircleDollarSign size={14} />}
            label="Cost"
            value={costLabel}
            sub="Total cost"
          />
        </div>

        <div
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.035)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "17px 19px 19px",
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(226,232,240,0.5)",
              marginBottom: 12,
            }}
          >
            Summary
          </div>
          <div style={{ fontSize: 13.5, color: "rgba(226,232,240,0.82)" }}>
            {renderSummary(summary)}
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 12,
              color: "rgba(226,232,240,0.72)",
              background: "rgba(255,255,255,0.055)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <Sparkles size={13} />
            {tierLabel}
          </span>
          <button
            type="button"
            onClick={onUpgrade}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              border: "none",
              cursor: "pointer",
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: "0 8px 24px -10px rgba(59,130,246,0.8)",
            }}
          >
            <Lock size={12} />
            Unlock Pro
          </button>
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .run-summary-stats { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </motion.div>
  );
};

export default RunSummaryCard;
