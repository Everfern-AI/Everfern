'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    XMarkIcon, 
    SparklesIcon, 
    BoltIcon, 
    HeartIcon, 
    WrenchScrewdriverIcon, 
    FaceSmileIcon, 
    PencilSquareIcon,
    CheckIcon
} from '@heroicons/react/24/outline';

interface CustomizeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TonePreset = 'direct' | 'warm' | 'senior' | 'casual' | 'creative' | 'custom';

interface ToneOption {
    id: TonePreset;
    title: string;
    description: string;
    icon: React.ElementType;
}

const TONE_OPTIONS: ToneOption[] = [
    {
        id: 'direct',
        title: 'Direct & Concise',
        description: 'Straight to the point, minimal fluff, clear and rapid.',
        icon: BoltIcon,
    },
    {
        id: 'warm',
        title: 'Warm & Friendly',
        description: 'Empathetic, collaborative, encouraging, and approachable.',
        icon: HeartIcon,
    },
    {
        id: 'senior',
        title: 'Senior Engineer',
        description: 'Pragmatic, architectural, rigorous, and production-minded.',
        icon: WrenchScrewdriverIcon,
    },
    {
        id: 'casual',
        title: 'Casual & Chill',
        description: 'Relaxed, witty, and natural like a close tech teammate.',
        icon: FaceSmileIcon,
    },
    {
        id: 'creative',
        title: 'Creative & Quirky',
        description: 'Inventive, expressive, vibrant, and outside-the-box.',
        icon: SparklesIcon,
    },
    {
        id: 'custom',
        title: 'Custom Tone',
        description: 'Define your own personality and communication style.',
        icon: PencilSquareIcon,
    },
];

