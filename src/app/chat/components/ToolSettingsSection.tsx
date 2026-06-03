'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    GlobeAltIcon,
    MagnifyingGlassIcon,
    WrenchScrewdriverIcon,
    KeyIcon,
    CheckIcon,
    EyeIcon,
    ComputerDesktopIcon,
} from '@heroicons/react/24/outline';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolConfig {
    mode: 'local' | 'api';
    headless: boolean;
    apiKey: string;
}

interface NavisConfig {
    useVision: boolean;
    headless: boolean;
    maxSteps: number;
    useChromeProfile: boolean;
}

interface ToolSettingsConfig {
    webSearch: ToolConfig;
    webCrawl: ToolConfig;
    browserUse: ToolConfig;
    navis: NavisConfig;
}

const DEFAULT_NAVIS_SETTINGS: NavisConfig = {
    useVision: true,
    headless: false,
    maxSteps: 12,
    useChromeProfile: false,
};

const DEFAULT_TOOL_SETTINGS: ToolSettingsConfig = {
    webSearch: { mode: 'local', headless: true, apiKey: '' },
    webCrawl: { mode: 'local', headless: true, apiKey: '' },
    browserUse: { mode: 'local', headless: false, apiKey: '' },
    navis: { ...DEFAULT_NAVIS_SETTINGS },
};

// ── Shared sub-components (matching SettingsPage style) ───────────────────────

const Label = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, margin: '0 0 8px' }}>
        {children}
    </p>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        style={{
            width: '100%', padding: '12px 16px', backgroundColor: '#f4f4f4',
            border: '1px solid #e8e6d9', borderRadius: 12, color: '#111111',
            fontSize: 14, outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box',
            fontFamily: 'var(--font-sans)',
            ...props.style,
        }}
        onFocus={e => { e.target.style.borderColor = '#111111'; }}
        onBlur={e => { e.target.style.borderColor = '#e8e6d9'; }}
        onMouseDown={e => e.stopPropagation()}
    />
);

// ── ToolConfigPanel ───────────────────────────────────────────────────────────

interface ToolConfigPanelProps {
    title: string;
    icon: React.ReactNode;
    apiLabel: string;
    config: ToolConfig;
    onChange: (config: ToolConfig) => void;
}

