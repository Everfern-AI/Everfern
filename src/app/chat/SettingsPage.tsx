'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XMarkIcon,
    CheckIcon,
    GlobeAltIcon,
    KeyIcon,
    CpuChipIcon,
    UserCircleIcon,
    Cog6ToothIcon,
    ShieldCheckIcon,
    TrashIcon,
    ArrowDownOnSquareIcon,
    ChevronRightIcon,
    ServerIcon,
    WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { ToolSettingsSection } from './components/ToolSettingsSection';
import Image from 'next/image';
import { Loader } from '@/components/ui/animated-loading-svg-text-shimmer';

// ── No inline logos — using Image imports instead ─────────────────────────────────────────

const MORE_PROVIDERS = [
    { id: 'openrouter', name: 'OpenRouter', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} /> },
    { id: 'minimax', name: 'MiniMax', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax" width={size} height={size} /> },
    { id: 'huggingface', name: 'Hugging Face', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/hf-logo.svg" alt="Hugging Face" width={size} height={size} /> }
];

const navSections = [
    { id: 'general', label: 'General', icon: Cog6ToothIcon },
    { id: 'profile', label: 'Profile', icon: UserCircleIcon },
    { id: 'models', label: 'Models & Providers', icon: CpuChipIcon },
    { id: 'voice', label: 'Voice Mode', icon: () => <span style={{ fontSize: 14, fontWeight: 700 }}>🎤</span> },
    { id: 'vision', label: 'Vision Grounding', icon: GlobeAltIcon },
    { id: 'skills', label: 'Custom Skills', icon: () => <span style={{ fontSize: 14, fontWeight: 700 }}>🧩</span> },
    { id: 'tools', label: 'Registered Tools', icon: ServerIcon },
    { id: 'tool-settings', label: 'Tool Settings', icon: WrenchScrewdriverIcon },
    { id: 'privacy', label: 'Privacy & Data', icon: ShieldCheckIcon },
    { id: 'help', label: 'Help & Architecture', icon: () => <span style={{ fontSize: 14, fontWeight: 700 }}>❓</span> },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, color: '#201e24', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
        {children}
    </h2>
);

const SectionSubtitle = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 14, color: '#8a8886', margin: '0 0 28px', lineHeight: 1.5 }}>{children}</p>
);

const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ backgroundColor: '#ffffff', border: '1px solid #e8e6d9', borderRadius: 16, padding: 24, marginBottom: 16, ...style }}>
        {children}
    </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: '#8a8886', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
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

const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedValue, setSelectedValue] = React.useState(props.value?.toString() || props.defaultValue?.toString() || '');
    const selectRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (props.value !== undefined) {
            setSelectedValue(props.value.toString());
        }
    }, [props.value]);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (value: string) => {
        setSelectedValue(value);
        setIsOpen(false);
        if (props.onChange) {
            const event = {
                target: { value, name: props.name },
            } as React.ChangeEvent<HTMLSelectElement>;
            props.onChange(event);
        }
    };

    const options = React.Children.toArray(props.children)
        .filter((child): child is React.ReactElement => React.isValidElement(child))
        .map((child: any) => ({
            value: child.props?.value?.toString() || '',
            label: child.props?.children?.toString() || '',
        }));

    const selectedLabel = options.find(opt => opt.value === selectedValue)?.label || options[0]?.label || '';

    return (
        <div ref={selectRef} style={{ position: 'relative', width: '100%' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                style={{
                    width: '100%', padding: '12px 40px 12px 16px', backgroundColor: isFocused || isOpen ? '#ffffff' : '#fcfcfb',
                    border: `1px solid ${isFocused || isOpen ? '#111111' : '#e8e6d9'}`, borderRadius: 12, color: '#201e24',
                    fontSize: 14, outline: 'none', cursor: 'pointer', appearance: 'none',
                    fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
                    transition: 'all 0.2s',
                    boxShadow: isFocused || isOpen ? '0 0 0 3px rgba(17, 17, 17, 0.08)' : 'none',
                    display: 'flex', alignItems: 'center', userSelect: 'none',
                }}
                tabIndex={0}
            >
                {selectedLabel}
            </div>

            <ChevronRightIcon
                width={14}
                height={14}
                style={{
                    position: 'absolute', right: 14, top: '50%', transform: `translateY(-50%) rotate(${isOpen ? 90 : 90}deg)`,
                    color: isFocused || isOpen ? '#111111' : '#8a8886',
                    pointerEvents: 'none',
                    transition: 'all 0.2s'
                }}
            />

            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                        backgroundColor: '#ffffff', border: '1px solid #e8e6d9', borderRadius: 12,
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', zIndex: 1000,
                        maxHeight: 240, overflowY: 'auto',
                    }}
                >
                    {options.map((option, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleSelect(option.value)}
                            style={{
                                padding: '10px 16px', fontSize: 14, color: selectedValue === option.value ? '#111111' : '#4a4846',
                                backgroundColor: selectedValue === option.value ? '#f4f4f4' : '#ffffff',
                                cursor: 'pointer', transition: 'all 0.1s',
                                borderBottom: idx < options.length - 1 ? '1px solid #f0f0f0' : 'none',
                                fontWeight: selectedValue === option.value ? 600 : 400,
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9f9f9'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = selectedValue === option.value ? '#f4f4f4' : '#ffffff'}
                        >
                            {option.label}
                        </div>
                    ))}
                </motion.div>
            )}

            {/* Hidden native select for form submission */}
            {(() => {
                const { defaultValue, value, ...rest } = props;
                return (
                    <select
                        {...rest}
                        value={selectedValue}
                        onChange={e => handleSelect(e.target.value)}
                        style={{ display: 'none' }}
                    >
                        {props.children}
                    </select>
                );
            })()}
        </div>
    );
};

const RegisteredToolsList = () => {
    const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadTools = async () => {
            try {
                const res = await (window as any).electronAPI?.acp?.listTools?.();
                if (res?.success) {
                    setTools(res.tools || []);
                }
            } catch (e) {
                console.error('Failed to load tools:', e);
            }
            setIsLoading(false);
        };
        loadTools();
    }, []);

    if (isLoading) return <div style={{ textAlign: 'center', padding: 40, color: '#8a8886' }}>Loading tools...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tools.length === 0 ? (
                <Card>
                    <p style={{ textAlign: 'center', fontSize: 14, color: '#8a8886', margin: 0 }}>No tools registered</p>
                </Card>
            ) : (
                tools.map(tool => (
                    <Card key={tool.name} style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ padding: '8px', backgroundColor: '#f4f4f4', borderRadius: 10, color: '#111111' }}>
                                <ServerIcon width={18} height={18} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h4 style={{ fontSize: 14, fontWeight: 600, color: '#111111', margin: '0 0 4px', fontFamily: 'monospace' }}>{tool.name}</h4>
                                <p style={{ fontSize: 13, color: '#8a8886', margin: 0, lineHeight: 1.4 }}>{tool.description}</p>
                            </div>
                        </div>
                    </Card>
                ))
            )}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────

