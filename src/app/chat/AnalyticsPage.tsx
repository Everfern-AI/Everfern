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
                background: "#ffffff",
                borderRadius: 20,
                border: "1px solid #e8e6d9",
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
                <div style={{ fontSize: 26, fontWeight: 800, color: "#111111", letterSpacing: "-0.02em" }}>{value}</div>
                <div style={{ fontSize: 13, color: "#8a8886", fontWeight: 500, marginTop: 2 }}>{label}</div>
                {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{sub}</div>}
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
                <span style={{ color: "#333", fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "60%" }}>{label}</span>
                <span style={{ color: "#8a8886", fontWeight: 500 }}>{formatCost(cost)} · {formatTokens(value)} tokens</span>
            </div>
            <div style={{ height: 6, background: "#f0eee1", borderRadius: 3, overflow: "hidden" }}>
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
    const total = segments.reduce((a, b) => a + b.value, 0);
    if (total === 0) return <div style={{ width: size, height: size, background: "#f0eee1", borderRadius: "50%" }} />;

    let cumulative = 0;
    const strokeWidth = size * 0.2;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            {segments.map((seg, i) => {
                const pct = seg.value / total;
                const offset = circumference * (1 - pct);
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
                        style={{ transition: "stroke-dasharray 0.4s ease" }}
                    />
                );
            })}
        </svg>
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
                background: "#f5f4f0",
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
                borderBottom: "1px solid #e8e6d9",
                background: "#f5f4f0",
                flexShrink: 0,
                WebkitAppRegion: "drag"
            } as any}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, WebkitAppRegion: "no-drag" } as any}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        <ChartBarIcon style={{ width: 22, height: 22, color: "#111" }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 600, color: "#111111", letterSpacing: "-0.02em" }}>Analytics</div>
                        <div style={{ fontSize: 12, color: "#8a8886" }}>Usage & cost tracking</div>
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, WebkitAppRegion: "no-drag" } as any}>
                    <button
                        onClick={loadData}
                        style={{
                            padding: "6px 14px",
                            background: "rgba(0,0,0,0.04)",
                            border: "1px solid rgba(0,0,0,0.08)",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#333",
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
                            alignItems: "center", justifyContent: "center", color: "#73716e"
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.05)")}
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
                            background: activeTab === tab ? "#ffffff" : "transparent",
                            color: activeTab === tab ? "#111" : "#8a8886",
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
                <ChartBarIcon style={{ width: 32, height: 32, color: "#111" }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111", letterSpacing: "-0.01em" }}>No data yet</div>
            <div style={{ fontSize: 14, color: "#8a8886", textAlign: "center", maxWidth: 300 }}>
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
                <StatCard icon={CurrencyDollarIcon} label="Total Spend" value={formatCost(summary.totalCost)} sub={`Avg ${formatCost(summary.avgCostPerRequest)} per request`} color="#10b981" />
                <StatCard icon={CpuChipIcon} label="Total Tokens" value={formatTokens(summary.totalTokens)} sub={`${formatTokens(summary.totalPromptTokens)} in · ${formatTokens(summary.totalCompletionTokens)} out`} color="#6366f1" />
                <StatCard icon={SparklesIcon} label="Total Requests" value={summary.totalRequests.toLocaleString()} color="#f59e0b" />
                <StatCard icon={ArrowTrendingUpIcon} label="Top Model" value={summary.topModels[0]?.model?.split("/").pop() || "—"} sub={summary.topModels[0]?.provider} color="#3b82f6" />
            </div>

            {/* Daily cost chart */}
            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 16 }}>Daily Spend (last 30 days)</div>
                <BarChart data={summary.dailyUsage} valueKey="cost" labelKey="date" color="#10b981" height={140} />
            </div>

            {/* Provider pie + token split */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 16 }}>By Provider</div>
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
                                    <span style={{ fontSize: 12, color: "#333", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.provider}</span>
                                    <span style={{ fontSize: 11, color: "#888" }}>{formatCost(p.cost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 16 }}>Token Split</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#6366f1", fontWeight: 600 }}>Input (Prompt)</span>
                                <span style={{ color: "#888" }}>{formatTokens(summary.totalPromptTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "#f0eee1", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${summary.totalTokens > 0 ? (summary.totalPromptTokens / summary.totalTokens) * 100 : 0}%`, background: "#6366f1", borderRadius: 4 }} />
                            </div>
                        </div>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                                <span style={{ color: "#10b981", fontWeight: 600 }}>Output (Completion)</span>
                                <span style={{ color: "#888" }}>{formatTokens(summary.totalCompletionTokens)}</span>
                            </div>
                            <div style={{ height: 8, background: "#f0eee1", borderRadius: 4, overflow: "hidden" }}>
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
            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 20 }}>Models by Cost</div>
                {summary.topModels.length === 0 ? (
                    <div style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "30px 0" }}>No data yet</div>
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

            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 20 }}>Model Details</div>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid #f0eee1" }}>
                                {["Model", "Provider", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#8a8886", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {summary.topModels.map((m, i) => (
                                <tr key={m.model} style={{ borderBottom: "1px solid #f8f7f4" }}>
                                    <td style={{ padding: "10px 12px", color: "#111", fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], marginRight: 8, verticalAlign: "middle" }} />
                                        {m.model.split("/").pop() || m.model}
                                    </td>
                                    <td style={{ padding: "10px 12px", color: "#666" }}>{m.provider}</td>
                                    <td style={{ padding: "10px 12px", color: "#666" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "10px 12px", color: "#666" }}>{formatTokens(m.tokens)}</td>
                                    <td style={{ padding: "10px 12px", color: m.cost > 0 ? "#10b981" : "#888", fontWeight: 600 }}>{formatCost(m.cost)}</td>
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
            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>Token Usage — Last 30 Days</div>
                <div style={{ fontSize: 12, color: "#8a8886", marginBottom: 16 }}>Daily total tokens processed</div>
                <BarChart data={summary.dailyUsage} valueKey="tokens" labelKey="date" color="#6366f1" height={160} />
            </div>

            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>Monthly Spend</div>
                <div style={{ fontSize: 12, color: "#8a8886", marginBottom: 16 }}>Cost over the last 12 months</div>
                <BarChart data={summary.monthlyUsage} valueKey="cost" labelKey="month" color="#f59e0b" height={160} />
            </div>

            <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>Usage by Hour</div>
                <div style={{ fontSize: 12, color: "#8a8886", marginBottom: 16 }}>When you use EverFern the most</div>
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
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "#bbb", padding: "0 4px" }}>
                    <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
                </div>
            </div>

            {/* Monthly table */}
            {summary.monthlyUsage.length > 0 && (
                <div style={{ background: "#ffffff", borderRadius: 20, border: "1px solid #e8e6d9", padding: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 16 }}>Monthly Breakdown</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid #f0eee1" }}>
                                {["Month", "Requests", "Tokens", "Cost"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#8a8886", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {[...summary.monthlyUsage].reverse().map(m => (
                                <tr key={m.month} style={{ borderBottom: "1px solid #f8f7f4" }}>
                                    <td style={{ padding: "10px 12px", color: "#111", fontWeight: 600 }}>{m.month}</td>
                                    <td style={{ padding: "10px 12px", color: "#666" }}>{m.requests.toLocaleString()}</td>
                                    <td style={{ padding: "10px 12px", color: "#666" }}>{formatTokens(m.tokens)}</td>
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
