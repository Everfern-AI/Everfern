"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MarkdownRenderer } from "./MarkdownComponents";

// ── Tab types ─────────────────────────────────────────────────────────────────

type TabId = "design" | "bugfix" | "tasks";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  content: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse the previewMarkdown string produced by the coding specialist.
 * The agent writes multiple files; we split them by their H1 headings.
 *
 * Expected sections (any subset):
 *   # Design — ...
 *   # Bugfix — ...
 *   # Tasks — ...
 */
function parsePlanSections(markdown: string): { design?: string; bugfix?: string; tasks?: string } {
  const result: { design?: string; bugfix?: string; tasks?: string } = {};

  // Split on top-level headings that start a new doc
  const sections = markdown.split(/(?=^# )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.split("\n")[0].toLowerCase();

    if (firstLine.includes("design")) {
      result.design = trimmed;
    } else if (firstLine.includes("bugfix") || firstLine.includes("bug fix") || firstLine.includes("bug —")) {
      result.bugfix = trimmed;
    } else if (firstLine.includes("task")) {
      result.tasks = trimmed;
    } else {
      // Fallback: treat as design if no design yet
      if (!result.design) result.design = trimmed;
    }
  }

  return result;
}

// ── Task list renderer ────────────────────────────────────────────────────────

const TaskListRenderer = ({ markdown }: { markdown: string }) => {
  const lines = markdown.split("\n");
  const tasks: Array<{ text: string; depth: number; done: boolean }> = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)- \[([ x])\] (.+)/);
    if (match) {
      const depth = Math.floor(match[1].length / 2);
      tasks.push({ text: match[3], depth, done: match[2] === "x" });
    }
  }

  if (tasks.length === 0) {
    return <MarkdownRenderer content={markdown} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {tasks.map((task, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5"
          style={{ paddingLeft: task.depth * 20 }}
        >
          <div
            className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center"
            style={{
              borderColor: task.done ? "#10b981" : "#d1d5db",
              backgroundColor: task.done ? "#d1fae5" : "#ffffff",
            }}
          >
            {task.done && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <span
            className="text-[13.5px] leading-relaxed"
            style={{
              color: task.done ? "#9ca3af" : "#1f2937",
              textDecoration: task.done ? "line-through" : "none",
              fontFamily: "'Matter', system-ui, sans-serif",
            }}
          >
            {task.text}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

interface CodingPlanCardProps {
  previewMarkdown: string;
}

export const CodingPlanCard = ({ previewMarkdown }: CodingPlanCardProps) => {
  const sections = parsePlanSections(previewMarkdown);

  const tabs: Tab[] = [];

  if (sections.bugfix) {
    tabs.push({
      id: "bugfix",
      label: "Bug Analysis",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      content: sections.bugfix,
    });
  }

  if (sections.design) {
    tabs.push({
      id: "design",
      label: "Design",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      ),
      content: sections.design,
    });
  }

  if (sections.tasks) {
    tabs.push({
      id: "tasks",
      label: "Tasks",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
      content: sections.tasks,
    });
  }

  // If nothing parsed, show raw markdown
  if (tabs.length === 0) {
    return (
      <div className="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden mb-4">
        <div className="px-4 py-3 bg-[#f9fafb] border-b border-[#e5e7eb]">
          <span className="text-[13px] font-semibold text-[#374151]">Implementation Plan</span>
        </div>
        <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
          <MarkdownRenderer content={previewMarkdown} />
        </div>
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState<TabId>(tabs[0].id);
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden mb-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-[#f0f4ff] to-[#f9fafb] border-b border-[#e5e7eb]">
        <div className="w-6 h-6 rounded-lg bg-[#6366f1] flex items-center justify-center flex-shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-[#1f2937]" style={{ fontFamily: "'Matter', system-ui, sans-serif" }}>
            Implementation Plan
          </div>
          <div className="text-[11px] text-[#6b7280]">
            Review the plan below before approving
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e5e7eb] bg-[#fafafa]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium transition-all relative"
            style={{
              color: activeTab === tab.id ? "#6366f1" : "#6b7280",
              borderBottom: activeTab === tab.id ? "2px solid #6366f1" : "2px solid transparent",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "'Matter', system-ui, sans-serif",
            }}
          >
            <span style={{ color: activeTab === tab.id ? "#6366f1" : "#9ca3af" }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="px-4 py-4 max-h-[380px] overflow-y-auto"
          style={{ fontFamily: "'Matter', system-ui, sans-serif" }}
        >
          {currentTab.id === "tasks" ? (
            <TaskListRenderer markdown={currentTab.content} />
          ) : (
            <MarkdownRenderer content={currentTab.content} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
