'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';

export const GITHUB_REPO_URL = 'https://github.com/Everfern-AI/Everfern';

export default function StarRepoPopup({ onClose, onStar }: { onClose: () => void; onStar: () => void }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.88, opacity: 0, y: 30 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 20 }}
                transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                onClick={e => e.stopPropagation()}
                style={{
                    width: 420, maxWidth: '92vw',
                    backgroundColor: isDark ? '#1c1c1e' : '#ffffff',
                    borderRadius: 24,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                    boxShadow: isDark
                        ? '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
                        : '0 32px 80px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.03)',
                    padding: '36px 32px 28px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                {/* Subtle shimmer effect at top */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 120,
                    background: isDark
                        ? 'radial-gradient(ellipse at 50% -20%, rgba(250,204,21,0.08) 0%, transparent 70%)'
                        : 'radial-gradient(ellipse at 50% -20%, rgba(250,204,21,0.12) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }} />

                {/* Star icon */}
                <motion.div
                    animate={{ rotate: [0, -8, 8, -4, 0] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    style={{ fontSize: 44, marginBottom: 16, lineHeight: 1 }}
                >
                    ⭐
                </motion.div>

                <div style={{
                    fontSize: 20, fontWeight: 700,
                    color: isDark ? '#f5f5f4' : '#1a1a1a',
                    marginBottom: 10,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.3,
                    fontFamily: 'var(--font-sans)',
                }}>
                    Help us Out
                </div>

                <div style={{
                    fontSize: 14, lineHeight: 1.65,
                    color: isDark ? '#a8a29e' : '#6b6b6b',
                    marginBottom: 28,
                    maxWidth: 360,
                    fontFamily: 'var(--font-sans)',
                }}>
                    Help us Out by growing this small project to challenge corporate bullshit, by starring our repo which is <span style={{ color: '#eab308', fontWeight: 600 }}>https://github.com/Everfern-AI/Everfern</span>
                </div>

                {/* Star button — large, flat, theme-colored */}
                <motion.button
                    type="button"
                    onClick={() => {
                        try {
                            localStorage.setItem('everfern_github_starred', 'true');
                            localStorage.setItem('everfern_star_dismissed', 'true');
                        } catch (err) {}
                        onStar();
                    }}
                    whileHover={{ scale: 1.04, y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    style={{
                        width: '100%',
                        padding: '14px 24px',
                        borderRadius: 14,
                        border: isDark ? 'none' : '1px solid #e5e7eb',
                        fontSize: 15.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        background: isDark ? '#ffffff' : '#181717',
                        color: isDark ? '#1a1a1a' : '#ffffff',
                        boxShadow: 'none',
                        letterSpacing: '-0.01em',
                        transition: 'background-color 0.2s ease',
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    Star on GitHub
                </motion.button>

                {/* Close / maybe later — intentionally subtle */}
                <button
                    type="button"
                    onClick={() => {
                        try {
                            localStorage.setItem('everfern_star_dismissed', 'true');
                        } catch (err) {}
                        onClose();
                    }}
                    style={{
                        marginTop: 14,
                        background: 'none',
                        border: 'none',
                        fontSize: 12.5,
                        color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        transition: 'color 0.15s ease',
                        letterSpacing: '-0.01em',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)'; }}
                >
                    Maybe later
                </button>
            </motion.div>
        </motion.div>
    );
}