const ToolConfigPanel = ({ title, icon, apiLabel, config, onChange }: ToolConfigPanelProps) => {
    return (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e8e6d9', borderRadius: 16, padding: 24, marginBottom: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#f4f4f4', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e6d9', color: '#4a4846' }}>
                    {icon}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: 0 }}>{title}</h3>
            </div>

            {/* Mode selector */}
            <div style={{ marginBottom: 16 }}>
                <Label>Execution Mode</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {(['local', 'api'] as const).map(mode => {
                        const isSelected = config.mode === mode;
                        return (
                            <div
                                key={mode}
                                onClick={() => onChange({ ...config, mode })}
                                style={{
                                    padding: '14px 16px',
                                    borderRadius: 12,
                                    border: `1.5px solid ${isSelected ? '#111111' : '#e8e6d9'}`,
                                    backgroundColor: isSelected ? '#f4f4f4' : '#ffffff',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '#fafafa'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '#ffffff'; }}
                            >
                                {isSelected && (
                                    <div style={{ position: 'absolute', top: 10, right: 10, color: '#111111' }}>
                                        <CheckIcon width={14} height={14} strokeWidth={2.5} />
                                    </div>
                                )}
                                <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: '#111111', marginBottom: 2 }}>
                                    {mode === 'local' ? 'Local' : 'API'}
                                </div>
                                <div style={{ fontSize: 12, color: '#8a8886' }}>
                                    {mode === 'local' ? 'Playwright browser' : 'External API'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Conditional: headless toggle (local mode only) */}
            <AnimatePresence initial={false}>
                {config.mode === 'local' && (
                    <motion.div
                        key="headless-toggle"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ paddingTop: 4 }}>
                            <Label>Browser Mode</Label>
                            <div
                                onClick={() => onChange({ ...config, headless: !config.headless })}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '12px 16px', backgroundColor: '#f9f9f8', border: '1px solid #e8e6d9',
                                    borderRadius: 12, cursor: 'pointer', transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f4f4f4'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f9f9f8'}
                            >
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: '#111111' }}>
                                        {config.headless ? 'Headless' : 'Headful'}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#8a8886', marginTop: 2 }}>
                                        {config.headless ? 'Browser runs invisibly in the background' : 'Browser window is visible on screen'}
                                    </div>
                                </div>
                                {/* Toggle switch */}
                                <div style={{
                                    width: 44, height: 24, borderRadius: 12, position: 'relative',
                                    backgroundColor: config.headless ? '#111111' : '#e8e6d9',
                                    transition: 'background 0.2s', flexShrink: 0,
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 3,
                                        left: config.headless ? 23 : 3,
                                        width: 18, height: 18, borderRadius: '50%',
                                        backgroundColor: '#ffffff',
                                        transition: 'left 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                    }} />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Conditional: API key input (api mode only) */}
            <AnimatePresence initial={false}>
                {config.mode === 'api' && (
                    <motion.div
                        key="api-key-input"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ paddingTop: 4 }}>
                            <Label>{apiLabel}</Label>
                            <div style={{ position: 'relative' }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886', pointerEvents: 'none' }} />
                                <Input
                                    type="password"
                                    placeholder="Enter API key..."
                                    value={config.apiKey}
                                    onChange={e => onChange({ ...config, apiKey: e.target.value })}
                                    style={{ paddingLeft: 40 }}
                                />
                            </div>
                            <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 8 }}>
                                Stored locally in ~/.everfern/ — never leaves your device.
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ── ToolSettingsSection ───────────────────────────────────────────────────────

export function ToolSettingsSection() {
    const [config, setConfig] = useState<ToolSettingsConfig>(DEFAULT_TOOL_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);

    // Load config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const stored = await (window as any).electronAPI?.toolSettings?.get?.();
                if (stored) {
                    // Merge with defaults to ensure all keys (like browserUse) exist
                    const merged = {
                        ...DEFAULT_TOOL_SETTINGS,
                        ...stored,
                        webSearch: { ...DEFAULT_TOOL_SETTINGS.webSearch, ...(stored.webSearch || {}) },
                        webCrawl: { ...DEFAULT_TOOL_SETTINGS.webCrawl, ...(stored.webCrawl || {}) },
                        browserUse: { ...DEFAULT_TOOL_SETTINGS.browserUse, ...(stored.browserUse || {}) },
                        navis: { ...DEFAULT_NAVIS_SETTINGS, ...(stored.navis || {}) },
                    };
                    setConfig(merged);
                }
            } catch (e) {
                console.error('[ToolSettingsSection] Failed to load config:', e);
            }
            setIsLoading(false);
        };
        load();
    }, []);

    const handleChange = async (key: keyof ToolSettingsConfig, toolConfig: ToolConfig) => {
        const next = { ...config, [key]: toolConfig };
        setConfig(next);
        try {
            await (window as any).electronAPI?.toolSettings?.set?.(next);
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to save config:', e);
        }
    };

    const handleOpenBrowser = async () => {
        try {
            await (window as any).electronAPI?.toolSettings?.openDebugBrowser?.();
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to open debug browser:', e);
        }
    };

    const handleNavisChange = async (navisConfig: NavisConfig) => {
        const next = { ...config, navis: navisConfig };
        setConfig(next);
        try {
            await (window as any).electronAPI?.toolSettings?.set?.(next);
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to save navis config:', e);
        }
    };

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 40, color: '#8a8886', fontSize: 14 }}>
                Loading tool settings...
            </div>
        );
    }

    return (
        <div>
            <ToolConfigPanel
                title="Web Search"
                icon={<MagnifyingGlassIcon width={18} height={18} />}
                apiLabel="Exa API Key"
                config={config.webSearch}
                onChange={toolConfig => handleChange('webSearch', toolConfig)}
            />
            <ToolConfigPanel
                title="Website Crawl"
                icon={<GlobeAltIcon width={18} height={18} />}
                apiLabel="Firecrawl API Key"
                config={config.webCrawl}
                onChange={toolConfig => handleChange('webCrawl', toolConfig)}
            />
            <ToolConfigPanel
                title="Browser Research"
                icon={<WrenchScrewdriverIcon width={18} height={18} />}
                apiLabel="N/A"
                config={config.browserUse}
                onChange={toolConfig => handleChange('browserUse', toolConfig)}
            />

            {/* ── Navis (AI Browser) Panel ─────────────────────────────── */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e8e6d9', borderRadius: 16, padding: 24, marginBottom: 16 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
                        <ComputerDesktopIcon width={18} height={18} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: 0 }}>Navis (AI Browser)</h3>
                        <p style={{ fontSize: 11, color: '#8a8886', margin: '2px 0 0' }}>Autonomous browser research agent</p>
                    </div>
                </div>

                {/* Vision Mode Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Vision Mode</Label>
                    <div
                        onClick={() => handleNavisChange({ ...config.navis, useVision: !config.navis.useVision })}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', backgroundColor: config.navis.useVision ? '#f0ecff' : '#f9f9f8',
                            border: `1px solid ${config.navis.useVision ? '#667eea' : '#e8e6d9'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = config.navis.useVision ? '#e8e4ff' : '#f4f4f4'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = config.navis.useVision ? '#f0ecff' : '#f9f9f8'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EyeIcon width={18} height={18} style={{ color: config.navis.useVision ? '#667eea' : '#8a8886' }} />
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: '#111111' }}>
                                    {config.navis.useVision ? 'Vision Enabled' : 'Vision Disabled'}
                                </div>
                                <div style={{ fontSize: 11, color: '#8a8886', marginTop: 2, maxWidth: 300 }}>
                                    {config.navis.useVision
                                        ? 'Screenshots + VLM for precise visual element detection'
                                        : 'DOM accessibility tree only (faster, text-based)'}
                                </div>
                            </div>
                        </div>
                        <div style={{
                            width: 44, height: 24, borderRadius: 12, position: 'relative',
                            backgroundColor: config.navis.useVision ? '#667eea' : '#e8e6d9',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}>
                            <div style={{
                                position: 'absolute', top: 3,
                                left: config.navis.useVision ? 23 : 3,
                                width: 18, height: 18, borderRadius: '50%',
                                backgroundColor: '#ffffff',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                        </div>
                    </div>
                </div>

                {/* Chrome Profile Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Chrome Profile</Label>
                    <div
                        onClick={() => handleNavisChange({ ...config.navis, useChromeProfile: !config.navis.useChromeProfile })}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', backgroundColor: config.navis.useChromeProfile ? '#eef7f1' : '#f9f9f8',
                            border: `1px solid ${config.navis.useChromeProfile ? '#2f8f5b' : '#e8e6d9'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = config.navis.useChromeProfile ? '#e2f1e8' : '#f4f4f4'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = config.navis.useChromeProfile ? '#eef7f1' : '#f9f9f8'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ComputerDesktopIcon width={18} height={18} style={{ color: config.navis.useChromeProfile ? '#2f8f5b' : '#8a8886' }} />
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: '#111111' }}>
                                    {config.navis.useChromeProfile ? 'Use Your Chrome Profile' : 'Use Isolated Browser'}
                                </div>
                                <div style={{ fontSize: 11, color: '#8a8886', marginTop: 2, maxWidth: 330 }}>
                                    {config.navis.useChromeProfile
                                        ? 'Runs Navis in your default Chrome profile and groups tabs as Navis Agent'
                                        : 'Runs Navis in its own Playwright Chromium session'}
                                </div>
                            </div>
                        </div>
                        <div style={{
                            width: 44, height: 24, borderRadius: 12, position: 'relative',
                            backgroundColor: config.navis.useChromeProfile ? '#2f8f5b' : '#e8e6d9',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}>
                            <div style={{
                                position: 'absolute', top: 3,
                                left: config.navis.useChromeProfile ? 23 : 3,
                                width: 18, height: 18, borderRadius: '50%',
                                backgroundColor: '#ffffff',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                        </div>
                    </div>
                </div>

                {/* Max Steps Slider */}
                <div>
                    <Label>Max Steps Per Task</Label>
                    <div style={{ padding: '12px 16px', backgroundColor: '#f9f9f8', border: '1px solid #e8e6d9', borderRadius: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, color: '#111111', fontWeight: 500 }}>Steps limit</span>
                            <span style={{ fontSize: 13, color: '#667eea', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{config.navis.maxSteps}</span>
                        </div>
                        <input
                            type="range"
                            min={10}
                            max={50}
                            step={5}
                            value={config.navis.maxSteps}
                            onChange={e => handleNavisChange({ ...config.navis, maxSteps: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: '#667eea', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: '#a8a6a1' }}>10 (fast)</span>
                            <span style={{ fontSize: 10, color: '#a8a6a1' }}>50 (thorough)</span>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ padding: '12px 16px', backgroundColor: '#f9f9f8', border: '1px solid #e8e6d9', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <WrenchScrewdriverIcon width={14} height={14} style={{ color: '#8a8886' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#4a4846' }}>About Tool Modes</span>
                </div>
                <p style={{ fontSize: 12, color: '#8a8886', margin: 0, lineHeight: 1.6 }}>
                    <strong>Local</strong> mode uses a Playwright-controlled Chromium browser. <strong>API</strong> mode calls an external service (Exa for search, Firecrawl for crawl) using your API key. <strong>Navis Vision</strong> sends screenshots to a vision AI model for precise page understanding. Changes take effect immediately — no restart required.
                </p>
            </div>
        </div>
    );
}

export default ToolSettingsSection;
