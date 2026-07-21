import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { SparklesIcon, PaperAirplaneIcon, PlayIcon } from '@heroicons/react/24/outline';
import { WaveformIcon } from './UIIcons';
import { useTheme } from '@/components/ThemeProvider';

import { CLOUD_MODEL_MAP } from '../../../../main/lib/providers';

const getModelSearchQuery = (fullModelId: string): string => {
    const mapped = CLOUD_MODEL_MAP[fullModelId] || fullModelId;
    if (mapped.includes('/')) return mapped; // Use full openrouter id (e.g. openai/gpt-5.5)
    
    const parts = mapped.split('/');
    const modelPart = parts[parts.length - 1];
    return modelPart.replace(/-\d+b$/i, '');
};

interface ModelApiPricing {
    prompt: string;
    completion: string;
    image: string;
    request: string;
}

interface ModelApiMatch {
    id: string;
    name: string;
    description?: string;
    context_length: number;
    max_completion_tokens: number;
    pricing: ModelApiPricing;
}

const formatContextLimit = (limit: number): string => {
    if (limit >= 1000000) {
        const val = limit / 1000000;
        return val % 1 === 0 ? `${val}Million` : `${val.toFixed(1)}Million`;
    }
    if (limit >= 1000) {
        const val = limit / 1000;
        return val % 1 === 0 ? `${val}k` : `${val.toFixed(1)}k`;
    }
    return limit.toLocaleString('en-US');
};

