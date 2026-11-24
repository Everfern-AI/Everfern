"use client";

import React from "react";

/**
 * Windows/Linux caption buttons: minimize, maximize, close, in the platform's order and shape.
 * Close turns red on hover, like the system title bar. Hidden on macOS, where Electron draws the native ones.
 */
export default function WindowControls() {
    const isMac = typeof window !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
    if (isMac) return null;

    const win = () => (window as any).electronAPI?.window;
    const buttons = [
        { label: "Minimize", onClick: () => win()?.minimize?.(), path: "M1 5.5h9", danger: false },
        { label: "Maximize", onClick: () => win()?.maximize?.(), path: "M1.5 1.5h8v8h-8z", danger: false },
        { label: "Close", onClick: () => win()?.close?.(), path: "M1 1l9 9M10 1l-9 9", danger: true },
    ];

    // A same-width spacer holds the buttons' place in the header; the buttons sit flush in the window's top-right corner.
    return (
        <>
        <div aria-hidden style={{ width: 138, flexShrink: 0 }} />
        <div className="ef-caption-dock">
            {buttons.map((b) => (
                <button
                    key={b.label}
                    type="button"
                    onClick={b.onClick}
                    aria-label={b.label}
                    title={b.label}
                    className={b.danger ? "ef-caption-btn ef-caption-close" : "ef-caption-btn"}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
                        <path d={b.path} stroke="currentColor" strokeWidth="1" fill="none" shapeRendering="crispEdges" />
                    </svg>
                </button>
            ))}
        </div>
        </>
    );
}
