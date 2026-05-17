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
    CodeBracketIcon,
    PhotoIcon,
    CpuChipIcon,
    PencilSquareIcon,
    CubeTransparentIcon,
    WrenchScrewdriverIcon,
    ClockIcon,
} from "@heroicons/react/24/outline";

import type { SubAgentProgressEvent } from "@/app/chat/types";
import type { MissionTimeline as MissionTimelineType, MissionStep } from "./MissionTimeline";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ToolCallDisplay {
    id: string;
    toolName: string;
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
}

interface AgentTimelineProps {
    toolCalls: ToolCallDisplay[];
    thought?: string;
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

// ── Internal step names to hide (orchestration internals) ──────────────────────
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
        name.startsWith("step:") && HIDDEN_STEP_NAMES.has(name.replace("step:", ""))
    );
};

// ── Tool Icon ──────────────────────────────────────────────────────────────────
const getToolIcon = (toolName: string, size = 13): React.ReactNode => {
    const n = toolName.toLowerCase();
    const s = { width: size, height: size, flexShrink: 0 as const };
    if (n.includes("search") || n.includes("find") || n.includes("query")) return <MagnifyingGlassIcon style={s} />;
    if (n.includes("browse") || n.includes("visit") || n.includes("web") || n.includes("navis") || n.includes("url")) return <GlobeAltIcon style={s} />;
    if (n.includes("bash") || n.includes("command") || n.includes("terminal") || n.includes("shell") || n.includes("exec")) return <CommandLineIcon style={s} />;
    if (n.includes("write") || n.includes("create") || n.includes("save") || n.includes("artifact")) return <DocumentTextIcon style={s} />;
    if (n.includes("read") || n.includes("open") || n.includes("load")) return <FolderOpenIcon style={s} />;
    if (n.includes("edit") || n.includes("update") || n.includes("modify") || n.includes("patch")) return <PencilSquareIcon style={s} />;
    if (n.includes("code") || n.includes("python") || n.includes("js")) return <CodeBracketIcon style={s} />;
    if (n.includes("image") || n.includes("screenshot") || n.includes("photo")) return <PhotoIcon style={s} />;
    if (n.includes("computer") || n.includes("mouse") || n.includes("click")) return <CpuChipIcon style={s} />;
    if (n.includes("spawn") || n.includes("agent") || n.includes("sub")) return <CubeTransparentIcon style={s} />;
    return <WrenchScrewdriverIcon style={s} />;
};

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
                        borderTopColor: "#9e9e9e",
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

