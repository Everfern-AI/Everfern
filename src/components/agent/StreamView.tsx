"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface StreamViewProps {
    content: string;
    isLive: boolean;
    showCursor?: boolean;
}

const StreamView = ({ content, isLive, showCursor = true }: StreamViewProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [content]);

    const renderedContent = useMemo(() => {
        if (!content) return null;

        const lines = content.split("\n");
        const elements: React.ReactNode[] = [];

        let inCodeBlock = false;
        let codeLanguage = "";
        let codeContent: string[] = [];

        lines.forEach((line, idx) => {
            if (line.startsWith("```")) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeLanguage = line.slice(3).trim();
                    codeContent = [];
                } else {
                    elements.push(
                        <div key={`code-${idx}`} style={{ margin: "8px 0" }}>
                            <div
                                style={{
                                    backgroundColor: "#1e1e2e",
                                    borderRadius: "8px 8px 0 0",
                                    padding: "6px 12px",
                                    fontSize: 11,
                                    color: 'var(--color-text-tertiary)',
                                    fontFamily: "'JetBrains Mono', monospace",
                                    borderBottom: "1px solid #333",
                                }}
                            >
                                {codeLanguage || "code"}
                            </div>
                            <div
                                style={{
                                    backgroundColor: "#13131a",
                                    borderRadius: "0 8px 8px 8px",
                                    padding: "12px",
                                    fontFamily: "'JetBrains Mono', monospace",
                                    fontSize: 12,
                                    lineHeight: 1.6,
                                    color: "#e2e8f0",
                                    overflowX: "auto",
                                    whiteSpace: "pre-wrap",
                                }}
                            >
                                {codeContent.join("\n")}
                            </div>
                        </div>
                    );
                    inCodeBlock = false;
                    codeLanguage = "";
                }
                return;
            }

            if (inCodeBlock) {
                codeContent.push(line);
                return;
            }

            if (line.trim() === "") {
                elements.push(<div key={idx} style={{ height: 8 }} />);
                return;
            }

            if (line.startsWith("# ")) {
                elements.push(
                    <h1
                        key={idx}
                        style={{
                            fontSize: 22,
                            fontWeight: 600,
                            color: 'var(--color-bg-surface)',
                            margin: "16px 0 8px",
                            fontFamily: "system-ui, sans-serif",
                        }}
                    >
                        {line.slice(2)}
                    </h1>
                );
                return;
            }

            if (line.startsWith("## ")) {
                elements.push(
                    <h2
                        key={idx}
                        style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: "#e5e5e5",
                            margin: "14px 0 6px",
                            fontFamily: "system-ui, sans-serif",
                        }}
                    >
                        {line.slice(3)}
                    </h2>
                );
                return;
            }

            if (line.startsWith("### ")) {
                elements.push(
                    <h3
                        key={idx}
                        style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'var(--color-border)',
                            margin: "12px 0 4px",
                        }}
                    >
                        {line.slice(4)}
                    </h3>
                );
                return;
            }

            if (line.startsWith("- ") || line.startsWith("* ")) {
                const items: string[] = [line.slice(2)];
                let nextIdx = idx + 1;
                while (nextIdx < lines.length && (lines[nextIdx].startsWith("- ") || lines[nextIdx].startsWith("* "))) {
                    items.push(lines[nextIdx].slice(2));
                    nextIdx++;
                }
                elements.push(
                    <ul
                        key={`ul-${idx}`}
                        style={{
                            margin: "8px 0",
                            paddingLeft: 20,
                            color: 'var(--color-border)',
                        }}
                    >
                        {items.map((item, i) => (
                            <li key={i} style={{ marginBottom: 4, lineHeight: 1.6 }}>
                                {item}
                            </li>
                        ))}
                    </ul>
                );
                return;
            }

            if (line.match(/^\d+\. /)) {
                elements.push(
                    <p
                        key={idx}
                        style={{
                            margin: "4px 0",
                            lineHeight: 1.7,
                            color: "#e5e5e5",
                        }}
                    >
                        {line}
                    </p>
                );
                return;
            }

            elements.push(
                <p
                    key={idx}
                    style={{
                        margin: "4px 0",
                        lineHeight: 1.7,
                        color: "#e5e5e5",
                    }}
                >
                    {line}
                </p>
            );
        });

        return elements;
    }, [content]);

    return (
        <div
            ref={containerRef}
            style={{
                backgroundColor: "#0d0d14",
                borderRadius: 12,
                padding: "16px 20px",
                border: "1px solid #2a2a3a",
                minHeight: 60,
                maxHeight: 400,
                overflowY: "auto",
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 14,
                lineHeight: 1.7,
                color: "#e2e8f0",
            }}
        >
            {renderedContent}
            {isLive && showCursor && (
                <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.7 }}
                    style={{
                        display: "inline-block",
                        width: 8,
                        height: 16,
                        backgroundColor: "#6366f1",
                        marginLeft: 2,
                        verticalAlign: "text-bottom",
                    }}
                />
            )}
        </div>
    );
};

export default StreamView;