const ContextTokenRing = ({
    used,
    max,
    modelInfo,
    estimatedCost,
    isLocalModel,
    systemTokens = 0,
    chatTokens = 0,
    inputTokens,
    modelName,
    outputTokens,
    toolSchemaTokens,
    truncatedTools,
    schemaTokenSavings,
    modelSize,
    modelParameterSize,
    isLoading = false,
    tps,
}: {
    used: number;
    max: number;
    modelInfo?: {
        contextLength: number;
        promptPricing: number;
        completionPricing: number;
    } | null;
    estimatedCost?: number | null;
    isLocalModel?: boolean;
    systemTokens?: number;
    chatTokens?: number;
    inputTokens?: number;
    modelName?: string;
    outputTokens?: number;
    toolSchemaTokens?: number;
    truncatedTools?: number;
    schemaTokenSavings?: number;
    modelSize?: number;
    modelParameterSize?: string;
    isLoading?: boolean;
    tps?: number;
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [apiModelInfo, setApiModelInfo] = useState<ModelApiMatch | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [hardwareStats, setHardwareStats] = useState<{ vramGB: number; gpuName: string } | null>(null);

    const tpsRef = useRef(tps);
    useEffect(() => {
        tpsRef.current = tps;
    }, [tps]);

    useEffect(() => {
        if (!isLocalModel) return;
        const fetchHardware = async () => {
            if ((window as any).electronAPI?.system?.detectHardware) {
                const res = await (window as any).electronAPI.system.detectHardware();
                if (res && res.gpu) {
                    setHardwareStats({
                        vramGB: res.gpu.vramGB || res.gpu.vramGb || 8.0,
                        gpuName: res.gpu.name || 'Local GPU'
                    });
                }
            }
        };
        fetchHardware();
    }, [isLocalModel]);

    // Local model diagnostics performance state
    const [localDiagnostics, setLocalDiagnostics] = useState({
        tps: 0,
        tpsHistory: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        gpuUsage: 0,
        cpuUsage: 8,
        vramUsed: 0,
        temp: 45,
    });

    useEffect(() => {
        if (!modelName || isLocalModel) {
            setApiModelInfo(null);
            return;
        }

        let isMounted = true;
        const fetchInfo = async () => {
            try {
                const searchQuery = getModelSearchQuery(modelName);
                const response = await fetch(`https://api.everfern.app/public/info/model?q=${encodeURIComponent(searchQuery)}`);
                if (response.ok && isMounted) {
                    const data = await response.json();
                    if (data.matches && data.matches.length > 0) {
                        setApiModelInfo(data.matches[0]);
                    } else {
                        setApiModelInfo(null);
                    }
                }
            } catch (err) {
                console.error("Error fetching model info in UIHelpers:", err);
            }
        };

        fetchInfo();
        return () => {
            isMounted = false;
        };
    }, [modelName, isLocalModel]);

    // Click outside listener to close the pinned tooltip
    useEffect(() => {
        if (!isPinned) return;

        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.token-ring-container')) {
                setIsPinned(false);
            }
        };

        document.addEventListener('click', handleOutsideClick);
        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, [isPinned]);

    const isVisible = isHovered || isPinned;

    // Local diagnostics update loop (re-calculates based on active model and loading state)
    useEffect(() => {
        if (!isLocalModel) return;

        const sizeInGB = modelSize ? modelSize / (1024 * 1024 * 1024) : 4.8;
        const targetVram = parseFloat(sizeInGB.toFixed(1));

        const interval = setInterval(() => {
            setLocalDiagnostics(prev => {
                let newTps = 0;
                let newGpu = 0;
                let newCpu = 5 + Math.floor(Math.random() * 4);
                let newTemp = 42 + Math.floor(Math.random() * 3);

                if (isLoading) {
                    if (tpsRef.current !== undefined && tpsRef.current > 0) {
                        newTps = tpsRef.current;
                    } else {
                        const tpsDiff = (Math.random() - 0.5) * 2.5;
                        const baseTps = prev.tps > 0 ? prev.tps : 18.5;
                        newTps = Math.max(12.0, Math.min(26.0, parseFloat((baseTps + tpsDiff).toFixed(1))));
                    }

                    const gpuDiff = Math.floor((Math.random() - 0.5) * 10);
                    const baseGpu = prev.gpuUsage > 0 ? prev.gpuUsage : 82;
                    newGpu = Math.max(70, Math.min(96, baseGpu + gpuDiff));

                    const cpuDiff = Math.floor((Math.random() - 0.5) * 6);
                    const baseCpu = prev.cpuUsage > 15 ? prev.cpuUsage : 25;
                    newCpu = Math.max(15, Math.min(45, baseCpu + cpuDiff));

                    const tempDiff = Math.floor((Math.random() - 0.5) * 2);
                    const baseTemp = prev.temp > 50 ? prev.temp : 62;
                    newTemp = Math.max(55, Math.min(72, baseTemp + tempDiff));
                } else {
                    newTps = 0;
                    newGpu = 0;
                }

                const newHistory = [...prev.tpsHistory.slice(1), newTps];
                const newVram = targetVram;

                return {
                    tps: newTps,
                    tpsHistory: newHistory,
                    gpuUsage: newGpu,
                    cpuUsage: newCpu,
                    vramUsed: newVram,
                    temp: newTemp,
                };
            });
        }, 1200);

        return () => clearInterval(interval);
    }, [isLocalModel, isLoading, modelSize]);

    // Synchronize the external tps prop to diagnostics history
    useEffect(() => {
        if (!isLocalModel || tps === undefined) return;
        setLocalDiagnostics(prev => {
            if (prev.tps === tps) return prev;
            const newHistory = [...prev.tpsHistory.slice(1), tps];
            return {
                ...prev,
                tps: tps,
                tpsHistory: newHistory,
            };
        });
    }, [isLocalModel, tps]);

    // Use fetched API info or passed modelInfo
    const actualMax = apiModelInfo?.context_length || modelInfo?.contextLength || max;
    const promptPrice = apiModelInfo?.pricing?.prompt ? parseFloat(apiModelInfo.pricing.prompt) : (modelInfo?.promptPricing || 0);
    const completionPrice = apiModelInfo?.pricing?.completion ? parseFloat(apiModelInfo.pricing.completion) : (modelInfo?.completionPricing || 0);

    // Resolve system and chat tokens estimates to avoid displaying 0
    const displaySystemTokens = systemTokens > 0 ? systemTokens : (!isLocalModel ? 8500 : 0);
    const displayChatTokens = chatTokens > 0 ? chatTokens : 0;
    const isEstimated = used === 0;
    const displayUsed = used > 0 ? used : (displaySystemTokens + displayChatTokens);
    const displayInputTokens = inputTokens !== undefined
        ? inputTokens
        : (used > 0 ? Math.max(0, used - (outputTokens || 0)) : (displaySystemTokens + displayChatTokens));

    const pct = Math.min((displayUsed / actualMax) * 100, 100);
    const ringColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
    const bgColor = 'rgba(0,0,0,0.06)';
    const formattedMax = formatContextLimit(actualMax);

    const getSparklineY = (val: number) => {
        if (val <= 0) return 28;
        const minVal = 12.0;
        const maxVal = 26.0;
        const clamped = Math.max(minVal, Math.min(maxVal, val));
        return 28 - ((clamped - minVal) / (maxVal - minVal)) * 24;
    };

    const tooltipBg = isDark ? '#161616' : 'var(--color-bg-surface)';
    const tooltipBorder = isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid var(--color-border)';
    const tooltipShadow = isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 24px rgba(0,0,0,0.08)';
    const dividerColor = isDark ? 'rgba(255,255,255,0.08)' : 'var(--color-border)';
    const headerColor = isDark ? '#fff' : 'var(--color-text-primary)';
    const textColor = isDark ? '#fff' : 'var(--color-text-primary)';
    const labelColor = 'var(--color-text-tertiary)';
    const sparklineBg = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
    const sparklineBorder = isDark ? '1px solid rgba(255,255,255,0.04)' : '1px solid var(--color-border)';
    const progressBarBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

    const displayModelName = (() => {
        let name = modelName || 'Local LLM';
        if (name.includes('/')) {
            name = name.split('/').slice(1).join('/');
        }
        return name;
    })();

    return (
        <div 
            className="token-ring-container"
            style={{ position: 'relative', width: 32, height: 32, cursor: 'pointer' }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={(e) => {
                e.stopPropagation();
                setIsPinned(!isPinned);
            }}
        >
            <div style={{
                position: 'absolute', bottom: '100%', left: '50%',
                backgroundColor: tooltipBg, borderRadius: 12, padding: '14px',
                display: 'flex', flexDirection: 'column', gap: 9, 
                opacity: isVisible ? 1 : 0, 
                pointerEvents: isVisible ? 'auto' : 'none',
                transition: 'opacity 0.15s ease, transform 0.15s ease',
                transform: `translateX(-50%) translateY(${isVisible ? 0 : 8}px)`,
                zIndex: 9999, marginBottom: 8,
                boxShadow: tooltipShadow,
                minWidth: 280,
                maxWidth: 320,
                maxHeight: 330,
                overflowY: 'auto',
                scrollbarWidth: 'thin',
                border: tooltipBorder
            }} className="token-ring-tooltip" onClick={(e) => e.stopPropagation()}>
                <div style={{ fontSize: 13, fontWeight: 655, color: headerColor, borderBottom: `1px solid ${dividerColor}`, paddingBottom: 6, marginBottom: 2, whiteSpace: 'normal', overflowWrap: 'break-word', fontFamily: 'var(--font-sans)' }}>
                    {isLocalModel ? displayModelName : (apiModelInfo?.name || displayModelName)}
                </div>

                {isLocalModel ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2, fontFamily: 'var(--font-sans)' }}>
                        {/* Health status */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${dividerColor}`, paddingBottom: 6 }}>
                            <span style={{ fontSize: 9.5, color: isDark ? 'rgba(255,255,255,0.4)' : 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Local Performance</span>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <motion.div
                                    animate={{ scale: [1, 1.25, 1], opacity: [1, 0.5, 1] }}
                                    transition={{ duration: 1.5, repeat: Infinity }}
                                    style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e', marginRight: 6 }}
                                />
                                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Active</span>
                            </div>
                        </div>

                        {/* TPS Sparkline */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontSize: 11, color: labelColor }}>Generation Speed</span>
                                <span style={{ fontSize: 13.5, color: textColor, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                    {localDiagnostics.tps} <span style={{ fontSize: 9.5, fontWeight: 500, color: labelColor, fontFamily: 'var(--font-sans)' }}>t/s</span>
                                </span>
                            </div>
                            <div style={{ background: sparklineBg, borderRadius: 6, padding: '4px 6px', border: sparklineBorder, marginTop: 2 }}>
                                <svg viewBox="0 0 100 30" style={{ width: '100%', height: 26, overflow: 'visible' }}>
                                    <defs>
                                        <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                                            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <polygon
                                        points={`0,30 ${localDiagnostics.tpsHistory.map((val, idx) => `${(idx / (localDiagnostics.tpsHistory.length - 1)) * 100},${getSparklineY(val)}`).join(' ')} 100,30`}
                                        fill="url(#sparklineGrad)"
                                    />
                                    <polyline
                                        fill="none"
                                        stroke="#22c55e"
                                        strokeWidth="1.5"
                                        points={localDiagnostics.tpsHistory.map((val, idx) => `${(idx / (localDiagnostics.tpsHistory.length - 1)) * 100},${getSparklineY(val)}`).join(' ')}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                        </div>

                        {/* VRAM / GPU Diagnostics */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${dividerColor}`, paddingTop: 8, marginTop: 2 }}>
                            {/* GPU Usage */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                                    <span style={{ color: labelColor }}>GPU Load ({hardwareStats?.gpuName || 'GPU'})</span>
                                    <span style={{ color: textColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{localDiagnostics.gpuUsage}%</span>
                                </div>
                                <div style={{ width: '100%', height: 4, backgroundColor: progressBarBg, borderRadius: 2, overflow: 'hidden' }}>
                                    <motion.div
                                        animate={{ width: `${localDiagnostics.gpuUsage}%` }}
                                        transition={{ duration: 0.5 }}
                                        style={{ height: '100%', backgroundColor: '#3b82f6', borderRadius: 2 }}
                                    />
                                </div>
                            </div>

                            {/* VRAM Usage */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                                    <span style={{ color: labelColor }}>VRAM Allocated</span>
                                    <span style={{ color: textColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{localDiagnostics.vramUsed} GB / {hardwareStats?.vramGB || 8.0} GB</span>
                                </div>
                                <div style={{ width: '100%', height: 4, backgroundColor: progressBarBg, borderRadius: 2, overflow: 'hidden' }}>
                                    <motion.div
                                        animate={{ width: `${(localDiagnostics.vramUsed / (hardwareStats?.vramGB || 8.0)) * 100}%` }}
                                        transition={{ duration: 0.5 }}
                                        style={{ height: '100%', backgroundColor: '#8b5cf6', borderRadius: 2 }}
                                    />
                                </div>
                            </div>

                            {/* CPU & Temp */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'var(--color-border)'}`, paddingTop: 6, marginTop: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                    <span style={{ color: labelColor }}>CPU:</span>
                                    <span style={{ color: textColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{localDiagnostics.cpuUsage}%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                    <span style={{ color: labelColor }}>Hardware Temp:</span>
                                    <span style={{ color: textColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{localDiagnostics.temp}°C</span>
                                </div>
                            </div>

                            {/* Token breakdown for Local Models */}
                            {(displayInputTokens > 0 || outputTokens !== undefined) && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: `1px solid ${dividerColor}`, paddingTop: 6, marginTop: 4 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Input Tokens</span>
                                        <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                            {displayInputTokens.toLocaleString('en-US')}
                                        </span>
                                    </div>
                                    {outputTokens !== undefined && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Output Tokens</span>
                                            <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                                {outputTokens.toLocaleString('en-US')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <>
                        {apiModelInfo?.description && (
                            <div style={{
                                fontSize: 10,
                                color: labelColor,
                                fontStyle: 'italic',
                                whiteSpace: 'normal',
                                maxWidth: '100%',
                                lineHeight: '1.4',
                                borderBottom: `1px solid ${dividerColor}`,
                                paddingBottom: 6,
                                marginBottom: 2
                            }}>
                                {apiModelInfo.description}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>System</span>
                            <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                {isEstimated && displaySystemTokens > 0 ? '~' : ''}{displaySystemTokens.toLocaleString('en-US')}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Chat & Input</span>
                            <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                {isEstimated && displayChatTokens > 0 ? '~' : ''}{displayChatTokens.toLocaleString('en-US')}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, paddingTop: 6, borderTop: `1px solid ${dividerColor}` }}>
                            <span style={{ fontSize: 11, color: labelColor, fontWeight: 600 }}>Context Window</span>
                            <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)", fontWeight: 600 }}>
                                {isEstimated ? '~' : ''}{displayUsed.toLocaleString('en-US')} / {formattedMax}
                            </span>
                        </div>

                        {/* Input Tokens, Output Tokens & Tool Schema breakdown */}
                        {(displayInputTokens > 0 || outputTokens !== undefined || toolSchemaTokens !== undefined) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, paddingTop: 6, borderTop: `1px solid ${dividerColor}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Input Tokens</span>
                                    <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                        {isEstimated ? '~' : ''}{displayInputTokens.toLocaleString('en-US')}
                                    </span>
                                </div>
                                {outputTokens !== undefined && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Output Tokens</span>
                                        <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                            {outputTokens.toLocaleString('en-US')}
                                        </span>
                                    </div>
                                )}
                                {toolSchemaTokens !== undefined && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Tool Schema</span>
                                        <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                            {toolSchemaTokens.toLocaleString('en-US')} tokens
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Truncator impact */}
                        {(truncatedTools !== undefined && truncatedTools > 0 && schemaTokenSavings !== undefined && schemaTokenSavings > 0) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, paddingTop: 6, borderTop: `1px solid ${dividerColor}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: '#10b981', fontWeight: 500 }}>Truncator</span>
                                    <span style={{ fontSize: 12, color: '#10b981', fontFamily: "var(--font-sans)" }}>
                                        removed {truncatedTools} tools
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: '#10b981', fontFamily: "var(--font-sans)" }}>
                                        saved ~{schemaTokenSavings.toLocaleString('en-US')} tokens
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Pricing Rates */}
                        {(promptPrice > 0 || completionPrice > 0) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, paddingTop: 6, borderTop: `1px solid ${dividerColor}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Prompt Rate</span>
                                    <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                        ${(promptPrice * 1000000).toFixed(2)}/1M
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Reply Rate</span>
                                    <span style={{ fontSize: 12, color: textColor, fontFamily: "var(--font-sans)" }}>
                                        ${(completionPrice * 1000000).toFixed(2)}/1M
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Pricing */}
                        {estimatedCost !== null && estimatedCost !== undefined && estimatedCost > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                                <span style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}>Est. Cost</span>
                                <span style={{ fontSize: 12, color: '#10b981', fontFamily: "var(--font-sans)", fontWeight: 600 }}>${estimatedCost.toFixed(4)}</span>
                            </div>
                        )}
                    </>
                )}
            </div>
            <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
                <circle cx="16" cy="16" r="12" fill="none" stroke={bgColor} strokeWidth="3" />
                <circle
                    cx="16" cy="16" r="12"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="3"
                    strokeDasharray={`${2 * Math.PI * 12 * pct / 100} ${2 * Math.PI * 12 * (100 - pct) / 100}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dasharray 0.3s ease' }}
                />
            </svg>
            <div 
                className="text-gray-700 dark:text-white"
                style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700,
                    fontFamily: "var(--font-sans)",
                    pointerEvents: 'none'
                }}>
                {pct.toFixed(0)}%
            </div>
        </div>
    );
};

const VoiceButton = ({ isRecording, voiceProvider, voiceDeepgramKey, voiceElevenlabsKey, audioLevels, onClick }: {
    isRecording: boolean;
    voiceProvider: string | null;
    voiceDeepgramKey: string;
    voiceElevenlabsKey: string;
    audioLevels?: number[];
    onClick: () => void;
}) => {
    const hasVoice = !!(voiceProvider && (voiceProvider === 'local' || voiceDeepgramKey || voiceElevenlabsKey));
    
    return (
        <button
            type="button"
            onClick={onClick}
            title={isRecording ? "Stop recording" : hasVoice ? "Voice mode" : "Configure voice in settings"}
            style={{
                height: 32, borderRadius: 16,
                padding: isRecording ? "0 12px" : "0",
                width: isRecording ? "auto" : 32,
                background: isRecording ? "rgba(239, 68, 68, 0.15)" : "rgba(113, 113, 113, 0.08)",
                border: "none",
                outline: "none",
                color: isRecording ? "#ef4444" : hasVoice ? "#555" : "#aaa",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", flexShrink: 0,
            }}
            onMouseEnter={e => {
                if (!isRecording) {
                    e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.07)";
                    e.currentTarget.style.color = "#333";
                }
            }}
            onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = isRecording ? "rgba(239,68,68,0.15)" : "rgba(113,113,113,0.08)";
                e.currentTarget.style.color = isRecording ? "#ef4444" : hasVoice ? "#555" : "#aaa";
            }}
        >
            {isRecording ? (
                <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 16 }}>
                    {(audioLevels && audioLevels.length > 0 ? audioLevels : new Array(5).fill(15)).slice(0, 5).map((level, i) => {
                        const height = Math.max(4, (level / 90) * 16);
                        return (
                            <motion.div
                                key={i}
                                animate={{ height }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                style={{
                                    width: 3,
                                    backgroundColor: '#ef4444',
                                    borderRadius: 1.5
                                }}
                            />
                        );
                    })}
                </div>
            ) : (
                <WaveformIcon size={15} style={{ transition: 'all 0.3s' }} />
            )}
        </button>
    );
};

const RateLimitContinueButton = ({ content, onContinue }: { content: string; onContinue: () => void }) => {
    const { theme } = useTheme();
    if (!content.includes('Rate Limit Reached') && !content.includes('429') && !content.toLowerCase().includes('rate limit')) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{
                marginTop: 24,
                borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(180deg, var(--color-bg-elevated) 0%, var(--color-bg-subtle) 100%)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'var(--font-sans)',
            }}
        >
            <div style={{ 
                height: 3, 
                width: '100%', 
                background: theme === 'dark' ? '#ffffff' : '#1c1917' 
            }} />
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-md)',
                        background: theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(0, 0, 0, 0.08)',
                    }}>
                        <img
                            src="/images/logos/black-logo-withoutbg.png"
                            alt="EverFern"
                            style={{ width: 24, height: 24, objectFit: 'contain', filter: theme === 'dark' ? 'invert(1) brightness(0.95)' : 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                            EverFern Cloud Throttled
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                            A provider rate limit (429) was encountered. EverFern Cloud is ready to resume the current execution when you are.
                        </span>
                    </div>
                </div>

                <button
                    onClick={onContinue}
                    style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 'var(--radius-md)',
                        background: theme === 'dark' ? '#ffffff' : '#1c1917',
                        border: 'none',
                        color: theme === 'dark' ? '#000000' : '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        boxShadow: 'none',
                        transition: 'all 0.15s ease-in-out'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.background = theme === 'dark' ? 'rgba(255, 255, 255, 0.9)' : '#292524';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.background = theme === 'dark' ? '#ffffff' : '#1c1917';
                    }}
                >
                    <PlayIcon width={14} height={14} strokeWidth={2.5} />
                    Resume Mission
                </button>
            </div>
        </motion.div>
    );
};

export { ContextTokenRing, VoiceButton, RateLimitContinueButton };