// ── Tool Pill ──────────────────────────────────────────────────────────────────
const ToolPill = ({ tc, onClick }: { tc: ToolCallDisplay; onClick?: () => void }) => {
    const isRunning = tc.status === "running";
    const label = tc.displayName || tc.label || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Tool");

    const desc = (() => {
        if (tc.args?.query) return String(tc.args.query);
        if (tc.args?.url) return String(tc.args.url);
        if (tc.args?.url_to_visit) return String(tc.args.url_to_visit);
        if (tc.args?.command) return String(tc.args.command).slice(0, 80);
        if (tc.args?.path) return String(tc.args.path);
        if (tc.args?.content) return String(tc.args.content).slice(0, 60) + "…";
        if (tc.description) return tc.description;
        return label;
    })();

    return (
        <motion.div
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                background: "#f5f5f5",
                border: "1px solid #e8e8e8",
                borderRadius: 7,
                cursor: onClick ? "pointer" : "default",
                fontSize: 12.5,
                color: "#444",
                lineHeight: 1.4,
                marginBottom: 4,
                position: "relative",
                overflow: "hidden",
            }}
        >
            <span style={{ color: "#888", flexShrink: 0 }}>
                {getToolIcon(tc.toolName)}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {desc}
            </span>
            {isRunning && (
                <motion.span
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }}
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                />
            )}
            {isRunning && (
                <motion.div
                    style={{
                        position: "absolute", inset: 0,
                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
                        pointerEvents: "none",
                    }}
                    animate={{ x: ["-100%", "100%"] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
                />
            )}
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
}: {
    step: MissionStep;
    toolCalls: ToolCallDisplay[];
    isLive: boolean;
    defaultOpen: boolean;
    onPillClick?: (tc: ToolCallDisplay) => void;
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const isDone = step.status === "completed";
    const isActive = step.status === "in-progress";
    const isPending = step.status === "pending" || step.status === "skipped";

    useEffect(() => { if (isActive) setOpen(true); }, [isActive]);

    const hasContent = toolCalls.length > 0 || !!step.description || !!step.result;

    // Premium Truncation + Sentence Case for titles
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
                    textDecoration: isDone ? "none" : "none",
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
                            borderLeft: "1px solid #f3f4f6"
                        }}>
                            {step.description && (
                                <p style={{
                                    fontSize: 12, color: "#6b7280", lineHeight: 1.6,
                                    margin: "4px 0 10px", fontWeight: 400
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
                                        {toolCalls.map((tc, idx) => (
                                            <ToolPill
                                                key={tc.id || `tc-${idx}`}
                                                tc={tc}
                                                onClick={onPillClick ? () => onPillClick(tc) : undefined}
                                            />
                                        ))}
                                    </div>

                                    {isActive && toolCalls.some(tc => tc.status === 'running') && (
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
                                    border: "1px solid #f3f4f6"
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
    /\{[\s\n]*"role"[\s\S]*?\}/gi
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

// ── Main AgentTimeline ────────────────────────────────────────────────────────
export const AgentTimeline = ({
    toolCalls,
    thought,
    isLive,
    missionTimeline,
    generatedTitle,
    onPillClick,
}: AgentTimelineProps) => {
    // Elapsed time
    const startTime = useRef(new Date());
    const [elapsed, setElapsed] = useState("0:00");

    useEffect(() => {
        if (!isLive) return;
        const iv = setInterval(() => {
            const diff = Math.floor((Date.now() - startTime.current.getTime()) / 1000);
            setElapsed(`${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, "0")}`);
        }, 1000);
        return () => clearInterval(iv);
    }, [isLive]);

    // Clean narrative
    const narrative = useMemo(() => cleanThought(thought || ""), [thought]);

    // Visible user-facing steps (filter internals)
    const visibleSteps = useMemo(
        () => {
            const hiddenNames = [
                "analyzing intent", "decomposer", "planner", "brain",
                "web explorer", "data analyst", "coding specialist",
                "computer use", "execute tools", "multi tool orchestrator"
            ];
            return (missionTimeline?.steps || []).filter(s => !hiddenNames.includes(s.name.toLowerCase()));
        },
        [missionTimeline]
    );

    const hasMissionSteps = visibleSteps.length > 0;

    // Associate tool calls to steps
    const toolsByStep = useMemo((): Map<string, ToolCallDisplay[]> => {
        const map = new Map<string, ToolCallDisplay[]>();
        const visible = toolCalls.filter(
            tc => !["create_plan", "update_plan_step"].includes(tc.toolName)
        );
        if (!visibleSteps.length) return map;

        const hasMapping = visibleSteps.some(s => s.toolCalls && s.toolCalls.length > 0);
        if (hasMapping) {
            for (const step of visibleSteps) {
                const stepTools = step.toolCalls || [];
                const matched = visible.filter(tc => {
                    const name = tc.toolName.toLowerCase();
                    return stepTools.some(st => {
                        const sName = st.toLowerCase();
                        return name.includes(sName) || sName.includes(name);
                    });
                });
                if (matched.length) map.set(step.id, matched);
            }
        }

        // Unmatched / no mapping → put under active step
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
        () => visibleSteps.length > 0 ? [] :
            toolCalls.filter(tc => !["create_plan", "update_plan_step"].includes(tc.toolName)),
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
                    width: 26, height: 26, borderRadius: 8,
                    background: "#f5f4f0", border: "1px solid #e8e6d9",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                    <img
                        src="/images/logos/black-logo-withoutbg.png"
                        alt="EverFern"
                        width={25} height={25}
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

            {/* ── Narrative / overview ──────────────────── */}
            {narrative && (
                <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        fontSize: 13.5, lineHeight: 1.65, color: "#374151",
                        margin: "0 0 16px", fontWeight: 400,
                    }}
                >
                    {narrative}
                </motion.p>
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
                        />
                    ))}
                </div>
            )}

            {/* ── Orphan tool calls (no steps yet) ─────── */}
            {orphanTools.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                    {orphanTools.map((tc, idx) => (
                        <ToolPill
                            key={tc.id || `orphan-${idx}`}
                            tc={tc}
                            onClick={onPillClick ? () => onPillClick(tc) : undefined}
                        />
                    ))}
                </div>
            )}

        </motion.div>
    );
};

export default AgentTimeline;
