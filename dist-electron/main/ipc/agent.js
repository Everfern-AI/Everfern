"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentHandlers = registerAgentHandlers;
const electron_1 = require("electron");
const runner_1 = require("../agent/runner/runner");
const abort_manager_1 = require("../agent/runner/abort-manager");
const manager_1 = require("../acp/manager");
const ai_client_1 = require("../lib/ai-client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
let agentPermissionResolver = null;
let localExecutionResponseResolver = null;
function loadConfigSync() {
    try {
        const configPath = path.join(os.homedir(), '.everfern', 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            // Load API keys from ~/.everfern/keys/
            config.keys = {};
            const keysDir = path.join(os.homedir(), '.everfern', 'keys');
            if (fs.existsSync(keysDir)) {
                const files = fs.readdirSync(keysDir);
                for (const file of files) {
                    if (file.endsWith('.key')) {
                        const baseName = file.replace('.key', '');
                        const key = fs.readFileSync(path.join(keysDir, file), 'utf-8').trim();
                        config.keys[baseName] = key;
                    }
                }
            }
            return config;
        }
    }
    catch (err) {
        console.error('[Config] Error loading config:', err);
    }
    return null;
}
const memory_manager_1 = require("../store/memory-manager");
const providers_1 = require("../lib/providers");
function registerAgentHandlers() {
    // Event-based channels (one-way communication via sender.send):
    // - acp:sub-agent-progress: Sub-agent progress streaming events
    //   Events are sent via sender.send('acp:sub-agent-progress', event)
    //   Used by ProgressEventEmitter in computer-use.ts
    // Provider management
    electron_1.ipcMain.handle('acp:list-providers', () => manager_1.acpManager.listProviders());
    // ── Screenshot Loader ─────────────────────────────────────────────────────
    // Allows the renderer to load a screenshot from disk by its absolute path.
    // Security: only files inside ~/.everfern/screenshots/ are allowed.
    electron_1.ipcMain.handle('screenshot:load', async (_event, filePath) => {
        try {
            const allowedDir = path.normalize(path.join(os.homedir(), '.everfern', 'screenshots'));
            const resolved = path.normalize(path.resolve(filePath));
            // Case-insensitive comparison on Windows; case-sensitive on macOS/Linux.
            const isWindows = process.platform === 'win32';
            const allowedDirNorm = isWindows ? allowedDir.toLowerCase() : allowedDir;
            const resolvedNorm = isWindows ? resolved.toLowerCase() : resolved;
            // Ensure the resolved path is *inside* the allowed dir (trailing sep prevents path-traversal)
            const prefix = allowedDirNorm.endsWith(path.sep) ? allowedDirNorm : allowedDirNorm + path.sep;
            if (!resolvedNorm.startsWith(prefix)) {
                return { error: 'Access denied: path is outside the screenshots directory.' };
            }
            if (!fs.existsSync(resolved)) {
                return { error: 'File not found.' };
            }
            const buf = fs.readFileSync(resolved);
            const ext = path.extname(resolved).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
            const base64 = buf.toString('base64');
            return { base64, dataUrl: `data:${mime};base64,${base64}` };
        }
        catch (err) {
            console.error('[screenshot:load] Error:', err);
            return { error: String(err) };
        }
    });
    electron_1.ipcMain.handle('acp:set-provider', async (_event, config) => {
        return manager_1.acpManager.setProvider(config);
    });
    electron_1.ipcMain.handle('acp:health-check', async () => manager_1.acpManager.healthCheck());
    electron_1.ipcMain.handle('acp:list-tools', async () => {
        try {
            const activeConfig = manager_1.acpManager.getActiveConfig();
            // Create a temporary runner just to get the list of tools
            // This is safe because getBaseTools/initializePiTools are relatively lightweight
            const client = manager_1.acpManager.getClient();
            if (!client)
                return { success: true, tools: [] };
            const runner = new runner_1.AgentRunner(client, {
                visionModel: activeConfig?.vlm?.model,
                vlm: activeConfig?.vlm,
            });
            await runner.waitForToolsReady();
            const tools = runner.tools.map(t => ({
                name: t.name,
                description: t.description,
            }));
            return { success: true, tools };
        }
        catch (error) {
            console.error('[acp:list-tools] Error:', error);
            return { success: false, error: String(error) };
        }
    });
    electron_1.ipcMain.handle('acp:list-models', async () => {
        try {
            const config = manager_1.acpManager.getActiveConfig();
            let providerType = config ? config.provider : 'everfern';
            if (providerType === 'google')
                providerType = 'gemini';
            // 1. Get models for the active configured provider
            const activeModels = (0, providers_1.getAllModelsFlat)().filter(m => m.providerType === providerType);
            if (providerType === 'nvidia' && config?.customModel) {
                if (!activeModels.find(m => m.id === config.customModel)) {
                    activeModels.unshift({
                        id: config.customModel,
                        name: config.customModel + " (Custom)",
                        provider: 'NVIDIA NIM',
                        providerType: 'nvidia'
                    });
                }
            }
            // 2. Fetch local Ollama models dynamically
            let ollamaModels = [];
            try {
                const ollamaClient = new ai_client_1.AIClient({ provider: 'ollama' });
                const rawOllama = await ollamaClient.listModels();
                ollamaModels = rawOllama.map((m) => ({
                    id: m,
                    name: m,
                    provider: 'Ollama',
                    providerType: 'ollama'
                }));
                if (rawOllama.length === 0) {
                    ollamaModels.push({ id: 'ollama-empty', name: 'No models found in Ollama', provider: 'Ollama', providerType: 'ollama' });
                }
            }
            catch {
                ollamaModels.push({ id: 'ollama-error', name: 'Ollama is not running/installed', provider: 'Ollama', providerType: 'ollama' });
            }
            // 3. Fetch local LM Studio dynamically
            let lmstudioModels = [];
            try {
                const lmClient = new ai_client_1.AIClient({ provider: 'lmstudio' });
                const rawLm = await lmClient.listModels();
                lmstudioModels = rawLm.map((m) => ({
                    id: m,
                    name: m,
                    provider: 'LM Studio',
                    providerType: 'lmstudio'
                }));
                if (rawLm.length === 0) {
                    lmstudioModels.push({ id: 'lmstudio-empty', name: 'No models found in LM Studio', provider: 'LM Studio', providerType: 'lmstudio' });
                }
            }
            catch {
                lmstudioModels.push({ id: 'lmstudio-error', name: 'LM Studio is not running/installed', provider: 'LM Studio', providerType: 'lmstudio' });
            }
            // Deduplicate and combine
            const merged = [...activeModels];
            for (const om of [...ollamaModels, ...lmstudioModels]) {
                if (!merged.find(m => m.id === om.id))
                    merged.push(om);
            }
            if (merged.length === 0) {
                merged.push({ id: 'everfern-1', name: 'Fern-1', provider: 'EverFern Cloud', providerType: 'everfern' });
            }
            return { success: true, models: merged };
        }
        catch (error) {
            console.error('[acp:list-models] Error:', error);
            return { success: false, models: [], error: String(error) };
        }
    });
    // Stop/Abort
    electron_1.ipcMain.handle('acp:stop', () => {
        abort_manager_1.globalAbortManager.setAborted();
        return { success: true };
    });
    electron_1.ipcMain.handle('agent:permission-response', (_event, granted) => {
        if (agentPermissionResolver) {
            agentPermissionResolver(granted);
            agentPermissionResolver = null;
        }
    });
    electron_1.ipcMain.handle('acp:local-execution-response', (_event, response) => {
        // Import here to avoid circular dependencies
        const { getLocalExecutionResolvers } = require('../agent/tools/pi-tools');
        const resolvers = getLocalExecutionResolvers();
        // Resolve the specific request
        const resolver = resolvers.get(response.requestId);
        if (resolver) {
            resolver({ approved: response.approved, alwaysAllow: response.alwaysAllow });
        }
    });
    electron_1.ipcMain.handle('terminal:get-status', (_event, id) => {
        const { CommandRegistry } = require('../agent/tools/terminal/registry');
        const registry = CommandRegistry.getInstance();
        const info = registry.listCommands().find((c) => c.id === id);
        if (!info)
            return { success: false, error: 'Command not found' };
        return { success: true, status: info.status, output: info.output, exitCode: info.exitCode };
    });
    // ACP Chat Handler (Non-streaming)
    electron_1.ipcMain.handle('acp:chat', async (_event, request) => {
        let client = manager_1.acpManager.getClient();
        const config = loadConfigSync();
        if (request.providerType) {
            const currentProvider = manager_1.acpManager.getActiveConfig()?.provider;
            if (request.providerType !== currentProvider || !client) {
                const apiKey = config?.keys?.[request.providerType] || '';
                client = new ai_client_1.AIClient({
                    provider: request.providerType,
                    model: request.model,
                    apiKey,
                });
            }
            else if (request.model) {
                client.setModel(request.model);
            }
        }
        if (!client)
            return { error: 'No AI provider configured' };
        try {
            const response = await client.chat({
                messages: request.messages,
                model: request.model,
            });
            return { success: true, response };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    });
    // Main Streaming Handler
    electron_1.ipcMain.handle('acp:stream', async (event, request) => {
        const streamSender = event.sender;
        const config = loadConfigSync();
        let client = manager_1.acpManager.getClient();
        // Dynamic provider switch
        if (request.providerType) {
            const currentProvider = manager_1.acpManager.getActiveConfig()?.provider;
            if (request.providerType !== currentProvider || !client) {
                const apiKey = config?.keys?.[request.providerType] || request.apiKey || '';
                client = new ai_client_1.AIClient({
                    provider: request.providerType,
                    model: request.model,
                    apiKey,
                });
            }
            else if (request.model) {
                client.setModel(request.model);
            }
        }
        if (!client)
            throw new Error('No AI provider configured');
        // Construct AgentRunnerConfig from active ACP config
        const activeConfig = manager_1.acpManager.getActiveConfig();
        console.log('[AgentIPC] Active ACP Config:', {
            provider: activeConfig?.provider,
            model: activeConfig?.model,
            hasVlm: !!activeConfig?.vlm,
            vlmModel: activeConfig?.vlm?.model
        });
        const runnerConfig = {
            visionModel: activeConfig?.vlm?.model,
            vlm: activeConfig?.vlm,
            ollamaBaseUrl: activeConfig?.baseUrl, // Fallback
        };
        console.log('[AgentIPC] Initializing AgentRunner with config:', JSON.stringify(runnerConfig, null, 2));
        const runner = new runner_1.AgentRunner(client, runnerConfig);
        // IPC Batching State
        let chunkBuffer = '';
        let thoughtBuffer = '';
        let toolCallChunkBuffer = [];
        let lastFlushTime = Date.now();
        const FLUSH_INTERVAL_MS = 16;
        const flushBuffers = () => {
            if (chunkBuffer) {
                try {
                    streamSender.send('acp:stream-chunk', { delta: chunkBuffer, done: false });
                }
                catch (e) { }
                chunkBuffer = '';
            }
            if (thoughtBuffer) {
                try {
                    streamSender.send('acp:thought', { content: thoughtBuffer });
                }
                catch (e) { }
                thoughtBuffer = '';
            }
            if (toolCallChunkBuffer.length > 0) {
                for (const item of toolCallChunkBuffer) {
                    try {
                        streamSender.send('acp:tool-call-chunk', item);
                    }
                    catch (e) { }
                }
                toolCallChunkBuffer = [];
            }
            lastFlushTime = Date.now();
        };
        const safeSend = (channel, data) => {
            flushBuffers();
            if (data === undefined) {
                console.warn(`[IPC] Skipping undefined data for channel ${channel}`);
                return;
            }
            try {
                const safeData = JSON.parse(JSON.stringify(data, (key, value) => {
                    if (value instanceof Error)
                        return { message: value.message, stack: value.stack };
                    return value;
                }));
                streamSender.send(channel, safeData);
            }
            catch (err) {
                console.error(`[IPC] Serialization failed for ${channel}:`, err);
            }
        };
        try {
            const history = request.messages.slice(0, -1);
            const userInput = request.messages[request.messages.length - 1].content;
            let fullResponse = '';
            for await (const streamEvent of runner.runStream(userInput, history, request.model, request.conversationId, undefined, request.projectId, false, request.assistantMessageId)) {
                if (abort_manager_1.globalAbortManager.streamAborted) {
                    flushBuffers();
                    try {
                        const { getComputerOverlayManager } = require('../computer-overlay');
                        getComputerOverlayManager().hide();
                    }
                    catch (e) {
                        console.error('[AgentIPC] Failed to hide overlay:', e);
                    }
                    streamSender.send('acp:stream-chunk', { delta: '\n\n🛑 Stopped by user.', done: true });
                    break;
                }
                if (streamEvent.type === 'chunk') {
                    chunkBuffer += streamEvent.content;
                    fullResponse += streamEvent.content;
                    if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS)
                        flushBuffers();
                }
                else if (streamEvent.type === 'thought') {
                    thoughtBuffer += streamEvent.content;
                    if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS)
                        flushBuffers();
                }
                else if (streamEvent.type === 'tool_start') {
                    safeSend('acp:tool-start', {
                        toolName: streamEvent.toolName,
                        toolArgs: streamEvent.toolArgs,
                        toolCallId: streamEvent.toolCallId
                    });
                }
                else if (streamEvent.type === 'tool_call') {
                    safeSend('acp:tool-call', streamEvent.toolCall);
                }
                else if (streamEvent.type === 'tool_call_start') {
                    safeSend('acp:tool-call-start', { index: streamEvent.index, toolName: streamEvent.toolName });
                }
                else if (streamEvent.type === 'tool_call_chunk') {
                    // Buffer tool call chunks and debounce like text chunks
                    toolCallChunkBuffer.push({ index: streamEvent.index, argumentsDelta: streamEvent.argumentsDelta });
                    if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS)
                        flushBuffers();
                }
                else if (streamEvent.type === 'tool_call_complete') {
                    safeSend('acp:tool-call-complete', { index: streamEvent.index, toolName: streamEvent.toolName, arguments: streamEvent.arguments });
                }
                else if (streamEvent.type === 'mission_step_update') {
                    // ── Mission Step Update → acp:mission-step-update ──────────────
                    safeSend('acp:mission-step-update', {
                        step: streamEvent.step,
                        timeline: streamEvent.timeline,
                    });
                }
                else if (streamEvent.type === 'mission_phase_change') {
                    // ── Mission Phase Change → acp:mission-phase-change ────────────
                    safeSend('acp:mission-phase-change', {
                        phase: streamEvent.phase,
                        timeline: streamEvent.timeline,
                    });
                }
                else if (streamEvent.type === 'mission_complete') {
                    // ── Mission Complete — send BEFORE done:true so listeners are still alive ──
                    console.log('[AgentIPC] Mission complete event received');
                    safeSend('acp:mission-complete', {
                        timeline: streamEvent.timeline,
                        steps: streamEvent.steps,
                        thinkingDuration: streamEvent.thinkingDuration,
                        title: streamEvent.title,
                    });
                }
                else if (streamEvent.type === 'done') {
                    flushBuffers();
                    try {
                        const { getComputerOverlayManager } = require('../computer-overlay');
                        getComputerOverlayManager().hide();
                    }
                    catch (e) {
                        console.error('[AgentIPC] Failed to hide overlay:', e);
                    }
                    // Trigger cleanup sequence when execution completes
                    console.log('[AgentIPC] Execution complete, triggering cleanup sequence...');
                    try {
                        const cleanupStatus = await abort_manager_1.globalAbortManager.executeCleanupSequence();
                        // Send cleanup status to frontend
                        safeSend('acp:cleanup-complete', {
                            success: cleanupStatus.success,
                            completedPhases: cleanupStatus.completedPhases,
                            totalPhases: cleanupStatus.totalPhases,
                            elapsedMs: cleanupStatus.elapsedMs,
                            errors: cleanupStatus.errors
                        });
                        console.log('[AgentIPC] Cleanup sequence completed:', {
                            success: cleanupStatus.success,
                            elapsedMs: cleanupStatus.elapsedMs
                        });
                    }
                    catch (cleanupErr) {
                        console.error('[AgentIPC] Cleanup sequence error:', cleanupErr);
                        safeSend('acp:cleanup-error', {
                            message: String(cleanupErr),
                            stack: cleanupErr instanceof Error ? cleanupErr.stack : undefined
                        });
                    }
                    // NOTE: done:true fires AFTER mission_complete so the frontend
                    // still has listeners active when mission_complete arrives.
                    safeSend('acp:stream-chunk', { delta: '', done: true });
                    // Self-Improvement: Trigger non-blocking memory reflection
                    (0, memory_manager_1.reflectAndRemember)(history, userInput, fullResponse, client);
                }
                else if (streamEvent.type === 'subagent-progress') {
                    const progressPayload = streamEvent.data !== undefined ? streamEvent.data : streamEvent;
                    safeSend('acp:sub-agent-progress', progressPayload);
                }
                else if (streamEvent.type === 'local_execution_request') {
                    // Forward local execution request to renderer
                    safeSend('acp:local-execution-request', {
                        requestId: streamEvent.requestId,
                        command: streamEvent.command,
                        shellType: streamEvent.shellType,
                        reason: streamEvent.reason,
                        conversationId: streamEvent.conversationId
                    });
                }
                else if (streamEvent.type === 'debate_event' && streamEvent.debateEvent) {
                    const de = streamEvent.debateEvent;
                    console.log('[AgentIPC] Forwarding debate event:', de.type, 'debateId:', de.debateId);
                    safeSend('debate:stream', de);
                }
                else {
                    // Generic fallback — skip already-handled event types to avoid double-sending
                    const skippedTypes = new Set(['mission_step_update', 'mission_phase_change', 'mission_complete', 'done']);
                    if (!skippedTypes.has(streamEvent.type)) {
                        safeSend(`acp:${streamEvent.type.replace(/_/g, '-')}`, streamEvent);
                    }
                }
            }
        }
        catch (error) {
            console.error('[AgentIPC] Stream Error:', error);
            try {
                const { getComputerOverlayManager } = require('../computer-overlay');
                getComputerOverlayManager().hide();
            }
            catch (e) { }
            streamSender.send('acp:stream-chunk', { delta: `\n\n[Error: ${String(error)}]`, done: true });
        }
    });
}
