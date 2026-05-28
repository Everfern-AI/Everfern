/**
 * EverFern Desktop — Preload Script
 *
 * Exposes a secure, typed API to the renderer process via contextBridge.
 * All IPC calls go through this bridge — the renderer never touches
 * Electron internals directly.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { SubAgentProgressEvent } from '../src/app/chat/types';

// ── Type Definitions for Providers ────────────────────────────────

export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'everfern' | 'gemini' | 'nvidia' | 'openrouter';

// ── Type Definitions for Local Execution ──────────────────────────

export interface LocalExecutionRequest {
  type: 'local_execution_request';
  requestId: string;
  command: string;
  shellType: string;
  reason: string;
  conversationId: string;
}

export interface LocalExecutionResponse {
  approved: boolean;
  alwaysAllow: boolean;
}

export interface ProviderMeta {
  type: ProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  isLocal: boolean;
  defaultModel: string;
  engine: 'local' | 'online' | 'everfern';
  baseUrl?: string;
  enabled?: boolean;  // Whether the provider is configured and available
}

export interface FlatModelEntry {
  id: string;           // model ID passed to API calls
  name: string;         // human-readable display name
  provider: string;     // display name of provider
  providerType: ProviderType;
}

// Re-export event types for frontend use
export type { SubAgentProgressEvent } from '../src/app/chat/types';
export type { DebateStreamEvent, DebateDisplayData } from '../src/app/chat/types/debate-types';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window Controls ────────────────────────────────────────────
  window: {
    minimize:    () => ipcRenderer.invoke('window:minimize'),
    maximize:    () => ipcRenderer.invoke('window:maximize'),
    close:       () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  // ── System ───────────────────────────────────────────────────────
  system: {
    getUsername:    () => ipcRenderer.invoke('system:get-username'),
    openFilePicker: (options?: any) => ipcRenderer.invoke('system:open-file-picker', options),
    openFolderPicker: () => ipcRenderer.invoke('system:open-folder-picker'),
    wipeAccount:    () => ipcRenderer.invoke('system:wipe-account'),
    getPermissionStatus: () => ipcRenderer.invoke('permissions:status'),
    grantPermission:     () => ipcRenderer.invoke('permissions:grant'),
    onPermissionRequest: (cb: () => void) => {
      ipcRenderer.on('system:request-permission', () => cb());
    },
    ollamaStatus:  () => ipcRenderer.invoke('system:ollama-status'),
    ollamaInstall: () => ipcRenderer.invoke('system:ollama-install'),
    ollamaPull:    (modelName: string) => ipcRenderer.invoke('system:ollama-pull', modelName),
    onOllamaInstallLine: (cb: (data: { line: string, type: 'stdout'|'stderr' }) => void) => {
      ipcRenderer.on('system:ollama-install-line', (_e, data) => cb(data));
      ipcRenderer.on('system:ollama-pull-line', (_e, data) => cb(data));
    },
    removeOllamaListeners: () => {
      ipcRenderer.removeAllListeners('system:ollama-install-line');
      ipcRenderer.removeAllListeners('system:ollama-pull-line');
    },
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    fetchMetadata: (url: string) => ipcRenderer.invoke('system:fetch-metadata', url),
    checkWSL:       () => ipcRenderer.invoke('system:checkWSL'),
    checkDocker:    () => ipcRenderer.invoke('system:checkDocker'),
    installWSL:     () => ipcRenderer.invoke('system:installWSL'),
    setupDockerUbuntu: () => ipcRenderer.invoke('system:setupDockerUbuntu'),
    toHostPath:     (pathStr: string) => ipcRenderer.invoke('system:to-host-path', pathStr),
    getVersion:     () => ipcRenderer.invoke('system:get-version'),
    checkForUpdates: () => ipcRenderer.invoke('system:check-for-updates'),
    startDispatch:  (config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => ipcRenderer.invoke('system:start-dispatch', config),
    restoreDispatch: (config: { url: string, apiUrl: string, key: string, token: string, userId: string }) => ipcRenderer.invoke('system:restore-dispatch', config),
    stopDispatch:   () => ipcRenderer.invoke('system:stop-dispatch'),
    onDispatchActive: (cb: () => void) => {
      ipcRenderer.on('system:dispatch-active', () => cb());
    },
    onDispatchCommand: (cb: (command: string) => void) => {
      ipcRenderer.on('system:dispatch-command', (_evt, data: { command: string }) => cb(data.command));
    },
    broadcastDispatch: (event: string, data: any) => ipcRenderer.invoke('system:broadcast-dispatch', { event, data }),
  },

  // ── System Tray ──────────────────────────────────────────────────
  tray: {
    showWindow:   () => ipcRenderer.invoke('tray:show-window'),
    hideToTray:   () => ipcRenderer.invoke('tray:hide-to-tray'),
    isSupported:  () => ipcRenderer.invoke('tray:is-supported'),
    updateMenu:   () => ipcRenderer.invoke('tray:update-menu'),
    onOpenSettings: (cb: () => void) => {
      ipcRenderer.on('tray:open-settings', () => cb());
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('tray:open-settings');
    }
  },

  // ── Auto-Start ────────────────────────────────────────────────────
  autoStart: {
    getStatus:        () => ipcRenderer.invoke('autostart:get-status'),
    enable:           () => ipcRenderer.invoke('autostart:enable'),
    disable:          () => ipcRenderer.invoke('autostart:disable'),
    getInfo:          () => ipcRenderer.invoke('autostart:get-info'),
    validateSupport:  () => ipcRenderer.invoke('autostart:validate-support'),
  },

  // ── Config Store ───────────────────────────────────────────────
  saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
  loadConfig: ()            => ipcRenderer.invoke('load-config'),

  // ── Voice Overlay ────────────────────────────────────────────────
  voiceOverlay: {
    onStateChange: (cb: (data: { state: 'idle' | 'listening' | 'executing' }) => void) => {
      ipcRenderer.on('voice-overlay:state', (_e, data) => cb(data));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('voice-overlay:state');
    }
  },

  // ── ACP (AI Completion Provider) ───────────────────────────────
  acp: {
    listProviders: ()            => ipcRenderer.invoke('acp:list-providers'),
    setProvider:   (cfg: any)   => ipcRenderer.invoke('acp:set-provider', cfg),
    healthCheck:   ()            => ipcRenderer.invoke('acp:health-check'),
    listModels:    ()            => ipcRenderer.invoke('acp:list-models'),
    listTools:     ()            => ipcRenderer.invoke('acp:list-tools'),
    chat:          (req: any)   => ipcRenderer.invoke('acp:chat', req),
    stream:        (req: any)   => ipcRenderer.invoke('acp:stream', req),
    stop:          ()            => ipcRenderer.invoke('acp:stop'),

    onStreamChunk: (cb: (chunk: { delta: string; done: boolean }) => void) => {
      ipcRenderer.on('acp:stream-chunk', (_e, chunk) => cb(chunk));
    },
    onThought: (cb: (data: { content: string }) => void) => {
      ipcRenderer.on('acp:thought', (_e, data) => cb(data));
    },
    onModelCallInfo: (cb: (data: { model: string; toolsCount: number }) => void) => {
      ipcRenderer.on('acp:model-call-info', (_e, data) => cb(data));
    },
    onToolStart: (cb: (record: { toolName: string; toolArgs: Record<string, unknown>; toolCallId?: string }) => void) => {
      ipcRenderer.on('acp:tool-start', (_e, record) => {
        if (record.toolName === 'ask_user_question') {
          console.log('[Preload] Received ask_user_question tool-start:', JSON.stringify(record, null, 2));
        }
        cb(record);
      });
    },
    onToolCall: (cb: (record: any) => void) => {
      ipcRenderer.on('acp:tool-call', (_e, record) => {
        if (record.toolName === 'ask_user_question') {
          console.log('[Preload] Received ask_user_question tool-call:', JSON.stringify(record, null, 2));
        }
        cb(record);
      });
    },
    onToolUpdate: (cb: (data: { toolName: string; update: string }) => void) => {
      ipcRenderer.on('acp:tool-update', (_e, data) => cb(data));
    },
    onOptima: (cb: (data: { event: string; details: string }) => void) => {
      ipcRenderer.on('acp:optima', (_e, data) => cb(data));
    },
    onShowArtifact: (cb: (data: { name: string }) => void) => {
      ipcRenderer.on('acp:show-artifact', (_e, data) => cb(data));
    },
    onShowPlan: (cb: (data: { chatId: string; content: string }) => void) => {
      ipcRenderer.on('acp:show-plan', (_e, data) => cb(data));
    },
    onViewSkill: (cb: (data: { name: string }) => void) => {
      ipcRenderer.on('acp:view-skill', (_e, data) => cb(data));
    },
    onSkillDetected: (cb: (data: { skillName: string; skillDescription: string; reason: string }) => void) => {
      ipcRenderer.on('acp:skill-detected', (_e, data) => cb(data));
    },
    onSurfaceAction: (cb: (data: any) => void) => {
      ipcRenderer.on('acp:surface-action', (_e, data) => cb(data));
    },
    onProtocolLink: (cb: (url: string) => void) => {
      ipcRenderer.on('acp:protocol-link', (_e, url) => cb(url));
    },
    onUsage: (cb: (data: { promptTokens: number; completionTokens: number; totalTokens: number }) => void) => {
      ipcRenderer.on('acp:usage', (_e, data) => cb(data));
    },
    onAgentPermissionRequest: (cb: () => void) => {
      ipcRenderer.on('agent:permission-request', () => cb());
    },
    agentPermissionResponse: (granted: boolean) => ipcRenderer.invoke('agent:permission-response', granted),
    getPermissionSoundUrl: () => '/sounds/permission.mp3',
    playSound: (soundPath: string) => ipcRenderer.invoke('audio:play-sound', soundPath),
    validateNvidiaModel: (modelId: string, apiKey: string) => ipcRenderer.invoke('acp:validate-nvidia-model', modelId, apiKey),

    // Mission Timeline Events
    removeMissionListeners: () => {
      ipcRenderer.removeAllListeners('acp:mission-step-update');
      ipcRenderer.removeAllListeners('acp:mission-phase-change');
      ipcRenderer.removeAllListeners('acp:mission-complete');
    },
    onMissionStepUpdate: (cb: (data: { step: any; timeline: any }) => void) => {
      ipcRenderer.removeAllListeners('acp:mission-step-update');
      ipcRenderer.on('acp:mission-step-update', (_e, data) => cb(data));
    },
    onMissionPhaseChange: (cb: (data: { phase: string; timeline: any }) => void) => {
      ipcRenderer.removeAllListeners('acp:mission-phase-change');
      ipcRenderer.on('acp:mission-phase-change', (_e, data) => cb(data));
    },
    onMissionComplete: (cb: (data: { timeline: any; steps: any[] }) => void) => {
      ipcRenderer.removeAllListeners('acp:mission-complete');
      ipcRenderer.on('acp:mission-complete', (_e, data) => cb(data));
    },
    onPlanCreated: (cb: (data: { plan: any }) => void) => {
      ipcRenderer.on('acp:plan-created', (_e, data) => cb(data));
    },
    onHitlRequest: (cb: (data: any) => void) => {
      console.log('[Preload] 🔧 Setting up HITL request listener');
      ipcRenderer.on('acp:hitl-request', (_e, data) => {
        console.log('[Preload] ✅ HITL request received from main process:', data);
        cb(data);
      });
    },
    sendHitlResponse: (response: string) => {
      console.log('[Preload] 📤 Sending HITL response to main process:', response);
      ipcRenderer.send('acp:hitl-response', response);
    },
    onHitlResponseProcessed: (cb: (data: { message: string; shouldSendAsMessage: boolean }) => void) => {
      console.log('[Preload] 🔧 Setting up HITL response processed listener');
      ipcRenderer.on('acp:hitl-response-processed', (_e, data) => {
        console.log('[Preload] ✅ HITL response processed received from main process:', data);
        cb(data);
      });
    },
    /**
     * Register a callback for sub-agent progress events.
     * Always replaces any previously registered listener to prevent handler stacking.
     */
    onSubAgentProgress: (cb: (event: SubAgentProgressEvent) => void) => {
      // Remove any existing listener first so we never stack up multiple handlers
      ipcRenderer.removeAllListeners('acp:sub-agent-progress');
      ipcRenderer.on('acp:sub-agent-progress', (_e, event) => cb(event));
    },
    /**
     * Remove sub-agent progress event listener.
     * Call this to clean up the listener when component unmounts.
     */
    removeSubAgentProgressListener: () => {
      ipcRenderer.removeAllListeners('acp:sub-agent-progress');
    },
    onToolCallStart: (cb: (data: { index: number; toolName: string }) => void) => {
      ipcRenderer.on('acp:tool-call-start', (_e, data) => cb(data));
    },
    onToolCallChunk: (cb: (data: { index: number; argumentsDelta: string }) => void) => {
      ipcRenderer.on('acp:tool-call-chunk', (_e, data) => cb(data));
    },
    onToolCallComplete: (cb: (data: { index: number; toolName: string; arguments: Record<string, unknown> }) => void) => {
      ipcRenderer.on('acp:tool-call-complete', (_e, data) => cb(data));
    },

    // Local Execution Events
    onLocalExecutionRequest: (cb: (data: LocalExecutionRequest) => void) => {
      ipcRenderer.on('acp:local-execution-request', (_e, data) => cb(data));
    },
    sendLocalExecutionResponse: (response: LocalExecutionResponse) => {
      ipcRenderer.send('acp:local-execution-response', response);
    },
    removeLocalExecutionListeners: () => {
      ipcRenderer.removeAllListeners('acp:local-execution-request');
    },

    // Debate Stream Events
    onDebateStream: (cb: (event: any) => void) => {
      ipcRenderer.on('debate:stream', (_e, event) => cb(event));
    },
    removeDebateStreamListener: () => {
      ipcRenderer.removeAllListeners('debate:stream');
    },

    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('acp:stream-chunk');
      ipcRenderer.removeAllListeners('acp:thought');
      ipcRenderer.removeAllListeners('acp:tool-start');
      ipcRenderer.removeAllListeners('acp:tool-call');
      ipcRenderer.removeAllListeners('acp:tool-update');
      ipcRenderer.removeAllListeners('acp:optima');
      ipcRenderer.removeAllListeners('acp:show-artifact');
      ipcRenderer.removeAllListeners('acp:show-plan');
      ipcRenderer.removeAllListeners('acp:view-skill');
      ipcRenderer.removeAllListeners('acp:skill-detected');
      ipcRenderer.removeAllListeners('acp:surface-action');
      ipcRenderer.removeAllListeners('acp:usage');
      ipcRenderer.removeAllListeners('agent:permission-request');
      // Intentionally NOT removing mission listeners here to allow persistent tracking
      ipcRenderer.removeAllListeners('acp:plan-created');
      ipcRenderer.removeAllListeners('acp:hitl-request');
      ipcRenderer.removeAllListeners('acp:hitl-response-processed');
      ipcRenderer.removeAllListeners('acp:sub-agent-progress');
      ipcRenderer.removeAllListeners('acp:tool-call-start');
      ipcRenderer.removeAllListeners('acp:tool-call-chunk');
      ipcRenderer.removeAllListeners('acp:tool-call-complete');
      ipcRenderer.removeAllListeners('acp:local-execution-request');
      // NOTE: debate:stream is NOT removed here — it's managed by useDebateStream's
      // own lifecycle (removeDebateStreamListener). Removing it here would kill the
      // debate listener during mid-stream resets and prevent the debate UI from showing.
    },
  },

  // ── Scheduled Tasks ─────────────────────────────────────────────
  scheduledTasks: {
    list:   (projectId?: string) => ipcRenderer.invoke('scheduled-tasks:list', projectId),
    get:    (id: string)        => ipcRenderer.invoke('scheduled-tasks:get', id),
    save:   (task: any)          => ipcRenderer.invoke('scheduled-tasks:save', task),
    delete: (id: string)        => ipcRenderer.invoke('scheduled-tasks:delete', id),
  },

  // ── Chat History ───────────────────────────────────────────────
  history: {
    list:   ()                => ipcRenderer.invoke('history:list'),
    load:   (id: string)     => ipcRenderer.invoke('history:load', id),
    save:   (conv: any)      => ipcRenderer.invoke('history:save', conv),
    delete: (id: string)     => ipcRenderer.invoke('history:delete', id),
    // HITL persistence — check for pending approval requests on load
    hitl: {
      getPending: (conversationId: string) => ipcRenderer.invoke('hitl:get-pending', conversationId),
      resolve:    (conversationId: string, requestId: string, approved: boolean) =>
                    ipcRenderer.invoke('hitl:resolve', conversationId, requestId, approved),
    },
  },

  // ── Memory ───────────────────────────────────────────────────────
  memory: {
    saveDirect: (content: string, metadata?: string) => ipcRenderer.invoke('memory:save-direct', content, metadata),
  },

  // ── Artifacts ────────────────────────────────────────────────
  artifacts: {
    list:   (chatId?: string)                            => ipcRenderer.invoke('artifacts:list', chatId),
    read:   (chatId: string, filename: string)           => ipcRenderer.invoke('artifacts:read', chatId, filename),
    write:  (chatId: string, filename: string, content: string) => ipcRenderer.invoke('artifacts:write', chatId, filename, content),
    delete: (chatId: string, filename: string)           => ipcRenderer.invoke('artifacts:delete', chatId, filename),
  },

  // ── Plans ───────────────────────────────────────────────────────
  plans: {
    list:   (chatId: string)                             => ipcRenderer.invoke('plans:list', chatId),
    read:   (chatId: string, filename: string)          => ipcRenderer.invoke('plans:read', chatId, filename),
    write:  (chatId: string, filename: string, content: string) => ipcRenderer.invoke('plans:write', chatId, filename, content),
    delete: (chatId: string, filename: string)          => ipcRenderer.invoke('plans:delete', chatId, filename),
  },

  // ── Projects ────────────────────────────────────────────────────
  projects: {
    list:   () => ipcRenderer.invoke('projects:list'),
    create: (data: { name: string; instructions?: string; path: string, files?: string[] }) => ipcRenderer.invoke('projects:create', data),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
    getDefaultPath: () => ipcRenderer.invoke('projects:getDefaultPath'),
    selectFolder: () => ipcRenderer.invoke('projects:selectFolder'),
    selectFiles: () => ipcRenderer.invoke('projects:selectFiles'),
    listFiles: (projectPath: string) => ipcRenderer.invoke('projects:listFiles', projectPath),
    readFile: (projectPath: string, filePath: string) => ipcRenderer.invoke('projects:readFile', projectPath, filePath),
  },

  // ── Sites ─────────────────────────────────────────────────────────
  sites: {
    list:   (chatId?: string)                           => ipcRenderer.invoke('sites:list', chatId),
    read:   (chatId: string, filename: string)          => ipcRenderer.invoke('sites:read', chatId, filename),
    write:  (chatId: string, filename: string, content: string) => ipcRenderer.invoke('sites:write', chatId, filename, content),
    delete: (chatId: string, filename?: string)         => ipcRenderer.invoke('sites:delete', chatId, filename),
    openFolder: (chatId: string)                         => ipcRenderer.invoke('sites:open-folder', chatId),
  },

  // ── Terminal Processes ─────────────────────────────────────────────
  terminal: {
    listProcesses: () => ipcRenderer.invoke('terminal:list-processes'),
    killProcess:   (id: string) => ipcRenderer.invoke('terminal:kill-process', id),
    getStatus:     (id: string) => ipcRenderer.invoke('terminal:get-status', id),
  },

  // ── ShowUI Local ──────────────────────────────────────────────────
  showui: {
    install: () => ipcRenderer.invoke('showui:install'),
    launch:  () => ipcRenderer.invoke('showui:launch'),
    onInstallLine: (cb: (data: { line: string, step: number, kind: 'out' | 'err' | 'info' | 'done' | 'fail' }) => void) => {
      ipcRenderer.on('showui:install-line', (_e, data) => cb(data));
    },
    removeInstallListeners: () => ipcRenderer.removeAllListeners('showui:install-line'),
  },

  // ── Vectors ────────────────────────────────────────────────────────
  vectors: {
    search: (query: string, topK?: number, chatId?: string) => ipcRenderer.invoke('vectors:search', query, topK, chatId),
    get: (chatId: string) => ipcRenderer.invoke('vectors:get', chatId),
    delete: (chatId: string) => ipcRenderer.invoke('vectors:delete', chatId),
    stats: () => ipcRenderer.invoke('vectors:stats'),
    indexMessage: (id: string, chatId: string, role: string, content: string, createdAt: number) =>
      ipcRenderer.invoke('vectors:index-message', id, chatId, role, content, createdAt),
    refreshConfig: () => ipcRenderer.invoke('vectors:refresh-config'),
  },

  // ── Debug ──────────────────────────────────────────────────────────
  debug: {
    getLastEvent: () => ipcRenderer.invoke('debug:get-last-event'),
    getChatHistory: () => ipcRenderer.invoke('debug:get-chat-history'),
  },

  // ── Integration Management ─────────────────────────────────────────
  integration: {
    getConfig: () => ipcRenderer.invoke('integration:get-config'),
    saveConfig: (config: any) => ipcRenderer.invoke('integration:save-config', config),
    testConnection: (platform: string) => ipcRenderer.invoke('integration:test-connection', platform),
  },

  // ── Providers ──────────────────────────────────────────────────────
  providers: {
    getAll: () => ipcRenderer.invoke('providers:get-all'),
    getModels: (providerType: string) => ipcRenderer.invoke('providers:get-models', providerType),
  },

  // ── Tool Settings ──────────────────────────────────────────────────
  toolSettings: {
    get: () => ipcRenderer.invoke('tool-settings:get'),
    set: (config: ToolSettingsConfig) => ipcRenderer.invoke('tool-settings:set', config),
    openDebugBrowser: () => ipcRenderer.invoke('debug:open-browser'),
  },

  // ── Chat Title ─────────────────────────────────────────────────────
  chat: {
    generateTitle: (conversationId: string, firstMessage: string) =>
      ipcRenderer.invoke('chat:generate-title', conversationId, firstMessage),
    onTitleUpdated: (cb: (data: { conversationId: string; title: string }) => void) => {
      ipcRenderer.on('chat:title-updated', (_e, data) => cb(data));
    },
    removeTitleUpdatedListener: () => {
      ipcRenderer.removeAllListeners('chat:title-updated');
    },
  },

  // ── Generic Event Listeners ────────────────────────────────────────
  on: (channel: string, cb: (data: any) => void) => {
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  off: (channel: string, cb?: (data: any) => void) => {
    if (cb) {
      ipcRenderer.removeListener(channel, cb as any);
    } else {
      ipcRenderer.removeAllListeners(channel);
    }
  },

  // ── Screenshot Loader ──────────────────────────────────────────────
  screenshot: {
    /** Load a screenshot from disk by its absolute path. Returns { base64, dataUrl } or { error }. */
    load: (filePath: string) => ipcRenderer.invoke('screenshot:load', filePath),
  },
});

