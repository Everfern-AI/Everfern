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
    ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import PdfOcrPanel from './PdfOcrPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolConfig {
    mode: 'local' | 'api';
    provider?: 'exa' | 'firecrawl';
    headless: boolean;
    apiKey: string;
    exaApiKey?: string;
    firecrawlApiKey?: string;
}

interface NavisConfig {
    useVision: boolean;
    onlyVision: boolean;
    headless: boolean;
    maxSteps: number;
    useChromeProfile: boolean;
    selectedBrowserId: string;
    useIsolatedBrowser: boolean;
    automationMode: 'extension-first' | 'playwright';
}

interface ToolSettingsConfig {
    webSearch: ToolConfig;
    webCrawl: ToolConfig;
    browserUse: ToolConfig;
    navis: NavisConfig;
}

const DEFAULT_NAVIS_SETTINGS: NavisConfig = {
    useVision: false,
    onlyVision: false,
    headless: false,
    maxSteps: 200,
    useChromeProfile: true,
    selectedBrowserId: 'chrome',
    useIsolatedBrowser: false,
    automationMode: 'extension-first',
};

const DEFAULT_TOOL_SETTINGS: ToolSettingsConfig = {
    webSearch: { mode: 'local', provider: 'exa', headless: true, apiKey: '', exaApiKey: '', firecrawlApiKey: '' },
    webCrawl: { mode: 'local', headless: true, apiKey: '' },
    browserUse: { mode: 'local', headless: false, apiKey: '' },
    navis: { ...DEFAULT_NAVIS_SETTINGS },
};

// ── Shared sub-components (matching SettingsPage style) ───────────────────────

const Label = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, margin: '0 0 8px' }}>
        {children}
    </p>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        style={{
            width: '100%', padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-text-primary)',
            fontSize: 14, outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box',
            fontFamily: 'var(--font-sans)',
            ...props.style,
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--color-text-primary)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }}
        onMouseDown={e => e.stopPropagation()}
    />
);

// ── WebSearchConfigPanel ───────────────────────────────────────────────────────

interface WebSearchConfigPanelProps {
    config: ToolConfig;
    onChange: (config: ToolConfig) => void;
}