interface SettingsPageProps {
    onClose: () => void;
    config: any;
    username: string;

    settingsEngine: 'online' | 'local' | 'everfern' | null;
    setSettingsEngine: React.Dispatch<React.SetStateAction<'online' | 'local' | 'everfern' | null>>;
    settingsProvider: string | null;
    setSettingsProvider: (v: string | null) => void;
    settingsApiKey: string;
    setSettingsApiKey: (v: string) => void;
    settingsCustomModel: string;
    setSettingsCustomModel: (v: string) => void;
    settingsShowuiUrl: string;
    setSettingsShowuiUrl: (v: string) => void;
    settingsVlmMode: 'local' | 'cloud';
    setSettingsVlmMode: React.Dispatch<React.SetStateAction<'local' | 'cloud'>>;
    settingsVlmCloudProvider: string;
    setSettingsVlmCloudProvider: (v: string) => void;
    settingsVlmCloudModel: string;
    setSettingsVlmCloudModel: (v: string) => void;
    settingsVlmCloudUrl: string;
    setSettingsVlmCloudUrl: (v: string) => void;
    settingsVlmCloudKey: string;
    setSettingsVlmCloudKey: (v: string) => void;
    modelValidationStatus: 'none' | 'success' | 'error';
    setModelValidationStatus: (v: 'none' | 'success' | 'error') => void;
    isValidatingModel: boolean;
    setIsValidatingModel: (v: boolean) => void;
    ollamaInstalled: boolean | null;
    modelInstalled: boolean | null;

    // Voice Mode
    voiceProvider: 'deepgram' | 'elevenlabs' | null;
    setVoiceProvider: (v: 'deepgram' | 'elevenlabs' | null) => void;
    voiceDeepgramKey: string;
    setVoiceDeepgramKey: (v: string) => void;
    voiceElevenlabsKey: string;
    setVoiceElevenlabsKey: (v: string) => void;

    handleSaveSettings: () => void;
    onOpenVlmOnboarding: () => void;
}

