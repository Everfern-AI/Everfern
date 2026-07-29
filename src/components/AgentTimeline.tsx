"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/components/ThemeProvider";
import {
    GlobeAltIcon,
    MagnifyingGlassIcon,
    CommandLineIcon,
    DocumentTextIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    FolderOpenIcon,
    FolderPlusIcon,
    ArrowRightIcon,
    TrashIcon,
    DocumentDuplicateIcon,
    CodeBracketIcon,
    PhotoIcon,
    CpuChipIcon,
    PencilSquareIcon,
    CubeTransparentIcon,
    WrenchScrewdriverIcon,
    CheckIcon,
    PresentationChartBarIcon,
} from "@heroicons/react/24/outline";

import type { SubAgentProgressEvent } from "./types";
import type { MissionTimeline as MissionTimelineType, MissionStep } from "./MissionTimeline";
import { ReasoningBlock } from "./ReasoningComponents";
import { InlineDebateProgress } from "./InlineDebateProgress";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ToolCallDisplay {
    id: string;
    toolName?: string;
    icon?: React.ReactNode;
    label?: string;
    color?: string;
    status: "running" | "done" | "error";
    output?: string;
    durationMs?: number;
    data?: any;
    base64Image?: string;
    args?: Record<string, unknown>;
    displayName?: string;
    description?: string;
    phase?: "triage" | "planning" | "execution" | "validation" | "completion";
    thought?: string;
    orderIndex?: number;
    subAgentProgress?: any[];
}

interface AgentTimelineProps {
    toolCalls: ToolCallDisplay[];
    thought?: string;
    reasoningContent?: string;
    isLive?: boolean;
    showOutput?: boolean;
    currentPhase?: "triage" | "planning" | "execution" | "validation" | "completion";
    currentNode?: string;
    planSteps?: Array<{ id: string; title?: string; description: string; tool?: string; status?: "pending" | "in_progress" | "in-progress" | "completed" | "failed" | "skipped" | "blocked"; dependencies?: string[] }> | null;
    planTitle?: string | null;
    generatedTitle?: string;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    timelineBranches?: Map<string, any>;
    debateData?: any;
    isDebating?: boolean;
    debateId?: string | null;
    onSkipDebate?: (debateId: string) => void;
    missionTimeline?: MissionTimelineType | null;
    onPillClick?: (tc: ToolCallDisplay) => void;
}

// ── Internal step names to hide ────────────────────────────────────────────────
const HIDDEN_STEP_NAMES = new Set([
    "analyzing intent",
    "decomposer",
    "planner",
    "brain",
    "triage",
    "initializing",
    "intent classification",
    "routing",
    "step:triage",
    "step:decomposer",
    "step:planner",
    "step:brain",
]);

const isHiddenStep = (step: MissionStep): boolean => {
    const name = step.name.toLowerCase().trim();
    const id = step.id.toLowerCase().trim();
    return (
        HIDDEN_STEP_NAMES.has(name) ||
        HIDDEN_STEP_NAMES.has(id) ||
        (name.startsWith("step:") && HIDDEN_STEP_NAMES.has(name.replace("step:", "")))
    );
};

// ── Tool meta (icon + container shape) ────────────────────────────────────────
type IconShape = "circle" | "square";

const getToolMeta = (toolName: string | undefined | null, size = 13): { icon: React.ReactNode; shape: IconShape } => {
    const n = (toolName || "").toLowerCase();
    const s = { width: size, height: size, flexShrink: 0 as const };

    if (n === "fern" || n === "recall_fact" || n === "remember_fact" || n === "update_profile" || n.includes("fern") || n.includes("memory") || n.includes("consolidator") || n.includes("confirm_preference") || n.includes("recall") || n.includes("remember")) {
        return {
            icon: (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z" />
                </svg>
            ),
            shape: "square"
        };
    }

    if (n === "search_mcp_registry" || n.includes("mcp"))
        return { icon: <CpuChipIcon style={s} />, shape: "square" };

    if (n.includes("search") || n.includes("find") || n.includes("query"))
        return { icon: <MagnifyingGlassIcon style={s} />, shape: "circle" };

    if (n.includes("browse") || n.includes("visit") || n.includes("web") || n.includes("navis") || n.includes("url"))
        return { icon: <GlobeAltIcon style={s} />, shape: "square" };

    if (n.includes("bash") || n.includes("command") || n.includes("terminal") || n.includes("shell") || n.includes("exec"))
        return { icon: <CommandLineIcon style={s} />, shape: "square" };

    if (n === "todo_write" || n.includes("todo"))
        return { icon: <CheckIcon style={s} />, shape: "square" };

    if (n === "pptx_generator" || n.includes("pptx") || n.includes("presentation"))
        return { icon: <PresentationChartBarIcon style={s} />, shape: "square" };

    if (n === "create_plan" || n === "execution_plan" || n === "update_plan" || n === "update_plan_step" || n.includes("plan"))
        return { icon: <CheckIcon style={s} />, shape: "square" };

    if (n.includes("write") || n.includes("create") || n.includes("save") || n.includes("artifact"))
        return { icon: <DocumentTextIcon style={s} />, shape: "square" };

    if (n.includes("read") || n.includes("open") || n.includes("load"))
        return { icon: <FolderOpenIcon style={s} />, shape: "square" };

    if (n.includes("edit") || n.includes("update") || n.includes("modify") || n.includes("patch"))
        return { icon: <PencilSquareIcon style={s} />, shape: "square" };

    if (n === "system_files") {
        // Action-specific icons — resolved at runtime via args; fallback to folder
        return { icon: <FolderOpenIcon style={s} />, shape: "square" };
    }

    if (n.includes("folder") || n.includes("directory"))
        return { icon: <FolderOpenIcon style={s} />, shape: "square" };

    if (n.includes("code") || n.includes("python") || n.includes("js"))
        return { icon: <CodeBracketIcon style={s} />, shape: "square" };

    if (n === "visual_classification_sheet" || n.includes("image") || n.includes("screenshot") || n.includes("photo"))
        return { icon: <PhotoIcon style={s} />, shape: "square" };

    if (n.includes("computer") || n.includes("mouse") || n.includes("click"))
        return { icon: <CpuChipIcon style={s} />, shape: "square" };

    if (n.includes("spawn") || n.includes("agent") || n.includes("sub"))
        return { icon: <CubeTransparentIcon style={s} />, shape: "square" };

    if (n.includes("skill"))
        return {
            icon: (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
            ),
            shape: "square"
        };

    return { icon: <WrenchScrewdriverIcon style={s} />, shape: "square" };
};

// ── Gallium icon container ─────────────────────────────────────────────────────
const IconContainer = ({
    icon,
    shape,
}: {
    icon: React.ReactNode;
    shape: IconShape;
}) => (
    <div
        style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: shape === "circle" ? "50%" : 7,
            background: "var(--color-border)",
            boxShadow: [
                "inset 0 1px 0 rgba(255,255,255,0.70)",
                "inset 0 -1px 0 var(--color-border)",
                "inset 1px 0 rgba(255,255,255,0.45)",
                "inset -1px 0 var(--color-border)",
            ].join(", "),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: 'var(--color-text-secondary)',
        }}
    >
        {icon}
    </div>
);

// ── Step Status Icon ───────────────────────────────────────────────────────────
const StepStatusIcon = ({ status }: { status: MissionStep["status"] }) => {
    if (status === "completed") {
        return (
            <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: 'var(--color-bg-subtle)', border: "1.5px solid var(--color-border)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                position: "relative", zIndex: 1,
            }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke='var(--color-text-secondary)' strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    }
    if (status === "in-progress") {
        return (
            <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: 'var(--color-bg-surface)', display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, position: "relative", zIndex: 1
            }}>
                <motion.div
                    style={{
                        width: 16, height: 16, borderRadius: "50%",
                        border: "2px solid var(--color-border)",
                        borderTopColor: "#3b82f6",
                        position: "absolute", inset: 0,
                    }}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                />
            </div>
        );
    }
    if (status === "failed") {
        return (
            <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: 'rgba(239, 68, 68, 0.12)', border: "1.5px solid rgba(239, 68, 68, 0.5)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                position: "relative", zIndex: 1,
                boxShadow: "0 0 6px rgba(239, 68, 68, 0.2)",
            }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    }
    return (
        <div style={{
            width: 16, height: 16, borderRadius: "50%",
            border: "1.5px solid var(--color-border)",
            background: 'var(--color-bg-subtle)', flexShrink: 0,
            position: "relative", zIndex: 1,
        }} />
    );
};

// ── Gallium surface: layered inset shadows simulate liquid-metal light physics
const galliumSurface = {
    background: "var(--color-bg-subtle)",
    boxShadow: [
        "inset 0 1px 0 rgba(255,255,255,0.1)",
        "inset 0 -1px 0 var(--color-border)",
        "inset 1px 0 rgba(255,255,255,0.08)",
        "inset -1px 0 var(--color-border)",
        "0 1px 3px var(--color-border)",
    ].join(", "),
    border: "0.5px solid var(--color-border)",
} as const;

const isComputerUseTool = (toolName?: string | null) => {
    const n = (toolName || "").toLowerCase();
    return n.includes("computer") || n.includes("mouse") || n.includes("click");
};

