"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface InlineVisualizationProps {
    html: string;
    css?: string;
    js?: string;
    title?: string;
    height?: number;
}

export const InlineVisualization: React.FC<InlineVisualizationProps> = ({
    html,
    css,
    js,
    title,
    height = 300
}) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        if (!iframeRef.current) return;

        const doc = iframeRef.current.contentDocument;
        if (!doc) return;

        // Construct full HTML content
        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body {
                        font-family: 'Figtree', system-ui, -apple-system, sans-serif;
                        margin: 0;
                        padding: 16px;
                        background-color: transparent;
                        overflow-x: hidden;
                    }
                    ${css || ""}
                </style>
            </head>
            <body>
                ${html}
                ${js ? `<script>${js}</script>` : ""}
            </body>
            </html>
        `;

        doc.open();
        doc.write(fullHtml);
        doc.close();
    }, [html, css, js]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{
                width: "100%",
                maxWidth: "800px",
                margin: "16px 0",
                borderRadius: "16px",
                overflow: "hidden",
                border: "1px solid #e8e6d9",
                backgroundColor: "#ffffff",
                boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
                display: "flex",
                flexDirection: "column"
            }}
        >
            {title && (
                <div style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid #f0ede8",
                    backgroundColor: "#faf9f7",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                        <path d="M22 12A10 10 0 0 0 12 2v10z" />
                    </svg>
                    <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#201e24",
                        fontFamily: "'Figtree', system-ui, sans-serif",
                        letterSpacing: "-0.01em"
                    }}>
                        {title}
                    </span>
                </div>
            )}
            <iframe
                ref={iframeRef}
                style={{
                    width: "100%",
                    height: `${height}px`,
                    border: "none",
                    display: "block"
                }}
                sandbox="allow-scripts allow-same-origin"
                title={title || "Inline Visualization"}
            />
        </motion.div>
    );
};