const WebSearchConfigPanel = ({ config, onChange }: WebSearchConfigPanelProps) => {
    const currentProvider = config.provider || 'exa';
    const currentApiKey = currentProvider === 'firecrawl'
        ? (config.firecrawlApiKey ?? config.apiKey ?? '')
        : (config.exaApiKey ?? config.apiKey ?? '');

    const handleProviderChange = (provider: 'exa' | 'firecrawl') => {
        const targetApiKey = provider === 'firecrawl'
            ? (config.firecrawlApiKey || (config.provider === 'firecrawl' ? config.apiKey : ''))
            : (config.exaApiKey || (config.provider === 'exa' ? config.apiKey : ''));

        onChange({
            ...config,
            provider,
            apiKey: targetApiKey,
        });
    };

    const handleKeyChange = (val: string) => {
        if (currentProvider === 'firecrawl') {
            onChange({
                ...config,
                firecrawlApiKey: val,
                apiKey: val,
            });
        } else {
            onChange({
                ...config,
                exaApiKey: val,
                apiKey: val,
            });
        }
    };

    return (
        <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    <MagnifyingGlassIcon width={18} height={18} />
                </div>
                <div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Web Search</h3>
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>Search the web via local automation or search APIs</p>
                </div>
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
                                    border: `1.5px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                    backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                            >
                                {isSelected && (
                                    <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--color-text-primary)' }}>
                                        <CheckIcon width={14} height={14} strokeWidth={2.5} />
                                    </div>
                                )}
                                <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                    {mode === 'local' ? 'Local' : 'API'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                    {mode === 'local' ? 'Playwright search' : 'External search provider'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Conditional: Headless toggle (local mode) */}
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
                                    padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                    borderRadius: 12, cursor: 'pointer', transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'}
                            >
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                        {config.headless ? 'Headless' : 'Headful'}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                        {config.headless ? 'Browser runs invisibly in the background' : 'Browser window is visible on screen'}
                                    </div>
                                </div>
                                {/* Toggle switch */}
                                <div style={{
                                    width: 44, height: 24, borderRadius: 12, position: 'relative',
                                    backgroundColor: config.headless ? 'var(--color-text-primary)' : 'var(--color-border)',
                                    transition: 'background 0.2s', flexShrink: 0,
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 3,
                                        left: config.headless ? 23 : 3,
                                        width: 18, height: 18, borderRadius: '50%',
                                        backgroundColor: 'var(--color-bg-surface)',
                                        transition: 'left 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                    }} />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Conditional: Providers & API Key (API mode) */}
            <AnimatePresence initial={false}>
                {config.mode === 'api' && (
                    <motion.div
                        key="api-provider-section"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ paddingTop: 6 }}>
                            <Label>Search Provider</Label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                                {/* Exa Provider Card */}
                                <div
                                    onClick={() => handleProviderChange('exa')}
                                    style={{
                                        padding: '14px 16px',
                                        borderRadius: 12,
                                        border: `1.5px solid ${currentProvider === 'exa' ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                        backgroundColor: currentProvider === 'exa' ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease-out',
                                        position: 'relative',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                    onMouseEnter={e => { if (currentProvider !== 'exa') e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                    onMouseLeave={e => { if (currentProvider !== 'exa') e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                                >
                                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)', flexShrink: 0, overflow: 'hidden', padding: 4 }}>
                                        <img src="/images/etc/tools/exa-color.png" alt="Exa" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13.5, fontWeight: currentProvider === 'exa' ? 600 : 500, color: 'var(--color-text-primary)' }}>Exa</div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>Neural AI Search</div>
                                    </div>
                                    {currentProvider === 'exa' && (
                                        <div style={{ color: 'var(--color-text-primary)' }}>
                                            <CheckIcon width={16} height={16} strokeWidth={2.5} />
                                        </div>
                                    )}
                                </div>

                                {/* Firecrawl Provider Card */}
                                <div
                                    onClick={() => handleProviderChange('firecrawl')}
                                    style={{
                                        padding: '14px 16px',
                                        borderRadius: 12,
                                        border: `1.5px solid ${currentProvider === 'firecrawl' ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                        backgroundColor: currentProvider === 'firecrawl' ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease-out',
                                        position: 'relative',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                    onMouseEnter={e => { if (currentProvider !== 'firecrawl') e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                    onMouseLeave={e => { if (currentProvider !== 'firecrawl') e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                                >
                                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)', flexShrink: 0, overflow: 'hidden', padding: 4 }}>
                                        <img src="/images/etc/tools/firecrawl-logo.png" alt="Firecrawl" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13.5, fontWeight: currentProvider === 'firecrawl' ? 600 : 500, color: 'var(--color-text-primary)' }}>Firecrawl</div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>Markdown Search</div>
                                    </div>
                                    {currentProvider === 'firecrawl' && (
                                        <div style={{ color: 'var(--color-text-primary)' }}>
                                            <CheckIcon width={16} height={16} strokeWidth={2.5} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* API Key Input */}
                            <Label>{currentProvider === 'firecrawl' ? 'Firecrawl API Key' : 'Exa API Key'}</Label>
                            <div style={{ position: 'relative' }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                                <Input
                                    type="password"
                                    placeholder={currentProvider === 'firecrawl' ? 'Enter Firecrawl API key (fc-...)' : 'Enter Exa API key...'}
                                    value={currentApiKey}
                                    onChange={e => handleKeyChange(e.target.value)}
                                    style={{ paddingLeft: 40 }}
                                />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 8 }}>
                                Stored securely in ~/.everfern/ — never leaves your device.
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ── ToolConfigPanel (for WebCrawl & BrowserResearch) ──────────────────────────

interface ToolConfigPanelProps {
    title: string;
    icon: React.ReactNode;
    apiLabel: string;
    config: ToolConfig;
    onChange: (config: ToolConfig) => void;
}

const ToolConfigPanel = ({ title, icon, apiLabel, config, onChange }: ToolConfigPanelProps) => {
    return (
        <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    {icon}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>{title}</h3>
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
                                    border: `1.5px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                    backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                            >
                                {isSelected && (
                                    <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--color-text-primary)' }}>
                                        <CheckIcon width={14} height={14} strokeWidth={2.5} />
                                    </div>
                                )}
                                <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                    {mode === 'local' ? 'Local' : 'API'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
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
                                    padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                    borderRadius: 12, cursor: 'pointer', transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'}
                            >
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                        {config.headless ? 'Headless' : 'Headful'}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                        {config.headless ? 'Browser runs invisibly in the background' : 'Browser window is visible on screen'}
                                    </div>
                                </div>
                                {/* Toggle switch */}
                                <div style={{
                                    width: 44, height: 24, borderRadius: 12, position: 'relative',
                                    backgroundColor: config.headless ? 'var(--color-text-primary)' : 'var(--color-border)',
                                    transition: 'background 0.2s', flexShrink: 0,
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 3,
                                        left: config.headless ? 23 : 3,
                                        width: 18, height: 18, borderRadius: '50%',
                                        backgroundColor: 'var(--color-bg-surface)',
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
                {config.mode === 'api' && apiLabel !== 'N/A' && (
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
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                                <Input
                                    type="password"
                                    placeholder="Enter API key..."
                                    value={config.apiKey}
                                    onChange={e => onChange({ ...config, apiKey: e.target.value })}
                                    style={{ paddingLeft: 40 }}
                                />
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 8 }}>
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
    const [extensionStatus, setExtensionStatus] = useState<any>(null);
    const [extensionMessage, setExtensionMessage] = useState<string>('');
    const [isPreparingMainProfileExtension, setIsPreparingMainProfileExtension] = useState(false);

    const openLink = async (url: string) => {
        try {
            if ((window as any).electronAPI?.shell?.openExternal) {
                await (window as any).electronAPI.shell.openExternal(url);
            } else {
                window.open(url, '_blank');
            }
        } catch (e) {
            console.error('Failed to open link:', e);
            window.open(url, '_blank');
        }
    };

    // Load config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const stored = await (window as any).electronAPI?.toolSettings?.get?.();
                const navisExtensionStatus = await (window as any).electronAPI?.toolSettings?.getNavisExtensionStatus?.();
                if (navisExtensionStatus) {
                    setExtensionStatus(navisExtensionStatus);
                }
                if (stored) {
                    const merged = {
                        ...DEFAULT_TOOL_SETTINGS,
                        ...stored,
                        webSearch: { ...DEFAULT_TOOL_SETTINGS.webSearch, ...(stored.webSearch || {}) },
                        webCrawl: { ...DEFAULT_TOOL_SETTINGS.webCrawl, ...(stored.webCrawl || {}) },
                        browserUse: { ...DEFAULT_TOOL_SETTINGS.browserUse, ...(stored.browserUse || {}) },
                        navis: { ...DEFAULT_NAVIS_SETTINGS, ...(stored.navis || {}), useIsolatedBrowser: false, useChromeProfile: true, automationMode: 'extension-first' },
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

    const handlePrepareMainProfileExtension = async () => {
        setIsPreparingMainProfileExtension(true);
        setExtensionMessage('');
        try {
            const result = await (window as any).electronAPI?.toolSettings?.prepareNavisMainProfileExtension?.();
            setExtensionStatus({
                connected: Boolean(result?.connected),
                connectedExtensions: result?.connected ? 1 : 0,
                extensionPath: result?.extensionPath,
            });
            setExtensionMessage(result?.message || 'Navis extension install folder is ready.');
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to prepare Navis extension:', e);
            setExtensionMessage(e instanceof Error ? e.message : 'Failed to prepare Navis extension.');
        } finally {
            setIsPreparingMainProfileExtension(false);
        }
    };

    const handleNavisChange = async (navisConfig: NavisConfig) => {
        const enforcedConfig: NavisConfig = {
            ...navisConfig,
            useIsolatedBrowser: false,
            useChromeProfile: true,
            automationMode: 'extension-first',
        };
        const next = { ...config, navis: enforcedConfig };
        setConfig(next);
        try {
            await (window as any).electronAPI?.toolSettings?.set?.(next);
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to save navis config:', e);
        }
    };

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)', fontSize: 14 }}>
                Loading tool settings...
            </div>
        );
    }

    return (
        <div>
            {/* ── Web Search Panel (Exa & Firecrawl) ──────────────────────── */}
            <WebSearchConfigPanel
                config={config.webSearch}
                onChange={toolConfig => handleChange('webSearch', toolConfig)}
            />

            {/* ── Website Crawl Panel ────────────────────────────────────── */}
            <ToolConfigPanel
                title="Website Crawl"
                icon={<GlobeAltIcon width={18} height={18} />}
                apiLabel="Firecrawl API Key"
                config={config.webCrawl}
                onChange={toolConfig => handleChange('webCrawl', toolConfig)}
            />

            {/* ── Browser Research Panel ─────────────────────────────────── */}
            <ToolConfigPanel
                title="Browser Research"
                icon={<WrenchScrewdriverIcon width={18} height={18} />}
                apiLabel="N/A"
                config={config.browserUse}
                onChange={toolConfig => handleChange('browserUse', toolConfig)}
            />

            {/* ── Navis (AI Browser) Panel ─────────────────────────────── */}
            <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
                {/* Header with 3D computer icon */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <div style={{
                        width: 38, height: 38, borderRadius: 10,
                        backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.04)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden', padding: 4,
                    }}>
                        <img
                            src="/3d-icons/computer-front-color.png"
                            alt="Navis AI Browser"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Navis (AI Browser)</h3>
                        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>Autonomous browser research agent</p>
                    </div>
                </div>

                {/* Extension Integration Card */}
                <div style={{
                    padding: 16,
                    backgroundColor: 'var(--color-bg-base)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 14,
                    marginBottom: 18,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <Label>Browser Extension Integration</Label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: extensionStatus?.connected ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: extensionStatus?.connected ? 'var(--color-success)' : 'var(--color-text-placeholder)', display: 'inline-block' }} />
                            {extensionStatus?.connected ? 'Navis extension connected' : 'Extension not connected'}
                        </div>
                    </div>

                    <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: '0 0 14px' }}>
                        Navis operates exclusively through the official browser extension, allowing it to navigate, research, and execute tasks directly in your real browser profile.
                    </p>

                    {/* Store Buttons (Chrome & Firefox) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        {/* Chrome Button */}
                        <button
                            type="button"
                            onClick={() => openLink('https://chromewebstore.google.com/detail/everfern-navis/pipkiglicdhcacieghoinohgfibhkmgf?hl=en&authuser=0')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 9,
                                padding: '12px 16px',
                                borderRadius: 12,
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 13,
                                color: 'var(--color-text-primary)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                e.currentTarget.style.borderColor = 'var(--color-text-secondary)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)';
                                e.currentTarget.style.borderColor = 'var(--color-border)';
                            }}
                        >
                            {/* Chrome Icon SVG */}
                            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                <circle cx="24" cy="24" r="22" fill="#d4d4d4" />
                                <circle cx="24" cy="24" r="9" fill="var(--color-bg-surface)" />
                                <circle cx="24" cy="24" r="5.5" fill="#a3a3a3" />
                                <path d="M24 2C14 2 5.7 8.4 3 17l12.5.5L24 15a9 9 0 0 1 8.5 5H46A22 22 0 0 0 24 2z" fill="#b0b0b0" />
                                <path d="M32.5 20A9 9 0 0 1 28 32.5L34 44A22 22 0 0 0 46 20H32.5z" fill="#c0c0c0" />
                                <path d="M20 32.5A9 9 0 0 1 15.5 17L3 17a22 22 0 0 0 31 27l-6-11.5z" fill="#9a9a9a" />
                            </svg>
                            <span>Add to Chrome</span>
                            <ArrowTopRightOnSquareIcon width={13} height={13} style={{ color: 'var(--color-text-tertiary)' }} />
                        </button>

                        {/* Firefox Button */}
                        <button
                            type="button"
                            onClick={() => openLink('https://addons.mozilla.org/en-US/firefox/addon/everfern-navis/')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 9,
                                padding: '12px 16px',
                                borderRadius: 12,
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 13,
                                color: 'var(--color-text-primary)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                e.currentTarget.style.borderColor = 'var(--color-text-secondary)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)';
                                e.currentTarget.style.borderColor = 'var(--color-border)';
                            }}
                        >
                            {/* Firefox Icon SVG */}
                            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                <circle cx="24" cy="24" r="22" fill="#c8c8c8" />
                                <circle cx="24" cy="24" r="10" fill="var(--color-bg-surface)" />
                                <path d="M24 4C13 4 4 13 4 24c0 3 .6 6 1.8 8.6L16 28c-.6-1.3-1-2.6-1-4 0-5 4-9 9-9 1.4 0 2.7.4 4 1l4.6-10.2C30 4.6 27 4 24 4z" fill="#a0a0a0" />
                                <path d="M44 24c0-7-3.7-13-9.3-16.5L30 17.7c2.5 1.8 4 4.8 4 8.3 0 5.5-4.5 10-10 10-1.8 0-3.5-.5-5-1.4l-4.5 10.4C18 43.1 21 44 24 44c11 0 20-9 20-20z" fill="#888888" />
                            </svg>
                            <span>Add to Firefox</span>
                            <ArrowTopRightOnSquareIcon width={13} height={13} style={{ color: 'var(--color-text-tertiary)' }} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={handlePrepareMainProfileExtension}
                            disabled={isPreparingMainProfileExtension}
                            style={{
                                padding: '7px 12px',
                                borderRadius: 8,
                                border: '1px solid var(--color-border)',
                                backgroundColor: isPreparingMainProfileExtension ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                color: 'var(--color-text-secondary)',
                                fontSize: 11.5,
                                fontWeight: 500,
                                cursor: isPreparingMainProfileExtension ? 'wait' : 'pointer',
                            }}
                        >
                            {isPreparingMainProfileExtension ? 'Preparing folder...' : 'Prepare unpack folder (Dev)'}
                        </button>
                        {extensionMessage && (
                            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                                {extensionMessage}
                            </span>
                        )}
                    </div>
                </div>

                {/* Vision Mode Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Vision Mode</Label>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)', borderRadius: 12,
                        boxShadow: '0 2px 5px var(--color-bg-overlay), 0 1px 2px var(--color-bg-overlay)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ color: 'var(--color-navis-icon-color)' }}>
                                <EyeIcon width={18} height={18} />
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                    {config.navis.useVision ? 'Vision Enabled' : 'Vision Disabled'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2, maxWidth: 300 }}>
                                    {config.navis.useVision
                                        ? 'Screenshots + VLM for precise visual element detection'
                                        : 'DOM accessibility tree only (faster, text-based)'}
                                </div>
                            </div>
                        </div>
                        {/* Custom Toggle Switch */}
                        <div
                            onClick={() => handleNavisChange({ ...config.navis, useVision: !config.navis.useVision })}
                            style={{
                                width: 44, height: 24, borderRadius: 12, position: 'relative',
                                backgroundColor: config.navis.useVision ? 'var(--color-navis-active-border)' : 'var(--color-border)',
                                cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                            }}
                        >
                            <div style={{
                                position: 'absolute', top: 3,
                                left: config.navis.useVision ? 23 : 3,
                                width: 18, height: 18, borderRadius: '50%',
                                backgroundColor: 'var(--color-bg-surface)',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                        </div>
                    </div>
                </div>

                {/* Only Vision Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Only Vision</Label>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)', borderRadius: 12,
                        boxShadow: '0 2px 5px var(--color-bg-overlay), 0 1px 2px var(--color-bg-overlay)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ color: 'var(--color-navis-icon-color)' }}>
                                <EyeIcon width={18} height={18} />
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                    {config.navis.onlyVision ? 'Only Vision Enabled' : 'Only Vision Disabled'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2, maxWidth: 300 }}>
                                    {config.navis.onlyVision
                                        ? 'Coordinates-only navigation via VLM (bypasses DOM structure completely)'
                                        : 'Standard hybrid mode (prefer DOM structure, use vision on-demand)'}
                                </div>
                            </div>
                        </div>
                        {/* Custom Toggle Switch */}
                        <div
                            onClick={() => handleNavisChange({ ...config.navis, onlyVision: !config.navis.onlyVision })}
                            style={{
                                width: 44, height: 24, borderRadius: 12, position: 'relative',
                                backgroundColor: config.navis.onlyVision ? 'var(--color-navis-active-border)' : 'var(--color-border)',
                                cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                            }}
                        >
                            <div style={{
                                position: 'absolute', top: 3,
                                left: config.navis.onlyVision ? 23 : 3,
                                width: 18, height: 18, borderRadius: '50%',
                                backgroundColor: 'var(--color-bg-surface)',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                        </div>
                    </div>
                </div>

                {/* Max Steps Slider */}
                <div>
                    <Label>Max Steps Per Task</Label>
                    <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 2px 5px var(--color-bg-overlay), 0 1px 2px var(--color-bg-overlay)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>Steps limit</span>
                            <span style={{ fontSize: 13, color: 'var(--color-navis-active-text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{config.navis.maxSteps}</span>
                        </div>
                        <input
                            type="range"
                            min={10}
                            max={200}
                            step={10}
                            value={config.navis.maxSteps}
                            onChange={e => handleNavisChange({ ...config.navis, maxSteps: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--color-navis-active-border)', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>10 (fast)</span>
                            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>200 (thorough)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── PDF OCR Panel (auto-extract text when PDFs are attached) ── */}
            <PdfOcrPanel />

            <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <WrenchScrewdriverIcon width={14} height={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>About Tool Modes</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0, lineHeight: 1.6 }}>
                    <strong>Web Search</strong> supports local scraping or external APIs (Exa and Firecrawl). <strong>Website Crawl</strong> extracts structured content via Firecrawl. <strong>Navis AI Browser</strong> operates directly via the installed Navis browser extension in Chrome or Firefox. Changes take effect immediately.
                </p>
            </div>
        </div>
    );
}

export default ToolSettingsSection;