const getSubAgentEventText = (event: SubAgentProgressEvent, idx: number, nested = false) => {
    if (event.type === 'step') {
        if (event.stepNumber && event.totalSteps) {
            return `Step ${event.stepNumber}/${event.totalSteps}: ${event.content || ''}`;
        }
        return event.content || `Step ${event.stepNumber || idx + 1}`;
    }
    if (event.type === 'action') return event.action?.description || `Action: ${event.action?.type || 'execute'}`;
    if (event.type === 'reasoning') return event.content || "Thinking...";
    if (event.type === 'screenshot') return "Captured screenshot";
    if (event.type === 'complete') return nested ? "Computer use complete" : "Sub-agent execution complete";
    if (event.type === 'abort') return event.content || (nested ? "Computer use aborted" : "Sub-agent aborted");
    return event.content || event.type.replace(/_/g, " ");
};

const getSubAgentEventColor = (event: SubAgentProgressEvent) => {
    if (event.type === 'step') return "#3b82f6";
    if (event.type === 'action') return "#f59e0b";
    if (event.type === 'reasoning') return "#8b5cf6";
    if (event.type === 'screenshot') return "#10b981";
    if (event.type === 'complete') return "#22c55e";
    if (event.type === 'abort' || event.type === 'error') return "#ef4444";
    return 'var(--color-text-tertiary)';
};

// ── Sub-Agent Progress Timeline ──────────────────────────────────────────────────
const SubAgentProgressTimeline = ({
    toolCallId,
    events,
    nested = false,
}: {
    toolCallId: string;
    events: SubAgentProgressEvent[];
    nested?: boolean;
}) => {
    if (!events || events.length === 0) return null;

    return (
        <div style={{
            marginLeft: nested ? 46 : 32,
            marginTop: nested ? -1 : 4,
            marginBottom: nested ? 10 : 8,
            borderLeft: nested ? "1.5px solid var(--color-border)" : "1px dashed rgba(0,0,0,0.12)",
            paddingLeft: nested ? 12 : 14,
            display: "flex",
            flexDirection: "column",
            gap: nested ? 5 : 6,
        }}>
            {events.map((event, idx) => {
                const isStep = event.type === 'step';
                const isAction = event.type === 'action';
                const isReasoning = event.type === 'reasoning';
                const isScreenshot = event.type === 'screenshot';
                const isComplete = event.type === 'complete';
                const isAbort = event.type === 'abort';

                const iconColor = getSubAgentEventColor(event);
                const text = getSubAgentEventText(event, idx, nested);

                if (isReasoning && !event.content) return null;

                return (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -3 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            fontSize: 11.5,
                            color: 'var(--color-text-secondary)',
                        }}
                    >
                        {nested && (isAction || isStep || isScreenshot || isComplete || isAbort) ? (
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                width: "fit-content",
                                maxWidth: "100%",
                                padding: "5px 10px 5px 6px",
                                borderRadius: 12,
                                fontSize: 11.5,
                                color: isComplete ? "#15803d" : isAbort ? 'var(--color-error)' : 'var(--color-text-secondary)',
                                lineHeight: 1.35,
                                background: 'var(--color-bg-base)',
                                border: "1px solid var(--color-border)",
                                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                            }}>
                                <IconContainer
                                    icon={getToolMeta(event.action?.type || (isStep ? "cube" : isScreenshot ? "screenshot" : "tool"), 11).icon}
                                    shape={getToolMeta(event.action?.type || (isStep ? "cube" : isScreenshot ? "screenshot" : "tool"), 11).shape}
                                />
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {text}
                                </span>
                            </div>
                        ) : isAction || isStep ? (
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "7px 14px 7px 8px",
                                borderRadius: 14,
                                fontSize: 12.5,
                                color: 'var(--color-text-primary)',
                                lineHeight: 1.4,
                                position: "relative",
                                overflow: "hidden",
                                ...galliumSurface,
                            }}>
                                <IconContainer 
                                    icon={getToolMeta(event.action?.type || (isStep ? "cube" : "tool")).icon} 
                                    shape={getToolMeta(event.action?.type || (isStep ? "cube" : "tool")).shape} 
                                />
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {text}
                                </span>
                            </div>
                        ) : isReasoning && event.content ? (
                            <ReasoningBlock content={event.content} />
                        ) : (
                            <div style={{ display: "flex", alignItems: "start", gap: 6 }}>
                                <div style={{
                                    width: 5,
                                    height: 5,
                                    borderRadius: "50%",
                                    backgroundColor: iconColor,
                                    marginTop: 6,
                                    flexShrink: 0,
                                }} />
                                <div style={{ flex: 1, wordBreak: "break-word", lineHeight: 1.3 }}>
                                    <span style={{
                                        fontWeight: (isComplete || isAbort) ? 600 : 400,
                                        color: (isComplete) ? "#15803d" : (isAbort) ? 'var(--color-error)' : 'var(--color-text-primary)'
                                    }}>
                                        {text}
                                    </span>
                                </div>
                            </div>
                        )}

                        {isScreenshot && event.screenshot?.base64 && (
                            <div style={{
                                marginLeft: 11,
                                marginTop: 4,
                                borderRadius: 6,
                                overflow: "hidden",
                                border: "1px solid var(--color-border)",
                                maxWidth: 240,
                                boxShadow: "0 1px 3px var(--color-border)",
                            }}>
                                <img
                                    src={event.screenshot.base64.startsWith('data:image/') ? event.screenshot.base64 : `data:image/png;base64,${event.screenshot.base64}`}
                                    alt="Sub-agent screenshot"
                                    style={{ width: "100%", height: "auto", display: "block" }}
                                />
                            </div>
                        )}
                    </motion.div>
                );
            })}
        </div>
    );
};

// ── Tool Pill ──────────────────────────────────────────────────────────────────
const ToolPill = ({ tc, onClick }: { tc: ToolCallDisplay; onClick?: () => void }) => {
    const isRunning = tc.status === "running";
    const isDone = tc.status === "done";
    const isSkill = tc.toolName === 'skill' || tc.toolName === 'consult_skill' || tc.toolName === 'view_skill';
    const skillName = tc.args?.name as string | undefined;
    const isMemory = tc.toolName === 'fern' || tc.toolName === 'recall_fact' || tc.toolName === 'remember_fact' || tc.toolName === 'update_profile' || String(tc.toolName || '').toLowerCase().includes('fern') || String(tc.toolName || '').toLowerCase().includes('memory') || String(tc.toolName || '').toLowerCase().includes('consolidator') || String(tc.toolName || '').toLowerCase().includes('confirm_preference') || String(tc.toolName || '').toLowerCase().includes('recall') || String(tc.toolName || '').toLowerCase().includes('remember');
    const label = isMemory ? 'Memory' : (isSkill
        ? `Skill - ${skillName || tc.label || tc.toolName?.replace(/_/g, " ") || "Tool"}`
        : (tc.displayName || tc.label || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Tool")));
    let { icon, shape } = getToolMeta(tc.toolName);

    // system_files: pick action-specific icon at render time
    if (tc.toolName === 'system_files') {
        const sfa = String(tc.args?.action ?? '');
        const sz = { width: 13, height: 13, flexShrink: 0 as const };
        if (sfa === 'move')   icon = <ArrowRightIcon style={sz} />;
        else if (sfa === 'rename') icon = <DocumentDuplicateIcon style={sz} />;
        else if (sfa === 'mkdirp') icon = <FolderPlusIcon style={sz} />;
        else if (sfa === 'delete') icon = <TrashIcon style={sz} />;
        else                  icon = <FolderOpenIcon style={sz} />;
    }

    // Terse tool label shown inside the pill (path / command / url / name)
    const pillLabel = (() => {
        // system_files: build action-specific label from the right args
        if (tc.toolName === 'system_files') {
            const action = String(tc.args?.action ?? '');
            const from  = String(tc.args?.from ?? tc.args?.path ?? '');
            const to    = String(tc.args?.to ?? '');
            const p     = String(tc.args?.path ?? '');
            const bn    = (s: string) => s.split(/[/\\]/).at(-1) ?? s;
            if ((action === 'move' || action === 'rename') && from) {
                return to ? `${bn(from)} → ${bn(to)}` : bn(from);
            }
            if (action === 'mkdirp' && p) return bn(p);
            if (action === 'delete' && p) return bn(p);
            if (action === 'list'   && p && p !== '.') return bn(p);
            return label;
        }
        if (tc.toolName === 'search_mcp_registry') {
            const keyword = String(tc.args?.keyword ?? tc.args?.query ?? '').trim();
            return keyword ? `MCP registry: ${keyword}` : 'MCP registry';
        }
        if (tc.args?.query) return String(tc.args.query);
        if (tc.args?.url) return String(tc.args.url);
        if (tc.args?.url_to_visit) return String(tc.args.url_to_visit);
        if (tc.args?.title) return String(tc.args.title);
        if (tc.args?.command) return String(tc.args.command).slice(0, 80);
        if (tc.args?.path) return String(tc.args.path);
        if (tc.args?.content) return String(tc.args.content).slice(0, 60) + "…";
        return label;
    })();

    // using globally defined galliumSurface

    return (
        <motion.div
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ marginBottom: 4 }}
        >
            {/* The pill itself */}
            <div
                onClick={onClick}
                style={{
                    ...galliumSurface,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "fit-content",
                    maxWidth: "min(100%, 620px)",
                    padding: "5px 10px 5px 7px",
                    borderRadius: 12,
                    cursor: onClick ? "pointer" : "default",
                    fontSize: 12,
                    color: isDone ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                    lineHeight: 1.25,
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                <IconContainer icon={icon} shape={shape} />

                <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                }}>
                    {pillLabel}
                </span>

                {isRunning && (
                    <motion.span
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#22c55e",
                            flexShrink: 0,
                        }}
                        animate={{ opacity: [1, 0.35, 1] }}
                        transition={{ repeat: Infinity, duration: 1.2 }}
                    />
                )}

                {isRunning && (
                    <motion.div
                        style={{
                            position: "absolute", inset: 0,
                            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.42) 50%, transparent 100%)",
                            pointerEvents: "none",
                        }}
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
                    />
                )}
            </div>
        </motion.div>
    );
};

