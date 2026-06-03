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
} from "@heroicons/react/24/outline";

import type { SubAgentProgressEvent } from "./types";
import type { MissionTimeline as MissionTimelineType, MissionStep } from "./MissionTimeline";
import { ReasoningBlock } from "./ReasoningComponents";

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
    planSteps?: Array<{ id: string; description: string; tool?: string; status?: "pending" | "in-progress" | "completed" | "failed" }> | null;
    planTitle?: string | null;
    generatedTitle?: string;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    timelineBranches?: Map<string, any>;
    debateData?: any;
    isDebating?: boolean;
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

    if (n.includes("search") || n.includes("find") || n.includes("query"))
        return { icon: <MagnifyingGlassIcon style={s} />, shape: "circle" };

    if (n.includes("browse") || n.includes("visit") || n.includes("web") || n.includes("navis") || n.includes("url"))
        return { icon: <GlobeAltIcon style={s} />, shape: "square" };

    if (n.includes("bash") || n.includes("command") || n.includes("terminal") || n.includes("shell") || n.includes("exec"))
        return { icon: <CommandLineIcon style={s} />, shape: "square" };

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

    if (n.includes("image") || n.includes("screenshot") || n.includes("photo"))
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
                width: 20, height: 20, borderRadius: "50%",
                background: "#e8f5e9", border: "1px solid #c8e6c9",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke="#43a047" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    }
    if (status === "in-progress") {
        return (
            <div style={{ width: 20, height: 20, flexShrink: 0, position: "relative" }}>
                <motion.div
                    style={{
                        width: 20, height: 20, borderRadius: "50%",
                        border: "2px solid #e0e0e0",
                        borderTopColor: "#111",
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
                width: 20, height: 20, borderRadius: "50%",
                background: "#fef2f2", border: "1px solid #fecaca",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
                <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>✕</span>
            </div>
        );
    }
    return (
        <div style={{
            width: 20, height: 20, borderRadius: "50%",
            border: "1.5px solid #d4d4d4",
            background: "#fafafa", flexShrink: 0,
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

// ── Sub-Agent Progress Timeline ──────────────────────────────────────────────────
const SubAgentProgressTimeline = ({
    toolCallId,
    events,
}: {
    toolCallId: string;
    events: SubAgentProgressEvent[];
}) => {
    if (!events || events.length === 0) return null;

    return (
        <div style={{
            marginLeft: 32,
            marginTop: 4,
            marginBottom: 8,
            borderLeft: "1px dashed rgba(0,0,0,0.12)",
            paddingLeft: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
        }}>
            {events.map((event, idx) => {
                const isStep = event.type === 'step';
                const isAction = event.type === 'action';
                const isReasoning = event.type === 'reasoning';
                const isScreenshot = event.type === 'screenshot';
                const isComplete = event.type === 'complete';
                const isAbort = event.type === 'abort';

                let iconColor = "#9ca3af";
                let text = "";

                if (isStep) {
                    iconColor = "#3b82f6";
                    text = event.content || `Step ${event.stepNumber || idx + 1}`;
                    if (event.stepNumber && event.totalSteps) {
                        text = `Step ${event.stepNumber}/${event.totalSteps}: ${event.content || ''}`;
                    }
                } else if (isAction) {
                    iconColor = "#f59e0b";
                    text = event.action?.description || `Action: ${event.action?.type || 'execute'}`;
                } else if (isReasoning) {
                    iconColor = "#8b5cf6";
                    text = event.content || "Thinking...";
                } else if (isScreenshot) {
                    iconColor = "#10b981";
                    text = "Captured screenshot";
                } else if (isComplete) {
                    iconColor = "#22c55e";
                    text = "Sub-agent execution complete";
                } else if (isAbort) {
                    iconColor = "#ef4444";
                    text = event.content || "Sub-agent aborted";
                }

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
                        {isAction || isStep ? (
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
        if (tc.args?.query) return String(tc.args.query);
        if (tc.args?.url) return String(tc.args.url);
        if (tc.args?.url_to_visit) return String(tc.args.url_to_visit);
        if (tc.args?.command) return String(tc.args.command).slice(0, 80);
        if (tc.args?.path) return String(tc.args.path);
        if (tc.args?.content) return String(tc.args.content).slice(0, 60) + "…";
        return label;
    })();

    // Narrative caption shown above the pill (agent reasoning before the tool call)
    const narrativeCaption = (() => {
        if (!tc.description) return null;
        const trimmed = tc.description.trim();
        // Suppress JSON blobs and raw tool_call XML
        if (trimmed.startsWith("{") && (trimmed.includes('"messages"') || trimmed.includes('"tool_calls"'))) return null;
        if (trimmed.startsWith("<tool_call>")) return null;
        // Don't repeat what's already in the pill label
        if (trimmed === pillLabel) return null;
        // Truncate to one short line
        const maxLen = 120;
        return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + "…" : trimmed;
    })();

    // using globally defined galliumSurface

    return (
        <motion.div
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ marginBottom: 4 }}
        >
            {/* Narrative caption above the pill */}
            {narrativeCaption && (
                <div style={{
                    fontSize: 11,
                    color: "#9ca3af",
                    fontStyle: "italic",
                    lineHeight: 1.4,
                    marginBottom: 4,
                    paddingLeft: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                }}>
                    {narrativeCaption}
                </div>
            )}

            {/* The pill itself */}
            <div
                onClick={onClick}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 14px 7px 8px",
                    borderRadius: 14,
                    cursor: onClick ? "pointer" : "default",
                    fontSize: 12.5,
                    color: isDone ? "#aaa" : "#333",
                    lineHeight: 1.4,
                    position: "relative",
                    overflow: "hidden",
                    ...galliumSurface,
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

// ── Mission Step Row (accordion) ───────────────────────────────────────────────
const MissionStepRow = ({
    step,
    toolCalls,
    isLive,
    defaultOpen,
    onPillClick,
    subAgentProgress,
}: {
    step: MissionStep;
    toolCalls: ToolCallDisplay[];
    isLive: boolean;
    defaultOpen: boolean;
    onPillClick?: (tc: ToolCallDisplay) => void;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const isDone = step.status === "completed";
    const isActive = step.status === "in-progress";
    const isPending = step.status === "pending" || step.status === "skipped";

    useEffect(() => { if (isActive) setOpen(true); }, [isActive]);

    const hasContent = toolCalls.length > 0 || !!step.description || !!step.result;

    const rawName = step.name.charAt(0).toUpperCase() + step.name.slice(1);
    const displayName = rawName.length > 45 ? rawName.slice(0, 42) + "..." : rawName;

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: isPending ? 0.35 : 1, y: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginBottom: 4 }}
        >
            <div
                onClick={() => hasContent && setOpen(o => !o)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 0",
                    cursor: hasContent ? "pointer" : "default",
                    userSelect: "none",
                }}
            >
                <StepStatusIcon status={step.status} />
                <span style={{
                    fontSize: 13, fontWeight: isActive ? 600 : 500,
                    color: isDone ? "#9ca3af" : isActive ? "#111827" : "#9ca3af",
                    flex: 1, letterSpacing: "-0.01em",
                }}>
                    {displayName}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {step.duration != null && step.duration > 0 && (
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
                            borderLeft: "1px solid #f3f4f6",
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
                                        {toolCalls.slice(-50).map((tc, idx) => {
                                            const events = tc.subAgentProgress || subAgentProgress?.get(tc.id) || [];
                                            return (
                                                <React.Fragment key={tc.id || `tc-${idx}`}>
                                                    <ToolPill
                                                        tc={tc}
                                                        onClick={onPillClick ? () => onPillClick(tc) : undefined}
                                                    />
                                                    <SubAgentProgressTimeline
                                                        toolCallId={tc.id}
                                                        events={events}
                                                    />
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>

                                    {isActive && toolCalls.some(tc => tc.status === "running") && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                            <motion.div
                                                style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981" }}
                                                animate={{ opacity: [1, 0.3, 1] }}
                                                transition={{ repeat: Infinity, duration: 1.5 }}
                                            />
                                            <span style={{ fontSize: 11, fontWeight: 500, color: "#10b981" }}>
                                                Executing tools...
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {step.result && isDone && (
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

// ── Main AgentTimeline ─────────────────────────────────────────────────────────
export const AgentTimeline = ({
    toolCalls = [],
    thought,
    isLive,
    missionTimeline,
    generatedTitle,
    onPillClick,
    subAgentProgress,
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
        const visible = toolCalls.filter(
            tc => !["create_plan", "update_plan_step"].includes(tc.toolName || "")
        );
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
                : toolCalls.filter(tc => !["create_plan", "update_plan_step"].includes(tc.toolName || "")),
        [toolCalls, visibleSteps]
    );

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
                        />
                    ))}
                </div>
            )}

            {/* ── Orphan tool calls (no steps yet) ─────── */}
            {orphanTools.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                    {orphanTools.length > 50 && (
                        <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingBottom: 4 }}>
                            ... {orphanTools.length - 50} older actions hidden for performance
                        </div>
                    )}
                    {orphanTools.slice(-50).map((tc, idx) => {
                        const events = tc.subAgentProgress || subAgentProgress?.get(tc.id) || [];
                        return (
                            <React.Fragment key={tc.id || `orphan-${idx}`}>
                                <ToolPill
                                    tc={tc}
                                    onClick={onPillClick ? () => onPillClick(tc) : undefined}
                                />
                                <SubAgentProgressTimeline
                                    toolCallId={tc.id}
                                    events={events}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </motion.div>
    );
};

export default AgentTimeline;
