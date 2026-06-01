import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Loader } from '@/components/ui/animated-loading-svg-text-shimmer';
import { formatDuration } from '@/lib/formatDuration';
import { useAutoCollapse } from '@/hooks/use-auto-collapse';
import { MarkdownRenderer } from './MarkdownComponents';
import type { ToolCallDisplay } from '../app/chat/types/index';

// ── Reasoning Branch Component ─────────────────────────────────────────────────
export const ReasoningBranch = ({
    thought,
    isLive,
    duration,
    autoCollapse = true
}: {
    thought?: string;
    isLive?: boolean;
    duration?: number;
    autoCollapse?: boolean;
}) => {
    const [expanded, setExpanded] = useAutoCollapse(isLive || false, autoCollapse, duration);

    if (!thought?.trim()) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            style={{ marginBottom: 14 }}
        >
            {/* Toggle row */}
            <motion.button
                onClick={() => setExpanded(!expanded)}
                whileHover={{ opacity: 0.8 }}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '0 0 8px', color: '#8a8886',
                }}
            >
                {isLive ? (
                    // Use animated Loader from animated-loading-svg-text-shimmer
                    <Loader size={14} strokeWidth={2} className="text-zinc-500" />
                ) : (
                    // Static icon when done — the chat bubble from the created SVG style
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                )}

                <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                    {isLive ? 'Thinking…' : `Thought for ${formatDuration(duration)}`}
                </span>

                <motion.span
                    animate={{ rotate: expanded ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    style={{ display: 'flex', marginLeft: 2 }}
                >
                    <ChevronDownIcon width={12} height={12} color="#9ca3af" />
                </motion.span>
            </motion.button>

            {/* Expanded thought content */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{
                            borderLeft: '2px solid #e5e7eb',
                            paddingLeft: 16,
                            marginLeft: 2,
                            marginBottom: 12,
                        }}>
                            <div style={{
                                fontSize: 13.5,
                                lineHeight: 1.75,
                                color: '#9ca3af',
                                fontStyle: 'italic',
                                whiteSpace: 'pre-wrap',
                            }}>
                                {/* Shimmer overlay when live */}
                                {isLive && (
                                    <style>{`
                                        @keyframes thoughtShimmer {
                                            0% { background-position: -400px 0; }
                                            100% { background-position: 400px 0; }
                                        }
                                    `}</style>
                                )}
                                <MarkdownRenderer content={thought} />
                                {isLive && (
                                    <motion.span
                                        animate={{ opacity: [1, 0] }}
                                        transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                                        style={{ display: 'inline-block', width: 2, height: '1em', backgroundColor: '#9ca3af', marginLeft: 2, verticalAlign: 'text-bottom' }}
                                    />
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// ── Inline SVG: progress circles (3-step) ───────────────────────────────────
export const ProgressStepsIcon = ({ done = 0 }: { done?: number }) => {
    // done = how many of 3 circles are filled with a check
    const circles = [0, 1, 2];
    return (
        <svg width="38" height="12" viewBox="0 0 38 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            {circles.map((i) => {
                const cx = i === 0 ? 6 : i === 1 ? 19 : 32;
                const filled = i < done;
                return (
                    <g key={i}>
                        {/* dash connector */}
                        {i > 0 && (
                            <line
                                x1={i === 1 ? 12 : 25} y1="6"
                                x2={i === 1 ? 13 : 26} y2="6"
                                stroke={filled ? 'currentColor' : '#d1d5db'}
                                strokeWidth="1.5"
                                strokeDasharray="2 1.5"
                                strokeLinecap="round"
                            />
                        )}
                        <circle
                            cx={cx} cy="6" r="5"
                            fill={filled ? 'currentColor' : 'none'}
                            stroke={filled ? 'none' : '#d1d5db'}
                            strokeWidth="1.5"
                            opacity={filled ? 0.8 : 1}
                        />
                        {filled && (
                            <path
                                d={`M${cx - 2.5} 6 L${cx - 0.5} 8 L${cx + 2.5} 4`}
                                stroke="white"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

// ── Inline SVG: context thumbnail grid ──────────────────────────────────────
export const ContextGridIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4" />
    </svg>
);

// ── Section wrapper ──────────────────────────────────────────────────────────
export const PaneSection = ({
    icon, label, badge, children, defaultOpen = true,
}: {
    icon: React.ReactNode;
    label: string;
    badge?: number;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ marginBottom: 4 }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer',
                }}
            >
                <span style={{ color: '#a1a1aa', display: 'flex', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1, textAlign: 'left' }}>
                    {label}
                </span>
                {badge !== undefined && (
                    <span style={{ fontSize: 10, color: '#9ca3af', backgroundColor: '#f3f4f6', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{badge}</span>
                )}
                <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    style={{ display: 'flex', color: '#9ca3af' }}
                >
                    <ChevronDownIcon width={13} height={13} color="currentColor" />
                </motion.span>
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ paddingBottom: 16 }}>{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ── Main ReasoningPane ───────────────────────────────────────────────────────
export const ReasoningPane = ({
    isOpen, onClose, thought, toolCalls, isLive,
    intent, confidence, context, progress,
}: {
    isOpen: boolean;
    onClose: () => void;
    thought?: string;
    toolCalls: ToolCallDisplay[];
    isLive: boolean;
    intent?: string;
    confidence?: number;
    context?: { completedSteps: string[]; pendingSteps: string[]; filesModified: string[] };
    progress?: { current: number; total: number };
}) => {
    const doneCount = progress
        ? Math.round((progress.current / progress.total) * 3)
        : toolCalls.filter(t => t.status === 'done').length > 0
            ? Math.min(toolCalls.filter(t => t.status === 'done').length, 2)
            : 0;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ x: '100%', opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                    style={{
                        position: 'fixed', top: 52, right: 0, bottom: 0, width: 340,
                        backgroundColor: '#ffffff', borderLeft: '1px solid #e5e7eb',
                        zIndex: 100, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                        boxShadow: '-6px 0 24px rgba(0,0,0,0.04)',
                    }}
                >
                    {/* ── Header ── */}
                    <div style={{
                        padding: '16px 20px 14px',
                        borderBottom: '1px solid #f3f4f6',
                        display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                        {/* Progress icon — updates as tools complete */}
                        <div style={{ color: isLive ? '#6366f1' : '#6b7280', display: 'flex', flexShrink: 0 }}>
                            <ProgressStepsIcon done={doneCount} />
                        </div>

                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Agent Activity</div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                                {isLive ? (
                                    <>
                                        <motion.span
                                            animate={{ opacity: [1, 0.3, 1] }}
                                            transition={{ repeat: Infinity, duration: 1.4 }}
                                            style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }}
                                        />
                                        Processing
                                    </>
                                ) : (
                                    <>
                                        <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
                                            <circle cx="4" cy="4" r="3.5" stroke="#22c55e" strokeWidth="1" />
                                            <path d="M2 4L3.5 5.5L6 2.5" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        Completed
                                    </>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            style={{
                                width: 26, height: 26, borderRadius: 7, border: '1px solid #e5e7eb',
                                backgroundColor: 'transparent', color: '#9ca3af', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                        >
                            <XMarkIcon width={13} height={13} />
                        </button>
                    </div>

                    {/* ── Body ── */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

                        {/* Intent pill */}
                        {intent && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '4px 10px', borderRadius: 99,
                                    backgroundColor: 'rgba(99,102,241,0.08)',
                                    border: '1px solid rgba(99,102,241,0.18)',
                                }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#6366f1' }}>{intent}</span>
                                    {confidence !== undefined && (
                                        <span style={{ fontSize: 11, color: '#a5b4fc' }}>{Math.round(confidence * 100)}%</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Thought / Reasoning */}
                        <PaneSection
                            icon={
                                isLive ? (
                                    <span style={{ display: 'flex', gap: 3 }}>
                                        {[0, 0.15, 0.3].map((delay, i) => (
                                            <motion.span key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay }}
                                                style={{ display: 'block', width: 4, height: 4, borderRadius: '50%', backgroundColor: '#9ca3af' }} />
                                        ))}
                                    </span>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                    </svg>
                                )
                            }
                            label="Reasoning"
                        >
                            {thought ? (
                                <div style={{
                                    fontSize: 12.5, lineHeight: 1.75, color: '#9ca3af',
                                    fontStyle: 'italic',
                                    borderLeft: '2px solid #e5e7eb',
                                    paddingLeft: 12,
                                    maxHeight: 220, overflowY: 'auto',
                                }}>
                                    <MarkdownRenderer content={thought} />
                                    {isLive && (
                                        <motion.span
                                            animate={{ opacity: [1, 0] }}
                                            transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                                            style={{ display: 'inline-block', width: 2, height: '0.9em', backgroundColor: '#9ca3af', marginLeft: 2, verticalAlign: 'text-bottom' }}
                                        />
                                    )}
                                </div>
                            ) : (
                                <span style={{ fontSize: 12, color: '#d1d5db', fontStyle: 'italic' }}>
                                    Waiting for model to reason…
                                </span>
                            )}
                        </PaneSection>

                        {/* Progress bar */}
                        {progress && (
                            <PaneSection
                                icon={<ProgressStepsIcon done={doneCount} />}
                                label="Progress"
                            >
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{ fontSize: 12, color: '#6b7280' }}>Step {progress.current} of {progress.total}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#22c55e' }}>{Math.round((progress.current / progress.total) * 100)}%</span>
                                    </div>
                                    <div style={{ width: '100%', height: 3, borderRadius: 99, backgroundColor: '#f3f4f6', overflow: 'hidden' }}>
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                                            style={{ height: '100%', borderRadius: 99, backgroundColor: '#22c55e' }}
                                        />
                                    </div>
                                </div>
                            </PaneSection>
                        )}

                        {/* Tools — the timeline */}
                        <PaneSection
                            icon={
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                                </svg>
                            }
                            label="Tools"
                            badge={toolCalls.length}
                        >
                            {toolCalls.length === 0 ? (
                                <span style={{ fontSize: 12, color: '#d1d5db', fontStyle: 'italic' }}>No tools called yet</span>
                            ) : (
                                <div style={{ borderLeft: '2px solid #e5e7eb', marginLeft: 4, paddingLeft: 14, display: 'flex', flexDirection: 'column' }}>
                                    {toolCalls.map((tc, idx) => (
                                        <motion.div
                                            key={tc.id || idx}
                                            initial={{ opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: idx * 0.04 }}
                                            style={{ position: 'relative', paddingBottom: idx < toolCalls.length - 1 ? 10 : 0 }}
                                        >
                                            {/* Rail dot */}
                                            <div style={{
                                                position: 'absolute', left: -20, top: 8,
                                                width: 8, height: 8, borderRadius: '50%',
                                                backgroundColor:
                                                    tc.status === 'running' ? '#f3f4f6'
                                                        : tc.status === 'error' ? 'rgba(239,68,68,0.15)'
                                                            : 'rgba(34,197,94,0.15)',
                                                border:
                                                    tc.status === 'running' ? '1.5px solid #d1d5db'
                                                        : tc.status === 'error' ? '1.5px solid rgba(239,68,68,0.4)'
                                                            : '1.5px solid rgba(34,197,94,0.4)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                {tc.status === 'running' ? (
                                                    <Loader size={4} strokeWidth={1.5} className="text-zinc-400" />
                                                ) : tc.status === 'error' ? (
                                                    <XMarkIcon width={5} height={5} color="#ef4444" strokeWidth={3} />
                                                ) : (
                                                    <svg width="5" height="5" viewBox="0 0 8 8" fill="none">
                                                        <path d="M1.5 4L3 5.5L6.5 2" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                )}
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ fontSize: 12, lineHeight: 1 }}>{tc.icon}</span>
                                                <span style={{ fontSize: 12, color: tc.status === 'running' ? '#9ca3af' : '#374151', fontStyle: tc.status === 'running' ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                    {tc.label || tc.toolName}
                                                </span>
                                                {tc.durationMs !== undefined && (
                                                    <span style={{ fontSize: 10.5, color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                                                        {(tc.durationMs / 1000).toFixed(1)}s
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </PaneSection>

                        {/* Context */}
                        {context && (
                            <PaneSection
                                icon={<ContextGridIcon />}
                                label="Context"
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {context.completedSteps.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Completed</div>
                                            {context.completedSteps.map((step, i) => (
                                                <div key={i} style={{ fontSize: 12, color: '#22c55e', marginBottom: 3, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                                                        <circle cx="5" cy="5" r="4.5" fill="rgba(34,197,94,0.1)" stroke="rgba(34,197,94,0.3)" strokeWidth="1" />
                                                        <path d="M3 5L4.5 6.5L7 3.5" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                    <span style={{ color: '#374151' }}>{step}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {context.pendingSteps.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Pending</div>
                                            {context.pendingSteps.map((step, i) => (
                                                <div key={i} style={{ fontSize: 12, color: '#9ca3af', marginBottom: 3, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                                    <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #d1d5db', flexShrink: 0, marginTop: 2 }} />
                                                    <span>{step}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {context.filesModified.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Files</div>
                                            {context.filesModified.map((file, i) => (
                                                <div key={i} style={{ fontSize: 11, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginBottom: 2 }}>{file}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </PaneSection>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ── ReasoningBlock ────────────────────────────────────────────────────────────
// Displays raw chain-of-thought (reasoning_content) as a collapsible indented block
// shown ABOVE the assistant's reply. Styled like a soft italic narrative.
export const ReasoningBlock = ({ content }: { content: string }) => {
    const [open, setOpen] = useState(false);
    if (!content?.trim()) return null;

    return (
        <div style={{ marginBottom: 12 }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '0 0 6px', color: '#9ca3af',
                }}
            >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span style={{ fontSize: 12.5, color: '#9ca3af', fontStyle: 'italic' }}>
                    {open ? 'Hide reasoning' : 'Show reasoning'}
                </span>
                <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    style={{ display: 'flex', marginLeft: 2 }}
                >
                    <ChevronDownIcon width={11} height={11} color="#9ca3af" />
                </motion.span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{
                            borderLeft: '2px solid #e5e7eb',
                            paddingLeft: 14,
                            marginLeft: 2,
                            marginBottom: 10,
                            maxHeight: 280,
                            overflowY: 'auto',
                        }}>
                            <div style={{
                                fontSize: 12.5,
                                lineHeight: 1.75,
                                color: '#9ca3af',
                                fontStyle: 'italic',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}>
                                {content}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
