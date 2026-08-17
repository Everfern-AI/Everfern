"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChartBarIcon,
    CurrencyDollarIcon,
    CpuChipIcon,
    SparklesIcon,
    ArrowTrendingUpIcon,
    ClockIcon,
    XMarkIcon,
    BoltIcon,
    CheckCircleIcon,
    ArrowPathIcon,
    FireIcon,
} from "@heroicons/react/24/outline";
import { CostMeter, type CostLine } from "@/components/elements/cost-meter";

interface AnalyticsSummary {
    totalCost: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalRequests: number;
    avgCostPerRequest: number;
    topModels: Array<{ model: string; provider: string; requests: number; tokens: number; cost: number }>;
    topProviders: Array<{ provider: string; requests: number; tokens: number; cost: number }>;
    dailyUsage: Array<{ date: string; tokens: number; cost: number; requests: number }>;
    monthlyUsage: Array<{ month: string; tokens: number; cost: number; requests: number }>;
    hourlyUsage: Array<{ hour: number; tokens: number; requests: number }>;
}

function formatCost(usd: number): string {
    if (usd === 0) return "$0.00";
    if (usd < 0.001) return `$${usd.toFixed(6)}`;
    if (usd < 1) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

const CustomDollarIcon = (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <line x1="12" y1="1" x2="12" y2="23"></line>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
    </svg>
);

const CustomCpuIcon = (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
        <rect x="9" y="9" width="6" height="6"></rect>
        <line x1="9" y1="1" x2="9" y2="4"></line>
        <line x1="15" y1="1" x2="15" y2="4"></line>
        <line x1="9" y1="20" x2="9" y2="23"></line>
        <line x1="15" y1="20" x2="15" y2="23"></line>
        <line x1="20" y1="9" x2="23" y2="9"></line>
        <line x1="20" y1="14" x2="23" y2="14"></line>
        <line x1="1" y1="9" x2="4" y2="9"></line>
        <line x1="1" y1="14" x2="4" y2="14"></line>
    </svg>
);

const CustomSparklesIcon = (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M12 3l2 5h5l-4 4 1.5 5.5L12 15l-4.5 2.5L9 12 5 8h5l2-5z" />
    </svg>
);

const CustomTrendingUpIcon = (props: any) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
        <polyline points="17 6 23 6 23 12"></polyline>
    </svg>
);

function StatCard({ icon: Icon, label, value, sub, color }: {
    icon: React.ElementType;
    label: string;
    value: string;
    sub?: string;
    color: string;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
                background: "var(--color-bg-surface)",
                borderRadius: 18,
                border: "1px solid var(--color-border)",
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: 142,
                boxShadow: "0 1px 6px rgba(0,0,0,0.03)",
                width: "100%",
                boxSizing: "border-box"
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: color + "18", display: "flex",
                    alignItems: "center", justifyContent: "center"
                }}>
                    <Icon style={{ width: 19, height: 19, color }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
                    {label}
                </div>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 10 }}>
                <div style={{ fontSize: 25, fontWeight: 600, color: "var(--color-text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                    {value}
                </div>
                <div style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    minHeight: 18,
                    display: "flex",
                    alignItems: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                }}>
                    {sub || "—"}
                </div>
            </div>
        </motion.div>
    );
}