const cleanCommandNarrative = (rawCmd: string): string => {
    if (!rawCmd || typeof rawCmd !== "string") return "";
    let cmd = rawCmd;

    // 1. Extract inner command from PowerShell wrapper try block if present
    const tryMatch = cmd.match(/try\s*\{\s*&\s*\{\s*\$global:LASTEXITCODE\s*=\s*\$null;\s*([\s\S]*?)\s*\}\s*;/i);
    if (tryMatch && tryMatch[1]) {
        cmd = tryMatch[1];
    }

    // 2. Strip PowerShell env/encoding setup commands & wrappers
    cmd = cmd
        .replace(/\[Console\]::OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, "")
        .replace(/\$OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, "")
        .replace(/\$ProgressPreference\s*=\s*.*?(?:\r?\n|;|$)/gi, "")
        .replace(/\$global:EF_\w+\s*=\s*.*?(?:\r?\n|;|$)/gi, "")
        .replace(/Set-Location\s+-LiteralPath\s+.*?(?:\r?\n|;|$)/gi, "")
        .replace(/;\s*if\s*\(\$LASTEXITCODE[\s\S]*$/i, "")
        .trim();

    // 3. Normalize whitespace
    return cmd.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
};

const getToolNarrative = (tc: ToolCallDisplay): string | null => {
    const raw = tc.description?.trim();
    if (!raw) return null;
    if (raw.startsWith("{") && (raw.includes('"messages"') || raw.includes('"tool_calls"'))) return null;
    if (raw.startsWith("<tool_call>")) return null;
    if (/^call_function_[a-z0-9_ -]+$/i.test(raw)) return null;
    if (tc.toolName && raw.toLowerCase().startsWith(`${tc.toolName.toLowerCase()}:`)) return null;
    return raw.replace(/\s+/g, " ").trim();
};

const getToolActivity = (tc: ToolCallDisplay): { verb: string; detail: string; monoDetail?: string } | null => {
    const name = (tc.toolName || "").toLowerCase();
    const args = tc.args || {};
    const argText = (...values: unknown[]) => {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) return value.trim();
            if (typeof value === "number" || typeof value === "boolean") return String(value);
        }
        return "";
    };
    const pathValue = argText(
        args.path,
        args.filePath,
        args.file_path,
        args.file,
        args.TargetFile,
        args.AbsolutePath,
        args.targetPath,
        args.editedPath,
        args.outputPath
    );
    const rawCommandValue = argText(args.command, args.cmd, args.script, args.input);
    const commandValue = cleanCommandNarrative(rawCommandValue);
    const queryValue = argText(args.keyword, args.query, args.pattern, args.search, args.url, args.url_to_visit);
    const label = tc.displayName || tc.label || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Tool");

    if (name === "write" || name.includes("write_file") || name.includes("write_to_file")) {
        return {
            verb: "Creating file",
            detail: pathValue || "file",
            monoDetail: pathValue,
        };
    }

    if (name === "multi_file_edit") {
        const fileCount = Array.isArray(args.files) ? args.files.length : 0;
        return {
            verb: "Multi-editing files",
            detail: fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "files",
            monoDetail: pathValue,
        };
    }

    if (name === "edit" || name.includes("replace") || name.includes("str_replace")) {
        return {
            verb: "Editing file",
            detail: pathValue || "file",
            monoDetail: pathValue,
        };
    }

    if (name === "read" || name === "read_file" || name === "view_file") {
        return {
            verb: "Reading file",
            detail: pathValue || "file",
            monoDetail: pathValue,
        };
    }

    if (name === "grep" || name === "find" || name === "search_files") {
        return {
            verb: "Searching files",
            detail: queryValue || pathValue || "workspace",
            monoDetail: queryValue || pathValue,
        };
    }

    if (name === "search_mcp_registry") {
        return {
            verb: "Searching MCP registry",
            detail: queryValue || "connector catalog",
            monoDetail: queryValue,
        };
    }

    if (name === "ls" || name === "list_files") {
        return {
            verb: "Listing files",
            detail: pathValue || argText(args.directory, args.cwd) || "workspace",
            monoDetail: pathValue || argText(args.directory, args.cwd),
        };
    }

    if (name === "pptx_generator") {
        const titleValue = argText(args.title);
        const slides = Array.isArray(args.slides) ? args.slides.length : 0;
        return {
            verb: "Generating deck",
            detail: titleValue || pathValue || (slides ? `${slides} slides` : "presentation"),
            monoDetail: pathValue,
        };
    }

    if (name === "visual_classification_sheet") {
        const directoryValue = argText(args.directory, args.path);
        const imageCount = typeof tc.data?.imageCount === "number" ? tc.data.imageCount : undefined;
        return {
            verb: argText(args.question) ? "Classifying image sheet" : "Creating image sheet",
            detail: imageCount ? `${imageCount} images` : directoryValue || "image folder",
            monoDetail: directoryValue,
        };
    }

    if (name === "system_files") {
        const action = String(args.action || "");
        const from = String(args.from || args.path || "");
        const to = String(args.to || "");
        const verb = action === "mkdirp"
            ? "Creating folder"
            : action === "move"
                ? "Moving file"
                : action === "rename"
                    ? "Renaming file"
                    : action === "delete"
                        ? "Deleting file"
                        : "Updating files";
        return {
            verb,
            detail: to ? `${from} -> ${to}` : from || "file system",
            monoDetail: to ? `${from} -> ${to}` : from,
        };
    }

    if (name === "todo_write" || name === "todo") {
        const todos = Array.isArray(args.todos) ? args.todos : Array.isArray(args.items) ? args.items : [];
        const count = todos.length || Number(args.count || 0);
        return {
            verb: "Updating todos",
            detail: count ? `${count} item${count === 1 ? "" : "s"}` : "task list",
        };
    }

    if (name === "create_plan" || name === "execution_plan" || name === "update_plan" || name === "update_plan_step") {
        const title = argText(args.title, args.name, args.step, args.stepId);
        const steps = Array.isArray(args.steps) ? args.steps : Array.isArray(args.tasks) ? args.tasks : [];
        return {
            verb: name === "update_plan" || name === "update_plan_step" ? "Updating plan" : "Planning",
            detail: title || (steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "execution plan"),
        };
    }

    if (name === "terminal_execute" || name === "executepwsh" || name === "execute_pwsh" || name.includes("terminal")) {
        let conciseDetail = commandValue;
        if (commandValue.length > 50) {
            const parts = commandValue.split(/\s+/).filter(p => !p.startsWith('-'));
            conciseDetail = parts.slice(0, 3).join(' ');
            if (conciseDetail.length > 45) conciseDetail = commandValue.slice(0, 45) + "...";
        }
        return {
            verb: "Running command",
            detail: conciseDetail || "terminal",
            monoDetail: commandValue,
        };
    }

    if (name === "local_permission") {
        return {
            verb: "Requesting permission",
            detail: argText(args.reason) || commandValue || "local command",
            monoDetail: commandValue,
        };
    }

    if (name === "spawn_agent") {
        return {
            verb: "Spawning agent",
            detail: argText(args.name, args.role, args.agentName, args.task) || "subtask",
        };
    }

    if (name === "web_search" || name === "navis") {
        return {
            verb: "Searching web",
            detail: queryValue || "web",
            monoDetail: queryValue,
        };
    }

    if (name === "ask_user_question") {
        return {
            verb: "Asking question",
            detail: argText(args.question, args.prompt) || "user input",
        };
    }

    if (name === "computer_use") {
        return {
            verb: "Using computer",
            detail: argText(args.action, args.instruction, args.task) || "desktop",
        };
    }

    if (name === "skill" || name === "consult_skill" || name === "view_skill") {
        return {
            verb: "Using skill",
            detail: argText(args.name) || label,
        };
    }

    if (name.includes("discord") || name.includes("telegram")) {
        return {
            verb: "Sending message",
            detail: name.includes("discord") ? "Discord" : "Telegram",
        };
    }

    const fallbackDetail = queryValue || pathValue || commandValue || argText(args.name, args.action, args.reason) || label;
    return {
        verb: label,
        detail: fallbackDetail,
        monoDetail: pathValue || commandValue || queryValue,
    };
};