export default function CustomizeModal({ isOpen, onClose }: CustomizeModalProps) {
    const [selectedTone, setSelectedTone] = useState<TonePreset>('direct');
    const [customTone, setCustomTone] = useState('');
    const [customInstructions, setCustomInstructions] = useState('');
    const [userContext, setUserContext] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setIsSaved(false);
        const loadConfig = async () => {
            try {
                const api = (window as any).electronAPI;
                if (api?.loadConfig) {
                    const res = await api.loadConfig();
                    if (res?.success && res.config) {
                        const cfg = res.config;
                        if (cfg.tone) setSelectedTone(cfg.tone);
                        if (cfg.customTone) setCustomTone(cfg.customTone);
                        if (cfg.customInstructions) setCustomInstructions(cfg.customInstructions);
                        if (cfg.userContext) setUserContext(cfg.userContext);
                    }
                }
            } catch (err) {
                console.error('Failed to load customization config:', err);
            }
        };
        loadConfig();
    }, [isOpen]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const api = (window as any).electronAPI;
            if (api?.loadConfig && api?.saveConfig) {
                const res = await api.loadConfig();
                const currentConfig = (res?.success && res.config) ? res.config : {};
                const updatedConfig = {
                    ...currentConfig,
                    tone: selectedTone,
                    customTone: selectedTone === 'custom' ? customTone : undefined,
                    customInstructions: customInstructions.trim() || undefined,
                    userContext: userContext.trim() || undefined,
                };
                await api.saveConfig(updatedConfig);
                setIsSaved(true);
                setTimeout(() => {
                    setIsSaved(false);
                    onClose();
                }, 700);
            } else {
                onClose();
            }
        } catch (err) {
            console.error('Failed to save customization config:', err);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 400,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0, 0, 0, 0.45)',
                        backdropFilter: 'blur(6px)',
                        padding: 16,
                    }}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                        className="glossy"
                        style={{
                            width: '100%',
                            maxWidth: 620,
                            backgroundColor: 'var(--color-bg-surface, #ffffff)',
                            borderRadius: 22,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            maxHeight: '88vh',
                        }}
                    >
                        {/* Header */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '20px 26px',
                            borderBottom: '1px solid var(--color-border-subtle, #f0f0f0)',
                            backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 12,
                                    backgroundColor: 'var(--color-bg-active, #f0f0f0)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--color-text-primary, #111111)',
                                }}>
                                    <SparklesIcon width={20} height={20} />
                                </div>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--color-text-primary, #111111)' }}>
                                        Customize Fern
                                    </h2>
                                    <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--color-text-tertiary, #888888)' }}>
                                        Tailor Fern's tone, instructions, and persona across chats
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 8,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--color-text-tertiary, #888888)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, #f0f0f0)'; e.currentTarget.style.color = 'var(--color-text-primary, #111111)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-tertiary, #888888)'; }}
                            >
                                <XMarkIcon width={18} height={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div style={{ padding: '24px 26px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 22 }}>
                            {/* Tone Presets */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary, #111111)', marginBottom: 10 }}>
                                    Personality & Tone
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                                    {TONE_OPTIONS.map(opt => {
                                        const isSelected = selectedTone === opt.id;
                                        const IconComp = opt.icon;
                                        return (
                                            <div
                                                key={opt.id}
                                                onClick={() => setSelectedTone(opt.id)}
                                                style={{
                                                    padding: '12px 14px',
                                                    borderRadius: 14,
                                                    border: isSelected
                                                        ? '1.5px solid var(--color-accent, #3b82f6)'
                                                        : '1px solid var(--color-border, #e5e5e5)',
                                                    backgroundColor: isSelected
                                                        ? 'var(--color-accent-subtle, rgba(59, 130, 246, 0.06))'
                                                        : 'var(--color-bg-surface, #ffffff)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 4,
                                                }}
                                                onMouseEnter={e => {
                                                    if (!isSelected) e.currentTarget.style.borderColor = 'var(--color-border-strong, #cccccc)';
                                                }}
                                                onMouseLeave={e => {
                                                    if (!isSelected) e.currentTarget.style.borderColor = 'var(--color-border, #e5e5e5)';
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <IconComp width={16} height={16} color={isSelected ? 'var(--color-accent, #3b82f6)' : 'var(--color-text-secondary, #555555)'} />
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? 'var(--color-accent, #3b82f6)' : 'var(--color-text-primary, #111111)' }}>
                                                        {opt.title}
                                                    </span>
                                                </div>
                                                <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary, #888888)', lineHeight: 1.35 }}>
                                                    {opt.description}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {selectedTone === 'custom' && (
                                    <div style={{ marginTop: 10 }}>
                                        <input
                                            type="text"
                                            value={customTone}
                                            onChange={e => setCustomTone(e.target.value)}
                                            placeholder="e.g. Sarcastic yet helpful senior hacker"
                                            style={{
                                                width: '100%',
                                                padding: '10px 14px',
                                                borderRadius: 10,
                                                border: '1px solid var(--color-border, #e5e5e5)',
                                                backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                                                fontSize: 13,
                                                color: 'var(--color-text-primary, #111111)',
                                                outline: 'none',
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Response Instructions */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary, #111111)', marginBottom: 4 }}>
                                    How should Fern respond?
                                </label>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary, #888888)', marginBottom: 8 }}>
                                    Custom instructions appended to every AI query (e.g. formatting, coding styles, languages).
                                </span>
                                <textarea
                                    value={customInstructions}
                                    onChange={e => setCustomInstructions(e.target.value)}
                                    placeholder="e.g. Always write clean TypeScript code with types. Prefer functional patterns over classes. Keep explanations concise."
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: 12,
                                        border: '1px solid var(--color-border, #e5e5e5)',
                                        backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                                        fontSize: 13,
                                        color: 'var(--color-text-primary, #111111)',
                                        outline: 'none',
                                        resize: 'vertical',
                                        lineHeight: 1.5,
                                    }}
                                />
                            </div>

                            {/* About You */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary, #111111)', marginBottom: 4 }}>
                                    What should Fern know about you?
                                </label>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary, #888888)', marginBottom: 8 }}>
                                    Your role, workflow, preferences, or tech stack context.
                                </span>
                                <textarea
                                    value={userContext}
                                    onChange={e => setUserContext(e.target.value)}
                                    placeholder="e.g. I am a full-stack engineer developing Next.js, React, and Electron apps. I use Windows with PowerShell."
                                    rows={2}
                                    style={{
                                        width: '100%',
                                        padding: '10px 14px',
                                        borderRadius: 12,
                                        border: '1px solid var(--color-border, #e5e5e5)',
                                        backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                                        fontSize: 13,
                                        color: 'var(--color-text-primary, #111111)',
                                        outline: 'none',
                                        resize: 'vertical',
                                        lineHeight: 1.5,
                                    }}
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{
                            padding: '16px 26px',
                            borderTop: '1px solid var(--color-border-subtle, #f0f0f0)',
                            backgroundColor: 'var(--color-bg-subtle, #fafafa)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                        }}>
                            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #888888)' }}>
                                Applied across Claude, OpenAI, and all models
                            </span>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    onClick={onClose}
                                    style={{
                                        padding: '8px 16px',
                                        backgroundColor: 'transparent',
                                        color: 'var(--color-text-secondary, #555555)',
                                        border: '1px solid var(--color-border, #e5e5e5)',
                                        borderRadius: 10,
                                        fontWeight: 500,
                                        fontSize: 13,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    style={{
                                        padding: '8px 20px',
                                        backgroundColor: isSaved ? '#10b981' : 'var(--color-text-primary, #111111)',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: 10,
                                        fontWeight: 600,
                                        fontSize: 13,
                                        cursor: isSaving ? 'not-allowed' : 'pointer',
                                        transition: 'background-color 0.2s',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}
                                >
                                    {isSaved ? (
                                        <>
                                            <CheckIcon width={15} height={15} />
                                            Saved
                                        </>
                                    ) : (
                                        isSaving ? 'Saving...' : 'Save Preferences'
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