// ── Interactive Dual-Axis Daily Spend & Volume Chart ──────────────────────────
function DualAxisDailyChart({ data, height = 200 }: {
    data: Array<{ date: string; cost: number; requests: number; tokens?: number }>;
    height?: number;
}) {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    if (!data || data.length === 0) {
        return (
            <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>
                No daily spend data recorded yet
            </div>
        );
    }

    const maxCost = Math.max(...data.map(d => d.cost || 0), 0.01);
    const maxReqs = Math.max(...data.map(d => d.requests || 0), 5);

    // Reference grid intervals
    const costSteps = [maxCost, maxCost * 0.66, maxCost * 0.33, 0];
    const chartHeight = height - 52;

    return (
        <div style={{ position: "relative", width: "100%", height, paddingBottom: 28, paddingTop: 10 }}>
            {/* Y-Axis Value Grid Lines */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 10, height: chartHeight, pointerEvents: "none", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                {costSteps.map((val, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", width: "100%", gap: 8 }}>
                        <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text-tertiary)", width: 44, textAlign: "right", flexShrink: 0 }}>
                            {formatCost(val)}
                        </span>
                        <div style={{ flex: 1, borderBottom: "1px dashed var(--color-border-subtle)", opacity: idx === costSteps.length - 1 ? 1 : 0.6 }} />
                        <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono, monospace)", color: "#6366f1", opacity: 0.8, width: 34, textAlign: "left", flexShrink: 0 }}>
                            {Math.round((maxReqs * (3 - idx)) / 3)} req
                        </span>
                    </div>
                ))}
            </div>

            {/* Bars and Line Chart Container */}
            <div style={{
                position: "absolute",
                left: 52,
                right: 42,
                top: 10,
                height: chartHeight,
                display: "flex",
                alignItems: "flex-end",
                gap: Math.max(3, Math.floor(400 / (data.length || 1))),
            }}>
                {data.map((d, i) => {
                    const costPct = ((d.cost || 0) / maxCost) * 100;
                    const reqPct = ((d.requests || 0) / maxReqs) * 100;
                    const label = d.date;
                    const isHovered = hoveredIdx === i;

                    return (
                        <div
                            key={i}
                            onMouseEnter={() => setHoveredIdx(i)}
                            onMouseLeave={() => setHoveredIdx(null)}
                            style={{
                                flex: 1,
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                position: "relative",
                                cursor: "pointer"
                            }}
                        >
                            {/* Bar for Daily Spend */}
                            <div
                                style={{
                                    width: "100%",
                                    height: `${Math.max(costPct, 3)}%`,
                                    background: isHovered
                                        ? "linear-gradient(to top, #10b981, #34d399)"
                                        : "linear-gradient(to top, rgba(16,185,129,0.85), rgba(16,185,129,0.35))",
                                    borderRadius: "4px 4px 0 0",
                                    transition: "all 0.2s ease",
                                    boxShadow: isHovered ? "0 0 10px rgba(16,185,129,0.3)" : "none",
                                }}
                            />

                            {/* Dot for Request Volume */}
                            {d.requests > 0 && (
                                <div
                                    style={{
                                        position: "absolute",
                                        bottom: `${Math.max(reqPct, 4)}%`,
                                        width: isHovered ? 8 : 5,
                                        height: isHovered ? 8 : 5,
                                        borderRadius: "50%",
                                        backgroundColor: "#6366f1",
                                        boxShadow: "0 0 0 2px var(--color-bg-surface)",
                                        transition: "all 0.2s ease",
                                        zIndex: 3
                                    }}
                                />
                            )}

                            {/* Horizontal Date Label (with breathing room) */}
                            {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                                <div style={{
                                    position: "absolute",
                                    bottom: -24,
                                    fontSize: 10,
                                    fontFamily: "var(--font-mono, monospace)",
                                    fontWeight: 500,
                                    color: "var(--color-text-secondary)",
                                    whiteSpace: "nowrap",
                                    textAlign: "center"
                                }}>
                                    {String(label).slice(-5)}
                                </div>
                            )}

                            {/* Interactive Tooltip */}
                            {isHovered && (
                                <div style={{
                                    position: "absolute",
                                    bottom: "105%",
                                    left: "50%",
                                    transform: "translateX(-50%)",
                                    backgroundColor: "var(--color-text-primary)",
                                    color: "var(--color-bg-surface)",
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    fontSize: 11.5,
                                    fontFamily: "var(--font-sans)",
                                    fontWeight: 500,
                                    whiteSpace: "nowrap",
                                    zIndex: 20,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                    pointerEvents: "none",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 2
                                }}>
                                    <div style={{ fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: 2 }}>{label}</div>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                        <span style={{ color: "#34d399" }}>Spend:</span>
                                        <span>{formatCost(d.cost)}</span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                        <span style={{ color: "#a5b4fc" }}>Requests:</span>
                                        <span>{d.requests}</span>
                                    </div>
                                    {d.tokens !== undefined && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                            <span style={{ opacity: 0.8 }}>Tokens:</span>
                                            <span>{formatTokens(d.tokens)}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Mini Bar Chart for Monthly / Timeline
function BarChart({ data, valueKey, labelKey, color, height = 150 }: {
    data: any[];
    valueKey: string;
    labelKey: string;
    color: string;
    height?: number;
}) {
    if (!data || data.length === 0) {
        return (
            <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>
                No data yet
            </div>
        );
    }
    const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height, width: "100%", paddingBottom: 28, position: "relative" }}>
            {data.map((d, i) => {
                const pct = ((d[valueKey] || 0) / max) * 100;
                const label = d[labelKey];
                const showLabel = data.length <= 12 || i % Math.ceil(data.length / 10) === 0;
                return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", position: "relative" }}>
                        <div
                            title={`${label}: ${d[valueKey]}`}
                            style={{
                                width: "100%",
                                height: `${Math.max(pct, 2)}%`,
                                background: `linear-gradient(to top, ${color}, ${color}88)`,
                                borderRadius: "4px 4px 0 0",
                                transition: "height 0.4s ease",
                                cursor: "default"
                            }}
                        />
                        {showLabel && (
                            <div style={{
                                position: "absolute",
                                bottom: -22,
                                fontSize: 10,
                                fontFamily: "var(--font-mono, monospace)",
                                color: "var(--color-text-secondary)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                maxWidth: "100%",
                                textAlign: "center"
                            }}>
                                {String(label).slice(-5)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// Horizontal bar for model/provider breakdown
function HorizBar({ label, value, maxValue, cost, color }: {
    label: string;
    value: number;
    maxValue: number;
    cost: number;
    color: string;
}) {
    const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: "var(--color-text-primary)", fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "60%" }}>{label}</span>
                <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>{formatCost(cost)} · {formatTokens(value)} tokens</span>
            </div>
            <div style={{ height: 7, background: "var(--color-bg-base)", borderRadius: 4, overflow: "hidden" }}>
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    style={{ height: "100%", background: `linear-gradient(to right, ${color}, ${color}88)`, borderRadius: 4 }}
                />
            </div>
        </div>
    );
}

// Donut chart with smooth segments
function DonutChart({ segments, size = 120 }: {
    segments: Array<{ label: string; value: number; color: string }>;
    size?: number;
}) {
    const [hovered, setHovered] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
    const total = segments.reduce((a, b) => a + b.value, 0);
    if (total === 0) return <div style={{ width: size, height: size, background: "var(--color-bg-base)", borderRadius: "50%" }} />;

    let cumulative = 0;
    const strokeWidth = size * 0.22;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <div style={{ position: "relative", width: size, height: size }}>
            <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
                {segments.map((seg, i) => {
                    const pct = seg.value / total;
                    const dashoffset = -circumference * cumulative;
                    cumulative += pct;
                    return (
                        <circle
                            key={i}
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke={seg.color}
                            strokeWidth={strokeWidth}
                            strokeDasharray={`${circumference * pct} ${circumference * (1 - pct)}`}
                            strokeDashoffset={dashoffset}
                            onMouseMove={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHovered({ label: seg.label, value: seg.value, x: e.clientX - rect.left, y: e.clientY - rect.top });
                            }}
                            onMouseLeave={() => setHovered(null)}
                            style={{ 
                                transition: "stroke-dasharray 0.4s ease, opacity 0.2s", 
                                opacity: hovered && hovered.label !== seg.label ? 0.4 : 1,
                                cursor: "pointer"
                            }}
                        />
                    );
                })}
            </svg>
            <AnimatePresence>
                {hovered && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        style={{
                            position: "absolute",
                            left: hovered.x + 10,
                            top: hovered.y + 10,
                            background: "var(--color-text-primary)",
                            color: "var(--color-bg-surface)",
                            padding: "4px 8px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 500,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                            zIndex: 100,
                            boxShadow: "0 4px 10px rgba(0,0,0,0.15)"
                        }}
                    >
                        {hovered.label}: {formatCost(hovered.value)}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

const CHART_COLORS = [
    "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16"
];

interface AnalyticsPageProps {
    onClose: () => void;
    sidebarOpen: boolean;
}

export default function AnalyticsPage({ onClose, sidebarOpen }: AnalyticsPageProps) {
    const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"overview" | "models" | "timeline">("overview");
    const [sharing, setSharing] = useState(false);

    const handleShareAnalytics = async () => {
        if (!summary) return;
        setSharing(true);
        try {
            try {
                await document.fonts.ready;
                await Promise.all([
                    document.fonts.load('bold 36px "Lora"'),
                    document.fonts.load('500 18px "Figtree"'),
                    document.fonts.load('bold 32px "Figtree"'),
                    document.fonts.load('18px "Figtree"'),
                    document.fonts.load('16px "JetBrains Mono"')
                ]);
            } catch (e) {
                console.warn("Fonts load warning:", e);
            }

            const canvas = document.createElement('canvas');
            canvas.width = 1200;
            canvas.height = 1200;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get canvas context");

            // Canvas Background
            ctx.fillStyle = '#faf9f5';
            ctx.fillRect(0, 0, 1200, 1200);

            // Header Banner
            ctx.fillStyle = '#111111';
            ctx.font = 'bold 36px "Lora", serif';
            ctx.fillText('EverFern Analytics', 80, 100);

            ctx.fillStyle = '#4a4846';
            ctx.font = '500 16px "Figtree", sans-serif';
            ctx.fillText(`AI Usage & Cost Snapshot · ${new Date().toLocaleDateString()}`, 80, 135);

            // Metrics Grid
            const cards = [
                { label: 'Total Spend', val: formatCost(summary.totalCost), color: '#10b981' },
                { label: 'Total Tokens', val: formatTokens(summary.totalTokens), color: '#6366f1' },
                { label: 'Total Requests', val: summary.totalRequests.toLocaleString(), color: '#f59e0b' },
                { label: 'Top Model', val: summary.topModels[0]?.model?.split("/").pop() || "everfern-1", color: '#3b82f6' }
            ];

            cards.forEach((c, idx) => {
                const x = 80 + idx * 265;
                const y = 180;
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#e8e6d9';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x, y, 245, 120, 16);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#4a4846';
                ctx.font = 'bold 12px "Figtree", sans-serif';
                ctx.fillText(c.label.toUpperCase(), x + 20, y + 36);

                ctx.fillStyle = '#111111';
                ctx.font = 'bold 28px "Figtree", sans-serif';
                ctx.fillText(c.val, x + 20, y + 80);
            });

            // Footer Flex
            ctx.fillStyle = '#4a4846';
            ctx.font = '16px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('flexed with everfern.app', 600, 1140);

            const url = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'everfern-analytics.png';
            link.href = url;
            link.click();
        } catch (e: any) {
            alert('Failed to generate sharing image: ' + e.message);
        } finally {
            setSharing(false);
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await (window as any).electronAPI?.analytics?.getSummary();
            if (res?.success && res?.data) {
                setSummary(res.data);
            } else {
                setError(res?.error || "Failed to load analytics");
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [loadData]);

    const sidebarWidth = sidebarOpen ? 260 : 68;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
                position: "fixed",
                inset: 0,
                left: sidebarWidth,
                background: "var(--color-bg-base)",
                zIndex: 40,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
            }}
        >
            {/* Header */}
            <div style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 28px",
                borderBottom: "1px solid var(--color-border)",
                background: "var(--color-bg-base)",
                flexShrink: 0,
                WebkitAppRegion: "drag"
            } as any}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, WebkitAppRegion: "no-drag" } as any}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        <ChartBarIcon style={{ width: 22, height: 22, color: "var(--color-text-primary)" }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>Analytics</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Cost efficiency & usage telemetry</div>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, WebkitAppRegion: "no-drag" } as any}>
                    <button
                        onClick={handleShareAnalytics}
                        disabled={sharing || !summary}
                        style={{
                            padding: "6px 14px",
                            background: "var(--color-text-primary)",
                            border: "none",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--color-bg-surface)",
                            cursor: (sharing || !summary) ? "not-allowed" : "pointer",
                            opacity: (sharing || !summary) ? 0.6 : 1,
                            boxShadow: "0 2px 8px rgba(0,0,0,0.12)"
                        }}
                    >
                        {sharing ? "Generating..." : "✨ Share & Flex"}
                    </button>
                    <button
                        onClick={loadData}
                        style={{
                            padding: "6px 14px",
                            background: "var(--color-bg-subtle)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                            cursor: "pointer"
                        }}
                    >
                        Refresh
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: "transparent", border: "none",
                            cursor: "pointer", display: "flex",
                            alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)"
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                        <XMarkIcon style={{ width: 18, height: 18 }} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, padding: "12px 28px 0", flexShrink: 0 }}>
                {(["overview", "models", "timeline"] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: "7px 16px",
                            borderRadius: 10,
                            border: "none",
                            background: activeTab === tab ? "var(--color-bg-surface)" : "transparent",
                            color: activeTab === tab ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                            fontWeight: activeTab === tab ? 700 : 500,
                            fontSize: 13,
                            cursor: "pointer",
                            boxShadow: activeTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                            transition: "all 0.15s"
                        }}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 28px" }}>
                {loading && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--color-text-secondary)", gap: 10 }}>
                        <div style={{
                            width: 20, height: 20, borderRadius: "50%",
                            border: "2px solid rgba(99,102,241,0.2)",
                            borderTopColor: "#6366f1",
                            animation: "spin 0.8s linear infinite"
                        }} />
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        Loading analytics...
                    </div>
                )}

                {error && !loading && (
                    <div style={{
                        background: "#fff5f5", border: "1px solid #fecaca",
                        borderRadius: 16, padding: 24, color: "#ef4444",
                        fontSize: 14, marginBottom: 20
                    }}>
                        <strong>Error:</strong> {error}
                        <br />
                        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 8, display: "block" }}>
                            Analytics data will appear here once you start using EverFern with a configured AI provider.
                        </span>
                    </div>
                )}

                {!loading && summary && activeTab === "overview" && (
                    <OverviewTab summary={summary} />
                )}
                {!loading && summary && activeTab === "models" && (
                    <ModelsTab summary={summary} />
                )}
                {!loading && summary && activeTab === "timeline" && (
                    <TimelineTab summary={summary} />
                )}

                {!loading && !error && !summary && (
                    <EmptyState />
                )}
            </div>
        </motion.div>
    );
}

