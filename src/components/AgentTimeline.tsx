"use client";

import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LoadingBreadcrumb } from "@/components/ui/animated-loading-svg-text-shimmer";
import { GlobeAltIcon } from '@heroicons/react/24/outline';

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
    thought?: string; // Individual thought for this step
}

interface AgentTimelineProps {
    toolCalls: ToolCallDisplay[];
    thought?: string;
    isLive?: boolean;
    showOutput?: boolean;
    currentPhase?: "triage" | "planning" | "execution" | "validation" | "completion";
    currentNode?: string;
    planSteps?: Array<{ id: string; description: string; tool?: string }> | null;
    planTitle?: string | null;
    generatedTitle?: string;
    subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
    timelineBranches?: Map<string, TimelineBranch>;
    debateData?: any;
    isDebating?: boolean;
}

// Import SubAgentProgressEvent type
import type { SubAgentProgressEvent } from "@/app/chat/types";
import { InlineDebateProgress } from "@/app/chat/components/InlineDebateProgress";

// ── Timeline Branch Interfaces ───────────────────────────────────────────────
interface TimelineBranch {
    id: string;
    parentId: string;
    parentSessionKey?: string;
    agentType: 'web-explorer' | 'navis' | 'browser-use' | 'computer-use' | 'research' | 'coding-specialist' | 'data-analyst';
    events: SubAgentProgressEvent[];
    status: 'running' | 'completed' | 'failed' | 'aborted';
    startTime: string;
    endTime?: string;
    taskDescription?: string;
    branchLevel: number;
    isCollapsed?: boolean;
    childBranches?: TimelineBranch[];
}

interface TimelineRenderer {
    renderBranch(branch: TimelineBranch): React.ReactNode;
    updateBranch(branchId: string, events: SubAgentProgressEvent[]): void;
    collapseBranch(branchId: string): void;
    expandBranch(branchId: string): void;
}

// ── SearchResult Interfaces ──────────────────────────────────────────────────
interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
    domain?: string;
    breadcrumbs?: string[];
}

interface SearchResultCardProps {
    result: SearchResult;
    index: number;
}

/**
 * Extracts domain from a URL string, removing 'www.' prefix
 * @param url - The URL string to extract domain from
 * @returns The extracted domain without 'www.' prefix, or null if URL is invalid
 */
const extractDomain = (url: string): string | null => {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
};

/**
 * Validates if a string is a valid URL
 * @param url - The URL string to validate
 * @returns True if URL is valid, false otherwise
 */
const isValidUrl = (url: string): boolean => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

