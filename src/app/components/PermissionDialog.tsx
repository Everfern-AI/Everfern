'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

export default function PermissionDialog() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handlePermissionRequest = async () => {
            setIsOpen(true);

            // Play the permission sound via IPC
            try {
                if ((window as any).electronAPI?.acp?.playSound) {
                    await (window as any).electronAPI.acp.playSound('permission.mp3');
                }
            } catch (err) {
                console.error('Failed to play permission sound:', err);
            }
        };

        // Listen for permission request from main process
        if ((window as any).electronAPI?.acp?.onAgentPermissionRequest) {
            (window as any).electronAPI.acp.onAgentPermissionRequest(handlePermissionRequest);
        }

        return () => {
            // Cleanup
            if ((window as any).electronAPI?.acp?.removeStreamListeners) {
                try {
                    (window as any).electronAPI.acp.removeStreamListeners();
                } catch (e) {
                    console.error('Failed to remove listeners:', e);
                }
            }
        };
    }, []);

    const handleAccept = async () => {
        setIsOpen(false);
        if ((window as any).electronAPI?.acp?.agentPermissionResponse) {
            await (window as any).electronAPI.acp.agentPermissionResponse(true);
        }
    };

    const handleReject = async () => {
        setIsOpen(false);
        if ((window as any).electronAPI?.acp?.agentPermissionResponse) {
            await (window as any).electronAPI.acp.agentPermissionResponse(false);
        }
    };

    return (
        <>
            {/* Permission Dialog */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={handleReject}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                zIndex: 9998,
                            }}
                        />

                        {/* Dialog */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: -20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: -20 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                margin: 'auto',
                                width: '90%',
                                maxWidth: 420,
                                height: 'fit-content',
                                backgroundColor: 'var(--color-bg-surface)',
                                borderRadius: 16,
                                boxShadow: '0 25px 50px rgba(0, 0, 0, 0.3)',
                                zIndex: 9999,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Header */}
                            <div
                                style={{
                                    padding: 24,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 16,
                                    borderBottom: '1px solid var(--color-border)',
                                }}
                            >
                                <div
                                    style={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: 12,
                                        backgroundColor: 'var(--color-bg-subtle)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <svg
                                        width={24}
                                        height={24}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="var(--color-text-primary)"
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                    </svg>
                                </div>
                                <div>
                                    <h2
                                        style={{
                                            margin: 0,
                                            fontSize: 16,
                                            fontWeight: 700,
                                            color: 'var(--color-text-primary)',
                                        }}
                                    >
                                        Permission Required
                                    </h2>
                                    <p
                                        style={{
                                            margin: '4px 0 0 0',
                                            fontSize: 13,
                                            color: 'var(--color-text-secondary)',
                                        }}
                                    >
                                        EverFern needs your approval
                                    </p>
                                </div>
                            </div>

                            {/* Body */}
                            <div
                                style={{
                                    padding: 24,
                                    flex: 1,
                                }}
                            >
                                <p
                                    style={{
                                        margin: '0 0 12px 0',
                                        fontSize: 14,
                                        lineHeight: 1.6,
                                        color: 'var(--color-text-primary)',
                                    }}
                                >
                                    The AI agent needs permission to execute system commands and manage files for this operation.
                                </p>
                                <div
                                    style={{
                                        backgroundColor: 'var(--color-bg-subtle)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 12,
                                        padding: 12,
                                        marginTop: 16,
                                    }}
                                >
                                    <p
                                        style={{
                                            margin: 0,
                                            fontSize: 12,
                                            color: 'var(--color-text-secondary)',
                                            fontWeight: 500,
                                        }}
                                    >
                                        ⚠️ This is a sensitive operation. Only approve if you trust the current task.
                                    </p>
                                </div>
                            </div>

                            {/* Footer */}
                            <div
                                style={{
                                    padding: 16,
                                    display: 'flex',
                                    gap: 12,
                                    borderTop: '1px solid var(--color-border)',
                                    backgroundColor: 'var(--color-bg-surface)',
                                }}
                            >
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={handleReject}
                                    style={{
                                        flex: 1,
                                        height: 40,
                                        borderRadius: 10,
                                        border: '1px solid var(--color-border)',
                                        backgroundColor: 'var(--color-bg-surface)',
                                        color: 'var(--color-text-primary)',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                    }}
                                    onMouseEnter={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
                                        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)';
                                    }}
                                    onMouseLeave={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-surface)';
                                        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                                    }}
                                >
                                    <XCircleIcon width={16} height={16} />
                                    Reject
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={handleAccept}
                                    style={{
                                        flex: 1,
                                        height: 40,
                                        borderRadius: 10,
                                        border: 'none',
                                        backgroundColor: 'var(--color-text-primary)',
                                        color: 'var(--color-text-inverse)',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                    }}
                                    onMouseEnter={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.opacity = '0.9';
                                    }}
                                    onMouseLeave={(e: React.MouseEvent) => {
                                        (e.currentTarget as HTMLElement).style.opacity = '1';
                                    }}
                                >
                                    <CheckCircleIcon width={16} height={16} />
                                    Accept
                                </motion.button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
