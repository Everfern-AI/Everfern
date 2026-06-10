"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    PlusIcon,
    Cog6ToothIcon,
    PaperAirplaneIcon,
    ChevronDownIcon,
    XMarkIcon,
    CheckIcon,
    PaperClipIcon,
    StopIcon,
    KeyIcon,
    ArrowDownOnSquareIcon,
    GlobeAltIcon,
    SparklesIcon,
    CpuChipIcon,
    TrashIcon,
    ArrowTopRightOnSquareIcon,
    CheckCircleIcon,
    ChevronRightIcon,
    DocumentTextIcon,
    BellIcon,
    UserCircleIcon,
    Bars3CenterLeftIcon,
    SparklesIcon as SparklesIcon2,
    Cog8ToothIcon,
    AcademicCapIcon,
    MagnifyingGlassIcon,
    ChevronUpIcon,

    ArrowPathIcon,
    EyeIcon,
    StopCircleIcon,
    BriefcaseIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon as CheckSolidIcon } from "@heroicons/react/24/solid";

// Components
import { AgentTimeline } from "../../components/AgentTimeline";
import MissionProgressCard from './components/MissionProgressCard';
import type { MissionTimeline as MissionTimelineType } from "../../components/MissionTimeline";
import StreamView from "../../components/StreamView";
import WindowControls from "../components/WindowControls";
import Sidebar from "../components/Sidebar";
import PermissionDialog from "../components/PermissionDialog";
import DirectoryModal from '../components/DirectoryModal';
import { FileExplorerView } from "../components/FileExplorerView";
import { LoadingBreadcrumb, Loader } from '@/components/ui/animated-loading-svg-text-shimmer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import IntegrationSettings from '../../components/IntegrationSettings';

// Chat-specific components
import ArtifactsPanel from './ArtifactsPanel';
import ArtifactsList from './ArtifactsList';
import PlanViewerPanel from './PlanViewerPanel';
import TasksPanel from './TasksPanel';
import ScheduledTasksPanel from './components/ScheduledTasksPanel';
import { useDebateStream } from './hooks/useDebateStream';
import ScheduledTaskModal from './components/ScheduledTaskModal';
import SitePreview from './SitePreview';
import SettingsPage from './SettingsPage';
import CustomizeModal from './CustomizeModal';
import FileArtifact from './FileArtifact';
import FileViewerPane from './FileViewerPane';
import VoiceAssistantUI from './VoiceAssistantUI';
import SurfaceCanvas from './SurfaceCanvas';
import AnalyticsPage from './AnalyticsPage';
import RevertModal from './components/RevertModal';
import ProjectsPage from '../components/ProjectsPage';
import { ComputerPane } from './components/ComputerPane';
import ToolDetailSidePanel from './components/ToolDetailSidePanel';
import FileViewerModal from './components/FileViewerModal';
import { SubagentPanel } from './components/SubagentPanel';
import { ToolCallDetailPane, type ToolCallDetail } from './components/ToolCallDetailPane';
import { useSubagentTracking } from '@/hooks/useSubagentTracking';


// Extracted components
import {
    OpenAILogo,
    AnthropicLogo,
    DeepSeekLogo,
    GeminiLogo,
    NvidiaLogo,
    OpenRouterLogo,
    OllamaLogo,
    LMStudioLogo,
    HuggingFaceLogo,
    EverFernBglessLogo,
    MiniMaxLogo
} from './components/ProviderLogos';
import { WaveformIcon, FernStarburst } from './components/UIIcons';
import { MarkdownRenderer, StreamingMarkdown } from './components/MarkdownComponents';
import { ContextTokenRing, VoiceButton, RateLimitContinueButton } from './components/UIHelpers';
import { ToolCallTag, ToolCallRow, ComputerUseResultCard, LiveToolCallCard } from './components/ToolCallComponents';
import { ReportContainer } from './components/ReportComponents';
import { InlineVisualization } from './components/InlineVisualization';
import { PlanReviewCard, AgentWorkspaceCards } from './components/PlanComponents';
import { HitlApprovalForm, UserQuestionForm } from './components/FormComponents';
import { PlanApprovalBanner } from './components/PlanApprovalBanner';
import { ReasoningBranch, ReasoningPane, ProgressStepsIcon, ContextGridIcon, PaneSection, ReasoningBlock } from './components/ReasoningComponents';
import { HealthCheckScreen } from './components/HealthCheckScreen';

// Utils and types
import { resolveToolDisplay } from "./tool-labels";
import { formatDuration } from '../../lib/formatDuration';
import { useAutoCollapse } from '../../hooks/use-auto-collapse';
import type { ToolCallDisplay, Message, FileAttachment, FolderContext, ModelOption, SubAgentProgressEvent, LiveToolCall } from './types/index';
import type { SurfaceData } from './SurfaceCanvas';
import { stripAnsi, extractFileArtifacts } from './utils/helpers';
import type { LocalExecutionRequest, LocalExecutionResponse } from '../../../preload/preload';
import LocalExecutionPermissionCard from './components/LocalExecutionPermissionCard';


















// ── Orchestrator noise scrubber ───────────────────────────────────────────────
// Strips internal orchestration lines that leak into streaming/stored content.
const ORCHESTRATOR_LINE_PATTERNS = [
    /🤖[^\n]*/g,
    /🧭[^\n]*/g,
    /🔍[^\n]*/g,
    /⏱️[^\n]*/g,
    /⏭️[^\n]*/g,
    /🧠[^\n]*/g,
    /💭(?!\s*Working on:|\s*Task:)[^\n]*/g,
    /\[?BRAIN\]?[:\s][^\n]*/gi,
    /\[?TRIAGE\]?[:\s][^\n]*/gi,
    /\[?PLANNER\]?[:\s][^\n]*/gi,
    /\[?DECOMPOSER\]?[:\s][^\n]*/gi,
    /Triage in progress:[^\n]*/gi,
    /Initializing step[^\n]*/gi,
    /Analyzing task requirements[^\n]*/gi,
    /Routing analysis completed[^\n]*/gi,
    /Processing\.\.\.[^\n]*/gi,
    /\[?Evaluating in [^\]\s]+\]?\.*[^\n]*/gi,
    /\[?Navis\]?[^\n]*/gi,
    /\[?Terminal\]?[^\n]*/gi,
    /\[?Computer\]?[^\n]*/gi,
    /Intent Classification:.*?(?=(Decomposer:|Debate:|Skipped Debate:|Brain Node:|🧭|$))/gi,
    /(?:Skipped )?Decomposer: Skipped[^\n]*/gi,
    /(?:Skipped )?Debate:.*?(?=(Brain Node:|🧭|$))/gi,
    /Brain Node:.*?(?=(🧭|$))/gi,
    /task_complete — Task completed[^\n]*/gi,
    /\{[\s\n]*"messages"[\s\S]*?\}/gi,
    /\{[\s\n]*"tool_calls"[\s\S]*?\}/gi,
    /\{[\s\n]*"role"[\s\S]*?\}/gi,
    /\[?(?:Graph|IPC|Network|System)\]?[^\n]*/gi,
    /^\s*(?:Working|Thinking|Processing|Analyzing)(?:\.|\s)*$/gim,
    /(?:🌐|🔍|📝|✅|🔬|⚠️|🖥️|💻|📊)\s*(?:WEB EXPLORER|Deep Research|OS Interaction|Coding Specialist|Data Analyst|Data Analysis)[^\n]*/gi,
    /(?:WEB EXPLORER|Deep Research|OS Interaction|Coding Specialist|Data Analyst|Data Analysis)[:\-\s][^\n]*/gi
];