// ── SearchResultCard Component ───────────────────────────────────────────────
const SearchResultCard: React.FC<SearchResultCardProps> = ({ result, index }) => {
    const [faviconError, setFaviconError] = useState(false);
    const domain = result.domain || extractDomain(result.url) || 'Unknown';
    const title = result.title || result.url || 'Untitled Result';
    const hasValidUrl = isValidUrl(result.url);

    // Try multiple favicon sources
    const getFaviconSrc = () => {
        if (faviconError) return null;
        // First try Google's favicon service, then fallback to site's own favicon
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    };

    const getFallbackFaviconSrc = () => {
        try {
            const { origin } = new URL(result.url);
            return `${origin}/favicon.ico`;
        } catch {
            return null;
        }
    };

    return (
        <motion.article
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: 0.2,
                delay: index * 0.05,
                ease: "easeOut"
            }}
            whileHover={{
                y: -1,
                transition: { duration: 0.15 }
            }}
            role="article"
            aria-label="Search result"
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '10px 12px',
                borderRadius: 12,
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
                transition: 'all 0.15s ease-out',
                position: 'relative'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#c7d2fe';
                e.currentTarget.style.backgroundColor = '#f5f3ff';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.boxShadow = 'none';
            }}
        >
            {/* Citation Badge */}
            <div style={{
                position: 'absolute',
                top: 6,
                right: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 12,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                fontSize: 9,
                fontWeight: 600,
                color: '#6366f1',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontFamily: "'Matter', sans-serif"
            }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                </svg>
                Source
            </div>

            {hasValidUrl ? (
                <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Visit ${title} at ${domain}`}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        textDecoration: 'none',
                        color: 'inherit'
                    }}
                >
                    <SearchResultContent
                        result={result}
                        domain={domain}
                        title={title}
                        faviconSrc={getFaviconSrc()}
                        fallbackFaviconSrc={getFallbackFaviconSrc()}
                        onFaviconError={() => setFaviconError(true)}
                    />
                </a>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <SearchResultContent
                        result={result}
                        domain={domain}
                        title={title}
                        faviconSrc={getFaviconSrc()}
                        fallbackFaviconSrc={getFallbackFaviconSrc()}
                        onFaviconError={() => setFaviconError(true)}
                    />
                </div>
            )}
        </motion.article>
    );
};

// ── SearchResultContent Component ────────────────────────────────────────────
const SearchResultContent: React.FC<{
    result: SearchResult;
    domain: string;
    title: string;
    faviconSrc: string | null;
    fallbackFaviconSrc: string | null;
    onFaviconError: () => void;
}> = ({ result, domain, title, faviconSrc, fallbackFaviconSrc, onFaviconError }) => {
    const [primaryFaviconError, setPrimaryFaviconError] = useState(false);
    const [fallbackFaviconError, setFallbackFaviconError] = useState(false);

    const handlePrimaryFaviconError = () => {
        setPrimaryFaviconError(true);
        onFaviconError();
    };

    const handleFallbackFaviconError = () => {
        setFallbackFaviconError(true);
    };

    return (
        <>
            {/* Domain Header with Enhanced Favicon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Enhanced Favicon with Fallback */}
                {!primaryFaviconError && faviconSrc ? (
                    <img
                        src={faviconSrc}
                        alt=""
                        width={14}
                        height={14}
                        style={{ borderRadius: 2, flexShrink: 0 }}
                        loading="lazy"
                        onError={handlePrimaryFaviconError}
                    />
                ) : !fallbackFaviconError && fallbackFaviconSrc ? (
                    <img
                        src={fallbackFaviconSrc}
                        alt=""
                        width={14}
                        height={14}
                        style={{ borderRadius: 2, flexShrink: 0 }}
                        loading="lazy"
                        onError={handleFallbackFaviconError}
                    />
                ) : (
                    <GlobeAltIcon
                        width={14}
                        height={14}
                        style={{ flexShrink: 0, color: '#6b7280' }}
                    />
                )}

                <span
                    style={{
                        fontSize: 11,
                        color: '#6b7280',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: "'Matter', sans-serif",
                        letterSpacing: '0.01em'
                    }}
                >
                    {domain}
                </span>
            </div>

            {/* Title Link */}
            <div
                style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#1a56db',
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: "'Matter', sans-serif",
                    letterSpacing: '-0.01em',
                    transition: 'text-decoration 0.15s ease-out'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.textDecoration = 'none';
                }}
            >
                {title}
            </div>

            {/* Snippet */}
            {result.snippet && (
                <div
                    style={{
                        fontSize: 12,
                        color: '#4b5563',
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        fontFamily: "'Matter', sans-serif"
                    }}
                >
                    {result.snippet}
                </div>
            )}

            {/* Metadata Row */}
            {result.publishedDate && (
                <div
                    style={{
                        fontSize: 11,
                        color: '#9ca3af',
                        fontFamily: "'Matter', sans-serif",
                        letterSpacing: '0.01em'
                    }}
                >
                    {result.publishedDate}
                </div>
            )}
        </>
    );
};

// Timeline item types
type TimelineItem =
    | { type: "tool"; data: ToolCallDisplay }
    | { type: "thought"; data: { id: string; content: string; isLive?: boolean } }
    | { type: "plan"; data: { steps: Array<{ id: string; description: string; tool?: string }>; title?: string | null } }
    | { type: "subagent-progress"; data: SubAgentProgressEvent }
    | { type: "timeline-branch"; data: TimelineBranch };

const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

// Tool name → human label
const toolLabel = (toolName?: string, label?: string, displayName?: string): string => {
    if (label) return label;
    if (displayName) return displayName;
    if (!toolName) return "Unknown Tool";
    const map: Record<string, string> = {
        read_file: "Read file",
        write: "Write file",
        write_file: "Write file",
        run_command: "Run command",
        bash: "Run command",
        executePwsh: "Run command",
        web_search: "Web search",
        grep_search: "Search codebase",
        file_search: "Find file",
        list_directory: "List directory",
        get_diagnostics: "Check diagnostics",
        str_replace: "Edit file",
        create_artifact: "Create artifact",
        memory_save: "Save memory",
        memory_search: "Search memory",
        screenshot: "Take screenshot",
        computer_use: "Computer use",
        ask_user: "Ask user",
        planner: "Plan steps",
        subagent: "Spawn subagent",
    };
    return map[toolName] ?? toolName.replace(/_/g, " ");
};

// Status dot with pulse animation
const StatusDot = ({ status, isLive }: { status: ToolCallDisplay["status"]; isLive?: boolean }) => {
    const isRunning = status === "running" || isLive;
    const color = isRunning ? "#6366f1" : status === "error" ? "#ef4444" : "#22c55e";

    return (
        <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
            <div style={{
                width: 10, height: 10, borderRadius: "50%",
                backgroundColor: color,
                border: "2px solid #faf9f7",
                boxShadow: "0 0 0 1px #e8e6d9",
            }} />
        </div>
    );
};

// Thought item - appears as a branch off the main timeline
const ThoughtItem = ({ content, isLive, isLast }: { content: string; isLive?: boolean; isLast: boolean }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    // Clean up backend orchestrator logs for UI display
    const cleanContent = content ? content.replace(/^\s*(?:🤖|🧠|🧭|⚙️|🔍|👨‍💻|📊|🌐|🖥️|💻|✅|⚠️|⚖️|🎬|💭|📝|🔍|🌐)\s*[^:]+:\s*/, '').trim() : '';
    const displayContent = cleanContent.replace(/^(?:🤖|🧠|🧭|⚙️|🔍|👨‍💻|📊|🌐|🖥️|💻|✅|⚠️|⚖️|🎬|💭|📝|🔍|🌐)\s*/, '');

    // Skip empty content
    if (!displayContent) return null;

    return (
        <div style={{ display: "flex", gap: 0, paddingBottom: 0, position: "relative" }}>
            {/* Timeline line */}
            <div style={{
                width: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 0,
            }}>
                {/* Vertical line before dot */}
                <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />

                {/* Status dot */}
                <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                    <div style={{
                        width: 10, height: 10, borderRadius: "50%",
                        backgroundColor: isLive ? "#a855f7" : "#d8b4fe",
                        border: "2px solid #faf9f7",
                        boxShadow: "0 0 0 1px #e8e6d9",
                    }} />
                    {isLive && (
                        <motion.div
                            animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
                            style={{
                                position: "absolute", inset: -2,
                                borderRadius: "50%",
                                backgroundColor: "#a855f7",
                            }}
                        />
                    )}
                </div>

                {/* Vertical line after dot */}
                {!isLast && (
                    <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                <div
                    onClick={() => setIsExpanded(!isExpanded)}
                    style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "2px 0",
                        cursor: "pointer", userSelect: "none"
                    }}
                >
                    <span style={{ fontSize: 13.5, color: isLive ? "#a855f7" : "#d8b4fe" }}>🧠</span>
                    <span style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: isLive ? "#201e24" : "#4a4846",
                        fontFamily: "'Figtree', system-ui, sans-serif",
                        letterSpacing: "-0.01em",
                    }}>
                        {isLive ? "Thinking..." : (displayContent.length > 70 ? displayContent.substring(0, 70) + "..." : displayContent)}
                    </span>

                    {isLive && (
                        <motion.div
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ repeat: Infinity, duration: 1.2 }}
                            style={{ display: "flex", gap: 3, alignItems: "center" }}
                        >
                            {[0, 1, 2].map(i => (
                                <motion.div
                                    key={i}
                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                                    style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: "#a855f7" }}
                                />
                            ))}
                        </motion.div>
                    )}

                    {displayContent && displayContent.length > 70 && (
                        <motion.svg
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.18 }}
                            width={12} height={12} viewBox="0 0 24 24"
                            fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ marginLeft: "auto", flexShrink: 0 }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </motion.svg>
                    )}
                </div>

                <AnimatePresence>
                    {isExpanded && displayContent && displayContent.length > 70 && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            style={{ overflow: "hidden" }}
                        >
                            <div style={{
                                marginTop: 8,
                                padding: "10px 14px",
                                backgroundColor: "#faf9f7",
                                borderRadius: 8,
                                border: "1px solid #e8e6d9",
                                fontSize: 12.5,
                                fontFamily: "'Figtree', system-ui, sans-serif",
                                color: "#6b7280",
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.6,
                                fontStyle: "italic",
                            }}>
                                {displayContent}
                                {isLive && (
                                    <motion.span
                                        animate={{ opacity: [1, 0, 1] }}
                                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                                        style={{
                                            display: "inline-block",
                                            width: 2,
                                            height: "1.2em",
                                            backgroundColor: "#a855f7",
                                            marginLeft: 4,
                                            verticalAlign: "middle",
                                        }}
                                    />
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

// Plan item - appears as a branch off the main timeline
const PlanItem = ({
    steps,
    title,
    isLast
}: {
    steps: Array<{ id: string; description: string; tool?: string }>;
    title?: string | null;
    isLast: boolean;
}) => {
    return (
        <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
            {/* Main timeline line */}
            <div style={{
                width: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
            }}>
                {/* Vertical line before */}
                <div style={{
                    width: 2,
                    height: 12,
                    backgroundColor: "#e8e6d9",
                }} />

                {/* Branch point */}
                <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: "#faf9f7",
                    border: "2px solid #e8e6d9",
                    flexShrink: 0,
                    zIndex: 2,
                }} />

                {/* Vertical line after - extends through entire content */}
                {!isLast && (
                    <div style={{
                        position: "absolute",
                        top: 22,
                        bottom: -20,
                        width: 2,
                        backgroundColor: "#e8e6d9",
                    }} />
                )}

                {/* Branch curve */}
                <svg
                    width="40"
                    height="40"
                    viewBox="0 0 40 40"
                    style={{
                        position: "absolute",
                        left: 9,
                        top: 12,
                        pointerEvents: "none",
                    }}
                >
                    <path
                        d="M 0 0 Q 20 0 20 20 L 20 40"
                        stroke="#e8e6d9"
                        strokeWidth="2"
                        fill="none"
                    />
                </svg>
            </div>

            {/* Plan content */}
            <div style={{ flex: 1, paddingLeft: 32, paddingTop: 8, paddingBottom: 20 }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="#b5b2aa" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                    <span style={{
                        fontSize: 11,
                        color: "#8a8886",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase"
                    }}>
                        {title || "Plan"} · {steps.length} steps
                    </span>
                </div>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    backgroundColor: "#faf9f7",
                    padding: "10px 12px",
                    borderRadius: 8,
                    borderLeft: "2px solid #e8e6d9",
                }}>
                    {steps.map((step, idx) => (
                        <div key={step.id || idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{
                                fontSize: 10.5, color: "#b5b2aa",
                                fontFamily: "'JetBrains Mono', monospace",
                                minWidth: 18, paddingTop: 1,
                            }}>
                                {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span style={{ fontSize: 12.5, color: "#4a4846", lineHeight: 1.55, flex: 1 }}>
                                {step.description}
                            </span>
                            {step.tool && (
                                <span style={{
                                    fontSize: 10, color: "#6366f1",
                                    backgroundColor: "rgba(99,102,241,0.08)",
                                    padding: "2px 7px", borderRadius: 4,
                                    whiteSpace: "nowrap", flexShrink: 0,
                                    fontFamily: "'JetBrains Mono', monospace",
                                }}>
                                    {step.tool}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// Sub-agent progress item - displays step-by-step progress for sub-agent executions
const SubAgentProgressItem = ({
    event,
    isLast
}: {
    event: SubAgentProgressEvent;
    isLast: boolean;
}) => {
    const [screenshotExpanded, setScreenshotExpanded] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const [actionExpanded, setActionExpanded] = useState(false);
    const isLive = event.type === 'step' && !event.content;

    // Render based on event type
    if (event.type === 'step') {
        const stepContent = event.content || '';
        const hasStepContent = stepContent.trim().length > 0;

        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                <div style={{
                    width: 20,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 0,
                }}>
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />
                    {isLive ? (
                        <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#6366f1", border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9" }} />
                        </div>
                    ) : (
                        <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#22c55e", border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9", flexShrink: 0 }} />
                    )}
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>

                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div
                        onClick={() => hasStepContent && setIsExpanded(!isExpanded)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "2px 0",
                            cursor: hasStepContent ? "pointer" : "default",
                            userSelect: "none",
                        }}
                    >
                        <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: isLive ? "#6366f1" : "#8a8886",
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            fontFamily: "'Figtree', system-ui, sans-serif",
                        }}>
                            STEP {event.stepNumber}/{event.totalSteps}
                        </span>

                        {!isLive && hasStepContent && (
                            <span style={{
                                fontSize: 12,
                                color: "#4a4846",
                                fontFamily: "'Figtree', system-ui, sans-serif",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                            }}>
                                {stepContent.length > 60 ? stepContent.substring(0, 60) + '...' : stepContent}
                            </span>
                        )}

                        {isLive && (
                            <motion.div
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ repeat: Infinity, duration: 1.2 }}
                                style={{ display: "flex", gap: 3, alignItems: "center" }}
                            >
                                {[0, 1, 2].map(i => (
                                    <motion.div
                                        key={i}
                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                        transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                                        style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: "#6366f1" }}
                                    />
                                ))}
                            </motion.div>
                        )}

                        {hasStepContent && !isLive && (
                            <motion.svg
                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                transition={{ duration: 0.18 }}
                                width={12} height={12} viewBox="0 0 24 24"
                                fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                                strokeLinecap="round" strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </motion.svg>
                        )}
                    </div>

                    <AnimatePresence>
                        {isExpanded && hasStepContent && !isLive && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                style={{ overflow: "hidden" }}
                            >
                                <div style={{
                                    marginTop: 6,
                                    padding: "8px 12px",
                                    backgroundColor: "#faf9f7",
                                    borderRadius: 6,
                                    border: "1px solid #e8e6d9",
                                    fontSize: 12,
                                    color: "#6b7280",
                                    fontFamily: "'Figtree', system-ui, sans-serif",
                                    lineHeight: 1.5,
                                }}>
                                    {stepContent}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    if (event.type === 'reasoning') {
        const isThinking = !event.content || event.content.trim() === '';

        // Clean up backend orchestrator logs for UI display
        const cleanContent = event.content ? event.content.replace(/^(?:🤖|🧠|🧭|⚙️|🔍|👨‍💻|📊|🌐|🖥️|💻|✅|⚠️|⚖️|🎬)\s*[^:]+:\s*/, '').trim() : '';
        const displayContent = cleanContent.replace(/^(?:🤖|🧠|🧭|⚙️|🔍|👨‍💻|📊|🌐|🖥️|💻|✅|⚠️|⚖️|🎬)\s*/, '');

        if (!displayContent) return null;

        return (
            <div style={{ display: "flex", gap: 0, paddingBottom: 0, position: "relative" }}>
                {/* Timeline line */}
                <div style={{
                    width: 20,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 0,
                }}>
                    {/* Vertical line before dot */}
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />

                    {/* Status dot */}
                    <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                        <div style={{
                            width: 10, height: 10, borderRadius: "50%",
                            backgroundColor: isThinking ? "#a855f7" : "#d8b4fe",
                            border: "2px solid #faf9f7",
                            boxShadow: "0 0 0 1px #e8e6d9",
                        }} />
                        {isThinking && (
                            <motion.div
                                animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
                                style={{
                                    position: "absolute", inset: -2,
                                    borderRadius: "50%",
                                    backgroundColor: "#a855f7",
                                }}
                            />
                        )}
                    </div>

                    {/* Vertical line after dot */}
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div
                        onClick={() => setIsExpanded(!isExpanded)}
                        style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "2px 0",
                            cursor: "pointer", userSelect: "none"
                        }}
                    >
                        <span style={{ fontSize: 13.5, color: isThinking ? "#a855f7" : "#d8b4fe" }}>🧠</span>
                        <span style={{
                            fontSize: 13.5,
                            fontWeight: 500,
                            color: isThinking ? "#201e24" : "#4a4846",
                            fontFamily: "'Figtree', system-ui, sans-serif",
                            letterSpacing: "-0.01em",
                        }}>
                            {isThinking ? "Thinking..." : (displayContent.length > 70 ? displayContent.substring(0, 70) + "..." : displayContent)}
                        </span>

                        {isThinking && (
                            <motion.div
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ repeat: Infinity, duration: 1.2 }}
                                style={{ display: "flex", gap: 3, alignItems: "center" }}
                            >
                                {[0, 1, 2].map(i => (
                                    <motion.div
                                        key={i}
                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                        transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                                        style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: "#a855f7" }}
                                    />
                                ))}
                            </motion.div>
                        )}

                        {displayContent && displayContent.length > 70 && (
                            <motion.svg
                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                transition={{ duration: 0.18 }}
                                width={12} height={12} viewBox="0 0 24 24"
                                fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                                strokeLinecap="round" strokeLinejoin="round"
                                style={{ marginLeft: "auto", flexShrink: 0 }}
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </motion.svg>
                        )}
                    </div>

                    <AnimatePresence>
                        {isExpanded && !isThinking && displayContent && displayContent.length > 70 && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                style={{ overflow: "hidden" }}
                            >
                                <div style={{
                                    marginTop: 8,
                                    padding: "10px 14px",
                                    backgroundColor: "#faf9f7",
                                    borderRadius: 8,
                                    border: "1px solid #e8e6d9",
                                    fontSize: 12.5,
                                    fontFamily: "'Figtree', system-ui, sans-serif",
                                    color: "#6b7280",
                                    whiteSpace: "pre-wrap",
                                    lineHeight: 1.6,
                                    fontStyle: "italic",
                                }}>
                                    {displayContent}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    if (event.type === 'action' && event.action) {
        const actionIcons: Record<string, string> = {
            left_click: "🖱️",
            right_click: "🖱️",
            middle_click: "🖱️",
            double_click: "🖱️",
            mouse_move: "🖱️",
            drag: "🖱️",
            type: "⌨️",
            key: "⌨️",
            scroll_up: "📜",
            scroll_down: "📜",
            scroll: "📜",
            wait: "⏱️",
        };

        const icon = actionIcons[event.action.type] || "🖱️";
        const hasParams = event.action.params && Object.keys(event.action.params).length > 0;

        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                <div style={{
                    width: 20,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 0,
                }}>
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />
                    <div style={{
                        width: 10, height: 10, borderRadius: "50%", backgroundColor: "#22c55e",
                        border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9", flexShrink: 0,
                    }} />
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>

                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div
                        onClick={() => hasParams && setActionExpanded(!actionExpanded)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "2px 0",
                            cursor: hasParams ? "pointer" : "default",
                            userSelect: "none",
                        }}
                    >
                        <span style={{ fontSize: 16 }}>{icon}</span>
                        <span style={{
                            fontSize: 12,
                            color: "#4a4846",
                            fontFamily: "'Figtree', system-ui, sans-serif",
                        }}>
                            {event.action.description}
                        </span>
                        {hasParams && (
                            <motion.svg
                                animate={{ rotate: actionExpanded ? 180 : 0 }}
                                transition={{ duration: 0.18 }}
                                width={12} height={12} viewBox="0 0 24 24"
                                fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                                strokeLinecap="round" strokeLinejoin="round"
                                style={{ marginLeft: "auto", flexShrink: 0 }}
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </motion.svg>
                        )}
                    </div>

                    <AnimatePresence>
                        {actionExpanded && hasParams && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                style={{ overflow: "hidden" }}
                            >
                                <div style={{
                                    marginTop: 6,
                                    padding: "8px 12px",
                                    backgroundColor: "#faf9f7",
                                    borderRadius: 6,
                                    border: "1px solid #e8e6d9",
                                    fontSize: 11,
                                    color: "#6b7280",
                                    fontFamily: "'JetBrains Mono', monospace",
                                    lineHeight: 1.6,
                                }}>
                                    {Object.entries(event.action.params).map(([key, value]) => (
                                        <div key={key}>
                                            <span style={{ color: "#8a8886" }}>{key}: </span>
                                            {JSON.stringify(value, null, 1)}
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    if (event.type === 'screenshot' && event.screenshot) {
        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                {/* Timeline line */}
                <div style={{
                    width: 20,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 0,
                }}>
                    {/* Vertical line before dot */}
                    <div style={{
                        width: 2,
                        height: 8,
                        backgroundColor: "#e8e6d9",
                    }} />

                    {/* Screenshot dot */}
                    <div style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: "#22c55e",
                        border: "2px solid #faf9f7",
                        boxShadow: "0 0 0 1px #e8e6d9",
                        flexShrink: 0,
                    }} />

                    {/* Vertical line after dot */}
                    {!isLast && (
                        <div style={{
                            position: "absolute",
                            top: 18,
                            bottom: -20,
                            width: 2,
                            backgroundColor: "#e8e6d9",
                        }} />
                    )}
                </div>

                {/* Screenshot content */}
                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div
                        onClick={() => setScreenshotExpanded(!screenshotExpanded)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            userSelect: "none",
                            padding: "2px 0",
                        }}
                    >
                        <span style={{ fontSize: 16 }}>📸</span>
                        <span style={{
                            fontSize: 12,
                            color: "#4a4846",
                            fontFamily: "'Figtree', system-ui, sans-serif",
                        }}>
                            Screenshot ({event.screenshot.width}x{event.screenshot.height})
                        </span>

                        <motion.svg
                            animate={{ rotate: screenshotExpanded ? 180 : 0 }}
                            transition={{ duration: 0.18 }}
                            width={12} height={12} viewBox="0 0 24 24"
                            fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ marginLeft: "auto", flexShrink: 0 }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </motion.svg>
                    </div>

                    <AnimatePresence>
                        {screenshotExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                style={{ overflow: "hidden" }}
                            >
                                <div style={{
                                    marginTop: 10,
                                    maxWidth: 400,
                                    borderRadius: 6,
                                    overflow: "hidden",
                                    border: "1px solid #e8e6d9",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                                }}>
                                    <img
                                        src={event.screenshot.base64}
                                        alt="Sub-agent screenshot"
                                        style={{
                                            width: "100%",
                                            height: "auto",
                                            display: "block",
                                        }}
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    if (event.type === 'complete') {
        const resultContent = event.content || '';
        const hasResults = resultContent.trim().length > 0;

        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                <div style={{
                    width: 20, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0,
                }}>
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />
                    <div style={{
                        width: 10, height: 10, borderRadius: "50%", backgroundColor: "#22c55e",
                        border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9", flexShrink: 0,
                    }} />
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>

                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div
                        onClick={() => hasResults && setIsExpanded(!isExpanded)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "2px 0",
                            cursor: hasResults ? "pointer" : "default",
                            userSelect: "none",
                        }}
                    >
                        <span style={{
                            fontSize: 12, color: "#22c55e", fontWeight: 600,
                            fontFamily: "'Figtree', system-ui, sans-serif",
                        }}>
                            ✓ Sub-agent completed
                        </span>
                        {hasResults && (
                            <motion.svg
                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                transition={{ duration: 0.18 }}
                                width={12} height={12} viewBox="0 0 24 24"
                                fill="none" stroke="#22c55e" strokeWidth={2.5}
                                strokeLinecap="round" strokeLinejoin="round"
                                style={{ flexShrink: 0 }}
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </motion.svg>
                        )}
                    </div>

                    <AnimatePresence>
                        {isExpanded && hasResults && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                style={{ overflow: "hidden" }}
                            >
                                <div style={{
                                    marginTop: 8,
                                    padding: "10px 14px",
                                    backgroundColor: "#f0fdf4",
                                    borderRadius: 8,
                                    border: "1px solid #bbf7d0",
                                    fontSize: 12,
                                    color: "#166534",
                                    fontFamily: "'Figtree', system-ui, sans-serif",
                                    lineHeight: 1.6,
                                    whiteSpace: "pre-wrap",
                                    maxHeight: 400,
                                    overflowY: "auto",
                                }}>
                                    {resultContent}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        );
    }

    if (event.type === 'abort') {
        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                <div style={{
                    width: 20, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0,
                }}>
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />
                    <div style={{
                        width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ef4444",
                        border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9", flexShrink: 0,
                    }} />
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>
                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                        <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600, fontFamily: "'Figtree', system-ui, sans-serif" }}>
                            ⊗ Aborted by user
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    // Error event type
    if (event.type === 'error') {
        return (
            <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
                <div style={{
                    width: 20, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0,
                }}>
                    <div style={{ width: 2, height: 8, backgroundColor: "#e8e6d9" }} />
                    <div style={{
                        width: 10, height: 10, borderRadius: "50%", backgroundColor: "#f97316",
                        border: "2px solid #faf9f7", boxShadow: "0 0 0 1px #e8e6d9", flexShrink: 0,
                    }} />
                    {!isLast && (
                        <div style={{ position: "absolute", top: 18, bottom: -20, width: 2, backgroundColor: "#e8e6d9" }} />
                    )}
                </div>
                <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                        <span style={{ fontSize: 12, color: "#f97316", fontWeight: 600, fontFamily: "'Figtree', system-ui, sans-serif" }}>
                            ⚠️ {event.content || 'Error occurred'}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return null;
};

// Timeline Branch Component - displays subagent branches as connected visual elements
const TimelineBranchItem = ({
    branch,
    isLast,
    onToggleCollapse,
    onShowTooltip,
    onHideTooltip,
    onViewTimeline,
}: {
    branch: TimelineBranch;
    isLast: boolean;
    onToggleCollapse: (branchId: string) => void;
    onShowTooltip: (event: React.MouseEvent, branch: TimelineBranch) => void;
    onHideTooltip: () => void;
    onViewTimeline?: (branchId: string) => void;
}) => {
    const [screenshotExpanded, setScreenshotExpanded] = useState(false);
    const isRunning = branch.status === 'running';
    const isCompleted = branch.status === 'completed';
    const isFailed = branch.status === 'failed';
    const isAborted = branch.status === 'aborted';

    // Get agent type styling
    const getAgentTypeColor = (agentType: string) => {
        const colors = {
            'web-explorer': '#3b82f6',
            'navis': '#6366f1',
            'browser-use': '#8b5cf6',
            'computer-use': '#06b6d4',
            'research': '#10b981',
            'coding-specialist': '#f59e0b',
            'data-analyst': '#ef4444'
        };
        return colors[agentType as keyof typeof colors] || '#6b7280';
    };

    const agentColor = getAgentTypeColor(branch.agentType);
    const statusColor = isRunning ? agentColor :
                       isCompleted ? '#22c55e' :
                       isFailed ? '#ef4444' :
                       isAborted ? '#f59e0b' : '#6b7280';

    // Get agent type icon
    const getAgentTypeIcon = (agentType: string) => {
        const icons = {
            'web-explorer': '🌐',
            'navis': '🧭',
            'browser-use': '🖥️',
            'computer-use': '💻',
            'research': '🔍',
            'coding-specialist': '👨‍💻',
            'data-analyst': '📊'
        };
        return icons[agentType as keyof typeof icons] || '🤖';
    };

    const agentIcon = getAgentTypeIcon(branch.agentType);

    return (
        <div style={{ display: "flex", gap: 0, position: "relative", paddingBottom: 0 }}>
            {/* Timeline line with branch connection */}
            <div style={{
                width: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
            }}>
                {/* Vertical line before */}
                <div style={{
                    width: 2,
                    height: 12,
                    backgroundColor: "#e8e6d9",
                }} />

                {/* Branch connection point */}
                <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: statusColor,
                    border: "2px solid #faf9f7",
                    boxShadow: "0 0 0 1px #e8e6d9",
                    flexShrink: 0,
                    zIndex: 2,
                    position: "relative"
                }}>
                </div>

                {/* Vertical line after - extends through entire content */}
                {!isLast && (
                    <div style={{
                        position: "absolute",
                        top: 24,
                        bottom: -20,
                        width: 2,
                        backgroundColor: "#e8e6d9",
                    }} />
                )}

                {/* Branch curve - visual connection to parent */}
                <svg
                    width="50"
                    height="50"
                    viewBox="0 0 50 50"
                    style={{
                        position: "absolute",
                        left: 12,
                        top: 6,
                        pointerEvents: "none",
                    }}
                >
                    <path
                        d="M 0 6 Q 25 6 25 25 L 25 50"
                        stroke={agentColor}
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray="4,4"
                        opacity="0.6"
                    />
                </svg>
            </div>

            {/* Branch content */}
            <div style={{ flex: 1, paddingLeft: 32, paddingTop: 0, paddingBottom: 20 }}>
                {/* Branch header - clickable for collapse/expand */}
                <div
                    onClick={() => onToggleCollapse(branch.id)}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = `${agentColor}08`;
                        e.currentTarget.style.borderColor = `${agentColor}40`;
                        onShowTooltip(e, branch);
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#faf9f7";
                        e.currentTarget.style.borderColor = `${agentColor}20`;
                        onHideTooltip();
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        userSelect: "none",
                        padding: "6px 12px",
                        backgroundColor: "#faf9f7",
                        borderRadius: 8,
                        border: `1px solid ${agentColor}20`,
                        borderLeft: `3px solid ${agentColor}`,
                        marginBottom: branch.isCollapsed ? 0 : 12,
                        transition: "all 0.15s ease-out"
                    }}
                >
                    <span style={{ fontSize: 16 }}>{agentIcon}</span>

                    <div style={{ flex: 1 }}>
                        <div style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: agentColor,
                            fontFamily: "'Figtree', system-ui, sans-serif",
                            textTransform: "capitalize",
                            letterSpacing: "0.02em"
                        }}>
                            {branch.agentType.replace('-', ' ')} Subagent
                        </div>

                        {branch.taskDescription && (
                            <div style={{
                                fontSize: 11,
                                color: "#6b7280",
                                marginTop: 2,
                                fontFamily: "'Figtree', system-ui, sans-serif",
                                lineHeight: 1.4
                            }}>
                                {branch.taskDescription}
                            </div>
                        )}
                    </div>

                    {/* Status indicator */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6
                    }}>
                        {isRunning && (
                            <motion.div
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ repeat: Infinity, duration: 1.2 }}
                                style={{ display: "flex", gap: 2, alignItems: "center" }}
                            >
                                {[0, 1, 2].map(i => (
                                    <motion.div
                                        key={i}
                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                        transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                                        style={{ width: 2, height: 2, borderRadius: "50%", backgroundColor: agentColor }}
                                    />
                                ))}
                            </motion.div>
                        )}

                        <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: statusColor,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            fontFamily: "'Figtree', system-ui, sans-serif"
                        }}>
                            {branch.events.length} event{branch.events.length !== 1 ? 's' : ''}
                        </span>

                        {onViewTimeline && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onViewTimeline(branch.id); }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = `${agentColor}15`;
                                    e.currentTarget.style.color = agentColor;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = `${agentColor}08`;
                                    e.currentTarget.style.color = `${agentColor}90`;
                                }}
                                style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: `${agentColor}90`,
                                    fontFamily: "'Figtree', system-ui, sans-serif",
                                    backgroundColor: `${agentColor}08`,
                                    border: `1px solid ${agentColor}20`,
                                    borderRadius: 6,
                                    padding: '2px 8px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                }}
                            >
                                View Timeline
                            </button>
                        )}

                        {/* Collapse/expand chevron */}
                        <motion.svg
                            animate={{ rotate: branch.isCollapsed ? -90 : 0 }}
                            transition={{ duration: 0.18 }}
                            width={12} height={12} viewBox="0 0 24 24"
                            fill="none" stroke={agentColor} strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ flexShrink: 0 }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </motion.svg>
                    </div>
                </div>

                {/* Branch events - collapsible */}
                <AnimatePresence>
                    {!branch.isCollapsed && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            style={{ overflow: "hidden" }}
                        >
                            <div style={{
                                paddingLeft: 16,
                                borderLeft: `2px solid ${agentColor}20`,
                                marginLeft: 8
                            }}>
                                {branch.events.map((event, idx) => (
                                    <div key={`${event.toolCallId}-${event.timestamp}-${idx}`} style={{ marginBottom: 8 }}>
                                        <SubAgentProgressItem
                                            event={event}
                                            isLast={idx === branch.events.length - 1 && (!branch.childBranches || branch.childBranches.length === 0)}
                                        />
                                    </div>
                                ))}

                                {/* Render nested child branches */}
                                {branch.childBranches && branch.childBranches.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                        {branch.childBranches.map((child, idx) => (
                                            <TimelineBranchItem
                                                key={child.id}
                                                branch={child}
                                                isLast={idx === (branch.childBranches?.length || 0) - 1}
                                                onToggleCollapse={onToggleCollapse}
                                                onShowTooltip={onShowTooltip}
                                                onHideTooltip={onHideTooltip}
                                                onViewTimeline={onViewTimeline}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

// Tooltip Component for Branch Details
const BranchTooltip = ({
    branch,
    position,
    visible
}: {
    branch: TimelineBranch | null;
    position: { x: number; y: number };
    visible: boolean;
}) => {
    if (!visible || !branch) return null;

    const formatTime = (timestamp: string) => {
        try {
            return new Date(timestamp).toLocaleTimeString();
        } catch {
            return timestamp;
        }
    };

    const getDuration = () => {
        if (!branch.endTime) return 'Running...';
        try {
            const start = new Date(branch.startTime).getTime();
            const end = new Date(branch.endTime).getTime();
            const duration = end - start;
            return formatDuration(duration);
        } catch {
            return 'Unknown';
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
                position: "fixed",
                left: position.x,
                top: position.y - 10,
                zIndex: 1000,
                backgroundColor: "#1f2937",
                color: "white",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "'Figtree', system-ui, sans-serif",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                maxWidth: 250,
                pointerEvents: "none"
            }}
        >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {branch.agentType.replace('-', ' ')} Subagent
            </div>

            {branch.taskDescription && (
                <div style={{ marginBottom: 6, opacity: 0.9 }}>
                    {branch.taskDescription}
                </div>
            )}

            <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.4 }}>
                <div>Started: {formatTime(branch.startTime)}</div>
                <div>Duration: {getDuration()}</div>
                <div>Events: {branch.events.length}</div>
                <div>Level: {branch.branchLevel}</div>
                <div>Status: {branch.status}</div>
            </div>
        </motion.div>
    );
};

// Single tool row on the main timeline
const ToolRow = ({
    tc, isExpanded, onToggle, isLast,
}: {
    tc: ToolCallDisplay;
    isExpanded: boolean;
    onToggle: () => void;
    isLast: boolean;
}) => {
    const isRunning = tc.status === "running";
    const isError = tc.status === "error";
    const hasOutput = !!tc.output && !isRunning;
    const name = toolLabel(tc.toolName, tc.label, tc.displayName);

    // Check if this is a terminal command
    const isTerminalCommand = tc.toolName === "run_command" || tc.toolName === "bash" || tc.toolName === "executePwsh";
    const commandPath = tc.args?.cwd as string | undefined;
    const command = tc.args?.command as string | undefined;

    // Check if this is an artifact being created
    const isArtifact = tc.toolName === "create_artifact";
    const artifactContent = tc.args?.content as string | undefined;
    const artifactType = tc.args?.type as string | undefined;
    const artifactTitle = tc.args?.title as string | undefined;

    // Check if this is a search tool with results
    const isSearchTool = tc.toolName === 'web_search' || tc.toolName === 'remote_web_search' || tc.toolName === 'search_docs' || tc.label?.toLowerCase().includes('search');
    const hasSearchResults = isSearchTool && Array.isArray(tc.data?.results) && tc.data.results.length > 0;
    const queries: string[] = Array.isArray(tc.args?.queries) ? tc.args.queries : (typeof tc.args?.query === 'string' ? [tc.args.query] : []);
    const docs: string[] = Array.isArray(tc.args?.docs) ? tc.args.docs : [];
    const hasSearchPills = isSearchTool && (queries.length > 0 || docs.length > 0);
    const hasExpandableContent = hasOutput || hasSearchResults || hasSearchPills;

    // Auto-expand search tools when they have results (only once, not repeatedly)
    const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

    useEffect(() => {
        if (!hasAutoExpanded && !isExpanded && ((hasSearchPills && hasOutput) || hasSearchResults)) {
            setHasAutoExpanded(true);
            onToggle();
        }
    }, [hasSearchPills, hasOutput, hasSearchResults, isExpanded, hasAutoExpanded]);

    return (
        <div style={{ display: "flex", gap: 0, paddingBottom: 0, position: "relative" }}>
            {/* Timeline line */}
            <div style={{
                width: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 0,
            }}>
                {/* Vertical line before dot */}
                <div style={{
                    width: 2,
                    height: 8,
                    backgroundColor: "#e8e6d9",
                }} />

                {/* Status dot */}
                <StatusDot status={tc.status} />

                {/* Vertical line after dot - extends through entire content */}
                {!isLast && (
                    <div style={{
                        position: "absolute",
                        top: 18,
                        bottom: -20,
                        width: 2,
                        backgroundColor: "#e8e6d9",
                    }} />
                )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, paddingLeft: 12, paddingBottom: 20 }}>
                <div
                    onClick={() => hasExpandableContent && onToggle()}
                    style={{
                        display: "flex", alignItems: "center", gap: 8,
                        cursor: hasExpandableContent ? "pointer" : "default",
                        userSelect: "none",
                        padding: "2px 0",
                    }}
                >
                    <span style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: isRunning ? "#201e24" : isError ? "#dc2626" : "#4a4846",
                        fontFamily: "'Figtree', system-ui, sans-serif",
                        letterSpacing: "-0.01em",
                    }}>
                        {name}
                    </span>

                    {isRunning && (
                        <motion.div
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ repeat: Infinity, duration: 1.2 }}
                            style={{ display: "flex", gap: 3, alignItems: "center" }}
                        >
                            {[0, 1, 2].map(i => (
                                <motion.div
                                    key={i}
                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                                    style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: "#6366f1" }}
                                />
                            ))}
                        </motion.div>
                    )}

                    {tc.durationMs !== undefined && !isRunning && (
                        <span style={{
                            fontSize: 11, color: "#b5b2aa",
                            fontFamily: "'JetBrains Mono', monospace",
                        }}>
                            {formatDuration(tc.durationMs)}
                        </span>
                    )}

                    {hasExpandableContent && (
                        <motion.svg
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.18 }}
                            width={12} height={12} viewBox="0 0 24 24"
                            fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ marginLeft: "auto", flexShrink: 0 }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </motion.svg>
                    )}
                </div>

                {tc.description && !isExpanded && (
                    <div style={{
                        fontSize: 11.5, color: "#8a8886", marginTop: 2,
                        lineHeight: 1.5, fontFamily: "'Figtree', system-ui, sans-serif",
                    }}>
                        {tc.description}
                    </div>
                )}

                {/* Streaming artifact content preview */}
                {isArtifact && isRunning && artifactContent && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        style={{
                            marginTop: 10,
                            padding: "10px 14px",
                            backgroundColor: "#faf9f7",
                            borderRadius: 8,
                            border: "1px solid #e8e6d9",
                            borderLeft: "2px solid #6366f1",
                        }}
                    >
                        {artifactTitle && (
                            <div style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#6366f1",
                                marginBottom: 6,
                                fontFamily: "'Figtree', system-ui, sans-serif",
                            }}>
                                {artifactTitle}
                                {artifactType && (
                                    <span style={{
                                        marginLeft: 8,
                                        fontSize: 10,
                                        fontWeight: 400,
                                        color: "#8a8886",
                                        fontFamily: "'JetBrains Mono', monospace",
                                    }}>
                                        {artifactType}
                                    </span>
                                )}
                            </div>
                        )}
                        <div style={{
                            fontSize: 11.5,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: "#4a4846",
                            whiteSpace: "pre-wrap",
                            maxHeight: 200,
                            overflowY: "auto",
                            lineHeight: 1.6,
                        }}>
                            {artifactContent}
                            <motion.span
                                animate={{ opacity: [1, 0] }}
                                transition={{ repeat: Infinity, duration: 0.5 }}
                                style={{
                                    display: "inline-block",
                                    width: 2,
                                    height: "1em",
                                    backgroundColor: "#6366f1",
                                    marginLeft: 2,
                                    verticalAlign: "text-bottom",
                                }}
                            />
                        </div>
                    </motion.div>
                )}

                <AnimatePresence>
                    {isExpanded && (hasOutput || hasSearchResults || hasSearchPills) && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            style={{ overflow: "hidden" }}
                        >
                            {/* Search Results Display */}
                            {(hasSearchPills || hasSearchResults) ? (
                                <div style={{ marginTop: 10 }}>
                                    {/* Query Pills */}
                                    {queries.length > 0 && (
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{
                                                fontSize: 11,
                                                color: '#6b7280',
                                                fontWeight: 500,
                                                marginBottom: 6,
                                                fontFamily: "'Figtree', system-ui, sans-serif"
                                            }}>
                                                Querying
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                {queries.map((q, i) => (
                                                    <div key={i} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        padding: '4px 10px',
                                                        borderRadius: 16,
                                                        backgroundColor: '#f3f4f6',
                                                        border: '1px solid transparent',
                                                        fontSize: 11,
                                                        color: '#374151',
                                                        fontWeight: 500,
                                                        fontFamily: "'Figtree', system-ui, sans-serif"
                                                    }}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <circle cx="11" cy="11" r="8" />
                                                            <path d="m21 21-4.35-4.35" />
                                                        </svg>
                                                        {q}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Docs Pills */}
                                    {docs.length > 0 && (
                                        <div style={{ marginBottom: 12 }}>
                                            <div style={{
                                                fontSize: 11,
                                                color: '#6b7280',
                                                fontWeight: 500,
                                                marginBottom: 6,
                                                fontFamily: "'Figtree', system-ui, sans-serif"
                                            }}>
                                                Reading
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                                {docs.slice(0, 2).map((d, i) => (
                                                    <div key={i} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        padding: '4px 10px',
                                                        borderRadius: 16,
                                                        backgroundColor: '#f3f4f6',
                                                        border: '1px solid transparent',
                                                        fontSize: 11,
                                                        color: '#374151',
                                                        fontWeight: 500,
                                                        cursor: 'pointer',
                                                        fontFamily: "'Figtree', system-ui, sans-serif"
                                                    }}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                            <polyline points="14,2 14,8 20,8" />
                                                            <line x1="16" y1="13" x2="8" y2="13" />
                                                            <line x1="16" y1="17" x2="8" y2="17" />
                                                            <polyline points="10,9 9,9 8,9" />
                                                        </svg>
                                                        {d}
                                                    </div>
                                                ))}
                                                {docs.length > 2 && (
                                                    <div style={{
                                                        fontSize: 11,
                                                        color: '#2563eb',
                                                        fontWeight: 600,
                                                        marginLeft: 4,
                                                        cursor: 'pointer',
                                                        fontFamily: "'Figtree', system-ui, sans-serif"
                                                    }}>
                                                        + {docs.length - 2} more
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Search Results */}
                                    {hasSearchResults && (
                                        <div>
                                            <div style={{
                                                fontSize: 11,
                                                color: '#6b7280',
                                                fontWeight: 500,
                                                marginBottom: 8,
                                                fontFamily: "'Figtree', system-ui, sans-serif"
                                            }}>
                                                {tc.data.results.length} result{tc.data.results.length !== 1 ? 's' : ''}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {(tc.data.results as SearchResult[]).map((result, i) => (
                                                    <SearchResultCard key={i} result={result} index={i} />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : tc.output && (() => {
                                const lines = tc.output.split("\n");
                                const MAX = 100;
                                const truncated = lines.length > MAX;
                                const display = truncated
                                    ? `[Showing last ${MAX} lines]\n` + lines.slice(-MAX).join("\n")
                                    : tc.output;
                                return (
                                    <>
                                        {/* Command header for terminal commands */}
                                        {isTerminalCommand && (commandPath || command) && (
                                            <div style={{
                                                marginTop: 10,
                                                padding: "8px 12px",
                                                backgroundColor: "#faf9f7",
                                                borderRadius: "8px 8px 0 0",
                                                fontSize: 11,
                                                fontFamily: "'JetBrains Mono', monospace",
                                                color: "#6366f1",
                                                borderLeft: "2px solid #6366f1",
                                                borderRight: "1px solid #e8e6d9",
                                                borderTop: "1px solid #e8e6d9",
                                            }}>
                                                {commandPath && <span style={{ color: "#8a8886" }}>{commandPath} : </span>}
                                                <span style={{ color: "#201e24", fontWeight: 500 }}>{command}</span>
                                            </div>
                                        )}

                                        <div style={{
                                            marginTop: isTerminalCommand && (commandPath || command) ? 0 : 10,
                                            padding: "10px 14px",
                                            backgroundColor: "#f4f3ef",
                                            borderRadius: isTerminalCommand && (commandPath || command) ? "0 0 8px 8px" : 8,
                                            fontSize: 11.5,
                                            fontFamily: "'JetBrains Mono', monospace",
                                            color: "#4a4846",
                                            whiteSpace: "pre-wrap",
                                            maxHeight: 260,
                                            overflowY: "auto",
                                            border: "1px solid #e8e6d9",
                                            borderTop: isTerminalCommand && (commandPath || command) ? "none" : "1px solid #e8e6d9",
                                            lineHeight: 1.6,
                                        }}>
                                            {display}
                                        </div>
                                    </>
                                );
                            })()}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

// Sub-Agent Timeline View - full-screen dedicated timeline for a single sub-agent branch
const SubAgentTimelineView = ({
    branch,
    onBack,
}: {
    branch: TimelineBranch;
    onBack: () => void;
}) => {
    const getAgentTypeColor = (agentType: string) => {
        const colors = {
            'web-explorer': '#3b82f6',
            'navis': '#6366f1',
            'browser-use': '#8b5cf6',
            'computer-use': '#06b6d4',
            'research': '#10b981',
            'coding-specialist': '#f59e0b',
            'data-analyst': '#ef4444'
        };
        return colors[agentType as keyof typeof colors] || '#6b7280';
    };

    const getAgentTypeIcon = (agentType: string) => {
        const icons = {
            'web-explorer': '🌐',
            'navis': '🧭',
            'browser-use': '🖥️',
            'computer-use': '💻',
            'research': '🔍',
            'coding-specialist': '👨‍💻',
            'data-analyst': '📊'
        };
        return icons[agentType as keyof typeof icons] || '🤖';
    };

    const agentColor = getAgentTypeColor(branch.agentType);
    const agentIcon = getAgentTypeIcon(branch.agentType);
    const statusColor = branch.status === 'running' ? agentColor :
                       branch.status === 'completed' ? '#22c55e' :
                       branch.status === 'failed' ? '#ef4444' :
                       branch.status === 'aborted' ? '#f59e0b' : '#6b7280';

    const formatTime = (timestamp: string) => {
        try {
            return new Date(timestamp).toLocaleTimeString();
        } catch {
            return timestamp;
        }
    };

    const getDuration = () => {
        if (!branch.endTime) return 'Running...';
        try {
            const start = new Date(branch.startTime).getTime();
            const end = new Date(branch.endTime).getTime();
            return formatDuration(end - start);
        } catch {
            return 'Unknown';
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{
                fontFamily: "'Figtree', system-ui, sans-serif",
            }}
        >
            {/* Header */}
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                marginBottom: 16,
                backgroundColor: "#faf9f7",
                borderRadius: 12,
                border: `1px solid ${agentColor}20`,
                borderLeft: `3px solid ${agentColor}`,
            }}>
                <button
                    onClick={onBack}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#e8e6d9";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#6366f1",
                        fontFamily: "'Figtree', system-ui, sans-serif",
                        transition: "background-color 0.15s ease-out",
                    }}
                >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back
                </button>

                <div style={{ flex: 1 }} />

                <span style={{ fontSize: 18 }}>{agentIcon}</span>

                <div style={{ flex: 1 }}>
                    <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: agentColor,
                        textTransform: "capitalize",
                        letterSpacing: "0.02em"
                    }}>
                        {branch.agentType.replace('-', ' ')} Subagent
                    </div>
                    {branch.taskDescription && (
                        <div style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 2,
                            lineHeight: 1.4
                        }}>
                            {branch.taskDescription}
                        </div>
                    )}
                </div>

                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 10,
                    color: "#8a8886",
                    fontFamily: "'JetBrains Mono', monospace",
                }}>
                    <span>{formatTime(branch.startTime)}</span>
                    <span>{getDuration()}</span>
                    <span style={{
                        fontWeight: 600,
                        color: statusColor,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontFamily: "'Figtree', system-ui, sans-serif"
                    }}>
                        {branch.status}
                    </span>
                </div>
            </div>

            {/* Timeline events */}
            <div style={{ paddingLeft: 0 }}>
                {branch.events.map((event, idx) => (
                    <SubAgentProgressItem
                        key={`${event.toolCallId}-${event.timestamp}-${idx}`}
                        event={event}
                        isLast={idx === branch.events.length - 1}
                    />
                ))}
            </div>
        </motion.div>
    );
};

export const AgentTimeline = ({
    toolCalls, thought, isLive, currentNode, planSteps, planTitle, subAgentProgress, timelineBranches, generatedTitle, debateData, isDebating
}: AgentTimelineProps) => {
    const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
    const [activeSubAgentId, setActiveSubAgentId] = useState<string | null>(null);
    const [tooltipState, setTooltipState] = useState<{
        visible: boolean;
        branch: TimelineBranch | null;
        position: { x: number; y: number };
    }>({ visible: false, branch: null, position: { x: 0, y: 0 } });

    // Helper function to build timeline branches from subagent progress events
    const buildTimelineBranches = useMemo((): Map<string, TimelineBranch> => {
        const branches = new Map<string, TimelineBranch>();

        if (timelineBranches) {
            timelineBranches.forEach((branch, id) => {
                branches.set(id, {
                    ...branch,
                    isCollapsed: collapsedBranches.has(id)
                });
            });
            return branches;
        }

        // Build flat branches from subagent progress events
        if (subAgentProgress) {
            subAgentProgress.forEach((events, toolCallId) => {
                if (events.length === 0) return;

                const branchGroups = new Map<string, SubAgentProgressEvent[]>();

                events.forEach(event => {
                    if (event.timelineBranch) {
                        const branchId = event.timelineBranch.sessionId || `${toolCallId}-${event.timelineBranch.agentType}`;
                        if (!branchGroups.has(branchId)) {
                            branchGroups.set(branchId, []);
                        }
                        branchGroups.get(branchId)!.push(event);
                    } else if ((event as any).swarmId) {
                        const swarmId = (event as any).swarmId;
                        if (!branchGroups.has(swarmId)) {
                            branchGroups.set(swarmId, []);
                        }
                        branchGroups.get(swarmId)!.push(event);
                    }
                });

                branchGroups.forEach((branchEvents, branchId) => {
                    if (branchEvents.length === 0) return;

                    const firstEvent = branchEvents[0];
                    const lastEvent = branchEvents[branchEvents.length - 1];
                    const branchMetadata = firstEvent.timelineBranch || (firstEvent as any).swarmMetadata;

                    let status: TimelineBranch['status'] = 'running';
                    if (lastEvent.type === 'complete' || (lastEvent as any).type === 'task_complete') status = 'completed';
                    else if (lastEvent.type === 'abort') status = 'aborted';
                    else if (branchMetadata?.branchStatus === 'failed') status = 'failed';

                    const branch: TimelineBranch = {
                        id: branchId,
                        parentId: branchMetadata?.parentId || toolCallId,
                        parentSessionKey: branchMetadata?.parentSessionKey,
                        agentType: branchMetadata?.agentType || (firstEvent as any).agentType || 'research',
                        events: branchEvents,
                        status,
                        startTime: firstEvent.timestamp,
                        endTime: (lastEvent.type === 'complete' || lastEvent.type === 'abort' || (lastEvent as any).type === 'task_complete') ? lastEvent.timestamp : undefined,
                        taskDescription: branchMetadata?.taskDescription || (firstEvent as any).task || 'Swarm Task',
                        branchLevel: branchMetadata?.branchLevel || 1,
                        isCollapsed: collapsedBranches.has(branchId)
                    };

                    branches.set(branchId, branch);
                });
            });
        }

        // Nest branches by branchLevel for hierarchical display
        const sorted = [...branches.values()]
            .sort((a, b) => a.startTime.localeCompare(b.startTime));

        const nested = new Map<string, TimelineBranch>();
        const lastAtLevel: Record<number, TimelineBranch> = {};

        sorted.forEach(branch => {
            if (branch.branchLevel <= 1) {
                const top = { ...branch, childBranches: [] };
                nested.set(branch.id, top);
                lastAtLevel[1] = top;
            } else {
                const parentLevel = branch.branchLevel - 1;
                const parent = lastAtLevel[parentLevel];
                if (parent) {
                    if (!parent.childBranches) parent.childBranches = [];
                    parent.childBranches.push(branch);
                    lastAtLevel[branch.branchLevel] = branch;
                } else {
                    const orphan = { ...branch, childBranches: [] };
                    nested.set(branch.id, orphan);
                }
            }
        });

        return nested;
    }, [subAgentProgress, timelineBranches, collapsedBranches]);

    // Build unified timeline with thoughts interspersed in chronological order
    const timelineItems = useMemo((): TimelineItem[] => {
        const items: TimelineItem[] = [];

        const hidden = ["write_file"];
        const visibleTools = toolCalls.filter(tc => !hidden.includes(tc.toolName));

        if (thought && thought.trim()) {
            items.push({
                type: "thought",
                data: { id: "global-thought", content: thought, isLive }
            });
        }

        if (planSteps && planSteps.length > 0) {
            items.push({
                type: "plan",
                data: { steps: planSteps, title: planTitle }
            });
        }

        const toolNestedBranchIds = new Set<string>();

        visibleTools.forEach(tc => {
            if (tc.thought && tc.thought.trim()) {
                items.push({
                    type: "thought",
                    data: { id: `thought-${tc.id}`, content: tc.thought, isLive: tc.status === "running" }
                });
            }

            items.push({ type: "tool", data: tc });

            buildTimelineBranches.forEach(branch => {
                if (branch.parentId === tc.id) {
                    items.push({ type: "timeline-branch", data: branch });
                    toolNestedBranchIds.add(branch.id);
                }
            });

            if (subAgentProgress && subAgentProgress.has(tc.id)) {
                const progressEvents = subAgentProgress.get(tc.id) || [];
                progressEvents.forEach(event => {
                    if (!event.timelineBranch) {
                        items.push({ type: "subagent-progress", data: event });
                    }
                });
            }
        });

        // Add standalone branches (not nested under any tool) in chronological order
        const standaloneBranches: TimelineBranch[] = [];
        buildTimelineBranches.forEach(branch => {
            if (!toolNestedBranchIds.has(branch.id)) {
                standaloneBranches.push(branch);
            }
        });
        standaloneBranches.sort((a, b) => a.startTime.localeCompare(b.startTime));
        standaloneBranches.forEach(branch => {
            items.push({ type: "timeline-branch", data: branch });
        });

        // Add debate ui element if we are debating or have debate data
        // Only if it belongs globally, assuming debate happens at the main level
        // We'll place it at the end so it's visible, or right after plan. Let's put it at the very top, like plan.
        // Debate information is now attached to the prompt input area, not displayed in timeline

        return items;
    }, [toolCalls, thought, isLive, planSteps, planTitle, subAgentProgress, buildTimelineBranches, debateData, isDebating]);

    const toggleTool = (id: string) => setExpandedToolId(p => p === id ? null : id);

    const toggleBranchCollapse = (branchId: string) => {
        setCollapsedBranches(prev => {
            const newSet = new Set(prev);
            if (newSet.has(branchId)) {
                newSet.delete(branchId);
            } else {
                newSet.add(branchId);
            }
            return newSet;
        });
    };

    const showTooltip = (event: React.MouseEvent, branch: TimelineBranch) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltipState({
            visible: true,
            branch,
            position: {
                x: rect.right + 10,
                y: rect.top
            }
        });
    };

    const hideTooltip = () => {
        setTooltipState(prev => ({ ...prev, visible: false }));
    };

    const hasContent = timelineItems.length > 0;

    // Don't show timeline if live but no content yet (hide "Initializing..." state)
    if (!hasContent) return null;

    // Count total steps (tools only, not thoughts/plans)
    const totalSteps = timelineItems.filter(item => item.type === "tool").length;

    // Generate header label
    const headerLabel = isLive
        ? currentNode
            ? currentNode.replace(/_/g, " ")
            : "Working"
        : planTitle || generatedTitle || (totalSteps > 0
            ? `Completed · ${totalSteps} step${totalSteps !== 1 ? "s" : ""}`
            : "Completed");

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            style={{
                marginBottom: 16,
                fontFamily: "'Figtree', system-ui, sans-serif",
                paddingLeft: 0,
            }}
        >
            {/* Timeline start indicator - clickable header */}
            <button
                onClick={() => setCollapsed(c => !c)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: collapsed ? 0 : 12,
                    paddingLeft: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    width: "100%",
                }}
            >
                <div style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20
                }}>
                    {/* Vertical line connecting to timeline */}
                    {!collapsed && hasContent && (
                        <div style={{
                            position: "absolute",
                            top: 10,
                            width: 2,
                            height: 18,
                            backgroundColor: "#e8e6d9",
                        }} />
                    )}

                    {isLive ? (
                        <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                            <div style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                backgroundColor: "#6366f1",
                                border: "2px solid #faf9f7",
                                boxShadow: "0 0 0 1px #e8e6d9",
                            }} />
                        </div>
                    ) : (
                        <div style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: "#22c55e",
                            border: "2px solid #faf9f7",
                            boxShadow: "0 0 0 1px #e8e6d9",
                            flexShrink: 0
                        }} />
                    )}
                </div>

                <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#201e24",
                    letterSpacing: "-0.01em",
                    textTransform: "capitalize",
                    flex: 1,
                    textAlign: "left",
                }}>
                    {headerLabel}
                </span>

                {/* Chevron indicator */}
                <motion.svg
                    animate={{ rotate: collapsed ? -90 : 0 }}
                    transition={{ duration: 0.18 }}
                    width={14} height={14} viewBox="0 0 24 24"
                    fill="none" stroke="#b5b2aa" strokeWidth={2.5}
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                >
                    <polyline points="6 9 12 15 18 9" />
                </motion.svg>
            </button>

            {/* Timeline items - collapsible */}
            <AnimatePresence initial={false}>
                {!collapsed && (
                    <motion.div
                        key="timeline-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        {activeSubAgentId && buildTimelineBranches.has(activeSubAgentId) ? (
                            <SubAgentTimelineView
                                branch={buildTimelineBranches.get(activeSubAgentId)!}
                                onBack={() => setActiveSubAgentId(null)}
                            />
                        ) : (
                            <div style={{ paddingLeft: 0 }}>
                                {timelineItems.map((item, idx) => {
                                    const isLast = idx === timelineItems.length - 1;

                                    if (item.type === "thought") {
                                        return (
                                            <ThoughtItem
                                                key={item.data.id}
                                                content={item.data.content}
                                                isLive={item.data.isLive}
                                                isLast={isLast}
                                            />
                                        );
                                    }

                                    if (item.type === "plan") {
                                        return (
                                            <PlanItem
                                                key="plan"
                                                steps={item.data.steps}
                                                title={item.data.title}
                                                isLast={isLast}
                                            />
                                        );
                                    }

                                    if (item.type === "tool") {
                                        return (
                                            <ToolRow
                                                key={item.data.id || idx}
                                                tc={item.data}
                                                isExpanded={expandedToolId === item.data.id}
                                                onToggle={() => toggleTool(item.data.id)}
                                                isLast={isLast}
                                            />
                                        );
                                    }

                                    if (item.type === "subagent-progress") {
                                        return (
                                            <div
                                                key={`progress-${item.data.toolCallId}-${item.data.timestamp}-${idx}`}
                                                style={{
                                                    marginLeft: 20,
                                                    backgroundColor: "#faf9f7",
                                                    border: "1px solid #e8e6d9",
                                                    borderRadius: 8,
                                                    padding: 12,
                                                    marginBottom: 12,
                                                }}
                                            >
                                                <SubAgentProgressItem
                                                    event={item.data}
                                                    isLast={isLast}
                                                />
                                            </div>
                                        );
                                    }

                                    if (item.type === "timeline-branch") {
                                        return (
                                            <TimelineBranchItem
                                                key={item.data.id}
                                                branch={item.data}
                                                isLast={isLast}
                                                onToggleCollapse={toggleBranchCollapse}
                                                onShowTooltip={showTooltip}
                                                onHideTooltip={hideTooltip}
                                                onViewTimeline={(branchId) => setActiveSubAgentId(branchId)}
                                            />
                                        );
                                    }

                                    return null;
                                })}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Tooltip for branch details */}
            <AnimatePresence>
                {tooltipState.visible && (
                    <BranchTooltip
                        branch={tooltipState.branch}
                        position={tooltipState.position}
                        visible={tooltipState.visible}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default AgentTimeline;
