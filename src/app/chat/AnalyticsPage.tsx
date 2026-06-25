"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChartBarIcon,
    CurrencyDollarIcon,
    CpuChipIcon,
    SparklesIcon,
    ArrowTrendingUpIcon,
    ClockIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";

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
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
                background: "var(--color-bg-surface)",
                borderRadius: 20,
                border: "1px solid var(--color-border)",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 2px 12px rgba(0,0,0,0.04)"
            }}
        >
            <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: color + "18", display: "flex",
                alignItems: "center", justifyContent: "center"
            }}>
                <Icon style={{ width: 20, height: 20, color }} />
            </div>
            <div>
                <div style={{ fontSize: 26, fontWeight: 500, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500, marginTop: 2 }}>{label}</div>
                {sub && <div style={{ fontSize: 11, color: "var(--color-text-placeholder)", marginTop: 4 }}>{sub}</div>}
            </div>
        </motion.div>
    );
}

// Mini bar chart
function BarChart({ data, valueKey, labelKey, color, height = 160 }: {
    data: any[];
    valueKey: string;
    labelKey: string;
    color: string;
    height?: number;
}) {
    if (!data || data.length === 0) {
        return (
            <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 13 }}>
                No data yet
            </div>
        );
    }
    const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height, width: "100%", paddingBottom: 20, position: "relative" }}>
            {data.map((d, i) => {
                const pct = ((d[valueKey] || 0) / max) * 100;
                const label = d[labelKey];
                // Show only every Nth label to avoid crowding
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
                                bottom: -18,
                                fontSize: 9,
                                color: "#aaa",
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
        <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
                <span style={{ color: "var(--color-text-primary)", fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "60%" }}>{label}</span>
                <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>{formatCost(cost)} · {formatTokens(value)} tokens</span>
            </div>
            <div style={{ height: 6, background: "var(--color-bg-base)", borderRadius: 3, overflow: "hidden" }}>
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    style={{ height: "100%", background: `linear-gradient(to right, ${color}, ${color}88)`, borderRadius: 3 }}
                />
            </div>
        </div>
    );
}

// Donut chart (simple CSS)
function DonutChart({ segments, size = 120 }: {
    segments: Array<{ label: string; value: number; color: string }>;
    size?: number;
}) {
    const [hovered, setHovered] = useState<{ label: string; value: number; x: number; y: number } | null>(null);
    const total = segments.reduce((a, b) => a + b.value, 0);
    if (total === 0) return <div style={{ width: size, height: size, background: "var(--color-bg-base)", borderRadius: "50%" }} />;

    let cumulative = 0;
    const strokeWidth = size * 0.2;
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
                                opacity: hovered && hovered.label !== seg.label ? 0.5 : 1,
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
                            background: "#000",
                            color: "#fff",
                            padding: "4px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                            zIndex: 100,
                            boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
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
            // Wait for custom fonts to load
            try {
                await document.fonts.ready;
                await Promise.all([
                    document.fonts.load('bold 36px "EB Garamond"'),
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

            // 1. Draw cream background gradient
            const bgGrad = ctx.createRadialGradient(600, 600, 50, 600, 600, 800);
            bgGrad.addColorStop(0, '#fdfbf7');
            bgGrad.addColorStop(1, '#FEFAEF');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, 1200, 1200);

            // 2. Draw card container with light glassmorphism
            ctx.save();
            ctx.strokeStyle = 'rgba(32, 30, 36, 0.08)';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.shadowColor = 'rgba(32, 30, 36, 0.05)';
            ctx.shadowBlur = 40;
            ctx.beginPath();
            ctx.roundRect(60, 60, 1080, 1080, 24);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // 3. Draw Branding Header
            let logoImg: HTMLImageElement | null = null;
            try {
                logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new window.Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject();
                    img.src = '/images/logos/black-logo-withoutbg.png';
                });
            } catch (e) {
                console.warn("Logo failed to load");
            }

            const headerY = 120;
            if (logoImg) {
                ctx.drawImage(logoImg, 100, headerY, 64, 64);
            } else {
                ctx.save();
                ctx.beginPath();
                ctx.arc(132, headerY + 32, 32, 0, Math.PI * 2);
                ctx.fillStyle = '#6366f1';
                ctx.shadowColor = '#6366f1';
                ctx.shadowBlur = 15;
                ctx.fill();
                ctx.restore();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 24px "Figtree", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('EF', 132, headerY + 32);
            }

            ctx.fillStyle = '#201e24';
            ctx.font = '700 36px "Figtree", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('EverFern AI', 184, headerY);

            ctx.fillStyle = '#8a8886';
            ctx.font = '500 18px "Figtree", sans-serif';
            ctx.fillText('Usage & Cost Analytics Dashboard', 184, headerY + 44);

            // 4. Draw Key Metrics Grid (4 items)
            const metrics = [
                { label: 'Total Spend', value: formatCost(summary.totalCost), sub: `Avg ${formatCost(summary.avgCostPerRequest)}/req`, color: '#10b981' },
                { label: 'Total Tokens', value: formatTokens(summary.totalTokens), sub: `${formatTokens(summary.totalPromptTokens)} prompt · ${formatTokens(summary.totalCompletionTokens)} comp`, color: '#6366f1' },
                { label: 'Total Requests', value: summary.totalRequests.toLocaleString(), sub: 'Successful calls', color: '#f59e0b' },
                { label: 'Top Model', value: summary.topModels[0]?.model?.split("/").pop() || "—", sub: summary.topModels[0]?.provider || 'No provider', color: '#3b82f6' }
            ];

            const startX = 100;
            const totalWidth = 1000;
            const boxWidth = 220;
            const gap = (totalWidth - boxWidth * 4) / 3;

            metrics.forEach((m, i) => {
                const x = startX + i * (boxWidth + gap);
                const y = 230;

                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#e8e6d9';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x, y, boxWidth, 150, 16);
                ctx.fill();
                ctx.stroke();

                // Color accent bar
                ctx.fillStyle = m.color;
                ctx.beginPath();
                ctx.roundRect(x + 16, y + 16, 6, 24, 3);
                ctx.fill();

                // Value
                ctx.fillStyle = '#201e24';
                ctx.font = 'bold 32px "Figtree", sans-serif';
                ctx.fillText(m.value, x + 32, y + 48);

                // Label
                ctx.fillStyle = '#8a8886';
                ctx.font = '600 13px "Figtree", sans-serif';
                ctx.fillText(m.label.toUpperCase(), x + 16, y + 95);

                // Subtext
                ctx.fillStyle = '#8a8886';
                ctx.font = '500 11px "Figtree", sans-serif';
                ctx.fillText(m.sub, x + 16, y + 125);
                ctx.restore();
            });

            // 5. Draw Daily Spend Chart (last 30 days)
            const chartX = 100;
            const chartY = 420;
            const chartW = 1000;
            const chartH = 280;

            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#e8e6d9';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(chartX, chartY, chartW, chartH, 16);
            ctx.fill();
            ctx.stroke();

            // Chart Title
            ctx.fillStyle = '#201e24';
            ctx.font = 'bold 18px "Figtree", sans-serif';
            ctx.fillText('Daily Spend (Last 30 Days)', chartX + 24, chartY + 36);

            const dailyData = summary.dailyUsage || [];
            if (dailyData.length > 0) {
                const maxVal = Math.max(...dailyData.map(d => d.cost || 0), 0.01);
                const barSpacing = (chartW - 80) / dailyData.length;
                const barW = Math.max(barSpacing * 0.7, 4);

                dailyData.forEach((d, idx) => {
                    const pct = (d.cost || 0) / maxVal;
                    const barH = pct * (chartH - 120);
                    const x = chartX + 40 + idx * barSpacing;
                    const y = chartY + chartH - 40 - barH;

                    const barGrad = ctx.createLinearGradient(x, y, x, y + barH);
                    barGrad.addColorStop(0, '#10b981');
                    barGrad.addColorStop(1, 'rgba(16, 185, 129, 0.1)');
                    ctx.fillStyle = barGrad;

                    ctx.beginPath();
                    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
                    ctx.fill();

                    if (dailyData.length <= 12 || idx % Math.ceil(dailyData.length / 8) === 0) {
                        ctx.fillStyle = '#8a8886';
                        ctx.font = '500 11px "Figtree", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(d.date.slice(-5), x + barW / 2, chartY + chartH - 18);
                    }
                });
            } else {
                ctx.fillStyle = '#8a8886';
                ctx.font = '500 16px "Figtree", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No usage recorded yet', chartX + chartW / 2, chartY + chartH / 2);
            }
            ctx.restore();

            // 6. Draw Provider & Token Split Side-by-Side Panels
            const panelY = 730;
            const panelW = 480;
            const panelH = 280;

            // --- Panel 1: Donut Chart ---
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#e8e6d9';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(100, panelY, panelW, panelH, 16);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#201e24';
            ctx.font = 'bold 18px "Figtree", sans-serif';
            ctx.fillText('Spend by Provider', 124, panelY + 36);

            const providers = summary.topProviders || [];
            const totalProviderCost = providers.reduce((a, b) => a + b.cost, 0);

            if (providers.length > 0 && totalProviderCost > 0) {
                const centerX = 220;
                const centerY = panelY + 150;
                const outerRadius = 70;
                const innerRadius = 45;
                let currentAngle = -Math.PI / 2;

                const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];

                providers.forEach((p, idx) => {
                    const sliceAngle = (p.cost / totalProviderCost) * 2 * Math.PI;
                    const nextAngle = currentAngle + sliceAngle;

                    ctx.fillStyle = colors[idx % colors.length];
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, outerRadius, currentAngle, nextAngle);
                    ctx.closePath();
                    ctx.fill();

                    currentAngle = nextAngle;
                });

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
                ctx.fill();

                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                providers.slice(0, 5).forEach((p, idx) => {
                    const ly = panelY + 80 + idx * 32;
                    ctx.fillStyle = colors[idx % colors.length];
                    ctx.beginPath();
                    ctx.arc(330, ly + 16, 5, 0, 2 * Math.PI);
                    ctx.fill();

                    ctx.fillStyle = '#201e24';
                    ctx.font = 'bold 13px "Figtree", sans-serif';
                    ctx.fillText(p.provider, 346, ly + 16);

                    ctx.fillStyle = '#8a8886';
                    ctx.font = '500 12px "Figtree", sans-serif';
                    ctx.fillText(formatCost(p.cost), 460 - ctx.measureText(formatCost(p.cost)).width, ly + 16);
                });
            } else {
                ctx.fillStyle = '#8a8886';
                ctx.font = '500 15px "Figtree", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No provider data yet', 100 + panelW / 2, panelY + panelH / 2);
            }
            ctx.restore();

            // --- Panel 2: Token Split ---
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#e8e6d9';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(620, panelY, panelW, panelH, 16);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#201e24';
            ctx.font = 'bold 18px "Figtree", sans-serif';
            ctx.fillText('Token Usage Split', 644, panelY + 36);

            const promptPct = summary.totalTokens > 0 ? (summary.totalPromptTokens / summary.totalTokens) * 100 : 0;
            const completionPct = summary.totalTokens > 0 ? (summary.totalCompletionTokens / summary.totalTokens) * 100 : 0;

            const barY1 = panelY + 80;
            ctx.fillStyle = '#8a8886';
            ctx.font = 'bold 13px "Figtree", sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillText('INPUT (PROMPT)', 644, barY1 + 10);
            ctx.textAlign = 'right';
            ctx.fillText(formatTokens(summary.totalPromptTokens), 620 + panelW - 24, barY1 + 10);
            ctx.textAlign = 'left';

            ctx.fillStyle = '#f5f4f0';
            ctx.beginPath();
            ctx.roundRect(644, barY1 + 34, panelW - 48, 14, 7);
            ctx.fill();

            ctx.fillStyle = '#6366f1';
            ctx.beginPath();
            ctx.roundRect(644, barY1 + 34, (panelW - 48) * (promptPct / 100), 14, 7);
            ctx.fill();

            const barY2 = panelY + 165;
            ctx.fillStyle = '#8a8886';
            ctx.font = 'bold 13px "Figtree", sans-serif';
            ctx.fillText('OUTPUT (COMPLETION)', 644, barY2 + 10);
            ctx.textAlign = 'right';
            ctx.fillText(formatTokens(summary.totalCompletionTokens), 620 + panelW - 24, barY2 + 10);
            ctx.textAlign = 'left';

            ctx.fillStyle = '#f5f4f0';
            ctx.beginPath();
            ctx.roundRect(644, barY2 + 34, panelW - 48, 14, 7);
            ctx.fill();

            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.roundRect(644, barY2 + 34, (panelW - 48) * (completionPct / 100), 14, 7);
            ctx.fill();

            ctx.restore();

            // 7. Footer text
            ctx.fillStyle = '#8a8886';
            ctx.font = '16px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('flexed with everfern.app', 600, 1090);

            // 8. Trigger PNG download
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
                        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>Analytics</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Usage & cost tracking</div>
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#aaa", gap: 10 }}>
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
                        <span style={{ fontSize: 12, color: "#888", marginTop: 8, display: "block" }}>
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
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                <StatCard icon={CustomDollarIcon} label="Total Spend" value={formatCost(summary.totalCost)} sub={`Avg ${formatCost(summary.avgCostPerRequest)} per request`} color="#10b981" />
                <StatCard icon={CustomCpuIcon} label="Total Tokens" value={formatTokens(summary.totalTokens)} sub={`${formatTokens(summary.totalPromptTokens)} in · ${formatTokens(summary.totalCompletionTokens)} out`} color="#6366f1" />
                <StatCard icon={CustomSparklesIcon} label="Total Requests" value={summary.totalRequests.toLocaleString()} color="#f59e0b" />
                <StatCard icon={CustomTrendingUpIcon} label="Top Model" value={summary.topModels[0]?.model?.split("/").pop() || "—"} sub={summary.topModels[0]?.provider} color="#3b82f6" />
            </div>

            {/* Daily cost chart */}
            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>Daily Spend (last 30 days)</div>
                <BarChart data={summary.dailyUsage} valueKey="cost" labelKey="date" color="#10b981" height={140} />
            </div>

            {/* Provider pie + token split */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>By Provider</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                        <DonutChart
                            size={100}
                            segments={summary.topProviders.map((p, i) => ({
                                label: p.provider,
                                value: p.cost,
                                color: CHART_COLORS[i % CHART_COLORS.length]
                            }))}
                        />
                        <div style={{ flex: 1 }}>
                            {summary.topProviders.slice(0, 5).map((p, i) => (
                                <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.provider}</span>
                                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{formatCost(p.cost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>Token Split</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#6366f1", fontWeight: 600 }}>Input (Prompt)</span>
                                <span style={{ color: "var(--color-text-secondary)" }}>{formatTokens(summary.totalPromptTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "var(--color-bg-base)", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${summary.totalTokens > 0 ? (summary.totalPromptTokens / summary.totalTokens) * 100 : 0}%`, background: "#6366f1", borderRadius: 4 }} />
                            </div>
                        </div>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#10b981", fontWeight: 600 }}>Output (Completion)</span>
                                <span style={{ color: "var(--color-text-secondary)" }}>{formatTokens(summary.totalCompletionTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "var(--color-bg-base)", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${summary.totalTokens > 0 ? (summary.totalCompletionTokens / summary.totalTokens) * 100 : 0}%`, background: "#10b981", borderRadius: 4 }} />
                            </div>
                        </div>
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
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 20 }}>Models by Cost</div>
                {summary.topModels.length === 0 ? (
                    <div style={{ color: "var(--color-text-placeholder)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>No data yet</div>
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
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 20 }}>Model Details</div>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                                {["Model", "Provider", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-secondary)", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {summary.topModels.map((m, i) => (
                                <tr key={m.model} style={{ borderBottom: "1px solid var(--color-bg-base)" }}>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-primary)", fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], marginRight: 8, verticalAlign: "middle" }} />
                                        {m.model.split("/").pop() || m.model}
                                    </td>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{m.provider}</td>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{formatTokens(m.tokens)}</td>
                                    <td style={{ padding: "10px 12px", color: m.cost > 0 ? "#10b981" : "var(--color-text-placeholder)", fontWeight: 600 }}>{formatCost(m.cost)}</td>
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
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>Token Usage — Last 30 Days</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16 }}>Daily total tokens processed</div>
                <BarChart data={summary.dailyUsage} valueKey="tokens" labelKey="date" color="#6366f1" height={160} />
            </div>

            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>Monthly Spend</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16 }}>Cost over the last 12 months</div>
                <BarChart data={summary.dailyUsage} valueKey="cost" labelKey="date" color="#f59e0b" height={160} />
            </div>

            <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>Usage by Hour</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16 }}>When you use EverFern the most</div>
                <BarChart
                    data={Array.from({ length: 24 }, (_, h) => {
                        const found = summary.hourlyUsage.find(u => u.hour === h);
                        return { hour: h, tokens: found?.tokens || 0, requests: found?.requests || 0 };
                    })}
                    valueKey="tokens"
                    labelKey="hour"
                    color="#3b82f6"
                    height={120}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--color-text-placeholder)", padding: "0 4px" }}>
                    <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
                </div>
            </div>

            {/* Monthly table */}
            {summary.monthlyUsage.length > 0 && (
                <div style={{ background: "var(--color-bg-surface)", borderRadius: 20, border: "1px solid var(--color-border)", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>Monthly Breakdown</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                                {["Month", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-secondary)", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {[...summary.monthlyUsage].reverse().map(m => (
                                <tr key={m.month} style={{ borderBottom: "1px solid var(--color-bg-base)" }}>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-primary)", fontWeight: 600 }}>{m.month}</td>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "10px 12px", color: "var(--color-text-secondary)" }}>{formatTokens(m.tokens)}</td>
                                    <td style={{ padding: "10px 12px", color: "#10b981", fontWeight: 600 }}>{formatCost(m.cost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
