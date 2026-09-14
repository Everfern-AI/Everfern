"use client";

import React from "react";

/**
 * Mac-style traffic light window controls.
 * Close (red), Minimize (yellow), Maximize (green).
 * Hidden on macOS where Electron provides native traffic lights.
 */
export default function WindowControls() {
    // On macOS, Electron already renders native traffic lights — hide ours
    const isMac = typeof window !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
    if (isMac) {
        return null;
    }

    const handleClose = () => {
        if ((window as any).electronAPI?.window?.close) {
            (window as any).electronAPI.window.close();
        }
    };

    const handleMinimize = () => {
        if ((window as any).electronAPI?.window?.minimize) {
            (window as any).electronAPI.window.minimize();
        }
    };

    const handleMaximize = () => {
        if ((window as any).electronAPI?.window?.maximize) {
            (window as any).electronAPI.window.maximize();
        }
    };

    const dotStyle: React.CSSProperties = {
        width: 13,
        height: 13,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "opacity 0.15s, transform 0.1s",
    };

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 4px",
                WebkitAppRegion: "no-drag",
                zIndex: 9999,
            } as any}
        >
            {/* Close */}
            <button
                onClick={handleClose}
                aria-label="Close"
                style={{ ...dotStyle, backgroundColor: "#ff5f57" }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.transform = "scale(1.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
            />
            {/* Minimize */}
            <button
                onClick={handleMinimize}
                aria-label="Minimize"
                style={{ ...dotStyle, backgroundColor: "#febc2e" }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.transform = "scale(1.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
            />
            {/* Maximize */}
            <button
                onClick={handleMaximize}
                aria-label="Maximize"
                style={{ ...dotStyle, backgroundColor: "#28c841" }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.75"; e.currentTarget.style.transform = "scale(1.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
            />
        </div>
    );
}