const ToolActivityRow = ({ tc, onClick }: { tc: ToolCallDisplay; onClick?: () => void }) => {
    const activity = getToolActivity(tc);
    if (!activity) return <ToolPill tc={tc} onClick={onClick} />;
    if (tc.status !== "running") return <ToolPill tc={tc} onClick={onClick} />;

    const detail = activity.monoDetail || activity.detail;

    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClick}
            style={{
                width: "fit-content",
                maxWidth: "100%",
                minHeight: 22,
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "3px 6px",
                border: "none",
                borderRadius: 7,
                background: "transparent",
                cursor: onClick ? "pointer" : "default",
                color: 'var(--color-text-secondary)',
                textAlign: "left",
                fontFamily: "inherit",
            }}
            onMouseEnter={e => { if (onClick) e.currentTarget.style.background = "rgba(59,130,246,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
            <motion.span
                style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 28%, #e0f2fe 0%, #7dd3fc 28%, #2563eb 68%, #1e3a8a 100%)",
                    boxShadow: "0 0 7px rgba(59,130,246,0.45), inset 0 0 2px rgba(255,255,255,0.85)",
                    flexShrink: 0,
                }}
                animate={{
                    scale: [1, 1.22, 1],
                    boxShadow: [
                        "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                        "0 0 11px rgba(56,189,248,0.58), inset 0 0 3px rgba(255,255,255,0.95)",
                        "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                    ],
                }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-primary)', flexShrink: 0 }}>
                {activity.verb}
            </span>
            <span
                title={detail}
                style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    fontFamily: "'Geist Mono', 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace",
                }}
            >
                {detail}
            </span>
        </motion.button>
    );
};

const getRepeatedToolGroupMeta = (toolName?: string) => {
    const name = (toolName || "tool").toLowerCase();
    if (name === "terminal_execute" || name === "executepwsh" || name === "execute_pwsh" || name.includes("terminal") || name.includes("command")) {
        return { Icon: CommandLineIcon, noun: "command" };
    }
    if (name === "read" || name === "read_file" || name === "view_file") {
        return { Icon: DocumentTextIcon, noun: "read" };
    }
    if (name === "write" || name.includes("write_file") || name.includes("write_to_file")) {
        return { Icon: DocumentTextIcon, noun: "write" };
    }
    if (name === "edit" || name === "multi_file_edit" || name.includes("replace") || name.includes("str_replace")) {
        return { Icon: PencilSquareIcon, noun: "edit" };
    }
    if (name === "grep" || name === "find" || name === "search_files") {
        return { Icon: MagnifyingGlassIcon, noun: "search" };
    }
    if (name === "search_mcp_registry" || name.includes("mcp")) {
        return { Icon: CpuChipIcon, noun: "MCP registry search" };
    }
    if (name === "ls" || name === "list_files" || name === "system_files") {
        return { Icon: FolderOpenIcon, noun: "file action" };
    }
    if (name === "web_search" || name === "navis") {
        return { Icon: GlobeAltIcon, noun: "web search" };
    }
    if (name === "pptx_generator") {
        return { Icon: PresentationChartBarIcon, noun: "presentation" };
    }
    if (name === "create_plan" || name === "execution_plan" || name === "update_plan" || name === "update_plan_step" || name.includes("plan")) {
        return { Icon: CheckIcon, noun: "plan update" };
    }
    return { Icon: WrenchScrewdriverIcon, noun: (toolName || "tool").replace(/_/g, " ") };
};

const normalizeToolGroupName = (toolName?: string) => (toolName || "tool").toLowerCase();

const GlobeDotIcon = ({ isRunning, color }: { isRunning: boolean; color: string }) => {
    return (
        <div style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            flexShrink: 0,
        }}>
            <motion.div
                style={{
                    position: "absolute",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: `${color}14`,
                    border: `1px solid ${color}26`,
                }}
                animate={isRunning ? { scale: [1, 1.35, 1], opacity: [0.6, 0.2, 0.6] } : { scale: [1, 1.15, 1], opacity: [0.4, 0.15, 0.4] }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            />
            <div style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: color,
                border: "1.5px solid var(--color-bg-surface)",
                boxShadow: `0 0 8px ${color}cc`,
                position: "relative",
                zIndex: 1,
            }} />
        </div>
    );
};

interface ParsedFact {
    timestamp?: string;
    content: string;
    tags: string[];
}

const TAG_COLORS: Record<string, { bg: string, text: string, border: string }> = {
    identity: { bg: 'rgba(16, 185, 129, 0.08)', text: '#059669', border: 'rgba(16, 185, 129, 0.2)' },
    preference: { bg: 'rgba(59, 130, 246, 0.08)', text: '#2563eb', border: 'rgba(59, 130, 246, 0.2)' },
    habit: { bg: 'rgba(245, 158, 11, 0.08)', text: '#d97706', border: 'rgba(245, 158, 11, 0.2)' },
    travel: { bg: 'rgba(139, 92, 246, 0.08)', text: '#7c3aed', border: 'rgba(139, 92, 246, 0.2)' },
    payment: { bg: 'rgba(236, 72, 153, 0.08)', text: '#db2777', border: 'rgba(236, 72, 153, 0.2)' },
    work: { bg: 'rgba(6, 182, 212, 0.08)', text: '#0891b2', border: 'rgba(6, 182, 212, 0.2)' },
    contact: { bg: 'rgba(14, 165, 233, 0.08)', text: '#0284c7', border: 'rgba(14, 165, 233, 0.2)' },
    fact: { bg: 'rgba(107, 114, 128, 0.08)', text: 'var(--color-text-secondary)', border: 'rgba(107, 114, 128, 0.2)' },
};

const formatTimestamp = (ts?: string): string => {
    if (!ts) return "Recently";
    try {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return ts;
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return ts;
    }
};

const deduceTags = (content: string, existingTags: string[] = []): string[] => {
    const tags = new Set<string>(existingTags.map(t => t.toLowerCase()));
    const lower = content.toLowerCase();

    if (lower.includes('name') || lower.includes('called') || lower.includes('username')) {
        tags.add('identity');
    }
    if (lower.includes('like') || lower.includes('dislike') || lower.includes('love') || lower.includes('hate') || lower.includes('prefer') || lower.includes('favorite')) {
        tags.add('preference');
    }
    if (lower.includes('always') || lower.includes('usually') || lower.includes('often') || lower.includes('every') || lower.includes('habit')) {
        tags.add('habit');
    }
    if (lower.includes('flight') || lower.includes('airline') || lower.includes('travel') || lower.includes('seat') || lower.includes('hotel')) {
        tags.add('travel');
    }
    if (lower.includes('card') || lower.includes('visa') || lower.includes('billing') || lower.includes('payment') || lower.includes('stripe')) {
        tags.add('payment');
    }
    if (lower.includes('work') || lower.includes('company') || lower.includes('office') || lower.includes('job') || lower.includes('profession')) {
        tags.add('work');
    }
    if (lower.includes('email') || lower.includes('phone') || lower.includes('contact') || lower.includes('address')) {
        tags.add('contact');
    }

    if (tags.size === 0) {
        tags.add('fact');
    }

    return Array.from(tags);
};

const parseFacts = (output: string): ParsedFact[] => {
    if (!output) return [];

    try {
        const clean = output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(clean);
        
        if (parsed && Array.isArray(parsed.newMemories)) {
            return parsed.newMemories.map((m: any) => {
                const content = m.fact || m.content || JSON.stringify(m);
                const tags = m.type ? [m.type] : m.category ? [m.category] : [];
                return {
                    timestamp: m.timestamp || m.created,
                    content,
                    tags: deduceTags(content, tags)
                };
            });
        }
        
        if (parsed && (parsed.fact || parsed.content)) {
            const content = parsed.fact || parsed.content;
            const tags = parsed.type ? [parsed.type] : parsed.category ? [parsed.category] : [];
            const ts = parsed.timestamp || parsed.created || parsed.metadata?.created;
            return [{ timestamp: ts, content, tags: deduceTags(content, tags) }];
        }
    } catch (e) {}

    const lines = output.split('\n');
    const facts: ParsedFact[] = [];
    let currentTimestamp: string | undefined = undefined;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const timeMatch = line.match(/^\((2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\)$/i) || 
                           line.match(/^\((2\d{3}-\d{2}-\d{2})\)$/);
        if (timeMatch) {
            currentTimestamp = timeMatch[1];
            continue;
        }

        const inlineTimeMatch = line.match(/^\((.*?)\)\s*[-:]?\s*(.*)/);
        if (inlineTimeMatch) {
            const ts = inlineTimeMatch[1];
            const content = inlineTimeMatch[2].replace(/^-\s*/, '').trim();
            facts.push({ timestamp: ts, content, tags: deduceTags(content) });
            continue;
        }

        if (line.startsWith('-')) {
            const content = line.slice(1).trim();
            facts.push({ timestamp: currentTimestamp, content, tags: deduceTags(content) });
            continue;
        }

        if (line.toLowerCase().startsWith('found matches:')) continue;
        if (line.toLowerCase().startsWith('no facts') || line.toLowerCase().startsWith('no memory')) continue;

        const cleanContent = line.replace(/^-\s*/, '').trim();
        if (cleanContent.length > 3) {
            facts.push({ timestamp: currentTimestamp, content: cleanContent, tags: deduceTags(cleanContent) });
        }
    }

    return facts;
};

