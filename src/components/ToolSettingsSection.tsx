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
    useChromeProfile: false,
    selectedBrowserId: 'chrome',
    useIsolatedBrowser: true,
    automationMode: 'extension-first',
};

const DEFAULT_TOOL_SETTINGS: ToolSettingsConfig = {
    webSearch: { mode: 'local', headless: true, apiKey: '' },
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

interface SynthesizedToolCardProps {
    tool: {
        name: string;
        description: string;
        parameters: any;
        code: string;
    };
    onDelete: (name: string) => void;
}

function SynthesizedToolCard({ tool, onDelete }: SynthesizedToolCardProps) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 600 }}>{tool.name}</span>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{tool.description}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                    >
                        {expanded ? 'Hide Code' : 'View Code'}
                    </button>
                    <button
                        onClick={() => onDelete(tool.name)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', cursor: 'pointer' }}
                    >
                        Delete
                    </button>
                </div>
            </div>
            {expanded && (
                <pre style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text-primary)', overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {tool.code}
                </pre>
            )}
        </div>
    );
}

export function ToolSettingsSection() {
    const [config, setConfig] = useState<ToolSettingsConfig>(DEFAULT_TOOL_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [extensionStatus, setExtensionStatus] = useState<any>(null);
    const [extensionMessage, setExtensionMessage] = useState<string>('');
    const [isPreparingMainProfileExtension, setIsPreparingMainProfileExtension] = useState(false);
    const [synthesizedTools, setSynthesizedTools] = useState<any[]>([]);

    // Load config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const stored = await (window as any).electronAPI?.toolSettings?.get?.();
                const navisExtensionStatus = await (window as any).electronAPI?.toolSettings?.getNavisExtensionStatus?.();
                if (navisExtensionStatus) setExtensionStatus(navisExtensionStatus);
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
            try {
                if ((window as any).electronAPI?.toolSettings?.listSynthesized) {
                    const list = await (window as any).electronAPI.toolSettings.listSynthesized();
                    setSynthesizedTools(list || []);
                }
            } catch (err) {
                console.error('[ToolSettingsSection] Failed to load synthesized tools:', err);
            }
            setIsLoading(false);
        };
        load();
    }, []);

    const loadSynthesized = async () => {
        try {
            if ((window as any).electronAPI?.toolSettings?.listSynthesized) {
                const list = await (window as any).electronAPI.toolSettings.listSynthesized();
                setSynthesizedTools(list || []);
            }
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to load synthesized tools:', e);
        }
    };

    const handleDeleteSynthesized = async (name: string) => {
        if (!confirm(`Are you sure you want to delete the synthesized tool "${name}"?`)) {
            return;
        }
        try {
            const res = await (window as any).electronAPI?.toolSettings?.deleteSynthesized?.(name);
            if (res?.success) {
                await loadSynthesized();
            } else {
                alert(`Failed to delete tool: ${res?.error || 'Unknown error'}`);
            }
        } catch (e: any) {
            alert(`Error deleting tool: ${e.message || String(e)}`);
        }
    };

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
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)', fontSize: 14 }}>
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
            <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-inverse)' }}>
                        <ComputerDesktopIcon width={18} height={18} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Navis (AI Browser)</h3>
                        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>Autonomous browser research agent</p>
                    </div>
                </div>

                {/* Vision Mode Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Vision Mode</Label>
                    <div
                        onClick={() => handleNavisChange({ ...config.navis, useVision: !config.navis.useVision })}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', backgroundColor: config.navis.useVision ? 'var(--color-navis-active-bg)' : 'var(--color-bg-base)',
                            border: `1px solid ${config.navis.useVision ? 'var(--color-navis-active-border)' : 'var(--color-border)'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = config.navis.useVision ? 'var(--color-navis-active-hover)' : 'var(--color-bg-subtle)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = config.navis.useVision ? 'var(--color-navis-active-bg)' : 'var(--color-bg-base)'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EyeIcon width={18} height={18} style={{ color: config.navis.useVision ? 'var(--color-navis-active-text)' : 'var(--color-text-tertiary)' }} />
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
                        <div style={{
                            width: 44, height: 24, borderRadius: 12, position: 'relative',
                            backgroundColor: config.navis.useVision ? 'var(--color-navis-active-border)' : 'var(--color-border)',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}>
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
                    <div
                        onClick={() => handleNavisChange({ ...config.navis, onlyVision: !config.navis.onlyVision })}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', backgroundColor: config.navis.onlyVision ? 'var(--color-navis-active-bg)' : 'var(--color-bg-base)',
                            border: `1px solid ${config.navis.onlyVision ? 'var(--color-navis-active-border)' : 'var(--color-border)'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = config.navis.onlyVision ? 'var(--color-navis-active-hover)' : 'var(--color-bg-subtle)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = config.navis.onlyVision ? 'var(--color-navis-active-bg)' : 'var(--color-bg-base)'}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EyeIcon width={18} height={18} style={{ color: config.navis.onlyVision ? 'var(--color-navis-active-text)' : 'var(--color-text-tertiary)' }} />
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
                        <div style={{
                            width: 44, height: 24, borderRadius: 12, position: 'relative',
                            backgroundColor: config.navis.onlyVision ? 'var(--color-navis-active-border)' : 'var(--color-border)',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}>
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

                {/* Browser Extension Toggle */}
                <div style={{ marginBottom: 14 }}>
                    <Label>Browser Extension</Label>
                    <div
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', backgroundColor: 'var(--color-success-dim)',
                            border: '1px solid var(--color-success)',
                            borderRadius: 12, transition: 'all 0.2s',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ComputerDesktopIcon width={18} height={18} style={{ color: 'var(--color-success)' }} />
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                    Browser Extension Enabled
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2, maxWidth: 330 }}>
                                    Uses the installed Navis extension for fast logged-in Chrome/Firefox control
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 20, backgroundColor: 'var(--color-success-dim)', color: 'var(--color-success)', fontSize: 11, fontWeight: 700 }}>
                            <CheckIcon width={12} height={12} strokeWidth={3} />
                            Required
                        </div>
                    </div>
                    <div style={{ marginTop: 10, padding: '0 4px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button
                                type="button"
                                onClick={handlePrepareMainProfileExtension}
                                disabled={isPreparingMainProfileExtension}
                                style={{
                                    padding: '9px 12px',
                                    borderRadius: 10,
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: isPreparingMainProfileExtension ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: isPreparingMainProfileExtension ? 'wait' : 'pointer',
                                }}
                            >
                                {isPreparingMainProfileExtension ? 'Preparing install folder...' : 'Prepare install folder'}
                            </button>
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: extensionStatus?.connected ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: extensionStatus?.connected ? 'var(--color-success)' : 'var(--color-text-placeholder)', display: 'inline-block' }} />
                            {extensionStatus?.connected ? 'Navis extension connected' : 'Install the Navis extension to connect'}
                        </div>
                        {extensionMessage && (
                            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                                {extensionMessage}
                            </div>
                        )}
                    </div>
                </div>

                {/* Max Steps Slider */}
                <div>
                    <Label>Max Steps Per Task</Label>
                    <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
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
                            <span style={{ fontSize: 10, color: 'var(--color-text-placeholder)' }}>10 (fast)</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-placeholder)' }}>200 (thorough)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Synthesized Tools Panel ─────────────────────────────── */}
            <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #111827 0%, #1f2937 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-inverse)' }}>
                        <WrenchScrewdriverIcon width={18} height={18} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Synthesized Dynamic Tools</h3>
                        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>AI-generated tools running dynamically in the session</p>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {synthesizedTools.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--color-text-placeholder)', margin: 0, textAlign: 'center', padding: '16px 0' }}>
                            No synthesized tools registered yet. When the agent gets stuck, it will suggest creating a new custom tool.
                        </p>
                    ) : (
                        synthesizedTools.map(tool => (
                            <SynthesizedToolCard
                                key={tool.name}
                                tool={tool}
                                onDelete={handleDeleteSynthesized}
                            />
                        ))
                    )}
                </div>
            </div>

            <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <WrenchScrewdriverIcon width={14} height={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>About Tool Modes</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0, lineHeight: 1.6 }}>
                    <strong>Local</strong> mode uses a Playwright-controlled isolated browser. <strong>API</strong> mode calls an external service (Exa for search, Firecrawl for crawl) using your API key. <strong>Navis Browser</strong> uses the installed Navis extension for Chrome/Chromium or Firefox when profile mode is enabled. <strong>Navis Vision</strong> sends screenshots to a vision AI model only when visual grounding is needed. Changes take effect immediately.
                </p>
            </div>
        </div>
    );
}

export default ToolSettingsSection;
