'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    CheckIcon, 
    ChevronDownIcon, 
    ChevronUpIcon,
    AdjustmentsHorizontalIcon 
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import type { MissionTimeline, MissionStep } from './MissionTimeline';

interface MissionProgressCardProps {
    timeline: MissionTimeline | null;
    isRunning: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
}

const MissionProgressCard: React.FC<MissionProgressCardProps> = ({
    timeline,
    isRunning,
    isExpanded,
    onToggleExpand
}) => {
    if (!timeline || !timeline.steps || timeline.steps.length === 0) {
        return null;
    }

    const completedCount = timeline.completedSteps || 0;
    const totalCount = timeline.totalSteps || 0;
    const progressPercent = (completedCount / totalCount) * 100;

    return (
        <div style={{ 
            backgroundColor: "#ffffff", 
            border: "1px solid #e8e6d9", 
            borderRadius: 10, 
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
        }}>
            {/* Header */}
            <button
                type="button"
                onClick={onToggleExpand}
                style={{ 
                    width: "100%", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between", 
                    padding: "10px 14px", 
                    background: "none", 
                    border: "none", 
                    cursor: "pointer" 
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Progress</span>
                    {isRunning && (
                        <div style={{ 
                            width: 6, 
                            height: 6, 
                            borderRadius: "50%", 
                            backgroundColor: "#10b981",
                            boxShadow: "0 0 8px rgba(16, 185, 129, 0.6)"
                        }} />
                    )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AdjustmentsHorizontalIcon width={14} height={14} style={{ color: "#9ca3af" }} />
                    {isExpanded ? (
                        <ChevronUpIcon width={14} height={14} style={{ color: "#9ca3af" }} />
                    ) : (
                        <ChevronDownIcon width={14} height={14} style={{ color: "#9ca3af" }} />
                    )}
                </div>
            </button>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{ padding: "0 14px 14px" }}>
                            {/* Progress bar */}
                            <div style={{ 
                                width: "100%", 
                                height: 4, 
                                backgroundColor: "#f3f4f6", 
                                borderRadius: 2, 
                                marginBottom: 16,
                                overflow: "hidden"
                            }}>
                                <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progressPercent}%` }}
                                    style={{ 
                                        height: "100%", 
                                        backgroundColor: "#111827",
                                        borderRadius: 2
                                    }} 
                                />
                            </div>

                            {/* Steps List */}
                            <div style={{ 
                                display: "flex", 
                                flexDirection: "column", 
                                gap: 2,
                                maxHeight: 320,
                                overflowY: "auto",
                                paddingRight: 4,
                                scrollbarWidth: "thin"
                            }} className="custom-scrollbar">
                                {timeline.steps.map((step, idx) => (
                                    <StepItem 
                                        key={step.id} 
                                        step={step} 
                                        index={idx + 1} 
                                        isLast={idx === timeline.steps.length - 1} 
                                    />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const StepItem: React.FC<{ step: MissionStep; index: number; isLast: boolean }> = ({ step, index, isLast }) => {
    const isCompleted = step.status === 'completed';
    const isInProgress = step.status === 'in-progress';
    const isPending = step.status === 'pending' || step.status === 'skipped';

    const formatIndex = (n: number) => n.toString().padStart(2, '0');

    return (
        <div style={{ 
            display: "flex", 
            gap: 12, 
            padding: "10px 0",
            borderBottom: isLast ? "none" : "1px solid #f3f4f6",
            opacity: isPending ? 0.5 : 1,
            position: "relative"
        }}>
            {/* Left: Number or Check */}
            <div style={{ 
                width: 20, 
                height: 20, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2
            }}>
                {isCompleted ? (
                    <CheckCircleSolidIcon width={18} height={18} style={{ color: "#111827" }} />
                ) : (
                    <span style={{ 
                        fontSize: 11, 
                        fontWeight: 700, 
                        color: isInProgress ? "#111827" : "#9ca3af",
                        fontFamily: "monospace"
                    }}>
                        {formatIndex(index)}
                    </span>
                )}
            </div>

            {/* Middle: Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                    fontSize: 11.5, 
                    fontWeight: 600, 
                    color: "#111827",
                    marginBottom: 2,
                    textDecoration: isCompleted ? "line-through" : "none",
                    opacity: isCompleted ? 0.6 : 1
                }}>
                    {step.name}
                </div>
                <div style={{ 
                    fontSize: 10.5, 
                    color: "#6b7280",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                }}>
                    {step.description}
                </div>
            </div>

            {/* Right: Status Icon (if in progress) */}
            {isInProgress && (
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        style={{ width: 14, height: 14, border: "2px solid #f3f4f6", borderTopColor: "#111827", borderRadius: "50%" }}
                    />
                </div>
            )}
        </div>
    );
};

export default MissionProgressCard;
