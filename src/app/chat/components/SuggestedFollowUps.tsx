"use client";

import React from 'react';

export interface FollowUpItem {
    text: string;
    icon?: React.ReactNode;
}

export interface SuggestedFollowUpsProps {
    followUps: FollowUpItem[];
    onSelect: (text: string) => void;
}

export const SuggestedFollowUps: React.FC<SuggestedFollowUpsProps> = ({
    followUps,
    onSelect
}) => {
    if (!followUps || followUps.length === 0) return null;

    return (
        <div style={{
            marginTop: 18,
            marginBottom: 8,
            width: "100%",
            maxWidth: 640,
            display: "flex",
            flexDirection: "column",
            gap: 8
        }}>
            <div style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-text-tertiary)",
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                marginBottom: 4,
                paddingLeft: 4
            }}>
                Suggested follow-ups
            </div>
            <div style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                overflow: "hidden",
                backgroundColor: "var(--color-bg-surface)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
            }}>
                {followUps.map((item, idx) => (
                    <button
                        key={idx}
                        type="button"
                        onClick={() => onSelect(item.text)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 16px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            width: "100%",
                            textAlign: "left",
                            color: "var(--color-text-primary)",
                            fontFamily: "var(--font-sans)",
                            fontSize: 13.5,
                            borderBottom: idx < followUps.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
                            transition: "background-color 0.15s ease",
                            outline: "none"
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                        }}
                    >
                        {item.icon && (
                            <span style={{
                                fontSize: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                backgroundColor: "var(--color-bg-subtle)",
                                flexShrink: 0
                            }}>
                                {item.icon}
                            </span>
                        )}
                        <span style={{ flex: 1, fontWeight: 500, lineHeight: 1.4 }}>
                            {item.text}
                        </span>
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}
                        >
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    );
};