// ── Tool Settings Types ────────────────────────────────────────────

export interface ToolConfig {
  mode: 'local' | 'api';
  headless: boolean;
  apiKey: string;
}

export interface ToolSettingsConfig {
  webSearch: ToolConfig;
  webCrawl: ToolConfig;
  browserUse: ToolConfig;
}

// ── Type Export (for renderer use) ────────────────────────────────

export type ElectronAPI = {
  window: {
    minimize:    () => Promise<void>;
    maximize:    () => Promise<void>;
    close:       () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  system: {
    getUsername:    () => Promise<string>;
    openFilePicker: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<{ path: string; name: string; content?: string; base64?: string; mimeType?: string; size?: number; success: boolean, error?: string } | null>;
    openFolderPicker: () => Promise<{ path: string; name: string; success: boolean; error?: string } | null>;
    wipeAccount:    () => Promise<{ success: boolean; error?: string }>;
    getPermissionStatus: () => Promise<{ granted: boolean }>;
    grantPermission:     () => Promise<{ success: boolean }>;
    onPermissionRequest: (cb: () => void) => void;
    ollamaStatus:        () => Promise<{ installed: boolean; modelInstalled: boolean }>;
    ollamaInstall:       () => Promise<{ success: boolean; code: number }>;
    ollamaPull:          (modelName: string) => Promise<{ success: boolean; code: number }>;
    onOllamaInstallLine: (cb: (data: { line: string, type: 'stdout'|'stderr' }) => void) => void;
    removeOllamaListeners: () => void;
    openExternal: (url: string) => Promise<void>;
    fetchMetadata: (url: string) => Promise<{ title?: string; description?: string; favicon?: string } | null>;
    checkWSL:       () => Promise<boolean>;
    checkDocker:    () => Promise<boolean>;
    installWSL:     () => Promise<{ success: boolean; warning?: string; error?: string }>;
    setupDockerUbuntu: () => Promise<{ success: boolean; error?: string }>;
    toHostPath:     (pathStr: string) => Promise<string>;
    getVersion:     () => Promise<string>;
    checkForUpdates: () => Promise<{ hasUpdate: boolean; latestVersion?: string; url?: string; notes?: string; error?: string }>;
    startDispatch:  (config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => Promise<{ success: boolean; error?: string }>;
    restoreDispatch: (config: { url: string, apiUrl: string, key: string, token: string, userId: string }) => Promise<{ success: boolean; session?: any; error?: string }>;
    stopDispatch:   () => Promise<{ success: boolean; error?: string }>;
    onDispatchActive: (cb: () => void) => void;
    onDispatchCommand: (cb: (command: string) => void) => void;
    broadcastDispatch: (event: string, data: any) => Promise<void>;
  };
  tray: {
    showWindow:   () => Promise<{ success: boolean }>;
    hideToTray:   () => Promise<{ success: boolean }>;
    isSupported:  () => Promise<{ supported: boolean }>;
    updateMenu:   () => Promise<{ success: boolean }>;
    onOpenSettings: (cb: () => void) => void;
    removeListeners: () => void;
  };
  autoStart: {
    getStatus:        () => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
    enable:           () => Promise<{ success: boolean; error?: string }>;
    disable:          () => Promise<{ success: boolean; error?: string }>;
    getInfo:          () => Promise<{ success: boolean; info?: { platform: string; method: string; location: string }; error?: string }>;
    validateSupport:  () => Promise<{ success: boolean; validation?: { supported: boolean; reason?: string }; error?: string }>;
  };
  saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
  loadConfig: ()            => Promise<{ success: boolean; config: any; error?: string }>;
  voiceOverlay: {
    onStateChange: (cb: (data: { state: 'idle' | 'listening' | 'executing' }) => void) => void;
    removeListeners: () => void;
  };
  acp: {
    listProviders:         () => Promise<any[]>;
    setProvider:           (cfg: any) => Promise<{ ok: boolean; error?: string }>;
    healthCheck:           () => Promise<{ ok: boolean; error?: string; provider?: string }>;
    listModels:            () => Promise<{ success: boolean; models: string[] }>;
    listTools:             () => Promise<{ success: boolean; tools: { name: string; description: string }[]; error?: string }>;
    chat:                  (req: any) => Promise<any>;
    stream:                (req: any) => Promise<any>;
    onStreamChunk:         (cb: (chunk: { delta: string; done: boolean }) => void) => void;
    onThought:             (cb: (data: { content: string }) => void) => void;
    onToolStart:           (cb: (record: { toolName: string; toolArgs: Record<string, unknown> }) => void) => void;
    onToolCall:            (cb: (record: any) => void) => void;
    onToolUpdate:          (cb: (data: { toolName: string; update: string }) => void) => void;
    onOptima:              (cb: (data: { event: string; details: string }) => void) => void;
    onShowArtifact:        (cb: (data: { name: string }) => void) => void;
    onShowPlan:            (cb: (data: { chatId: string; content: string }) => void) => void;
    onViewSkill:           (cb: (data: { name: string }) => void) => void;
    onSkillDetected:       (cb: (data: { skillName: string; skillDescription: string; reason: string }) => void) => void;
    onSurfaceAction:       (cb: (data: any) => void) => void;
    onProtocolLink:        (cb: (url: string) => void) => void;
    onAgentPermissionRequest: (cb: () => void) => void;
    agentPermissionResponse: (granted: boolean) => Promise<{ success: boolean }>;
    playSound: (soundPath: string) => Promise<boolean>;
    validateNvidiaModel: (modelId: string, apiKey: string) => Promise<{ valid: boolean; hasVision?: boolean; error?: string }>;
    onMissionStepUpdate: (cb: (data: { step: any; timeline: any }) => void) => void;
    onMissionPhaseChange: (cb: (data: { phase: string; timeline: any }) => void) => void;
    onMissionComplete: (cb: (data: { timeline: any; steps: any[]; thinkingDuration?: { startTime: number; endTime?: number; duration?: number } }) => void) => void;
    onPlanCreated: (cb: (data: { plan: any }) => void) => void;
    onHitlRequest: (cb: (data: any) => void) => void;
    sendHitlResponse: (response: string) => void;
    onHitlResponseProcessed: (cb: (data: { message: string; shouldSendAsMessage: boolean }) => void) => void;
    /**
     * Register a callback for sub-agent progress events.
     * @param cb - Callback that receives SubAgentProgressEvent (see src/app/chat/types.ts)
     */
    onSubAgentProgress: (cb: (event: SubAgentProgressEvent) => void) => void;
    /**
     * Remove sub-agent progress event listener.
     * Call this to clean up the listener when component unmounts.
     */
    removeSubAgentProgressListener: () => void;
    onToolCallStart:       (cb: (data: { index: number; toolName: string }) => void) => void;
    onToolCallChunk:       (cb: (data: { index: number; argumentsDelta: string }) => void) => void;
    onToolCallComplete:    (cb: (data: { index: number; toolName: string; arguments: Record<string, unknown> }) => void) => void;
    onLocalExecutionRequest: (cb: (data: LocalExecutionRequest) => void) => void;
    sendLocalExecutionResponse: (response: LocalExecutionResponse) => void;
    removeLocalExecutionListeners: () => void;
    removeStreamListeners: () => void;
    removeMissionListeners: () => void;
  };
  scheduledTasks: {
    list:   (projectId?: string) => Promise<any[]>;
    get:    (id: string)        => Promise<any | null>;
    save:   (task: any)          => Promise<any>;
    delete: (id: string)        => Promise<{ success: boolean; error?: string }>;
  };
  history: {
    list:   () => Promise<any[]>;
    load:   (id: string) => Promise<any>;
    save:   (conv: any)  => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    hitl: {
      getPending: (conversationId: string) => Promise<any | null>;
      resolve:    (conversationId: string, requestId: string, approved: boolean) => Promise<{ success: boolean; error?: string }>;
    };
  };
  memory: {
    saveDirect: (content: string, metadata?: string) => Promise<{ success: boolean; output: string }>;
  };
  artifacts: {
    list:   (chatId?: string) => Promise<any[]>;
    read:   (chatId: string, filename: string) => Promise<string | null>;
    write:  (chatId: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
    delete: (chatId: string, filename: string) => Promise<{ success: boolean }>;
  };
  plans: {
    list:   (chatId: string) => Promise<string[]>;
    read:   (chatId: string, filename: string) => Promise<string | null>;
    write:  (chatId: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
    delete: (chatId: string, filename: string) => Promise<{ success: boolean }>;
  };
  projects: {
    list:   () => Promise<any[]>;
    create: (data: { name: string; instructions?: string; path: string, files?: string[] }) => Promise<{ success: boolean; project?: any; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    getDefaultPath: () => Promise<string>;
    selectFolder: () => Promise<string | null>;
    selectFiles: () => Promise<string[]>;
    listFiles: (projectPath: string) => Promise<{ files: string[] }>;
    readFile: (projectPath: string, filePath: string) => Promise<string | null>;
  };
  sites: {
    list:   (chatId?: string) => Promise<any[]>;
    read:   (chatId: string, filename: string) => Promise<string | null>;
    write:  (chatId: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>;
    delete: (chatId: string, filename?: string) => Promise<{ success: boolean }>;
    openFolder: (chatId: string) => Promise<void>;
  };
  terminal: {
    listProcesses: () => Promise<{ id: string; commandLine: string; status: 'running' | 'done'; exitCode?: number | null; bufferSize: number }[]>;
    killProcess:   (id: string) => Promise<{ success: boolean }>;
    getStatus:     (id: string) => Promise<{ success: boolean; status?: 'running' | 'done'; output?: string; exitCode?: number | null; error?: string }>;
  };
  showui: {
    install: () => Promise<{ success: boolean; showuiDir?: string; error?: string }>;
    launch:  () => Promise<{ success: boolean; error?: string }>;
    onInstallLine: (cb: (data: { line: string, step: number, kind: 'out' | 'err' | 'info' | 'done' | 'fail' }) => void) => void;
    removeInstallListeners: () => void;
  };
  vectors: {
    search: (query: string, topK?: number, chatId?: string) => Promise<any[]>;
    get: (chatId: string) => Promise<any[]>;
    delete: (chatId: string) => Promise<{ success: boolean; error?: string }>;
    stats: () => Promise<{ messageCount: number; storageSize: number; dimensionCount: number | null }>;
    indexMessage: (id: string, chatId: string, role: string, content: string, createdAt: number) => Promise<{ success: boolean; error?: string }>;
    refreshConfig: () => Promise<{ success: boolean; error?: string }>;
  };
  skills: {
    listCustom: () => Promise<{ name: string; description: string; path: string }[]>;
    saveCustom: (data: { name: string; description: string; content: string }) => Promise<{ success: boolean; error?: string }>;
    deleteCustom: (name: string) => Promise<{ success: boolean; error?: string }>;
    getCustomPath: () => Promise<string>;
  };
  debug: {
    getLastEvent: () => Promise<any>;
    getChatHistory: () => Promise<any>;
  };
  integration: {
    getConfig: () => Promise<{
      telegram: {
        enabled: boolean;
        botToken: string;
        webhookUrl?: string;
        connected: boolean;
      };
      discord: {
        enabled: boolean;
        botToken: string;
        applicationId: string;
        webhookUrl?: string;
        connected: boolean;
      };
    }>;
    saveConfig: (config: any) => Promise<void>;
    testConnection: (platform: string) => Promise<boolean>;
  };
  providers: {
    getAll: () => Promise<ProviderMeta[]>;
    getModels: (providerType: string) => Promise<FlatModelEntry[]>;
  };
  toolSettings: {
    get: () => Promise<ToolSettingsConfig>;
    set: (config: ToolSettingsConfig) => Promise<{ success: boolean }>;
  };
  chat: {
    generateTitle: (conversationId: string, firstMessage: string) => Promise<{ queued: boolean }>;
  };
  screenshot: {
    /** Load a screenshot from disk by absolute path. Returns { base64, dataUrl } or { error }. */
    load: (filePath: string) => Promise<{ base64?: string; dataUrl?: string; error?: string }>;
  };
};
