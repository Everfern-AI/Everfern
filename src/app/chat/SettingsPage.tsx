'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/common/ThemeProvider';
import {
    ArrowDownOnSquareIcon,
    BoltIcon,
    BookOpenIcon,
    CheckIcon,
    CircleStackIcon,
    Cog6ToothIcon,
    CommandLineIcon,
    ComputerDesktopIcon,
    CpuChipIcon,
    ExclamationTriangleIcon,
    GlobeAltIcon,
    KeyIcon,
    MicrophoneIcon,
    ServerIcon,
    ShieldCheckIcon,
    UserCircleIcon,
    WrenchScrewdriverIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { Brain } from '@phosphor-icons/react';
import { ToolSettingsSection } from './components/ToolSettingsSection';
import PdfOcrPanel from './components/PdfOcrPanel';
import { GITHUB_REPO_URL } from './components/StarRepoPopup';
import { Loader } from '@/components/ui/animated-loading-svg-text-shimmer';
import type { SecretView } from '@/lib/secret-view';
import { secretDisplay } from '@/lib/secret-view';

import { SectionTitle, SectionSubtitle } from './settings/ui';
import { GeneralSection } from './settings/GeneralSection';
import { KeybindsSection } from './settings/KeybindsSection';
import { ProfileSection } from './settings/ProfileSection';
import { ModelsSection } from './settings/ModelsSection';
import { VoiceSection } from './settings/VoiceSection';
import { VisionSection } from './settings/VisionSection';
import { EmbeddingsSection } from './settings/EmbeddingsSection';
import { SkillsSection } from './settings/SkillsSection';
import { PrivacySection } from './settings/PrivacySection';
import { HelpSection } from './settings/HelpSection';
import { OpenClawSection } from './settings/OpenClawSection';
import { MemorySection } from './settings/MemorySection';
import { RegisteredToolsList } from './settings/RegisteredToolsList';
import { ToolPermissionsSection } from './settings/ToolPermissionsSection';
import { LinuxVMSection } from './settings/LinuxVMSection';
import { DispatchSection } from './settings/DispatchSection';
import { SystemHardwareSection } from './settings/SystemHardwareSection';

// ── No inline logos — using Image imports instead ─────────────────────────────────────────

export const navCategories = [
    {
        category: 'Account & System',
        items: [
            { id: 'profile', label: 'Profile', icon: UserCircleIcon, keywords: 'user name avatar email account tier plan cloud support' },
            { id: 'general', label: 'General', icon: Cog6ToothIcon, keywords: 'theme dark light interface language default home view' },
            { id: 'system', label: 'System & Hardware', icon: ComputerDesktopIcon, keywords: 'system hardware gpu cpu vram memory ram specs performance tps benchmarks models compatible compatibility accelerate huggingface' },
            { id: 'keybinds', label: 'Keybindings & Shortcuts', icon: CommandLineIcon, keywords: 'keyboard shortcuts keybinds hotkeys commands ctrl cmd bind key toggle' },
            { id: 'linux-vm', label: 'Linux VM', icon: ComputerDesktopIcon, keywords: 'wsl docker container ubuntu linux terminal environment sandbox' },
            { id: 'dispatch', label: 'EverFern Dispatch', icon: BoltIcon, keywords: 'dispatch remote cloud orchestration sync beta issues', badge: 'Beta' },
            { id: 'privacy', label: 'Privacy & Data', icon: KeyIcon, keywords: 'telemetry keys security local privacy storage' },
        ]
    },
    {
        category: 'AI & Intelligence',
        items: [
            { id: 'models', label: 'Models & Providers', icon: CpuChipIcon, keywords: 'engine provider ollama openrouter openai anthropic key custom model qwen gpt claude deepseek gemini llama mistral minimax huggingface' },
            { id: 'openclaw', label: 'Personality & Routing', icon: CommandLineIcon, keywords: 'soul agent prompt routing persona openclaw prompt system instructions' },
            { id: 'vision', label: 'Vision Grounding', icon: GlobeAltIcon, keywords: 'vision tars image screen browser OCR screenshot desktop' },
            { id: 'voice', label: 'Voice Mode', icon: MicrophoneIcon, keywords: 'speech voice whisper stt tts audio mic microphone speech-to-text' },
            { id: 'embeddings', label: 'Embeddings', icon: CircleStackIcon, keywords: 'vector index embedding model semantics RAG database pinecone' },
            { id: 'memory', label: 'Memory Graph', icon: (props: any) => <Brain size={20} {...props} />, keywords: 'brain memory knowledge graph facts nodes context remember' },
        ]
    },
    {
        category: 'Tools & Execution',
        items: [
            { id: 'tools', label: 'Registered Tools', icon: ServerIcon, keywords: 'mcp tools registered bash python web filesystem terminal navis' },
            { id: 'tool-settings', label: 'Tool Settings', icon: WrenchScrewdriverIcon, keywords: 'search tavily crawl fetch website web google duckduckgo' },
            { id: 'tool-permissions', label: 'Tool Permissions', icon: ShieldCheckIcon, keywords: 'security auto-approval rules permissions grants allow authorize' },
            { id: 'skills', label: 'Custom Skills', icon: BoltIcon, keywords: 'skill custom scripts functions instructions prompt workflow' },
        ]
    },
    {
        category: 'Help',
        items: [
            { id: 'help', label: 'Help & Architecture', icon: BookOpenIcon, keywords: 'documentation help architecture logs debug support troubleshooting' },
        ]
    }
];


// ── Sub-components ────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────

interface SettingsPageProps {
    activeProjectId?: string;
    initialSection?: string;
    onClose: () => void;
    config: any;
    username: string;

    settingsEngine: 'online' | 'local' | 'everfern' | null;
    setSettingsEngine: React.Dispatch<React.SetStateAction<'online' | 'local' | 'everfern' | null>>;
    settingsProvider: string | null;
    setSettingsProvider: (v: string | null) => void;
    // MP-SEC-11: SecretView redaction (echo) or a typed string / local URL.
    settingsApiKey: SecretView | string;
    setSettingsApiKey: (v: SecretView | string) => void;
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
    // MP-SEC-11: SecretView redaction (echo) or a typed string.
    settingsVlmCloudKey: SecretView | string;
    setSettingsVlmCloudKey: (v: SecretView | string) => void;
    modelValidationStatus: 'none' | 'success' | 'error';
    setModelValidationStatus: (v: 'none' | 'success' | 'error') => void;
    isValidatingModel: boolean;
    setIsValidatingModel: (v: boolean) => void;
    ollamaInstalled: boolean | null;
    modelInstalled: boolean | null;

    // Voice Mode
    voiceProvider: 'everfern' | 'deepgram' | 'elevenlabs' | 'local' | null;
    setVoiceProvider: (v: 'everfern' | 'deepgram' | 'elevenlabs' | 'local' | null) => void;
    // MP-SEC-11: SecretView redaction from load-config or a typed string.
    voiceDeepgramKey: SecretView | string;
    setVoiceDeepgramKey: (v: SecretView | string) => void;
    voiceElevenlabsKey: SecretView | string;
    setVoiceElevenlabsKey: (v: SecretView | string) => void;

    // Embeddings
    embeddingProvider: string;
    setEmbeddingProvider: (v: string) => void;
    embeddingModel: string;
    setEmbeddingModel: (v: string) => void;
    embeddingApiKey: SecretView | string;
    setEmbeddingApiKey: (v: SecretView | string) => void;

    handleSaveSettings: (profileName?: string, displayName?: string, preferences?: string, workFunction?: string) => void;
    onOpenVlmOnboarding: () => void;
}

// NR-UI-03: exactly one of {system browser, window.open} runs. The main
// handler returns {success: boolean}; only fall back to window.open when the
// bridge is missing, throws, or reports failure.
const openExternalOnce = async (url: string) => {
    const sys = (window as any).electronAPI?.system;
    if (sys?.openExternal) {
        try {
            const res = await sys.openExternal(url);
            if (res === undefined || res === null || res === true || res?.success !== false) return;
        } catch {
            // fall through to window.open
        }
    }
    window.open(url, '_blank');
};

export default function SettingsPage({
    activeProjectId,
    initialSection,
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
    embeddingProvider, setEmbeddingProvider,
    embeddingModel, setEmbeddingModel,
    embeddingApiKey, setEmbeddingApiKey,
    handleSaveSettings,
    onOpenVlmOnboarding,
}: SettingsPageProps) {
    const { theme } = useTheme();
    const [activeSection, setActiveSection] = useState(initialSection || 'general');
    // NR-UI-14: inline dismissible banner replaces native alert dialogs
    const [banner, setBanner] = useState<{ type: 'error' | 'info'; msg: string } | null>(null);

    // Banner auto-dismiss — effect-owned timer, cleaned up on unmount/change
    useEffect(() => {
        if (!banner) return;
        const t = setTimeout(() => setBanner(null), 5000);
        return () => clearTimeout(t);
    }, [banner]);

    useEffect(() => {
        if (initialSection) {
            setActiveSection(initialSection);
        }
    }, [initialSection]);

    const handleVisionLocalSetup = async () => {
        let isInstalled = ollamaInstalled;
        let isModelInstalled = modelInstalled;

        if ((window as any).electronAPI?.system?.ollamaStatus) {
            const status = await (window as any).electronAPI.system.ollamaStatus();
            isInstalled = status.installed;
            isModelInstalled = status.modelInstalled;
        }

        if (!isInstalled) {
            if ((window as any).electronAPI?.system?.openTerminalInstaller) {
                await (window as any).electronAPI.system.openTerminalInstaller('install-all');
            } else {
                setBanner({ type: 'error', msg: 'Ollama is not installed. Please install it first.' });
            }
        } else if (!isModelInstalled) {
            setBanner({ type: 'error', msg: 'Ollama is installed, but the vision model (qwen3-vl:2b) is missing. Open your terminal and run: ollama pull qwen3-vl:2b' });
            if ((window as any).electronAPI?.system?.openTerminalInstaller) {
                await (window as any).electronAPI.system.openTerminalInstaller('pull-model');
            }
        } else {
            onOpenVlmOnboarding();
        }
    };
    const [soul, setSoul] = useState('');
    const [agents, setAgents] = useState('');
    const [isSavingOpenClaw, setIsSavingOpenClaw] = useState(false);
    const [openClawScope, setOpenClawScope] = useState<'global' | 'workspace'>('global');

    useEffect(() => {
        const fetchOpenClaw = async () => {
            try {
                const scopePath = openClawScope === 'workspace' ? activeProjectId : undefined;
                const result = await (window as any).electronAPI?.openclaw?.getConfigs(scopePath);
                if (result) {
                    setSoul(result.soul || '');
                    setAgents(result.agents || '');
                }
            } catch (err) {
                console.error('Failed to load OpenClaw configs:', err);
            }
        };
        fetchOpenClaw();
    }, [activeProjectId, openClawScope]);

    const handleSaveOpenClaw = async () => {
        setIsSavingOpenClaw(true);
        try {
            const scopePath = openClawScope === 'workspace' ? activeProjectId : undefined;
            const res = await (window as any).electronAPI?.openclaw?.saveConfigs({
                soul,
                agents,
                workspaceRoot: scopePath
            });
            if (res?.success) {
                setBanner({ type: 'info', msg: 'OpenClaw configurations saved successfully!' });
            } else {
                setBanner({ type: 'error', msg: `Failed to save: ${res?.error || 'Unknown error'}` });
            }
        } catch (err: any) {
            setBanner({ type: 'error', msg: `Error saving configurations: ${err.message}` });
        } finally {
            setIsSavingOpenClaw(false);
        }
    };
    const [toastState, setToastState] = useState<'idle' | 'saving' | 'saved'>('idle');

    // Toast lifecycle timers — owned by effect so they are cleaned up on unmount/state change.
    // The 'saving'→'saved' timer is a safety fallback only: the Save button drives the real
    // transition from handleSaveSettings' resolve/reject (NR-UI-13).
    const saveToastSeqRef = useRef(0);
    useEffect(() => {
        if (toastState === 'idle') return;
        if (toastState === 'saving') {
            const seq = saveToastSeqRef.current;
            const t1 = setTimeout(() => {
                // Fallback: if the real save result never arrived, still resolve the toast
                if (seq === saveToastSeqRef.current) setToastState('saved');
            }, 600);
            return () => clearTimeout(t1);
        }
        if (toastState === 'saved') {
            const t2 = setTimeout(() => setToastState('idle'), 3600);
            return () => clearTimeout(t2);
        }
    }, [toastState]);
    const [settingsSearch, setSettingsSearch] = useState('');
    const [profileName, setProfileName] = useState(username || 'User');
    const [displayName, setDisplayName] = useState(username || 'User');
    const [preferences, setPreferences] = useState('');
    const [workFunction, setWorkFunction] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
    const [profileSaveSuccess, setProfileSaveSuccess] = useState<boolean>(false);
    // NR-LEAK-07: ref-owned timer with cleanup instead of a bare setTimeout
    const profileSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (profileSuccessTimerRef.current) clearTimeout(profileSuccessTimerRef.current);
    }, []);
    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        setProfileSaveSuccess(false);
        try {
            const updatedProfile = {
                userName: profileName.trim(),
                displayName: displayName.trim(),
                preferences: preferences.trim(),
                workFunction: workFunction,
            };
            if ((window as any).electronAPI?.saveConfig) {
                const currentConfig = (await (window as any).electronAPI.loadConfig?.())?.config || {};
                await (window as any).electronAPI.saveConfig({
                    ...currentConfig,
                    ...updatedProfile
                });
            }
            localStorage.setItem('everfern_profile', JSON.stringify(updatedProfile));

            if ((window as any).electronAPI?.memory?.saveDirect && (displayName.trim() || profileName.trim())) {
                const preferredName = displayName.trim() || profileName.trim();
                await (window as any).electronAPI.memory.saveDirect(
                    `The user's preferred name is ${preferredName}. Full name: ${profileName.trim()}. Always refer to them as ${preferredName}.`,
                    '[User Profile]'
                );
            }

            setProfileSaveSuccess(true);
            if (profileSuccessTimerRef.current) clearTimeout(profileSuccessTimerRef.current);
            profileSuccessTimerRef.current = setTimeout(() => setProfileSaveSuccess(false), 3000);
        } catch (e) {
            console.error('Failed to save profile settings:', e);
            setBanner({ type: 'error', msg: 'Failed to save profile settings.' });
        } finally {
            setIsSavingProfile(false);
        }
    };
    const [isCloudUser, setIsCloudUser] = useState(false);
    const [cloudEmail, setCloudEmail] = useState('');
    const [cloudUsage, setCloudUsage] = useState<{
        dailyUsed: number;
        dailyLimit: number;
        inputTokensUsed: number;
        inputTokenLimit: number;
        outputTokensUsed: number;
        outputTokenLimit: number;
        dailyCostUsd: number;
        plan?: string;
        tier?: string;
        visionRequests10Days?: number;
        visionRequestsLimit?: number;
        visionModelDowngraded?: boolean;
    } | null>(null);
    const [appVersion, setAppVersion] = useState('0.0.0');
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion?: string; url?: string } | null>(null);
    const [autoUpdateAvailable, setAutoUpdateAvailable] = useState(false);
    const [autoUpdateDownloaded, setAutoUpdateDownloaded] = useState(false);
    const [autoUpdateProgress, setAutoUpdateProgress] = useState<number | null>(null);
    const [showVectorsModal, setShowVectorsModal] = useState(false);
    const [vectorsData, setVectorsData] = useState<any[]>([]);
    const [loadingVectors, setLoadingVectors] = useState(false);
    const [showWipeConfirm, setShowWipeConfirm] = useState(false);
    const [wipePhrase, setWipePhrase] = useState('');
    const router = useRouter();

    // ── Local Model Discovery & Benchmark State ──────────────────────────────
    const [localHardwareInfo, setLocalHardwareInfo] = useState<any>(null);
    const [installedLocalModels, setInstalledLocalModels] = useState<any[]>([]);
    const [recommendedLocalModels, setRecommendedLocalModels] = useState<any[]>([]);
    const [isLoadingLocalModels, setIsLoadingLocalModels] = useState<boolean>(false);
    const [localProviderRunning, setLocalProviderRunning] = useState<boolean | null>(null);
    const [localProviderError, setLocalProviderError] = useState<string | null>(null);
    const [activeModelName, setActiveModelName] = useState<string>(config?.model || config?.customModel || '');
    const [pullingLocalModel, setPullingLocalModel] = useState<string | null>(null);
    const [pullingLocalPct, setPullingLocalPct] = useState<number>(0);
    const [localModelTab, setLocalModelTab] = useState<'installed' | 'recommended'>('installed');
    const localModelQuerySeqRef = useRef<number>(0);

    const loadLocalModelsForSection = async (prov?: string, customUrl?: string) => {
        const seq = ++localModelQuerySeqRef.current;
        const curProv = prov || settingsProvider || 'ollama';
        // MP-SEC-11: settingsApiKey may be a SecretView echo — only a typed
        // string is a usable local server URL.
        const fallbackUrl = typeof settingsApiKey === 'string' && settingsApiKey.trim() ? settingsApiKey : undefined;
        const curUrl = customUrl !== undefined ? customUrl : fallbackUrl;
        setIsLoadingLocalModels(true);
        setLocalProviderError(null);
        try {
            const sysApi = (window as any).electronAPI?.system;
            if (sysApi?.getLocalModels) {
                const res = await sysApi.getLocalModels({ provider: curProv, baseUrl: curUrl });
                if (seq !== localModelQuerySeqRef.current) return;
                if (res) {
                    if (res.hardware) setLocalHardwareInfo(res.hardware);
                    setLocalProviderRunning(res.running);
                    if (res.installedModels && Array.isArray(res.installedModels)) {
                        setInstalledLocalModels(res.installedModels);
                        if (res.installedModels.length === 0) setLocalModelTab('recommended');
                    }
                    if (res.recommendedModels && Array.isArray(res.recommendedModels)) {
                        setRecommendedLocalModels(res.recommendedModels);
                    }
                    if (!res.running) {
                        setLocalProviderError(res.error || `${curProv === 'lmstudio' ? 'LM Studio' : 'Ollama'} is not reachable.`);
                    }
                    return;
                }
            }
        } catch (err: any) {
            if (seq !== localModelQuerySeqRef.current) return;
            console.error('Failed to query local models in settings:', err);
            setLocalProviderError(err?.message || 'Error querying local provider.');
        } finally {
            if (seq === localModelQuerySeqRef.current) {
                setIsLoadingLocalModels(false);
            }
        }
    };

    const handleSetActiveLocalModel = async (modelName: string) => {
        setActiveModelName(modelName);
        // MP-SEC-11: for local engines this field holds a typed server URL
        // (plain string); a SecretView echo is never a URL.
        const localUrl = typeof settingsApiKey === 'string' && settingsApiKey.trim() ? settingsApiKey.trim() : '';
        const fallbackUrl = settingsProvider === 'lmstudio' ? 'http://localhost:1234/v1' : 'http://localhost:11434';
        try {
            if ((window as any).electronAPI?.saveConfig) {
                const cur = (await (window as any).electronAPI.loadConfig?.())?.config || {};
                await (window as any).electronAPI.saveConfig({
                    ...cur,
                    engine: 'local',
                    provider: settingsProvider || 'ollama',
                    model: modelName,
                    baseUrl: localUrl || fallbackUrl
                });
            }
            if ((window as any).electronAPI?.acp?.setProvider) {
                await (window as any).electronAPI.acp.setProvider({
                    provider: settingsProvider || 'ollama',
                    model: modelName,
                    baseUrl: localUrl || fallbackUrl
                });
            }
        } catch (err) {
            console.error('Failed to set active model:', err);
        }
    };

    const handlePullModelFromSettings = async (modelTag: string) => {
        const api = (window as any).electronAPI?.system;
        if (!api?.ollamaPull) return;
        setPullingLocalModel(modelTag);
        setPullingLocalPct(0);
        // NR-LEAK-03: clear any stale listeners from previous pulls, then
        // register this pull's progress listener on the real
        // 'system:ollama-pull-line' channel; removeOllamaListeners in the
        // finally block detaches it when the pull finishes.
        api.removeOllamaListeners?.();
        try {
            if (api.onOllamaPullLine) {
                api.onOllamaPullLine(({ line }: { line: string }) => {
                    const pctMatch = line.match(/(\d+\.?\d*)%/);
                    if (pctMatch) {
                        setPullingLocalPct(parseFloat(pctMatch[1]));
                    }
                });
            }
            const res = await api.ollamaPull(modelTag);
            if (res?.success) {
                await handleSetActiveLocalModel(modelTag);
                await loadLocalModelsForSection(settingsProvider || 'ollama', typeof settingsApiKey === 'string' ? settingsApiKey : undefined);
                setLocalModelTab('installed');
            }
        } catch (err) {
            console.error('Pull failed:', err);
        } finally {
            api.removeOllamaListeners?.();
            setPullingLocalModel(null);
        }
    };

    useEffect(() => {
        if (settingsEngine === 'local') {
            const timer = setTimeout(() => {
                // MP-SEC-11: only a typed string can be a local server URL.
                loadLocalModelsForSection(settingsProvider || 'ollama', typeof settingsApiKey === 'string' ? settingsApiKey : undefined);
            }, 250);
            return () => clearTimeout(timer);
        }
    }, [settingsEngine, settingsProvider, settingsApiKey]);

    const checkEverFernLogin = (providerId: string): boolean => {
        if (providerId === 'everfern') {
            const sessionStr = localStorage.getItem('everfern_cloud_session') || localStorage.getItem('everfern_auth_token');
            if (!sessionStr) {
                router.push('/auth');
                return false;
            }
        }
        return true;
    };

    useEffect(() => {
        const fetchVersion = async () => {
            const version = await (window as any).electronAPI?.system?.getVersion?.();
            if (version) setAppVersion(version);
        };
        fetchVersion();
    }, []);

    useEffect(() => {
        const api = (window as any).electronAPI?.system;
        if (!api) return;

        // Query initial status on mount
        api.getUpdateStatus?.().then((res: any) => {
            if (res) {
                if (res.status === 'available') {
                    setAutoUpdateAvailable(true);
                } else if (res.status === 'downloading') {
                    setAutoUpdateAvailable(true);
                    setAutoUpdateProgress(res.progress?.percent ?? null);
                } else if (res.status === 'downloaded') {
                    setAutoUpdateDownloaded(true);
                }
            }
        });

        const onAvailable = () => setAutoUpdateAvailable(true);
        const onDownloaded = () => { setAutoUpdateDownloaded(true); setAutoUpdateProgress(null); };
        const onProgress = (p: any) => setAutoUpdateProgress(p?.percent ?? null);
        const onError = () => { setAutoUpdateAvailable(false); setAutoUpdateProgress(null); };

        api.onUpdateAvailable?.(onAvailable);
        api.onUpdateDownloaded?.(onDownloaded);
        api.onUpdateProgress?.(onProgress);
        api.onUpdateError?.(onError);

        return () => {
            api._offUpdateAvailable?.(onAvailable);
            api._offUpdateDownloaded?.(onDownloaded);
            api._offUpdateProgress?.(onProgress);
            api._offUpdateError?.(onError);
        };
    }, []);

    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        try {
            const result = await (window as any).electronAPI?.system?.checkForUpdates?.();
            setUpdateInfo(result);
            if (result && result.hasUpdate) {
                setAutoUpdateAvailable(true);
            }
        } catch (err) {
            console.error('Failed to check for updates:', err);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    // Cache cloud data to reduce API calls
    const cloudDataCacheRef = useRef<{ data: any; timestamp: number } | null>(null);
    const CLOUD_DATA_CACHE_MS = 30000; // 30 seconds cache

    useEffect(() => {
        const fetchCloudData = async () => {
            try {
                const sessionStr = localStorage.getItem('everfern_cloud_session');
                if (!sessionStr) {
                    setIsCloudUser(false);
                    setCloudUsage(null);
                    setCloudEmail('');
                    return;
                }
                const session = JSON.parse(sessionStr);
                if (!session?.user || !session?.accessToken) {
                    setIsCloudUser(false);
                    setCloudUsage(null);
                    setCloudEmail('');
                    return;
                }

                // Check cache first
                const now = Date.now();
                if (cloudDataCacheRef.current && (now - cloudDataCacheRef.current.timestamp) < CLOUD_DATA_CACHE_MS) {
                    setCloudUsage(cloudDataCacheRef.current.data);
                    setIsCloudUser(true);
                    setCloudEmail(session.user?.email || '');
                    return;
                }

                // Skip if page is not visible
                if (typeof document !== 'undefined' && document.hidden) return;

                setIsCloudUser(true);
                setCloudEmail(session.user?.email || '');

                const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'https://api.everfern.app').replace(/\/$/, '');
                const res = await fetch(`${apiUrl}/api/user/me`, {
                    headers: { 'Authorization': `Bearer ${session.accessToken}` }
                });
                if (!res.ok) return;
                const data = await res.json();
                const usageData = {
                    dailyUsed: data.dailyUsed ?? 0,
                    dailyLimit: data.dailyLimit ?? 0,
                    inputTokensUsed: data.inputTokensUsed ?? 0,
                    inputTokenLimit: data.inputTokenLimit ?? 0,
                    outputTokensUsed: data.outputTokensUsed ?? 0,
                    outputTokenLimit: data.outputTokenLimit ?? data.tierDailyTokenLimit ?? 10000,
                    dailyCostUsd: data.dailyCostUsd ?? 0,
                    plan: (data.plan || data.tier || "free").toLowerCase(),
                    tier: (data.tier || data.plan || "free").toLowerCase(),
                    visionRequests10Days: data.visionRequests10Days ?? 0,
                    visionRequestsLimit: data.visionRequestsLimit ?? 5,
                    visionModelDowngraded: data.visionModelDowngraded ?? false,
                };

                // Update cache
                cloudDataCacheRef.current = { data: usageData, timestamp: now };
                setCloudUsage(usageData);
            } catch (e) {
                console.error('Failed to fetch cloud data', e);
            }
        };

        fetchCloudData();
        // Poll every 60 seconds instead of 5 seconds, and only when visible
        const interval = setInterval(fetchCloudData, 60000);

        // Resume polling when page becomes visible
        const handleVisibilityChange = () => {
            if (!document.hidden) fetchCloudData();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    const handleSignOut = async () => {
        localStorage.removeItem('everfern_cloud_session');
        localStorage.removeItem('everfern_auth_token');

        // Immediately update UI state
        setIsCloudUser(false);
        setCloudEmail('');
        setCloudUsage(null);

        // Clear cloud-specific fields from config without destroying everything
        try {
            if ((window as any).electronAPI?.loadConfig) {
                const res = await (window as any).electronAPI.loadConfig();
                if (res?.success && res?.config) {
                    const cfg = { ...res.config };
                    if (cfg.provider === 'everfern') {
                        delete cfg.provider;
                        // MP-SEC-11: absent fields are KEPT by merge semantics —
                        // an explicit {configured:false} SecretView clears the
                        // stored key.
                        cfg.apiKey = { configured: false };
                    }
                    if ((window as any).electronAPI?.saveConfig) {
                        await (window as any).electronAPI.saveConfig(cfg);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to clear cloud config:', err);
        }

        router.push('/auth');
    };

    useEffect(() => {
        const fetchProfileData = async () => {
            try {
                let name = "";
                let dispName = "";
                let prefs = "";
                let work = "";

                if ((window as any).electronAPI?.loadConfig) {
                    const res = await (window as any).electronAPI.loadConfig();
                    if (res.success && res.config) {
                        if (res.config.userName) name = res.config.userName;
                        if (res.config.displayName) dispName = res.config.displayName;
                        if (res.config.preferences) prefs = res.config.preferences;
                        if (res.config.workFunction) work = res.config.workFunction;
                    }
                }

                // Check localStorage fallback
                const savedStr = localStorage.getItem('everfern_profile');
                if (savedStr) {
                    try {
                        const saved = JSON.parse(savedStr);
                        if (!name && saved.userName) name = saved.userName;
                        if (!dispName && saved.displayName) dispName = saved.displayName;
                        if (!prefs && saved.preferences) prefs = saved.preferences;
                        if (!work && saved.workFunction) work = saved.workFunction;
                    } catch {}
                }

                if (!name && (window as any).electronAPI?.system?.getUsername) {
                    name = await (window as any).electronAPI.system.getUsername();
                }
                if (!dispName) {
                    dispName = name || "User";
                }
                if (!name) {
                    name = "User";
                }

                setProfileName(name);
                setDisplayName(dispName);
                setPreferences(prefs);
                setWorkFunction(work);
            } catch (err) {
                console.error("Failed to load profile data in SettingsPage", err);
            }
        };
        fetchProfileData();
    }, []);

    const renderActiveSection = () => {
        switch (activeSection) {
            case 'general': return <GeneralSection key="general" />;
            case 'system': return <SystemHardwareSection />;
            case 'keybinds': return <KeybindsSection key="keybinds" />;
            case 'openclaw': return (
                    <OpenClawSection
                        key="openclaw"
                        activeProjectId={activeProjectId}
                        soul={soul}
                        setSoul={setSoul}
                        agents={agents}
                        setAgents={setAgents}
                        isSavingOpenClaw={isSavingOpenClaw}
                        openClawScope={openClawScope}
                        setOpenClawScope={setOpenClawScope}
                        handleSaveOpenClaw={handleSaveOpenClaw}
                    />
                );
            case 'profile': return (
                    <ProfileSection
                        key="profile"
                        profileName={profileName}
                        setProfileName={setProfileName}
                        displayName={displayName}
                        setDisplayName={setDisplayName}
                        preferences={preferences}
                        setPreferences={setPreferences}
                        workFunction={workFunction}
                        setWorkFunction={setWorkFunction}
                        isSavingProfile={isSavingProfile}
                        profileSaveSuccess={profileSaveSuccess}
                        handleSaveProfile={handleSaveProfile}
                        isCloudUser={isCloudUser}
                        cloudEmail={cloudEmail}
                        cloudUsage={cloudUsage}
                        handleSignOut={handleSignOut}
                    />
                );
            case 'models': return (
                    <ModelsSection
                        key="models"
                        theme={theme}
                        settingsEngine={settingsEngine}
                        setSettingsEngine={setSettingsEngine}
                        settingsProvider={settingsProvider}
                        setSettingsProvider={setSettingsProvider}
                        // MP-SEC-11: sections take strings — SecretViews become
                        // masked display text; typed strings flow back via the setter.
                        settingsApiKey={typeof settingsApiKey === 'string' ? settingsApiKey : secretDisplay(settingsApiKey)}
                        setSettingsApiKey={setSettingsApiKey}
                        settingsCustomModel={settingsCustomModel}
                        setSettingsCustomModel={setSettingsCustomModel}
                        modelValidationStatus={modelValidationStatus}
                        setModelValidationStatus={setModelValidationStatus}
                        isValidatingModel={isValidatingModel}
                        setIsValidatingModel={setIsValidatingModel}
                        checkEverFernLogin={checkEverFernLogin}
                        localModels={{
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
                        }}
                    />
                );
            case 'voice': return (
                    <VoiceSection
                        key="voice"
                        voiceProvider={voiceProvider}
                        setVoiceProvider={setVoiceProvider}
                        voiceDeepgramKey={typeof voiceDeepgramKey === 'string' ? voiceDeepgramKey : secretDisplay(voiceDeepgramKey)}
                        setVoiceDeepgramKey={setVoiceDeepgramKey}
                        voiceElevenlabsKey={typeof voiceElevenlabsKey === 'string' ? voiceElevenlabsKey : secretDisplay(voiceElevenlabsKey)}
                        setVoiceElevenlabsKey={setVoiceElevenlabsKey}
                    />
                );
            case 'vision': return (
                    <VisionSection
                        key="vision"
                        settingsShowuiUrl={settingsShowuiUrl}
                        setSettingsShowuiUrl={setSettingsShowuiUrl}
                        settingsVlmMode={settingsVlmMode}
                        setSettingsVlmMode={setSettingsVlmMode}
                        settingsVlmCloudProvider={settingsVlmCloudProvider}
                        setSettingsVlmCloudProvider={setSettingsVlmCloudProvider}
                        settingsVlmCloudModel={settingsVlmCloudModel}
                        setSettingsVlmCloudModel={setSettingsVlmCloudModel}
                        settingsVlmCloudUrl={settingsVlmCloudUrl}
                        setSettingsVlmCloudUrl={setSettingsVlmCloudUrl}
                        settingsVlmCloudKey={typeof settingsVlmCloudKey === 'string' ? settingsVlmCloudKey : secretDisplay(settingsVlmCloudKey)}
                        setSettingsVlmCloudKey={setSettingsVlmCloudKey}
                        handleVisionLocalSetup={handleVisionLocalSetup}
                        checkEverFernLogin={checkEverFernLogin}
                    />
                );
            case 'embeddings': return (
                    <EmbeddingsSection
                        key="embeddings"
                        embeddingProvider={embeddingProvider}
                        setEmbeddingProvider={setEmbeddingProvider}
                        embeddingModel={embeddingModel}
                        setEmbeddingModel={setEmbeddingModel}
                        embeddingApiKey={typeof embeddingApiKey === 'string' ? embeddingApiKey : secretDisplay(embeddingApiKey)}
                        setEmbeddingApiKey={setEmbeddingApiKey}
                        checkEverFernLogin={checkEverFernLogin}
                    />
                );
            case 'memory': return <MemorySection key="memory" />;
            case 'skills': return <SkillsSection key="skills" />;
            case 'tools': return (
                <div>
                    <SectionTitle>Registered Tools</SectionTitle>
                    <SectionSubtitle>View all available tools registered with the autonomous agent.</SectionSubtitle>
                    <RegisteredToolsList />
                </div>
            );
            case 'tool-settings': return (
                <div>
                    <SectionTitle>Tool Settings</SectionTitle>
                    <SectionSubtitle>Configure how Web Search and Website Crawl tools operate.</SectionSubtitle>
                    <ToolSettingsSection />
                </div>
            );
            case 'tool-permissions': return <ToolPermissionsSection />;
            case 'privacy': return (
                    <PrivacySection
                        key="privacy"
                        showVectorsModal={showVectorsModal}
                        setShowVectorsModal={setShowVectorsModal}
                        vectorsData={vectorsData}
                        setVectorsData={setVectorsData}
                        loadingVectors={loadingVectors}
                        setLoadingVectors={setLoadingVectors}
                        showWipeConfirm={showWipeConfirm}
                        setShowWipeConfirm={setShowWipeConfirm}
                        wipePhrase={wipePhrase}
                        setWipePhrase={setWipePhrase}
                    />
                );
            case 'dispatch': return <DispatchSection isCloudUser={isCloudUser} />;
            case 'linux-vm': return (
                <div>
                    <LinuxVMSection />
                    <PdfOcrPanel />
                </div>
            );
            case 'help': return <HelpSection key="help" />;
            default: return <GeneralSection key="general" />;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-base)', fontFamily: 'var(--font-sans)' }}
        >
            {/* Top bar */}
            <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-base)', flexShrink: 0, WebkitAppRegion: 'drag' } as any}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as any}>
                    <Cog6ToothIcon width={16} height={16} style={{ color: 'var(--color-text-tertiary)' }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Settings</span>
                </div>
                <button
                    onClick={onClose}
                    style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-overlay)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.2s', WebkitAppRegion: 'no-drag' } as any}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-overlay)'}
                >
                    <XMarkIcon width={16} height={16} />
                </button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Left nav */}
                <div style={{ width: 240, backgroundColor: 'var(--color-bg-subtle)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', padding: '16px 12px', flexShrink: 0, overflowY: 'auto' }}>
                    {/* Search Input */}
                    <div style={{ marginBottom: 16 }}>
                        <input
                            type="text"
                            placeholder="Search settings..."
                            value={settingsSearch}
                            onChange={e => setSettingsSearch(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 10,
                                fontSize: 13,
                                color: 'var(--color-text-primary)',
                                outline: 'none',
                                boxSizing: 'border-box',
                                fontFamily: 'var(--font-sans)',
                                transition: 'border-color 0.15s'
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--color-border-focus)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>

                    <nav style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {navCategories.map(cat => {
                            const filteredItems = cat.items.filter(item => {
                                if (!settingsSearch.trim()) return true;
                                const q = settingsSearch.toLowerCase();
                                return item.label.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q);
                            });

                            if (filteredItems.length === 0) return null;

                            return (
                                <div key={cat.category}>
                                    <div style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: 'var(--color-text-tertiary)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        padding: '0 10px 6px',
                                    }}>
                                        {cat.category}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {filteredItems.map(({ id, label, icon: Icon, keywords }) => {
                                            const isActive = activeSection === id;
                                            const query = settingsSearch.trim().toLowerCase();

                                            // Contextual status badge or specific match subtitle
                                            let badgeText = '';
                                            let badgeColor = '';
                                            if (id === 'models') {
                                                badgeText = settingsProvider ? settingsProvider.toUpperCase() : 'OLLAMA';
                                                badgeColor = 'var(--color-text-tertiary)';
                                            } else if (id === 'profile' && isCloudUser) {
                                                badgeText = cloudUsage?.plan ? cloudUsage.plan.toUpperCase() : 'FREE';
                                                badgeColor = cloudUsage?.plan === 'pro' ? '#10b981' : '#a855f7';
                                            } else if (id === 'dispatch') {
                                                badgeText = 'BETA';
                                                badgeColor = '#f59e0b';
                                            }

                                            // Find specific sub-option matched by search query
                                            let matchedOption = '';
                                            if (query && !label.toLowerCase().includes(query)) {
                                                const match = keywords.split(' ').find(k => k.toLowerCase().includes(query));
                                                if (match) matchedOption = match;
                                            }

                                            return (
                                                <button
                                                    key={id}
                                                    onClick={() => setActiveSection(id)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '8px 10px', borderRadius: 10, border: 'none',
                                                        backgroundColor: isActive ? 'var(--color-bg-surface)' : 'transparent',
                                                        color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                                        fontSize: 13, fontWeight: isActive ? 600 : 400,
                                                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                                                        boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
                                                        fontFamily: 'var(--font-sans)',
                                                    }}
                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                >
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <Icon width={16} height={16} style={{ flexShrink: 0 }} />
                                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                                                        </div>
                                                        {matchedOption && (
                                                            <span style={{ fontSize: 10, color: '#10b981', paddingLeft: 24, textTransform: 'capitalize' }}>
                                                                ↳ matches "{matchedOption}"
                                                            </span>
                                                        )}
                                                    </div>
                                                    {badgeText && !matchedOption && (
                                                        <span style={{
                                                            fontSize: 7.5,
                                                            fontWeight: 700,
                                                            padding: '1px 4px',
                                                            borderRadius: 4,
                                                            backgroundColor: 'var(--color-bg-subtle)',
                                                            color: badgeColor,
                                                            border: '1px solid var(--color-border)',
                                                            flexShrink: 0,
                                                            letterSpacing: '0.03em',
                                                            maxWidth: 70,
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {badgeText}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </nav>

                    {/* Version & Update Check */}
                    <div style={{ marginTop: 'auto', padding: '12px 14px', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                            App Version
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500 }}>v{appVersion}</span>
                            <button 
                                onClick={handleCheckUpdate}
                                disabled={isCheckingUpdate}
                                style={{ 
                                    fontSize: 11, color: 'var(--color-navis-active-text)', background: 'none', border: 'none', 
                                    cursor: isCheckingUpdate ? 'default' : 'pointer', fontWeight: 600, padding: 0,
                                    opacity: isCheckingUpdate ? 0.6 : 1
                                }}
                            >
                                {isCheckingUpdate ? 'Checking...' : 'Check for updates'}
                            </button>
                        </div>
                        {updateInfo?.hasUpdate && (
                            <div style={{ marginTop: 10, padding: 8, backgroundColor: 'var(--color-navis-active-bg)', borderRadius: 8, border: '1px solid var(--color-navis-active-border)' }}>
                                <div style={{ fontSize: 11, color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: 2 }}>Update Available: v{updateInfo.latestVersion}</div>
                                {autoUpdateDownloaded ? (
                                    <button 
                                        onClick={() => (window as any).electronAPI?.system?.restartAndUpdate?.()}
                                        style={{ fontSize: 11, color: 'var(--color-text-inverse)', backgroundColor: 'var(--color-navis-active-border)', border: 'none', borderRadius: 4, padding: '4px 8px', width: '100%', cursor: 'pointer', marginTop: 4 }}
                                    >
                                        Restart &amp; Install
                                    </button>
                                ) : autoUpdateProgress !== null ? (
                                    <div style={{ marginTop: 4 }}>
                                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Downloading... {autoUpdateProgress.toFixed(1)}%</div>
                                        <div style={{ height: 4, backgroundColor: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${autoUpdateProgress}%`, backgroundColor: 'var(--color-navis-active-border)', transition: 'width 0.3s' }} />
                                        </div>
                                    </div>
                                ) : autoUpdateAvailable ? (
                                    <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 4 }}>Downloading update in background...</div>
                                ) : (
                                    <button
                                        onClick={() => openExternalOnce(`https://github.com/Everfern-AI/Everfern/releases/tag/v${updateInfo.latestVersion}`)}
                                        style={{ fontSize: 11, color: 'var(--color-text-inverse)', backgroundColor: 'var(--color-navis-active-border)', border: 'none', borderRadius: 4, padding: '4px 8px', width: '100%', cursor: 'pointer', marginTop: 4 }}
                                    >
                                        Download from GitHub
                                    </button>
                                )}
                            </div>
                        )}
                        <button
                            onClick={() => openExternalOnce(GITHUB_REPO_URL)}
                            style={{
                                marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '8px 12px', borderRadius: 8,
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'transparent', color: 'var(--color-text-secondary)',
                                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                            GitHub
                        </button>
                    </div>
                </div>

                {/* Right content area - Rounded floating sheet */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 32px', backgroundColor: 'var(--color-bg-base)' }}>
                    <div style={{
                        maxWidth: activeSection === 'system' ? 1040 : (activeSection === 'dispatch' ? 960 : 720),
                        margin: '0 auto',
                        backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 28,
                        padding: activeSection === 'system' ? '36px 44px' : '40px 52px',
                        minHeight: '100%',
                        boxShadow: 'var(--shadow-xs)',
                        transition: 'max-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeSection}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                transition={{ duration: 0.18 }}
                            >
                                {renderActiveSection()}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Footer save bar */}
            <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '0 48px', borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-base)', flexShrink: 0 }}>
                <button
                    onClick={onClose}
                    style={{ padding: '9px 22px', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 10, fontWeight: 500, fontSize: 14, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    Cancel
                </button>
                <button
                    onClick={async () => {
                        setToastState('saving');
                        const seq = ++saveToastSeqRef.current;
                        try {
                            // Real async save (page.tsx impl is async); drive the toast from its result
                            await (handleSaveSettings(profileName, displayName, preferences, workFunction) as unknown as Promise<void>);
                            if (seq !== saveToastSeqRef.current) return;
                            setToastState('saved');
                        } catch (e) {
                            if (seq !== saveToastSeqRef.current) return;
                            setToastState('idle');
                            setBanner({ type: 'error', msg: 'Failed to save settings.' });
                        }
                    }}
                    disabled={settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 22px', backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)',
                        border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14,
                        cursor: (settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)) ? 'not-allowed' : 'pointer',
                        opacity: (settingsEngine === 'online' && (!settingsProvider || !settingsApiKey)) ? 0.4 : 1,
                        transition: 'all 0.2s', fontFamily: 'var(--font-sans)',
                    }}
                    onMouseEnter={e => { if (!(settingsEngine === 'online' && (!settingsProvider || !settingsApiKey))) e.currentTarget.style.backgroundColor = 'var(--color-text-secondary)'; }}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-text-primary)'}
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
                            backgroundColor: 'var(--color-text-primary)', color: 'var(--color-text-inverse)', borderRadius: 24,
                            padding: '12px 24px', fontSize: 14, fontWeight: 600,
                            boxShadow: 'var(--shadow-glow)',
                            zIndex: 'var(--z-toast)', display: 'flex', alignItems: 'center', gap: 8,
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

            {/* NR-UI-14: inline dismissible banner (replaces native alert) */}
            <AnimatePresence>
                {banner && (
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        style={{
                            position: 'fixed', top: 64, right: 24, maxWidth: 420,
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '12px 14px', borderRadius: 12,
                            backgroundColor: banner.type === 'error' ? 'var(--color-error-dim)' : 'var(--color-bg-elevated)',
                            border: `1px solid ${banner.type === 'error' ? 'var(--color-error)' : 'var(--color-border)'}`,
                            color: banner.type === 'error' ? 'var(--color-error)' : 'var(--color-text-primary)',
                            fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-xl)',
                            zIndex: 'var(--z-toast)', fontFamily: 'var(--font-sans)',
                        }}
                    >
                        <ExclamationTriangleIcon width={16} height={16} style={{ flexShrink: 0, marginTop: 1, color: banner.type === 'error' ? 'var(--color-error)' : 'var(--color-text-secondary)' }} />
                        <span style={{ flex: 1, lineHeight: 1.5 }}>{banner.msg}</span>
                        <button
                            onClick={() => setBanner(null)}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex' }}
                            aria-label="Dismiss"
                        >
                            <XMarkIcon width={14} height={14} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
