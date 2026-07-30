"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/24/outline';

export interface ExecutionPlanPaneProps {
    executionPlan: string;
    isLoading: boolean;
    isPlanAlreadyApproved: boolean;
    onApprove: () => void;
    onClose: () => void;
}

export const ExecutionPlanPane: React.FC<ExecutionPlanPaneProps> = ({
    executionPlan,
    isLoading,
    isPlanAlreadyApproved,
    onApprove,
    onClose,
}) => {
    const shouldShowApproveButton = !isLoading && !isPlanAlreadyApproved;

    return (
        <motion.div
            key="exec-plan"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
                backgroundColor: "var(--color-bg-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                overflow: "hidden",
                minHeight: 480,
                width: "100%"
            }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: "12px 14px",
                borderBottom: '1px solid var(--color-border-subtle)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        backgroundColor: 'var(--color-bg-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        {isLoading ? (
                            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-primary)" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" stroke="var(--color-border)" strokeWidth="4" />
                                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="var(--color-text-primary)" stroke="none" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                        )}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>Execution Plan</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {shouldShowApproveButton && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onApprove();
                            }}
                            style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--color-text-inverse)",
                                backgroundColor: "var(--color-text-primary)",
                                padding: "4px 12px",
                                borderRadius: 6,
                                border: "none",
                                cursor: "pointer",
                                boxShadow: "none"
                            }}
                        >
                            Approve
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose();
                        }}
                        style={{
                            width: 24, height: 24, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: 'var(--color-bg-subtle)',
                            border: 'none', borderRadius: 6, cursor: 'pointer'
                        }}
                        title="Close"
                    >
                        <XMarkIcon width={14} height={14} color="var(--color-text-secondary)" />
                    </button>
                </div>
            </div>
            <div style={{
                padding: "12px 14px",
                maxHeight: 600,
                overflowY: 'auto',
                fontSize: 12,
                fontFamily: "'Figtree', system-ui, sans-serif",
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6
            }}>
                {executionPlan}
            </div>
        </motion.div>
    );
};
