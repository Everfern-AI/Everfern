"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
            background: "#d3d3d0",
            boxShadow: [
                "inset 0 1px 0 rgba(255,255,255,0.70)",
                "inset 0 -1px 0 rgba(0,0,0,0.08)",
                "inset 1px 0 rgba(255,255,255,0.45)",
                "inset -1px 0 rgba(0,0,0,0.04)",
            ].join(", "),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#555",
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
                background: "#f4f4f5", border: "1.5px solid #d4d4d8",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                position: "relative", zIndex: 1,
            }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke="#71717a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    }
    if (status === "in-progress") {
        return (
            <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, position: "relative", zIndex: 1
            }}>
                <motion.div
                    style={{
                        width: 16, height: 16, borderRadius: "50%",
                        border: "2px solid #e4e4e7",
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
                background: "#fef2f2", border: "1.5px solid #fecaca",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                position: "relative", zIndex: 1,
            }}>
                <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 700, lineHeight: 1 }}>✕</span>
            </div>
        );
    }
    return (
        <div style={{
            width: 16, height: 16, borderRadius: "50%",
            border: "1.5px solid #e4e4e7",
            background: "#fafafa", flexShrink: 0,
            position: "relative", zIndex: 1,
        }} />
    );
};

// ── Gallium surface: layered inset shadows simulate liquid-metal light physics
const galliumSurface = {
    background: "#ececea",
    boxShadow: [
        "inset 0 1px 0 rgba(255,255,255,0.72)",
        "inset 0 -1px 0 rgba(0,0,0,0.06)",
        "inset 1px 0 rgba(255,255,255,0.50)",
        "inset -1px 0 rgba(0,0,0,0.04)",
        "0 1px 3px rgba(0,0,0,0.07)",
    ].join(", "),
    border: "0.5px solid rgba(0,0,0,0.10)",
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
    return "#9ca3af";
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
            borderLeft: nested ? "1.5px solid rgba(0,0,0,0.10)" : "1px dashed rgba(0,0,0,0.12)",
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
                            color: "#555",
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
                                color: isComplete ? "#15803d" : isAbort ? "#b91c1c" : "#4b5563",
                                lineHeight: 1.35,
                                background: "#fbfbfa",
                                border: "1px solid rgba(0,0,0,0.07)",
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
                                color: "#333",
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
                                        color: (isComplete) ? "#15803d" : (isAbort) ? "#b91c1c" : "#444"
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
                                border: "1px solid rgba(0,0,0,0.08)",
                                maxWidth: 240,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                            }}>
                                <img
                                    src={`data:image/png;base64,${event.screenshot.base64}`}
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
    const label = isSkill
        ? `Skill - ${skillName || tc.label || tc.toolName?.replace(/_/g, " ") || "Tool"}`
        : (tc.displayName || tc.label || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Tool"));
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
                    color: isDone ? "#aaa" : "#333",
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
    const commandValue = argText(args.command, args.cmd, args.script, args.input);
    const queryValue = argText(args.keyword, args.query, args.pattern, args.search, args.url, args.url_to_visit);
    const label = tc.displayName || tc.label || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Tool");

    if (name === "write" || name.includes("write_file") || name.includes("write_to_file")) {
        return {
            verb: "Creating file",
            detail: pathValue || "file",
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

    if (name === "terminal_execute" || name === "executepwsh" || name === "execute_pwsh") {
        return {
            verb: "Running command",
            detail: commandValue || "terminal",
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
                color: "#4b5563",
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
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#374151", flexShrink: 0 }}>
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
                    color: "#6b7280",
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
    if (name === "edit" || name.includes("replace") || name.includes("str_replace")) {
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
                    color: "#9b9b9b",
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
                        color: "#8f8f8f",
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
                            color: "#8f96a3",
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
                    borderLeft: "1.5px dashed #d4d4d8",
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
                    color: isDone ? "#9ca3af" : isActive ? "#111827" : "#9ca3af",
                    flex: 1, letterSpacing: "-0.01em",
                }}>
                    {displayName}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {step.duration != null && step.duration > 0 && !hasActiveToolsAfterCompletion && (
                        <span style={{ fontSize: 10.5, color: "#d1d5db", fontWeight: 500 }}>
                            {(step.duration / 1000).toFixed(1)}s
                        </span>
                    )}
                    {hasContent && (
                        <span style={{ color: "#d1d5db", display: "flex" }}>
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
                                    fontSize: 12, color: "#6b7280", lineHeight: 1.6,
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
                                            <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingBottom: 4 }}>
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
                                    fontSize: 12, color: "#9ca3af", lineHeight: 1.5,
                                    marginTop: 8, padding: "6px 8px", background: "#f9fafb", borderRadius: 6,
                                    border: "1px solid #f3f4f6",
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
                    <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingBottom: 4 }}>
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
                    borderLeft: "1.5px dashed #d4d4d8",
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
                    color: isDone ? "#9ca3af" : isActive ? "#111827" : "#6b7280",
                    flex: 1, letterSpacing: "-0.01em",
                }}>
                    {displayName}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                        fontSize: 10.5, color: "#d1d5db", fontWeight: 500,
                        background: "#f4f4f5", padding: "1px 6px", borderRadius: 4,
                    }}>
                        {toolCalls.length}
                    </span>
                    <span style={{ color: "#d1d5db", display: "flex" }}>
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
                                    <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingBottom: 4 }}>
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
                background: "linear-gradient(180deg, #fafafa 0%, #f4f4f4 100%)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: "#111", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 3v18" />
                        </svg>
                    </div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111", margin: 0, letterSpacing: "-0.01em" }}>
                        {planTitle || "Operator Objective"}
                    </h3>
                </div>

                <div style={{ position: "relative", paddingLeft: 12 }}>
                    {/* Vertical connecting line */}
                    <div style={{
                        position: "absolute",
                        top: 12, bottom: 12, left: 20,
                        borderLeft: "2px dashed #d4d4d8",
                        zIndex: 0
                    }} />

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {planSteps.map((step, idx) => {
                            const isDone = step.status === "completed";
                            const isActive = step.status === "in_progress" || step.status === "in-progress";
                            const isFailed = step.status === "failed";
                            const isPending = !isDone && !isActive && !isFailed;

                            const statusColor = isDone ? "#d4d4d8" : isActive ? "#3b82f6" : isFailed ? "#ef4444" : "#e4e4e7";
                            const bgColor = isDone ? "#f4f4f5" : isActive ? "#eff6ff" : isFailed ? "#fef2f2" : "#f9fafb";

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
                                        {isDone && <CheckIcon width={12} height={12} style={{ color: "#71717a", strokeWidth: 3 }} />}
                                        {isActive && (
                                            <motion.div
                                                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                                                transition={{ duration: 1.5, repeat: Infinity }}
                                                style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}
                                            />
                                        )}
                                        {isFailed && <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, lineHeight: 1 }}>✕</span>}
                                        {isPending && <span style={{ width: 4, height: 4, borderRadius: "50%", background: statusColor }} />}
                                    </div>

                                    {/* Task Card */}
                                    <div style={{
                                        flex: 1,
                                        padding: "10px 14px",
                                        background: "#fff",
                                        borderRadius: 12,
                                        border: "1px solid rgba(0,0,0,0.06)",
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                                        opacity: isPending ? 0.7 : 1,
                                        transition: "all 0.2s"
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
                                                {step.title || `Task ${idx + 1}`}
                                            </span>
                                            {step.tool && (
                                                <span style={{
                                                    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                                                    color: "#6b7280", background: "#f3f4f6",
                                                    padding: "2px 6px", borderRadius: 4, letterSpacing: "0.02em"
                                                }}>
                                                    {step.tool.replace(/_/g, " ")}
                                                </span>
                                            )}
                                        </div>
                                        {step.description && (
                                            <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5 }}>
                                                {step.description}
                                            </div>
                                        )}

                                        {/* Show Dependencies if they exist and aren't strictly linear to the previous node */}
                                        {step.dependencies && step.dependencies.length > 0 && (
                                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                <span style={{ fontSize: 10, color: "#9ca3af", marginRight: 4 }}>Depends on:</span>
                                                {step.dependencies.map(dep => (
                                                    <span key={dep} style={{ fontSize: 10, color: "#4b5563", background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>
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
export const AgentTimeline = ({
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
                        src="/images/logos/black-logo-withoutbg.png"
                        alt="EverFern"
                        width={40} height={40}
                        style={{ objectFit: "contain" }}
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111", letterSpacing: "-0.02em" }}>
                    {generatedTitle || "EverFern"}
                </span>

                {isLive && (
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#bbb", fontFamily: "monospace" }}>
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
                            color: '#9ca3af',
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
                                    borderLeft: '1.5px solid #e5e7eb',
                                    paddingLeft: 14,
                                    marginLeft: 6,
                                    marginTop: 6,
                                    marginBottom: 6,
                                    fontSize: 12.5,
                                    lineHeight: 1.7,
                                    color: '#6b7280',
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
};

export default AgentTimeline;
