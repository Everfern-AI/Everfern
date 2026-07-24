"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";

import { GlobeAltIcon, CpuChipIcon, CommandLineIcon, WrenchScrewdriverIcon, CubeTransparentIcon } from "@heroicons/react/24/outline";

interface LocalExecutionPermissionCardProps {
  command: string;
  shellType: string;
  reason: string;
  agentName: string;
  onDeny: () => void;
  onAlwaysAllow: () => void;
  onAllowOnce: () => void;
  /** Optional: shown only for HITL Security Check approvals */
  onAllowPrefix?: () => void;
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
  onAllowPrefix,
}) => {
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const respondedRef = useRef(false);
  const [responded, setResponded] = useState(false);

  const handleResponse = (handler: () => void) => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    setResponded(true);
    handler();
  };

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
          backgroundColor: "var(--color-bg-surface)",
          border: "1px solid var(--color-border)",
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
            borderBottom: "1px solid var(--color-border)",
            backgroundColor: "var(--color-bg-subtle)",
          }}
        >
          {/* Shield / Terminal icon badge */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: "var(--color-bg-base)",
                border: "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {shellType === "Navis Browser" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="4"></circle>
                  <line x1="21.17" y1="8" x2="12" y2="8"></line>
                  <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                  <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
                </svg>
              ) : shellType === "Computer Use" ? (
                <CpuChipIcon style={{ width: 18, height: 18, color: "var(--color-text-secondary)" }} />
              ) : shellType === "Tool Creation" ? (
                <WrenchScrewdriverIcon style={{ width: 18, height: 18, color: "var(--color-text-secondary)" }} />
              ) : shellType === "Skill Creation" ? (
                <CubeTransparentIcon style={{ width: 18, height: 18, color: "var(--color-text-secondary)" }} />
              ) : shellType === "Security Check" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ) : (
                <CommandLineIcon style={{ width: 18, height: 18, color: "var(--color-text-secondary)" }} />
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.3,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {shellType === "Navis Browser" ? (
                  "Authorize Navis to use a new tab from My Browser to complete your task"
                ) : shellType === "Computer Use" ? (
                  "Authorize Computer Use to control your desktop to complete your task"
                ) : shellType === "Tool Creation" ? (
                  "Allow EverFern to create a new dynamic tool?"
                ) : shellType === "Skill Creation" ? (
                  "Allow EverFern to save a new reusable skill?"
                ) : shellType === "Security Check" ? (
                  "⚠️ Security check — review action before proceeding"
                ) : (
                  `Allow ${agentName} to execute a command?`
                )}
              </div>
            {reason && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
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
              color: "var(--color-text-secondary)",
              backgroundColor: "var(--color-bg-base)",
              border: "1px solid var(--color-border)",
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
            backgroundColor: "var(--color-bg-base)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {shellType === "Navis Browser" || shellType === "Computer Use" || shellType === "Tool Creation" || shellType === "Skill Creation" || shellType === "Security Check" ? (
            <div
              style={{
                fontSize: 14,
                color: "var(--color-text-primary)",
                fontWeight: 500,
                lineHeight: 1.5,
                display: "block",
                padding: "4px 0",
                whiteSpace: "pre-wrap",
              }}
            >
              <span style={{ color: "var(--color-text-secondary)", marginRight: 6 }}>
                {shellType === "Tool Creation" || shellType === "Skill Creation" ? "Details:" : shellType === "Security Check" ? "Actions:" : "Action:"}
              </span>
              {command.replace(/^Navis Browser:\s*|^Computer Use:\s*|^Tool Creation:\s*|^Skill Creation:\s*/, "")}
            </div>
          ) : (
            <code
              style={{
                fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                fontSize: 13,
                color: "var(--color-text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: 1.6,
                display: "block",
              }}
            >
              {(() => {
                let cmd = command;
                const tryMatch = cmd.match(/try\s*\{\s*&\s*\{\s*\$global:LASTEXITCODE\s*=\s*\$null;\s*([\s\S]*?)\s*\}\s*;/i);
                if (tryMatch && tryMatch[1]) cmd = tryMatch[1];
                cmd = cmd
                  .replace(/\[Console\]::OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
                  .replace(/\$OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
                  .replace(/\$ProgressPreference\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
                  .replace(/\$global:EF_\w+\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
                  .replace(/Set-Location\s+-LiteralPath\s+.*?(?:\r?\n|;|$)/gi, '')
                  .replace(/;\s*if\s*\(\$LASTEXITCODE[\s\S]*$/i, '')
                  .trim();
                return cmd.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || command;
              })()}
            </code>
          )}
        </div>

        {/* ── Button Row ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            backgroundColor: "var(--color-bg-surface)",
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
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path
                opacity="0.8"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span style={{ fontStyle: "italic", color: "#a16207" }}>{responded ? "Response sent…" : "Waiting for your reply…"}</span>
          </div>

          {/* Deny */}
          <button
            ref={denyButtonRef}
            onClick={() => handleResponse(onDeny)}
            onKeyDown={handleKeyDown}
            aria-label="Deny local execution"
            disabled={responded}
            style={{
              padding: "7px 16px",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg-surface)",
              color: "var(--color-text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: responded ? "default" : "pointer",
              opacity: responded ? 0.55 : 1,
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-hover)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-strong, var(--color-border))";
            }}
            onMouseLeave={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-surface)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
            }}
          >
            {shellType === "Security Check" ? "Reject" : "Deny"}
          </button>

          {/* Allow Prefix — shown only for HITL Security Check */}
          {onAllowPrefix && (
            <button
              onClick={() => handleResponse(onAllowPrefix!)}
              onKeyDown={handleKeyDown}
              aria-label="Allow prefix for local execution"
              disabled={responded}
              style={{
                padding: "7px 16px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg-surface)",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: responded ? "default" : "pointer",
                opacity: responded ? 0.55 : 1,
                fontFamily: "var(--font-sans)",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => {
                if (responded) return;
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-hover)";
              }}
              onMouseLeave={e => {
                if (responded) return;
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-surface)";
              }}
            >
              Allow prefix
            </button>
          )}

          {/* Always Allow */}
          <button
            onClick={() => handleResponse(onAlwaysAllow)}
            onKeyDown={handleKeyDown}
            aria-label="Always allow local execution"
            disabled={responded}
            style={{
              padding: "7px 16px",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg-surface)",
              color: "var(--color-text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: responded ? "default" : "pointer",
              opacity: responded ? 0.55 : 1,
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-hover)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-strong, var(--color-border))";
            }}
            onMouseLeave={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg-surface)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
            }}
          >
            Always allow
          </button>

          {/* Allow Once — primary */}
          <button
            onClick={() => handleResponse(onAllowOnce)}
            onKeyDown={handleKeyDown}
            aria-label="Allow local execution once"
            disabled={responded}
            style={{
              padding: "7px 18px",
              borderRadius: 10,
              border: "1px solid var(--color-text-primary)",
              backgroundColor: "var(--color-text-primary)",
              color: "var(--color-bg-surface)",
              fontSize: 13,
              fontWeight: 600,
              cursor: responded ? "default" : "pointer",
              opacity: responded ? 0.55 : 1,
              fontFamily: "var(--font-sans)",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-text-primary)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-text-primary)";
            }}
            onMouseLeave={e => {
              if (responded) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-text-primary)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-text-primary)";
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
