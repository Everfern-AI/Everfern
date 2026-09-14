'use client';
import React from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { GlobeAltIcon, CheckIcon, KeyIcon, CpuChipIcon, CircleStackIcon, ServerIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card, Label, Input, Select } from './ui';

/** Provider id/name/logo entries for the "Web API" engine grid. Exported so
 *  other settings sections can reuse the same provider list. */
export const settingsPrimaryProviders = [
    { id: 'openai', name: 'OpenAI', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openai.svg" alt="OpenAI" width={size} height={size} className="dark:invert" /> },
    { id: 'anthropic', name: 'Anthropic', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic" width={size} height={size} /> },
    { id: 'gemini', name: 'Google Gemini', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/gemini.svg" alt="Google" width={size} height={size} /> },
    { id: 'deepseek', name: 'DeepSeek', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/deepseek.svg" alt="DeepSeek" width={size} height={size} /> },
    { id: 'nvidia', name: 'NVIDIA NIM', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="NVIDIA" width={size} height={size} /> },
    { id: 'openrouter', name: 'OpenRouter', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} className="dark:invert" /> },
    { id: 'minimax', name: 'MiniMax', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax" width={size} height={size} /> },
    { id: 'ollama-cloud', name: 'Ollama Cloud', Logo: ({ size = 18 }: any) => <svg fill="currentColor" fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.436 1.676-1.126 2.265-.675.58-1.6.936-2.617.936-1.016 0-1.942-.356-2.617-.936-.69-.589-1.126-1.377-1.126-2.265 0-.705.375-1.413 1.005-1.94a3.748 3.748 0 012.446-.855z" clipRule="evenodd" /></svg> },
    { id: 'huggingface', name: 'Hugging Face', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/hf-logo.svg" alt="Hugging Face" width={size} height={size} /> },
];

/**
 * Models & Providers settings: pick the AI engine (local / online API /
 * EverFern Cloud), then configure the provider, credentials, and local model
 * inventory. Local state (installed/recommended models, pull progress) is
 * owned by the parent page and injected via `localModels` — this component
 * is presentational for that data and only owns engine/provider selection.
 */
export function ModelsSection({
    theme,
    settingsEngine, setSettingsEngine,
    settingsProvider, setSettingsProvider,
    settingsApiKey, setSettingsApiKey,
    settingsCustomModel, setSettingsCustomModel,
    modelValidationStatus, setModelValidationStatus,
    isValidatingModel, setIsValidatingModel,
    checkEverFernLogin,
    localModels,
}: {
    theme: string;
    settingsEngine: 'online' | 'local' | 'everfern' | null;
    setSettingsEngine: React.Dispatch<React.SetStateAction<'online' | 'local' | 'everfern' | null>>;
    settingsProvider: string | null;
    setSettingsProvider: (v: string | null) => void;
    settingsApiKey: string;
    setSettingsApiKey: (v: string) => void;
    settingsCustomModel: string;
    setSettingsCustomModel: (v: string) => void;
    modelValidationStatus: 'none' | 'success' | 'error';
    setModelValidationStatus: (v: 'none' | 'success' | 'error') => void;
    isValidatingModel: boolean;
    setIsValidatingModel: (v: boolean) => void;
    checkEverFernLogin: (providerId: string) => boolean;
    localModels: {
        localHardwareInfo: any;
        installedLocalModels: any[];
        recommendedLocalModels: any[];
        isLoadingLocalModels: boolean;
        localProviderRunning: boolean | null;
        localProviderError: string | null;
        activeModelName: string;
        pullingLocalModel: string | null;
        pullingLocalPct: number;
        localModelTab: 'installed' | 'recommended';
        setLocalModelTab: (v: 'installed' | 'recommended') => void;
        loadLocalModelsForSection: (prov?: string, customUrl?: string) => void;
        handleSetActiveLocalModel: (modelName: string) => void;
        handlePullModelFromSettings: (modelTag: string) => void;
    };
}) {
    const {
        localHardwareInfo,
        installedLocalModels,
        recommendedLocalModels,
        isLoadingLocalModels,
        localProviderRunning,
        localProviderError,
        activeModelName,
        pullingLocalModel,
        pullingLocalPct,
        localModelTab,
        setLocalModelTab,
        loadLocalModelsForSection,
        handleSetActiveLocalModel,
        handlePullModelFromSettings,
    } = localModels;
    return (
        <div>
            <SectionTitle>Models & Providers</SectionTitle>
            <SectionSubtitle>Configure default AI engine, provider, and API credentials.</SectionSubtitle>

            {/* Engine Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { id: 'local', label: 'Local Engine', desc: 'On-device via Ollama or LMStudio.', icon: <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={24} height={24} style={{ filter: `${theme === 'dark' ? 'invert(1)' : ''} ${settingsEngine !== 'local' ? 'grayscale(1) opacity(0.6)' : ''}`.trim() || undefined, transition: 'all 0.3s' }} /> },
                    { id: 'online', label: 'Web API', desc: 'OpenAI, Anthropic, or NVIDIA NIM.', icon: <GlobeAltIcon width={22} height={22} style={{ color: 'var(--color-text-tertiary)' }} /> },
                    { id: 'everfern', label: 'EverFern Cloud', desc: 'Uses front tier models', icon: <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={24} height={24} style={{ filter: `${theme === 'dark' ? 'invert(1)' : ''} ${settingsEngine !== 'everfern' ? 'grayscale(1) opacity(0.6)' : ''}`.trim() || undefined, transition: 'all 0.3s' }} /> },
                ].map(({ id, label, desc, icon }) => {
                    const sel = settingsEngine === id;
                    return (
                        <div
                            key={id}
                            onClick={() => {
                                if (id === 'everfern' && !checkEverFernLogin('everfern')) return;
                                setSettingsEngine(id as 'online' | 'local' | 'everfern');
                                // Switching away from 'online' clears the provider/key
                                // pair so a stale cloud API key never bleeds into the
                                // local or EverFern engine config.
                                if (id !== 'online') { setSettingsProvider(null); setSettingsApiKey(''); }
                                if (id === 'everfern') {
                                    setSettingsProvider('everfern');
                                    // Use local storage JWT if available
                                    // Wrapped in try/catch: storage access
                                    // can throw in restricted contexts; a
                                    // missing token must not break selection.
                                    try {
                                        const stored = localStorage.getItem('everfern_auth_token');
                                        if (stored) setSettingsApiKey(stored);
                                    } catch (e) {}
                                }
                            }}
                            style={{
                                position: 'relative',
                                cursor: 'pointer',
                                padding: 20,
                                borderRadius: 16,
                                backgroundColor: sel ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                border: `1.5px solid ${sel ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                transition: 'all 0.2s',
                            }}
                        >
                            {sel && <div style={{ position: 'absolute', top: 14, right: 14, color: 'var(--color-text-primary)' }}><CheckIcon width={16} height={16} strokeWidth={2.5} /></div>}
                            <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, border: '1px solid var(--color-border)' }}>
                                {icon}
                            </div>
                            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>{label}</h3>
                            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5, margin: 0 }}>{desc}</p>
                        </div>
                    );
                })}
            </div>

            {/* Local Models Settings */}
            <AnimatePresence initial={false}>
                {settingsEngine === 'local' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                        <Card>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16, marginBottom: 16 }}>
                                <div>
                                    <Label>Local Provider</Label>
                                    <Select
                                        value={settingsProvider || 'ollama'}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setSettingsProvider(val);
                                            // For local providers the "API key" field is
                                            // repurposed as the server base URL — seed it
                                            // with the conventional port for each provider.
                                            if (val === 'lmstudio') setSettingsApiKey('http://localhost:1234/v1');
                                            else if (val === 'ollama') setSettingsApiKey('http://localhost:11434');
                                        }}
                                    >
                                        <option value="ollama">Ollama (Default)</option>
                                        <option value="lmstudio">LM Studio</option>
                                    </Select>
                                </div>

                                <div>
                                    <Label>Local Server URL (Optional)</Label>
                                    <div style={{ position: 'relative' }}>
                                        <GlobeAltIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                        <Input
                                            type="text"
                                            placeholder={settingsProvider === 'lmstudio' ? "http://localhost:1234/v1" : "http://localhost:11434"}
                                            value={settingsApiKey}
                                            onChange={e => setSettingsApiKey(e.target.value)}
                                            style={{ paddingLeft: 40 }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* System Hardware Spec Banner */}
                            <div style={{
                                display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10,
                                padding: 12, borderRadius: 12, backgroundColor: 'var(--color-bg-subtle)',
                                border: '1px solid var(--color-border)', marginBottom: 16, textAlign: 'left'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <CpuChipIcon width={18} height={18} style={{ color: 'var(--color-text-primary)' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>GPU Processor</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {localHardwareInfo?.gpuName || 'GPU Processor'}
                                        </div>
                                        <div style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                                            {localHardwareInfo?.vramGB || 0} GB {localHardwareInfo?.isAppleSilicon ? 'Unified' : 'VRAM'}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <CircleStackIcon width={18} height={18} style={{ color: 'var(--color-text-primary)' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>System Memory</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {localHardwareInfo?.ramGB || 16} GB RAM
                                        </div>
                                        <div style={{ fontSize: 10.5, color: 'var(--color-text-secondary)' }}>
                                            {localHardwareInfo?.freeRamGB || 8} GB Free
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <ServerIcon width={18} height={18} style={{ color: 'var(--color-text-primary)' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Server Status</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: localProviderRunning ? '#22c55e' : 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: localProviderRunning ? '#22c55e' : 'var(--color-warning)' }} />
                                            {localProviderRunning ? 'Connected' : 'Offline'}
                                        </div>
                                        <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                                            {settingsProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Offline Alert */}
                            {(!localProviderRunning && localProviderError) && (
                                <div style={{
                                    padding: '12px 14px', borderRadius: 10, backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                    border: '1px solid rgba(245, 158, 11, 0.25)', textAlign: 'left', marginBottom: 16,
                                    display: 'flex', flexDirection: 'column', gap: 6
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>
                                            ⚠️ {settingsProvider === 'lmstudio' ? "LM Studio Local Server is not reachable" : "Ollama service is offline"}
                                        </span>
                                        <button
                                            onClick={() => loadLocalModelsForSection(settingsProvider || 'ollama', settingsApiKey)}
                                            disabled={isLoadingLocalModels}
                                            style={{
                                                padding: '3px 8px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.2)',
                                                border: '1px solid rgba(245, 158, 11, 0.3)', color: '#b45309', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                                            }}
                                        >
                                            <ArrowPathIcon width={12} height={12} className={isLoadingLocalModels ? "animate-spin" : ""} /> Retry
                                        </button>
                                    </div>
                                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0 }}>
                                        {settingsProvider === 'lmstudio'
                                            ? "Open LM Studio -> Developer tab (<->) -> Start Server on port 1234."
                                            : "Ensure Ollama is running in background or installed on your machine."}
                                    </p>
                                </div>
                            )}

                            {/* Tabs Switcher */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 8, marginBottom: 12 }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                        onClick={() => setLocalModelTab('installed')}
                                        style={{
                                            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                            backgroundColor: localModelTab === 'installed' ? 'var(--color-text-primary)' : 'transparent',
                                            color: localModelTab === 'installed' ? 'var(--color-bg-base)' : 'var(--color-text-secondary)',
                                            display: 'flex', alignItems: 'center', gap: 6
                                        }}
                                    >
                                        Installed Models ({installedLocalModels.length})
                                    </button>

                                    <button
                                        onClick={() => setLocalModelTab('recommended')}
                                        style={{
                                            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                            backgroundColor: localModelTab === 'recommended' ? 'var(--color-text-primary)' : 'transparent',
                                            color: localModelTab === 'recommended' ? 'var(--color-bg-base)' : 'var(--color-text-secondary)',
                                            display: 'flex', alignItems: 'center', gap: 6
                                        }}
                                    >
                                        ★ AI Recommended
                                    </button>
                                </div>

                                <button
                                    onClick={() => loadLocalModelsForSection(settingsProvider || 'ollama', settingsApiKey)}
                                    disabled={isLoadingLocalModels}
                                    style={{
                                        background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                                    }}
                                >
                                    <ArrowPathIcon width={12} height={12} className={isLoadingLocalModels ? "animate-spin" : ""} /> Refresh
                                </button>
                            </div>

                            {/* Tab 1: Installed Models */}
                            {localModelTab === 'installed' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                                    {installedLocalModels.length > 0 ? (
                                        installedLocalModels.map(m => {
                                            // Ollama vs LM Studio report identity in different
                                            // fields — match against any of the three so the
                                            // active model highlights in both listings.
                                            const isSelected = (activeModelName === m.name || activeModelName === m.id || activeModelName === m.model_id);
                                            return (
                                                <div
                                                    key={m.id || m.name}
                                                    style={{
                                                        padding: '10px 12px', borderRadius: 10,
                                                        backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                                        border: `1.5px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
                                                    }}
                                                >
                                                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</span>
                                                            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-tertiary)' }}>
                                                                {m.params_b}B
                                                            </span>
                                                            <span style={{
                                                                fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                                                backgroundColor: m.status === 'full_gpu' ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-warning-dim)',
                                                                color: m.status === 'full_gpu' ? '#16a34a' : '#d97706'
                                                            }}>
                                                                {m.badge}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                                                            {m.size_gb ? `${m.size_gb} GB disk` : `${m.quantized_q4_vram_gb} GB VRAM`} • {m.isRunnable ? "✓ Fully Runnable" : "⚠️ Heavy"}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        {m.predicted_tps > 0 && (
                                                            <div style={{ textAlign: 'right' }}>
                                                                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>
                                                                    ~{m.predicted_tps} <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)' }}>TPS</span>
                                                                </div>
                                                                <div style={{ fontSize: 10, color: m.isSmooth ? '#16a34a' : 'var(--color-text-secondary)' }}>
                                                                    {m.smoothRating}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {isSelected ? (
                                                            <span style={{
                                                                padding: '4px 10px', borderRadius: 6, backgroundColor: 'rgba(34, 197, 94, 0.15)',
                                                                border: '1px solid rgba(34, 197, 94, 0.3)', color: '#16a34a', fontSize: 11, fontWeight: 600
                                                            }}>
                                                                ✓ Active
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleSetActiveLocalModel(m.name || m.id)}
                                                                style={{
                                                                    padding: '4px 10px', borderRadius: 6, backgroundColor: 'var(--color-bg-subtle)',
                                                                    border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                                                                }}
                                                            >
                                                                Set Active
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div style={{ padding: '20px', borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', textAlign: 'center' }}>
                                            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>No models installed in {settingsProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'}</div>
                                            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '0 0 10px' }}>
                                                Switch to AI Recommended to download top-performing models for your GPU in 1 click.
                                            </p>
                                            <button
                                                onClick={() => setLocalModelTab('recommended')}
                                                style={{
                                                    padding: '5px 12px', borderRadius: 6, backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg-base)',
                                                    fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer'
                                                }}
                                            >
                                                View AI Recommended →
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab 2: AI Recommended for Your Hardware */}
                            {localModelTab === 'recommended' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                                    {recommendedLocalModels.map(m => {
                                        const modelTag = (m.tags && m.tags[0]) || m.name;
                                        const isAlreadyInstalled = installedLocalModels.some(im => im.name?.toLowerCase() === modelTag.toLowerCase() || im.id?.toLowerCase() === modelTag.toLowerCase());
                                        const isPullingThis = pullingLocalModel === modelTag;
                                    
                                        // "Top Match" heuristic: a full-GPU model that is
                                        // small enough to leave headroom — ≤14B on ≥12GB
                                        // VRAM, otherwise ≤7.6B — gets the star badge.
                                        const isTopMatch = m.status === 'full_gpu' && m.params_b <= (Number(localHardwareInfo?.vramGB || 8) >= 12 ? 14 : 7.6);

                                        return (
                                            <div
                                                key={m.model_id || m.name}
                                                style={{
                                                    padding: '10px 12px', borderRadius: 10,
                                                    backgroundColor: 'var(--color-bg-surface)',
                                                    border: `1px solid ${isTopMatch ? 'rgba(59, 130, 246, 0.4)' : 'var(--color-border)'}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
                                                }}
                                            >
                                                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</span>
                                                        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-tertiary)' }}>
                                                            {m.params_b}B
                                                        </span>
                                                        {isTopMatch && (
                                                            <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, backgroundColor: 'var(--color-info-dim)', color: 'var(--color-info)' }}>
                                                                ★ Top Match
                                                            </span>
                                                        )}
                                                        <span style={{
                                                            fontSize: 9.5, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                                                            backgroundColor: m.status === 'full_gpu' ? 'rgba(34, 197, 94, 0.15)' : 'var(--color-warning-dim)',
                                                            color: m.status === 'full_gpu' ? '#16a34a' : '#d97706'
                                                        }}>
                                                            {m.badge}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                                                        {m.category} • VRAM: {m.quantized_q4_vram_gb} GB (Q4)
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>
                                                            ~{m.predicted_tps} <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)' }}>TPS</span>
                                                        </div>
                                                        <div style={{ fontSize: 10, color: m.isSmooth ? '#16a34a' : 'var(--color-text-secondary)' }}>
                                                            {m.smoothRating}
                                                        </div>
                                                    </div>

                                                    {settingsProvider === 'ollama' ? (
                                                        isAlreadyInstalled ? (
                                                            <button
                                                                onClick={() => {
                                                                    handleSetActiveLocalModel(modelTag);
                                                                    setLocalModelTab('installed');
                                                                }}
                                                                style={{
                                                                    padding: '4px 10px', borderRadius: 6, background: 'rgba(34, 197, 94, 0.15)',
                                                                    border: '1px solid rgba(34, 197, 94, 0.3)', color: '#16a34a', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                                                                }}
                                                            >
                                                                ✓ Ready
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handlePullModelFromSettings(modelTag)}
                                                                disabled={!!pullingLocalModel}
                                                                style={{
                                                                    padding: '4px 10px', borderRadius: 6, backgroundColor: 'var(--color-text-primary)',
                                                                    color: 'var(--color-bg-base)', fontSize: 11, fontWeight: 600, border: 'none',
                                                                    cursor: pullingLocalModel ? 'wait' : 'pointer', opacity: pullingLocalModel ? 0.6 : 1,
                                                                    display: 'flex', alignItems: 'center', gap: 4
                                                                }}
                                                            >
                                                                {isPullingThis ? `Pulling ${pullingLocalPct.toFixed(0)}%` : "Download"}
                                                            </button>
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSetActiveLocalModel(modelTag)}
                                                            style={{
                                                                padding: '4px 10px', borderRadius: 6, backgroundColor: 'var(--color-bg-subtle)',
                                                                border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer'
                                                            }}
                                                        >
                                                            Select
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Pull Progress Banner */}
                            {pullingLocalModel && (
                                <div style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', textAlign: 'left' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>Downloading {pullingLocalModel}...</span>
                                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{pullingLocalPct.toFixed(1)}%</span>
                                    </div>
                                    <div style={{ width: '100%', height: 4, borderRadius: 999, background: 'rgba(32,30,36,0.1)', overflow: 'hidden' }}>
                                        <motion.div animate={{ width: `${pullingLocalPct}%` }} transition={{ ease: 'linear', duration: 0.3 }} style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--color-info), var(--color-info-light))' }} />
                                    </div>
                                </div>
                            )}
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Online Provider */}
            <AnimatePresence initial={false}>
                {settingsEngine === 'online' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                        <Card>
                            <Label>Select Provider</Label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20, pointerEvents: 'auto' }}>
                                {settingsPrimaryProviders.map(({ id, name, Logo }) => {
                                    const isSel = settingsProvider === id;
                                    return (
                                        <div key={id}
                                            onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                                                e.stopPropagation();
                                                if (id === 'everfern' && !checkEverFernLogin('everfern')) return;
                                                setSettingsProvider(id);
                                            }}
                                            style={{
                                                padding: '14px 12px',
                                                borderRadius: 12,
                                                border: `1.5px solid ${isSel ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                                backgroundColor: isSel ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: 8,
                                                transition: 'all 0.15s ease-out',
                                                position: 'relative',
                                                userSelect: 'none',
                                                outline: 'none'
                                            }}>
                                            <Logo size={20} />
                                            <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: 'var(--color-text-primary)', textAlign: 'center' }}>{name}</span>
                                            {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: 'var(--color-text-primary)' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                            <AnimatePresence initial={false}>
                                {settingsProvider && (
                                    <motion.div key={`api-key-${settingsProvider}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }} style={{ pointerEvents: 'auto' }}>
                                        <Label>API Key</Label>
                                        <div style={{ position: 'relative', marginBottom: 8 }}>
                                            <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                                            <Input type="password" placeholder="sk-proj-..." value={settingsApiKey} onChange={e => setSettingsApiKey(e.target.value)} style={{ paddingLeft: 40 }} />
                                        </div>
                                        <p style={{ fontSize: 11, color: 'var(--color-placeholder)', marginTop: 4 }}>Stored locally in ~/.everfern/store — never leaves your device.</p>
                                        {(settingsProvider === 'nvidia' || settingsProvider === 'openrouter' || settingsProvider === 'ollama-cloud') && (
                                            <div style={{ marginTop: 16 }}>
                                                <Label>Custom Model ID</Label>
                                                <div style={{ display: 'flex', gap: 10 }}>
                                                    <div style={{ position: 'relative', flex: 1 }}>
                                                        <CpuChipIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                                        <Input
                                                            type="text"
                                                            placeholder={settingsProvider === 'ollama-cloud' ? "e.g. llama3.3, qwen2.5:latest, mistral" : settingsProvider === 'openrouter' ? "e.g. meta-llama/llama-3.1-8b-instruct" : "e.g. moonshotai/kimi-k2.5"}
                                                            value={settingsCustomModel}
                                                            onChange={e => { setSettingsCustomModel(e.target.value); setModelValidationStatus('none'); }}
                                                            style={{ paddingLeft: 40 }}
                                                        />
                                                    </div>
                                                </div>
                                                <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 6 }}>
                                                    {settingsProvider === 'ollama-cloud'
                                                        ? 'Enter any model available on Ollama Cloud. Visit cloud.ollama.ai to browse models.'
                                                        : settingsProvider === 'openrouter'
                                                        ? 'Enter the full model ID from OpenRouter.'
                                                        : 'Enter the full model ID (e.g., provider/model-name).'}
                                                </p>
                                                {modelValidationStatus === 'success' && <p style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 6 }}>✓ Model verified with vision capabilities.</p>}
                                                {modelValidationStatus === 'error' && <p style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>✗ Model not found or missing vision support.</p>}
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