function scrubOrchestratorNoise(text: string): string {
    if (!text) return text;
    let out = text;
    for (const pat of ORCHESTRATOR_LINE_PATTERNS) {
        out = out.replace(pat, '');
    }
    // Collapse multiple blank lines into one
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Main ChatPage ─────────────────────────────────────────────────────────────
export default function ChatPage() {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [modelInfo, setModelInfo] = useState<{
        contextLength: number;
        maxCompletionTokens: number | null;
        promptPricing: number;
        completionPricing: number;
    } | null>(null);
    const [attachments, setAttachments] = useState<FileAttachment[]>([]);
    const [pursueGoalMode, setPursueGoalMode] = useState(false);
    const [folderContexts, setFolderContexts] = useState<FolderContext[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const bypassLoadingRef = useRef(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [folderHover, setFolderHover] = useState(false);
    const [tooltipState, setTooltipState] = useState<{ visible: boolean; x: number; y: number; content: string }>({ visible: false, x: 0, y: 0, content: "" });
    const [viewingFile, setViewingFile] = useState<{ name: string; path: string } | null>(null);

    const [showArtifacts, setShowArtifacts] = useState(false);
    const [selectedArtifactName, setSelectedArtifactName] = useState<string | null>(null);
    const [showPlanViewer, setShowPlanViewer] = useState(false);
    const [planViewerContent, setPlanViewerContent] = useState("");
    const [showTasksPanel, setShowTasksPanel] = useState(false);
    const [panelTasks, setPanelTasks] = useState<{ description: string; status: 'pending' | 'in_progress' | 'completed' }[]>([]);
    const [tasksFilePath, setTasksFilePath] = useState<string | undefined>(undefined);
    const [fileViewerPane, setFileViewerPane] = useState<{ toolId: string; filename: string; content: string; tab: 'code' | 'preview' } | null>(null);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState("fern-1");
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const availableModelsRef = useRef<ModelOption[]>([]);
    // Keep the ref updated so closures (dispatch command handler) always see the latest models
    useEffect(() => { availableModelsRef.current = availableModels; }, [availableModels]);
    const messagesRef = useRef<Message[]>([]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    const [showModelSelector, setShowModelSelector] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showDirectoryModal, setShowDirectoryModal] = useState(false);
    const [showIntegrationSettings, setShowIntegrationSettings] = useState(false);
    const [showProjectsPage, setShowProjectsPage] = useState(false);
    const [showAnalyticsPage, setShowAnalyticsPage] = useState(false);
    const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const [showScheduledTaskModal, setShowScheduledTaskModal] = useState(false);
    const [scheduledTasksRefreshTrigger, setScheduledTasksRefreshTrigger] = useState(0);

    // Revert modal state
    const [showRevertModal, setShowRevertModal] = useState(false);
    const [revertTarget, setRevertTarget] = useState<{ conversationId: string; timestamp: number; msgIndex: number } | null>(null);

    const { debate: debateData, isDebating, lastDebateId, skipDebate } = useDebateStream();
    const handleSaveScheduledTask = async (task: { name?: string; description: string; cron: string; prompt: string; startsAt?: string; endsAt?: string }) => {
        try {
            await (window as any).electronAPI.scheduledTasks.save({
                ...task,
                projectId: folderContexts[0]?.path || null
            });
            setScheduledTasksRefreshTrigger(prev => prev + 1);
        } catch (err) {
            console.error('Failed to save scheduled task:', err);
        }
    };
    const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [randomGreeting, setRandomGreeting] = useState("");
    const [currentSites, setCurrentSites] = useState<any[]>([]);
    const [settingsMotionBlur, setSettingsMotionBlur] = useState(true);
    const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
    const [notification, setNotification] = useState<{ id: string; title: string } | null>(null);
    const [projects, setProjects] = useState<any[]>([]);
    const [showProjectDropdown, setShowProjectDropdown] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Computer Pane State
    const [isComputerPaneOpen, setIsComputerPaneOpen] = useState(false);
    const [activeComputerData, setActiveComputerData] = useState<{
        agentName?: string;
        url?: string;
        screenshot?: string;
        toolName?: string;
        results?: any;
        query?: string;
        output?: string;
        args?: any;
    } | null>(null);

    // Health Check State - only show on initial app load, not on refresh
    const [showHealthCheck, setShowHealthCheck] = useState(false);
    const [healthCheckComplete, setHealthCheckComplete] = useState(false);

    useEffect(() => {
        // Only run on client side
        if (typeof window !== 'undefined') {
            const healthCheckDone = sessionStorage.getItem('healthCheckCompleted');
            if (!healthCheckDone) {
                setShowHealthCheck(true);
            } else {
                setHealthCheckComplete(true);
            }
        }
    }, []);

    // Tool Detail Side Panel State
    const [selectedToolCall, setSelectedToolCall] = useState<any | null>(null);
    const [isToolDetailOpen, setIsToolDetailOpen] = useState(false);
    const [toolDetailTabs, setToolDetailTabs] = useState<any[]>([]);
    const [activeToolDetailTabId, setActiveToolDetailTabId] = useState<string | null>(null);

    // Subagent Panel State
    const [showSubagentPanel, setShowSubagentPanel] = useState(false);
    const [selectedSubagentToolCall, setSelectedSubagentToolCall] = useState<ToolCallDetail | null>(null);
    const subagent = useSubagentTracking(activeConversationId);

    const prevIsToolDetailOpen = useRef(isToolDetailOpen);
    useEffect(() => {
        if (prevIsToolDetailOpen.current && !isToolDetailOpen) {
            textareaRef.current?.focus();
        }
        prevIsToolDetailOpen.current = isToolDetailOpen;
    }, [isToolDetailOpen]);

    const mapToolCallForDetail = (tc: ToolCallDisplay) => {
        // Collect any real-time screenshots from subAgentProgress events
        const progressEvents = subAgentProgressRef.current.get(tc.id) || tc.subAgentProgress || [];
        const progressScreenshots = progressEvents
            .filter(e => e.type === 'screenshot' && (e.screenshot?.base64 || e.content))
            .map(e => (e.screenshot?.base64 || e.content) as string);

        // Combine static screenshot and live streamed screenshots
        const screenshotData: string[] = [];

        // Add progress screenshots first to keep it chronological
        if (progressScreenshots.length > 0) {
            screenshotData.push(...progressScreenshots);
        }

        // Add static screenshot if available and not already in the array
        const staticScreenshot = tc.base64Image || tc.data?.screenshot || tc.data?.base64Image;
        if (staticScreenshot && typeof staticScreenshot === 'string' && !screenshotData.includes(staticScreenshot)) {
            screenshotData.push(staticScreenshot);
        } else if (Array.isArray(staticScreenshot)) {
            staticScreenshot.forEach((img: any) => {
                if (typeof img === 'string' && !screenshotData.includes(img)) {
                    screenshotData.push(img);
                }
            });
        }

        const finalScreenshots = screenshotData.slice(-12);

        // Construct toolCall structure expected by ToolDetailSidePanel
        return {
            id: tc.id,
            toolName: tc.toolName,
            args: tc.args || {},
            output: tc.output || '',
            duration: tc.durationMs,
            status: tc.status,
            data: {
                ...tc.data,
                screenshot: finalScreenshots.length > 0 ? (finalScreenshots.length === 1 ? finalScreenshots[0] : finalScreenshots) : undefined,
                base64Image: tc.base64Image || tc.data?.base64Image,
                results: tc.data?.results,
            },
            agentName: tc.displayName || 'Fern',
        };
    };

    const openToolDetailTab = (mappedToolCall: any) => {
        setSelectedToolCall(mappedToolCall);
        setActiveToolDetailTabId(mappedToolCall.id);
        setToolDetailTabs(prev => {
            const existingIndex = prev.findIndex(tab => tab.id === mappedToolCall.id);
            if (existingIndex !== -1) {
                const next = [...prev];
                next[existingIndex] = { ...next[existingIndex], ...mappedToolCall };
                return next;
            }
            return [...prev, mappedToolCall].slice(-8);
        });
        setIsToolDetailOpen(true);
        setIsComputerPaneOpen(false); // Close computer pane to avoid overlap
    };

    const handlePillClick = (tc: ToolCallDisplay) => {
        openToolDetailTab(mapToolCallForDetail(tc));
    };

    const maybeOpenUserUrlTool = (tc: ToolCallDisplay) => {
        if (tc.toolName !== 'show_user_url') return;
        const url = typeof tc.args?.url === 'string' ? tc.args.url.trim() : '';
        if (!url) return;
        openToolDetailTab(mapToolCallForDetail(tc));
    };

    const handleSelectToolDetailTab = (tabId: string) => {
        const tab = toolDetailTabs.find(t => t.id === tabId);
        if (!tab) return;
        setSelectedToolCall(tab);
        setActiveToolDetailTabId(tabId);
        setIsToolDetailOpen(true);
    };

    const handleCloseToolDetailTab = (tabId: string) => {
        setToolDetailTabs(prev => {
            const idx = prev.findIndex(tab => tab.id === tabId);
            if (idx === -1) return prev;
            const next = prev.filter(tab => tab.id !== tabId);
            if (activeToolDetailTabId === tabId) {
                const fallback = next[idx] || next[idx - 1] || next[0] || null;
                setSelectedToolCall(fallback);
                setActiveToolDetailTabId(fallback?.id || null);
                if (!fallback) setIsToolDetailOpen(false);
            }
            return next;
        });
    };

    const loadingMessages = ["marinating...", "schlepping...", "concocting...", "honking..."];
    const greetingMessages = [
        "What do you want to do, {name}?",
        "Ready to build, {name}?",
        "Back at it, {name}?"
    ];

    useEffect(() => {
        if (isLoading) {
            setLoadingMsgIdx(0);
            const interval = setInterval(() => {
                setLoadingMsgIdx(prev => (prev + 1) % loadingMessages.length);
            }, 2500);
            return () => clearInterval(interval);
        }
    }, [isLoading]);

    // Inject CSS for token ring tooltip hover
    useEffect(() => {
        const fetchProjects = async () => {
            try {
                if ((window as any).electronAPI?.projects?.list) {
                    const list = await (window as any).electronAPI.projects.list();
                    setProjects(list || []);
                }
            } catch (err) {
                console.error('Failed to fetch projects:', err);
            }
        };
        fetchProjects();
        const interval = setInterval(fetchProjects, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
            .token-ring-tooltip { opacity: 0 !important; transition: opacity 0.15s ease !important; }
            div:hover > .token-ring-tooltip { opacity: 1 !important; }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // ── EverFern Dispatch: receive commands from the web UI ───────────────────
    // When a command arrives from the web via Dispatch, we inject it into the
    // chat exactly as if the user had typed and submitted it themselves.
    const handleSendRef = useRef<any>(null);
    useEffect(() => {
        handleSendRef.current = handleSend;
    });

    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!api?.system?.onDispatchCommand) return;

        api.system.onDispatchCommand((command: string, model?: string) => {
            console.log('[Dispatch] Received command from web:', command, model ? `(model: ${model})` : '');
            if (!command?.trim()) return;

            if (command.startsWith('[HITL_APPROVED]')) {
                 handleHitlApproval(true, true);
                 return;
            }
            if (command.startsWith('[HITL_REJECTED]')) {
                 handleHitlApproval(false, true);
                 return;
            }
            if (command.startsWith('[INTERNAL_SYSTEM_RESPONSE_QUESTION_ID_')) {
                 const idMatch = command.match(/QUESTION_ID_([^_]+)_IDX_(\d+)/);
                 if (idMatch) {
                     const questionId = idMatch[1];
                     const optionIndex = parseInt(idMatch[2], 10);
                     const qIdx = parseInt(questionId, 10);
                     const questions = stateForBroadcastRef.current.activeUserQuestions;
                     const questionObj = questions[qIdx] || questions[0];
                     if (questionObj) {
                         const optionObj = questionObj.options[optionIndex];
                         if (optionObj) {
                             const answers: Record<string, string[]> = {
                                 [questionObj.question]: [optionObj.value]
                             };
                             handleQuestionSubmit(answers);
                         }
                     }
                 }
                 return;
            }

            // If a model override came from the web, apply it
            if (model && availableModelsRef.current.some(m => m.id === model)) {
                setSelectedModel(model);
            }

            // Set the input value and immediately trigger a send
            setInputValue(command);
            // Use a microtask delay so React re-renders the updated inputValue before handleSend reads it
            setTimeout(() => {
                if (handleSendRef.current) handleSendRef.current(command);
            }, 0);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    const [config, setConfig] = useState<any>(null);
    const [settingsEngine, setSettingsEngine] = useState<"online" | "local" | "everfern" | null>("everfern");
    const [settingsProvider, setSettingsProvider] = useState<string | null>(null);
    const [settingsApiKey, setSettingsApiKey] = useState("");
    const [settingsCustomModel, setSettingsCustomModel] = useState("");
    const [currentPlan, setCurrentPlan] = useState<any | null>(null);
    const [executionPlan, setExecutionPlan] = useState<{ title?: string; content: string } | null>(null);
    const [isExecutionPlanPaneOpen, setIsExecutionPlanPaneOpen] = useState<boolean>(true);
    const [progressExpanded, setProgressExpanded] = useState<boolean>(true);
    const [reportPane, setReportPane] = useState<{ label: string; path: string } | null>(null);
    const [contextItems, setContextItems] = useState<{ id: string; type: 'file' | 'web' | 'app'; label: string; base64Image?: string; appName?: string; appLogo?: string }[]>([]);
    const [isValidatingModel, setIsValidatingModel] = useState(false);
    const [modelValidationStatus, setModelValidationStatus] = useState<"none" | "success" | "error">("none");
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [onboardingStep, setOnboardingStep] = useState<"name" | "vlm">("name");
    const [onboardingName, setOnboardingName] = useState("");
    const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);
    const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
    const [ollamaLogs, setOllamaLogs] = useState<string[]>([]);
    const [isInstallingOllama, setIsInstallingOllama] = useState(false);
    const [ollamaInstallDone, setOllamaInstallDone] = useState(false);
    const [ollamaInstallPct, setOllamaInstallPct] = useState(0);
    const [ollamaInstallPhase, setOllamaInstallPhase] = useState<"downloading" | "finalizing" | "done">("downloading");
    const [isPullingModel, setIsPullingModel] = useState(false);
    const [pullPct, setPullPct] = useState(0);
    const [liveToolCalls, setLiveToolCalls] = useState<ToolCallDisplay[]>([]);
    const [streamingToolCalls, setStreamingToolCalls] = useState<LiveToolCall[]>([]);
    const [streamingContent, setStreamingContent] = useState("");
    const [streamingThought, setStreamingThought] = useState("");
    const [activePlanSteps, setActivePlanSteps] = useState<Array<{ id: string; description: string; tool?: string }> | null>(null);
    const [activePlanTitle, setActivePlanTitle] = useState<string | null>(null);

    // ── EverFern Dispatch: broadcast state back to the web UI ─────────────────
    // This effect runs whenever chat state changes and sends a state_update
    // event back to the web so it can render the AI's response in real-time.
    const [isDispatchReady, setIsDispatchReady] = useState(false);
    const dispatchBroadcastRef = useRef<((event: string, data: any) => void) | null>(null);
    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!api?.system?.onDispatchActive) return;
        api.system.onDispatchActive(() => {
            dispatchBroadcastRef.current = (event: string, data: any) => {
                (window as any).electronAPI?.system?.broadcastDispatch?.(event, data);
            };
            setIsDispatchReady(true);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-broadcast desktop_info whenever model selection changes or dispatch becomes ready
    useEffect(() => {
  if (!dispatchBroadcastRef.current || !isDispatchReady) return;
  dispatchBroadcastRef.current('desktop_info', {
    selectedModel,
    engine: settingsEngine,
    availableModels: availableModels.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      providerType: m.providerType,
    })),
  });
}, [selectedModel, availableModels, isDispatchReady, settingsEngine]);

    // User question form state
    const [activeUserQuestions, setActiveUserQuestions] = useState<Array<{
        question: string;
        options: Array<{ label: string; value: string; isRecommended?: boolean }>;
        multiSelect: boolean;
        previewMarkdown?: string;
    }>>([]);
    const activeUserQuestionRef = useRef(false);

    // Memory preference banner state - shown when AI uses stored user preferences
    const [memoryPreferenceBanner, setMemoryPreferenceBanner] = useState<{
        preference: string;
        rawMemory: string;
        dismissed: boolean;
    } | null>(null);

    // Multiple questions panel state (unused - kept for legacy compat)
    const [userQuestions, setUserQuestions] = useState<Array<{
        question: string;
        options: string[];
        multiSelect?: boolean;
    }>>([]);
    const [isUserQuestionsOpen, setIsUserQuestionsOpen] = useState(false);

    // Current node tracking for better status display
    const [currentNode, setCurrentNode] = useState<string>("");
    const [currentPhase, setCurrentPhase] = useState<"triage" | "planning" | "execution" | "validation" | "completion" | undefined>(undefined);
    const [activeContextTab, setActiveContextTab] = useState<'Overview' | 'Resources' | 'Permissions' | 'History'>('Overview');
    const [instructionsExpanded, setInstructionsExpanded] = useState(true);
    const [contextExpanded, setContextExpanded] = useState(true);
    const [instructions, setInstructions] = useState('');

    // Sub-agent progress pane state
    const [zoomedScreenshot, setZoomedScreenshot] = useState<string | null>(null);

    // Get user-friendly node names with enhanced phase context
    const getNodeDisplayName = (nodeName: string): string => {
        const nodeNames: Record<string, string> = {
            // Triage phase nodes
            'intent_classifier': 'Understanding your request',
            'triage': 'Analyzing request complexity',

            // Planning phase nodes
            'global_planner': 'Creating execution plan',
            'planner': 'Compiling execution pipeline',
            'planning': 'Designing approach',
            'debate_chamber': 'AI agents are debating for you..',
            'DEBATE_CHAMBER': 'AI agents are debating for you..',

            // Execution phase nodes
            'brain': 'Processing with AI',
            'multi_tool_orchestrator': 'Coordinating tools',
            'execute_tools': 'Running tools',
            'execution': 'Executing plan',
            'VALIDATION': 'Validating approach',
            'EXECUTE_TOOLS': 'Running tools',
            'BRAIN': 'Processing with AI',

            // Validation phase nodes
            'action_validation': 'Validating actions',
            'judge': 'Evaluating completion',
            'validation': 'Validating results',

            // Completion phase nodes
            'completion': 'Finalizing results',
            'hitl_approval': 'Waiting for approval',

            // Specialist nodes
            'web_explorer': 'Researching on the web',
            'deep_research': 'Conducting deep research',
            'coding_specialist': 'Writing code',
            'data_analyst': 'Analyzing data',
            'computer_use_agent': 'Interacting with desktop'
        };
        return nodeNames[nodeName] || (nodeName ? `Working on ${nodeName.replace(/_/g, ' ')}` : 'Working');
    };
    const [modelCallInfo, setModelCallInfo] = useState<{ model: string; toolsCount: number } | null>(null);
    const [missionTimeline, setMissionTimeline] = useState<MissionTimelineType | null>(null);
    const [missionComplete, setMissionComplete] = useState(false);

    // Settings
    const [settingsShowuiUrl, setSettingsShowuiUrl] = useState("http://127.0.0.1:7860");
    const [settingsVlmMode, setSettingsVlmMode] = useState<"local" | "cloud">("local");
    const [settingsVlmCloudProvider, setSettingsVlmCloudProvider] = useState("ollama");
    const [settingsVlmCloudModel, setSettingsVlmCloudModel] = useState("qwen3-vl:235b-cloud");
    const [settingsVlmCloudUrl, setSettingsVlmCloudUrl] = useState("https://ollama.com");
    const [settingsVlmCloudKey, setSettingsVlmCloudKey] = useState("");

    // Voice state
    const [voiceProvider, setVoiceProvider] = useState<"deepgram" | "elevenlabs" | null>(null);
    const [voiceDeepgramKey, setVoiceDeepgramKey] = useState("");
    const [voiceElevenlabsKey, setVoiceElevenlabsKey] = useState("");

    // Embedding state
    const [embeddingProvider, setEmbeddingProvider] = useState("everfern");
    const [embeddingModel, setEmbeddingModel] = useState("qwen/qwen3-embedding-8b");
    const [embeddingApiKey, setEmbeddingApiKey] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [voiceTranscript, setVoiceTranscript] = useState("");
    const [voiceLoading, setVoiceLoading] = useState(false);
    const [voicePlayback, setVoicePlayback] = useState(false);
    const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
    const [voiceVoiceId, setVoiceVoiceId] = useState("21m00Tcm4TlvDq8ikWAM");
    const [showVoiceAssistant, setShowVoiceAssistant] = useState(false);

    // Permission state
    const [showPermissionModal, setShowPermissionModal] = useState(false);
    const [permissionsGranted, setPermissionsGranted] = useState(false);

    // HITL Approval state
    const [showHitlApproval, setShowHitlApproval] = useState(false);
    const [hitlRequest, setHitlRequest] = useState<{
        id: string;
        question: string;
        details: {
            tools: any[];
            summary: string;
            reasoning: string;
        };
        options: string[];
    } | null>(null);

    // Plan card state
    const [activePlan, setActivePlan] = useState<{ content: string; chatId: string } | null>(null);

    // JSON Viewer state
    const [isJsonViewerOpen, setIsJsonViewerOpen] = useState(false);
    const [lastEventJson, setLastEventJson] = useState<string>("");
    const [lastEventType, setLastEventType] = useState<string>("");
    const [contextTokens, setContextTokens] = useState<{ used: number; max: number }>({ used: 0, max: 128000 });
    const [activeSurface, setActiveSurface] = useState<SurfaceData | null>(null);

    const missionTimelineRef = useRef<MissionTimelineType | null>(null);
    const answeredToolCallIdsRef = useRef<Set<string>>(new Set());

    const stateForBroadcastRef = useRef({ messages, streamingContent, liveToolCalls, streamingThought, activeUserQuestions, showHitlApproval, hitlRequest, missionTimeline, currentNode, isDebating, isLoading });
    useEffect(() => {
        stateForBroadcastRef.current = { messages, streamingContent, liveToolCalls, streamingThought, activeUserQuestions, showHitlApproval, hitlRequest, missionTimeline, currentNode, isDebating, isLoading };
    }, [messages, streamingContent, liveToolCalls, streamingThought, activeUserQuestions, showHitlApproval, hitlRequest, missionTimeline, currentNode, isDebating, isLoading]);

    const broadcastTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastBroadcastTimeRef = useRef(0);

    // Broadcast state_update for messages and streaming with proper throttling
    useEffect(() => {
        if (!dispatchBroadcastRef.current || !isDispatchReady) return;

        const sanitizeToolCall = (tc: any) => {
            if (!tc) return tc;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { icon, ...rest } = tc;
            return rest;
        };

        const doBroadcast = () => {
            const state = stateForBroadcastRef.current;
            dispatchBroadcastRef.current!('state_update', {
                messages: state.messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    toolCalls: m.toolCalls?.map(sanitizeToolCall),
                    missionTimeline: (m as any).missionTimeline,
                    timestamp: m.timestamp instanceof Date ? m.timestamp.getTime() : m.timestamp,
                })),
                streamingContent: state.streamingContent,
                liveToolCalls: state.liveToolCalls?.map(sanitizeToolCall),
                streamingThought: state.streamingThought,
                activeUserQuestions: state.activeUserQuestions,
                showHitlApproval: state.showHitlApproval,
                hitlRequest: state.hitlRequest ? {
                    ...state.hitlRequest,
                    details: {
                        ...state.hitlRequest.details,
                        tools: state.hitlRequest.details.tools?.map(sanitizeToolCall)
                    }
                } : null,
                missionTimeline: state.missionTimeline,
                currentNode: state.currentNode,
                isDebating: state.isDebating,
                isLoading: state.isLoading,
            });
            lastBroadcastTimeRef.current = Date.now();
            broadcastTimerRef.current = null;
        };

        const now = Date.now();
        if (now - lastBroadcastTimeRef.current >= 200) {
            if (broadcastTimerRef.current) {
                clearTimeout(broadcastTimerRef.current);
                broadcastTimerRef.current = null;
            }
            doBroadcast();
        } else if (!broadcastTimerRef.current) {
            broadcastTimerRef.current = setTimeout(doBroadcast, 200 - (now - lastBroadcastTimeRef.current));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, streamingContent, liveToolCalls, streamingThought, isDispatchReady, isLoading]);
    // Sub-agent progress — stored in a REF so updates never trigger page re-renders.
    // A lightweight version counter is bumped only when the tool detail panel is open,
    // so the side panel can reactively update without re-rendering the whole chat.
    const subAgentProgressRef = useRef<Map<string, SubAgentProgressEvent[]>>(new Map());
    const [subAgentProgressVersion, setSubAgentProgressVersion] = useState(0);
    // Stable getter — components that need the live map read from here
    const subAgentProgress = subAgentProgressRef.current;

    const sanitizeProgressForPersistence = useCallback((events?: any[]): SubAgentProgressEvent[] => {
        if (!Array.isArray(events)) return [];

        const seen = new Set<string>();
        const sanitized: SubAgentProgressEvent[] = [];
        for (const raw of events) {
            if (!raw || typeof raw !== 'object') continue;
            const event: any = { ...raw };
            if (event.screenshot) {
                event.screenshot = {
                    ...event.screenshot,
                    base64: '',
                    screenshotPath: event.screenshot.screenshotPath || event.screenshotPath,
                };
            }
            if (!event.screenshotPath && event.screenshot?.screenshotPath) {
                event.screenshotPath = event.screenshot.screenshotPath;
            }
            const dedupeKey = [
                event.toolCallId || '',
                event.type || '',
                event.timestamp || '',
                event.stepNumber ?? '',
                event.content || '',
                event.action?.type || '',
                event.screenshotPath || event.screenshot?.screenshotPath || '',
            ].join('|');
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            sanitized.push(event as SubAgentProgressEvent);
        }
        return sanitized.slice(-100);
    }, []);

    const persistableToolCall = useCallback((
        tc: ToolCallDisplay,
        index?: number,
        statusOverride?: ToolCallDisplay['status']
    ): ToolCallDisplay => {
        const inlineEvents = Array.isArray(tc.subAgentProgress) ? tc.subAgentProgress : [];
        const mappedEvents = tc.id ? (subAgentProgressRef.current.get(tc.id) || []) : [];
        const progress = sanitizeProgressForPersistence([...inlineEvents, ...mappedEvents]);
        const screenshotPaths = progress
            .map((ev: any) => ev.screenshotPath || ev.screenshot?.screenshotPath)
            .filter((p: any): p is string => typeof p === 'string' && p.length > 0);
        const existingPaths = Array.isArray(tc.data?.screenshotPaths) ? tc.data.screenshotPaths : [];
        const mergedPaths = Array.from(new Set([...existingPaths, ...screenshotPaths]));

        return {
            ...tc,
            status: statusOverride || tc.status,
            orderIndex: tc.orderIndex ?? index,
            subAgentProgress: progress.length > 0 ? progress : undefined,
            data: mergedPaths.length > 0
                ? { ...(tc.data || {}), screenshotPaths: mergedPaths }
                : tc.data,
        };
    }, [sanitizeProgressForPersistence]);

    const persistableToolCalls = useCallback((
        toolCalls: ToolCallDisplay[] = [],
        statusForTool?: (tc: ToolCallDisplay) => ToolCallDisplay['status'] | undefined
    ) => toolCalls.map((tc, index) => persistableToolCall(tc, index, statusForTool?.(tc))), [persistableToolCall]);

    const restoreSubAgentProgressFromMessages = useCallback((loadedMessages: Message[]) => {
        const restored = new Map<string, SubAgentProgressEvent[]>();
        for (const msg of loadedMessages) {
            for (const tc of msg.toolCalls || []) {
                if (!tc.id || !Array.isArray(tc.subAgentProgress) || tc.subAgentProgress.length === 0) continue;
                const events = sanitizeProgressForPersistence(tc.subAgentProgress.map((event: any) => ({
                    ...event,
                    toolCallId: event.toolCallId || tc.id,
                })));
                if (events.length > 0) restored.set(tc.id, events);
            }
        }
        subAgentProgressRef.current = restored;
        setSubAgentProgressVersion(v => v + 1);
    }, [sanitizeProgressForPersistence]);

    // Local Execution Permission State (Task 7.1 & 7.2)
    const [localExecutionRequest, setLocalExecutionRequest] = useState<LocalExecutionRequest | null>(null);
    const [localAlwaysAllowed, setLocalAlwaysAllowed] = useState(false);
    const localAlwaysAllowedRef = useRef(false);
    const answeredLocalExecutionRequestIdsRef = useRef<Set<string>>(new Set());

    // Reset localAlwaysAllowed and answeredToolCallIdsRef when conversationId changes (Task 7.2)
    useEffect(() => {
        setLocalAlwaysAllowed(false);
        localAlwaysAllowedRef.current = false;
        answeredToolCallIdsRef.current.clear();
        answeredLocalExecutionRequestIdsRef.current.clear();
    }, [activeConversationId]);

    const respondToLocalExecutionRequest = useCallback((request: LocalExecutionRequest, approved: boolean, alwaysAllow: boolean) => {
        if (!request?.requestId || answeredLocalExecutionRequestIdsRef.current.has(request.requestId)) {
            return;
        }

        answeredLocalExecutionRequestIdsRef.current.add(request.requestId);
        if (alwaysAllow) {
            localAlwaysAllowedRef.current = true;
            setLocalAlwaysAllowed(true);
        }

        const acpApi = (window as any).electronAPI?.acp;
        acpApi?.sendLocalExecutionResponse?.({ requestId: request.requestId, approved, alwaysAllow });

        setLocalExecutionRequest(current => current?.requestId === request.requestId ? null : current);
        const updatedToolCalls = liveToolCallsRef.current.map(tc => (
            tc.id === request.requestId
                ? {
                    ...tc,
                    status: approved ? "done" as const : "error" as const,
                    output: approved
                        ? 'Permission approved. Running local command...'
                        : `Permission denied.\n\n${request.command}`,
                    data: { ...(tc.data || {}), approved, alwaysAllow },
                  }
                : tc
        ));
        liveToolCallsRef.current = updatedToolCalls;
        setLiveToolCalls(updatedToolCalls);
    }, []);

    // Persistent local execution request listener (survives stream cleanup)
    useEffect(() => {
        const acpApi = (window as any).electronAPI?.acp;
        if (!acpApi?.onLocalExecutionRequest) return;
        acpApi.onLocalExecutionRequest((request: LocalExecutionRequest) => {
            if (localAlwaysAllowedRef.current) {
                respondToLocalExecutionRequest(request, true, true);
                return;
            }
            setLocalExecutionRequest(request);
        });
        return () => {
            acpApi?.removeLocalExecutionListeners?.();
        };
    }, []);

    const selectedToolCallRef = useRef<any>(null);
    selectedToolCallRef.current = selectedToolCall;

    useEffect(() => {
        const current = selectedToolCallRef.current;
        if (!current || !isToolDetailOpen) return;

        for (const msg of messages) {
            const updatedTc = msg.toolCalls?.find(tc => tc.id === current.id);
            if (updatedTc) {
                if (updatedTc.status !== current.status || updatedTc.output !== current.output) {
                    const mappedToolCall = mapToolCallForDetail(updatedTc);
                    setSelectedToolCall(mappedToolCall);
                    setToolDetailTabs(prev => prev.map(tab => (
                        tab.id === mappedToolCall.id ? { ...tab, ...mappedToolCall } : tab
                    )));
                }
                break;
            }
        }
    // selectedToolCall is read via ref to avoid infinite re-trigger when setSelectedToolCall creates a new object.
    // subAgentProgressVersion replaces subAgentProgress in the dep array — it's a counter that
    // only increments when the tool detail panel is open, preventing spurious re-renders.
    }, [messages, isToolDetailOpen, subAgentProgressVersion]);

    useEffect(() => {
        const handleProgress = (_: any, data: any) => {
            const conversationId = data?.conversationId;
            if (conversationId && conversationId !== activeConversationId) {
                setActiveTaskIds(prev => prev.includes(conversationId) ? prev : [...prev, conversationId]);
            }
        };

        const handleComplete = (_: any, data: any) => {
            const conversationId = data?.conversationId;
            if (conversationId) {
                setActiveTaskIds(prev => prev.filter(id => id !== conversationId));
                if (conversationId !== activeConversationId) {
                    // Find title from history or use default
                    const convTitle = "Chat task";
                    setNotification({ id: conversationId, title: convTitle });
                    // Auto-hide toast after 8 seconds
                    setTimeout(() => setNotification(prev => prev?.id === conversationId ? null : prev), 8000);
                }
            }
        };

        const api = (window as any).electronAPI;
        if (api?.on) {
            api.on('agent-progress', handleProgress);
            api.on('agent-complete', handleComplete);
            return () => {
                api.off?.('agent-progress', handleProgress);
                api.off?.('agent-complete', handleComplete);
            };
        }
    }, [activeConversationId]);

    const CompletionToast = () => (
        <AnimatePresence>
            {notification && (
                <motion.div
                    initial={{ opacity: 0, y: -20, x: 20 }}
                    animate={{ opacity: 1, y: 0, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => {
                        handleSelectConversation(notification.id);
                        setNotification(null);
                    }}
                    style={{
                        position: 'fixed',
                        top: 24,
                        right: 24,
                        zIndex: 9999,
                        width: 320,
                        backgroundColor: '#ffffff',
                        border: '1px solid #e8e6d9',
                        borderRadius: 16,
                        padding: '16px 20px',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                    }}
                >
                    <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: '#f0fdf4',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#10b981',
                        flexShrink: 0
                    }}>
                        <CheckCircleIcon width={24} height={24} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111111', marginBottom: 2 }}>Task Complete</div>
                        <div style={{ fontSize: 12, color: '#8a8886', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {notification.title} is ready
                        </div>
                    </div>
                    <div style={{ color: '#8a8886' }}>
                        <ChevronRightIcon width={16} height={16} />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    // ── Persistence ─────────────────────────────────────────────────────────────
    useEffect(() => {
        // Restore from session storage on mount
        const savedThought = sessionStorage.getItem('everfern_streaming_thought');
        const savedTools = sessionStorage.getItem('everfern_live_tool_calls');
        const savedLoading = sessionStorage.getItem('everfern_is_loading');

        if (savedThought) {
            setStreamingThought(savedThought);
            streamingThoughtRef.current = savedThought;
        }
        if (savedTools) {
            try {
                const tools = JSON.parse(savedTools);
                setLiveToolCalls(tools);
                liveToolCallsRef.current = tools;
            } catch (e) { console.error('Failed to restore live tool calls:', e); }
        }
        if (savedLoading === 'true') {
            // If it was loading when refreshed, we might need to reconnect
            // but for now we just show the restored state
            setIsLoading(true);
        }
    }, []);

    useEffect(() => {
        if (isLoading) {
            sessionStorage.setItem('everfern_streaming_thought', streamingThought);
            sessionStorage.setItem('everfern_live_tool_calls', JSON.stringify(liveToolCalls));
            sessionStorage.setItem('everfern_is_loading', 'true');
        } else {
            sessionStorage.removeItem('everfern_streaming_thought');
            sessionStorage.removeItem('everfern_live_tool_calls');
            sessionStorage.removeItem('everfern_is_loading');
        }
    }, [streamingThought, liveToolCalls, isLoading]);

    const assistantMessageIdRef = useRef<string | null>(null);

    const liveToolCallsRef = useRef<ToolCallDisplay[]>([]);
    const activeConversationIdRef = useRef<string | null>(null);
    const conversationSwitchSeqRef = useRef(0);
    const streamingToolCallsRef = useRef<LiveToolCall[]>([]);
    const streamingContentRef = useRef("");
    const pendingNarrativeRef = useRef<string>("");
    const streamingThoughtRef = useRef("");
    const toolCallMap = useRef<Map<string, string>>(new Map());
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const modelSelectorRef = useRef<HTMLDivElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const voiceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
    const hasReceivedUsageData = useRef(false);
    const isMessageCommittedRef = useRef(false);
    const isHandlingPlanRef = useRef(false);

    const applyLiveToolUpdate = useCallback((data: { toolName: string; toolCallId?: string; update: string }) => {
        const update = String(data.update || '').trim();
        if (!update) return;

        const key = data.toolCallId || `${data.toolName}_running`;
        let existingId = toolCallMap.current.get(key);
        if (!existingId && data.toolCallId) {
            existingId = data.toolCallId;
        }

        let index = existingId ? liveToolCallsRef.current.findIndex(tc => tc.id === existingId) : -1;
        if (index < 0) {
            for (let i = liveToolCallsRef.current.length - 1; i >= 0; i -= 1) {
                const tc = liveToolCallsRef.current[i];
                if (tc.toolName === data.toolName && tc.status === 'running') {
                    index = i;
                    break;
                }
            }
        }
        if (index < 0) return;

        const current = liveToolCallsRef.current[index];
        const nextLines = `${current.output || ''}\n${update}`
            .split(/\r?\n/)
            .map(line => line.trimEnd())
            .filter(Boolean)
            .slice(-24);
        const updated = [...liveToolCallsRef.current];
        updated[index] = {
            ...current,
            output: nextLines.join('\n'),
            description: update,
            data: {
                ...(current.data || {}),
                liveUpdate: update,
            },
        };
        liveToolCallsRef.current = updated;
        setLiveToolCalls(updated);
    }, []);

    const resetConversationUiState = (nextConversationId: string | null, options?: { clearInput?: boolean; clearAttachments?: boolean }) => {
        messagesRef.current = [];
        setMessages([]);
        activeConversationIdRef.current = nextConversationId;
        setActiveConversationId(nextConversationId);

        if (options?.clearInput) setInputValue("");
        if (options?.clearAttachments) setAttachments([]);

        setIsLoading(false);
        setStreamingContent("");
        setStreamingThought("");
        streamingContentRef.current = "";
        streamingThoughtRef.current = "";
        pendingNarrativeRef.current = "";

        liveToolCallsRef.current = [];
        setLiveToolCalls([]);
        setStreamingToolCalls([]);
        streamingToolCallsRef.current = [];
        toolCallMap.current.clear();
        subAgentProgressRef.current.clear();
        setSubAgentProgressVersion(0);

        assistantMessageIdRef.current = null;
        isMessageCommittedRef.current = false;
        isHandlingPlanRef.current = false;
        hasReceivedUsageData.current = false;
        missionTimelineRef.current = null;

        setCurrentPlan(null);
        setContextItems([]);
        setExecutionPlan(null);
        setIsExecutionPlanPaneOpen(false);
        setActivePlan(null);
        setCurrentSites([]);
        setCurrentPhase(undefined);
        setCurrentNode("");
        setMissionTimeline(null);
        setMissionComplete(false);
        setActivePlanSteps(null);
        setActivePlanTitle(null);
        setPanelTasks([]);
        setShowTasksPanel(false);
        setTasksFilePath(undefined);
        setInstructions("");
        setActiveUserQuestions([]);
        activeUserQuestionRef.current = false;
        setShowHitlApproval(false);
        setHitlRequest(null);
        setLocalExecutionRequest(null);
        setSelectedToolCall(null);
        setToolDetailTabs([]);
        setActiveToolDetailTabId(null);
        setIsToolDetailOpen(false);
        setIsComputerPaneOpen(false);
        setActiveComputerData(null);
        setShowSubagentPanel(false);
        setSelectedSubagentToolCall(null);
        setActiveSurface(null);
        subagent.reset();

        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('everfern_streaming_thought');
            sessionStorage.removeItem('everfern_live_tool_calls');
            sessionStorage.removeItem('everfern_is_loading');
        }
    };

    const isEmpty = messages.length === 0 && !isLoading && liveToolCalls.length === 0 && !streamingContent;
    const isProjectLocked = !isEmpty && folderContexts.length > 0 && projects.some(p => p.id === folderContexts[0].id || p.path === folderContexts[0].path);
    const [profileDisplayName, setProfileDisplayName] = useState<string>("");
    const displayName = (config?.userName || onboardingName || profileDisplayName || "User").toString();

    useEffect(() => {
        let mounted = true;
        const fetchDisplayName = async () => {
            try {
                let name = "";
                if ((window as any).electronAPI?.loadConfig) {
                    const res = await (window as any).electronAPI.loadConfig();
                    if (res.success && res.config?.provider === 'everfern' && res.config?.apiKey) {
                        try {
                            const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";
                            const userRes = await fetch(`${API_URL}/api/user/me`, {
                                headers: { Authorization: `Bearer ${res.config.apiKey}` }
                            });
                            if (userRes.ok) {
                                const userData = await userRes.json();
                                name = userData.displayName || userData.fullName || userData.name || '';
                                if (!name && userData.email) name = userData.email.split('@')[0];
                            }
                        } catch (e) {
                            console.error("Failed to fetch user from API", e);
                        }
                    }
                    if (!name && res.success && res.config?.userName) {
                        name = res.config.userName;
                    }
                }
                if (!name && (window as any).electronAPI?.system?.getUsername) {
                    name = await (window as any).electronAPI.system.getUsername();
                }
                if (mounted && name) {
                    setProfileDisplayName(name);
                }
            } catch {
                // Keep the existing greeting fallback.
            }
        };

        fetchDisplayName();
        const interval = setInterval(fetchDisplayName, 5000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (displayName) {
            const nameStr = displayName.charAt(0).toUpperCase() + displayName.slice(1);
            const msg = greetingMessages[Math.floor(Math.random() * greetingMessages.length)];
            setRandomGreeting(msg.replace("{name}", nameStr));
        } else {
            const msg = greetingMessages[Math.floor(Math.random() * greetingMessages.length)];
            setRandomGreeting(msg.replace(", {name}", ""));
        }
    }, [displayName]);

    // Update context tokens based on messages (fallback when no real usage data)
    useEffect(() => {
        if (messages.length === 0) {
            setContextTokens({ used: 0, max: 128000 });
            return;
        }

        // Skip if we've already received real usage data from the API
        if (hasReceivedUsageData.current) {
            return;
        }

        // Rough token estimation: ~4 chars per token
        const estimateTokens = (text: string) => Math.ceil(text.length / 4);

        let totalChars = 0;
        for (const msg of messages) {
            if (msg.content) {
                totalChars += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
            }
            if (msg.thought) {
                totalChars += estimateTokens(msg.thought);
            }
            if (msg.toolCalls) {
                for (const tc of msg.toolCalls) {
                    totalChars += estimateTokens(JSON.stringify(tc.args || {}));
                    if (tc.output) {
                        totalChars += estimateTokens(tc.output);
                    }
                }
            }
        }

        // Add input value to estimate
        const inputChars = estimateTokens(inputValue);
        totalChars += inputChars;

        // Add overhead for message format (~10% overhead)
        const totalTokens = Math.ceil(totalChars * 1.1);

        setContextTokens({ used: totalTokens, max: 128000 });
    }, [messages, inputValue]);



    useEffect(() => {
        const loadInitialData = async () => {
            if ((window as any).electronAPI?.loadConfig) {
                const res = await (window as any).electronAPI.loadConfig();
                if (res.success && res.config) {
                    setConfig(res.config);
                    if (res.config.model) setSelectedModel(res.config.model);
                    if (res.config.motionBlur !== undefined) setSettingsMotionBlur(res.config.motionBlur);
                    if (res.config.voice) {
                        setVoiceProvider(res.config.voice.provider || null);
                        setVoiceDeepgramKey(res.config.voice.deepgramKey || "");
                        setVoiceElevenlabsKey(res.config.voice.elevenlabsKey || "");
                    }
                    if (res.config.embedding) {
                        setEmbeddingProvider(res.config.embedding.provider || "everfern");
                        setEmbeddingModel(res.config.embedding.model || "qwen/qwen3-embedding-8b");
                        setEmbeddingApiKey(res.config.embedding.apiKey || "");
                    }
                    if (!res.config.userName) setShowOnboarding(true);
                } else {
                    setShowOnboarding(true);
                }

                // Auto-restore dispatch session in the background
                try {
                    if ((window as any).electronAPI?.supabase?.getSession) {
                        const { session } = await (window as any).electronAPI.supabase.getSession();
                        if (session) {
                            const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://api.everfern.app';
                            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'default_key';
                            await (window as any).electronAPI?.system?.restoreDispatch?.({
                                url,
                                apiUrl: 'https://api.everfern.app',
                                key,
                                token: session.accessToken,
                                userId: session.user?.id || session.user?.sub || session.user?.user_id || 'unknown'
                            });
                        }
                    }
                } catch (e) {
                    console.error("Auto-restore dispatch failed", e);
                }
            }
        };
        loadInitialData();
    }, []);

    const fetchModels = useCallback(async () => {
        if ((window as any).electronAPI?.acp?.listModels) {
            const res = await (window as any).electronAPI.acp.listModels();
            if (res.success && res.models) {
                const formatted = res.models.map((m: any) => ({
                    id: m.id, name: m.name, provider: m.provider, providerType: m.providerType,
                    logo: (m.providerType === 'ollama' || m.providerType === 'local') ? OllamaLogo : m.providerType === 'openai' ? OpenAILogo : m.providerType === 'anthropic' ? AnthropicLogo : m.providerType === 'deepseek' ? DeepSeekLogo : m.providerType === 'nvidia' ? NvidiaLogo : m.providerType === 'openrouter' ? OpenRouterLogo : (m.providerType === 'gemini' || m.providerType === 'google') ? GeminiLogo : m.providerType === 'lmstudio' ? LMStudioLogo : m.providerType === 'minimax' ? MiniMaxLogo : m.providerType === 'everfern' ? EverFernBglessLogo : null
                }));
                const finalModels = (formatted.length > 0 ? formatted : [
                    { id: "mistralai/mistral-medium-3.5-128b", name: "Mistral Medium 3.5 (EverFern Cloud)", provider: "EverFern", providerType: "everfern", logo: EverFernBglessLogo },
                    { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", providerType: "openai", logo: OpenAILogo },
                    { id: "openrouter/free", name: "OpenRouter Free", provider: "OpenRouter", providerType: "openrouter", logo: OpenRouterLogo },
                    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", providerType: "anthropic", logo: AnthropicLogo },
                    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "Google Gemini", providerType: "gemini", logo: GeminiLogo },
                    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google Gemini", providerType: "gemini", logo: GeminiLogo },
                    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT", provider: "NVIDIA NIM", providerType: "nvidia", logo: NvidiaLogo },
                    { id: "nvidia/llama-nemotron-32b-instruct", name: "Nemotron 32B", provider: "NVIDIA NIM", providerType: "nvidia", logo: NvidiaLogo },
                    { id: "mistralai/mistral-nemo-12b-instruct", name: "Mistral Nemo 12B", provider: "NVIDIA NIM", providerType: "nvidia", logo: NvidiaLogo },
                ]).filter((m: any) => m.id !== 'qwen3-vl:2b');
                setAvailableModels(finalModels);
                setSelectedModel(prev => {
                    const validIds = finalModels.filter((m: ModelOption) => !m.id.endsWith('-error') && !m.id.endsWith('-empty')).map((m: ModelOption) => m.id);
                    if (!validIds.includes(prev)) return validIds[0] ?? prev;
                    return prev;
                });
            }
        }
    }, [config]);

    useEffect(() => { if (config) fetchModels(); }, [config, fetchModels]);

    // Fetch model info from EverFern Cloud API
    const fetchModelInfo = useCallback(async (modelId: string) => {
        try {
            console.log('[ModelInfo] 📡 Starting fetch for model:', modelId);

            // Extract model search query from full ID
            // e.g., "minimax/minimax-m3" → "minimax-m3"
            // e.g., "minimax/minimax-m2.7" → "minimax-m2.7"
            const parts = modelId.split('/');
            const modelPart = parts[parts.length - 1];

            // For MiniMax models, keep the full name (minimax-m3, minimax-m2.7, etc.)
            // For other models, remove size suffix like -7b, -70b
            const searchQuery = modelPart.includes('minimax')
                ? modelPart
                : modelPart.replace(/-\d+b$/i, '');

            console.log('[ModelInfo] Search query:', searchQuery);

            const apiUrl = `https://api.everfern.app/public/info/model?q=${encodeURIComponent(searchQuery)}`;
            console.log('[ModelInfo] Fetching from:', apiUrl);

            const response = await fetch(apiUrl);
            console.log('[ModelInfo] 📡 Fetch response received. Status:', response.status);

            if (!response.ok) {
                console.warn('[ModelInfo] ❌ Failed to fetch model info. Status:', response.status, response.statusText);
                console.warn('[ModelInfo] Using fallback values (128k context)');
                setModelInfo({
                    contextLength: 128000,
                    maxCompletionTokens: 4096,
                    promptPricing: 0,
                    completionPricing: 0
                });
                return;
            }

            const data = await response.json();
            console.log('[ModelInfo] 📡 API response data:', data);

            if (data.matches && data.matches.length > 0) {
                const model = data.matches[0];
                console.log('[ModelInfo] ✅ Found model match:', {
                    id: model.id,
                    name: model.name,
                    context_length: model.context_length,
                    max_completion_tokens: model.max_completion_tokens,
                    pricing: model.pricing
                });

                const newModelInfo = {
                    contextLength: model.context_length || 128000,
                    maxCompletionTokens: model.max_completion_tokens,
                    promptPricing: parseFloat(model.pricing.prompt) || 0,
                    completionPricing: parseFloat(model.pricing.completion) || 0
                };

                console.log('[ModelInfo] 🔄 About to set modelInfo to:', newModelInfo);
                setModelInfo(newModelInfo);
                console.log('[ModelInfo] ✅ setModelInfo() called successfully');
            } else {
                console.warn('[ModelInfo] ❌ No matches found for query:', searchQuery);
                console.warn('[ModelInfo] Using fallback values (128k context)');
                // Fallback to default values if no match
                const fallbackInfo = {
                    contextLength: 128000,
                    maxCompletionTokens: 4096,
                    promptPricing: 0,
                    completionPricing: 0
                };
                console.log('[ModelInfo] 🔄 About to set fallback modelInfo to:', fallbackInfo);
                setModelInfo(fallbackInfo);
            }
        } catch (error) {
            console.error('[ModelInfo] 💥 Error fetching model info:', error);
            console.error('[ModelInfo] Error details:', error instanceof Error ? error.message : String(error));
            // Fallback to default values
            setModelInfo({
                contextLength: 128000,
                maxCompletionTokens: 4096,
                promptPricing: 0,
                completionPricing: 0
            });
        }
    }, []);

    // Fetch model info when selected model changes
    useEffect(() => {
        if (selectedModel) {
            console.log('[ModelInfo] Effect: selectedModel changed to:', selectedModel);
            // For local models (fern-1, ollama*, lmstudio*), use fallback
            if (selectedModel === 'fern-1' || selectedModel.includes('ollama') || selectedModel.includes('lmstudio')) {
                console.log('[ModelInfo] Local model detected, skipping API fetch');
                setModelInfo({
                    contextLength: 128000,
                    maxCompletionTokens: 4096,
                    promptPricing: 0,
                    completionPricing: 0
                });
            } else {
                console.log('[ModelInfo] Cloud model detected, fetching from API');
                fetchModelInfo(selectedModel);
            }
        }
    }, [selectedModel, fetchModelInfo]);

    // Debug effect: log modelInfo whenever it changes
    useEffect(() => {
        console.log('[ModelInfo] ✓ modelInfo state updated:', JSON.stringify(modelInfo, null, 2));
    }, [modelInfo]);

    // Estimate token count (rough approximation: 1 token ≈ 4 characters)
    const estimateTokens = (text: string): number => {
        return Math.ceil(text.length / 4);
    };

    // Calculate current input tokens
    const currentTokens = useMemo(() => {
        return estimateTokens(inputValue);
    }, [inputValue]);

    // Calculate estimated cost
    const estimatedCost = useMemo(() => {
        if (!modelInfo || (modelInfo.promptPricing === 0 && modelInfo.completionPricing === 0)) {
            return null;
        }

        const inputTokens = currentTokens;
        const promptCost = inputTokens * modelInfo.promptPricing;

        // Estimate completion tokens (average response length)
        const estimatedCompletionTokens = Math.min(
            1000, // average response length
            modelInfo.maxCompletionTokens || 4096
        );
        const completionCost = estimatedCompletionTokens * modelInfo.completionPricing;

        return promptCost + completionCost;
    }, [currentTokens, modelInfo]);

    useEffect(() => { if (config) fetchModels(); }, [config, fetchModels]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (showModelSelector && config) { fetchModels(); interval = setInterval(fetchModels, 3000); }
        return () => { if (interval) clearInterval(interval); };
    }, [showModelSelector, config, fetchModels]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => { if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) setShowModelSelector(false); };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 300)}px`;
    }, [inputValue]);

    useEffect(() => {
        if (!isScrolledUp) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, streamingContent, liveToolCalls, streamingThought]);

    useEffect(() => {
        const el = chatScrollRef.current;
        if (!el) return;
        const handleScroll = () => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setIsScrolledUp(distFromBottom > 160);
        };
        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToBottom = () => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    };

    // Debug: Log when activeUserQuestions changes
    useEffect(() => {
        console.log('[Frontend] activeUserQuestions changed:', activeUserQuestions);
        console.log('[Frontend] activeUserQuestions.length:', activeUserQuestions.length);
        if (activeUserQuestions.length > 0) {
            console.log('[Frontend] ✅ Approval form should be visible now');
            console.log('[Frontend] First question:', activeUserQuestions[0]);
        } else {
            console.log('[Frontend] ⚠️ No active questions - form will not show');
        }
    }, [activeUserQuestions]);

    useEffect(() => {
        if (showSettings && config) {
            setSettingsEngine(config.engine || "everfern");
            setSettingsProvider(config.provider || null);
            setSettingsApiKey(config.keys?.[config.provider || ""] || config.apiKey || "");
            setSettingsCustomModel(config.customModel || "z-ai/glm5");
            setModelValidationStatus("none");
            setSettingsShowuiUrl(config.showuiUrl || "http://127.0.0.1:7860");
            const loadedVlmProvider = config.vlm?.engine === "cloud" ? (config.vlm.provider || "ollama") : "ollama";
            const defaultLoadedVlmModel =
                loadedVlmProvider === "everfern" ? "fern-1" :
                loadedVlmProvider === "openrouter" ? "qwen/qwen3-vl-235b-a22b-instruct" :
                loadedVlmProvider === "minimax" ? "MiniMax-M3" :
                loadedVlmProvider === "openai" ? "gpt-5.5" :
                loadedVlmProvider === "anthropic" ? "claude-opus-4.6" :
                "qwen3-vl:235b-cloud";
            const defaultLoadedVlmUrl =
                loadedVlmProvider === "minimax" ? "https://api.minimax.io/v1" :
                loadedVlmProvider === "openai" ? "https://api.openai.com/v1" :
                loadedVlmProvider === "anthropic" ? "https://api.anthropic.com" :
                loadedVlmProvider === "nvidia" ? "https://integrate.api.nvidia.com/v1" :
                loadedVlmProvider === "ollama" ? "https://ollama.com" :
                "";
            const loadedVlmUrl = config.vlm?.baseUrl || defaultLoadedVlmUrl;
            setSettingsVlmMode(config.vlm?.engine === "cloud" ? "cloud" : "local");
            setSettingsVlmCloudProvider(loadedVlmProvider);
            setSettingsVlmCloudModel(config.vlm?.engine === "cloud" ? (config.vlm.model || defaultLoadedVlmModel) : "qwen3-vl:235b-cloud");
            setSettingsVlmCloudUrl(config.vlm?.engine === "cloud" ? (loadedVlmProvider === "minimax" && loadedVlmUrl.includes("ollama.com") ? defaultLoadedVlmUrl : loadedVlmUrl) : "https://ollama.com");
            setSettingsVlmCloudKey(config.vlm?.engine === "cloud" ? (config.keys?.[`vlm-${config.vlm.provider || 'ollama'}`] || config.vlm.apiKey || "") : "");
        }
    }, [showSettings]);

    useEffect(() => {
        if (settingsProvider && config) setSettingsApiKey(config.keys?.[settingsProvider] || "");
    }, [settingsProvider, config]);

    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
            if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(track => track.stop());
            if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
        };
    }, []);

    // JSON Viewer keyboard shortcut (Ctrl+Shift+J)
    useEffect(() => {
        const handleKeyDown = (e: Event) => {
            const ke = e as unknown as KeyboardEvent<HTMLDivElement>;
            if ((ke.metaKey || ke.ctrlKey) && ke.shiftKey && ke.key === "J") {
                ke.preventDefault();
                handleShowJsonViewer();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Listen for acp:show-json-viewer event from main process
    useEffect(() => {
        const handleShowJsonViewerEvent = async () => {
            handleShowJsonViewer();
        };
        window.addEventListener("acp:show-json-viewer", handleShowJsonViewerEvent as EventListener);
        return () => window.removeEventListener("acp:show-json-viewer", handleShowJsonViewerEvent as EventListener);
    }, []);

    // Register HITL listener at mount so events are never missed regardless of timing
    useEffect(() => {
        const acpApi = (window as any).electronAPI?.acp;
        if (!acpApi?.onHitlRequest) return;

        acpApi.onHitlRequest((request: any) => {
            console.log('[HITL] ✅ Approval request received in frontend (mount listener):', request);
            // Set flag FIRST before any async state updates to prevent mission_complete race
            (window as any).__activeHitl = true;
            setHitlRequest(request);
            setShowHitlApproval(true);
            setCurrentNode('hitl_approval');
        });

        return () => {
            acpApi.removeHitlRequestListener?.();
        };
    }, []);

    // ── Persistent Mission Timeline Listeners ─────────────────────────────────
    // These are registered ONCE at component mount and are never removed by
    // removeStreamListeners(), so they survive the per-message stream cleanup cycle.
    useEffect(() => {
        const acpApi = (window as any).electronAPI?.acp;
        if (!acpApi) return;

        acpApi.onMissionStepUpdate(({ step, timeline }: { step: any; timeline: MissionTimelineType }) => {
            console.log('[Mission] Step update received (persistent):', step?.name, step?.status);
            setMissionTimeline(timeline);
            missionTimelineRef.current = timeline;
            setIsExecutionPlanPaneOpen(false);
            if (step?.name) {
                setCurrentNode(step.name);
            }
        });

        acpApi.onMissionPhaseChange(({ phase, timeline }: { phase: string; timeline: MissionTimelineType }) => {
            console.log('[Mission] Phase change received (persistent):', phase);
            setMissionTimeline(timeline);
            missionTimelineRef.current = timeline;
            setIsExecutionPlanPaneOpen(false);
            setCurrentPhase(phase as any);
        });

        acpApi.onMissionComplete(({ thinkingDuration, title }: { timeline?: any; steps?: any[]; thinkingDuration?: { startTime: number; endTime?: number; duration?: number }; title?: string }) => {
            console.log('[Mission] Mission complete received (persistent)');

            // CRITICAL: Check __activeHitl flag BEFORE processing mission_complete
            const hasActiveHitl = (window as any).__activeHitl || showHitlApproval;
            const hasActiveUserQuestion = activeUserQuestionRef.current || activeUserQuestions.length > 0;

            if (hasActiveHitl || hasActiveUserQuestion) {
                console.log(`[Frontend] ⏸️ Mission complete received but ${hasActiveHitl ? 'HITL' : 'user question'} is active - committing message and deferring completion`);
                if (!isMessageCommittedRef.current) {
                    isMessageCommittedRef.current = true;
                    const finalContent = streamingContentRef.current || "";
                    const finalThought = streamingThoughtRef.current;
                    const finalToolCalls = persistableToolCalls(
                        liveToolCallsRef.current,
                        t => t.status === 'running' ? 'done' : undefined
                    );
                    const durationMs = thinkingDuration?.duration;
                        if (finalContent || finalThought || finalToolCalls.length > 0 || missionTimelineRef.current) {
                        const assistantMsg: Message = {
                            id: assistantMessageIdRef.current || crypto.randomUUID(),
                            role: "assistant",
                            content: finalContent,
                            thought: finalThought,
                            reasoning_content: streamingThoughtRef.current,
                            thinkingDuration: durationMs,
                            timestamp: new Date(),
                            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                            generatedTitle: title,
                            missionTimeline: missionTimelineRef.current,
                        };
                        setLiveToolCalls([]);
                        setStreamingToolCalls([]);
                        streamingToolCallsRef.current = [];
                        setMessages(prev => {
                            const existingIdx = prev.findIndex(m => m.id === assistantMsg.id);
                            if (existingIdx >= 0) {
                                const final = [...prev];
                                final[existingIdx] = assistantMsg;
                                saveConversation(final);
                                return final;
                            }
                            const final = [...prev, assistantMsg];
                            saveConversation(final);
                            return final;
                        });
                    }
                }
                setIsLoading(false);
                return;
            }

            setMissionComplete(true);

            // Flush any in-flight stream chunks before committing the final message
            setTimeout(() => {
                if (isMessageCommittedRef.current) return;
                isMessageCommittedRef.current = true;

                const finalContent = streamingContentRef.current || "";
                const finalThought = streamingThoughtRef.current;
                const finalToolCalls = persistableToolCalls(
                    liveToolCallsRef.current,
                    t => t.status === 'running' ? 'done' : undefined
                );
                const durationMs = thinkingDuration?.duration;

                const hasActiveUserQuestionNow = activeUserQuestionRef.current || activeUserQuestions.length > 0;
                const hasActiveHitlNow = (window as any).__activeHitl || showHitlApproval;

                if (hasActiveUserQuestionNow || hasActiveHitlNow) {
                    console.log(`[Frontend] ⏸️ ${hasActiveHitlNow ? 'HITL' : 'User question'} detected - committing accumulated content before pausing`);
                    setIsLoading(false);
                    const hasAnything = finalContent || finalThought || finalToolCalls.length > 0;
                    if (hasAnything) {
                        const assistantMsg: Message = {
                            id: assistantMessageIdRef.current || crypto.randomUUID(),
                            role: "assistant",
                            content: finalContent,
                            thought: finalThought,
                            reasoning_content: streamingThoughtRef.current,
                            thinkingDuration: durationMs,
                            timestamp: new Date(),
                            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                            generatedTitle: title,
                            missionTimeline: missionTimelineRef.current,
                        };
                        setLiveToolCalls([]);
                        setStreamingToolCalls([]);
                        streamingToolCallsRef.current = [];
                        setMessages(prev => {
                            const existingIdx = prev.findIndex(m => m.id === assistantMsg.id);
                            if (existingIdx >= 0) {
                                const final = [...prev];
                                final[existingIdx] = assistantMsg;
                                saveConversation(final);
                                return final;
                            }
                            const final = [...prev, assistantMsg];
                            saveConversation(final);
                            return final;
                        });
                    }
                    return;
                }

                    if (finalContent || finalThought || finalToolCalls.length > 0 || missionTimelineRef.current) {
                    const assistantMsg: Message = {
                        id: assistantMessageIdRef.current || crypto.randomUUID(),
                        role: "assistant",
                        content: finalContent,
                        thought: finalThought,
                        reasoning_content: streamingThoughtRef.current,
                        thinkingDuration: durationMs,
                        timestamp: new Date(),
                        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                        generatedTitle: title,
                        missionTimeline: missionTimelineRef.current,
                    };
                    setStreamingContent("");
                    setStreamingThought("");
                    setLiveToolCalls([]);
                    setStreamingToolCalls([]);
                    streamingToolCallsRef.current = [];
                    setIsLoading(false);
                    setMessages(prev => {
                        const existingIdx = prev.findIndex(m => m.id === assistantMsg.id);
                        if (existingIdx >= 0) {
                            const final = [...prev];
                            final[existingIdx] = assistantMsg;
                            saveConversation(final);
                            return final;
                        }
                        const final = [...prev, assistantMsg];
                        saveConversation(final);
                        return final;
                    });
                } else {
                    setStreamingContent("");
                    setStreamingThought("");
                    setLiveToolCalls([]);
                    setStreamingToolCalls([]);
                    streamingToolCallsRef.current = [];
                    setIsLoading(false);
                }
            }, 150); // flush pending IPC chunk events + allow onToolCall to fire first
        });

        // Plan created listener is also persistent
        if (acpApi.onPlanCreated) {
            acpApi.onPlanCreated(({ plan }: { plan: any }) => {
                if (plan?.steps) {
                    setActivePlanSteps(plan.steps);
                    setActivePlanTitle(plan.title || null);
                }
            });
        }

        return () => {
            acpApi.removeMissionListeners?.();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cleanup sub-agent progress state and listener on unmount
    useEffect(() => {
        return () => {
            // Clear sub-agent progress state on unmount
            subAgentProgressRef.current.clear();
            setSubAgentProgressVersion(0);
            // Listener cleanup is handled by removeStreamListeners() which is called
            // at the start of each handleSend and after mission complete
        };
    }, []);

    const handleShowJsonViewer = async () => {
        try {
            // Try to get full chat history first, fall back to last event
            const chatHistory = await (window as any).electronAPI?.debug?.getChatHistory();
            if (chatHistory) {
                setLastEventJson(JSON.stringify(chatHistory, null, 2));
                setLastEventType(chatHistory.type || "chat_history");
                setIsJsonViewerOpen(true);
            } else {
                const lastEvent = await (window as any).electronAPI?.debug?.getLastEvent();
                if (lastEvent) {
                    setLastEventJson(JSON.stringify(lastEvent, null, 2));
                    setLastEventType(lastEvent.type || "unknown");
                    setIsJsonViewerOpen(true);
                }
            }
        } catch (err) {
            console.error("Failed to get JSON:", err);
        }
    };

    const handleAttachment = async (type?: 'image' | 'document') => {
        console.log('[handleAttachment] Called with type:', type);

        if (!(window as any).electronAPI?.system?.openFilePicker) {
            console.error('[handleAttachment] openFilePicker API not available');
            alert('File picker is not available. Please restart the application.');
            return;
        }

        try {
            let options: any = {};
            if (type === 'image') {
                options = { filters: [{ name: 'Images', extensions: ['jpg', 'png', 'webp', 'gif', 'jpeg'] }] };
            } else if (type === 'document') {
                options = { filters: [{ name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'csv', 'docx'] }] };
            }

            console.log('[handleAttachment] Opening file picker with options:', options);
            const file = await (window as any).electronAPI?.system.openFilePicker(options);
            console.log('[handleAttachment] File picker result:', file);

            if (!file) {
                console.log('[handleAttachment] File picker returned null - user may have cancelled');
                return;
            }

            if (file.canceled) {
                console.log('[handleAttachment] User cancelled file selection');
                return;
            }

            if (!file.success) {
                console.error('[handleAttachment] File picker failed:', file.error);
                alert(`Failed to select file: ${file.error || 'Unknown error'}`);
                return;
            }

            if (file.success && file.path) {
                const newAttachment: FileAttachment = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size || 0,
                    mimeType: file.mimeType || 'application/octet-stream',
                    base64: file.base64,
                    content: file.content,
                    path: file.path
                };
                console.log('[handleAttachment] Adding attachment:', newAttachment.name);
                setAttachments(prev => [...prev, newAttachment]);
            } else {
                console.warn('[handleAttachment] File picker returned unexpected result:', file);
            }
        } catch (error) {
            console.error('[handleAttachment] Error:', error);
            alert(`Failed to attach file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    // Removed handleAddContextFolder

    const checkForPlan = useCallback(async (chatId: string) => {
        const api = (window as any).electronAPI;
        if (!api?.plans?.read) return;
        try {
            const planContent = await api.plans.read(chatId, 'execution_plan.md');
            if (activeConversationIdRef.current !== chatId) return;
            if (planContent) setActivePlan({ content: planContent, chatId });
            else setActivePlan(null);
        } catch (e) { console.error("Failed to check for plan", e); }
    }, []);

    const checkForSites = useCallback(async (chatId: string) => {
        const api = (window as any).electronAPI;
        if (!api?.sites?.list) return;
        try {
            const results = await api.sites.list(chatId);
            if (activeConversationIdRef.current !== chatId) return;
            // Filter sites to only include those belonging to the current chat
            const chatSites = (results || []).filter((s: any) => s.chatId === chatId);
            setCurrentSites(chatSites);
        }
        catch (e) { console.error("Failed to check for sites:", e); }
    }, []);

    const handleApprovePlan = useCallback(async (content: string) => {
        if (!activeConversationId) return;
        const api = (window as any).electronAPI;
        setActivePlan(null);
        setIsExecutionPlanPaneOpen(false);
        try { await api.plans.delete(activeConversationId, 'execution_plan.md'); } catch (e) { console.error("Failed to delete plan", e); }
        const approvalMsg = `[PLAN_APPROVED]\nI have reviewed and approved your execution plan. Please proceed with the execution as planned.`;

        // Clear ANY previous pending message that might be duplicated
        // Filter out any assistant messages that were part of pending execution plan flow
        const cleanMessages = messages.filter(m => {
            if (m.role !== 'assistant') return true;
            const content = typeof m.content === 'string' ? m.content : '';
            return !content.includes('[PLAN_APPROVED]') && !content.includes('execution plan');
        });

        // Create a user message
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: approvalMsg,
            timestamp: new Date(),
        };

        // Add only clean messages + new approval message
        const newMessages = [...cleanMessages, userMsg];
        setMessages(newMessages);
        setIsLoading(true);
        setLiveToolCalls([]);
        setStreamingToolCalls([]);
        streamingToolCallsRef.current = [];
        setStreamingContent("");
        setStreamingThought("");
        setMissionTimeline(null);
        setMissionComplete(false);
        setCurrentNode("");

        // Clear any active user question when starting a new request
        setActiveUserQuestions([]);
        setMemoryPreferenceBanner(null);
        setCurrentNode("");
        setActivePlanSteps(null);
        setActivePlanTitle(null);
        setMissionTimeline(null);
        setMissionComplete(false);
        hasReceivedUsageData.current = false;
        isMessageCommittedRef.current = false;
        isHandlingPlanRef.current = false;
        streamingContentRef.current = "";
        pendingNarrativeRef.current = "";
        streamingThoughtRef.current = "";

        const currentM = availableModels.find(m => m.id === selectedModel) || availableModels[0];

        (async () => {
            const acpApi = (window as any).electronAPI?.acp;
            if (!acpApi?.stream) return;

            acpApi.removeStreamListeners();
            // Clear sub-agent progress state when starting a new message
            setSubAgentProgressVersion(0);
            acpApi.onAgentPermissionRequest(() => {
                const soundUrl = acpApi?.getPermissionSoundUrl?.();
                if (soundUrl) {
                    try {
                        const audio = new Audio(soundUrl);
                        audio.volume = 0.7;
                        audio.play().catch(e => console.log('[Audio] Could not play permission sound:', e));
                    } catch (e) { console.log('[Audio] Error:', e); }
                }
                setShowPermissionModal(true);
            });
            acpApi.onToolStart(({ toolName, toolArgs, toolCallId }: { toolName: string; toolArgs: Record<string, unknown>; toolCallId?: string }) => {
                if (toolName === 'ask_user_question') {
                    console.log('[Frontend] Received ask_user_question tool_start:', JSON.stringify({ toolName, toolArgs }, null, 2));
                }

                // ask_user_question and approve_actions are handled exclusively by the
                // handleSend-registered onToolStart handler. Processing them here too
                // would add duplicate running pills and double-set the flag.
                if (toolName === 'ask_user_question' || toolName === 'approve_actions') {
                    return;
                }

                // Consume the pending narrative once — clear immediately so subsequent
                // tool calls in the same burst don't inherit the same caption.
                const narrativeText = streamingContentRef.current.trim();
                if (narrativeText) {
                    streamingContentRef.current = '';
                    setStreamingContent('');
                }

                const display = resolveToolDisplay(toolName, toolArgs);

                const placeholder = liveToolCallsRef.current.find(t =>
                    t.id.startsWith('streaming-') && t.toolName === toolName
                );
                const inheritedOrderIndex = placeholder ? placeholder.orderIndex : liveToolCallsRef.current.length;
                const inheritedSubAgentProgress = placeholder?.subAgentProgress || subAgentProgress.get(toolCallId || '') || [];

                const newTc: ToolCallDisplay = {
                    id: toolCallId || crypto.randomUUID(),
                    toolName,
                    ...display,
                    status: 'running',
                    args: toolArgs,
                    description: narrativeText || undefined,
                    orderIndex: inheritedOrderIndex,
                    subAgentProgress: inheritedSubAgentProgress,
                    displayName: 'Fern'
                };

                const filtered = liveToolCallsRef.current.filter(t =>
                    !(t.id.startsWith('streaming-') && t.toolName === toolName)
                );

                const mapKey = toolCallId || (toolName + '_running');
                toolCallMap.current.set(mapKey, newTc.id);
                liveToolCallsRef.current = [...filtered, newTc];
                setLiveToolCalls([...liveToolCallsRef.current]);
                maybeOpenUserUrlTool(newTc);
            });
            acpApi.onToolUpdate?.(applyLiveToolUpdate);
            acpApi.onSubAgentProgress?.((event: SubAgentProgressEvent) => {
                // Write directly to ref — NO state update, NO re-render
                const map = subAgentProgressRef.current;
                if (map.size >= 10 && !map.has(event.toolCallId)) {
                    const firstKey = map.keys().next().value;
                    if (firstKey) map.delete(firstKey);
                }
                const existing = map.get(event.toolCallId) || [];
                map.set(event.toolCallId, [...existing, event].slice(-100));

                // Only trigger a React re-render if the detail panel is currently open
                if (isToolDetailOpen) {
                    setSubAgentProgressVersion(v => v + 1);
                }

                // Only update liveToolCalls state if this event actually matches a live tc
                const matchIdx = liveToolCallsRef.current.findIndex(tc => tc.id === event.toolCallId);
                if (matchIdx !== -1) {
                    const updated = liveToolCallsRef.current.map(tc => {
                        if (tc.id === event.toolCallId) {
                            const currentEvents = tc.subAgentProgress || [];
                            return {
                                ...tc,
                                subAgentProgress: [...currentEvents, event].slice(-100)
                            };
                        }
                        return tc;
                    });
                    liveToolCallsRef.current = updated;
                    setLiveToolCalls(updated);
                }
            });
            acpApi.onToolCall((record: any) => {
                // Debug: Log the tool call structure
                if (record.toolName === 'ask_user_question') {
                    console.log('[Frontend] 📥 Received ask_user_question tool call');
                }

                // ask_user_question and approve_actions are handled exclusively by the
                // handleSend-registered onToolCall handler (which has the early-return path).
                // Processing them here too would call setActiveUserQuestions twice, causing
                // the HITL form to appear/flash twice.
                if (record.toolName === 'ask_user_question' || record.toolName === 'approve_actions') {
                    return;
                }

                const key = record.id || record.toolCallId || (record.toolName + '_running');
                let existingId = toolCallMap.current.get(key);
                if (!existingId) {
                    const runningTc = liveToolCallsRef.current.find(t => t.toolName === record.toolName && t.status === 'running');
                    if (runningTc) {
                        existingId = runningTc.id;
                    }
                }
                const existingIdx = existingId ? liveToolCallsRef.current.findIndex(t => t.id === existingId) : -1;
                if (existingIdx >= 0) {
                    const updated = [...liveToolCallsRef.current];
                    updated[existingIdx] = persistableToolCall({
                        ...updated[existingIdx],
                        status: 'done' as const,
                        output: typeof record.result === 'string'
                            ? record.result
                            : (record.result?.output || JSON.stringify({ ...record.result, base64Image: undefined }, null, 2)),
                        data: record.result?.data,
                        base64Image: record.result?.base64Image,
                        durationMs: record.durationMs
                    }, existingIdx);
                    liveToolCallsRef.current = updated;
                    setLiveToolCalls(updated);
                    if (record.toolName === 'show_user_url') {
                        openToolDetailTab(mapToolCallForDetail(updated[existingIdx]));
                    }

                    // Detect preference/choice memories from memory_search results using structured data
                    if (record.toolName === 'memory_search' && record.result?.data?.hasPreference) {
                        const data = record.result.data;
                        setMemoryPreferenceBanner({
                            preference: data.preferenceText || '',
                            rawMemory: record.result.output || '',
                            dismissed: false
                        });
                    }
                }
            });
            acpApi.onThought(({ content }: { content: string }) => {
                // Filter out fun startup messages and keep only actual thoughts
                if (!['🎬 Let\'s do this!'].includes(content)) {
                    streamingThoughtRef.current += content;
                    setStreamingThought(streamingThoughtRef.current);
                }
            });
            acpApi.onUsage(({ totalTokens, promptTokens, completionTokens }: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
                // Calculate pricing using model info if available
                if (modelInfo) {
                    const promptCost = (promptTokens || 0) * modelInfo.promptPricing;
                    const completionCost = (completionTokens || 0) * modelInfo.completionPricing;
                    const totalCost = promptCost + completionCost;

                    console.log(`[Pricing] Prompt Cost: $${promptCost.toFixed(6)}, Completion Cost: $${completionCost.toFixed(6)}, Total Cost: $${totalCost.toFixed(6)}`);
                    console.log(`[Pricing] Model: ${selectedModel}, Rates: Prompt $${modelInfo.promptPricing.toExponential()} / token, Completion $${modelInfo.completionPricing.toExponential()} / token`);
                }

                hasReceivedUsageData.current = true;
                setContextTokens({ used: totalTokens, max: 128000 });
            });
            acpApi.onSurfaceAction((data: any) => {
                if (data.action === 'create' || data.action === 'update') {
                    setActiveSurface({ surfaceId: data.surfaceId, catalogId: data.catalogId, components: data.components });
                } else if (data.action === 'delete') {
                    setActiveSurface(null);
                }
            });

            acpApi.onStreamChunk(({ delta, done }: { delta: string; done: boolean }) => {
                if (isMessageCommittedRef.current) return;
                if (!done) {
                    if (delta) {
                        streamingContentRef.current += delta;
                        setStreamingContent(streamingContentRef.current);

                        // Update create_artifact tool with streaming content
                        const artifactToolIdx = liveToolCallsRef.current.findIndex(
                            t => t.toolName === 'create_artifact' && t.status === 'running'
                        );
                        if (artifactToolIdx !== -1) {
                            const updated = [...liveToolCallsRef.current];
                            updated[artifactToolIdx] = {
                                ...updated[artifactToolIdx],
                                args: {
                                    ...updated[artifactToolIdx].args,
                                    content: streamingContentRef.current
                                }
                            };
                            liveToolCallsRef.current = updated;
                            setLiveToolCalls(updated);
                        }
                    }
                } else {
                    // Don't mark as done yet - wait for mission_complete event
                    if (delta) {
                        streamingContentRef.current += delta;
                        setStreamingContent(streamingContentRef.current);

                        // Update create_artifact tool with final streaming content
                        const artifactToolIdx = liveToolCallsRef.current.findIndex(
                            t => t.toolName === 'create_artifact' && t.status === 'running'
                        );
                        if (artifactToolIdx !== -1) {
                            const updated = [...liveToolCallsRef.current];
                            updated[artifactToolIdx] = {
                                ...updated[artifactToolIdx],
                                args: {
                                    ...updated[artifactToolIdx].args,
                                    content: streamingContentRef.current
                                }
                            };
                            liveToolCallsRef.current = updated;
                            setLiveToolCalls(updated);
                        }
                    }
                }
            });

            // Mission listeners are managed persistently by the useEffect at component mount.
            // They are not registered per-message to prevent listener cleanup race conditions.

            try {
                assistantMessageIdRef.current = crypto.randomUUID();
                await acpApi.stream({
                    messages: newMessages.map(m => ({ role: m.role, content: m.content })),
                    model: currentM?.id,
                    providerType: currentM?.providerType,
                    conversationId: activeConversationId,
                    assistantMessageId: assistantMessageIdRef.current,
                    operatorMode: pursueGoalMode,
                });
            } catch (err) { console.error("Stream error:", err); }
            finally { setIsLoading(false); }
        })();
    }, [activeConversationId, selectedModel, availableModels, pursueGoalMode, applyLiveToolUpdate]);

    const saveConversation = useCallback(async (msgs: Message[], isFullSave: boolean = false) => {
        if (msgs.length === 0) return;
        // Use the ref for synchronous reads — avoids duplicate IDs when called
        // multiple times before React flushes the state update.
        const isNewConversation = !activeConversationIdRef.current;
        let id = activeConversationIdRef.current;
        if (!id) {
            id = crypto.randomUUID();
            activeConversationIdRef.current = id;
            setActiveConversationId(id);
        }
        const conversation = {
            id,
            title: msgs[0].content.slice(0, 60) + (msgs[0].content.length > 60 ? "..." : ""),
            messages: msgs.map((m, idx) => ({
                id: m.id || crypto.randomUUID(),
                role: m.role,
                content: m.content,
                thought: m.thought,
                reasoning_content: m.reasoning_content,
                thinkingDuration: m.thinkingDuration,
                stopped: m.stopped, // Preserve stopped flag
                toolCalls: m.toolCalls ? persistableToolCalls(m.toolCalls).map((tc, tcIdx) => {
                    const { icon, ...rest } = tc;
                    return {
                        ...rest,
                        orderIndex: tc.orderIndex ?? tcIdx
                    };
                }) : undefined,
                missionTimeline: m.missionTimeline,
                attachments: m.attachments,
                orderIndex: (m as any).orderIndex ?? idx,
                createdAt: m.timestamp ? (m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString()) : new Date().toISOString()
            })),
            provider: config?.provider || "everfern",
            projectId: folderContexts.length > 0 ? folderContexts[0].id : undefined,
            createdAt: msgs[0]?.timestamp ? (msgs[0].timestamp instanceof Date ? msgs[0].timestamp.toISOString() : new Date(msgs[0].timestamp).toISOString()) : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isFullSave // Use the provided parameter
        } as any;

        if ((window as any).electronAPI?.history?.save) await (window as any).electronAPI.history.save(conversation);

        // Non-blocking: generate a smart title from the first user message
        if (isNewConversation) {
            const firstUserMsg = msgs.find(m => m.role === 'user');
            if (firstUserMsg && typeof firstUserMsg.content === 'string') {
                (window as any).electronAPI?.chat?.generateTitle?.(id, firstUserMsg.content);
            }
        }
    }, [activeConversationId, config?.provider, folderContexts, persistableToolCalls]);

    const handlePlayVoiceResponse = useCallback(async (text: string) => {
        if (!voiceOutputEnabled || !voiceProvider || !voiceElevenlabsKey) return;
        try {
            setVoicePlayback(true);
            if (voiceProvider === "elevenlabs") {
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceVoiceId}?optimize_streaming_latency=0`, { method: 'POST', headers: { 'xi-api-key': voiceElevenlabsKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
                if (response.ok) {
                    const audioBlob = await response.blob();
                    const audioUrl = URL.createObjectURL(audioBlob);
                    if (!audioPlaybackRef.current) audioPlaybackRef.current = new Audio();
                    const audio = audioPlaybackRef.current;
                    audio.src = audioUrl;
                    audio.onended = () => { setVoicePlayback(false); URL.revokeObjectURL(audioUrl); };
                    audio.onerror = () => { setVoicePlayback(false); URL.revokeObjectURL(audioUrl); };
                    await audio.play();
                } else { setVoicePlayback(false); }
            }
        } catch (error) { console.error('Voice playback error:', error); setVoicePlayback(false); }
    }, [voiceOutputEnabled, voiceProvider, voiceElevenlabsKey, voiceVoiceId]);

    const handleUndoTurn = useCallback((msgIndex: number) => {
        const assistantMsg = messages[msgIndex];
        if (!assistantMsg || assistantMsg.role !== 'assistant') return;

        // Find preceding user message
        const userMsgIndex = msgIndex - 1;
        const userMsg = messages[userMsgIndex];
        if (!userMsg || userMsg.role !== 'user') return;

        const convId = activeConversationId ?? activeConversationIdRef.current;
        if (!convId) return;

        // Handle different timestamp formats (Date object, number, or numeric string from SQLite)
        let timestamp: number;
        if (userMsg.timestamp instanceof Date) {
            timestamp = userMsg.timestamp.getTime();
        } else if (typeof userMsg.timestamp === 'number') {
            timestamp = userMsg.timestamp;
        } else if (typeof userMsg.timestamp === 'string' && !isNaN(Number(userMsg.timestamp))) {
            // SQLite might return timestamps as numeric strings
            timestamp = Number(userMsg.timestamp);
        } else {
            // Fallback for ISO strings
            timestamp = new Date(userMsg.timestamp).getTime();
        }

        // Open the custom revert modal — it will fetch what changed and confirm
        setRevertTarget({ conversationId: convId, timestamp, msgIndex });
        setShowRevertModal(true);
    }, [messages, activeConversationId]);

    const handleConfirmRevert = useCallback(async () => {
        if (!revertTarget) return;
        const { conversationId, timestamp, msgIndex } = revertTarget;
        const userMsgIndex = msgIndex - 1;
        const userMsg = messages[userMsgIndex];

        try {
            await (window as any).electronAPI?.acp?.rollbackTurn?.(conversationId, timestamp);

            // Restore user prompt in the input box
            if (userMsg) setInputValue(userMsg.content);

            // Remove the user message and all subsequent messages
            const newMessages = messages.slice(0, userMsgIndex);
            setMessages(newMessages);
            messagesRef.current = newMessages;
            saveConversation(newMessages, true); // True = full save (delete removed messages from db)
        } catch (error) {
            console.error("Failed to undo turn:", error);
            alert("Failed to undo turn: " + error);
        } finally {
            setShowRevertModal(false);
            setRevertTarget(null);
        }
    }, [revertTarget, messages, saveConversation]);

    const handleSend = useCallback((overrideValue?: any, currentMessages?: Message[]) => {
        console.log('[Frontend handleSend] CALLED - Starting new message send');
        const textToUse = typeof overrideValue === 'string' ? overrideValue : inputValue;
        if ((!textToUse.trim() && attachments.length === 0 && folderContexts.length === 0) || (isLoading && !bypassLoadingRef.current)) return;
        bypassLoadingRef.current = false;
        const isProject = folderContexts.length > 0 && projects.some(p => p.id === folderContexts[0].id || p.path === folderContexts[0].path);
        const folderContextText = (folderContexts.length > 0 && !isProject) ? `\n\n[Shared folder context]\n${folderContexts.map(f => `- ${f.path}`).join('\n')}\n\nNote: This folder structure is provided as passive context. You do not need to process, scan, or organize these files automatically. However, if the user explicitly asks you to take an action on these files in this message, you MUST fulfill their request using your tools immediately without asking for extra confirmation.` : '';
        const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: (textToUse.trim() + folderContextText).trim(), timestamp: new Date(), attachments: attachments.length > 0 ? [...attachments] : undefined };
        const newMessages = [...(currentMessages ?? messagesRef.current), userMessage];
        messagesRef.current = newMessages;
        setMessages(newMessages);

        // Ensure conversation ID is established synchronously before any async operations
        let currentConvId = activeConversationIdRef.current;
        if (!currentConvId) {
            currentConvId = crypto.randomUUID();
            activeConversationIdRef.current = currentConvId;
            setActiveConversationId(currentConvId);
        }

        // Immediately save the user message to prevent data loss
        saveConversation(newMessages);

        if (typeof overrideValue !== 'string') setInputValue("");
        setAttachments([]);

        // Keep project context if it exists
        if (!isProject) {
            setFolderContexts([]);
        }

        setIsLoading(true);
        setLiveToolCalls([]);
        setStreamingToolCalls([]);
        streamingToolCallsRef.current = [];
        setStreamingContent("");
        setStreamingThought("");
        setMissionTimeline(null);
        setMissionComplete(false);
        setCurrentNode("");
        setActiveUserQuestions([]);
        setShowHitlApproval(false);
        setHitlRequest(null);
        (window as any).__activeHitl = false;
        liveToolCallsRef.current = [];
        streamingContentRef.current = "";
        streamingThoughtRef.current = "";
        missionTimelineRef.current = null;
        toolCallMap.current.clear();
        hasReceivedUsageData.current = false;
        assistantMessageIdRef.current = crypto.randomUUID();

        const currentM = availableModels.find(m => m.id === selectedModel) || availableModels[0];

        // CRITICAL: Remove old stream listeners BEFORE resetting the flag
        // This prevents race condition where old handler sets flag to true after we reset it
        const api = (window as any).electronAPI?.acp;
        if (api?.removeStreamListeners) {
            console.log('[Frontend handleSend] Removing old stream listeners');
            api.removeStreamListeners();
        }

        // Now it's safe to reset the flag - no old handlers can interfere
        console.log('[Frontend handleSend] Resetting isMessageCommittedRef to false');
        isMessageCommittedRef.current = false;

        (async () => {
            isHandlingPlanRef.current = false;
            try {
                if (!(window as any).electronAPI) {
                    throw new Error('Electron API not found. Please run EverFern using the Desktop App instead of a web browser, or restart the app if it just updated.');
                }
                if (!api?.stream) throw new Error('No AI provider configured.');

                // CRITICAL: Stop the previous backend stream to prevent its delayed events
                // (like done: true) from interfering with the new stream.
                if (api?.stop) {
                    console.log('[Frontend handleSend] Stopping previous backend stream');
                    await api.stop();
                }

                api.onAgentPermissionRequest(() => {
                    const soundUrl = api?.getPermissionSoundUrl?.();
                    if (soundUrl) {
                        try {
                            const audio = new Audio(soundUrl);
                            audio.volume = 0.7;
                            audio.play().catch(e => console.log('[Audio] Could not play permission sound:', e));
                        } catch (e) { console.log('[Audio] Error:', e); }
                    }
                    setShowPermissionModal(true);
                });
                api.onToolStart(({ toolName, toolArgs, toolCallId }: { toolName: string; toolArgs: Record<string, unknown>, toolCallId?: string }) => {
                    console.log('[Frontend] 🔧 Received tool_start:', toolName, 'with args:', toolArgs);
                    console.log('[Frontend] Current liveToolCalls length BEFORE adding:', liveToolCallsRef.current.length);
                    console.log('[Frontend] Current liveToolCalls:', liveToolCallsRef.current.map(tc => ({ id: tc.id, toolName: tc.toolName, status: tc.status })));

                    if (toolName === 'ask_user_question' || toolName === 'approve_actions') {
                        console.log(`[Frontend] Received ${toolName} tool_start:`, JSON.stringify({ toolName, toolArgs }, null, 2));
                        // Set the flag immediately so mission_complete doesn't clear the form
                        activeUserQuestionRef.current = true;
                        return;
                    }

                    // Consume the pending narrative once — clear immediately so subsequent
                    // tool calls in the same burst don't inherit the same caption.
                    const narrativeText = streamingContentRef.current.trim();
                    if (narrativeText) {
                        streamingContentRef.current = '';
                        setStreamingContent('');
                    }

                    const display = resolveToolDisplay(toolName, toolArgs);
                    console.log('[Frontend] Resolved display for', toolName, ':', display);

                    const placeholder = liveToolCallsRef.current.find(t =>
                        t.id.startsWith('streaming-') && t.toolName === toolName
                    );
                    const inheritedOrderIndex = placeholder ? placeholder.orderIndex : liveToolCallsRef.current.length;
                    const inheritedSubAgentProgress = placeholder?.subAgentProgress || subAgentProgress.get(toolCallId || '') || [];

                    const newTc: ToolCallDisplay = {
                        id: toolCallId || crypto.randomUUID(),
                        toolName,
                        ...display,
                        status: 'running',
                        args: toolArgs,
                        description: narrativeText || undefined,
                        orderIndex: inheritedOrderIndex,
                        subAgentProgress: inheritedSubAgentProgress,
                        displayName: 'Fern'
                    };
                    const mapKey = toolCallId || (toolName + '_running');

                    console.log('[Frontend] Created new ToolCallDisplay:', { id: newTc.id, toolName: newTc.toolName, label: newTc.label, status: newTc.status });
                    console.log('[Frontend] Adding to toolCallMap with key:', mapKey, 'id:', newTc.id);
                    toolCallMap.current.set(mapKey, newTc.id);


                    // Filter out any "streaming-" placeholders that match this tool name
                    const filtered = liveToolCallsRef.current.filter(t =>
                        !(t.id.startsWith('streaming-') && t.toolName === toolName)
                    );

                    // CRITICAL: Create a new array to trigger React re-render
                    const updatedToolCalls = [...filtered, newTc];
                    liveToolCallsRef.current = updatedToolCalls;
                    setLiveToolCalls(updatedToolCalls);
                    maybeOpenUserUrlTool(newTc);

                    console.log('[Frontend] ✅ Added tool to timeline:', toolName);
                    console.log('[Frontend] Total tools AFTER adding:', liveToolCallsRef.current.length);
                    console.log('[Frontend] Updated liveToolCalls:', liveToolCallsRef.current.map(tc => ({ id: tc.id, toolName: tc.toolName, label: tc.label, status: tc.status })));

                });
                api.onToolUpdate?.(applyLiveToolUpdate);
                api.onViewSkill(({ name }: { name: string }) => {
                    const display = resolveToolDisplay('view_skill', { name });
                    const newTc: ToolCallDisplay = { id: crypto.randomUUID(), toolName: 'view_skill', ...display, status: 'done' };
                    liveToolCallsRef.current = [...liveToolCallsRef.current, newTc];
                    setLiveToolCalls(liveToolCallsRef.current);
                });
                api.onSkillDetected(({ skillName, reason }: { skillName: string; skillDescription: string; reason: string }) => {
                    const newTc: ToolCallDisplay = { id: crypto.randomUUID(), toolName: 'skill_detected', displayName: `📚 Skill Detected: ${skillName}`, description: reason, status: 'done', args: { skillName } };
                    liveToolCallsRef.current = [...liveToolCallsRef.current, newTc];
                    setLiveToolCalls(liveToolCallsRef.current);
                });
                api.onSurfaceAction((data: any) => {
                    if (data.action === 'create' || data.action === 'update') {
                        setActiveSurface({ surfaceId: data.surfaceId, catalogId: data.catalogId, components: data.components });
                    } else if (data.action === 'delete') {
                        setActiveSurface(null);
                    }
                });

                // Handle multi-agent subagent events
                api.onSubagentEvent?.((event: any) => {
                    if (event.type === 'subagent_event') {
                        console.log('[Frontend] 🤖 Subagent event received:', event.subagentEventType, event.agent);
                        subagent.handleStreamEvent(event);
                        setShowSubagentPanel(true);
                    }
                });


                let accumulated = "";

                api.onToolCall((record: any) => {
                    const recordTcId = record.id || record.toolCallId;

                    // Debug: Log the tool call structure
                    if (record.toolName === 'ask_user_question' || record.toolName === 'approve_actions') {
                        console.log(`[Frontend] 📥 Received ${record.toolName} tool call`);
                        console.log('[Frontend] Tool call data:', JSON.stringify(record, null, 2));
                        console.log('[Frontend] Current activeUserQuestions length:', activeUserQuestions.length);
                        console.log('[Frontend] Current __activeUserQuestion flag:', (window as any).__activeUserQuestion);
                    }

                    // CRITICAL: Handle ask_user_question or approve_actions FIRST, before checking existingId
                    // HITL approval sends tool_call without tool_start, so existingId won't exist
                    if ((record.toolName === 'ask_user_question' || record.toolName === 'approve_actions') && record.result?.success && record.result?.data) {
                        if (recordTcId && answeredToolCallIdsRef.current.has(recordTcId)) {
                            console.log(`[Frontend] ⏭️ Skipping already-answered HITL tool call: ${recordTcId}`);
                            return;
                        }

                        console.log(`[Frontend] ✅ Processing ${record.toolName} (HITL or regular)`);
                        console.log('[Frontend] Result data:', JSON.stringify(record.result.data, null, 2));

                        // CRITICAL: Set flag IMMEDIATELY to prevent race condition with mission_complete
                        activeUserQuestionRef.current = true;
                        console.log('[Frontend] Set __activeUserQuestion flag to true');

                        const data = record.result.data;
                        const normalizeOpts = (opts: any[]) => {
                            console.log('[Frontend] Normalizing options:', opts);
                            return (opts || []).map((opt: any) => ({
                                label: typeof opt === 'string' ? opt : opt.label || opt.value || String(opt),
                                value: typeof opt === 'string' ? opt : opt.value || opt.label || String(opt),
                                isRecommended: typeof opt === 'object' ? (opt.isRecommended || false) : false
                            }));
                        };

                        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
                            console.log('[Frontend] Found questions array with', data.questions.length, 'questions');
                            const normalized = data.questions.map((q: any) => {
                                console.log('[Frontend] Normalizing question:', q);
                                return {
                                    toolCallId: recordTcId,
                                    question: q.question,
                                    options: normalizeOpts(q.options),
                                    multiSelect: q.multiSelect || false,
                                    previewMarkdown: data.preview || undefined,
                                };
                            });
                            console.log('[Frontend] Normalized questions:', normalized);
                            setActiveUserQuestions(normalized);
                            console.log(`[Frontend] ✅ Called setActiveUserQuestions with ${normalized.length} questions`);

                            // Force a re-render
                            setIsLoading(false);
                        } else if (data.question) {
                            console.log('[Frontend] Found single question:', data.question);
                            const normalized = [{
                                toolCallId: recordTcId,
                                question: typeof data.question === 'string' ? data.question : data.question.question,
                                options: normalizeOpts(data.options),
                                multiSelect: data.multiSelect || false,
                                previewMarkdown: data.preview || undefined,
                            }];
                            console.log('[Frontend] Normalized single question:', normalized);
                            setActiveUserQuestions(normalized);
                            console.log('[Frontend] ✅ Called setActiveUserQuestions with 1 question');

                            // Force a re-render
                            setIsLoading(false);
                        } else {
                            console.error('[Frontend] ❌ No valid question data found in tool_call');
                            console.error('[Frontend] Data structure:', data);
                            activeUserQuestionRef.current = false;
                        }

                        // Don't process further for ask_user_question or approve_actions - it doesn't need timeline display
                        console.log(`[Frontend] Returning early from ${record.toolName} handler`);
                        return;
                    } else if (record.toolName === 'ask_user_question' || record.toolName === 'approve_actions') {
                        console.error('[Frontend] ❌ ask_user_question tool_call missing required data');
                        console.error('[Frontend] Record:', JSON.stringify(record, null, 2));
                    }

                    if (record.toolName === 'create_plan' || record.toolName === 'update_plan_step') { if (record.result?.success && record.result?.data) setCurrentPlan(record.result.data); }
                    if (record.toolName === 'todo_write') {
                        if (record.result?.success && record.result?.data) {
                            setPanelTasks(record.result.data.tasks);
                            setTasksFilePath(record.result.data.path);
                            setShowTasksPanel(true);
                        }
                    }
                    if (record.toolName === 'execution_plan') {
                        if (record.result?.success && record.result?.data) {
                            const planData = record.result.data;
                            setExecutionPlan({ title: planData.title, content: planData.content });
                            setIsExecutionPlanPaneOpen(true);
                            if (activeConversationId) {
                                localStorage.setItem(`everfern_execution_plan_${activeConversationId}`, JSON.stringify(planData));
                            }
                            // Stop loading - wait for user to approve plan
                            // Stop loading - wait for user to approve plan
                            if (isMessageCommittedRef.current || isHandlingPlanRef.current) return;
                            isMessageCommittedRef.current = true;
                            isHandlingPlanRef.current = true;
                            api.removeStreamListeners();

                            setLiveToolCalls(prevTools => {
                                const finalToolCalls = persistableToolCalls(
                                    prevTools,
                                    t => t.status === 'running' ? 'done' : undefined
                                );
                                const assistantMsg: Message = {
                                    id: crypto.randomUUID(),
                                    role: "assistant",
                                    content: accumulated || "I have created an execution plan for your request.",
                                    thought: streamingThoughtRef.current,
                                    reasoning_content: streamingThoughtRef.current,
                                    timestamp: new Date(),
                                    toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                                    missionTimeline: missionTimelineRef.current,
                                };
                                setMessages(prev => {
                                    // Prevent duplicate message if the last message is identical
                                    if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && prev[prev.length - 1].content === assistantMsg.content) {
                                        console.warn('[Chat] Duplicate execution plan message prevented');
                                        return prev;
                                    }
                                    const final = [...prev, assistantMsg];
                                    saveConversation(final);
                                    return final;
                                });
                                setStreamingContent("");
                                setStreamingThought("");
                                setIsLoading(false);
                                return [];
                            });
                        }
                    }
                    if (record.result?.success) {
                        if (record.toolName === 'read_file') { setContextItems(prev => { const exists = prev.some(i => i.label === record.result.data?.name || i.label === record.args.path); if (!exists) return [...prev, { id: crypto.randomUUID(), type: 'file', label: record.result.data?.name || record.args.path }]; return prev; }); }
                    }
                    const key = record.id || record.toolCallId || (record.toolName + '_running');
                    const existingId = toolCallMap.current.get(key);
                    if (existingId) {
                        const updatedToolCalls = liveToolCallsRef.current.map((t, idx) => t.id === existingId
                            ? persistableToolCall({
                                ...t,
                                status: 'done' as const,
                                output: typeof record.result === 'string' ? record.result : (record.result?.output || JSON.stringify({ ...record.result, base64Image: undefined }, null, 2)),
                                data: record.result?.data,
                                base64Image: record.result?.base64Image,
                                durationMs: record.durationMs,
                            }, idx)
                            : t
                        );
                        toolCallMap.current.delete(key);
                        liveToolCallsRef.current = updatedToolCalls;
                        setLiveToolCalls(updatedToolCalls);
                        if (record.toolName === 'show_user_url') {
                            const updatedTool = updatedToolCalls.find(t => t.id === existingId);
                            if (updatedTool) openToolDetailTab(mapToolCallForDetail(updatedTool));
                        }
                    }
                });
                api.onThought(({ content }: { content: string }) => {
                    // Filter out fun startup messages, keep only actual thoughts
                    if (!['🎬 Let\'s do this!'].includes(content)) {
                        streamingThoughtRef.current += content;
                        setStreamingThought(streamingThoughtRef.current);
                    }
                });
                api.onUsage(({ promptTokens, completionTokens, totalTokens }: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
                    console.log(`[Token Usage] Prompt: ${promptTokens}, Completion: ${completionTokens}, Total: ${totalTokens}`);

                    // Calculate pricing using model info if available
                    if (modelInfo) {
                        const promptCost = promptTokens * modelInfo.promptPricing;
                        const completionCost = completionTokens * modelInfo.completionPricing;
                        const totalCost = promptCost + completionCost;

                        console.log(`[Pricing] Prompt Cost: $${promptCost.toFixed(6)}, Completion Cost: $${completionCost.toFixed(6)}, Total Cost: $${totalCost.toFixed(6)}`);
                        console.log(`[Pricing] Model: ${selectedModel}, Rates: Prompt $${modelInfo.promptPricing.toExponential()} / token, Completion $${modelInfo.completionPricing.toExponential()} / token`);
                    }

                    hasReceivedUsageData.current = true;
                    setContextTokens({ used: totalTokens, max: 128000 });
                });
                api.onOptima(({ event, details }: { event: string; details: string }) => { setStreamingThought(prev => { const icon = event === 'cache_hit' ? '⚡' : '✂️'; const label = event === 'cache_hit' ? 'Semantic Cache Hit' : 'Prompt Slimmed'; return `> [!NOTE]\n> **Optima**: ${icon} ${label} — ${details}\n\n` + prev; }); });
                api.onShowArtifact?.(({ name }: { name: string }) => { setSelectedArtifactName(name); setShowArtifacts(true); });

                api.onShowPlan?.(({ content }: { chatId: string; content: string }) => {
                    console.log('[Plan] Execution plan detected, saving accumulated content');
                    if (isMessageCommittedRef.current || isHandlingPlanRef.current) return;
                    isMessageCommittedRef.current = true;
                    isHandlingPlanRef.current = true;
                    // Save any accumulated AI response before showing plan
                    if (accumulated || streamingThoughtRef.current) {
                        const finalToolCalls = persistableToolCalls(
                            liveToolCallsRef.current,
                            t => t.status === 'running' ? 'done' : undefined
                        );
                        const assistantMsg: Message = {
                            id: crypto.randomUUID(),
                            role: "assistant",
                            content: accumulated || "",
                            thought: streamingThoughtRef.current,
                            reasoning_content: streamingThoughtRef.current,
                            timestamp: new Date(),
                            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                            missionTimeline: missionTimelineRef.current,
                        };
                        setMessages(prev => {
                            // Prevent duplicate message if the last message is identical
                            if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                                const prevMsg = prev[prev.length - 1];
                                const isDuplicateContent = prevMsg.content === assistantMsg.content;
                                const isDuplicateToolCalls = JSON.stringify(prevMsg.toolCalls) === JSON.stringify(assistantMsg.toolCalls);
                                if (isDuplicateContent && isDuplicateToolCalls) {
                                    console.warn('[Chat] Duplicate plan detail message prevented');
                                    return prev;
                                }
                            }
                            const updatedMessages = [...prev, assistantMsg];
                            saveConversation(updatedMessages);
                            return updatedMessages;
                        });
                    }

                    setExecutionPlan({ content });
                    setIsExecutionPlanPaneOpen(true);

                    // Automatically close other containers to give space to the plan
                    setContextExpanded(false);
                    setProgressExpanded(false);
                    setInstructionsExpanded(false);

                    if (activeConversationId) {
                        localStorage.setItem(`everfern_execution_plan_${activeConversationId}`, JSON.stringify({ content }));
                        localStorage.removeItem(`everfern_exec_pane_closed_${activeConversationId}`);
                    }

                    // Clear streaming state
                    setStreamingContent("");
                    setStreamingThought("");
                    liveToolCallsRef.current = [];
                    setLiveToolCalls([]);
                    setStreamingToolCalls([]);
                    streamingToolCallsRef.current = [];

                    // Stop loading - wait for user to approve plan
                    setIsLoading(false);
                    api.removeStreamListeners();
                });

                // Listen to sub-agent progress events
                api.onSubAgentProgress?.((event: SubAgentProgressEvent) => {
                    // Update the ref map directly to prevent full re-renders
                    const newMap = subAgentProgressRef.current;

                    // If we have too many tool calls, remove the oldest one to prevent memory issues
                    if (newMap.size >= 10 && !newMap.has(event.toolCallId)) {
                        const firstKey = newMap.keys().next().value;
                        if (firstKey) newMap.delete(firstKey);
                    }

                    // Get existing events and add new event
                    const existingEvents = newMap.get(event.toolCallId) || [];
                    const updatedEvents = [...existingEvents, event];

                    // Limit to last 100 events per tool call
                    const limitedEvents = updatedEvents.slice(-100);

                    newMap.set(event.toolCallId, limitedEvents);
                    setSubAgentProgressVersion(v => v + 1);

                    // Only update liveToolCalls state if this event actually matches a live tc
                    // This prevents expensive full-page re-renders on every computer_use step
                    const matchIdx = liveToolCallsRef.current.findIndex(tc => tc.id === event.toolCallId);
                    if (matchIdx !== -1) {
                        const updated = liveToolCallsRef.current.map(tc => {
                            if (tc.id === event.toolCallId) {
                                const currentEvents = tc.subAgentProgress || [];
                                return {
                                    ...tc,
                                    subAgentProgress: [...currentEvents, event].slice(-100)
                                };
                            }
                            return tc;
                        });
                        liveToolCallsRef.current = updated;
                        setLiveToolCalls(updated);
                    }
                });

                console.log('[Frontend handleSend] Registering NEW onStreamChunk handler');
                api.onToolCallStart(({ index, toolName }: { index: number; toolName: string }) => {
                    const newEntry: LiveToolCall = { index, toolName, partialArguments: '', isStreaming: true };
                    streamingToolCallsRef.current = [...streamingToolCallsRef.current.filter(t => t.index !== index), newEntry];
                    setStreamingToolCalls([...streamingToolCallsRef.current]);
                });

                api.onToolCallChunk(({ index, argumentsDelta }: { index: number; argumentsDelta: string }) => {
                    const existing = streamingToolCallsRef.current.find(t => t.index === index);
                    if (existing) {
                        const updated = streamingToolCallsRef.current.map(t =>
                            t.index === index ? { ...t, partialArguments: t.partialArguments + argumentsDelta } : t
                        );
                        streamingToolCallsRef.current = updated;
                        setStreamingToolCalls([...updated]);
                    }
                });

                api.onToolCallComplete(({ index, toolName, arguments: args }: { index: number; toolName: string; arguments: Record<string, unknown> }) => {
                    const updated = streamingToolCallsRef.current.map(t =>
                        t.index === index ? { ...t, isStreaming: false } : t
                    );
                    streamingToolCallsRef.current = updated;
                    setStreamingToolCalls([...updated]);
                });

                api.onStreamChunk(({ delta, done }: { delta: string; done: boolean }) => {
                    console.log(`[Frontend onStreamChunk] delta="${delta}", done=${done}, isMessageCommittedRef=${isMessageCommittedRef.current}`);
                    if (isMessageCommittedRef.current) {
                        console.log('[Frontend onStreamChunk] BLOCKED by isMessageCommittedRef guard');
                        return;
                    }
                    if (!done) {
                        accumulated += delta;
                        streamingContentRef.current = accumulated;
                        setStreamingContent(accumulated);

                        // Update create_artifact tool with streaming content
                        const artifactToolIdx = liveToolCallsRef.current.findIndex(
                            t => t.toolName === 'create_artifact' && t.status === 'running'
                        );
                        if (artifactToolIdx !== -1) {
                            const updated = [...liveToolCallsRef.current];
                            updated[artifactToolIdx] = {
                                ...updated[artifactToolIdx],
                                args: {
                                    ...updated[artifactToolIdx].args,
                                    content: accumulated
                                }
                            };
                            liveToolCallsRef.current = updated;
                            setLiveToolCalls(updated);
                        }

                        // Detect tool calls while streaming
                        const toolCallMatches = Array.from(accumulated.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi));
                        let hasNewTools = false;

                        toolCallMatches.forEach((match, index) => {
                            const streamingId = `streaming-${index}`;
                            const content = match[1].trim();

                            // Try to find tool name in the partial JSON
                            const nameMatch = content.match(/"name":\s*"([^"]+)"/);
                            if (nameMatch) {
                                const toolName = nameMatch[1];
                                const existing = liveToolCallsRef.current.find(t => t.id === streamingId);

                                 if (!existing) {
                                    const display = resolveToolDisplay(toolName, {});
                                    const newTc: ToolCallDisplay = {
                                        id: streamingId,
                                        toolName,
                                        ...display,
                                        status: 'running',
                                        orderIndex: liveToolCallsRef.current.length,
                                        subAgentProgress: subAgentProgress.get(streamingId) || []
                                    };
                                    liveToolCallsRef.current = [...liveToolCallsRef.current, newTc];
                                    hasNewTools = true;
                                }
                            }
                        });

                        if (hasNewTools) {
                            setLiveToolCalls([...liveToolCallsRef.current]);
                        }
                    } else {
                        api.removeStreamListeners();
                        isMessageCommittedRef.current = true;

                        let finalContent = accumulated || "";
                        finalContent = finalContent.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim();
                        const finalThought = streamingThoughtRef.current;
                        const finalToolCalls = persistableToolCalls(
                            liveToolCallsRef.current,
                            t => t.status === 'running' ? 'done' : undefined
                        );

                        // Check if the message was stopped by user
                        const wasStopped = finalContent.includes('🛑 Stopped by user.');
                        const cleanContent = wasStopped ? finalContent.replace(/\n\n🛑 Stopped by user\./g, '').trim() : finalContent;

                        // Only create assistant message if there's actual content, tool calls, or a mission timeline
                        if (cleanContent || finalThought || finalToolCalls.length > 0 || wasStopped || missionTimelineRef.current) {
                            const assistantMsg: Message = {
                                id: assistantMessageIdRef.current || crypto.randomUUID(),
                                role: "assistant",
                                content: cleanContent || "",
                                thought: finalThought,
                                reasoning_content: streamingThoughtRef.current,
                                timestamp: new Date(),
                                toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                                stopped: wasStopped,
                                missionTimeline: missionTimelineRef.current,
                            };

                            setStreamingContent("");
                            setStreamingThought("");
                            setLiveToolCalls([]);
                            setStreamingToolCalls([]);
                            streamingToolCallsRef.current = [];
                            setIsLoading(false);
                            setMessages(prev => {
                                const existingIdx = prev.findIndex(m => m.id === assistantMsg.id);
                                if (existingIdx >= 0) {
                                    const final = [...prev];
                                    final[existingIdx] = assistantMsg;
                                    saveConversation(final);
                                    return final;
                                }
                                const final = [...prev, assistantMsg];
                                saveConversation(final);
                                return final;
                            });

                            if (voiceOutputEnabled && voiceProvider === "elevenlabs" && voiceElevenlabsKey && !wasStopped)
                                handlePlayVoiceResponse(assistantMsg.content);
                        } else {
                            // No content at all - just clean up
                            setStreamingContent("");
                            setStreamingThought("");
                            setLiveToolCalls([]);
                            setStreamingToolCalls([]);
                            streamingToolCallsRef.current = [];
                            setIsLoading(false);
                        }

                        if (activeConversationId) {
                            checkForPlan(activeConversationId);
                            checkForSites(activeConversationId);
                        }
                    }
                });
                console.log('[Frontend handleSend] Sending stream request:', { model: selectedModel, providerType: currentM?.providerType || 'everfern', messageCount: newMessages.length, conversationId: activeConversationIdRef.current });

                // Fire-and-forget: ensure non-image attachments are cloned to the Linux VM
                const sys = (window as any).electronAPI?.system;
                if (sys?.ensureAttachmentInVm) {
                    for (const m of newMessages) {
                        if (m.attachments) {
                            for (const a of m.attachments) {
                                if (a.path && !a.mimeType?.startsWith('image/')) {
                                    sys.ensureAttachmentInVm(a.path);
                                }
                            }
                        }
                    }
                }

                await api.stream({
                    messages: newMessages.map(m => {
                        if (m.attachments && m.attachments.length > 0 && m.role === 'user') {
                            const blocks: any[] = [];
                            if (m.content) blocks.push({ type: 'text', text: m.content });
                            const toLinuxPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) ? p.replace(/^([A-Za-z]):[\\/]/, '/mnt/$1/').replace(/\\/g, '/') : p.replace(/\\/g, '/');
                            m.attachments.forEach(a => { if (a.mimeType.startsWith('image/') && a.base64) blocks.push({ type: 'image_url', image_url: { url: a.base64 } }); else blocks.push({ type: 'text', text: `[Attached File: ${a.name}]\n[Location: ${toLinuxPath(a.path || 'unknown')}]\n\nUse your tools (e.g. read, python) to access the file from this path.` }); });
                            return { role: m.role, content: blocks };
                        }
                        return { role: m.role, content: m.content };
                    }),
                    model: selectedModel,
                    providerType: currentM?.providerType || 'everfern',
                    conversationId: activeConversationIdRef.current,
                    projectId: folderContexts.length > 0 ? folderContexts[0].id : undefined,
                    assistantMessageId: assistantMessageIdRef.current,
                    operatorMode: pursueGoalMode,
                });
            } catch (err) {
                if (isMessageCommittedRef.current) return;
                isMessageCommittedRef.current = true;
                const errorMessage = err instanceof Error ? err.message : String(err);
                api?.removeStreamListeners?.();
                const finalToolCalls = persistableToolCalls(
                    liveToolCallsRef.current,
                    t => t.status === 'running' ? 'error' : undefined
                );
                const assistantMsg: Message = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: streamingContentRef.current ? streamingContentRef.current + `\n\n❌ ${errorMessage}` : `❌ ${errorMessage}`,
                    thought: streamingThoughtRef.current,
                    reasoning_content: streamingThoughtRef.current,
                    toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                    timestamp: new Date(),
                    missionTimeline: missionTimelineRef.current,
                };
                setMessages(prev => {
                    // Prevent duplicate message if the last message is identical
                    if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                        const prevMsg = prev[prev.length - 1];
                        const isDuplicateContent = prevMsg.content === assistantMsg.content;
                        const isDuplicateToolCalls = JSON.stringify(prevMsg.toolCalls) === JSON.stringify(assistantMsg.toolCalls);
                        if (isDuplicateContent && isDuplicateToolCalls) {
                            console.warn('[Chat] Duplicate error message prevented');
                            return prev;
                        }
                    }
                    const final = [...prev, assistantMsg];
                    saveConversation(final);
                    return final;
                });
                setLiveToolCalls([]);
                setStreamingToolCalls([]);
                streamingToolCallsRef.current = [];
                setStreamingContent("");
                setStreamingThought("");
                setIsLoading(false);
            }
        })();
    }, [inputValue, attachments, folderContexts, isLoading, messages, saveConversation, selectedModel, availableModels, activeConversationId, checkForPlan, pursueGoalMode, applyLiveToolUpdate]);

    const handleQuestionSubmit = useCallback((answers: Record<string, string[]>, attachedFiles?: Array<{ name: string; content?: string; base64?: string; mimeType?: string }>) => {
        // Format as clear form response so AI doesn't interpret as a new question
        const answerLines = Object.entries(answers).map(([question, values]) => {
            const selectedOptions = values.join(', ');
            return `**Selected:** ${selectedOptions}`;
        });
        const responseText = `[Form Response]\n${answerLines.join('\n')}`;

        // Populate answeredToolCallIdsRef with any toolCallId from activeUserQuestions (Task 7.2)
        activeUserQuestions.forEach(q => {
            if ((q as any).toolCallId) {
                console.log(`[Frontend] 📝 Marking tool call ID as answered: ${(q as any).toolCallId}`);
                answeredToolCallIdsRef.current.add((q as any).toolCallId);
            }
        });

        // Capture pending streaming content BEFORE clearing — the assistant's form
        // message lives in streamingContent, not yet committed to messages.
        // If we clear it and abort the stream, the AI's message is lost.
        const pendingContent = streamingContentRef.current;
        const pendingThought = streamingThoughtRef.current;
        const pendingToolCalls = persistableToolCalls(
            liveToolCallsRef.current,
            t => t.status === 'running' ? 'done' : undefined
        );

        // Commit the assistant's pending message (form content) before sending the user's response.
        // This ensures the AI's form questions survive in the conversation history.
        let finalHistory = messagesRef.current;
        if (pendingContent.trim() || pendingThought || pendingToolCalls.length > 0) {
            const assistantMsg: Message = {
                id: assistantMessageIdRef.current || crypto.randomUUID(),
                role: "assistant",
                content: pendingContent,
                thought: pendingThought,
                reasoning_content: pendingThought,
                toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
                missionTimeline: missionTimelineRef.current || undefined,
                timestamp: new Date(),
            };

            const existingIdx = finalHistory.findIndex(m => m.id === assistantMsg.id);
            if (existingIdx >= 0) {
                finalHistory = [...finalHistory];
                finalHistory[existingIdx] = assistantMsg;
            } else {
                finalHistory = [...finalHistory, assistantMsg];
            }

            setMessages(finalHistory);
            saveConversation(finalHistory);
        }

        isMessageCommittedRef.current = false;
        activeUserQuestionRef.current = false;
        setActiveUserQuestions([]);
        setStreamingContent("");
        setStreamingThought("");
        setLiveToolCalls([]);
        setStreamingToolCalls([]);
        streamingToolCallsRef.current = [];
        streamingContentRef.current = "";
        streamingThoughtRef.current = "";
        liveToolCallsRef.current = [];
        missionTimelineRef.current = null;

        // If files were attached, add them to the attachments state before sending
        if (attachedFiles && attachedFiles.length > 0) {
            const newAttachments = attachedFiles.map(f => ({
                id: crypto.randomUUID(),
                name: f.name,
                mimeType: f.mimeType || 'application/octet-stream',
                content: f.content,
                base64: f.base64,
            }));
            setAttachments(prev => [...prev, ...newAttachments as any]);
        }

        // Abort the previous agent stream before sending the form response.
        // Prevents race conditions from the old stream still running.
        (window as any).electronAPI?.acp?.stop?.();
        bypassLoadingRef.current = true;
        isMessageCommittedRef.current = true;

        // Send exactly once, pushing the current execute to the next tick so state settles
        setTimeout(() => {
            handleSend(responseText, finalHistory);
        }, 50);
    }, [handleSend, activeUserQuestions]);

    // Listen for processed HITL responses from backend
    useEffect(() => {
        const acpApi = (window as any).electronAPI?.acp;
        if (!acpApi?.onHitlResponseProcessed) return;

        acpApi.onHitlResponseProcessed((data: { message: string; shouldSendAsMessage: boolean }) => {
            console.log('[HITL] ✅ Processed HITL response received:', data);

            if (data.shouldSendAsMessage) {
                // Automatically send the HITL response as a new user message
                console.log('[HITL] 🔄 Sending HITL response as user message:', data.message);

                // Set the input value and trigger send
                setInputValue(data.message);

                // Trigger send after a brief delay to ensure state is updated
                setTimeout(() => {
                    handleSend();
                }, 100);
            }
        });

        return () => {
            // Cleanup is handled by removeStreamListeners
        };
    }, [handleSend, setInputValue]);

    const handleHitlApproval = useCallback((approved: boolean, sendMessage: boolean = false) => {
        if (!hitlRequest) return;

        console.log('[HITL] User decision:', approved ? 'approved' : 'rejected', 'sendMessage:', sendMessage);

        // Persist the resolution to disk so it won't re-appear on next app launch
        if (hitlRequest?.id && activeConversationId) {
            (window as any).electronAPI?.history?.hitl?.resolve?.(
                activeConversationId,
                hitlRequest.id,
                approved
            ).catch((e: any) => console.warn('[HITL] Failed to persist resolution:', e));
        }

        // Clear the HITL approval UI first
        setShowHitlApproval(false);
        setHitlRequest(null);
        setCurrentNode("");

        // Clear the active HITL flag
        (window as any).__activeHitl = false;

        // Send the approval response
        const responseText = approved ? '[HITL_APPROVED]' : '[HITL_REJECTED]';

        if (sendMessage) {
            // Send as a visible chat message
            // IMPORTANT: Don't call handleSend() as it clears streaming content and may delete agent messages
            // Instead, manually add the message and trigger the stream
            const messageText = approved
                ? `[HITL_APPROVED] I have reviewed and approved the requested operation. Please proceed.`
                : `[HITL_REJECTED] I have reviewed and rejected the requested operation. Please do not proceed.`;

            // Create user message for the approval
            const userMessage: Message = {
                id: crypto.randomUUID(),
                role: "user",
                content: messageText,
                timestamp: new Date()
            };

            // Add to messages array - this preserves all existing messages including agent messages
            const newMessages = [...messages, userMessage];
            setMessages(newMessages);

            // Now trigger the agent stream with the approval message
            // This is similar to handleSend but without clearing existing messages
            setIsLoading(true);
            setLiveToolCalls([]);
            setStreamingToolCalls([]);
            streamingToolCallsRef.current = [];
            setStreamingContent("");
            setStreamingThought("");
            setMissionComplete(false);
            liveToolCallsRef.current = [];
            streamingContentRef.current = "";
            streamingThoughtRef.current = "";
            isMessageCommittedRef.current = false;

            const acpApi = (window as any).electronAPI?.acp;
            if (acpApi?.stream) {
                // Remove old listeners
                acpApi.removeStreamListeners();

                // Prepare messages for streaming
                const messagesToSend = newMessages.map(m => ({
                    role: m.role,
                    content: m.content
                }));

                // Start the stream
                acpApi.stream({ messages: messagesToSend });
            }
        } else {
            // Send approval response directly to backend without creating a chat message
            const acpApi = (window as any).electronAPI?.acp;
            if (acpApi?.sendHitlResponse) {
                acpApi.sendHitlResponse(responseText);
            } else {
                // Fallback: send as a system message that won't appear in chat
                console.log('[HITL] Sending response directly to backend:', responseText);
                const event = new CustomEvent('hitl-response', {
                    detail: { response: responseText, approved }
                });
                window.dispatchEvent(event);
            }

            // CRITICAL: After HITL is resolved without sending a message, complete the mission
            // This ensures the UI updates properly and doesn't stay in loading state
            setTimeout(() => {
                if (!isMessageCommittedRef.current) {
                    console.log('[HITL] Completing mission after HITL resolution without new message');
                    setMissionComplete(true);
                    setIsLoading(false);

                    // Commit any accumulated content
                    const finalContent = streamingContentRef.current || "";
                    const finalThought = streamingThoughtRef.current;
                    const finalToolCalls = persistableToolCalls(
                        liveToolCallsRef.current,
                        t => t.status === 'running' ? 'done' : undefined
                    );

                        if (finalContent || finalThought || finalToolCalls.length > 0 || missionTimelineRef.current) {
                        const assistantMsg: Message = {
                            id: crypto.randomUUID(),
                            role: "assistant",
                            content: finalContent,
                            thought: finalThought,
                            reasoning_content: streamingThoughtRef.current,
                            timestamp: new Date(),
                            toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                            missionTimeline: missionTimelineRef.current,
                        };

                        setStreamingContent("");
                        setStreamingThought("");
                        setLiveToolCalls([]);
                        setStreamingToolCalls([]);
                        streamingToolCallsRef.current = [];
                        setMessages(prev => {
                            const prevMsg = prev[prev.length - 1];
                            if (prev.length > 0 && prevMsg.role === 'assistant' &&
                                prevMsg.content === assistantMsg.content &&
                                prevMsg.thought === assistantMsg.thought &&
                                JSON.stringify(prevMsg.toolCalls) === JSON.stringify(assistantMsg.toolCalls)) {
                                return prev;
                            }
                            const final = [...prev, assistantMsg];
                            saveConversation(final);
                            return final;
                        });
                    }

                    isMessageCommittedRef.current = true;
                    acpApi?.removeStreamListeners();
                }
            }, 200); // Small delay to ensure HITL response is sent first
        }
    }, [hitlRequest, messages, saveConversation]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }, [handleSend]);

    const handleNewChat = () => {
        conversationSwitchSeqRef.current += 1;
        setShowArtifacts(false);
        setShowSettings(false);
        setShowIntegrationSettings(false);
        setShowProjectsPage(false);
        resetConversationUiState(null, { clearInput: true, clearAttachments: true });
    };

    const handleSelectConversation = async (id: string) => {
        if (!id) return;

        const loadSeq = ++conversationSwitchSeqRef.current;
        setShowArtifacts(false);
        setShowSettings(false);
        setShowIntegrationSettings(false);
        setShowProjectsPage(false);
        setSidebarOpen(false); // auto-collapse on mobile/small screens
        resetConversationUiState(id, { clearAttachments: true });

        try {
            if ((window as any).electronAPI?.history?.load) {
                const conv = await (window as any).electronAPI.history.load(id);
                if (loadSeq !== conversationSwitchSeqRef.current || activeConversationIdRef.current !== id) {
                    return;
                }
                if (conv?.messages) {
                    // Restore project context
                    if (conv.projectId) {
                        // Find project in the current projects list
                        // Note: projects state is updated every 5s, so it should be there
                        const project = (projects || []).find((p: any) => p.id === conv.projectId);
                        if (project) {
                            setFolderContexts([{ id: project.id, path: project.path, name: project.name }]);
                        } else {
                            // Fallback if projects list hasn't loaded yet or project was deleted
                            // We can't easily fetch it by ID here without a new IPC call,
                            // so we just clear it for now or wait for projects to load.
                            setFolderContexts([]);
                        }
                    } else {
                        setFolderContexts([]);
                    }

                    const loadedMessages = conv.messages.map((m: any) => ({
                        id: m.id || crypto.randomUUID(),
                        role: m.role,
                        content: m.content,
                        thought: m.thought,
                        reasoning_content: m.reasoning_content,
                        thinkingDuration: m.thinkingDuration,
                        missionTimeline: m.missionTimeline,
                        toolCalls: m.toolCalls ? m.toolCalls.map((tc: any) => {
                            const display = tc.toolName ? resolveToolDisplay(tc.toolName, tc.args) : {};
                            return {
                                ...tc,
                                ...display
                            };
                        }) : undefined,
                        attachments: m.attachments || [],
                        timestamp: m.createdAt ? new Date(m.createdAt) : new Date(conv.updatedAt),
                        stopped: !!m.stopped
                    }));
                    restoreSubAgentProgressFromMessages(loadedMessages);
                    messagesRef.current = loadedMessages;
                    setMessages(loadedMessages);
                    const savedPlan = localStorage.getItem(`everfern_execution_plan_${id}`);
                    if (savedPlan) {
                        try {
                            setExecutionPlan(JSON.parse(savedPlan));
                            const isClosed = localStorage.getItem(`everfern_exec_pane_closed_${id}`);
                            setIsExecutionPlanPaneOpen(!isClosed);
                        } catch (e) { }
                    }
                    checkForPlan(id);
                    checkForSites(id);

                    // ── Restore pending HITL form if one was active when app closed ──
                    try {
                        const pendingHitl = await (window as any).electronAPI?.history?.hitl?.getPending?.(id);
                        if (loadSeq !== conversationSwitchSeqRef.current || activeConversationIdRef.current !== id) {
                            return;
                        }
                        if (pendingHitl?.request) {
                            console.log('[HITL Restore] Found pending HITL request on load:', pendingHitl.request.id);
                            (window as any).__activeHitl = true;
                            setHitlRequest(pendingHitl.request);
                            setShowHitlApproval(true);
                            setCurrentNode('hitl_approval');
                        }
                    } catch (hitlErr) {
                        console.warn('[HITL Restore] Failed to check for pending HITL:', hitlErr);
                    }
                }
            }
        } catch (err) { console.error("Failed to load conversation:", err); }
    };

    const currentModel = availableModels.find(m => m.id === selectedModel) || availableModels[0] || { id: "fern", name: "EverFern-1", provider: "EverFern", providerType: "everfern", logo: null };

    // ── Model Selector ───────────────────────────────────────────────────────
    const renderModelSelector = (minimal = false) => (
        <div ref={modelSelectorRef} style={{ position: "relative" }}>
            <button
                onClick={() => setShowModelSelector(!showModelSelector)}
                style={{ display: "flex", alignItems: "center", gap: minimal ? 4 : 6, background: minimal ? "transparent" : "rgba(0, 0, 0, 0.04)", border: minimal ? "none" : "1px solid #e8e6d9", color: "#201e24", fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: minimal ? "0" : "0 12px", borderRadius: 8, height: minimal ? "auto" : 36, transition: "all 0.15s" }}
                onMouseEnter={e => { if (!minimal) { e.currentTarget.style.borderColor = "#111111"; } e.currentTarget.style.color = "#111111"; }}
                onMouseLeave={e => { if (!minimal) { e.currentTarget.style.borderColor = "#e8e6d9"; } e.currentTarget.style.color = "#201e24"; }}
            >
                {!minimal && currentModel.logo && <currentModel.logo size={14} />}
                {currentModel.name}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: minimal ? 0.7 : 1, marginLeft: minimal ? -2 : 0 }}><path d="m6 9 6 6 6-6" /></svg>
            </button>

            <AnimatePresence>
                {showModelSelector && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.15 }}
                        style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, width: 240, backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 12, padding: 6, zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.1)" }}>
                        <div style={{ padding: "8px 10px 4px", fontSize: 10, fontWeight: 700, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>Models</div>
                        <div style={{ maxHeight: 300, overflowY: "auto" }}>
                            {availableModels.map(model => {
                                const isDisabled = model.id.endsWith('-error') || model.id.endsWith('-empty');
                                return (
                                    <button key={model.id} disabled={isDisabled} onClick={() => {
                                        if (isDisabled) return;
                                        if (model.providerType === 'everfern') {
                                            const sessionStr = localStorage.getItem('everfern_cloud_session');
                                            if (!sessionStr) {
                                                setShowModelSelector(false);
                                                router.push('/auth');
                                                return;
                                            }
                                        }
                                        setSelectedModel(model.id);
                                        setShowModelSelector(false);
                                    }}
                                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "none", background: selectedModel === model.id ? "rgba(0,0,0,0.05)" : "transparent", color: isDisabled ? "#8a8886" : "#201e24", cursor: isDisabled ? "default" : "pointer", fontSize: 13, transition: "all 0.1s", textAlign: "left", opacity: isDisabled ? 0.7 : 1 }}
                                        onMouseEnter={e => { if (selectedModel !== model.id && !isDisabled) e.currentTarget.style.background = "rgba(0,0,0,0.03)"; }}
                                        onMouseLeave={e => { if (selectedModel !== model.id && !isDisabled) e.currentTarget.style.background = "transparent"; }}
                                    >
                                        {model.logo ? <model.logo size={14} /> : <GlobeAltIcon width={14} height={14} className="text-zinc-500" />}
                                        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{model.name}</span>
                                        {selectedModel === model.id && <CheckSolidIcon width={14} height={14} className="text-indigo-400" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    const handleSaveSettings = async () => {
        const updated: any = { ...config, engine: settingsEngine, provider: settingsEngine === "online" ? settingsProvider : settingsEngine, apiKey: (settingsEngine === "online" || settingsEngine === "everfern") ? settingsApiKey : undefined, customModel: settingsEngine === "online" && settingsProvider === "nvidia" ? settingsCustomModel : undefined, showuiUrl: settingsShowuiUrl || undefined };
        if (settingsEngine === "local") { updated.provider = "ollama"; updated.baseUrl = "http://localhost:11434"; }
        const defaultVlmModel =
          settingsVlmCloudProvider === 'everfern' ? 'fern-1' :
          settingsVlmCloudProvider === 'openrouter' ? 'qwen/qwen3-vl-235b-a22b-instruct' :
          settingsVlmCloudProvider === 'minimax' ? 'MiniMax-M3' :
          settingsVlmCloudProvider === 'openai' ? 'gpt-5.5' :
          settingsVlmCloudProvider === 'anthropic' ? 'claude-opus-4.6' :
          'qwen3-vl:235b-cloud';
        const finalVlmModel = settingsVlmCloudModel.trim() || defaultVlmModel;
        if (settingsVlmMode === "cloud") {
          // For cloud-only providers like 'everfern' and 'openrouter', don't pass baseUrl/apiKey
          // to avoid using stale values from previous provider selections
          const shouldOmitBaseUrl = settingsVlmCloudProvider === 'everfern' || settingsVlmCloudProvider === 'openrouter';

          let finalCloudKey = settingsVlmCloudKey.trim() || undefined;
          if (settingsVlmCloudProvider === 'everfern' && !finalCloudKey) {
            try {
              const sessionStr = localStorage.getItem('everfern_cloud_session');
              if (sessionStr) {
                const session = JSON.parse(sessionStr);
                finalCloudKey = session.accessToken;
              }
            } catch (e) {}
          }

          updated.vlm = {
            engine: "cloud",
            provider: settingsVlmCloudProvider,
            model: finalVlmModel,
            baseUrl: (shouldOmitBaseUrl ? undefined : settingsVlmCloudUrl.trim()) || undefined,
            apiKey: finalCloudKey
          };
        }
        else if (config?.vlm) { updated.vlm = config.vlm; }
        if (voiceProvider && (voiceDeepgramKey.trim() || voiceElevenlabsKey.trim())) { updated.voice = { provider: voiceProvider, deepgramKey: voiceDeepgramKey.trim() || undefined, elevenlabsKey: voiceElevenlabsKey.trim() || undefined }; }
        // Embedding config
        updated.embedding = { provider: embeddingProvider, model: embeddingModel, apiKey: embeddingApiKey };
        setConfig(updated);
        if ((window as any).electronAPI?.saveConfig) await (window as any).electronAPI.saveConfig(updated);
        setShowSettings(false);
    };

    const checkOllamaStatus = async () => {
        if ((window as any).electronAPI?.system?.ollamaStatus) { const res = await (window as any).electronAPI?.system.ollamaStatus(); setOllamaInstalled(res.installed); setModelInstalled(res.modelInstalled); }
    };

    const handleNextFromName = async () => { if (!onboardingName.trim()) return; await checkOllamaStatus(); setOnboardingStep("vlm"); };

    const finalizeOnboarding = async (useOllama: boolean = false) => {
        const name = onboardingName.trim() || "User";
        let updated: any = { ...config, userName: name };
        if (useOllama) { updated.vlm = { engine: "local", provider: "ollama", model: "qwen3-vl:2b", baseUrl: "http://localhost:11434" }; if (updated.engine === "local") updated.provider = "ollama"; }
        setConfig(updated);
        if ((window as any).electronAPI?.saveConfig) await (window as any).electronAPI.saveConfig(updated);
        if ((window as any).electronAPI?.memory?.saveDirect) await (window as any).electronAPI.memory.saveDirect(`The user's preferred name is ${name}. Always refer to them as ${name}.`, '[User Profile]');
        setShowOnboarding(false);
    };

    const handleInstallOllama = async () => {
        setIsInstallingOllama(true); setOllamaInstallDone(false); setOllamaInstallPct(0); setOllamaInstallPhase("downloading"); setOllamaLogs([]);
        if ((window as any).electronAPI?.system?.onOllamaInstallLine) {
            (window as any).electronAPI?.system.onOllamaInstallLine((data: { line: string }) => {
                const pctMatch = data.line.match(/(\d+\.?\d*)%/);
                if (pctMatch) { const pct = parseFloat(pctMatch[1]); setOllamaInstallPct(pct); setOllamaInstallPhase(pct >= 100 ? "finalizing" : "downloading"); }
                setOllamaLogs(prev => [...prev.slice(-40), data.line]);
            });
        }
        if ((window as any).electronAPI?.system?.ollamaInstall) {
            const res = await (window as any).electronAPI?.system.ollamaInstall();
            if (res.success) { setOllamaInstalled(true); setOllamaInstallPct(100); setOllamaInstallPhase("done"); setOllamaInstallDone(true); setOllamaLogs(["✔ Ollama installed successfully!"]); }
            else { setOllamaLogs(prev => [...prev, `✘ Installation failed with code ${res.code}`]); }
        }
        setIsInstallingOllama(false);
    };

    const handlePullModel = async () => {
        setIsPullingModel(true); setPullPct(0); setOllamaLogs([]);
        if ((window as any).electronAPI?.system?.onOllamaInstallLine) {
            (window as any).electronAPI?.system.onOllamaInstallLine((data: { line: string }) => {
                const cleanLine = stripAnsi(data.line);
                const pctMatch = cleanLine.match(/(\d+\.?\d*)%/);
                if (pctMatch && (cleanLine.includes("pulling") || cleanLine.includes("verifying"))) setPullPct(parseFloat(pctMatch[1]));
                setOllamaLogs(prev => { const last = prev[prev.length - 1] || ""; if (cleanLine.includes("pulling") && last.includes("pulling")) { const newLogs = [...prev]; newLogs[newLogs.length - 1] = cleanLine; return newLogs; } return [...prev.slice(-30), cleanLine]; });
            });
        }
        if ((window as any).electronAPI?.system?.ollamaPull) {
            const res = await (window as any).electronAPI?.system.ollamaPull("qwen3-vl:2b");
            if (res.success) { setPullPct(100); await finalizeOnboarding(true); }
            else { setOllamaLogs(prev => [...prev, `✘ Model pull failed with code ${res.code}`]); }
        }
        setIsPullingModel(false);
    };

    // ── Shared composer toolbar ──────────────────────────────────────────────
    const renderComposerLeftActions = () => (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setShowAddMenu(!showAddMenu)} title="Attach menu"
                    style={{ background: "transparent", border: "none", color: "#717171", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#111111"}
                    onMouseLeave={e => e.currentTarget.style.color = "#717171"}
                >
                    <PlusIcon width={22} height={22} style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: '0.2s' }} />
                </button>
                <AnimatePresence>
                    {showAddMenu && (
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 8, backgroundColor: "#ffffff", borderRadius: 12, border: "1px solid #e8e6d9", padding: 6, display: "flex", flexDirection: "column", gap: 2, minWidth: 180, zIndex: 50, boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}>
                            <button type="button" onClick={() => { setShowAddMenu(false); handleAttachment('image'); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, border: "none", backgroundColor: "transparent", color: "#111111", cursor: "pointer", fontSize: 13, textAlign: "left" }} onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"} onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect><path d="M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"></path><path d="M21 15l-5-5L5 21"></path></svg>
                                Upload Image
                            </button>
                            <button type="button" onClick={() => { setShowAddMenu(false); handleAttachment('document'); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, border: "none", backgroundColor: "transparent", color: "#111111", cursor: "pointer", fontSize: 13, textAlign: "left" }} onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"} onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                Upload Document
                            </button>
                            <div style={{ height: 1, backgroundColor: "#f1f1ef", margin: "4px 6px" }} />
                            <button
                                type="button"
                                onClick={() => setPursueGoalMode(v => !v)}
                                title="Enable operator mode for long-running goals"
                                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, border: "none", backgroundColor: pursueGoalMode ? "rgba(0,0,0,0.05)" : "transparent", color: "#111111", cursor: "pointer", fontSize: 13, textAlign: "left" }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = pursueGoalMode ? "rgba(0,0,0,0.05)" : "transparent"}
                            >
                                <SparklesIcon width={18} height={18} style={{ flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>Pursue goal</span>
                                <span
                                    aria-hidden
                                    style={{
                                        width: 32,
                                        height: 18,
                                        borderRadius: 999,
                                        backgroundColor: pursueGoalMode ? "#201e24" : "#d6d6d3",
                                        padding: 2,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: pursueGoalMode ? "flex-end" : "flex-start",
                                        transition: "all 0.18s ease",
                                        flexShrink: 0,
                                    }}
                                >
                                    <span style={{ width: 14, height: 14, borderRadius: "50%", backgroundColor: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.18)" }} />
                                </span>
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div style={{ position: 'relative' }}>
                <button type="button"
                    onClick={() => !isProjectLocked && setShowProjectDropdown(!showProjectDropdown)}
                    title={isProjectLocked ? "Project Locked" : "Select Project"}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #e8e6d9", borderRadius: 14, color: folderContexts.length > 0 ? "#111111" : "#8a8886", cursor: isProjectLocked ? "default" : "pointer", padding: "6px 14px", fontSize: 13, fontWeight: 500, transition: "0.2s" }}
                    onMouseEnter={e => { if (!isProjectLocked) { e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)"; e.currentTarget.style.color = "#111111"; } }}
                    onMouseLeave={e => { if (!isProjectLocked) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = folderContexts.length > 0 ? "#111111" : "#8a8886"; } }}
                >
                    <BriefcaseIcon width={15} height={15} style={{ color: folderContexts.length > 0 ? "#111111" : "#8a8886" }} />
                    {folderContexts.length > 0 ? folderContexts[0].name : "Project"}
                    {!isProjectLocked && <ChevronDownIcon width={12} height={12} style={{ marginLeft: 4, color: '#8a8886' }} />}
                </button>

                <AnimatePresence>
                    {showProjectDropdown && (
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 8, width: 220, backgroundColor: "#ffffff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", border: "1px solid #f4f4f4", padding: 6, zIndex: 50, display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto" }}
                        >
                            <button
                                type="button"
                                onClick={() => { setFolderContexts([]); setShowProjectDropdown(false); }}
                                style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: 8, border: "none", backgroundColor: folderContexts.length === 0 ? "rgba(0,0,0,0.04)" : "transparent", color: folderContexts.length === 0 ? "#111111" : "#8a8886", cursor: "pointer", fontSize: 13, textAlign: "left", transition: "0.15s" }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = folderContexts.length === 0 ? "rgba(0,0,0,0.04)" : "transparent"}
                            >
                                No Project
                            </button>

                            {projects.length > 0 && <div style={{ height: 1, backgroundColor: '#f4f4f4', margin: '4px 0' }} />}

                            {projects.map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => { setFolderContexts([{ id: p.id, path: p.path, name: p.name }]); setShowProjectDropdown(false); }}
                                    style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: 8, border: "none", backgroundColor: folderContexts[0]?.id === p.id ? "rgba(0,0,0,0.04)" : "transparent", color: "#111111", cursor: "pointer", fontSize: 13, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "0.15s" }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.05)"}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = folderContexts[0]?.id === p.id ? "rgba(0,0,0,0.04)" : "transparent"}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", overflow: "hidden" }}>
                                        <BriefcaseIcon width={14} height={14} style={{ flexShrink: 0, color: folderContexts[0]?.id === p.id ? '#111111' : '#8a8886' }} />
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                                    </div>
                                </button>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );

    const renderComposerRightActions = (showVolumeToggle = false) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Context Token Ring */}
            <ContextTokenRing
                used={contextTokens.used}
                max={contextTokens.max}
                modelInfo={modelInfo}
                estimatedCost={estimatedCost}
                isLocalModel={currentModel.providerType === 'ollama' || currentModel.providerType === 'lmstudio' || currentModel.providerType === 'local'}
            />

            {renderModelSelector(true)}

            {isLoading ? (
                <button onClick={() => {
                    console.log('[Frontend] Stop button clicked - aborting agent');
                    (window as any).electronAPI?.acp?.stop?.();

                    // Commit the current streaming content as a stopped message
                    const stoppedContent = streamingContent || "";
                    const finalToolCalls = persistableToolCalls(
                        liveToolCalls,
                        t => t.status === 'running' ? 'done' : undefined
                    );

                    const assistantMsg: Message = {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: stoppedContent,
                        thought: streamingThought || undefined,
                        reasoning_content: streamingThought || undefined,
                        timestamp: new Date(),
                        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                        stopped: true, // Mark as stopped by user
                        missionTimeline: missionTimelineRef.current,
                    };

                    setMessages(prev => {
                        const final = [...prev, assistantMsg];
                        saveConversation(final);
                        return final;
                    });

                    // Clean up state
                    setIsLoading(false);
                    isMessageCommittedRef.current = true;
                    setStreamingContent("");
                    setStreamingThought("");
                    setLiveToolCalls([]);
                    setStreamingToolCalls([]);
                    streamingToolCallsRef.current = [];

                    console.log('[Frontend] Agent stopped and message saved to history');
                }}
                    style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(239, 68, 68, 0.15)", border: "none", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <StopIcon width={16} height={16} />
                </button>
            ) : (
                <button type="button" onClick={handleSend} disabled={activeUserQuestions.length > 0 || !!showHitlApproval || (!inputValue.trim() && attachments.length === 0 && folderContexts.length === 0)} title="Send"
                    style={{ width: 32, height: 32, borderRadius: 10, background: (inputValue.trim() || attachments.length > 0 || folderContexts.length > 0) ? "#201e24" : "#f4f4f4", border: (inputValue.trim() || attachments.length > 0 || folderContexts.length > 0) ? "none" : "1px solid #e8e6d9", color: (inputValue.trim() || attachments.length > 0 || folderContexts.length > 0) ? "#ffffff" : "#a1a1aa", cursor: (inputValue.trim() || attachments.length > 0 || folderContexts.length > 0) ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            )}
        </div>
    );

    const formatSubagentLabel = (agent: string) => {
        const normalized = (agent || "sub-agent").replace(/[_-]+/g, " ").trim();
        return normalized ? normalized.replace(/\b\w/g, c => c.toUpperCase()) : "Sub-Agent";
    };

    const renderSubagentSpawnAttachment = () => {
        const runningPhases = subagent.phases.filter(p => p.status === "in-progress");
        const activePhase = runningPhases[runningPhases.length - 1];

        if (!subagent.isActive || !activePhase) return null;

        const agentLabel = formatSubagentLabel(activePhase.agent || subagent.coordination?.currentAgent || "sub-agent");
        const statusLabel = runningPhases.length > 1 ? `${runningPhases.length} running` : "Running";

        return (
            <div style={{ padding: "10px 16px 0" }}>
                <button
                    type="button"
                    onClick={() => {
                        setSelectedSubagentToolCall(null);
                        setShowSubagentPanel(true);
                        setIsToolDetailOpen(false);
                        setIsComputerPaneOpen(false);
                    }}
                    title="Open sub-agent details"
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 12,
                        border: "1px solid #e2ddd2",
                        background: "linear-gradient(180deg, #fffefa 0%, #f4f2eb 100%)",
                        boxShadow: "0 2px 6px rgba(32,30,36,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
                        color: "#201e24",
                        cursor: "pointer",
                        textAlign: "left",
                    }}
                >
                    <span
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 9,
                            background: "radial-gradient(circle at 30% 25%, #ffffff 0%, #dbeafe 34%, #7c3aed 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ffffff",
                            boxShadow: "0 7px 18px rgba(59,130,246,0.25)",
                            flexShrink: 0,
                        }}
                    >
                        <CpuChipIcon width={14} height={14} strokeWidth={2.2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 650, color: "#201e24", lineHeight: 1.2 }}>
                            Sub-agent spawned
                        </span>
                        <span style={{ fontSize: 11.5, color: "#7c776f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {agentLabel} · {activePhase.description || "Working on a delegated task"}
                        </span>
                    </span>
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 8px",
                            borderRadius: 999,
                            background: "#eef6ff",
                            color: "#2563eb",
                            fontSize: 11,
                            fontWeight: 650,
                            flexShrink: 0,
                        }}
                    >
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#3b82f6", boxShadow: "0 0 10px rgba(59,130,246,0.7)" }} />
                        {statusLabel}
                    </span>
                    <ChevronRightIcon width={14} height={14} strokeWidth={2.2} color="#8a8886" />
                </button>
            </div>
        );
    };

    // ── Attachment preview strip (shared) ────────────────────────────────────
    const renderAttachmentStrip = () => (
        <>
            {attachments.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 16px 0" }}>
                    {attachments.map(a => (
                        <div key={a.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px 6px 6px", backgroundColor: "#f5f4f0", borderRadius: 8, border: "1px solid #e8e6d9" }}>
                            {a.mimeType.startsWith("image/") && a.base64 ? (
                                <div style={{ width: 40, height: 40, borderRadius: 6, backgroundImage: `url(${a.base64})`, backgroundSize: "cover", backgroundPosition: "center", flexShrink: 0 }} />
                            ) : (
                                <div style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: "rgba(0, 0, 0, 0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <PaperClipIcon width={20} height={20} color="#717171" />
                                </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, color: "#111111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{a.name}</span>
                                <span style={{ fontSize: 11, color: "#8a8886" }}>{(a.size / 1024).toFixed(1)} KB</span>
                            </div>
                            <button onClick={() => setAttachments(prev => prev.filter(att => att.id !== a.id))}
                                style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#ffffff", border: "1px solid #dcdad0", display: "flex", alignItems: "center", justifyContent: "center", color: "#111111", cursor: "pointer", zIndex: 10 }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = "#f5f5e1"}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = "#ffffff"}>
                                <XMarkIcon width={12} height={12} strokeWidth={3} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </>
    );

    // ── Onboarding modal ─────────────────────────────────────────────────────
    const onboardingModalNode = (
        <AnimatePresence>
            {showOnboarding && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,252,240,0.8)", backdropFilter: "blur(16px)" }}>
                    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                        style={{ width: "100%", maxWidth: onboardingStep === "name" ? 440 : 540, backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 32, padding: "48px 32px", textAlign: "center", boxShadow: "0 32px 64px -12px rgba(0,0,0,0.12)" }}>
                        {onboardingStep === "name" ? (
                            <motion.div key="name-step" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                <div style={{ width: 64, height: 64, borderRadius: 24, margin: "0 auto 24px", background: "#f5f4f0", border: "1px solid #e8e6d9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <SparklesIcon width={32} height={32} color="#201e24" />
                                </div>
                                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 34, fontWeight: 500, margin: "0 0 12px", color: "#201e24", letterSpacing: "-0.02em" }}>Welcome to EverFern</h2>
                                <p style={{ fontSize: 16, color: "#8a8886", marginBottom: 32, lineHeight: 1.5 }}>Let's get started. How should your intelligence companion address you?</p>
                                <input type="text" placeholder="Your name..." value={onboardingName} onChange={(e) => setOnboardingName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleNextFromName()}
                                    style={{ width: "100%", padding: "18px 24px", backgroundColor: "#f5f4f0", border: "1px solid #e8e6d9", borderRadius: 18, color: "#201e24", fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 24, textAlign: "center", transition: "all 0.2s", fontFamily: "var(--font-sans)" }}
                                    onFocus={e => { e.target.style.borderColor = "#111111"; e.target.style.backgroundColor = "#ffffff"; }}
                                    onBlur={e => { e.target.style.borderColor = "#e8e6d9"; e.target.style.backgroundColor = "#f5f4f0"; }}
                                />
                                <button onClick={handleNextFromName} disabled={!onboardingName.trim()}
                                    style={{ width: "100%", padding: "18px", backgroundColor: "#201e24", color: "#ffffff", borderRadius: 18, fontWeight: 600, fontSize: 16, border: "none", cursor: onboardingName.trim() ? "pointer" : "not-allowed", opacity: onboardingName.trim() ? 1 : 0.4, transition: "all 0.2s" }}
                                    onMouseEnter={e => { if (onboardingName.trim()) e.currentTarget.style.transform = "translateY(-1px)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
                                    Get Started
                                </button>
                            </motion.div>
                        ) : (
                            <motion.div key="vlm-step" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                                <div style={{ width: 64, height: 64, borderRadius: 24, margin: "0 auto 24px", background: "#f5f4f0", border: "1px solid #e8e6d9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <CpuChipIcon width={32} height={32} color="#201e24" />
                                </div>
                                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 34, fontWeight: 500, margin: "0 0 12px", color: "#201e24", letterSpacing: "-0.02em" }}>Local Vision AI</h2>
                                <p style={{ fontSize: 15, color: "#8a8886", marginBottom: 32, lineHeight: 1.6 }}>
                                    To see your screen and control your PC locally, EverFern recommends installing the <strong style={{ color: "#201e24" }}>Qwen3 VL (2B)</strong> model via Ollama.
                                </p>
                                {ollamaInstalled === false ? (
                                    <div style={{ padding: "24px", background: "#f5f4f0", borderRadius: 20, border: "1px solid #e8e6d9", marginBottom: 24 }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
                                            <OllamaLogo size={24} />
                                            <span style={{ fontSize: 16, fontWeight: 700, color: "#201e24" }}>Ollama is required</span>
                                        </div>
                                        <button onClick={handleInstallOllama} disabled={isInstallingOllama}
                                            style={{ width: "100%", padding: "14px", backgroundColor: "#201e24", color: "#ffffff", borderRadius: 14, fontWeight: 600, fontSize: 14, border: "none", cursor: isInstallingOllama ? "wait" : "pointer", transition: "all 0.2s" }}>
                                            {isInstallingOllama ? "Installing Ollama..." : "Install Ollama Automatically"}
                                        </button>
                                        {(isInstallingOllama || ollamaInstallDone) && (
                                            <div style={{ marginTop: 20 }}>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                                    <span style={{ fontSize: 12, color: "#8a8886", fontWeight: 500 }}>
                                                        {ollamaInstallPhase === "done" ? "✔ Installation complete!" : ollamaInstallPhase === "finalizing" ? "Finalizing..." : "Downloading Ollama..."}
                                                    </span>
                                                    <span style={{ fontSize: 12, color: "#8a8886", fontFamily: "monospace" }}>{ollamaInstallPct.toFixed(1)}%</span>
                                                </div>
                                                <div style={{ width: "100%", height: 6, borderRadius: 999, background: "#e8e6d9", overflow: "hidden" }}>
                                                    <motion.div animate={{ width: `${ollamaInstallPhase === "finalizing" ? 100 : ollamaInstallPct}%` }} transition={{ ease: "linear", duration: 0.3 }} style={{ height: "100%", borderRadius: 999, background: "#201e24" }} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ padding: "24px", background: "#f5f4f0", borderRadius: 20, border: "1px solid #e8e6d9", marginBottom: 24 }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 10, background: "#ffffff", border: "1px solid #e8e6d9", display: "flex", alignItems: "center", justifyContent: "center" }}><OllamaLogo size={20} /></div>
                                                <div style={{ textAlign: "left" }}>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: "#201e24" }}>Qwen2.5-VL-3B-Thinking</div>
                                                    <div style={{ fontSize: 12, color: "#8a8886" }}>~2.5 GB · Fast Local Inference</div>
                                                </div>
                                            </div>
                                            <CheckCircleIcon width={24} height={24} color="#201e24" style={{ opacity: (isPullingModel || modelInstalled) ? 1 : 0.2 }} />
                                        </div>
                                        <button onClick={handlePullModel} disabled={!!(isPullingModel || isInstallingOllama || modelInstalled)}
                                            style={{ width: "100%", padding: "14px", backgroundColor: modelInstalled ? "transparent" : "#201e24", color: modelInstalled ? "#8a8886" : "#ffffff", borderRadius: 14, fontWeight: 600, fontSize: 14, border: modelInstalled ? "1px solid #e8e6d9" : "none", cursor: (isPullingModel || isInstallingOllama) ? "wait" : (modelInstalled ? "default" : "pointer"), transition: "all 0.2s" }}>
                                            {modelInstalled ? "✔ Ready to use" : (isPullingModel ? `Downloading... ${pullPct.toFixed(1)}%` : "Download & Setup")}
                                        </button>
                                        {isPullingModel && (
                                            <div style={{ marginTop: 14 }}>
                                                <div style={{ width: "100%", height: 6, borderRadius: 999, background: "#e8e6d9", overflow: "hidden" }}>
                                                    <motion.div animate={{ width: `${pullPct}%` }} transition={{ ease: "linear", duration: 0.3 }} style={{ height: "100%", borderRadius: 999, background: "#201e24" }} />
                                                </div>
                                                <p style={{ fontSize: 11, color: "#8a8886", marginTop: 8, textAlign: "center" }}>Downloading model weights... ~2.5 GB total</p>
                                            </div>
                                        )}
                                        {modelInstalled && !isPullingModel && (
                                            <div style={{ marginTop: 12, textAlign: "center" }}>
                                                <button onClick={() => finalizeOnboarding(true)} style={{ background: "none", border: "none", color: "#111111", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>Complete Setup →</button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {ollamaLogs.length > 0 && (
                                    <div style={{ width: "100%", height: 120, backgroundColor: "#242322", borderRadius: 12, padding: 12, border: "1px solid #363635", overflowY: "auto", textAlign: "left" }}>
                                        <pre style={{ margin: 0, color: "#8a8886", fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{ollamaLogs.join('\n')}</pre>
                                    </div>
                                )}
                                <div style={{ marginTop: 24 }}>
                                    <button onClick={() => finalizeOnboarding(false)} style={{ background: "none", border: "none", color: "#8a8886", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Skip for now</button>
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    const settingsModalNode = (
        <AnimatePresence>
            {showSettings && (
                <SettingsPage
                    activeProjectId={folderContexts[0]?.path || undefined}
                    onClose={() => setShowSettings(false)}
                    config={config}
                    username={onboardingName || config?.name || 'User'}
                    settingsEngine={settingsEngine}
                    setSettingsEngine={setSettingsEngine}
                    settingsProvider={settingsProvider}
                    setSettingsProvider={setSettingsProvider}
                    settingsApiKey={settingsApiKey}
                    setSettingsApiKey={setSettingsApiKey}
                    settingsCustomModel={settingsCustomModel}
                    setSettingsCustomModel={setSettingsCustomModel}
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
                    settingsVlmCloudKey={settingsVlmCloudKey}
                    setSettingsVlmCloudKey={setSettingsVlmCloudKey}
                    voiceProvider={voiceProvider}
                    setVoiceProvider={setVoiceProvider}
                    voiceDeepgramKey={voiceDeepgramKey}
                    setVoiceDeepgramKey={setVoiceDeepgramKey}
                    voiceElevenlabsKey={voiceElevenlabsKey}
                    setVoiceElevenlabsKey={setVoiceElevenlabsKey}
                    embeddingProvider={embeddingProvider}
                    setEmbeddingProvider={setEmbeddingProvider}
                    embeddingModel={embeddingModel}
                    setEmbeddingModel={setEmbeddingModel}
                    embeddingApiKey={embeddingApiKey}
                    setEmbeddingApiKey={setEmbeddingApiKey}
                    modelValidationStatus={modelValidationStatus}
                    setModelValidationStatus={setModelValidationStatus}
                    isValidatingModel={isValidatingModel}
                    setIsValidatingModel={setIsValidatingModel}
                    ollamaInstalled={ollamaInstalled}
                    modelInstalled={modelInstalled}
                    handleSaveSettings={handleSaveSettings}
                    onOpenVlmOnboarding={() => { setShowSettings(false); checkOllamaStatus(); setOnboardingStep('vlm'); setShowOnboarding(true); }}
                />
            )}
        </AnimatePresence>
    );

    const integrationSettingsModalNode = (
        <IntegrationSettings
            isOpen={showIntegrationSettings}
            onClose={() => setShowIntegrationSettings(false)}
        />
    );

    const handleRecordToggle = useCallback(async () => {
        if (!isRecording) {
            setVoiceLoading(true);
            setVoiceTranscript("");
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream);
                const audioChunks: BlobPart[] = [];
                mediaRecorderRef.current = mediaRecorder;
                audioStreamRef.current = stream;
                mediaRecorder.ondataavailable = (event) => { audioChunks.push(event.data); };
                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    if (voiceProvider === "deepgram" && voiceDeepgramKey) {
                        try {
                            const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en', { method: 'POST', headers: { 'Authorization': `Token ${voiceDeepgramKey}`, 'Content-Type': 'audio/webm' }, body: arrayBuffer });
                            if (response.ok) {
                                const result = await response.json();
                                const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
                                setVoiceTranscript(transcript);
                                setInputValue(transcript);
                                if (transcript.trim()) {
                                    handleSend(transcript);
                                }
                            }
                            else { setVoiceTranscript("Failed to transcribe audio"); }
                        } catch (error) { setVoiceTranscript("Error transcribing audio"); }
                    }
                    stream.getTracks().forEach(track => track.stop());
                    setVoiceLoading(false);
                    mediaRecorderRef.current = null;
                    audioStreamRef.current = null;
                };
                mediaRecorder.start();
                setIsRecording(true);
                voiceTimeoutRef.current = setTimeout(() => { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { mediaRecorderRef.current.stop(); setIsRecording(false); } }, 30000);
            } catch (error) { setVoiceLoading(false); }
        } else {
            setIsRecording(false);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
            if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(track => track.stop());
            if (voiceTimeoutRef.current) { clearTimeout(voiceTimeoutRef.current); voiceTimeoutRef.current = null; }
        }
    }, [isRecording, voiceProvider, voiceDeepgramKey, handleSend]);

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
            (window as any).electronAPI.voiceOverlay.onStateChange((data: any) => {
                if (data.state === 'listening') {
                    if (!isRecording) handleRecordToggle();
                } else if (data.state === 'executing') {
                    if (isRecording) handleRecordToggle();
                }
            });
            return () => (window as any).electronAPI.voiceOverlay.removeListeners();
        }
    }, [isRecording, handleRecordToggle]);

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <>
            <style>{`
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            `}</style>

            {/* Health Check Screen */}
            {showHealthCheck && !healthCheckComplete && (
                <HealthCheckScreen
                    onComplete={(success, errors) => {
                        setHealthCheckComplete(true);
                        setShowHealthCheck(false);
                        // Mark health check as completed in this session
                        sessionStorage.setItem('healthCheckCompleted', 'true');
                        if (!success) {
                            console.warn('Health check completed with errors:', errors);
                        }
                    }}
                    autoStart={true}
                />
            )}

            <div style={{ height: "100vh", backgroundColor: "#f5f4f0", color: "#201e24", fontFamily: "var(--font-sans)", display: "flex", overflow: "hidden" }}>
                <PermissionDialog />
                <ArtifactsPanel isOpen={showArtifacts} onClose={() => { setShowArtifacts(false); setSelectedArtifactName(null); }} activeChatId={activeConversationId} selectedFileName={selectedArtifactName} projectPath={folderContexts[0]?.path} />
                <FileViewerModal
                    file={viewingFile}
                    onClose={() => setViewingFile(null)}
                    chatId={activeConversationId || "default"}
                    projectPath={folderContexts[0]?.path}
                />
                <PlanViewerPanel isOpen={showPlanViewer} onClose={() => setShowPlanViewer(false)} content={planViewerContent} onApprove={handleApprovePlan} />

                <VoiceAssistantUI
                    isOpen={showVoiceAssistant}
                    onClose={() => setShowVoiceAssistant(false)}
                    isRecording={isRecording}
                    voiceLoading={voiceLoading}
                    voiceTranscript={voiceTranscript}
                    voicePlayback={voicePlayback}
                    onRecordToggle={handleRecordToggle}
                    onOutputToggle={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
                    voiceOutputEnabled={voiceOutputEnabled}
                    voiceProvider={voiceProvider}
                    voiceDeepgramKey={voiceDeepgramKey}
                    voiceElevenlabsKey={voiceElevenlabsKey}
                />
            <Sidebar
                isOpen={sidebarOpen}
                onToggle={() => setSidebarOpen(!sidebarOpen)}
                activeConversationId={activeConversationId}
                activeTaskIds={activeTaskIds}
                onSelectConversation={handleSelectConversation}
                onNewChat={handleNewChat}
                onSettingsClick={() => { setShowSettings(true); setShowCustomizeModal(false); setShowArtifacts(false); setShowIntegrationSettings(false); setShowProjectsPage(false); setShowAnalyticsPage(false); }}
                onArtifactsClick={() => { setShowArtifacts(true); setShowSettings(false); setShowCustomizeModal(false); setShowIntegrationSettings(false); setShowProjectsPage(false); setShowAnalyticsPage(false); }}
                onCustomizeClick={() => { setShowDirectoryModal(true); setShowSettings(false); setShowArtifacts(false); setShowIntegrationSettings(false); setShowProjectsPage(false); setShowAnalyticsPage(false); }}
                onIntegrationClick={() => { setShowIntegrationSettings(true); setShowSettings(false); setShowCustomizeModal(false); setShowArtifacts(false); setShowProjectsPage(false); setShowAnalyticsPage(false); }}
                onProjectsClick={() => { setShowProjectsPage(true); setShowSettings(false); setShowCustomizeModal(false); setShowArtifacts(false); setShowIntegrationSettings(false); setShowAnalyticsPage(false); }}
                onAnalyticsClick={() => { setShowAnalyticsPage(true); setShowProjectsPage(false); setShowSettings(false); setShowCustomizeModal(false); setShowArtifacts(false); setShowIntegrationSettings(false); }}
            />

            <CompletionToast />

                <motion.div
                    initial={false}
                    animate={{ marginLeft: sidebarOpen ? 260 : 68 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "#f5f4f0", position: "relative" }}
                >
                    {/* Header */}
                    <header style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", WebkitAppRegion: "drag" } as any}>
                        <div style={{ display: "flex", alignItems: "center", gap: 16, WebkitAppRegion: "no-drag" } as any}>
                            {executionPlan && !isExecutionPlanPaneOpen && (
                                <button onClick={() => {
                                    setIsExecutionPlanPaneOpen(true);
                                    if (activeConversationId) localStorage.removeItem(`everfern_exec_pane_closed_${activeConversationId}`);
                                }} style={{ fontSize: 12, fontWeight: 600, color: "#201e24", backgroundColor: "rgba(0,0,0,0.04)", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                    View Plan
                                </button>
                            )}

                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, WebkitAppRegion: "no-drag" } as any}>
                            <button type="button" style={{ position: "relative", background: "transparent", border: "none", color: "#73716e", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }} onMouseEnter={e => e.currentTarget.style.color = "#111111"} onMouseLeave={e => e.currentTarget.style.color = "#73716e"}>
                                <BellIcon width={20} height={20} />
                                <span style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, backgroundColor: "#ef4444", borderRadius: "50%", color: "#ffffff", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #f5f4f0", fontWeight: 700 }}>2</span>
                            </button>
                            <div style={{ marginLeft: 8 }}><WindowControls /></div>
                        </div>
                    </header>

                    <div style={{ flex: 1, position: "relative", minHeight: 0, display: "flex", flexDirection: "row", backgroundColor: "#ffffff", margin: isToolDetailOpen ? "0 8px 8px 0" : "0 12px 12px 0", borderRadius: isToolDetailOpen ? 24 : 28, border: "1px solid #e8e6d9", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", overflow: "hidden" }}>
                        {/* Main Chat Area */}
                        {showAnalyticsPage ? (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", backgroundColor: "#fff" }}>
                                <AnalyticsPage
                                    onClose={() => setShowAnalyticsPage(false)}
                                    sidebarOpen={sidebarOpen}
                                />
                            </div>
                        ) : showProjectsPage ? (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", backgroundColor: "#fff" }}>
                                <ProjectsPage
                                    onClose={() => setShowProjectsPage(false)}
                                    onCreateNew={() => setShowCreateProjectModal(true)}
                                    onSelectProject={(project) => {
                                        handleNewChat();
                                        // Set conversation ID to project ID for persistent, project-locked context
                                        setActiveConversationId(project.id);
                                        activeConversationIdRef.current = project.id;
                                        setFolderContexts([{ id: project.id, path: project.path, name: project.name }]);
                                        setContextItems([{
                                            id: crypto.randomUUID(),
                                            type: 'folder' as any,
                                            label: project.name,
                                            path: project.path
                                        } as any]);
                                        setShowProjectsPage(false);
                                    }}
                                />
                            </div>
                        ) : (
                        <div style={{ flex: isToolDetailOpen ? "1 1 440px" : 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
                            <div ref={chatScrollRef} style={{ flex: 1, overflowY: "auto", padding: isToolDetailOpen ? "16px 0 24px" : "16px 0 32px" }}>
                                <div style={{ maxWidth: isToolDetailOpen ? 620 : 800, margin: "0 auto", padding: isToolDetailOpen ? "0 22px" : "0 32px" }}>

                                    {/* ── Empty / Home State ── */}
                                    {isEmpty && (
                                        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.7 }}
                                            style={{ marginTop: "14vh", textAlign: "left", display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", maxWidth: 740 }}>
                                            {/* {folderContexts.length === 0 && (
                                                <div style={{ marginBottom: 26, textAlign: "center" }}>
                                                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 8, backgroundColor: "rgba(0, 0, 0, 0.04)", border: "1px solid rgba(0, 0, 0, 0.08)", color: "#717171", fontSize: 13 }}>
                                                        <span>Free plan</span>
                                                        <span style={{ opacity: 0.5 }}>·</span>
                                                        <button type="button" style={{ background: "transparent", border: "none", color: "#4a4846", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline" }} onClick={() => setShowSettings(true)}>Upgrade</button>
                                                    </div>
                                                </div>
                                            )} */}
                                            {folderContexts.length > 0 ? (
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
                                                    <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 44, fontWeight: 400, margin: 0, color: "#201e24", letterSpacing: "-0.01em" }}>
                                                        {folderContexts[0].name}
                                                    </h1>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 6, display: "flex", borderRadius: 8 }} title="Favorite"
                                                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                                        </button>
                                                        <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 6, display: "flex", borderRadius: 8 }} title="More options"
                                                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
                                                    <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 36, fontWeight: 400, margin: 0, color: "#201e24", letterSpacing: "-0.01em" }}>
                                                        {randomGreeting}
                                                    </h1>
                                                </div>
                                            )}

                                            {/* ── Empty state composer ── */}
                                            <div style={{ width: "100%", maxWidth: 740 }}>
                                                {/* Memory Preference Banner */}
                                                {memoryPreferenceBanner && !memoryPreferenceBanner.dismissed && (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: -8 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -8 }}
                                                        transition={{ duration: 0.2 }}
                                                        style={{
                                                            marginBottom: 10,
                                                            padding: "12px 14px",
                                                            backgroundColor: "#faf9f7",
                                                            border: "1px solid #e8e6d9",
                                                            borderLeft: "3px solid #6366f1",
                                                            borderRadius: 10,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 8,
                                                        }}
                                                    >
                                                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                                                                <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
                                                                <path d="M12 8v4M12 16h.01"/>
                                                            </svg>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6366f1", marginBottom: 3, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                                                                    From your previous preferences
                                                                </div>
                                                                <div style={{ fontSize: 13, color: "#4a4846", lineHeight: 1.55 }}>
                                                                    {memoryPreferenceBanner.preference}
                                                                </div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null)}
                                                                style={{ background: "none", border: "none", cursor: "pointer", color: "#b5b2aa", padding: 2, flexShrink: 0 }}
                                                            >
                                                                <XMarkIcon width={14} height={14} />
                                                            </button>
                                                        </div>
                                                        <div style={{ display: "flex", gap: 6, paddingLeft: 22 }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null)}
                                                                style={{
                                                                    fontSize: 12, fontWeight: 500,
                                                                    padding: "4px 12px", borderRadius: 6,
                                                                    backgroundColor: "#6366f1", color: "#fff",
                                                                    border: "none", cursor: "pointer",
                                                                }}
                                                            >
                                                                Continue this way
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null);
                                                                    setInputValue("I'd like to do this differently — ");
                                                                    setTimeout(() => textareaRef.current?.focus(), 50);
                                                                }}
                                                                style={{
                                                                    fontSize: 12, fontWeight: 500,
                                                                    padding: "4px 12px", borderRadius: 6,
                                                                    backgroundColor: "transparent", color: "#4a4846",
                                                                    border: "1px solid #e8e6d9", cursor: "pointer",
                                                                }}
                                                            >
                                                                Do it differently
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                )}

                                                {/* User Question Form (single or multiple questions) */}
                                                {activeUserQuestions.length > 0 && (
                                                    <UserQuestionForm
                                                        questions={activeUserQuestions}
                                                        onSubmit={handleQuestionSubmit}
                                                        previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                    />
                                                )}

                                                {/* HITL Approval Form */}
                                                {showHitlApproval && hitlRequest && (
                                                    <HitlApprovalForm
                                                        request={hitlRequest}
                                                        onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                        onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                    />
                                                )}

                                                 {/* Progressive input container */}
                                                <div style={{ backgroundColor: (isRecording || showVoiceAssistant) ? "transparent" : "#f4f4f4", border: (isRecording || showVoiceAssistant) ? "none" : "1px solid #e8e6d9", borderRadius: 16, display: "flex", flexDirection: "column", minHeight: 120, transition: "all 0.3s ease", position: "relative" }}>
                                                    {renderSubagentSpawnAttachment()}
                                                    {renderAttachmentStrip()}
                                                    <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={activeUserQuestions.length > 0 ? "Please answer the question above" : showHitlApproval ? "Please approve or reject the operation above" : "How can I help you today?"} rows={1}
                                                        disabled={activeUserQuestions.length > 0 || !!showHitlApproval}
                                                        className="placeholder-[#a5a3a0]"
                                                        style={{ width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 16, color: (activeUserQuestions.length > 0 || showHitlApproval) ? "#9ca3af" : "#111111", lineHeight: 1.5, padding: "20px 24px", minHeight: 70, maxHeight: 240 }} />

                                                    {/* Progressive fade at the bottom of the textarea */}
                                                    <div style={{ position: "absolute", bottom: 52, left: 0, right: 0, height: 60, background: "linear-gradient(to bottom, transparent, #f4f4f4 80%)", pointerEvents: "none", borderRadius: "0 0 16px 16px", zIndex: 1 }} />
                                                    <div style={{ flex: 1 }} />
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "10px 24px 16px", position: "relative", zIndex: 2 }}>
                                                        {renderComposerLeftActions()}
                                                        {renderComposerRightActions(false)}
                                                    </div>
                                                </div>

                                                 {/* Quick prompt chips — hidden when a project is selected */}
                                                 {folderContexts.length === 0 && (
                                                     <div style={{ marginTop: 24, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                                                         {[
                                                             { label: "Code", prompt: "Write a Python script that ", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> },
                                                             { label: "Write", prompt: "Draft an email to my manager explaining ", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg> },
                                                             { label: "Learn", prompt: "Explain how the following concept works: ", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14v7M22 9l-10 5L2 9l10-5 10 5z"></path><path d="M6 11v5a6 3 0 0 0 12 0v-5"></path></svg> },
                                                             { label: "Life stuff", prompt: "Create a weekly meal planner for ", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"></path></svg> },
                                                             { label: "Fern's choice", prompt: "Suggest some fun developer productivity tips for ", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 21h4M12 2v2M4.2 6.2l1.4 1.4M18.4 18.4l1.4 1.4M19.8 6.2l-1.4 1.4M5.6 18.4l-1.4 1.4M22 12h-2M4 12H2M12 6a5 5 0 0 0-3 8.7V17h6v-2.3A5 5 0 0 0 12 6z"></path></svg> },
                                                         ].map(c => (
                                                             <button key={c.label} type="button" onClick={() => { setInputValue(prev => prev || c.prompt); setTimeout(() => textareaRef.current?.focus(), 50); }}
                                                                 style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, backgroundColor: "transparent", border: "1px solid #f7f5f2", color: "#201e24", fontSize: 13, cursor: "pointer", transition: "all 0.1s" }}
                                                                 onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#f7f5f2"; e.currentTarget.style.color = "#111111"; }}
                                                                 onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#201e24"; }}>
                                                                 <span style={{ display: 'flex' }}>{c.icon}</span>
                                                                 <span style={{ fontWeight: 400 }}>{c.label}</span>
                                                             </button>
                                                         ))}
                                                     </div>
                                                 )}
                                                {/* Project mode empty state cue */}
                                                {folderContexts.length > 0 && (
                                                    <div style={{ marginTop: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                                                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1cfc9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                                            <line x1="9" y1="10" x2="15" y2="10"/>
                                                            <line x1="9" y1="14" x2="13" y2="14"/>
                                                        </svg>
                                                        <p style={{ fontSize: 15, color: "#111111", margin: 0, fontWeight: 500, textAlign: "center", maxWidth: 360, lineHeight: 1.6 }}>
                                                            Give EverFern a task and it'll pick up your project context automatically.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* Plan Review Card */}
                                    {activePlan && (
                                        <div style={{ maxWidth: 800, margin: "0 auto 24px", padding: "0 32px" }}>
                                            <PlanReviewCard plan={activePlan} onApprove={handleApprovePlan} onEdit={() => setShowArtifacts(true)} />
                                        </div>
                                    )}



                                    {/* Messages */}
                                    <AnimatePresence mode="popLayout">
                                        {messages.map((msg, idx) => {
                                            // Skip assistant messages that are purely noise with no other value
                                            if (msg.role === 'assistant') {
                                                const scrubbed = scrubOrchestratorNoise(msg.content || '').trim();
                                                const hasVisibleContent = scrubbed.length > 0;
                                                const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
                                                const hasReasoning = !!msg.reasoning_content;
                                                const isLatest = idx === messages.length - 1;

                                                if (!hasVisibleContent && !hasToolCalls && !hasReasoning && !isLatest) {
                                                    return null;
                                                }
                                            }

                                            return (
                                                <motion.div
                                                    key={msg.id}
                                                    initial={{ opacity: 0, y: 30, scale: 0.95 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                                                    transition={{ type: "spring", stiffness: 400, damping: 30, delay: Math.min(idx * 0.05, 0.2) }}
                                                    layout
                                                    style={{ marginBottom: 28, display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}
                                                >

                                                <div style={{ maxWidth: msg.role === "user" ? "80%" : "100%", padding: msg.role === "user" ? "12px 18px" : "0", borderRadius: msg.role === "user" ? 16 : 0, borderTopRightRadius: msg.role === "user" ? 4 : 0, background: msg.role === "user" ? "#f5f4f0" : "transparent", border: "none", fontSize: 15, lineHeight: 1.7 }}>
                                                    {msg.role === "user" ? (
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                            {msg.attachments && msg.attachments.length > 0 && (
                                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                                                    {msg.attachments.map(a => (
                                                                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", backgroundColor: "#f5f4f0", borderRadius: 8, border: "1px solid #e8e6d9" }}>
                                                                            {a.mimeType.startsWith("image/") && a.base64 ? <div style={{ width: 32, height: 32, borderRadius: 4, backgroundImage: `url(${a.base64})`, backgroundSize: "cover", backgroundPosition: "center" }} /> : <PaperClipIcon width={16} height={16} color="#717171" />}
                                                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                                                <span style={{ fontSize: 12, fontWeight: 500, color: "#111111", maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                                                                                <span style={{ fontSize: 10, color: "#8a8886" }}>{(a.size / 1024).toFixed(1)} KB</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {(() => {
                                                                if (!msg.content) return null;
                                                                const parts = msg.content.split(/\n\n\[Shared folder context\]\n/);
                                                                const mainText = parts[0];
                                                                const folderContextBlock = parts.length > 1 ? parts[1].split("\n\nNote:")[0] : null;
                                                                const folderLines = folderContextBlock ? folderContextBlock.split('\n').filter(l => l.startsWith('- ')).map(l => l.substring(2).trim()) : [];
                                                                const isPlanApproved = mainText?.startsWith('[PLAN_APPROVED]');
                                                                const planText = isPlanApproved ? mainText.replace('[PLAN_APPROVED]\n', '').trim() : null;
                                                                return (
                                                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                                        {isPlanApproved ? (
                                                                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                                                                <PlanApprovalBanner />
                                                                                {planText && planText !== 'I have reviewed and approved your execution plan. Please proceed with the execution as planned.' && (
                                                                                    <span style={{ color: "#111111", whiteSpace: "pre-wrap" }}>{planText}</span>
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            mainText && <span style={{ color: "#111111", whiteSpace: "pre-wrap" }}>{mainText}</span>
                                                                        )}
                                                                        {folderLines.length > 0 && (
                                                                            <div style={{ padding: "12px 16px", backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 12 }}>
                                                                                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a8886", marginBottom: 8, display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase" }}>
                                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                                                                    Shared context
                                                                                </div>
                                                                                <div style={{ fontSize: 13, color: "#4a4846", display: "flex", flexDirection: "column", gap: 4 }}>
                                                                                    {folderLines.map((line, idx) => <div key={idx} style={{ wordBreak: "break-all", display: "flex", gap: 6 }}><span style={{ color: "#8a8886" }}>-</span> {line}</div>)}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    ) : (
                                                        <>
                                                        <div
                                                            className="overflow-y-auto pr-3 custom-scrollbar"
                                                            style={{
                                                                maxHeight: "calc(100vh - 280px)",
                                                                position: "relative",
                                                                paddingLeft: "12px"
                                                            }}
                                                        >
                                                            <AgentTimeline
                                                                key={`timeline-${msg.id}`}
                                                                toolCalls={msg.toolCalls || []}
                                                                thought={msg.thought}
                                                                reasoningContent={msg.reasoning_content}
                                                                isLive={false}
                                                                currentPhase={currentPhase}
                                                                currentNode={currentNode}
                                                                subAgentProgress={subAgentProgress}
                                                                generatedTitle={msg.generatedTitle}
                                                                missionTimeline={msg.missionTimeline || missionTimeline}
                                                                onPillClick={handlePillClick}
                                                            />
                                                        </div>
                                                            {msg.stopped && (
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 8,
                                                                    padding: '10px 14px',
                                                                    marginTop: 12,
                                                                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                                                    borderRadius: 10,
                                                                    fontSize: 13,
                                                                    color: '#ef4444',
                                                                    fontWeight: 500
                                                                }}>
                                                                    <StopIcon width={14} height={14} />
                                                                    <span>Stopped by user</span>
                                                                </div>
                                                            )}


                                                            {(() => {
                                                                const { cleanContent, artifacts } = extractFileArtifacts(msg.content || '');
                                                                let displayContent = scrubOrchestratorNoise(cleanContent.trim());
                                                                if (displayContent === 'Working...' || displayContent === 'Working') {
                                                                    displayContent = '';
                                                                }
                                                                const hasContent = displayContent.length > 0;
                                                                const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;

                                                                return (
                                                                    <>
                                                                        {hasContent ? (
                                                                            <StreamingMarkdown content={displayContent} isLive={false} isLatest={idx === messages.length - 1} />
                                                                        ) : hasToolCalls ? (
                                                                            <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', padding: '8px 0' }}>

                                                                            </div>
                                                                        ) : null}
                                                                        {artifacts.map((art, i) => (
                                                                            <div key={i} style={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                                                                                <FileArtifact
                                                                                    path={art.path}
                                                                                    description={art.description}
                                                                                    chatId={activeConversationId || ""}
                                                                                    onOpenArtifact={(name) => {
                                                                                        setViewingFile({ name, path: art.path });
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        ))}
                                                                    </>
                                                                );
                                                            })()}
                                                            <ReportContainer
                                                                content={msg.content}
                                                                onView={(label, path) => {
                                                                    const filename = path.split(/[\\/]/).pop() || label;
                                                                    setViewingFile({ name: filename, path });
                                                                }}
                                                            />
                                                            {msg.role === "assistant" && currentSites.length > 0 && currentSites.some(site => site.chatId === activeConversationId) && (
                                                                <div style={{ marginTop: 12 }}>
                                                                    {currentSites.filter(site => site.chatId === activeConversationId).map(site => <SitePreview key={site.id} chatId={activeConversationId || ""} filename={site.id} />)}
                                                                </div>
                                                            )}

                                                            {msg.toolCalls?.filter(tc => tc.toolName === 'visualize').map(tc => (
                                                                <InlineVisualization
                                                                    key={tc.id}
                                                                    html={tc.args?.html as string || ''}
                                                                    css={tc.args?.css as string}
                                                                    js={tc.args?.js as string}
                                                                    title={tc.args?.title as string}
                                                                    height={tc.args?.height as number}
                                                                />
                                                            ))}
                                                            <RateLimitContinueButton content={msg.content} onContinue={() => handleSend("continue")} />

                                                            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 12 }}>
                                                                <button
                                                                    onClick={() => handleUndoTurn(idx)}
                                                                    title="Undo Turn"
                                                                    className="hover:text-zinc-600 transition-colors"
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: 'none',
                                                                        padding: '4px',
                                                                        color: '#b0afa8',
                                                                        cursor: 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center'
                                                                    }}
                                                                >
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M3 7v6h6" />
                                                                        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </motion.div>
                                        );
                                    })
                                }
                                    </AnimatePresence>



                                    {/* Live streaming state - hide if last message already has this content (prevent duplicates).
                                        Exception: when HITL or user question is active, always show the streaming bubble
                                        so the previous agent message doesn't disappear while the form is shown. */}
                                    {(isLoading || (streamingContent && (activeUserQuestions.length > 0 || showHitlApproval))) && (
                                        (activeUserQuestions.length > 0 || showHitlApproval) ||
                                        !(messages.length > 0 && messages[messages.length - 1].role === "assistant" && streamingContent && messages[messages.length - 1].content?.trim() === streamingContent?.trim())
                                    ) && (
                                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 32, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>

                                            <div style={{ width: "100%" }}>
                                                <AgentTimeline
                                                    key={activeConversationId || 'new'}
                                                    toolCalls={liveToolCalls}
                                                    thought={streamingThought}
                                                    reasoningContent={undefined}
                                                    isLive={true}
                                                    currentPhase={currentPhase}
                                                    currentNode={currentNode}
                                                    planSteps={activePlanSteps}
                                                    planTitle={activePlanTitle}
                                                    subAgentProgress={subAgentProgress}
                                                    debateData={debateData}
                                                    isDebating={isDebating}
                                                    debateId={lastDebateId}
                                                    onSkipDebate={skipDebate}
                                                    missionTimeline={missionTimeline}
                                                    onPillClick={handlePillClick}
                                                />
                                                {/* Live streaming tool call cards — show tool calls being built in real-time */}
                                                {streamingToolCalls.length > 0 && (
                                                    <div className="mt-2 space-y-1">
                                                        {streamingToolCalls.map(tc => (
                                                            <LiveToolCallCard key={tc.index} {...tc} />
                                                        ))}
                                                    </div>
                                                )}
                                                {activeSurface && (
                                                    <SurfaceCanvas data={activeSurface} />
                                                )}

                                                {(() => {
                                                    const { cleanContent: artifactCleanContent, artifacts } = extractFileArtifacts(streamingContent || '');

                                                    // Scrub tool calls and orchestrator noise from streaming content
                                                    let cleanContent = scrubOrchestratorNoise(
                                                        artifactCleanContent.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim()
                                                    );
                                                    if (cleanContent === 'Working...' || cleanContent === 'Working') {
                                                        cleanContent = '';
                                                    }

                                                    return (
                                                        <>
                                                            {(cleanContent || streamingContent) && <StreamingMarkdown content={cleanContent} isLive={true} />}
                                                            {artifacts.map((art, i) => (

                                                                <div key={i} style={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                                                                    <FileArtifact
                                                                        path={art.path}
                                                                        description={art.description}
                                                                        chatId={activeConversationId || ""}
                                                                        onOpenArtifact={(name) => {
                                                                            setViewingFile({ name, path: art.path });
                                                                        }}
                                                                    />
                                                                </div>
                                                            ))}
                                                            {liveToolCalls.filter(tc => tc.toolName === 'visualize').map(tc => (
                                                                <InlineVisualization
                                                                    key={tc.id}
                                                                    html={tc.args?.html as string || ''}
                                                                    css={tc.args?.css as string}
                                                                    js={tc.args?.js as string}
                                                                    title={tc.args?.title as string}
                                                                    height={tc.args?.height as number}
                                                                />
                                                            ))}
                                                        </>
                                                    );
                                                })()}

                                                {!streamingContent && liveToolCalls.length === 0 && !streamingThought && activeUserQuestions.length === 0 && !showHitlApproval && !isDebating && (
                                                    <LoadingBreadcrumb text={getNodeDisplayName(currentNode)} />
                                                )}
                                                {(activeUserQuestions.length > 0 || showHitlApproval) && (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        padding: '16px 20px',
                                                        backgroundColor: '#f0f9ff',
                                                        border: '1px solid #bfdbfe',
                                                        borderRadius: 8,
                                                        margin: '16px 20px',
                                                        color: '#1e40af',
                                                        fontSize: 14,
                                                        fontWeight: 600
                                                    }}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <circle cx="12" cy="12" r="10"/>
                                                            <path d="M9,9h6v6H9z"/>
                                                        </svg>
                                                        Waiting for your input
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            </div>

                            {/* ── Progressive blur + morphing scroll-to-bottom button ── */}
                            {!isEmpty && (
                                <div className="relative pointer-events-none h-0">
                                    {/* Progressive blur above the composer */}
                                    <div
                                        className="absolute bottom-0 left-0 right-0 pointer-events-none h-24 z-10"
                                        style={{
                                            background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.98) 75%)',
                                        }}
                                    />
                                    {/* Morphing scroll-to-bottom button */}
                                    <AnimatePresence>
                                        {isScrolledUp && (
                                            <motion.button
                                                key="scroll-to-bottom"
                                                type="button"
                                                onClick={() => { scrollToBottom(); }}
                                                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.8, y: 10, filter: 'blur(8px)' }}
                                                transition={{
                                                    type: 'spring',
                                                    stiffness: 400,
                                                    damping: 25,
                                                }}
                                                whileHover={{ scale: 1.15, backgroundColor: '#000000' }}
                                                whileTap={{ scale: 0.9 }}
                                                className="pointer-events-auto absolute left-1/2 -translate-x-1/2 z-20 w-11 h-11 rounded-full flex items-center justify-center cursor-pointer shadow-2xl backdrop-blur-md"
                                                style={{
                                                    bottom: 24,
                                                    backgroundColor: '#111111',
                                                    border: '1px solid rgba(255,255,255,0.15)',
                                                    boxShadow: '0 8px 30px rgba(0,0,0,0.28)',
                                                }}
                                            >
                                                <svg
                                                    width={22}
                                                    height={22}
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="#ffffff"
                                                    strokeWidth={2.5}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <path d="M12 5v14M5 12l7 7 7-7" />
                                                </svg>
                                            </motion.button>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}

                            {/* ── Non-empty bottom composer ── */}
                            {!isEmpty && (
                                <div style={{ padding: "0 24px 12px", width: "100%", maxWidth: 848, margin: "0 auto", position: "relative", zIndex: 50 }}>
                                    <AnimatePresence>
                                        {showPermissionModal && (
                                            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.2 }} style={{ width: "96%", maxWidth: 840, margin: "0 auto", position: "relative", zIndex: 1 }}>
                                                <div style={{ width: "100%", background: "#161615", border: "1px solid rgba(255, 255, 255, 0.12)", borderBottom: "none", borderRadius: "20px 20px 0 0", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                                                    {/* Header with Title and Controls */}
                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                                            <div style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: showPermissionModal ? "rgba(251, 191, 36, 0.15)" : "rgba(255, 255, 255, 0.05)", border: showPermissionModal ? "1px solid rgba(251, 191, 36, 0.3)" : "1px solid transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                                {showPermissionModal ? <span style={{ fontSize: 16 }}>🔒</span> : <Loader size={14} strokeWidth={2} className="text-zinc-300" />}
                                                            </div>
                                                            <div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Fern needs permission to access your system files</div>
                                                                </div>
                                                                <div style={{ fontSize: 12, color: "#fcd34d", marginTop: 2 }}>Fern will be able to read and organize files in the folders you share.</div>
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                        </div>
                                                    </div>

                                                    {/* Progress and Visual History */}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Screenshot Zoom Overlay */}
                                    <AnimatePresence>
                                        {zoomedScreenshot && (
                                            <motion.div
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                onClick={() => setZoomedScreenshot(null)}
                                                style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, cursor: 'zoom-out', backdropFilter: 'blur(8px)' }}
                                            >
                                                <motion.div
                                                    initial={{ scale: 0.9, y: 20 }}
                                                    animate={{ scale: 1, y: 0 }}
                                                    style={{ maxWidth: '95%', maxHeight: '95%', position: 'relative' }}
                                                >
                                                    <img src={zoomedScreenshot} style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 16, boxShadow: '0 30px 60px rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)' }} />
                                                    <div style={{ position: 'absolute', top: -48, right: 0, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: 20, backdropFilter: 'blur(4px)' }}>
                                                        <XMarkIcon width={18} height={18} strokeWidth={2.5} /> Close Preview
                                                    </div>
                                                </motion.div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div style={{ width: "100%", maxWidth: isToolDetailOpen ? 620 : 860, margin: "0 auto 8px auto", padding: isToolDetailOpen ? "0 12px" : "0 16px", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
                                        {/* Task 7.4: Local Execution Permission Card — above input */}
                                        {localExecutionRequest && (
                                            <div style={{ padding: '0 0 12px' }}>
                                                <LocalExecutionPermissionCard
                                                    command={localExecutionRequest.command}
                                                    shellType={localExecutionRequest.shellType as "Bash" | "PowerShell"}
                                                    reason={localExecutionRequest.reason}
                                                    agentName="EverFern"
                                                    onDeny={() => {
                                                        respondToLocalExecutionRequest(localExecutionRequest, false, false);
                                                    }}
                                                    onAlwaysAllow={() => {
                                                        respondToLocalExecutionRequest(localExecutionRequest, true, true);
                                                    }}
                                                    onAllowOnce={() => {
                                                        respondToLocalExecutionRequest(localExecutionRequest, true, false);
                                                    }}
                                                />
                                            </div>
                                        )}
                                        <div style={{ width: "100%", backgroundColor: (isRecording || showVoiceAssistant) ? "transparent" : "#ffffff", border: (isRecording || showVoiceAssistant) ? "none" : "1px solid #e8e6d9", borderRadius: showPermissionModal ? "0 0 16px 16px" : 16, position: "relative", zIndex: 2, display: "flex", flexDirection: "column", minHeight: 100, transition: "all 0.3s ease" }}>
                                            {/* Memory Preference Banner */}
                                            {memoryPreferenceBanner && !memoryPreferenceBanner.dismissed && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -8 }}
                                                    transition={{ duration: 0.2 }}
                                                    style={{
                                                        margin: "12px 16px 0",
                                                        padding: "12px 14px",
                                                        backgroundColor: "#faf9f7",
                                                        border: "1px solid #e8e6d9",
                                                        borderLeft: "3px solid #6366f1",
                                                        borderRadius: 10,
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 8,
                                                    }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                                                            <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
                                                            <path d="M12 8v4M12 16h.01"/>
                                                        </svg>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", marginBottom: 3, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                                                                From your previous preferences
                                                            </div>
                                                            <div style={{ fontSize: 12.5, color: "#4a4846", lineHeight: 1.55 }}>
                                                                {memoryPreferenceBanner.preference}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null)}
                                                            style={{ background: "none", border: "none", cursor: "pointer", color: "#b5b2aa", padding: 2, flexShrink: 0 }}
                                                        >
                                                            <XMarkIcon width={14} height={14} />
                                                        </button>
                                                    </div>
                                                    <div style={{ display: "flex", gap: 6, paddingLeft: 22 }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null)}
                                                            style={{
                                                                fontSize: 11.5, fontWeight: 500,
                                                                padding: "4px 12px", borderRadius: 6,
                                                                backgroundColor: "#6366f1", color: "#fff",
                                                                border: "none", cursor: "pointer",
                                                            }}
                                                        >
                                                            Continue this way
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setMemoryPreferenceBanner(b => b ? { ...b, dismissed: true } : null);
                                                                setInputValue("I'd like to do this differently — ");
                                                                setTimeout(() => textareaRef.current?.focus(), 50);
                                                            }}
                                                            style={{
                                                                fontSize: 11.5, fontWeight: 500,
                                                                padding: "4px 12px", borderRadius: 6,
                                                                backgroundColor: "transparent", color: "#4a4846",
                                                                border: "1px solid #e8e6d9", cursor: "pointer",
                                                            }}
                                                        >
                                                            Do it differently
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* User Question Form (single or multiple questions) */}
                                            {activeUserQuestions.length > 0 && (
                                                <div style={{ padding: '16px 20px 0' }}>
                                                    <UserQuestionForm
                                                        questions={activeUserQuestions}
                                                        onSubmit={handleQuestionSubmit}
                                                        previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                    />
                                                </div>
                                            )}

                                            {/* HITL Approval Form */}
                                            {showHitlApproval && hitlRequest && (
                                                <div style={{ padding: '16px 20px 0' }}>
                                                    <HitlApprovalForm
                                                        request={hitlRequest}
                                                        onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                        onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                    />
                                                </div>
                                            )}

                                            {renderSubagentSpawnAttachment()}
                                            {renderAttachmentStrip()}
                                            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, paddingRight: 12 }}>
                                                    <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={activeUserQuestions.length > 0 ? "Please answer the question above" : showHitlApproval ? "Please approve or reject the operation above" : "How can I help you today?"} rows={1}
                                                        disabled={activeUserQuestions.length > 0 || !!showHitlApproval}
                                                        style={{ flex: 1, width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", fontSize: 16, color: (activeUserQuestions.length > 0 || showHitlApproval) ? "#9ca3af" : "#111111", lineHeight: 1.5, padding: "16px 20px", minHeight: 50, maxHeight: 240 }} />
                                                </div>


                                            </div>
                                            {(isRecording || voiceLoading || voiceTranscript) && (
                                                <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                                                    {isRecording && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" }} /><span style={{ fontSize: 13, color: "#ef4444" }}>Recording...</span></div>}
                                                    {voiceLoading && <span style={{ fontSize: 13, color: "#10b981" }}>Transcribing...</span>}
                                                    {voiceTranscript && !isRecording && !voiceLoading && <span style={{ fontSize: 13, color: "#717171", fontStyle: "italic" }}>✓ {voiceTranscript.substring(0, 50)}{voiceTranscript.length > 50 ? '...' : ''}</span>}
                                                </div>
                                            )}

                                            <div style={{ flex: 1 }} />
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "10px 24px 16px" }}>
                                                {renderComposerLeftActions()}
                                                {renderComposerRightActions(true)}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: "center", fontSize: 11, color: "#71717a", marginTop: 14 }}>
                                            Everfern is an agentic AI and can make mistakes. Please double-check responses.
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* Right Sidebar — panel switcher and content */}
                        <div style={{ width: 380, flexShrink: 0, display: isToolDetailOpen || isComputerPaneOpen ? "none" : "flex", flexDirection: "column", overflowY: "auto", padding: "16px 16px", gap: 16 }}>

                            {/* Tab switcher for panels */}
                            {(subagent.isActive || selectedSubagentToolCall) && (
                                <div style={{
                                    display: "flex",
                                    gap: 8,
                                    borderBottom: "1px solid #e8e6d9",
                                    paddingBottom: 12,
                                    marginBottom: 8
                                }}>
                                    <button
                                        onClick={() => { setShowSubagentPanel(true); setSelectedSubagentToolCall(null); }}
                                        style={{
                                            padding: "6px 12px",
                                            borderRadius: 6,
                                            border: "none",
                                            background: showSubagentPanel && !selectedSubagentToolCall ? "#e8e6d9" : "transparent",
                                            cursor: "pointer",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            color: "#4a4846",
                                            transition: "all 0.2s"
                                        }}
                                    >
                                        Agents
                                    </button>
                                    {selectedSubagentToolCall && (
                                        <button
                                            onClick={() => setShowSubagentPanel(false)}
                                            style={{
                                                padding: "6px 12px",
                                                borderRadius: 6,
                                                border: "none",
                                                background: !showSubagentPanel ? "#e8e6d9" : "transparent",
                                                cursor: "pointer",
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: "#4a4846",
                                                transition: "all 0.2s"
                                            }}
                                        >
                                            Tool Details
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Subagent Panel or Tool Call Detail */}
                            {subagent.isActive && showSubagentPanel ? (
                                <SubagentPanel
                                    coordination={subagent.coordination || {
                                        phase: 'exploration',
                                        currentAgent: '',
                                        completedPhases: [],
                                        sharedContext: {}
                                    }}
                                    phases={subagent.phases}
                                />
                            ) : selectedSubagentToolCall ? (
                                <ToolCallDetailPane
                                    toolCall={selectedSubagentToolCall}
                                    onClose={() => setSelectedSubagentToolCall(null)}
                                />
                            ) : null}

                            {/* Instructions card */}
                            {!(subagent.isActive && showSubagentPanel) && !selectedSubagentToolCall ? (
                            <div style={{ backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 10, overflow: "hidden", boxShadow: '0 1px 4px rgba(0,0,0,0.02)' }}>
                                <button
                                    type="button"
                                    onClick={() => setInstructionsExpanded(!instructionsExpanded)}
                                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px", background: "none", border: "none", cursor: "pointer" }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", fontFamily: 'var(--font-sans)', letterSpacing: '0.01em' }}>Instructions</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: instructionsExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
                                    </div>
                                </button>
                                <AnimatePresence>
                                    {instructionsExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            style={{ overflow: "hidden" }}
                                        >
                                            <div style={{ padding: "0 20px 20px" }}>
                                                <textarea
                                                    value={instructions}
                                                    onChange={(e) => setInstructions(e.target.value)}
                                                    placeholder="Add tone, formatting, or rules to guide how EverFern works."
                                                    rows={3}
                                                    style={{ width: "100%", resize: "none", border: "none", outline: "none", fontSize: 13, color: instructions ? "#374151" : "#9ca3af", lineHeight: 1.6, background: "transparent", fontFamily: "var(--font-sans)", fontStyle: instructions ? "normal" : "italic" }}
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            ) : null}

                            {/* Scheduled card */}
                            <ScheduledTasksPanel
                                projectId={folderContexts[0]?.path}
                                onAddTask={() => setShowScheduledTaskModal(true)}
                                refreshTrigger={scheduledTasksRefreshTrigger}
                            />
                            {/* Project Tasks card */}

                            <TasksPanel tasks={panelTasks} path={tasksFilePath} />


                            {/* Context card */}
                            <div style={{ backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 10, overflow: "hidden", boxShadow: '0 1px 4px rgba(0,0,0,0.02)' }}>
                                <button
                                    type="button"
                                    onClick={() => setContextExpanded(!contextExpanded)}
                                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px", background: "none", border: "none", cursor: "pointer" }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", fontFamily: 'var(--font-sans)', letterSpacing: '0.01em' }}>Context</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: contextExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
                                    </div>
                                </button>
                                <AnimatePresence>
                                    {contextExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            style={{ overflow: "hidden" }}
                                        >
                                            <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                                                {/* Project context row */}
                                                {folderContexts.length > 0 ? (
                                                    <div>
                                                        <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Project</p>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, backgroundColor: "#f3f4f6", borderRadius: 8, padding: "8px 10px" }}>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="#4b5563" stroke="none"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                                                            <span style={{ fontSize: 12, fontWeight: 500, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folderContexts[0].name}</span>
                                                            <button type="button" onClick={() => setFolderContexts([])} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0, display: "flex" }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p style={{ fontSize: 12, color: "#9ca3af", margin: 0, fontStyle: "italic", lineHeight: 1.6 }}>No project selected. Use the Project dropdown in the composer.</p>
                                                )}

                                                {/* Memory row */}
                                                <div>
                                                    <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Memory</p>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8, backgroundColor: "#f3f4f6", borderRadius: 8, padding: "8px 10px" }}>
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-10a2 2 0 1 0 2 2 2 2 0 0 0-2-2z"/></svg>
                                                        <span style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>Memory</span>
                                                    </div>
                                                </div>

                                                {/* Decorative Illustration */}
                                                <svg viewBox="0 0 540 170" width="100%" height="auto" style={{ marginTop: 4, borderRadius: 10 }}>
                                                    <defs>
                                                        <filter id="shadow">
                                                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#00000020"/>
                                                        </filter>
                                                    </defs>

                                                    {/* Background */}
                                                    <rect width="540" height="170" rx="12" fill="#E9E5DE"/>

                                                    {/* Card 1 — placed, left */}
                                                    <rect x="30" y="32" width="110" height="108" rx="8" fill="#FFFFFF" filter="url(#shadow)"/>
                                                    <rect x="44" y="50" width="55" height="6" rx="2" fill="#CCCAC4"/>
                                                    <rect x="44" y="63" width="77" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="44" y="75" width="65" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="44" y="87" width="72" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="44" y="99" width="50" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="44" y="111" width="60" height="5" rx="2" fill="#DEDAD5"/>

                                                    {/* Card 2 — placed, center */}
                                                    <rect x="165" y="32" width="110" height="108" rx="8" fill="#FFFFFF" filter="url(#shadow)"/>
                                                    <rect x="245" y="40" width="18" height="18" rx="4" fill="#F0EDE8"/>
                                                    <rect x="249" y="45" width="10" height="3" rx="1" fill="#C5C2BC"/>
                                                    <rect x="249" y="50" width="8"  height="3" rx="1" fill="#C5C2BC"/>
                                                    <rect x="179" y="50" width="55" height="7" rx="2" fill="#C5C2BC"/>
                                                    <rect x="179" y="65" width="88" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="179" y="77" width="80" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="179" y="89" width="88" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="179" y="101" width="70" height="5" rx="2" fill="#DEDAD5"/>
                                                    <rect x="179" y="113" width="78" height="5" rx="2" fill="#DEDAD5"/>

                                                    {/* Card 3 — being placed */}
                                                    <rect x="300" y="32" width="110" height="108" rx="8" fill="#FFFFFF" opacity="0.75" filter="url(#shadow)"/>
                                                    <rect x="300" y="32" width="110" height="108" rx="8" fill="none"
                                                            stroke="#AAAAAA" strokeWidth="1.5" strokeDasharray="5,3"/>
                                                    <rect x="314" y="50" width="55" height="6" rx="2" fill="#D8D5CF" opacity="0.7"/>
                                                    <rect x="314" y="63" width="77" height="5" rx="2" fill="#E2DED9" opacity="0.7"/>
                                                    <rect x="314" y="75" width="65" height="5" rx="2" fill="#E2DED9" opacity="0.7"/>
                                                    <rect x="314" y="87" width="72" height="5" rx="2" fill="#E2DED9" opacity="0.7"/>
                                                    <rect x="314" y="99" width="50" height="5" rx="2" fill="#E2DED9" opacity="0.7"/>
                                                    <rect x="314" y="111" width="60" height="5" rx="2" fill="#E2DED9" opacity="0.7"/>
                                                </svg>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Execution Plan pane (conditional) */}
                            <AnimatePresence>
                                {executionPlan && isExecutionPlanPaneOpen && (() => {
                                    const isPlanAlreadyApproved = messages.some(m => {
                                        const content = typeof m.content === 'string' ? m.content : '';
                                        return content.includes('[PLAN_APPROVED]');
                                    });
                                    const shouldShowApproveButton = !isLoading && !isPlanAlreadyApproved;
                                    return (
                                        <motion.div key="exec-plan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 12, overflow: "hidden", minHeight: 480, width: "100%" }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: "12px 14px", borderBottom: '1px solid #f4f4f4' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <div style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        {isLoading ? (
                                                            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#201e24" strokeWidth="2"><circle cx="12" cy="12" r="10" stroke="#e8e6d9" strokeWidth="4"/><path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="#201e24" stroke="none"/></svg>
                                                        ) : (
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#201e24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                        )}
                                                    </div>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: "#201e24" }}>Execution Plan</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    {shouldShowApproveButton && (
                                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsExecutionPlanPaneOpen(false); if (activeConversationId) localStorage.setItem(`everfern_exec_pane_closed_${activeConversationId}`, "true"); const msg = `[PLAN_APPROVED]\nI have reviewed and approved your execution plan. Please proceed with the execution as planned.`; setInputValue(msg); setTimeout(() => { const sendBtn = document.querySelector('button[title="Send"]') as HTMLButtonElement; if (sendBtn) sendBtn.click(); }, 100); }} style={{ fontSize: 11, fontWeight: 600, color: "#ffffff", backgroundColor: "#201e24", padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", boxShadow: "none" }}>Approve</button>
                                                    )}
                                                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsExecutionPlanPaneOpen(false); if (activeConversationId) localStorage.setItem(`everfern_exec_pane_closed_${activeConversationId}`, "true"); }} style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: 6, cursor: 'pointer' }} title="Close"><XMarkIcon width={14} height={14} color="#6b7280" /></button>
                                                </div>
                                            </div>
                                            <div style={{ padding: "12px 14px", maxHeight: 600, overflowY: 'auto', fontSize: 12, fontFamily: "'Figtree', system-ui, sans-serif", color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                                <MarkdownRenderer content={executionPlan.content} />
                                            </div>
                                        </motion.div>
                                    );
                                })()}
                            </AnimatePresence>

                            {/* Mission Progress card removed — steps shown inline in AgentTimeline */}

                        </div>

                        {/* Fern's Computer Side Pane */}
                        <ComputerPane
                            isOpen={isComputerPaneOpen}
                            onClose={() => setIsComputerPaneOpen(false)}
                            data={activeComputerData}
                        />

                        {/* Tool Detail Side Panel */}
                        <ToolDetailSidePanel
                            isOpen={isToolDetailOpen}
                            toolCall={selectedToolCall}
                            tabs={toolDetailTabs}
                            activeTabId={activeToolDetailTabId}
                            onSelectTab={handleSelectToolDetailTab}
                            onCloseTab={handleCloseToolDetailTab}
                            onClose={() => setIsToolDetailOpen(false)}
                            conversationId={activeConversationId || ""}
                            subAgentProgress={subAgentProgress}
                            subAgentProgressVersion={subAgentProgressVersion}
                        />
                                    </div>
                </motion.div>

                {settingsModalNode}
                {integrationSettingsModalNode}
                <DirectoryModal isOpen={showDirectoryModal} onClose={() => setShowDirectoryModal(false)} />



                <CustomizeModal
                    isOpen={showCustomizeModal}
                    onClose={() => setShowCustomizeModal(false)}
                />
                <ScheduledTaskModal
                    isOpen={showScheduledTaskModal}
                    onClose={() => setShowScheduledTaskModal(false)}
                    onSave={handleSaveScheduledTask}
                />
                <RevertModal
                    isOpen={showRevertModal}
                    onClose={() => { setShowRevertModal(false); setRevertTarget(null); }}
                    onConfirm={handleConfirmRevert}
                    conversationId={revertTarget?.conversationId ?? null}
                    targetTimestamp={revertTarget?.timestamp ?? null}
                />
            </div>
        </>
    );
}