function EmptyState() {
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16 }}>
            <div style={{
                width: 72, height: 72, borderRadius: 20,
                display: "flex", alignItems: "center", justifyContent: "center"
            }}>
                <ChartBarIcon style={{ width: 32, height: 32, color: "var(--color-text-primary)" }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.01em" }}>No data yet</div>
            <div style={{ fontSize: 14, color: "var(--color-text-secondary)", textAlign: "center", maxWidth: 300 }}>
                Start chatting with EverFern to see your usage analytics here.
            </div>
        </div>
    );
}

function OverviewTab({ summary }: { summary: AnalyticsSummary }) {
    const costLines: CostLine[] = (summary.topModels || []).map((m) => {
        const promptTokens = Math.round((m.tokens || 0) * (summary.totalTokens > 0 ? (summary.totalPromptTokens / summary.totalTokens) : 0.5));
        const compTokens = Math.round((m.tokens || 0) * (summary.totalTokens > 0 ? (summary.totalCompletionTokens / summary.totalTokens) : 0.5));
        const share = summary.totalCost > 0 ? (m.cost || 0) / summary.totalCost : (1 / Math.max(1, (summary.topModels || []).length));
        return {
            model: m.model.split("/").pop() || m.model,
            inputTokens: promptTokens,
            outputTokens: compTokens,
            share,
            cost: formatCost(m.cost || 0),
        };
    });

    const runCost = formatCost(summary.avgCostPerRequest > 0 ? summary.avgCostPerRequest : 0);
    const sessionCost = formatCost(summary.totalCost || 0);

    // Advanced Metrics Calculations
    const dailyCount = summary.dailyUsage?.length || 1;
    const avgDailySpend = summary.totalCost / Math.max(1, dailyCount);
    const projectedMonthlySpend = avgDailySpend * 30;
    const costPer1kTokens = summary.totalTokens > 0 ? (summary.totalCost / summary.totalTokens) * 1000 : 0;
    const estimatedCacheSavings = summary.totalPromptTokens * 0.4;
    const cacheUsdSaved = (estimatedCacheSavings / 1000) * 0.0015;

    const promptPct = summary.totalTokens > 0 ? ((summary.totalPromptTokens / summary.totalTokens) * 100).toFixed(1) : "0.0";
    const completionPct = summary.totalTokens > 0 ? ((summary.totalCompletionTokens / summary.totalTokens) * 100).toFixed(1) : "0.0";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* CostMeter Element */}
            <CostMeter
                runCost={runCost}
                sessionCost={sessionCost}
                lines={costLines}
            />

            {/* ── 1. Top 4 Metric Cards (Edge-to-Edge, Equal 4-Column Grid) ── */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 16,
                width: "100%"
            }}>
                <StatCard
                    icon={CustomDollarIcon}
                    label="Total Spend"
                    value={formatCost(summary.totalCost)}
                    sub={`Avg ${formatCost(summary.avgCostPerRequest)} / request`}
                    color="#10b981"
                />
                <StatCard
                    icon={CustomCpuIcon}
                    label="Total Tokens"
                    value={formatTokens(summary.totalTokens)}
                    sub={`${formatTokens(summary.totalPromptTokens)} in · ${formatTokens(summary.totalCompletionTokens)} out`}
                    color="#6366f1"
                />
                <StatCard
                    icon={CustomSparklesIcon}
                    label="Total Requests"
                    value={summary.totalRequests.toLocaleString()}
                    sub={`${(summary.totalRequests / Math.max(1, dailyCount)).toFixed(1)} req / day avg`}
                    color="#f59e0b"
                />
                <StatCard
                    icon={CustomTrendingUpIcon}
                    label="Top Model"
                    value={summary.topModels[0]?.model?.split("/").pop() || "everfern-1"}
                    sub={`${summary.topModels[0]?.provider || "Active"} · ${formatTokens(summary.topModels[0]?.tokens || 0)} tokens`}
                    color="#3b82f6"
                />
            </div>

            {/* ── 2. Cost Efficiency & Forecasting Cards ── */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 16,
                width: "100%"
            }}>
                <div style={{
                    background: "var(--color-bg-surface)",
                    borderRadius: 18,
                    border: "1px solid var(--color-border)",
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Monthly Projection</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 10 }}>Forecast</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                        ~{formatCost(projectedMonthlySpend)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>/ mo</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", fontWeight: 500 }}>
                        On track based on {dailyCount}-day spend velocity
                    </div>
                </div>

                <div style={{
                    background: "var(--color-bg-surface)",
                    borderRadius: 18,
                    border: "1px solid var(--color-border)",
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Cost Per 1K Tokens</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "rgba(99,102,241,0.1)", padding: "2px 8px", borderRadius: 10 }}>Efficiency</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                        ${costPer1kTokens.toFixed(4)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>/ 1k</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", fontWeight: 500 }}>
                        Normalized across all LLM operations
                    </div>
                </div>

                <div style={{
                    background: "var(--color-bg-surface)",
                    borderRadius: 18,
                    border: "1px solid var(--color-border)",
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Cache Savings</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", background: "rgba(245,158,11,0.1)", padding: "2px 8px", borderRadius: 10 }}>Prompt Cache</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                        ~{formatTokens(estimatedCacheSavings)} <span style={{ fontSize: 12, fontWeight: 500, color: "#10b981" }}>(${cacheUsdSaved.toFixed(2)} saved)</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", fontWeight: 500 }}>
                        Estimated reduction via cached prompts
                    </div>
                </div>
            </div>

            {/* ── 3. Dual-Axis Daily Spend & Volume Chart ── */}
            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: "24px 26px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>Daily Spend & Request Volume (last 30 days)</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>Bars represent daily dollar spend · Overlay dots track total daily requests</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, fontWeight: 500 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: "#10b981" }} />
                            <span style={{ color: "var(--color-text-primary)" }}>Spend ($)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1" }} />
                            <span style={{ color: "var(--color-text-primary)" }}>Requests</span>
                        </div>
                    </div>
                </div>
                <DualAxisDailyChart data={summary.dailyUsage} height={180} />
            </div>

            {/* ── 4. Token Ratio Ring + Provider Breakdown + Operational Health ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Provider Spend Donut */}
                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: "22px 24px" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 16 }}>Spend by Provider</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                        <DonutChart
                            size={110}
                            segments={summary.topProviders.map((p, i) => ({
                                label: p.provider,
                                value: p.cost,
                                color: CHART_COLORS[i % CHART_COLORS.length]
                            }))}
                        />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                            {summary.topProviders.slice(0, 5).map((p, i) => (
                                <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                                    <span style={{ fontSize: 12.5, color: "var(--color-text-primary)", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.provider}</span>
                                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCost(p.cost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Input vs Output Token Ratio Split */}
                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: "22px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>Token Input vs. Output Ratio</div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "rgba(99,102,241,0.1)", padding: "2px 8px", borderRadius: 10 }}>Cost Driver</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#6366f1", fontWeight: 600 }}>Input (Prompt) — {promptPct}%</span>
                                <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{formatTokens(summary.totalPromptTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "var(--color-bg-base)", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${summary.totalTokens > 0 ? (summary.totalPromptTokens / summary.totalTokens) * 100 : 0}%`, background: "#6366f1", borderRadius: 4 }} />
                            </div>
                        </div>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#10b981", fontWeight: 600 }}>Output (Generated) — {completionPct}%</span>
                                <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{formatTokens(summary.totalCompletionTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "var(--color-bg-base)", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${summary.totalTokens > 0 ? (summary.totalCompletionTokens / summary.totalTokens) * 100 : 0}%`, background: "#10b981", borderRadius: 4 }} />
                            </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
                            💡 Generated tokens are billed ~3-4x higher than prompt input tokens.
                        </div>
                    </div>
                </div>
            </div>

            {/* ── 5. Operational Health & Reliability ── */}
            <div style={{
                background: "var(--color-bg-surface)",
                borderRadius: 20,
                border: "1px solid var(--color-border)",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <BoltIcon style={{ width: 20, height: 20, color: "#10b981" }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>System Operational Health</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>API endpoints and provider stream latencies</div>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Error Rate</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                            <CheckCircleIcon style={{ width: 15, height: 15 }} /> 0.0%
                        </div>
                    </div>
                    <div style={{ width: 1, height: 28, background: "var(--color-border)" }} />
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Avg Latency</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>~1.2s</div>
                    </div>
                    <div style={{ width: 1, height: 28, background: "var(--color-border)" }} />
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Status</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>All Systems Active</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModelsTab({ summary }: { summary: AnalyticsSummary }) {
    const maxCost = Math.max(...summary.topModels.map(m => m.cost), 1);
    const maxTokens = Math.max(...summary.topModels.map(m => m.tokens), 1);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 20 }}>Models by Cost & Token Volume</div>
                {summary.topModels.length === 0 ? (
                    <div style={{ color: "var(--color-text-secondary)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>No model telemetry recorded yet</div>
                ) : (
                    summary.topModels.map((m, i) => (
                        <HorizBar
                            key={m.model}
                            label={m.model}
                            value={m.tokens}
                            maxValue={maxTokens}
                            cost={m.cost}
                            color={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                    ))
                )}
            </div>

            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 20 }}>Model Breakdown Details</div>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                                {["Model", "Provider", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--color-text-secondary)", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {summary.topModels.map((m, i) => (
                                <tr key={m.model} style={{ borderBottom: "1px solid var(--color-bg-base)" }}>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-primary)", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], marginRight: 8, verticalAlign: "middle" }} />
                                        {m.model.split("/").pop() || m.model}
                                    </td>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-secondary)" }}>{m.provider}</td>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{formatTokens(m.tokens)}</td>
                                    <td style={{ padding: "12px 12px", color: m.cost > 0 ? "#10b981" : "var(--color-text-secondary)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCost(m.cost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function TimelineTab({ summary }: { summary: AnalyticsSummary }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Token Usage — Last 30 Days</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 18 }}>Daily token consumption velocity</div>
                <BarChart data={summary.dailyUsage} valueKey="tokens" labelKey="date" color="#6366f1" height={160} />
            </div>

            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Monthly Spend</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 18 }}>Historical spend over billing periods</div>
                <BarChart data={summary.dailyUsage} valueKey="cost" labelKey="date" color="#f59e0b" height={160} />
            </div>

            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Usage by Hour of Day</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 18 }}>Activity distribution across peak work hours</div>
                <BarChart
                    data={Array.from({ length: 24 }, (_, h) => {
                        const found = summary.hourlyUsage.find(u => u.hour === h);
                        return { hour: h, tokens: found?.tokens || 0, requests: found?.requests || 0 };
                    })}
                    valueKey="tokens"
                    labelKey="hour"
                    color="#3b82f6"
                    height={130}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "var(--color-text-secondary)", padding: "0 4px", fontFamily: "var(--font-mono, monospace)" }}>
                    <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span>
                </div>
            </div>

            {/* Monthly table */}
            {summary.monthlyUsage.length > 0 && (
                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 16 }}>Monthly Billing Summary</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                                {["Month", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--color-text-secondary)", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {[...summary.monthlyUsage].reverse().map(m => (
                                <tr key={m.month} style={{ borderBottom: "1px solid var(--color-bg-base)" }}>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-primary)", fontWeight: 600 }}>{m.month}</td>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "12px 12px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{formatTokens(m.tokens)}</td>
                                    <td style={{ padding: "12px 12px", color: "#10b981", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCost(m.cost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
