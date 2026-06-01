"use client";

import React, { useRef, useEffect } from "react";
import { motion } from "framer-motion";

interface LocalExecutionPermissionCardProps {
  command: string;
  shellType: "Bash" | "PowerShell";
  reason: string;
  agentName: string;
  onDeny: () => void;
  onAlwaysAllow: () => void;
  onAllowOnce: () => void;
}

/**
 * LocalExecutionPermissionCard
 *
 * Permission prompt shown when the agent wants to run a local command.
 * Matches EverFern's design language: clean white card, subtle borders,
 * clear button hierarchy, and an amber status notice.
 */
export const LocalExecutionPermissionCard: React.FC<LocalExecutionPermissionCardProps> = ({
  command,
  shellType,
  reason,
  agentName,
  onDeny,
  onAlwaysAllow,
  onAllowOnce,
}) => {
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the deny button for safety-first accessibility
  useEffect(() => {
    denyButtonRef.current?.focus();
  }, []);

  // Handle keyboard activation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLButtonElement).click();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{ width: "100%" }}
    >
      {/* ── Main Card ── */}
      <div
        style={{
          width: "100%",
          backgroundColor: "#ffffff",
          border: "1px solid #e8e6d9",
          borderRadius: 16,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px 12px",
            borderBottom: "1px solid #f0ede8",
            backgroundColor: "#faf9f7",
          }}
        >
          {/* Terminal icon badge */}
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: "#f1f3f5",
              border: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#55555c"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "#201e24",
                lineHeight: 1.3,
                fontFamily: "var(--font-sans)",
              }}
            >
              Allow {agentName} to execute a command?
            </div>
            {reason && (
              <div
                style={{
                  fontSize: 12,
                  color: "#73716e",
                  marginTop: 2,
                  lineHeight: 1.4,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {reason}
              </div>
            )}
          </div>

          {/* Shell badge */}
          <div
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 600,
              color: "#55555c",
              backgroundColor: "#f1f3f5",
              border: "1px solid #e2e8f0",
              padding: "3px 10px",
              borderRadius: 20,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              fontFamily: "var(--font-sans)",
            }}
          >
            {shellType}
          </div>
        </div>

        {/* ── Command Block ── */}
        <div
          style={{
            padding: "12px 20px",
            backgroundColor: "#f8f8fa",
            borderBottom: "1px solid #f0ede8",
          }}
        >
          <code
            style={{
              fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontSize: 13,
              color: "#2a2a2b",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              lineHeight: 1.6,
              display: "block",
            }}
          >
            {command}
          </code>
        </div>

        {/* ── Button Row ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            backgroundColor: "#ffffff",
          }}
        >
          {/* Amber "waiting" indicator — left side */}
          <div
            style={{
              marginRight: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#d97706",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
            }}
          >
            <svg
              style={{ width: 14, height: 14, animation: "spin 1.2s linear infinite", flexShrink: 0 }}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path
                opacity="0.8"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span style={{ fontStyle: "italic", color: "#a16207" }}>Waiting for your reply…</span>
          </div>

          {/* Deny */}
          <button
            ref={denyButtonRef}
            onClick={onDeny}
            onKeyDown={handleKeyDown}
            aria-label="Deny local execution"
            style={{
              padding: "7px 16px",
              borderRadius: 10,
              border: "1px solid #e8e6d9",
              backgroundColor: "#ffffff",
              color: "#4a4846",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f5f4f0";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#d0cec8";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#ffffff";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e6d9";
            }}
          >
            Deny
          </button>

          {/* Always Allow */}
          <button
            onClick={onAlwaysAllow}
            onKeyDown={handleKeyDown}
            aria-label="Always allow local execution"
            style={{
              padding: "7px 16px",
              borderRadius: 10,
              border: "1px solid #e8e6d9",
              backgroundColor: "#ffffff",
              color: "#4a4846",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f5f4f0";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#d0cec8";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#ffffff";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e6d9";
            }}
          >
            Always allow
          </button>

          {/* Allow Once — primary CTA */}
          <button
            onClick={onAllowOnce}
            onKeyDown={handleKeyDown}
            aria-label="Allow local execution once"
            style={{
              padding: "7px 18px",
              borderRadius: 10,
              border: "1px solid #201e24",
              backgroundColor: "#201e24",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#111111";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#111111";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#201e24";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#201e24";
            }}
          >
            Allow once
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </motion.div>
  );
};

export default LocalExecutionPermissionCard;
