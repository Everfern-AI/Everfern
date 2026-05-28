import { motion } from 'framer-motion';
import { SparklesIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { WaveformIcon } from './UIIcons';

const ContextTokenRing = ({ used, max }: { used: number; max: number }) => {
    const pct = Math.min((used / max) * 100, 100);
    const displayTokens = used >= 1000 ? `${(used / 1000).toFixed(1)}k` : `${used}`;
    const ringColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : '#22c55e';
    const bgColor = 'rgba(0,0,0,0.06)';

    return (
        <div style={{ position: 'relative', width: 32, height: 32, cursor: 'default' }}>
            <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                backgroundColor: '#1a1a1a', borderRadius: 8, padding: '6px 12px',
                display: 'flex', alignItems: 'center', gap: 4, opacity: 0, pointerEvents: 'none',
                transition: 'opacity 0.15s ease', whiteSpace: 'nowrap', zIndex: 9999, marginBottom: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }} className="token-ring-tooltip">
                <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                    {displayTokens}
                </span>
                <span style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Figtree', system-ui, sans-serif" }}>/</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', fontFamily: "'Figtree', system-ui, sans-serif" }}>
                    {Math.round(max / 1000)}k
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', fontFamily: "'Figtree', system-ui, sans-serif" }}>tokens</span>
            </div>
            <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: 'rotate(-90deg)' }}>
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
            <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, color: ringColor,
                fontFamily: "'Figtree', system-ui, sans-serif"
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
                    e.currentTarget.style.borderColor = "#a1a1aa";
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