const settingsPrimaryProviders = [
    { id: 'openai', name: 'OpenAI', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openai.svg" alt="OpenAI" width={size} height={size} /> },
    { id: 'anthropic', name: 'Anthropic', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic" width={size} height={size} /> },
    { id: 'gemini', name: 'Google Gemini', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/gemini.svg" alt="Google" width={size} height={size} /> },
    { id: 'deepseek', name: 'DeepSeek', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/deepseek.svg" alt="DeepSeek" width={size} height={size} /> },
    { id: 'nvidia', name: 'NVIDIA NIM', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="NVIDIA" width={size} height={size} /> },
    { id: 'openrouter', name: 'OpenRouter', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} /> },
    { id: 'minimax', name: 'MiniMax', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/minimax.svg" alt="MiniMax" width={size} height={size} /> },
    { id: 'ollama-cloud', name: 'Ollama Cloud', Logo: ({ size = 18 }: any) => <svg fill="currentColor" fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z" /></svg> },
    { id: 'huggingface', name: 'Hugging Face', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/hf-logo.svg" alt="Hugging Face" width={size} height={size} /> },
];

const visionProviders = [
    { id: 'everfern', name: 'EverFern Cloud', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="EverFern" width={size * 1.6} height={size * 1.6} /> },
    { id: 'openrouter', name: 'OpenRouter', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openrouter.svg" alt="OpenRouter" width={size} height={size} /> },
    { id: 'ollama', name: 'Ollama Compatible', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={size} height={size} /> },
    { id: 'openai', name: 'OpenAI', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/openai.svg" alt="OpenAI" width={size} height={size} /> },
    { id: 'anthropic', name: 'Anthropic', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/claude.svg" alt="Anthropic" width={size} height={size} /> },
    { id: 'nvidia', name: 'NVIDIA NIM', Logo: ({ size = 18 }: any) => <Image unoptimized src="/images/ai-providers/nvidia.svg" alt="NVIDIA" width={size} height={size} /> },
];

export default function SettingsPage({
    onClose,
    config,
    username,
    settingsEngine, setSettingsEngine,
    settingsProvider, setSettingsProvider,
    settingsApiKey, setSettingsApiKey,
    settingsCustomModel, setSettingsCustomModel,
    settingsShowuiUrl, setSettingsShowuiUrl,
    settingsVlmMode, setSettingsVlmMode,
    settingsVlmCloudProvider, setSettingsVlmCloudProvider,
    settingsVlmCloudModel, setSettingsVlmCloudModel,
    settingsVlmCloudUrl, setSettingsVlmCloudUrl,
    settingsVlmCloudKey, setSettingsVlmCloudKey,
    modelValidationStatus, setModelValidationStatus,
    isValidatingModel, setIsValidatingModel,
    ollamaInstalled, modelInstalled,
    voiceProvider, setVoiceProvider,
    voiceDeepgramKey, setVoiceDeepgramKey,
    voiceElevenlabsKey, setVoiceElevenlabsKey,
    handleSaveSettings,
    onOpenVlmOnboarding,
}: SettingsPageProps) {
    const [activeSection, setActiveSection] = useState('general');
    const [toastState, setToastState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [profileName, setProfileName] = useState(username || 'User');
    const [displayName, setDisplayName] = useState(username || 'User');
    const [preferences, setPreferences] = useState('');
    const [isCloudUser, setIsCloudUser] = useState(false);
    const [cloudEmail, setCloudEmail] = useState('');
    const [appVersion, setAppVersion] = useState('0.0.0');
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion?: string; url?: string } | null>(null);
    const router = useRouter();

    useEffect(() => {
        const fetchVersion = async () => {
            const version = await (window as any).electronAPI?.system?.getVersion?.();
            if (version) setAppVersion(version);
        };
        fetchVersion();
    }, []);

    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        try {
            const result = await (window as any).electronAPI?.system?.checkForUpdates?.();
            setUpdateInfo(result);
        } catch (err) {
            console.error('Failed to check for updates:', err);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    useEffect(() => {
        try {
            const sessionStr = localStorage.getItem('everfern_cloud_session');
            if (sessionStr) {
                const session = JSON.parse(sessionStr);
                setIsCloudUser(true);
                setCloudEmail(session.user?.email || '');
            }
        } catch (e) {}
    }, []);

    const handleSignOut = () => {
        localStorage.removeItem('everfern_cloud_session');
        localStorage.removeItem('everfern_auth_token');
        router.push('/auth');
    };

    useEffect(() => {
        const fetchUsername = async () => {
            try {
                let name = "User";
                if ((window as any).electronAPI?.loadConfig) {
                    const res = await (window as any).electronAPI.loadConfig();
                    if (res.success && res.config?.userName) {
                        name = res.config.userName;
                    } else if ((window as any).electronAPI?.system?.getUsername) {
                        name = await (window as any).electronAPI.system.getUsername();
                    }
                }
                const formattedName = name.charAt(0).toUpperCase() + name.slice(1);
                setProfileName(formattedName);
                setDisplayName(formattedName);
            } catch { }
        };
        fetchUsername();
    }, []);

    // ── General ───────────────────────────────────────────────────────────────
    const GeneralSection = () => (
        <div>
            <SectionTitle>General</SectionTitle>
            <SectionSubtitle>Manage how EverFern behaves globally.</SectionSubtitle>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 16px' }}>Interface</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <Label>App Theme</Label>
                        <Select defaultValue="light">
                            <option value="light">Light (Beach)</option>
                            <option value="system">System Default</option>
                        </Select>
                    </div>
                    <div>
                        <Label>Language</Label>
                        <Select defaultValue="en">
                            <option value="en">English</option>
                        </Select>
                    </div>
                </div>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 16px' }}>Defaults</h3>
                <div>
                    <Label>Default Home View</Label>
                    <Select defaultValue="chat">
                        <option value="chat">Chat</option>
                        <option value="projects">Projects</option>
                    </Select>
                </div>
            </Card>
        </div>
    );

    // ── Profile ───────────────────────────────────────────────────────────────
    const ProfileSection = () => (
        <div>
            <SectionTitle>Profile</SectionTitle>
            <SectionSubtitle>Your personal information and preferences.</SectionSubtitle>

            <Card>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div>
                        <Label>Full name</Label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>{profileName.charAt(0).toUpperCase()}</span>
                            </div>
                            <Input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your full name" />
                        </div>
                    </div>
                    <div>
                        <Label>What should EverFern call you?</Label>
                        <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Nickname" />
                    </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <Label>What best describes your work?</Label>
                    <Select defaultValue="">
                        <option value="" disabled>Select your work function</option>
                        <option value="developer">Software Developer</option>
                        <option value="designer">Designer</option>
                        <option value="researcher">Researcher</option>
                        <option value="writer">Writer</option>
                        <option value="student">Student</option>
                        <option value="other">Other</option>
                    </Select>
                </div>

                <div>
                    <Label>Personal preferences for responses</Label>
                    <p style={{ fontSize: 12, color: '#8a8886', marginBottom: 8 }}>These will apply to all conversations.</p>
                    <textarea
                        value={preferences}
                        onChange={e => setPreferences(e.target.value)}
                        placeholder="e.g. keep explanations brief and to the point"
                        rows={4}
                        style={{ width: '100%', padding: '12px 16px', backgroundColor: '#f4f4f4', border: '1px solid #e8e6d9', borderRadius: 12, color: '#111111', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'var(--font-sans)', boxSizing: 'border-box', lineHeight: 1.6 }}
                        onFocus={e => e.target.style.borderColor = '#111111'}
                        onBlur={e => e.target.style.borderColor = '#e8e6d9'}
                    />
                </div>

                {isCloudUser && (
                    <div style={{ marginTop: 24, padding: 20, backgroundColor: '#fcfcfb', border: '1px solid #e8e6d9', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111111', marginBottom: 4 }}>EverFern Cloud Session</h3>
                                <p style={{ fontSize: 12, color: '#8a8886', margin: 0 }}>Logged in as {cloudEmail}</p>
                            </div>
                            <button
                                onClick={handleSignOut}
                                style={{ padding: '8px 16px', backgroundColor: '#ffffff', color: '#dc2626', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.04)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );

    // ── Models & Providers ────────────────────────────────────────────────────
    const ModelsSection = () => (
        <div>
            <SectionTitle>Models & Providers</SectionTitle>
            <SectionSubtitle>Configure default AI engine, provider, and API credentials.</SectionSubtitle>

            {/* Engine Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { id: 'local', label: 'Local Engine', desc: 'On-device via Ollama or LMStudio.', icon: <Image unoptimized src="/images/ai-providers/ollama.svg" alt="Ollama" width={24} height={24} style={{ filter: settingsEngine !== 'local' ? 'grayscale(1) opacity(0.6)' : 'none', transition: 'all 0.3s' }} /> },
                    { id: 'online', label: 'Web API', desc: 'OpenAI, Anthropic, or NVIDIA NIM.', icon: <GlobeAltIcon width={22} height={22} style={{ color: '#8a8886' }} /> },
                    { id: 'everfern', label: 'EverFern Cloud', desc: 'Uses front tier models', icon: <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={24} height={24} style={{ filter: settingsEngine !== 'everfern' ? 'grayscale(1) opacity(0.6)' : 'none', transition: 'all 0.3s' }} /> },
                ].map(({ id, label, desc, icon }) => {
                    const sel = settingsEngine === id;
                    return (
                        <div
                            key={id}
                            onClick={() => {
                                setSettingsEngine(id as 'online' | 'local' | 'everfern');
                                if (id !== 'online') { setSettingsProvider(null); setSettingsApiKey(''); }
                                if (id === 'everfern') {
                                    setSettingsProvider('everfern');
                                    // Use local storage JWT if available
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
                                backgroundColor: sel ? '#f4f4f4' : '#ffffff',
                                border: `1.5px solid ${sel ? '#111111' : '#e8e6d9'}`,
                                transition: 'all 0.2s',
                            }}
                        >
                            {sel && <div style={{ position: 'absolute', top: 14, right: 14, color: '#111111' }}><CheckIcon width={16} height={16} strokeWidth={2.5} /></div>}
                            <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#f4f4f4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, border: '1px solid #e8e6d9' }}>
                                {icon}
                            </div>
                            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111111', marginBottom: 4 }}>{label}</h3>
                            <p style={{ fontSize: 12, color: '#8a8886', lineHeight: 1.5, margin: 0 }}>{desc}</p>
                        </div>
                    );
                })}
            </div>

            {/* Local URL */}
            <AnimatePresence initial={false}>
                {settingsEngine === 'local' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                        <Card>
                            <Label>Local Server URL (Optional)</Label>
                            <div style={{ position: 'relative' }}>
                                <GlobeAltIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                <Input type="text" placeholder="http://localhost:11434" value={settingsApiKey} onChange={e => setSettingsApiKey(e.target.value)} style={{ paddingLeft: 40 }} />
                            </div>
                            <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 8 }}>Leave blank to use the default Ollama address. Stored locally — never sent to servers.</p>
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
                                            onClick={(e: React.MouseEvent<HTMLDivElement>) => { e.stopPropagation(); setSettingsProvider(id); }}
                                            style={{
                                                padding: '14px 12px',
                                                borderRadius: 12,
                                                border: `1.5px solid ${isSel ? '#111111' : '#e8e6d9'}`,
                                                backgroundColor: isSel ? '#f4f4f4' : '#ffffff',
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
                                            <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: '#111111', textAlign: 'center' }}>{name}</span>
                                            {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: '#111111' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                            <AnimatePresence initial={false}>
                                {settingsProvider && (
                                    <motion.div key={`api-key-${settingsProvider}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }} style={{ pointerEvents: 'auto' }}>
                                        <Label>API Key</Label>
                                        <div style={{ position: 'relative', marginBottom: 8 }}>
                                            <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886', pointerEvents: 'none' }} />
                                            <Input type="password" placeholder="sk-proj-..." value={settingsApiKey} onChange={e => setSettingsApiKey(e.target.value)} style={{ paddingLeft: 40 }} />
                                        </div>
                                        <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 4 }}>Stored locally in ~/.everfern/store — never leaves your device.</p>
                                        {(settingsProvider === 'nvidia' || settingsProvider === 'openrouter' || settingsProvider === 'ollama-cloud') && (
                                            <div style={{ marginTop: 16 }}>
                                                <Label>Custom Model ID</Label>
                                                <div style={{ display: 'flex', gap: 10 }}>
                                                    <div style={{ position: 'relative', flex: 1 }}>
                                                        <CpuChipIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                                        <Input
                                                            type="text"
                                                            placeholder={settingsProvider === 'ollama-cloud' ? "e.g. llama3.3, qwen2.5:latest, mistral" : settingsProvider === 'openrouter' ? "e.g. meta-llama/llama-3.1-8b-instruct" : "e.g. moonshotai/kimi-k2.5"}
                                                            value={settingsCustomModel}
                                                            onChange={e => { setSettingsCustomModel(e.target.value); setModelValidationStatus('none'); }}
                                                            style={{ paddingLeft: 40 }}
                                                        />
                                                    </div>
                                                    {settingsProvider === 'nvidia' && (
                                                        <button
                                                            onClick={async () => {
                                                                if (!settingsCustomModel.trim() || !settingsApiKey.trim()) return;
                                                                setIsValidatingModel(true); setModelValidationStatus('none');
                                                                try {
                                                                    const res = await (window as any).electronAPI.acp.validateNvidiaModel(settingsCustomModel, settingsApiKey);
                                                                    setModelValidationStatus(res.valid ? 'success' : 'error');
                                                                } catch { setModelValidationStatus('error'); }
                                                                finally { setIsValidatingModel(false); }
                                                            }}
                                                            disabled={isValidatingModel || !settingsCustomModel.trim() || !settingsApiKey.trim()}
                                                            style={{ padding: '0 20px', backgroundColor: '#111111', color: '#ffffff', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: (isValidatingModel || !settingsCustomModel.trim() || !settingsApiKey.trim()) ? 0.4 : 1 }}
                                                        >
                                                            {isValidatingModel ? 'Checking…' : 'Validate'}
                                                        </button>
                                                    )}
                                                </div>
                                                <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 6 }}>
                                                    {settingsProvider === 'ollama-cloud'
                                                        ? 'Enter any model available on Ollama Cloud. Visit cloud.ollama.ai to browse models.'
                                                        : settingsProvider === 'openrouter'
                                                        ? 'Enter the full model ID from OpenRouter.'
                                                        : 'Enter the full model ID (e.g., provider/model-name).'}
                                                </p>
                                                {modelValidationStatus === 'success' && <p style={{ fontSize: 12, color: '#16a34a', marginTop: 6 }}>✓ Model verified with vision capabilities.</p>}
                                                {modelValidationStatus === 'error' && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>✗ Model not found or missing vision support.</p>}
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

    // ── Voice Mode ────────────────────────────────────────────────────────────
    const VoiceSection = () => (
        <div>
            <SectionTitle>Voice Mode</SectionTitle>
            <SectionSubtitle>Configure voice input and output for Jarvis-style interaction.</SectionSubtitle>

            <Card>
                <Label>Voice Provider</Label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
                    {[
                        { id: 'deepgram', name: 'Deepgram', icon: '/images/ai-providers/Deepgram.svg' },
                        { id: 'elevenlabs', name: 'ElevenLabs', icon: '/images/ai-providers/elevenlabs.svg' },
                    ].map(({ id, name, icon }) => {
                        const isSel = voiceProvider === id;
                        return (
                            <div
                                key={id}
                                onClick={() => setVoiceProvider(id as 'deepgram' | 'elevenlabs')}
                                style={{
                                    padding: '16px 14px',
                                    borderRadius: 12,
                                    border: `1.5px solid ${isSel ? '#111111' : '#e8e6d9'}`,
                                    backgroundColor: isSel ? '#f4f4f4' : '#ffffff',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: 8,
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                            >
                                <Image unoptimized src={icon} alt={name} width={24} height={24} />
                                <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: '#111111', textAlign: 'center' }}>{name}</span>
                                {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: '#111111' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                            </div>
                        );
                    })}
                </div>

                <AnimatePresence initial={false}>
                    {voiceProvider === 'deepgram' && (
                        <motion.div key="deepgram" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            <Label>Deepgram API Key</Label>
                            <div style={{ position: 'relative', marginBottom: 8 }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                <Input type="password" placeholder="sk-..." value={voiceDeepgramKey} onChange={e => setVoiceDeepgramKey(e.target.value)} style={{ paddingLeft: 40 }} />
                            </div>
                            <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 4 }}>Get your API key from <a href="https://console.deepgram.com" target="_blank" rel="noopener" style={{ color: '#111111', textDecoration: 'underline' }}>Deepgram Console</a></p>
                        </motion.div>
                    )}
                    {voiceProvider === 'elevenlabs' && (
                        <motion.div key="elevenlabs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                            <Label>ElevenLabs API Key</Label>
                            <div style={{ position: 'relative', marginBottom: 8 }}>
                                <KeyIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                <Input type="password" placeholder="sk_..." value={voiceElevenlabsKey} onChange={e => setVoiceElevenlabsKey(e.target.value)} style={{ paddingLeft: 40 }} />
                            </div>
                            <p style={{ fontSize: 11, color: '#a8a6a1', marginTop: 4 }}>Get your API key from <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener" style={{ color: '#111111', textDecoration: 'underline' }}>ElevenLabs Settings</a></p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 12px' }}>About Voice Mode</h3>
                <p style={{ fontSize: 13, color: '#4a4846', lineHeight: 1.6, margin: 0 }}>Voice Mode enables natural conversation with Fern. Speak naturally, and Fern will understand context, execute tasks, and respond with both text and audio. Uses your configured AI model for reasoning.</p>
            </Card>
        </div>
    );

    // ── Vision Grounding ──────────────────────────────────────────────────────
    const VisionSection = () => (
        <div>
            <SectionTitle>Vision Grounding</SectionTitle>
            <SectionSubtitle>Connect a vision model to enable precise GUI automation and screen understanding.</SectionSubtitle>

            <Card>
                <Label>ShowUI Endpoint</Label>
                <div style={{ position: 'relative', marginBottom: 16 }}>
                    <GlobeAltIcon width={16} height={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                    <Input type="text" placeholder="http://127.0.0.1:7860" value={settingsShowuiUrl} onChange={e => setSettingsShowuiUrl(e.target.value)} style={{ paddingLeft: 40 }} />
                </div>
                <p style={{ fontSize: 12, color: '#8a8886', lineHeight: 1.5, marginBottom: 0 }}>
                    Start ShowUI with <code style={{ backgroundColor: '#f4f4f4', padding: '2px 6px', borderRadius: 6, fontSize: 11, color: '#111111' }}>python app.py</code> in your ShowUI directory.
                </p>
            </Card>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 16px' }}>Vision Model Source</h3>
                {/* Toggle */}
                <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f4f4f4', borderRadius: 12, border: '1px solid #e8e6d9', marginBottom: 20, width: 'fit-content' }}>
                    {(['local', 'cloud'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSettingsVlmMode(mode)}
                            style={{ padding: '8px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: settingsVlmMode === mode ? '#111111' : 'transparent', color: settingsVlmMode === mode ? '#ffffff' : '#8a8886' }}
                        >
                            {mode === 'local' ? 'Local GPU' : 'Cloud Provider'}
                        </button>
                    ))}
                </div>

                {settingsVlmMode === 'local' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <h4 style={{ fontSize: 14, fontWeight: 600, color: '#111111', margin: '0 0 4px' }}>Local Vision Model (Qwen3-VL 2B)</h4>
                            <p style={{ fontSize: 12, color: '#8a8886', margin: 0 }}>Requires Ollama to run on-device.</p>
                        </div>
                        <button
                            onClick={onOpenVlmOnboarding}
                            style={{ padding: '10px 18px', backgroundColor: '#111111', color: '#ffffff', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                            Install & Setup
                        </button>
                    </div>
                )}

                {settingsVlmMode === 'cloud' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <Label>Provider</Label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20, pointerEvents: 'auto' }}>
                                {visionProviders.map(({ id, name, Logo }) => {
                                    const isSel = settingsVlmCloudProvider === id;
                                    return (
                                        <div key={id}
                                            onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                                                e.stopPropagation();
                                                setSettingsVlmCloudProvider(id);
                                                // Clear stale baseUrl and apiKey when switching to cloud-only providers
                                                if (id === 'everfern' || id === 'openrouter') {
                                                    setSettingsVlmCloudUrl('');
                                                    setSettingsVlmCloudKey('');
                                                }
                                            }}
                                            style={{
                                                padding: '14px 12px',
                                                borderRadius: 12,
                                                border: `1.5px solid ${isSel ? '#111111' : '#e8e6d9'}`,
                                                backgroundColor: isSel ? '#f4f4f4' : '#ffffff',
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
                                            <span style={{ fontSize: 12, fontWeight: isSel ? 600 : 500, color: '#111111', textAlign: 'center' }}>{name}</span>
                                            {isSel && <div style={{ position: 'absolute', top: 8, right: 8, color: '#111111' }}><CheckIcon width={14} height={14} strokeWidth={2.5} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        {settingsVlmCloudProvider !== 'everfern' && (
                            <>
                                <div>
                                    <Label>Model Name</Label>
                                    <div style={{ position: 'relative' }}>
                                        {settingsVlmCloudProvider === 'ollama' ? (
                                            <Select value={settingsVlmCloudModel} onChange={e => setSettingsVlmCloudModel(e.target.value)}>
                                                <option value="qwen3-vl:235b-instruct-cloud">Qwen3 VL 235B (Default)</option>
                                                <option value="kimi-k2.6:cloud">Kimi K2.6 Cloud</option>
                                                <option value="glm-5.1:cloud">GLM 5.1 Cloud</option>
                                            </Select>
                                        ) : (
                                            <>
                                                <CpuChipIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                                <Input type="text" placeholder={settingsVlmCloudProvider === 'openai' ? 'gpt-4o' : 'qwen3-vl:235b-instruct-cloud'} value={settingsVlmCloudModel} onChange={e => setSettingsVlmCloudModel(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                            </>
                                        )}
                                    </div>
                                </div>
                                {settingsVlmCloudProvider !== 'ollama' && (
                                    <div>
                                        <Label>Host URL (Optional)</Label>
                                        <div style={{ position: 'relative' }}>
                                            <GlobeAltIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                            <Input type="text" placeholder="Optional custom base URL" value={settingsVlmCloudUrl} onChange={e => setSettingsVlmCloudUrl(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <Label>API Key</Label>
                                    <div style={{ position: 'relative' }}>
                                        <KeyIcon width={14} height={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8a8886' }} />
                                        <Input type="password" placeholder="sk-..." value={settingsVlmCloudKey} onChange={e => setSettingsVlmCloudKey(e.target.value)} style={{ paddingLeft: 40, fontFamily: 'monospace' }} />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Card>
        </div>
    );

    // ── Custom Skills ────────────────────────────────────────────────────
    const SkillsSection = () => {
        const [customSkills, setCustomSkills] = useState<{ name: string; description: string }[]>([]);
        const [newSkillName, setNewSkillName] = useState('');
        const [newSkillDesc, setNewSkillDesc] = useState('');
        const [newSkillContent, setNewSkillContent] = useState('');
        const [isAdding, setIsAdding] = useState(false);
        const [isLoading, setIsLoading] = useState(true);
        const [isSaving, setIsSaving] = useState(false);
        const [saveResult, setSaveResult] = useState<{ success?: boolean; error?: string } | null>(null);

        useEffect(() => {
            const loadSkills = async () => {
                try {
                    const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                    setCustomSkills(skills || []);
                } catch (e) { console.error('Failed to load custom skills:', e); }
                setIsLoading(false);
            };
            loadSkills();
        }, []);

        const handleAddSkill = async () => {
            if (!newSkillName.trim() || !newSkillDesc.trim()) return;
            setIsSaving(true);
            setSaveResult(null);
            try {
                const result = await (window as any).electronAPI?.skills?.saveCustom?.({
                    name: newSkillName.trim(),
                    description: newSkillDesc.trim(),
                    content: newSkillContent.trim()
                });
                if (result?.success) {
                    setSaveResult({ success: true });
                    setNewSkillName('');
                    setNewSkillDesc('');
                    setNewSkillContent('');
                    const skills = await (window as any).electronAPI?.skills?.listCustom?.();
                    setCustomSkills(skills || []);
                    setTimeout(() => setIsAdding(false), 500);
                } else {
                    setSaveResult({ error: result?.error || 'Failed to save skill' });
                }
            } catch (e) { setSaveResult({ error: String(e) }); }
            setIsSaving(false);
        };

        const handleDeleteSkill = async (name: string) => {
            try {
                await (window as any).electronAPI?.skills?.deleteCustom?.(name);
                setCustomSkills(prev => prev.filter(s => s.name !== name));
            } catch (e) { console.error('Failed to delete skill:', e); }
        };

        const openCustomFolder = () => {
            (window as any).electronAPI?.skills?.getCustomPath?.().then((path: string) => {
                (window as any).electronAPI?.system?.openFolder?.(path);
            });
        };

        return (
            <div>
                <SectionTitle>Custom Skills</SectionTitle>
                <SectionSubtitle>Create and manage your own custom skills.</SectionSubtitle>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: '#8a8886' }}>{customSkills.length} custom skill{customSkills.length !== 1 ? 's' : ''}</span>
                    <button
                        onClick={() => { setIsAdding(true); setSaveResult(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', backgroundColor: '#111111', color: '#ffffff', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
                    >
                        <span style={{ fontSize: 16 }}>+</span> Add Skill
                    </button>
                </div>

                {isAdding && (
                    <Card>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 16px' }}>Create New Skill</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <Label>Skill Name</Label>
                                <Input
                                    placeholder="e.g., my-analysis-skill"
                                    value={newSkillName}
                                    onChange={e => setNewSkillName(e.target.value)}
                                />
                            </div>
                            <div>
                                <Label>Description</Label>
                                <Input
                                    placeholder="e.g., Use this skill for analyzing sales data"
                                    value={newSkillDesc}
                                    onChange={e => setNewSkillDesc(e.target.value)}
                                />
                            </div>
                            <div>
                                <Label>SKILL.md Content (Optional)</Label>
                                <textarea
                                    placeholder="# My Custom Skill&#10;&#10;Write your skill instructions here..."
                                    value={newSkillContent}
                                    onChange={e => setNewSkillContent(e.target.value)}
                                    style={{ width: '100%', minHeight: 150, padding: 12, borderRadius: 10, border: '1px solid #e8e6d9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }}
                                />
                            </div>
                            {saveResult && (
                                <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: saveResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: saveResult.success ? '#16a34a' : '#dc2626', fontSize: 13 }}>
                                    {saveResult.success ? '✓ Skill saved successfully!' : `✗ ${saveResult.error}`}
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={() => setIsAdding(false)}
                                    style={{ flex: 1, padding: '10px 20px', backgroundColor: 'transparent', color: '#4a4846', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid #e8e6d9', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddSkill}
                                    disabled={isSaving || !newSkillName.trim() || !newSkillDesc.trim()}
                                    style={{ flex: 1, padding: '10px 20px', backgroundColor: '#111111', color: '#ffffff', borderRadius: 10, fontWeight: 600, fontSize: 13, border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}
                                >
                                    {isSaving ? 'Saving...' : 'Save Skill'}
                                </button>
                            </div>
                        </div>
                    </Card>
                )}

                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#8a8886' }}>Loading...</div>
                ) : customSkills.length === 0 && !isAdding ? (
                    <Card>
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <p style={{ fontSize: 14, color: '#8a8886', marginBottom: 12 }}>No custom skills yet</p>
                            <p style={{ fontSize: 12, color: '#a8a6a1', marginBottom: 16 }}>Create your first skill to extend EverFern's capabilities</p>
                        </div>
                    </Card>
                ) : (
                    customSkills.map(skill => (
                        <Card key={skill.name}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <h4 style={{ fontSize: 14, fontWeight: 600, color: '#111111', margin: '0 0 4px' }}>{skill.name}</h4>
                                    <p style={{ fontSize: 13, color: '#8a8886', margin: 0 }}>{skill.description}</p>
                                </div>
                                <button
                                    onClick={() => handleDeleteSkill(skill.name)}
                                    style={{ padding: '6px 10px', backgroundColor: 'transparent', color: '#dc2626', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                                >
                                    Delete
                                </button>
                            </div>
                        </Card>
                    ))
                )}

                <Card style={{ marginTop: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111111', margin: '0 0 8px' }}>Custom Skills Location</h3>
                    <p style={{ fontSize: 12, color: '#8a8886', margin: '0 0 12px', lineHeight: 1.5 }}>
                        Custom skills are stored in <code style={{ backgroundColor: '#f4f4f4', padding: '2px 6px', borderRadius: 6, fontSize: 11 }}>~/.everfern/custom_skills/</code>
                    </p>
                    <button
                        onClick={openCustomFolder}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', backgroundColor: '#f4f4f4', color: '#111111', borderRadius: 10, fontWeight: 600, fontSize: 12, border: '1px solid #e8e6d9', cursor: 'pointer' }}
                    >
                        Open Folder
                    </button>
                </Card>
            </div>
        );
    };

    // ── Privacy & Data ────────────────────────────────────────────────────────
    const PrivacySection = () => (
        <div>
            <SectionTitle>Privacy & Data</SectionTitle>
            <SectionSubtitle>Control your data and reset your account.</SectionSubtitle>

            <Card>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111111', margin: '0 0 8px' }}>Data Storage</h3>
                <p style={{ fontSize: 13, color: '#8a8886', margin: '0 0 16px', lineHeight: 1.6 }}>
                    All conversation history, API keys, and configuration are stored locally on your device in <code style={{ backgroundColor: '#f4f4f4', padding: '2px 6px', borderRadius: 6, fontSize: 11, color: '#111111' }}>~/.everfern/</code>. Nothing is sent to EverFern servers.
                </p>
                <div style={{ padding: '12px 16px', backgroundColor: '#f4f4f4', borderRadius: 12, border: '1px solid #e8e6d9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: '#4a4846' }}>Chat history location</span>
                        <code style={{ color: '#111111', fontSize: 12 }}>~/.everfern/chats/</code>
                    </div>
                </div>
            </Card>

            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.04)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 16, padding: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#dc2626', margin: '0 0 8px' }}>Danger Zone</h3>
                <p style={{ fontSize: 13, color: '#8a8886', margin: '0 0 16px', lineHeight: 1.6 }}>Wipe all local data and reset your account. This cannot be undone.</p>
                <button
                    onClick={async () => {
                        if (!window.confirm('Are you sure you want to reset your account? This will permanently delete all conversations, settings, and local data.')) return;
                        try {
                            const result = await (window as any).electronAPI.system.wipeAccount();
                            if (result?.success) {
                                localStorage.clear();
                                window.location.reload();
                            } else {
                                alert(`Reset failed: ${result?.error || 'Unknown error'}`);
                            }
                        } catch (err: any) {
                            alert(`Reset failed: ${err?.message || 'Unknown error'}`);
                        }
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', backgroundColor: 'rgba(239,68,68,0.08)', color: '#dc2626', borderRadius: 10, fontWeight: 600, fontSize: 13, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.14)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'}
                >
                    <TrashIcon width={16} height={16} />
                    Reset Account
                </button>
            </div>
        </div>
    );

    // ── Help & Architecture ──────────────────────────────────────────────────
    const HelpSection = () => (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <SectionTitle>Architecture & Help</SectionTitle>
            <SectionSubtitle>Understand how the EverFern AI Brain and Swarm Architecture works.</SectionSubtitle>

            <Card>
                <Label>System Architecture (LangGraph)</Label>
                <div style={{
                    marginTop: 20,
                    padding: 24,
                    backgroundColor: '#faf9f7',
                    borderRadius: 16,
                    border: '1px solid #e8e6d9',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16
                }}>
                    <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', maxWidth: 500, marginBottom: 20 }}>
                        EverFern uses a state-of-the-art Directed Acyclic Graph (DAG) powered by LangGraph to orchestrate complex reasoning and autonomous actions.
                    </div>

                    {/* Visual Graph Representation */}
                    <div style={{ position: 'relative', width: '100%', maxWidth: 600, height: 450, display: 'flex', justifyContent: 'center' }}>
                        <svg width="100%" height="100%" viewBox="0 0 400 450">
                            {/* Lines/Edges */}
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orientation="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="#8a8886" />
                                </marker>
                            </defs>

                            {/* START -> Triage */}
                            <path d="M 200 20 L 200 50" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Triage -> Decomposer */}
                            <path d="M 200 90 L 200 120" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Decomposer -> Swarm/Planner */}
                            <path d="M 200 160 L 100 200" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            <path d="M 200 160 L 300 200" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Swarm/Planner -> Brain */}
                            <path d="M 100 240 L 190 280" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            <path d="M 300 240 L 210 280" stroke="#8a8886" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Brain -> Specialists */}
                            <path d="M 200 320 L 100 360" stroke="#6366f1" strokeWidth="2" strokeDasharray="4,4" markerEnd="url(#arrowhead)" />
                            <path d="M 200 320 L 300 360" stroke="#6366f1" strokeWidth="2" strokeDasharray="4,4" markerEnd="url(#arrowhead)" />
                            {/* Specialists -> Brain */}
                            <path d="M 80 380 Q 20 380 20 300 Q 20 220 180 290" stroke="#6366f1" strokeWidth="1" opacity="0.4" fill="none" markerEnd="url(#arrowhead)" />

                            {/* Nodes */}
                            <circle cx="200" cy="20" r="10" fill="#22c55e" />
                            <text x="200" y="20" fontSize="8" fontWeight="700" textAnchor="middle" dy=".3em" fill="white">START</text>

                            <rect x="150" y="50" width="100" height="40" rx="8" fill="#ffffff" stroke="#e8e6d9" strokeWidth="2" />
                            <text x="200" y="70" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em">Triage</text>

                            <rect x="150" y="120" width="100" height="40" rx="8" fill="#ffffff" stroke="#e8e6d9" strokeWidth="2" />
                            <text x="200" y="140" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em">Decomposer</text>

                            <rect x="50" y="200" width="100" height="40" rx="8" fill="#fef3c7" stroke="#f59e0b" strokeWidth="2" />
                            <text x="100" y="220" fontSize="11" fontWeight="700" textAnchor="middle" dy=".3em" fill="#92400e">🐝 Swarm</text>

                            <rect x="250" y="200" width="100" height="40" rx="8" fill="#ffffff" stroke="#e8e6d9" strokeWidth="2" />
                            <text x="300" y="220" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em">Planner</text>

                            <rect x="150" y="280" width="100" height="40" rx="8" fill="#111111" stroke="#111111" strokeWidth="2" />
                            <text x="200" y="300" fontSize="11" fontWeight="700" textAnchor="middle" dy=".3em" fill="white">🧠 Brain</text>

                            <rect x="50" y="360" width="100" height="40" rx="8" fill="#e0e7ff" stroke="#6366f1" strokeWidth="2" />
                            <text x="100" y="380" fontSize="10" fontWeight="600" textAnchor="middle" dy=".3em">Specialists</text>

                            <rect x="250" y="360" width="100" height="40" rx="8" fill="#ffffff" stroke="#e8e6d9" strokeWidth="2" />
                            <text x="300" y="380" fontSize="10" fontWeight="600" textAnchor="middle" dy=".3em">Tool Orchestrator</text>
                        </svg>
                    </div>
                </div>
            </Card>

            <Card>
                <Label>What is a Swarm?</Label>
                <div style={{ fontSize: 14, color: '#201e24', lineHeight: 1.6 }}>
                    A <strong>Swarm</strong> is a collective of specialized agents working in parallel to solve a complex task.
                    Unlike traditional agents that work one-by-one, EverFern's Swarm Architecture allows multiple "bees" to
                    investigate different sources or perform different tasks simultaneously, while sharing a
                    <strong> synchronized memory bus</strong> so they never repeat work.
                </div>
            </Card>
        </motion.div>
    );

    const sectionContent: Record<string, React.ReactNode> = {
        general: GeneralSection(),
        profile: ProfileSection(),
        models: ModelsSection(),
        voice: VoiceSection(),
        vision: VisionSection(),
        skills: SkillsSection(),
        tools: (
            <div>
                <SectionTitle>Registered Tools</SectionTitle>
                <SectionSubtitle>View all available tools registered with the autonomous agent.</SectionSubtitle>

                <RegisteredToolsList />
            </div>
        ),
        'tool-settings': (
            <div>
                <SectionTitle>Tool Settings</SectionTitle>
                <SectionSubtitle>Configure how Web Search and Website Crawl tools operate.</SectionSubtitle>
                <ToolSettingsSection />
            </div>
        ),
        privacy: PrivacySection(),
        help: HelpSection(),
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', backgroundColor: '#fcfcfb', fontFamily: 'var(--font-sans)' }}
        >
            {/* Top bar */}
            <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid #e8e6d9', backgroundColor: '#f5f4f0', flexShrink: 0, WebkitAppRegion: 'drag' } as any}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as any}>
                    <Cog6ToothIcon width={16} height={16} style={{ color: '#8a8886' }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#111111' }}>Settings</span>
                </div>
                <button
                    onClick={onClose}
                    style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.05)', border: '1px solid #e8e6d9', color: '#4a4846', cursor: 'pointer', transition: 'all 0.2s', WebkitAppRegion: 'no-drag' } as any}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
                >
                    <XMarkIcon width={16} height={16} />
                </button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Left nav */}
                <div style={{ width: 220, backgroundColor: '#f5f4f0', borderRight: '1px solid #e8e6d9', display: 'flex', flexDirection: 'column', padding: '20px 12px', flexShrink: 0, overflowY: 'auto' }}>
                    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {navSections.map(({ id, label, icon: Icon }) => {
                            const isActive = activeSection === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => setActiveSection(id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '9px 14px', borderRadius: 10, border: 'none',
                                        backgroundColor: isActive ? '#ffffff' : 'transparent',
                                        color: isActive ? '#111111' : '#4a4846',
                                        fontSize: 14, fontWeight: isActive ? 600 : 400,
                                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                                        boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                                        fontFamily: 'var(--font-sans)',
                                    }}
                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                >
                                    <Icon width={16} height={16} />
                                    {label}
                                </button>
                            );
                        })}
                    </nav>

                    {/* Version & Update Check */}
                    <div style={{ marginTop: 'auto', padding: '12px 14px', borderTop: '1px solid #e8e6d9' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#a8a6a1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                            App Version
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, color: '#4a4846', fontWeight: 500 }}>v{appVersion}</span>
                            <button 
                                onClick={handleCheckUpdate}
                                disabled={isCheckingUpdate}
                                style={{ 
                                    fontSize: 11, color: '#667eea', background: 'none', border: 'none', 
                                    cursor: isCheckingUpdate ? 'default' : 'pointer', fontWeight: 600, padding: 0,
                                    opacity: isCheckingUpdate ? 0.6 : 1
                                }}
                            >
                                {isCheckingUpdate ? 'Checking...' : 'Check for updates'}
                            </button>
                        </div>
                        {updateInfo?.hasUpdate && (
                            <div style={{ marginTop: 10, padding: 8, backgroundColor: '#f0ecff', borderRadius: 8, border: '1px solid #667eea' }}>
                                <div style={{ fontSize: 11, color: '#111111', fontWeight: 600, marginBottom: 2 }}>Update Available: v{updateInfo.latestVersion}</div>
                                <button 
                                    onClick={() => (window as any).electronAPI?.system?.openExternal?.(updateInfo.url)}
                                    style={{ fontSize: 11, color: '#ffffff', backgroundColor: '#667eea', border: 'none', borderRadius: 4, padding: '4px 8px', width: '100%', cursor: 'pointer', marginTop: 4 }}
                                >
                                    Download from GitHub
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right content area - Rounded floating sheet */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 32px', backgroundColor: '#f5f4f0' }}>
                    <div style={{
                        maxWidth: 720,
                        margin: '0 auto',
                        backgroundColor: '#ffffff',
                        border: '1px solid #e8e6d9',
                        borderRadius: 28,
                        padding: '40px 52px',
                        minHeight: '100%',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.02)'
                    }}>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeSection}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                transition={{ duration: 0.18 }}
                            >
                                {sectionContent[activeSection]}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Footer save bar */}
            <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '0 48px', borderTop: '1px solid #e8e6d9', backgroundColor: '#f5f4f0', flexShrink: 0 }}>
                <button
                    onClick={onClose}
                    style={{ padding: '9px 22px', backgroundColor: 'transparent', color: '#4a4846', border: '1px solid #e8e6d9', borderRadius: 10, fontWeight: 500, fontSize: 14, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    Cancel
                </button>
                <button
                    onClick={() => {
                        setToastState('saving');
                        setTimeout(() => setToastState('saved'), 600);
                        setTimeout(() => setToastState('idle'), 4200);
                        handleSaveSettings();
                    }}
                    disabled={settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 22px', backgroundColor: '#111111', color: '#ffffff',
                        border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14,
                        cursor: (settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)) ? 'not-allowed' : 'pointer',
                        opacity: (settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)) ? 0.4 : 1,
                        transition: 'all 0.2s', fontFamily: 'var(--font-sans)',
                    }}
                    onMouseEnter={e => { if (!(settingsEngine === 'online' && (!settingsProvider || !settingsApiKey))) e.currentTarget.style.backgroundColor = '#333333'; }}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = '#111111'}
                >
                    <ArrowDownOnSquareIcon width={16} height={16} />
                    Save Changes
                </button>
            </div>

            {/* Toast notification */}
            <AnimatePresence>
                {toastState !== 'idle' && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ type: "spring", damping: 15, stiffness: 300 }}
                        style={{
                            position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
                            backgroundColor: '#111111', color: '#ffffff', borderRadius: 24,
                            padding: '12px 24px', fontSize: 14, fontWeight: 600,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                            zIndex: 10000, display: 'flex', alignItems: 'center', gap: 8,
                            fontFamily: 'var(--font-sans)',
                        }}
                    >
                        {toastState === 'saving' && (
                            <>
                                <Loader size={16} strokeWidth={2} className="text-white" />
                                Saving settings...
                            </>
                        )}
                        {toastState === 'saved' && (
                            <>
                                <CheckIcon width={16} height={16} />
                                Settings have been saved
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
