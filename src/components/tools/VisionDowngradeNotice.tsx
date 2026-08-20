'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, EyeIcon } from '@heroicons/react/24/outline';

interface VisionDowngradeNoticeProps {
    isVisible: boolean;
    onClose: () => void;
}

export function VisionDowngradeNotice({ isVisible, onClose }: VisionDowngradeNoticeProps) {
    useEffect(() => {
        // Auto-dismiss after 10 seconds
        if (isVisible) {
            const timer = setTimeout(() => {
                onClose();
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [isVisible, onClose]);

    const handleUpgrade = () => {
        const url = 'https://everfern.app/pricing';
        if ((window as any).electronAPI?.system?.openExternal) {
            (window as any).electronAPI.system.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
        onClose();
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                    style={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 9999,
                        maxWidth: 360,
                    }}
                >
                    <div className="glossy" style={{
                        backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 14,
                        padding: '16px 18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                <EyeIcon width={18} height={18} color="#f59e0b" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h4 style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: 'var(--color-text-primary)',
                                    margin: '0 0 4px',
                                    lineHeight: 1.3,
                                }}>
                                    Vision model optimized
                                </h4>
                                <p style={{
                                    fontSize: 12,
                                    color: 'var(--color-text-secondary)',
                                    margin: 0,
                                    lineHeight: 1.4,
                                }}>
                                    You're using a cost-optimized vision model to maintain service availability.
                                    <button
                                        onClick={handleUpgrade}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            marginLeft: 4,
                                            color: '#f59e0b',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            textDecoration: 'underline',
                                            fontSize: 12,
                                        }}
                                    >
                                        Upgrade for higher quality
                                    </button>
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 4,
                                    cursor: 'pointer',
                                    color: 'var(--color-text-tertiary)',
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: -4,
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                            >
                                <XMarkIcon width={16} height={16} />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
