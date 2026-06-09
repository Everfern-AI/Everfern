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
    useIsolatedBrowser: boolean;
    selectedBrowserId: string;
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
    headless: false,
    maxSteps: 200,
    useChromeProfile: false,
    useIsolatedBrowser: true,
    selectedBrowserId: 'chrome',
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

// ── BrowserDropdown ─────────────────────────────────────────────────────────────

function BrowserDropdown({ browsers, value, onChange }: { browsers: any[], value: string, onChange: (val: string) => void }) {
    const [open, setOpen] = useState(false);
    
    // Robust fuzzy match: handles exact, partial, legacy short IDs ('chrome', 'firefox') and prefix
    const findBrowser = (id: string) => {
        if (!id || id === 'isolated') return null;
        const lower = id.toLowerCase();
        return (
            // 1. Exact ID match
            browsers.find(b => b.id === id) ||
            // 2. Saved ID contains browser name keyword (e.g. 'chrome' is in 'google-chrome')
            browsers.find(b => b.id.includes(lower) || lower.includes(b.id)) ||
            // 3. 'chrome'/'chromium' → any chromium browser
            ((lower === 'chrome' || lower.includes('chrome') || lower.includes('chromium'))
                ? browsers.find(b => b.engine === 'chromium' || b.id.includes('chrome') || b.name?.toLowerCase().includes('chrome'))
                : null) ||
            // 4. 'firefox'/'mozilla' → any firefox browser
            ((lower === 'firefox' || lower.includes('firefox') || lower.includes('mozilla'))
                ? browsers.find(b => b.engine === 'firefox' || b.id.includes('firefox') || b.name?.toLowerCase().includes('firefox'))
                : null) ||
            // 5. Brave
            (lower.includes('brave') ? browsers.find(b => b.id.includes('brave') || b.name?.toLowerCase().includes('brave')) : null) ||
            // 6. Last resort: first available browser
            (browsers.length > 0 ? browsers[0] : null)
        );
    };

    const selectedBrowser = value === 'isolated' ? null : findBrowser(value);

    // Auto-correct stored ID if it's a legacy/stale value and we resolved a real browser
    const effectiveValue = selectedBrowser ? selectedBrowser.id : value;

    // Auto-correct stale/legacy saved ID (e.g. 'chrome' → 'google-chrome') when dropdown opens
    const handleOpen = () => {
        if (selectedBrowser && selectedBrowser.id !== value) {
            onChange(selectedBrowser.id);
        }
        setOpen(o => !o);
    };

    return (
        <div style={{ position: 'relative' }}>
            {/* Main button */}
            <div
                onClick={handleOpen}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', backgroundColor: '#ffffff',
                    border: 'none', borderRadius: 12, cursor: 'pointer',
                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), 0 2px 5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {effectiveValue === 'isolated' ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, color: '#2f8f5b' }}>
                            <GlobeAltIcon width={18} height={18} />
                        </div>
                    ) : selectedBrowser?.logo ? (
                        <img src={selectedBrowser.logo} alt={selectedBrowser.name} style={{ width: 24, height: 24, objectFit: 'contain' }} />
                    ) : (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#e8e6d9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <GlobeAltIcon width={14} height={14} style={{ color: '#8a8886' }} />
                        </div>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#111111' }}>
                        {effectiveValue === 'isolated'
                            ? 'Isolated Playwright Browser'
                            : selectedBrowser?.name || (browsers.length > 0 ? browsers[0].name : 'Select Browser')}
                    </span>
                </div>
                {/* Simple clean caret */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{
                    color: '#8a8886',
                    flexShrink: 0,
                    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease-in-out'
                }}>
                    <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </div>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8,
                            backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)',
                            zIndex: 50, border: '1px solid #e8e6d9', maxHeight: 250, overflowY: 'auto'
                        }}
                    >
                        <div
                            onClick={() => { onChange('isolated'); setOpen(false); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                                cursor: 'pointer', backgroundColor: effectiveValue === 'isolated' ? '#fafafa' : '#ffffff',
                                borderBottom: '1px solid #f4f4f4'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fafafa'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = effectiveValue === 'isolated' ? '#fafafa' : '#ffffff'}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, color: '#2f8f5b' }}>
                                <GlobeAltIcon width={18} height={18} />
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 500, color: '#111111', flex: 1 }}>Isolated Playwright Browser</span>
                            {effectiveValue === 'isolated' && <CheckIcon width={16} height={16} style={{ color: '#2f8f5b' }} />}
                        </div>
                        
                        {browsers.length > 0 && (
                            <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                System Browsers
                            </div>
                        )}
                        
                        {browsers.map(b => (
                            <div
                                key={b.id}
                                onClick={() => { onChange(b.id); setOpen(false); }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                                    cursor: 'pointer', backgroundColor: effectiveValue === b.id ? '#fafafa' : '#ffffff',
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fafafa'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = effectiveValue === b.id ? '#fafafa' : '#ffffff'}
                            >
                                {b.logo ? (
                                    <img src={b.logo} alt={b.name} style={{ width: 20, height: 20, objectFit: 'contain' }} />
                                ) : (
                                    <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#e8e6d9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <GlobeAltIcon width={12} height={12} style={{ color: '#8a8886' }} />
                                    </div>
                                )}
                                <span style={{ fontSize: 13, fontWeight: 500, color: '#111111', flex: 1 }}>{b.name}</span>
                                {effectiveValue === b.id && <CheckIcon width={16} height={16} style={{ color: '#2f8f5b' }} />}
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
            
            {/* Backdrop for closing */}
            {open && (
                <div 
                    onClick={() => setOpen(false)}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
                />
            )}
        </div>
    );
}

// ── ToolSettingsSection ───────────────────────────────────────────────────────

export function ToolSettingsSection() {
    const [config, setConfig] = useState<ToolSettingsConfig>(DEFAULT_TOOL_SETTINGS);
    const [browsers, setBrowsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [debugBrowserStatus, setDebugBrowserStatus] = useState<string>('');
    const [isOpeningDebugBrowser, setIsOpeningDebugBrowser] = useState(false);
    const [extensionStatus, setExtensionStatus] = useState<any>(null);
    const [extensionMessage, setExtensionMessage] = useState<string>('');
    const [isPreparingMainProfileExtension, setIsPreparingMainProfileExtension] = useState(false);

    // Load config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const stored = await (window as any).electronAPI?.toolSettings?.get?.();
                const availableBrowsers = await (window as any).electronAPI?.toolSettings?.getBrowsers?.();
                if (availableBrowsers) {
                    setBrowsers(availableBrowsers);
                }
                const navisExtensionStatus = await (window as any).electronAPI?.toolSettings?.getNavisExtensionStatus?.();
                if (navisExtensionStatus) {
                    setExtensionStatus(navisExtensionStatus);
                }
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
        setIsOpeningDebugBrowser(true);
        setDebugBrowserStatus('');
        try {
            const result = await (window as any).electronAPI?.toolSettings?.openDebugBrowser?.();
            setDebugBrowserStatus(result?.message || 'Navis CDP browser is ready.');
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to open debug browser:', e);
            setDebugBrowserStatus(e instanceof Error ? e.message : 'Failed to prepare Navis CDP browser.');
        } finally {
            setIsOpeningDebugBrowser(false);
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
            setExtensionMessage(result?.message || 'Navis companion extension preparation finished.');
        } catch (e) {
            console.error('[ToolSettingsSection] Failed to prepare Navis companion extension:', e);
            setExtensionMessage(e instanceof Error ? e.message : 'Failed to prepare Navis companion extension.');
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
                    <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#ffffff', border: '1px solid #e8e6d9', boxShadow: '0 2px 4px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>
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
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', backgroundColor: '#ffffff',
                        border: 'none', borderRadius: 12,
                        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), 0 2px 5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ color: '#6366f1' }}>
                                <EyeIcon width={18} height={18} />
                            </div>
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
                        {/* Custom Toggle Switch */}
                        <div
                            onClick={() => handleNavisChange({ ...config.navis, useVision: !config.navis.useVision })}
                            style={{
                                width: 44, height: 24, borderRadius: 12, position: 'relative',
                                backgroundColor: config.navis.useVision ? '#6366f1' : '#e8e6d9',
                                cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                            }}
                        >
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

                {/* Browser Selection */}
                <div style={{ marginBottom: 18 }}>
                    <Label>Browser</Label>

                    <BrowserDropdown 
                        browsers={browsers} 
                        value={config.navis.useIsolatedBrowser ? 'isolated' : config.navis.selectedBrowserId}
                        onChange={(val) => {
                            if (val === 'isolated') {
                                handleNavisChange({ ...config.navis, useIsolatedBrowser: true, useChromeProfile: false, automationMode: 'playwright' });
                            } else {
                                const b = browsers.find((b: any) => b.id === val);
                                handleNavisChange({ ...config.navis, useIsolatedBrowser: false, selectedBrowserId: val, useChromeProfile: b?.engine === 'chromium', automationMode: b?.engine === 'chromium' ? 'extension-first' : 'playwright' });
                            }
                        }}
                    />

                    {!config.navis.useIsolatedBrowser && (
                        <div style={{ marginTop: 8, padding: '0 4px' }}>
                            <div style={{ fontSize: 12, color: '#8a8886', lineHeight: 1.5 }}>
                                Use browser extension controls your real Chromium profile directly when connected. Playwright fallback stays isolated and avoids default-profile CDP.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                                {[
                                    { mode: 'extension-first' as const, title: 'Use browser extension', detail: 'Fast, logged-in, no copied profile' },
                                    { mode: 'playwright' as const, title: 'Playwright fallback', detail: 'Use isolated automation' },
                                ].map(item => {
                                    const selected = config.navis.automationMode === item.mode;
                                    return (
                                        <button
                                            key={item.mode}
                                            type="button"
                                            onClick={() => handleNavisChange({ ...config.navis, automationMode: item.mode })}
                                            style={{
                                                textAlign: 'left',
                                                padding: '10px 12px',
                                                borderRadius: 12,
                                                border: selected ? '1px solid #111111' : '1px solid #e8e6d9',
                                                backgroundColor: selected ? '#ffffff' : '#f9f9f8',
                                                color: '#111111',
                                                cursor: 'pointer',
                                                boxShadow: selected ? '0 2px 5px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' : 'none',
                                            }}
                                        >
                                            <div style={{ fontSize: 12.5, fontWeight: 650 }}>{item.title}</div>
                                            <div style={{ fontSize: 11, color: '#8a8886', marginTop: 2 }}>{item.detail}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                <button
                                    type="button"
                                    onClick={handlePrepareMainProfileExtension}
                                    disabled={isPreparingMainProfileExtension}
                                    style={{
                                        padding: '9px 12px',
                                        borderRadius: 10,
                                        border: '1px solid #ddd9cb',
                                        backgroundColor: isPreparingMainProfileExtension ? '#f4f2ea' : '#ffffff',
                                        color: '#111111',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: isPreparingMainProfileExtension ? 'wait' : 'pointer',
                                        boxShadow: '0 2px 5px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
                                    }}
                                >
                                    {isPreparingMainProfileExtension ? 'Preparing extension...' : 'Prepare extension'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleOpenBrowser}
                                    disabled={isOpeningDebugBrowser}
                                    style={{
                                        padding: '9px 12px',
                                        borderRadius: 10,
                                        border: '1px solid #ddd9cb',
                                        backgroundColor: isOpeningDebugBrowser ? '#f4f2ea' : '#ffffff',
                                        color: '#111111',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: isOpeningDebugBrowser ? 'wait' : 'pointer',
                                        boxShadow: '0 2px 5px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
                                    }}
                                >
                                    {isOpeningDebugBrowser ? 'Preparing CDP profile...' : 'Prepare CDP profile'}
                                </button>
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: extensionStatus?.connected ? '#2f8f5b' : '#8a8886' }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: extensionStatus?.connected ? '#2f8f5b' : '#c9c4b8', display: 'inline-block' }} />
                                {extensionStatus?.connected ? 'Browser extension connected' : 'Browser extension not connected'}
                            </div>
                            {(extensionMessage || debugBrowserStatus) && (
                                <div style={{ marginTop: 8, fontSize: 11, color: '#6f6b63', lineHeight: 1.45 }}>
                                    {extensionMessage || debugBrowserStatus}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Max Steps Slider */}
                <div>
                    <Label>Max Steps Per Task</Label>
                    <div style={{ padding: '12px 16px', backgroundColor: '#ffffff', border: 'none', borderRadius: 12, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), 0 2px 5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, color: '#111111', fontWeight: 500 }}>Steps limit</span>
                            <span style={{ fontSize: 13, color: '#667eea', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{config.navis.maxSteps}</span>
                        </div>
                        <input
                            type="range"
                            min={10}
                            max={200}
                            step={10}
                            value={config.navis.maxSteps}
                            onChange={e => handleNavisChange({ ...config.navis, maxSteps: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: '#667eea', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <span style={{ fontSize: 11, color: '#8a8886' }}>10 (fast)</span>
                            <span style={{ fontSize: 11, color: '#8a8886' }}>200 (thorough)</span>
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
                    <strong>Local</strong> mode uses local browser automation. <strong>API</strong> mode calls an external service (Exa for search, Firecrawl for crawl) using your API key. <strong>Navis Browser</strong> prefers the companion extension for fast logged-in Chromium control, then falls back to isolated Playwright when the extension is unavailable. <strong>Navis Vision</strong> is an on-demand fallback for pages where DOM refs are not enough. Changes take effect immediately — no restart required.
                </p>
            </div>
        </div>
    );
}

export default ToolSettingsSection;
