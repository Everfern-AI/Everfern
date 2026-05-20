"use strict";
/**
 * EverFern Desktop — Preload Script
 *
 * Exposes a secure, typed API to the renderer process via contextBridge.
 * All IPC calls go through this bridge — the renderer never touches
 * Electron internals directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // ── Window Controls ────────────────────────────────────────────
    window: {
        minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
        maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
        close: () => electron_1.ipcRenderer.invoke('window:close'),
        isMaximized: () => electron_1.ipcRenderer.invoke('window:is-maximized'),
    },
    // ── System ───────────────────────────────────────────────────────
    system: {
        getUsername: () => electron_1.ipcRenderer.invoke('system:get-username'),
        openFilePicker: (options) => electron_1.ipcRenderer.invoke('system:open-file-picker', options),
        openFolderPicker: () => electron_1.ipcRenderer.invoke('system:open-folder-picker'),
        wipeAccount: () => electron_1.ipcRenderer.invoke('system:wipe-account'),
        getPermissionStatus: () => electron_1.ipcRenderer.invoke('permissions:status'),
        grantPermission: () => electron_1.ipcRenderer.invoke('permissions:grant'),
        onPermissionRequest: (cb) => {
            electron_1.ipcRenderer.on('system:request-permission', () => cb());
        },
        ollamaStatus: () => electron_1.ipcRenderer.invoke('system:ollama-status'),
        ollamaInstall: () => electron_1.ipcRenderer.invoke('system:ollama-install'),
        ollamaPull: (modelName) => electron_1.ipcRenderer.invoke('system:ollama-pull', modelName),
        onOllamaInstallLine: (cb) => {
            electron_1.ipcRenderer.on('system:ollama-install-line', (_e, data) => cb(data));
            electron_1.ipcRenderer.on('system:ollama-pull-line', (_e, data) => cb(data));
        },
        removeOllamaListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('system:ollama-install-line');
            electron_1.ipcRenderer.removeAllListeners('system:ollama-pull-line');
        },
        openExternal: (url) => electron_1.ipcRenderer.invoke('system:open-external', url),
        fetchMetadata: (url) => electron_1.ipcRenderer.invoke('system:fetch-metadata', url),
    },
    // ── System Tray ──────────────────────────────────────────────────
    tray: {
        showWindow: () => electron_1.ipcRenderer.invoke('tray:show-window'),
        hideToTray: () => electron_1.ipcRenderer.invoke('tray:hide-to-tray'),
        isSupported: () => electron_1.ipcRenderer.invoke('tray:is-supported'),
        updateMenu: () => electron_1.ipcRenderer.invoke('tray:update-menu'),
        onOpenSettings: (cb) => {
            electron_1.ipcRenderer.on('tray:open-settings', () => cb());
        },
        removeListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('tray:open-settings');
        }
    },
    // ── Auto-Start ────────────────────────────────────────────────────
    autoStart: {
        getStatus: () => electron_1.ipcRenderer.invoke('autostart:get-status'),
        enable: () => electron_1.ipcRenderer.invoke('autostart:enable'),
        disable: () => electron_1.ipcRenderer.invoke('autostart:disable'),
        getInfo: () => electron_1.ipcRenderer.invoke('autostart:get-info'),
        validateSupport: () => electron_1.ipcRenderer.invoke('autostart:validate-support'),
    },
    // ── Config Store ───────────────────────────────────────────────
    saveConfig: (config) => electron_1.ipcRenderer.invoke('save-config', config),
    loadConfig: () => electron_1.ipcRenderer.invoke('load-config'),
    // ── Voice Overlay ────────────────────────────────────────────────
    voiceOverlay: {
        onStateChange: (cb) => {
            electron_1.ipcRenderer.on('voice-overlay:state', (_e, data) => cb(data));
        },
        removeListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('voice-overlay:state');
        }
    },
    // ── ACP (AI Completion Provider) ───────────────────────────────
    acp: {
        listProviders: () => electron_1.ipcRenderer.invoke('acp:list-providers'),
        setProvider: (cfg) => electron_1.ipcRenderer.invoke('acp:set-provider', cfg),
        healthCheck: () => electron_1.ipcRenderer.invoke('acp:health-check'),
        listModels: () => electron_1.ipcRenderer.invoke('acp:list-models'),
        listTools: () => electron_1.ipcRenderer.invoke('acp:list-tools'),
        chat: (req) => electron_1.ipcRenderer.invoke('acp:chat', req),
        stream: (req) => electron_1.ipcRenderer.invoke('acp:stream', req),
        stop: () => electron_1.ipcRenderer.invoke('acp:stop'),
        onStreamChunk: (cb) => {
            electron_1.ipcRenderer.on('acp:stream-chunk', (_e, chunk) => cb(chunk));
        },
        onThought: (cb) => {
            electron_1.ipcRenderer.on('acp:thought', (_e, data) => cb(data));
        },
        onModelCallInfo: (cb) => {
            electron_1.ipcRenderer.on('acp:model-call-info', (_e, data) => cb(data));
        },
        onToolStart: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-start', (_e, record) => {
                if (record.toolName === 'ask_user_question') {
                    console.log('[Preload] Received ask_user_question tool-start:', JSON.stringify(record, null, 2));
                }
                cb(record);
            });
        },
        onToolCall: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-call', (_e, record) => {
                if (record.toolName === 'ask_user_question') {
                    console.log('[Preload] Received ask_user_question tool-call:', JSON.stringify(record, null, 2));
                }
                cb(record);
            });
        },
        onToolUpdate: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-update', (_e, data) => cb(data));
        },
        onOptima: (cb) => {
            electron_1.ipcRenderer.on('acp:optima', (_e, data) => cb(data));
        },
        onShowArtifact: (cb) => {
            electron_1.ipcRenderer.on('acp:show-artifact', (_e, data) => cb(data));
        },
        onShowPlan: (cb) => {
            electron_1.ipcRenderer.on('acp:show-plan', (_e, data) => cb(data));
        },
        onViewSkill: (cb) => {
            electron_1.ipcRenderer.on('acp:view-skill', (_e, data) => cb(data));
        },
        onSkillDetected: (cb) => {
            electron_1.ipcRenderer.on('acp:skill-detected', (_e, data) => cb(data));
        },
        onSurfaceAction: (cb) => {
            electron_1.ipcRenderer.on('acp:surface-action', (_e, data) => cb(data));
        },
        onProtocolLink: (cb) => {
            electron_1.ipcRenderer.on('acp:protocol-link', (_e, url) => cb(url));
        },
        onUsage: (cb) => {
            electron_1.ipcRenderer.on('acp:usage', (_e, data) => cb(data));
        },
        onAgentPermissionRequest: (cb) => {
            electron_1.ipcRenderer.on('agent:permission-request', () => cb());
        },
        agentPermissionResponse: (granted) => electron_1.ipcRenderer.invoke('agent:permission-response', granted),
        getPermissionSoundUrl: () => '/sounds/permission.mp3',
        playSound: (soundPath) => electron_1.ipcRenderer.invoke('audio:play-sound', soundPath),
        validateNvidiaModel: (modelId, apiKey) => electron_1.ipcRenderer.invoke('acp:validate-nvidia-model', modelId, apiKey),
        // Mission Timeline Events
        removeMissionListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('acp:mission-step-update');
            electron_1.ipcRenderer.removeAllListeners('acp:mission-phase-change');
            electron_1.ipcRenderer.removeAllListeners('acp:mission-complete');
        },
        onMissionStepUpdate: (cb) => {
            electron_1.ipcRenderer.removeAllListeners('acp:mission-step-update');
            electron_1.ipcRenderer.on('acp:mission-step-update', (_e, data) => cb(data));
        },
        onMissionPhaseChange: (cb) => {
            electron_1.ipcRenderer.removeAllListeners('acp:mission-phase-change');
            electron_1.ipcRenderer.on('acp:mission-phase-change', (_e, data) => cb(data));
        },
        onMissionComplete: (cb) => {
            electron_1.ipcRenderer.removeAllListeners('acp:mission-complete');
            electron_1.ipcRenderer.on('acp:mission-complete', (_e, data) => cb(data));
        },
        onPlanCreated: (cb) => {
            electron_1.ipcRenderer.on('acp:plan-created', (_e, data) => cb(data));
        },
        onHitlRequest: (cb) => {
            console.log('[Preload] 🔧 Setting up HITL request listener');
            electron_1.ipcRenderer.on('acp:hitl-request', (_e, data) => {
                console.log('[Preload] ✅ HITL request received from main process:', data);
                cb(data);
            });
        },
        sendHitlResponse: (response) => {
            console.log('[Preload] 📤 Sending HITL response to main process:', response);
            electron_1.ipcRenderer.send('acp:hitl-response', response);
        },
        onHitlResponseProcessed: (cb) => {
            console.log('[Preload] 🔧 Setting up HITL response processed listener');
            electron_1.ipcRenderer.on('acp:hitl-response-processed', (_e, data) => {
                console.log('[Preload] ✅ HITL response processed received from main process:', data);
                cb(data);
            });
        },
        /**
         * Register a callback for sub-agent progress events.
         * Event type: SubAgentProgressEvent (see src/app/chat/types.ts)
         */
        onSubAgentProgress: (cb) => {
            electron_1.ipcRenderer.on('acp:sub-agent-progress', (_e, event) => cb(event));
        },
        /**
         * Remove sub-agent progress event listener.
         * Call this to clean up the listener when component unmounts.
         */
        removeSubAgentProgressListener: () => {
            electron_1.ipcRenderer.removeAllListeners('acp:sub-agent-progress');
        },
        onToolCallStart: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-call-start', (_e, data) => cb(data));
        },
        onToolCallChunk: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-call-chunk', (_e, data) => cb(data));
        },
        onToolCallComplete: (cb) => {
            electron_1.ipcRenderer.on('acp:tool-call-complete', (_e, data) => cb(data));
        },
        // Local Execution Events
        onLocalExecutionRequest: (cb) => {
            electron_1.ipcRenderer.on('acp:local-execution-request', (_e, data) => cb(data));
        },
        sendLocalExecutionResponse: (response) => {
            electron_1.ipcRenderer.send('acp:local-execution-response', response);
        },
        removeLocalExecutionListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('acp:local-execution-request');
        },
        // Debate Stream Events
        onDebateStream: (cb) => {
            electron_1.ipcRenderer.on('debate:stream', (_e, event) => cb(event));
        },
        removeDebateStreamListener: () => {
            electron_1.ipcRenderer.removeAllListeners('debate:stream');
        },
        removeStreamListeners: () => {
            electron_1.ipcRenderer.removeAllListeners('acp:stream-chunk');
            electron_1.ipcRenderer.removeAllListeners('acp:thought');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-start');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-call');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-update');
            electron_1.ipcRenderer.removeAllListeners('acp:optima');
            electron_1.ipcRenderer.removeAllListeners('acp:show-artifact');
            electron_1.ipcRenderer.removeAllListeners('acp:show-plan');
            electron_1.ipcRenderer.removeAllListeners('acp:view-skill');
            electron_1.ipcRenderer.removeAllListeners('acp:skill-detected');
            electron_1.ipcRenderer.removeAllListeners('acp:surface-action');
            electron_1.ipcRenderer.removeAllListeners('acp:usage');
            electron_1.ipcRenderer.removeAllListeners('agent:permission-request');
            // Intentionally NOT removing mission listeners here to allow persistent tracking
            electron_1.ipcRenderer.removeAllListeners('acp:plan-created');
            electron_1.ipcRenderer.removeAllListeners('acp:hitl-request');
            electron_1.ipcRenderer.removeAllListeners('acp:hitl-response-processed');
            electron_1.ipcRenderer.removeAllListeners('acp:sub-agent-progress');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-call-start');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-call-chunk');
            electron_1.ipcRenderer.removeAllListeners('acp:tool-call-complete');
            electron_1.ipcRenderer.removeAllListeners('acp:local-execution-request');
            // NOTE: debate:stream is NOT removed here — it's managed by useDebateStream's
            // own lifecycle (removeDebateStreamListener). Removing it here would kill the
            // debate listener during mid-stream resets and prevent the debate UI from showing.
        },
    },
    // ── Scheduled Tasks ─────────────────────────────────────────────
    scheduledTasks: {
        list: (projectId) => electron_1.ipcRenderer.invoke('scheduled-tasks:list', projectId),
        get: (id) => electron_1.ipcRenderer.invoke('scheduled-tasks:get', id),
        save: (task) => electron_1.ipcRenderer.invoke('scheduled-tasks:save', task),
        delete: (id) => electron_1.ipcRenderer.invoke('scheduled-tasks:delete', id),
    },
    // ── Chat History ───────────────────────────────────────────────
    history: {
        list: () => electron_1.ipcRenderer.invoke('history:list'),
        load: (id) => electron_1.ipcRenderer.invoke('history:load', id),
        save: (conv) => electron_1.ipcRenderer.invoke('history:save', conv),
        delete: (id) => electron_1.ipcRenderer.invoke('history:delete', id),
        // HITL persistence — check for pending approval requests on load
        hitl: {
            getPending: (conversationId) => electron_1.ipcRenderer.invoke('hitl:get-pending', conversationId),
            resolve: (conversationId, requestId, approved) => electron_1.ipcRenderer.invoke('hitl:resolve', conversationId, requestId, approved),
        },
    },
    // ── Memory ───────────────────────────────────────────────────────
    memory: {
        saveDirect: (content, metadata) => electron_1.ipcRenderer.invoke('memory:save-direct', content, metadata),
    },
    // ── Artifacts ────────────────────────────────────────────────
    artifacts: {
        list: (chatId) => electron_1.ipcRenderer.invoke('artifacts:list', chatId),
        read: (chatId, filename) => electron_1.ipcRenderer.invoke('artifacts:read', chatId, filename),
        write: (chatId, filename, content) => electron_1.ipcRenderer.invoke('artifacts:write', chatId, filename, content),
        delete: (chatId, filename) => electron_1.ipcRenderer.invoke('artifacts:delete', chatId, filename),
    },
    // ── Plans ───────────────────────────────────────────────────────
    plans: {
        list: (chatId) => electron_1.ipcRenderer.invoke('plans:list', chatId),
        read: (chatId, filename) => electron_1.ipcRenderer.invoke('plans:read', chatId, filename),
        write: (chatId, filename, content) => electron_1.ipcRenderer.invoke('plans:write', chatId, filename, content),
        delete: (chatId, filename) => electron_1.ipcRenderer.invoke('plans:delete', chatId, filename),
    },
    // ── Projects ────────────────────────────────────────────────────
    projects: {
        list: () => electron_1.ipcRenderer.invoke('projects:list'),
        create: (data) => electron_1.ipcRenderer.invoke('projects:create', data),
        delete: (id) => electron_1.ipcRenderer.invoke('projects:delete', id),
        getDefaultPath: () => electron_1.ipcRenderer.invoke('projects:getDefaultPath'),
        selectFolder: () => electron_1.ipcRenderer.invoke('projects:selectFolder'),
        selectFiles: () => electron_1.ipcRenderer.invoke('projects:selectFiles'),
        listFiles: (projectPath) => electron_1.ipcRenderer.invoke('projects:listFiles', projectPath),
        readFile: (projectPath, filePath) => electron_1.ipcRenderer.invoke('projects:readFile', projectPath, filePath),
    },
    // ── Sites ─────────────────────────────────────────────────────────
    sites: {
        list: (chatId) => electron_1.ipcRenderer.invoke('sites:list', chatId),
        read: (chatId, filename) => electron_1.ipcRenderer.invoke('sites:read', chatId, filename),
        write: (chatId, filename, content) => electron_1.ipcRenderer.invoke('sites:write', chatId, filename, content),
        delete: (chatId, filename) => electron_1.ipcRenderer.invoke('sites:delete', chatId, filename),
        openFolder: (chatId) => electron_1.ipcRenderer.invoke('sites:open-folder', chatId),
    },
    // ── Terminal Processes ─────────────────────────────────────────────
    terminal: {
        listProcesses: () => electron_1.ipcRenderer.invoke('terminal:list-processes'),
        killProcess: (id) => electron_1.ipcRenderer.invoke('terminal:kill-process', id),
    },
    // ── ShowUI Local ──────────────────────────────────────────────────
    showui: {
        install: () => electron_1.ipcRenderer.invoke('showui:install'),
        launch: () => electron_1.ipcRenderer.invoke('showui:launch'),
        onInstallLine: (cb) => {
            electron_1.ipcRenderer.on('showui:install-line', (_e, data) => cb(data));
        },
        removeInstallListeners: () => electron_1.ipcRenderer.removeAllListeners('showui:install-line'),
    },
    // ── Vectors ────────────────────────────────────────────────────────
    vectors: {
        search: (query, topK, chatId) => electron_1.ipcRenderer.invoke('vectors:search', query, topK, chatId),
        get: (chatId) => electron_1.ipcRenderer.invoke('vectors:get', chatId),
        delete: (chatId) => electron_1.ipcRenderer.invoke('vectors:delete', chatId),
        stats: () => electron_1.ipcRenderer.invoke('vectors:stats'),
        indexMessage: (id, chatId, role, content, createdAt) => electron_1.ipcRenderer.invoke('vectors:index-message', id, chatId, role, content, createdAt),
        refreshConfig: () => electron_1.ipcRenderer.invoke('vectors:refresh-config'),
    },
    // ── Debug ──────────────────────────────────────────────────────────
    debug: {
        getLastEvent: () => electron_1.ipcRenderer.invoke('debug:get-last-event'),
        getChatHistory: () => electron_1.ipcRenderer.invoke('debug:get-chat-history'),
    },
    // ── Integration Management ─────────────────────────────────────────
    integration: {
        getConfig: () => electron_1.ipcRenderer.invoke('integration:get-config'),
        saveConfig: (config) => electron_1.ipcRenderer.invoke('integration:save-config', config),
        testConnection: (platform) => electron_1.ipcRenderer.invoke('integration:test-connection', platform),
    },
    // ── Providers ──────────────────────────────────────────────────────
    providers: {
        getAll: () => electron_1.ipcRenderer.invoke('providers:get-all'),
        getModels: (providerType) => electron_1.ipcRenderer.invoke('providers:get-models', providerType),
    },
    // ── Tool Settings ──────────────────────────────────────────────────
    toolSettings: {
        get: () => electron_1.ipcRenderer.invoke('tool-settings:get'),
        set: (config) => electron_1.ipcRenderer.invoke('tool-settings:set', config),
        openDebugBrowser: () => electron_1.ipcRenderer.invoke('debug:open-browser'),
    },
    // ── Chat Title ─────────────────────────────────────────────────────
    chat: {
        generateTitle: (conversationId, firstMessage) => electron_1.ipcRenderer.invoke('chat:generate-title', conversationId, firstMessage),
        onTitleUpdated: (cb) => {
            electron_1.ipcRenderer.on('chat:title-updated', (_e, data) => cb(data));
        },
        removeTitleUpdatedListener: () => {
            electron_1.ipcRenderer.removeAllListeners('chat:title-updated');
        },
    },
    // ── Generic Event Listeners ────────────────────────────────────────
    on: (channel, cb) => {
        electron_1.ipcRenderer.on(channel, (_e, data) => cb(data));
    },
    off: (channel, cb) => {
        if (cb) {
            electron_1.ipcRenderer.removeListener(channel, cb);
        }
        else {
            electron_1.ipcRenderer.removeAllListeners(channel);
        }
    },
});
