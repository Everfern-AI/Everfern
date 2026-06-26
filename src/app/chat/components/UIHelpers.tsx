import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { SparklesIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { WaveformIcon } from './UIIcons';

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
    modelName
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
    modelName?: string;
}) => {
    const [apiModelInfo, setApiModelInfo] = useState<ModelApiMatch | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isPinned, setIsPinned] = useState(false);

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

    // Use fetched API info or passed modelInfo
    const actualMax = apiModelInfo?.context_length || modelInfo?.contextLength || max;
    const promptPrice = apiModelInfo?.pricing?.prompt ? parseFloat(apiModelInfo.pricing.prompt) : (modelInfo?.promptPricing || 0);
    const completionPrice = apiModelInfo?.pricing?.completion ? parseFloat(apiModelInfo.pricing.completion) : (modelInfo?.completionPricing || 0);

    // Resolve system and chat tokens estimates to avoid displaying 0
    const displaySystemTokens = systemTokens > 0 ? systemTokens : (!isLocalModel ? 8500 : 0);
    const displayChatTokens = chatTokens > 0 ? chatTokens : 0;
    const isEstimated = used === 0;
    const displayUsed = used > 0 ? used : (displaySystemTokens + displayChatTokens);

    const pct = Math.min((displayUsed / actualMax) * 100, 100);
    const ringColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
    const bgColor = 'rgba(0,0,0,0.06)';
    const formattedMax = formatContextLimit(actualMax);
    const isVisible = isHovered || isPinned;

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
                backgroundColor: '#1a1a1a', borderRadius: 8, padding: '12px',
                display: 'flex', flexDirection: 'column', gap: 8, 
                opacity: isVisible ? 1 : 0, 
                pointerEvents: isVisible ? 'auto' : 'none',
                transition: 'opacity 0.15s ease, transform 0.15s ease',
                transform: `translateX(-50%) translateY(${isVisible ? 0 : 8}px)`,
                zIndex: 9999, marginBottom: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                minWidth: 240,
                maxWidth: 280,
                maxHeight: 240,
                overflowY: 'auto',
                scrollbarWidth: 'thin',
            }} className="token-ring-tooltip" onClick={(e) => e.stopPropagation()}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6, marginBottom: 2, whiteSpace: 'normal', overflowWrap: 'break-word' }}>
                    {apiModelInfo?.name || modelName || 'Model'}
                </div>

                {apiModelInfo?.description && (
                    <div style={{
                        fontSize: 10,
                        color: 'var(--color-text-tertiary)',
                        fontStyle: 'italic',
                        whiteSpace: 'normal',
                        maxWidth: '100%',
                        lineHeight: '1.4',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        paddingBottom: 6,
                        marginBottom: 2
                    }}>
                        {apiModelInfo.description}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>System</span>
                    <span style={{ fontSize: 12, color: '#fff', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                        {isEstimated && displaySystemTokens > 0 ? '~' : ''}{displaySystemTokens.toLocaleString('en-US')}
                    </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Chat & Input</span>
                    <span style={{ fontSize: 12, color: '#fff', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                        {isEstimated && displayChatTokens > 0 ? '~' : ''}{displayChatTokens.toLocaleString('en-US')}
                    </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 600 }}>Context Window</span>
                    <span style={{ fontSize: 12, color: '#fff', fontFamily: "'Figtree', system-ui, sans-serif", fontWeight: 600 }}>
                        {isEstimated ? '~' : ''}{displayUsed.toLocaleString('en-US')} / {formattedMax}
                    </span>
                </div>

                {/* Pricing Rates (Prompt / Completion price per 1M tokens) */}
                {!isLocalModel && (promptPrice > 0 || completionPrice > 0) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Prompt Rate</span>
                            <span style={{ fontSize: 12, color: '#fff', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                                ${(promptPrice * 1000000).toFixed(2)}/1M
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Reply Rate</span>
                            <span style={{ fontSize: 12, color: '#fff', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                                ${(completionPrice * 1000000).toFixed(2)}/1M
                            </span>
                        </div>
                    </div>
                )}

                {/* Pricing (only show for non-local models with cost) */}
                {!isLocalModel && estimatedCost !== null && estimatedCost !== undefined && estimatedCost > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Est. Cost</span>
                        <span style={{ fontSize: 12, color: '#10b981', fontFamily: "'Figtree', system-ui, sans-serif", fontWeight: 600 }}>${estimatedCost.toFixed(4)}</span>
                    </div>
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
                    fontFamily: "'Figtree', system-ui, sans-serif",
                    pointerEvents: 'none'
                }}>
                {pct.toFixed(0)}%
            </div>
        </div>
    );
};

const VoiceButton = ({ isRecording, voiceProvider, voiceDeepgramKey, voiceElevenlabsKey, onClick }: {
    isRecording: boolean;
    voiceProvider: string | null;
    voiceDeepgramKey: string;
    voiceElevenlabsKey: string;
    onClick: () => void;
}) => {
    const hasVoice = !!(voiceProvider && (voiceDeepgramKey || voiceElevenlabsKey));
    return (
        <button
            type="button"
            onClick={onClick}
            title={isRecording ? "Stop recording" : hasVoice ? "Voice mode" : "Configure voice in settings"}
            style={{
                width: 32, height: 32, borderRadius: 10,
                background: isRecording ? "rgba(239, 68, 68, 0.15)" : "rgba(113, 113, 113, 0.08)",
                border: isRecording ? "1px solid #ef4444" : hasVoice ? "1px solid #c4c2be" : "1px solid #e8e6d9",
                color: isRecording ? "#ef4444" : hasVoice ? "#555" : "#aaa",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "all 0.2s", flexShrink: 0,
            }}
            onMouseEnter={e => {
                if (!isRecording) {
                    e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.07)";
                    e.currentTarget.style.borderColor = 'var(--color-text-tertiary)';
                    e.currentTarget.style.color = "#333";
                }
            }}
            onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = isRecording ? "rgba(239,68,68,0.15)" : "rgba(113,113,113,0.08)";
                e.currentTarget.style.borderColor = isRecording ? "#ef4444" : hasVoice ? "#c4c2be" : "#e8e6d9";
                e.currentTarget.style.color = isRecording ? "#ef4444" : hasVoice ? "#555" : "#aaa";
            }}
        >
            <WaveformIcon size={15} style={{ animation: isRecording ? "pulse 1s infinite" : "none" }} />
        </button>
    );
};

const RateLimitContinueButton = ({ content, onContinue }: { content: string; onContinue: () => void }) => {
    if (!content.includes('Rate Limit Reached') && !content.includes('429')) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 16, padding: '16px', backgroundColor: 'rgba(251, 191, 36, 0.05)', border: '1px solid rgba(251, 191, 36, 0.2)', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(251, 191, 36, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <SparklesIcon width={18} height={18} color="#fbbf24" />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#201e24' }}>Ready to resume?</div>
            </div>
            <button
                onClick={onContinue}
                style={{
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: 12,
                    backgroundColor: '#fbbf24',
                    border: 'none',
                    color: '#1a1a1a',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f59e0b'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#fbbf24'; }}
            >
                <PaperAirplaneIcon width={16} height={16} style={{ transform: 'rotate(-45deg)', marginTop: -2 }} />
                Continue Mission
            </button>
        </motion.div>
    );
};

export { ContextTokenRing, VoiceButton, RateLimitContinueButton };