const MemoryTimelineCard = ({ tc, onClick }: { tc: ToolCallDisplay; onClick?: () => void }) => {
    const isRunning = tc.status === "running";
    const isError = tc.status === "error";
    
    const tname = (tc.toolName || '').toLowerCase();
    const isRecall = tname.includes('recall') || tname.includes('search');
    const isSave = tname.includes('remember') || tname.includes('save') || tname.includes('consolidator');
    const isUpdate = tname.includes('update') || tname.includes('profile') || tname.includes('preference');
    
    let opLabel = "Memory Access";
    let themeColor = "#10b981"; // Unified EverFern emerald green brand theme
    let glowColor = "rgba(16, 185, 129, 0.04)";
    let accentGradient = "linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, rgba(20, 184, 166, 0.02) 100%)";
    let pulseColor = "#34d399";
    
    if (isSave) {
        opLabel = "Memory Retained";
    } else if (isUpdate) {
        opLabel = "Memory Updated";
    } else if (isRecall) {
        opLabel = "Memory Recalled";
    }
    
    if (isError) {
        opLabel = "Memory Access Failed";
        themeColor = "#ef4444";
        glowColor = "rgba(239, 68, 68, 0.08)";
        accentGradient = "linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(220, 38, 38, 0.04) 100%)";
        pulseColor = "#f87171";
    }

    const query = tc.args?.query || tc.args?.fact || tc.args?.content || tc.args?.preference || tc.args?.taskName || '';
    
    let previewText = "";
    if (tc.output) {
        try {
            const clean = tc.output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(clean);
            if (parsed && Array.isArray(parsed.newMemories)) {
                previewText = parsed.newMemories.map((m: any) => m.fact || m.content).join(", ");
            } else if (parsed && parsed.fact) {
                previewText = parsed.fact;
            }
        } catch {
            previewText = tc.output.replace(/^Found matches:\s*/i, '').trim();
            if (previewText.toLowerCase().startsWith('no ') || previewText.toLowerCase().startsWith('no facts')) {
                previewText = "No memory records matched this context.";
            } else {
                previewText = previewText.split(/\n---\n|\n---\s*\n/)[0].trim();
                const srcMatch = previewText.match(/^\[(.*?)\]\s*\[(.*?)\]/);
                if (srcMatch) {
                    previewText = previewText.slice(srcMatch[0].length).trim();
                }
            }
        }
    }

    const [expanded, setExpanded] = useState(false);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            style={{
                width: "100%",
                maxWidth: "620px",
                borderRadius: 12,
                border: `1px solid ${isRunning ? themeColor : 'var(--color-border)'}`,
                background: isRunning ? glowColor : 'var(--color-bg-surface)',
                boxShadow: isRunning 
                    ? `0 4px 18px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.1)`
                    : "0 1px 3px rgba(0,0,0,0.02), inset 0 1px 0 rgba(255,255,255,0.15)",
                overflow: "hidden",
                margin: "4px 0 8px",
                cursor: "pointer",
                transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
            }}
            onClick={(e) => {
                setExpanded(!expanded);
                e.stopPropagation();
            }}
            whileHover={{ 
                boxShadow: isRunning 
                    ? `0 6px 22px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.15)` 
                    : "0 3px 12px var(--color-border), inset 0 1px 0 rgba(255,255,255,0.9)",
                transform: "translateY(-1px)",
                borderColor: isRunning ? themeColor : "rgba(0,0,0,0.16)"
            }}
        >
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: accentGradient,
            }}>
                <GlobeDotIcon isRunning={isRunning} color={themeColor} />

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ 
                            fontSize: 12, 
                            fontWeight: 700, 
                            color: isRunning ? themeColor : 'var(--color-text-primary)',
                            letterSpacing: "-0.015em"
                        }}>
                            {isRunning ? "Accessing EverFern Memory..." : opLabel}
                        </span>
                        {!isRunning && (
                            <span style={{ 
                                fontSize: 9, 
                                fontWeight: 700, 
                                padding: "1px 5px", 
                                borderRadius: 6, 
                                background: isError ? "rgba(239, 68, 68, 0.08)" : `${themeColor}12`, 
                                color: themeColor,
                                textTransform: "uppercase",
                                letterSpacing: "0.03em"
                            }}>
                                {tc.toolName}
                            </span>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {onClick && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClick();
                            }}
                            style={{
                                border: "none",
                                background: "var(--color-border)",
                                padding: "3px 7px",
                                borderRadius: 5,
                                fontSize: 9.5,
                                fontWeight: 600,
                                color: 'var(--color-text-secondary)',
                                cursor: "pointer",
                                transition: "background 0.2s ease"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "var(--color-border)"}
                            onMouseLeave={e => e.currentTarget.style.background = "var(--color-border)"}
                        >
                            Trace
                        </button>
                    )}
                    <motion.div 
                        animate={{ rotate: expanded ? 180 : 0 }}
                        style={{ color: 'var(--color-text-tertiary)', display: "flex", alignItems: "center" }}
                    >
                        <ChevronDownIcon style={{ width: 14, height: 14 }} />
                    </motion.div>
                </div>
            </div>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden", borderTop: "1px solid var(--color-border)", background: 'var(--color-bg-base)' }}
                    >
                        <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                            {query && (
                                <div style={{ fontSize: 10.5, color: 'var(--color-text-secondary)' }}>
                                    <span style={{ fontWeight: 600 }}>Query:</span> <code style={{ fontFamily: "monospace", color: 'var(--color-text-primary)' }}>{String(query)}</code>
                                </div>
                            )}
                            
                            {previewText && (() => {
                                const parsedFacts = parseFacts(tc.output || '');
                                return (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: query ? 4 : 0 }}>
                                        {parsedFacts.length > 0 ? (
                                            parsedFacts.map((fact, fIdx) => {
                                                const formattedTime = formatTimestamp(fact.timestamp);
                                                return (
                                                    <div key={fIdx} style={{ 
                                                        display: "flex", 
                                                        alignItems: "flex-start", 
                                                        justifyContent: "space-between", 
                                                        gap: 16,
                                                        padding: "4px 0",
                                                        borderTop: fIdx > 0 ? "1px solid rgba(0,0,0,0.03)" : "none"
                                                    }}>
                                                        <div style={{ fontSize: 11.5, color: 'var(--color-text-primary)', lineHeight: 1.4, flex: 1 }}>
                                                            {fact.content}
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>
                                                            {fact.tags.map((tag) => (
                                                                <span key={tag} style={{
                                                                    fontSize: 8.5,
                                                                    fontWeight: 600,
                                                                    padding: "1px 4px",
                                                                    borderRadius: 4,
                                                                    backgroundColor: "var(--color-border)",
                                                                    color: 'var(--color-text-secondary)',
                                                                    border: "1px solid var(--color-border)",
                                                                    textTransform: "uppercase"
                                                                }}>
                                                                    {tag}
                                                                </span>
                                                            ))}
                                                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                                                                {formattedTime}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                                {previewText}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {isError && tc.output && (
                                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 6, marginTop: 2 }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.05em" }}>Failure Output</span>
                                    <p style={{ margin: "2px 0 0", fontSize: 11, color: 'var(--color-error)', fontFamily: "monospace" }}>
                                        {String(tc.output)}
                                    </p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const ToolTimelineItem = ({
    tc,
    onPillClick,
    subAgentProgress,
    index,
}: {
    tc: ToolCallDisplay;
    onPillClick?: (tc: ToolCallDisplay) => void;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    index: number;
}) => {
    const tNameLower = String(tc.toolName || '').toLowerCase();
    const isMemory = tc.toolName === 'fern' || tc.toolName === 'recall_fact' || tc.toolName === 'remember_fact' || tc.toolName === 'update_profile' || tNameLower.includes('fern') || tNameLower.includes('memory') || tNameLower.includes('consolidator') || tNameLower.includes('confirm_preference') || tNameLower.includes('recall') || tNameLower.includes('remember');

    if (isMemory) {
        return (
            <MemoryTimelineCard
                tc={tc}
                onClick={onPillClick ? () => onPillClick(tc) : undefined}
            />
        );
    }

    const events = tc.subAgentProgress || subAgentProgress?.get(tc.id) || [];
    const pinRunningActivityToBottom = tc.status === "running" && !!getToolActivity(tc);

    return (
        <React.Fragment key={tc.id || `tc-${index}`}>
            {!pinRunningActivityToBottom && (
                <ToolActivityRow
                    tc={tc}
                    onClick={onPillClick ? () => onPillClick(tc) : undefined}
                />
            )}
            <SubAgentProgressTimeline
                toolCallId={tc.id}
                events={events}
                nested={isComputerUseTool(tc.toolName)}
            />
            {pinRunningActivityToBottom && (
                <ToolActivityRow
                    tc={tc}
                    onClick={onPillClick ? () => onPillClick(tc) : undefined}
                />
            )}
        </React.Fragment>
    );
};

const RepeatedToolCollapse = ({
    group,
    onPillClick,
    subAgentProgress,
}: {
    group: ToolCallDisplay[];
    onPillClick?: (tc: ToolCallDisplay) => void;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
}) => {
    const [open, setOpen] = useState(false);
    const { Icon, noun } = getRepeatedToolGroupMeta(group[0]?.toolName);
    const count = group.length;
    const label = `Ran ${count} ${noun}${count === 1 || noun.endsWith("s") ? "" : "s"}`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "100%", margin: "2px 0 4px" }}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                style={{
                    width: "fit-content",
                    maxWidth: "100%",
                    minHeight: 22,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 5px",
                    border: "none",
                    borderRadius: 999,
                    background: "transparent",
                    color: 'var(--color-text-tertiary)',
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 12.5,
                    fontWeight: 400,
                    lineHeight: 1,
                    textAlign: "left",
                    boxShadow: "none",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(17,24,39,0.04)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                aria-expanded={open}
            >
                <span
                    style={{
                        width: 13,
                        height: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: 'var(--color-text-tertiary)',
                        flexShrink: 0,
                    }}
                >
                    <Icon width={12} height={12} strokeWidth={1.75} />
                </span>
                <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18, ease: "easeInOut" }}
                        style={{
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            gap: 5,
                            paddingLeft: 10,
                            marginTop: 1,
                        }}
                    >
                        {group.map((tc, idx) => (
                            <ToolTimelineItem
                                key={tc.id || `${tc.toolName}-${idx}`}
                                tc={tc}
                                index={idx}
                                onPillClick={onPillClick}
                                subAgentProgress={subAgentProgress}
                            />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const renderToolRun = (
    run: ToolCallDisplay[],
    runIndex: number,
    onPillClick?: (tc: ToolCallDisplay) => void,
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>
) => {
    if (run.length > 2) {
        return (
            <RepeatedToolCollapse
                key={`repeat-${normalizeToolGroupName(run[0]?.toolName)}-${runIndex}-${run.map(tc => tc.id).join("-")}`}
                group={run}
                onPillClick={onPillClick}
                subAgentProgress={subAgentProgress}
            />
        );
    }
    return run.map((tc, idx) => (
        <ToolTimelineItem
            key={tc.id || `${tc.toolName}-${runIndex}-${idx}`}
            tc={tc}
            index={idx}
            onPillClick={onPillClick}
            subAgentProgress={subAgentProgress}
        />
    ));
};

const renderToolGroups = (
    toolCalls: ToolCallDisplay[],
    onPillClick?: (tc: ToolCallDisplay) => void,
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>
) => {
    const rendered: React.ReactNode[] = [];
    let activeNarrative: string | null = null;
    let batch: ToolCallDisplay[] = [];

    const flush = () => {
        if (!batch.length) return;
        const batchKey = batch.map(tc => tc.id).join("-");
        const runs: ToolCallDisplay[][] = [];
        for (const tc of batch) {
            const currentRun = runs[runs.length - 1];
            if (currentRun && normalizeToolGroupName(currentRun[0]?.toolName) === normalizeToolGroupName(tc.toolName)) {
                currentRun.push(tc);
            } else {
                runs.push([tc]);
            }
        }

        rendered.push(
            <React.Fragment key={`batch-${batchKey}`}>
                {activeNarrative && (
                    <p
                        data-testid="tool-batch-narrative"
                        style={{
                            fontSize: 12,
                            color: 'var(--color-text-tertiary)',
                            lineHeight: 1.65,
                            margin: "4px 2px 7px",
                            maxWidth: 820,
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                        }}
                    >
                        {activeNarrative}
                    </p>
                )}
                {runs.map((run, idx) => renderToolRun(run, idx, onPillClick, subAgentProgress))}
            </React.Fragment>
        );
        batch = [];
    };

    for (const tc of toolCalls) {
        const narrative = getToolNarrative(tc);
        if (narrative !== activeNarrative) {
            flush();
            activeNarrative = narrative;
        }
        batch.push(tc);
    }
    flush();

    return rendered;
};

const shouldHideStepResult = (str: string | undefined | null): boolean => {
    if (!str) return true;
    const trimmed = str.trim();
    if (!trimmed) return true;

    // Check for JSON structures
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"') || trimmed.startsWith('\\"')) {
        // Direct JSON check
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed !== null) {
                return true;
            }
        } catch {}

        // Double-serialized JSON check
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            try {
                const parsed = JSON.parse(JSON.parse(trimmed));
                if (typeof parsed === 'object' && parsed !== null) {
                    return true;
                }
            } catch {}
        }
    }

    const lower = trimmed.toLowerCase();
    // Check for assistant messages or tool calls indicators
    if (lower.includes('"messages"') || lower.includes('"tool_calls"') || lower.includes('"role"') || lower.includes('"content"')) {
        return true;
    }
    if (lower.includes('\\"messages\\"') || lower.includes('\\"tool_calls\\"') || lower.includes('\\"role\\"') || lower.includes('\\"content\\"')) {
        return true;
    }

    // Check for "Completed X tool calls" or similar technical progress noise
    if (/^completed\s*\d*\s*tool\s*calls?$/i.test(trimmed) || 
        /^completed\s*\d*\s*calls?$/i.test(trimmed) ||
        trimmed.startsWith('Completed tool call') ||
        trimmed.startsWith('Completed tool calls')) {
        return true;
    }

    return false;
};

// ── Mission Step Row (accordion) ───────────────────────────────────────────────
const MissionStepRow = ({
    step,
    toolCalls,
    isLive,
    defaultOpen,
    onPillClick,
    subAgentProgress,
    isLast,
}: {
    step: MissionStep;
    toolCalls: ToolCallDisplay[];
    isLive: boolean;
    defaultOpen: boolean;
    onPillClick?: (tc: ToolCallDisplay) => void;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    isLast: boolean;
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const hasRunningTools = toolCalls.some(tc => tc.status === "running");
    const hasPinnedRunningActivity = toolCalls.some(tc => tc.status === "running" && !!getToolActivity(tc));
    const hasActiveToolsAfterCompletion = step.status === "completed" && hasRunningTools;
    const effectiveStatus = hasActiveToolsAfterCompletion ? "in-progress" : step.status;
    const isDone = effectiveStatus === "completed";
    const isActive = effectiveStatus === "in-progress";
    const isPending = step.status === "pending" || step.status === "skipped";

    useEffect(() => {
        if (isActive || hasActiveToolsAfterCompletion) setOpen(true);
    }, [isActive, hasActiveToolsAfterCompletion, toolCalls.length]);

    const hasContent = toolCalls.length > 0 || !!step.description || !!step.result;

    const rawName = step.name.charAt(0).toUpperCase() + step.name.slice(1);
    const displayName = rawName.length > 45 ? rawName.slice(0, 42) + "..." : rawName;

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: isPending ? 0.35 : 1, y: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginBottom: 4, position: "relative" }}
        >
            {!isLast && (
                <div style={{
                    position: "absolute",
                    top: 14,
                    bottom: -18,
                    left: 7,
                    borderLeft: "1.5px dashed var(--color-border)",
                    zIndex: 0,
                    pointerEvents: "none",
                }} />
            )}
            <div
                onClick={() => hasContent && setOpen(o => !o)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 0",
                    cursor: hasContent ? "pointer" : "default",
                    userSelect: "none",
                }}
            >
                <StepStatusIcon status={effectiveStatus} />
                <span style={{
                    fontSize: 13, fontWeight: isActive ? 600 : 500,
                    color: isDone ? 'var(--color-text-tertiary)' : isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    flex: 1, letterSpacing: "-0.01em",
                }}>
                    {displayName}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {step.duration != null && step.duration > 0 && !hasActiveToolsAfterCompletion && (
                        <span style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                            {(step.duration / 1000).toFixed(1)}s
                        </span>
                    )}
                    {hasContent && (
                        <span style={{ color: 'var(--color-text-tertiary)', display: "flex" }}>
                            {open
                                ? <ChevronUpIcon style={{ width: 14, height: 14 }} />
                                : <ChevronDownIcon style={{ width: 14, height: 14 }} />}
                        </span>
                    )}
                </div>
            </div>

            <AnimatePresence initial={false}>
                {open && hasContent && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{
                            paddingLeft: 24,
                            paddingBottom: 10,
                            marginLeft: 6,
                            borderLeft: "none",
                        }}>
                            {step.description && (
                                <p style={{
                                    fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6,
                                    margin: "4px 0 10px", fontWeight: 400,
                                }}>
                                    {step.description}
                                </p>
                            )}

                            {isActive && toolCalls.length === 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, marginTop: 4 }}>
                                    <motion.div
                                        style={{ width: 5, height: 5, borderRadius: "50%", background: "#3b82f6" }}
                                        animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                    />
                                    <span style={{ fontSize: 11, fontWeight: 500, color: "#3b82f6", letterSpacing: "0.01em" }}>
                                        Thinking...
                                    </span>
                                </div>
                            )}

                            {toolCalls.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                        {toolCalls.length > 50 && (
                                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: "center", paddingBottom: 4 }}>
                                                ... {toolCalls.length - 50} older actions hidden for performance
                                            </div>
                                        )}
                                        {renderToolGroups(toolCalls.slice(-50), onPillClick, subAgentProgress)}
                                    </div>

                                    {isActive && toolCalls.some(tc => tc.status === "running") && !hasPinnedRunningActivity && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                            <motion.div
                                                style={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: "50%",
                                                    background: "radial-gradient(circle at 35% 28%, #e0f2fe 0%, #7dd3fc 28%, #2563eb 68%, #1e3a8a 100%)",
                                                    boxShadow: "0 0 7px rgba(59,130,246,0.45), inset 0 0 2px rgba(255,255,255,0.85)",
                                                }}
                                                animate={{
                                                    scale: [1, 1.22, 1],
                                                    boxShadow: [
                                                        "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                                                        "0 0 11px rgba(56,189,248,0.58), inset 0 0 3px rgba(255,255,255,0.95)",
                                                        "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                                                    ],
                                                }}
                                                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                                            />
                                            <span style={{ fontSize: 11, fontWeight: 500, color: "#2563eb" }}>
                                                Executing tools...
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {step.result && isDone && !shouldHideStepResult(step.result) && (
                                <div style={{
                                    fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5,
                                    marginTop: 8, padding: "6px 8px", background: 'var(--color-bg-subtle)', borderRadius: 6,
                                    border: "1px solid var(--color-border)",
                                }}>
                                    {step.result.slice(0, 150)}{step.result.length > 150 ? "…" : ""}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// ── Task Group Row (orphan tool calls, collapsible) ───────────────────────────
const TaskGroupRow = ({
    taskName,
    toolCalls,
    onPillClick,
    subAgentProgress,
    isLast,
}: {
    taskName: string;
    toolCalls: ToolCallDisplay[];
    onPillClick?: (tc: ToolCallDisplay) => void;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    isLast: boolean;
}) => {
    const hasRunning = toolCalls.some(tc => tc.status === "running");
    const hasFailed = toolCalls.some(tc => tc.status === "error");
    const allDone = toolCalls.every(tc => tc.status === "done" || tc.status === "error");
    const effectiveStatus: MissionStep["status"] = hasRunning
        ? "in-progress"
        : hasFailed
            ? "failed"
            : allDone
                ? "completed"
                : "pending";
    const isActive = effectiveStatus === "in-progress";
    const isDone = effectiveStatus === "completed";

    const [open, setOpen] = useState(isActive || !isDone);

    useEffect(() => {
        if (isActive) setOpen(true);
    }, [isActive, toolCalls.length]);

    const rawName = taskName.charAt(0).toUpperCase() + taskName.slice(1);
    const displayName = rawName.length > 55 ? rawName.slice(0, 52) + "..." : rawName;
    const isGeneral = taskName === "General Execution";

    if (isGeneral) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {toolCalls.length > 50 && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: "center", paddingBottom: 4 }}>
                        ... {toolCalls.length - 50} older actions hidden for performance
                    </div>
                )}
                {renderToolGroups(toolCalls.slice(-50), onPillClick, subAgentProgress)}
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginBottom: 4, position: "relative" }}
        >
            {/* Dashed connecting line */}
            {!isLast && (
                <div style={{
                    position: "absolute",
                    top: 14,
                    bottom: -18,
                    left: 7,
                    borderLeft: "1.5px dashed var(--color-border)",
                    zIndex: 0,
                    pointerEvents: "none",
                }} />
            )}

            {/* Header row */}
            <div
                onClick={() => setOpen(o => !o)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 0",
                    cursor: "pointer",
                    userSelect: "none",
                }}
            >
                <StepStatusIcon status={effectiveStatus} />
                <span style={{
                    fontSize: 13, fontWeight: isActive ? 600 : 500,
                    color: isDone ? 'var(--color-text-tertiary)' : isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    flex: 1, letterSpacing: "-0.01em",
                }}>
                    {displayName}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                        fontSize: 10.5, color: 'var(--color-text-tertiary)', fontWeight: 500,
                        background: 'var(--color-bg-subtle)', padding: "1px 6px", borderRadius: 4,
                    }}>
                        {toolCalls.length}
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary)', display: "flex" }}>
                        {open
                            ? <ChevronUpIcon style={{ width: 14, height: 14 }} />
                            : <ChevronDownIcon style={{ width: 14, height: 14 }} />}
                    </span>
                </div>
            </div>

            {/* Collapsible content */}
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        key="task-group-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{
                            paddingLeft: 24,
                            paddingBottom: 10,
                            marginLeft: 6,
                        }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {toolCalls.length > 50 && (
                                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: "center", paddingBottom: 4 }}>
                                        ... {toolCalls.length - 50} older actions hidden for performance
                                    </div>
                                )}
                                {renderToolGroups(toolCalls.slice(-50), onPillClick, subAgentProgress)}
                            </div>

                            {isActive && toolCalls.some(tc => tc.status === "running") && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                                    <motion.div
                                        style={{
                                            width: 6, height: 6, borderRadius: "50%",
                                            background: "radial-gradient(circle at 35% 28%, #e0f2fe 0%, #7dd3fc 28%, #2563eb 68%, #1e3a8a 100%)",
                                            boxShadow: "0 0 7px rgba(59,130,246,0.45), inset 0 0 2px rgba(255,255,255,0.85)",
                                        }}
                                        animate={{
                                            scale: [1, 1.22, 1],
                                            boxShadow: [
                                                "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                                                "0 0 11px rgba(56,189,248,0.58), inset 0 0 3px rgba(255,255,255,0.95)",
                                                "0 0 6px rgba(59,130,246,0.38), inset 0 0 2px rgba(255,255,255,0.85)",
                                            ],
                                        }}
                                        transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                                    />
                                    <span style={{ fontSize: 11, fontWeight: 500, color: "#2563eb" }}>
                                        Executing...
                                    </span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// ── Thought text cleaner ───────────────────────────────────────────────────────
const THOUGHT_NOISE_PATTERNS = [
    /🤖[^\n]*/g,
    /🧭[^\n]*/g,
    /🔍[^\n]*/g,
    /⏱️[^\n]*/g,
    /⏭️[^\n]*/g,
    /🧠[^\n]*/g,
    /💭(?!\s*Working on:|\s*Task:)[^\n]*/g,
    /\[?BRAIN\]?[:\s][^\n]*/gi,
    /\[?TRIAGE\]?[:\s][^\n]*/gi,
    /\[?PLANNER\]?[:\s][^\n]*/gi,
    /\[?DECOMPOSER\]?[:\s][^\n]*/gi,
    /Triage in progress:[^\n]*/gi,
    /Initializing step[^\n]*/gi,
    /Analyzing task requirements[^\n]*/gi,
    /Routing analysis completed[^\n]*/gi,
    /Processing\.\.\.[^\n]*/gi,
    /\[?Evaluating in [^\]\s]+\]?\.*[^\n]*/gi,
    /\[?Navis\]?[^\n]*/gi,
    /\[?Terminal\]?[^\n]*/gi,
    /\[?Computer\]?[^\n]*/gi,
    /Intent Classification:.*?(?=(Decomposer:|Debate:|Skipped Debate:|Brain Node:|🧭|$))/gi,
    /(?:Skipped )?Decomposer: Skipped[^\n]*/gi,
    /(?:Skipped )?Debate:.*?(?=(Brain Node:|🧭|$))/gi,
    /Brain Node:.*?(?=(🧭|$))/gi,
    /task_complete — Task completed[^\n]*/gi,
    /\{[\s\n]*"messages"[\s\S]*?\}/gi,
    /\{[\s\n]*"tool_calls"[\s\S]*?\}/gi,
    /\{[\s\n]*"role"[\s\S]*?\}/gi,
    /(?:🌐|🔍|📝|✅|🔬|⚠️|🖥️|💻|📊)\s*(?:WEB EXPLORER|Deep Research|OS Interaction|Coding Specialist|Data Analyst|Data Analysis)[^\n]*/gi,
    /(?:WEB EXPLORER|Deep Research|OS Interaction|Coding Specialist|Data Analyst|Data Analysis)[:\-\s][^\n]*/gi,
];

