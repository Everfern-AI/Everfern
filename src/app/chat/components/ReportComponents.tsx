"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon } from "@heroicons/react/24/outline";

import { InlineLink } from "./MarkdownComponents";

// ── Report Link (inline trigger for report pane) ───────────────────────────────
const ReportLink = ({ content, onOpen }: { content: string; onOpen: (label: string, path: string) => void }) => {
    const computerLinkPattern = /\[([^\]]+)\]\(computer:\/\/\/([^)]+)\)/g;
    const links: Array<{ label: string; path: string }> = [];
    let match;
    while ((match = computerLinkPattern.exec(content)) !== null) {
        links.push({ label: match[1], path: match[2] });
    }

    if (links.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 mt-2.5">
            {links.map((link, idx) => (
                <button
                    key={idx}
                    onClick={() => onOpen(link.label, link.path)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-[7px] rounded-[10px] bg-[#f4f3ef] border border-[#e0ded9] text-[#4a4846] text-xs font-medium cursor-pointer transition-all duration-150 hover:bg-[#eceae4] hover:border-[#ccc9c3] hover:text-[#201e24]"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                    </svg>
                    {link.label}
                </button>
            ))}
        </div>
    );
};

// ── Helper for rendering labels with markdown links and basic styles ─────────
const RenderLabel = ({ label }: { label: string }) => {
    const inlineRender = (text: string, key: string): React.ReactNode => {
        const parts: React.ReactNode[] = [];
        let remaining = text;
        let idx = 0;

        const patterns: [RegExp, (m: RegExpMatchArray, k: string) => React.ReactNode][] = [
            [/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/, (m, k) => <InlineLink key={k} href={m[2]} label={m[1]} />],
            [/\*\*(.+?)\*\*/, (m, k) => <strong key={k} className="font-bold text-[#111111]">{inlineRender(m[1], k)}</strong>],
            [/\*([^*]+)\*/, (m, k) => <em key={k} className="italic text-[#4a4846]">{inlineRender(m[1], k)}</em>],
        ];

        while (remaining.length > 0) {
            let earliest = -1, bestMatch: RegExpMatchArray | null = null, bestRenderer: ((m: RegExpMatchArray, k: string) => React.ReactNode) | null = null;
            
            for (const [regex, renderer] of patterns) {
                const match = remaining.match(regex);
                if (match && match.index !== undefined) {
                    if (earliest === -1 || match.index < earliest) {
                        earliest = match.index; bestMatch = match; bestRenderer = renderer;
                    }
                }
            }

            if (!bestMatch || bestRenderer === null) { parts.push(remaining); break; }
            if (earliest > 0) parts.push(remaining.slice(0, earliest));
            parts.push(bestRenderer(bestMatch, `${key}-${idx++}`));
            remaining = remaining.slice(earliest + bestMatch[0].length);
        }

        return <React.Fragment key={key}>{parts}</React.Fragment>;
    };

    return <>{inlineRender(label, "label")}</>;
};

// ── Report Preview Pane ────────────────────────────────────────────────────────
const ReportPane = ({ isOpen, onClose, label, path }: { isOpen: boolean; onClose: () => void; label: string; path: string }) => {
    const isHtml = /\.(html?|htm)$/i.test(path);
    const [hostPath, setHostPath] = useState(path);

    useEffect(() => {
        const translate = async () => {
            try {
                const api = (window as any).electronAPI;
                if (api?.system?.toHostPath) {
                    const translated = await api.system.toHostPath(path);
                    setHostPath(translated);
                }
            } catch (err) {
                console.error('Failed to translate path:', err);
            }
        };
        translate();
    }, [path]);

    const fileUrl = `file:///${hostPath.replace(/\\/g, '/')}`;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ x: '100%', opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                    className="fixed top-3 right-3 bottom-3 w-[65vw] max-w-[1100px] bg-white border border-[#e8e6d9] rounded-3xl shadow-[−10px_0_40px_rgba(0,0,0,0.08),0_10px_30px_rgba(0,0,0,0.03)] z-1000 flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="px-7 py-5 border-b border-[#f0ede8] flex items-center justify-between bg-[#faf9f7]">
                        <div className="flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-[#f5f4f0] flex items-center justify-center border border-[#e8e6d9]">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#201e24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                                    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-[17px] font-semibold text-[#201e24] m-0">
                                    <RenderLabel label={label} />
                                </h2>
                                <p className="text-xs text-[#8a8886] mt-0.5 font-mono">{path.split(/[/\\]/).pop()}</p>
                            </div>
                        </div>
                        <div className="flex gap-2.5">
                            <button
                                onClick={() => {
                                    const api = (window as any).electronAPI;
                                    if (api?.system?.openExternal) {
                                        api.system.openExternal(fileUrl);
                                    } else {
                                        window.open(fileUrl, '_blank');
                                    }
                                }}
                                className="px-4 py-2 rounded-[10px] border border-[#e0ded9] bg-transparent text-[#4a4846] text-[13px] font-semibold cursor-pointer flex items-center gap-1.5 transition-all duration-150 hover:bg-[#f4f3ef]"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                                Open in Browser
                            </button>
                            <button
                                onClick={onClose}
                                className="w-9 h-9 rounded-[10px] bg-transparent border border-[#e0ded9] text-[#8a8886] cursor-pointer flex items-center justify-center transition-all duration-150 hover:bg-[#f4f3ef] hover:text-[#201e24]"
                            >
                                <XMarkIcon width={18} height={18} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden bg-[#fafaf8]">
                        {isHtml ? (
                            <iframe
                                src={fileUrl}
                                title={label}
                                className="w-full h-full border-none block"
                                sandbox="allow-same-origin allow-scripts"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full flex-col gap-4">
                                <div className="w-16 h-16 rounded-[20px] bg-[#f4f3ef] flex items-center justify-center">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8a8886" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <p className="text-[15px] font-semibold text-[#201e24] mb-1">Preview not available</p>
                                    <p className="text-[13px] text-[#8a8886]">Open in browser to view this file</p>
                                </div>
                                <button
                                    onClick={() => {
                                        const api = (window as any).electronAPI;
                                        if (api?.system?.openExternal) {
                                            api.system.openExternal(fileUrl);
                                        } else {
                                            window.open(fileUrl, '_blank');
                                        }
                                    }}
                                    className="px-[22px] py-2.5 rounded-[10px] border-none bg-[#201e24] text-white text-[13px] font-semibold cursor-pointer"
                                >
                                    Open in Browser
                                </button>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ── Report Container (card shown in chat for generated reports) ───────────────
interface ReportContainerProps {
    content: string;
    onView: (label: string, path: string) => void;
}

const ReportContainer = ({ content, onView }: ReportContainerProps) => {
    const computerLinkPattern = /\[([^\]]+)\]\(computer:\/\/\/([^)]+)\)/g;
    const links: Array<{ label: string; path: string }> = [];
    let match;
    while ((match = computerLinkPattern.exec(content)) !== null) {
        links.push({ label: match[1], path: match[2] });
    }

    if (links.length === 0) return null;

    return (
        <div className="flex flex-col gap-4 mt-6">
            {links.map((link, idx) => {
                const ext = link.path.split('.').pop()?.toUpperCase() || 'FILE';
                const isCode = ['HTML', 'JSON', 'JS', 'TS', 'TSX', 'CSS', 'PY'].includes(ext);
                
                return (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: idx * 0.08, ease: "easeOut" }}
                        className="flex items-center justify-between px-8 py-6 rounded-[24px] bg-white border border-[#e8e6d9] shadow-[0_2px_12px_rgba(0,0,0,0.02)] transition-all duration-300 hover:border-[#b4b2af] hover:shadow-[0_12px_30px_rgba(0,0,0,0.06)] group"
                        onClick={() => onView(link.label, link.path)}
                    >
                        {/* Left — Thumbnail & Info */}
                        <div className="flex items-center gap-8 flex-1 min-w-0">
                            {/* Premium Tilted Thumbnail */}
                            <div className="relative w-[64px] h-[80px] shrink-0">
                                <div className="absolute inset-0 bg-white border border-[#efefeb] rounded-xl transform -rotate-[6deg] translate-x-[-4px] translate-y-[2px] shadow-sm opacity-60"></div>
                                <div className="absolute inset-0 bg-white border border-[#e8e6d9] rounded-xl shadow-md flex items-center justify-center overflow-hidden z-10 transition-transform duration-300 group-hover:scale-105">
                                    {isCode ? (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8a8886" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                                            <polyline points="16 18 22 12 16 6" />
                                            <polyline points="8 6 2 12 8 18" />
                                        </svg>
                                    ) : (
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8a8886" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                        </svg>
                                    )}
                                </div>
                            </div>

                            {/* Label Content */}
                            <div className="flex flex-col gap-1 min-w-0">
                                <span className="text-[18px] font-bold text-[#111111] leading-tight tracking-tight truncate">
                                    <RenderLabel label={link.label} />
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-[#86847F] font-bold uppercase tracking-widest leading-none">
                                        {ext} REPORT
                                    </span>
                                    <div className="w-1 h-1 bg-[#DEDAD5] rounded-full" />
                                    <span className="text-[13px] text-[#86847F] font-medium leading-none">
                                        Generated File
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Right — Standardized Split Button */}
                        <div className="flex items-center shrink-0">
                            <div className="flex items-center bg-white border border-[#e8e6d9] rounded-xl h-[42px] shadow-sm hover:shadow-md transition-all duration-200">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onView(link.label, link.path);
                                    }}
                                    className="flex items-center gap-2.5 px-4 h-full border-r border-[#e8e6d9] text-[14px] font-bold text-[#111111] hover:bg-[#fafafa] active:bg-[#f0f0f0] transition-all"
                                >
                                    <div className="w-[18px] h-[18px] bg-[#111] rounded-[4px] flex items-center justify-center">
                                        <span className="text-white text-[10px] font-black font-mono">V</span>
                                    </div>
                                    View
                                </button>
                                <button
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center justify-center w-[38px] h-full text-[#888888] hover:text-[#111] hover:bg-[#fafafa] transition-all"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
};

export { ReportLink, ReportPane, ReportContainer };
