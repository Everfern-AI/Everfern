"use client";

import React from 'react';
import { useTheme } from '@/components/ThemeProvider';

export function EverFernCloudLimitNotice() {
    return (
        <div style={{
            marginTop: 4,
            padding: 18,
            borderRadius: 16,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-subtle)',
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
            maxWidth: 560,
        }}>
            <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
            }}>🌿</div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                    You've reached your EverFern Cloud daily limit
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6 }}>
                    EverFern Cloud gives you managed access to our AI models with a daily usage allowance.
                    You've used today's allowance — it resets automatically at midnight. In the meantime you can
                    switch to your own API key in Settings to keep going, or check your usage details there.
                </p>
            </div>
        </div>
    );
}

export function EverFernCloudUsageBanner({ onUpgrade }: { onUpgrade: () => void }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const handleUpgradeClick = () => {
        const pricingUrl = 'https://everfern.app/pricing';
        if ((window as any).electronAPI?.system?.openExternal) {
            (window as any).electronAPI.system.openExternal(pricingUrl);
        } else if ((window as any).electronAPI?.shell?.openExternal) {
            (window as any).electronAPI.shell.openExternal(pricingUrl);
        } else {
            window.open(pricingUrl, '_blank');
        }
        onUpgrade();
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            width: '100%',
            boxSizing: 'border-box',
        }}>
            <span style={{
                fontSize: 13.5,
                fontWeight: 400,
                color: isDark ? '#e3e1d9' : '#4a4846',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '-0.01em',
            }}>
                You are out of free <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'default' }}>messages</span> until 12:00 AM
            </span>
            <button
                type="button"
                onClick={handleUpgradeClick}
                style={{
                    backgroundColor: isDark ? '#ffffff' : '#111111',
                    color: isDark ? '#111111' : '#ffffff',
                    padding: '5px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    letterSpacing: '-0.01em',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
                Upgrade
            </button>
        </div>
    );
}

export function PromptWrapper({
    isCloudUsageOver,
    onUpgrade,
    children,
}: {
    isCloudUsageOver: boolean;
    onUpgrade: () => void;
    children: React.ReactNode;
}) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    if (!isCloudUsageOver) {
        return <>{children}</>;
    }

    return (
        <div style={{
            width: "100%",
            backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.02)",
            border: "1px solid var(--color-border)",
            borderRadius: 20,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
        }}>
            <EverFernCloudUsageBanner onUpgrade={onUpgrade} />
            <div style={{ width: "100%" }}>
                {children}
            </div>
        </div>
    );
}
