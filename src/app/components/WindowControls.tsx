"use client";

import React, { useState } from "react";

/**
 * Traffic-light window controls: close (red), minimize (yellow), maximize (green).
 * Each dot has a thin darker rim and shows its glyph while the group is hovered.
 * Hidden on macOS where Electron provides native traffic lights.
 */
export default function WindowControls() {
    const [hover, setHover] = useState(false);
    const isMac = typeof window !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
    if (isMac) return null;

    const win = () => (window as any).electronAPI?.window;
    const dots = [
        { label: "Close", bg: "#ff5f57", rim: "#e0443e", glyph: "#4d0000", onClick: () => win()?.close?.(), path: "M3.5 3.5l5 5M8.5 3.5l-5 5" },
        { label: "Minimize", bg: "#febc2e", rim: "#dea123", glyph: "#5a3a00", onClick: () => win()?.minimize?.(), path: "M3 6h6" },
        { label: "Maximize", bg: "#28c840", rim: "#1aab29", glyph: "#003a00", onClick: () => win()?.maximize?.(), path: "M6 3v6M3 6h6" },
    ];

    return (
        <div
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px", WebkitAppRegion: "no-drag", zIndex: 9999 } as any}
        >
            {dots.map((d) => (
                <button
                    key={d.label}
                    type="button"
                    onClick={d.onClick}
                    aria-label={d.label}
                    title={d.label}
                    style={{
                        width: 13, height: 13, borderRadius: "50%", padding: 0, cursor: "pointer",
                        display: "grid", placeItems: "center", flexShrink: 0,
                        background: d.bg, border: `0.5px solid ${d.rim}`,
                        boxShadow: "0 0.5px 1px rgba(0,0,0,0.12)",
                    }}
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ opacity: hover ? 1 : 0, transition: "opacity 0.12s" }}>
                        <path d={d.path} stroke={d.glyph} strokeWidth="1.3" strokeLinecap="round" fill="none" />
                    </svg>
                </button>
            ))}
        </div>
    );
}