const cleanThought = (text: string): string => {
    if (!text) return "";
    let out = text;
    for (const pat of THOUGHT_NOISE_PATTERNS) {
        out = out.replace(pat, "");
    }
    return out
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
};

const BrainIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M12 5v13" />
    </svg>
);

// ── Operator Task Graph (Vertical DAG) ─────────────────────────────────────────
const OperatorTaskGraph = ({ planSteps, planTitle }: { planSteps: AgentTimelineProps['planSteps'], planTitle?: string | null }) => {
    if (!planSteps || planSteps.length === 0) return null;

    return (
        <div style={{ marginBottom: 24, marginTop: 8 }}>
            <div style={{
                padding: "16px 20px",
                borderRadius: 16,
                ...galliumSurface,
                background: 'var(--color-bg-surface)',
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: 'var(--color-text-primary)', color: 'var(--color-bg-surface)',
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 3v18" />
                        </svg>
                    </div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, letterSpacing: "-0.01em" }}>
                        {planTitle || "Operator Objective"}
                    </h3>
                </div>

                <div style={{ position: "relative", paddingLeft: 12 }}>
                    {/* Vertical connecting line */}
                    <div style={{
                        position: "absolute",
                        top: 12, bottom: 12, left: 20,
                        borderLeft: "2px dashed var(--color-border)",
                        zIndex: 0
                    }} />

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {planSteps.map((step, idx) => {
                            const isDone = step.status === "completed";
                            const isActive = step.status === "in_progress" || step.status === "in-progress";
                            const isFailed = step.status === "failed";
                            const isPending = !isDone && !isActive && !isFailed;

                            const statusColor = isDone ? 'var(--color-border)' : isActive ? "#3b82f6" : isFailed ? "#ef4444" : 'var(--color-border)';
                            const bgColor = isDone ? 'var(--color-bg-subtle)' : isActive ? 'var(--color-bg-hover)' : isFailed ? 'var(--color-error-dim)' : 'var(--color-bg-subtle)';

                            return (
                                <motion.div
                                    key={step.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    style={{
                                        position: "relative",
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 16,
                                        zIndex: 1
                                    }}
                                >
                                    {/* Node Point */}
                                    <div style={{
                                        marginTop: 2,
                                        width: 18, height: 18,
                                        borderRadius: "50%",
                                        background: bgColor,
                                        border: `1.5px solid ${statusColor}`,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0,
                                        boxShadow: isActive ? `0 0 0 4px rgba(59, 130, 246, 0.15)` : 'none'
                                    }}>
                                        {isDone && <CheckIcon width={12} height={12} style={{ color: 'var(--color-text-secondary)', strokeWidth: 3 }} />}
                                        {isActive && (
                                            <motion.div
                                                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                                                transition={{ duration: 1.5, repeat: Infinity }}
                                                style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}
                                            />
                                        )}
                                        {isFailed && (
                                            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                                <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke={statusColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        )}
                                        {isPending && <span style={{ width: 4, height: 4, borderRadius: "50%", background: statusColor }} />}
                                    </div>

                                    {/* Task Card */}
                                    <div style={{
                                        flex: 1,
                                        padding: "10px 14px",
                                        background: 'var(--color-bg-surface)',
                                        borderRadius: 12,
                                        border: "1px solid var(--color-border)",
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                                        opacity: isPending ? 0.7 : 1,
                                        transition: "all 0.2s"
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                {step.title || `Task ${idx + 1}`}
                                            </span>
                                            {step.tool && (
                                                <span style={{
                                                    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                                                    color: 'var(--color-text-tertiary)', background: 'var(--color-bg-subtle)',
                                                    padding: "2px 6px", borderRadius: 4, letterSpacing: "0.02em"
                                                }}>
                                                    {step.tool.replace(/_/g, " ")}
                                                </span>
                                            )}
                                        </div>
                                        {step.description && (
                                            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                                                {step.description}
                                            </div>
                                        )}

                                        {/* Show Dependencies if they exist and aren't strictly linear to the previous node */}
                                        {step.dependencies && step.dependencies.length > 0 && (
                                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginRight: 4 }}>Depends on:</span>
                                                {step.dependencies.map(dep => (
                                                    <span key={dep} style={{ fontSize: 10, color: 'var(--color-text-secondary)', background: 'var(--color-bg-subtle)', padding: "1px 6px", borderRadius: 4 }}>
                                                        {dep.substring(0, 8)}...
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Main AgentTimeline ─────────────────────────────────────────────────────────
export const AgentTimeline = React.memo(({
    toolCalls = [],
    thought,
    isLive,
    missionTimeline,
    generatedTitle,
    onPillClick,
    subAgentProgress,
    debateData,
    isDebating,
    debateId,
    onSkipDebate,
    planSteps,
    planTitle,
}: AgentTimelineProps) => {
    const { theme } = useTheme();
    // Elapsed time
    const startTime = useRef(new Date());
    const [elapsed, setElapsed] = useState("0:00");
    const [reasoningOpen, setReasoningOpen] = useState(!!isLive);

    useEffect(() => {
        if (isLive && thought) {
            setReasoningOpen(true);
        }
    }, [isLive, thought]);

    useEffect(() => {
        if (!isLive) return;
        const iv = setInterval(() => {
            const diff = Math.floor((Date.now() - startTime.current.getTime()) / 1000);
            setElapsed(`${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, "0")}`);
        }, 1000);
        return () => clearInterval(iv);
    }, [isLive]);

    const narrative = useMemo(() => cleanThought(thought || ""), [thought]);

    const visibleSteps = useMemo(() => {
        const hiddenNames = [
            "analyzing intent", "decomposer", "planner", "brain",
            "web explorer", "data analyst", "coding specialist",
            "computer use", "execute tools", "multi tool orchestrator",
        ];
        return (missionTimeline?.steps || []).filter(
            s => !hiddenNames.includes(s.name.toLowerCase())
        );
    }, [missionTimeline]);

    // Associate tool calls to steps
    const toolsByStep = useMemo((): Map<string, ToolCallDisplay[]> => {
        const map = new Map<string, ToolCallDisplay[]>();
        const visible = toolCalls;
        if (!visibleSteps.length) return map;

        const hasMapping = visibleSteps.some(s => s.toolCalls && s.toolCalls.length > 0);
        if (hasMapping) {
            for (const step of visibleSteps) {
                const stepTools = step.toolCalls || [];
                const matched = visible.filter(tc => {
                    const name = (tc.toolName || "").toLowerCase();
                    return stepTools.some(st => {
                        const sName = st.toLowerCase();
                        return name.includes(sName) || sName.includes(name);
                    });
                });
                if (matched.length) map.set(step.id, matched);
            }
        }

        const assigned = new Set(Array.from(map.values()).flat().map(t => t.id));
        const unmatched = visible.filter(tc => !assigned.has(tc.id));
        if (unmatched.length) {
            const active =
                visibleSteps.find(s => s.status === "in-progress") ||
                [...visibleSteps].reverse().find(s => s.status === "completed");
            if (active) {
                map.set(active.id, [...(map.get(active.id) || []), ...unmatched]);
            }
        }
        return map;
    }, [toolCalls, visibleSteps]);

    // Orphan tool calls when no steps exist
    const orphanTools = useMemo(
        () =>
            visibleSteps.length > 0
                ? []
                : toolCalls,
        [toolCalls, visibleSteps]
    );

    // Group orphan tools by taskName
    const groupedOrphans = useMemo(() => {
        const groups = new Map<string, ToolCallDisplay[]>();
        for (const tc of orphanTools) {
            const tName = (tc.args?.taskName as string) || "General Execution";
            if (!groups.has(tName)) groups.set(tName, []);
            groups.get(tName)!.push(tc);
        }
        return Array.from(groups.entries());
    }, [orphanTools]);

    const hasAnything = visibleSteps.length > 0 || orphanTools.length > 0 || narrative || isLive;
    if (!hasAnything) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{ paddingBottom: 4 }}
        >
            {/* ── Header ────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{
                    width: 30, height: 30, borderRadius: 8,

                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                    <img
                        src="/images/logos/everfern-withoutbg.png"
                        alt="EverFern"
                        width={40} height={40}
                        style={{ 
                            objectFit: "contain",
                            filter: "none"
                        }}
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text-secondary)", letterSpacing: "-0.02em" }}>
                    {generatedTitle || "EverFern"}
                </span>

                {isLive && (
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: 'var(--color-text-tertiary)', fontFamily: "monospace" }}>
                        {elapsed}
                    </span>
                )}
            </div>

            {/* ── Debate Progress ── */}
            {(isDebating || debateData) && (
                <div style={{ margin: "0 0 16px 0" }}>
                    <InlineDebateProgress
                        debate={debateData}
                        isDebating={!!isDebating}
                        debateId={debateId}
                        onSkipDebate={onSkipDebate}
                    />
                </div>
            )}

            {/* ── Operator Task Graph ── */}
            <OperatorTaskGraph planSteps={planSteps} planTitle={planTitle} />

            {/* ── Narrative / overview (Reasoning Block) ── */}
            {narrative && (
                <div style={{ margin: "0 0 16px 34px" }}>
                    <button
                        onClick={() => setReasoningOpen(o => !o)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 0',
                            color: 'var(--color-text-tertiary)',
                            fontSize: 12.5,
                            fontWeight: 500,
                            outline: 'none',
                            userSelect: 'none',
                        }}
                    >
                        <BrainIcon />
                        <span>{isLive ? "Thinking Process" : "Thought Process"}</span>
                        <motion.span
                            animate={{ rotate: reasoningOpen ? 180 : 0 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                            style={{ display: 'flex', marginLeft: 2 }}
                        >
                            <ChevronDownIcon style={{ width: 11, height: 11 }} />
                        </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                        {reasoningOpen && (
                            <motion.div
                                key="reasoning-content"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                                style={{ overflow: 'hidden' }}
                            >
                                <div style={{
                                    borderLeft: '1.5px solid var(--color-border)',
                                    paddingLeft: 14,
                                    marginLeft: 6,
                                    marginTop: 6,
                                    marginBottom: 6,
                                    fontSize: 12.5,
                                    lineHeight: 1.7,
                                    color: 'var(--color-text-tertiary)',
                                    fontStyle: 'italic',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}>
                                    {narrative}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* ── Mission Steps ─────────────────────────── */}
            {visibleSteps.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                    {visibleSteps.map((step, idx) => (
                        <MissionStepRow
                            key={step.id || `step-${idx}`}
                            step={step}
                            toolCalls={toolsByStep.get(step.id) || []}
                            isLive={!!isLive}
                            defaultOpen={step.status === "in-progress" || step.status === "completed"}
                            onPillClick={onPillClick}
                            subAgentProgress={subAgentProgress}
                            isLast={idx === visibleSteps.length - 1}
                        />
                    ))}
                </div>
            )}

            {/* ── Orphan tool calls (grouped by taskName) ─────── */}
            {groupedOrphans.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
                    {groupedOrphans.map(([taskName, toolsInTask], idx) => (
                        <TaskGroupRow
                            key={taskName}
                            taskName={taskName}
                            toolCalls={toolsInTask}
                            onPillClick={onPillClick}
                            subAgentProgress={subAgentProgress}
                            isLast={idx === groupedOrphans.length - 1}
                        />
                    ))}
                </div>
            )}
        </motion.div>
    );
});

export default AgentTimeline;
