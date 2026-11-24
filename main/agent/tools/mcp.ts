/**
 * EverFern — MCP Tool Integration
 *
 * Connects to Model Context Protocol servers and exposes their tools to the agent.
 * Transports:
 * - stdio command (local process): `npx -y @modelcontextprotocol/server-filesystem C:/data`
 * - Docker: `ghcr.io/org/server --flag` (run as `docker run --rm -i ...`)
 * - Remote URL: Streamable HTTP, falling back to SSE for older servers
 *
 * Server configs persist in <userData>/mcp-servers.json and connect in the
 * background at startup, so a slow or broken server never blocks launch.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// The MCP SDK (with ajv and zod-to-json-schema) is ~500 modules; load it on first connect.
function mcpSdk() {
    return {
        Client: (require('@modelcontextprotocol/sdk/client/index.js') as typeof import('@modelcontextprotocol/sdk/client/index.js')).Client,
        StdioClientTransport: (require('@modelcontextprotocol/sdk/client/stdio.js') as typeof import('@modelcontextprotocol/sdk/client/stdio.js')).StdioClientTransport,
        StreamableHTTPClientTransport: (require('@modelcontextprotocol/sdk/client/streamableHttp.js') as typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')).StreamableHTTPClientTransport,
        SSEClientTransport: (require('@modelcontextprotocol/sdk/client/sse.js') as typeof import('@modelcontextprotocol/sdk/client/sse.js')).SSEClientTransport,
    };
}

export interface MCPConfig {
    name: string;
    command?: string;
    args?: string[];
    docker?: string;
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    enabled?: boolean;
}

export interface MCPToolConfig {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export type MCPServerState = 'connecting' | 'connected' | 'error' | 'disabled';

export interface MCPServerStatus {
    config: MCPConfig;
    state: MCPServerState;
    error?: string;
    tools: { name: string; agentName: string; description: string }[];
}

const HANDSHAKE_MS = 20000;
const CALL_MS = 120000;

/** Native MCP transport daemon. Node keeps the public registry API used by agents/UI. */
class NativeMcpDaemon {
    private child: any = null;
    private nextId = 1;
    private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    private reader: any = null;

    available(): boolean {
        return !!process.env.EF_NATIVE_EXE && fs.existsSync(process.env.EF_NATIVE_EXE);
    }

    private start(): any {
        if (this.child && !this.child.killed && this.child.exitCode === null) return this.child;
        if (!this.available()) throw new Error('Native MCP runtime is unavailable');
        const { spawn } = require('child_process') as typeof import('child_process');
        const readline = require('readline') as typeof import('readline');
        const child = spawn(process.env.EF_NATIVE_EXE!, ['--ef-mcp-daemon'], {
            stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
            env: { ...process.env, EVERFERN_SHELL: 'tauri' },
        });
        this.child = child;
        this.reader = readline.createInterface({ input: child.stdout });
        this.reader.on('line', (line: string) => {
            let response: any;
            try { response = JSON.parse(line); } catch { return; }
            const pending = this.pending.get(response?.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(response.id);
            if (response.ok) pending.resolve(response.result);
            else pending.reject(new Error(String(response.error || 'Native MCP operation failed')));
        });
        child.stderr?.on('data', (data: Buffer) => {
            const message = data.toString().trim();
            if (message) console.warn(`[MCP/Rust] ${message.slice(-1000)}`);
        });
        const fail = (error: Error) => {
            for (const [id, pending] of this.pending) {
                clearTimeout(pending.timer);
                pending.reject(error);
                this.pending.delete(id);
            }
            if (this.child === child) this.child = null;
        };
        child.on('error', fail);
        child.on('exit', (code: number | null) => fail(new Error(`Native MCP runtime exited${code === null ? '' : ` (${code})`}`)));
        return child;
    }

    request<T = any>(payload: Record<string, unknown>, timeout = CALL_MS): Promise<T> {
        let child: any;
        try { child = this.start(); } catch (error) { return Promise.reject(error); }
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Native MCP request timed out after ${Math.round(timeout / 1000)}s`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`, (error?: Error | null) => {
                if (!error) return;
                const pending = this.pending.get(id);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pending.delete(id);
                reject(error);
            });
        });
    }

    async stop(): Promise<void> {
        const child = this.child;
        if (!child) return;
        this.child = null;
        this.reader?.close();
        this.reader = null;
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Native MCP runtime stopped'));
            this.pending.delete(id);
        }
        await new Promise<void>(resolve => {
            const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 1500);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            try { child.stdin.end(); } catch { clearTimeout(timer); resolve(); }
        });
    }
}

const nativeMcpDaemon = new NativeMcpDaemon();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let t: NodeJS.Timeout;
    return Promise.race([
        p,
        new Promise<T>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms); }),
    ]).finally(() => clearTimeout(t));
}

/** Split a command line, keeping "quoted parts" together. */
function splitCommand(line: string): string[] {
    const out: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
}

/** Tool names sent to the model must match ^[a-zA-Z0-9_-]{1,64}$. */
function slug(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}
function agentToolName(server: string, tool: string): string {
    const full = `mcp__${slug(server)}__${slug(tool)}`;
    return full.length <= 64 ? full : full.slice(0, 64);
}

function errText(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.split('\n')[0].slice(0, 300);
}

function describeConfig(c: MCPConfig): string {
    if (c.url) return c.url;
    if (c.docker) return `docker ${c.docker}`;
    return [c.command, ...(c.args || [])].filter(Boolean).join(' ');
}

class MCPConnection {
    client: Client | null = null;
    connected = false;
    private native = false;
    private nativeTools: MCPToolConfig[] = [];
    private stderrTail = '';

    constructor(public config: MCPConfig) {}

    async connect(): Promise<void> {
        if (nativeMcpDaemon.available()) {
            try {
                const tools = await nativeMcpDaemon.request<any[]>(
                    { op: 'connect', config: this.config }, HANDSHAKE_MS * 2,
                );
                this.nativeTools = (Array.isArray(tools) ? tools : []).map(tool => ({
                    name: String(tool?.name || ''),
                    description: String(tool?.description || ''),
                    inputSchema: tool?.inputSchema || { type: 'object', properties: {} },
                }));
                this.native = true;
                this.connected = true;
                return;
            } catch (error) {
                // Keep legacy HTTP+SSE servers and installations without a working
                // native binary on the existing SDK transport.
                try { await nativeMcpDaemon.request({ op: 'disconnect', server: this.config.name }, 5000); } catch {}
                console.warn(`[MCP] Native transport unavailable for ${this.config.name}; using SDK fallback:`, errText(error));
            }
        }
        const sdk = mcpSdk();
        const { config } = this;
        const newClient = () => new sdk.Client({ name: 'everfern', version: '1.0.0' }, { capabilities: {} });

        if (config.url) {
            const url = new URL(config.url);
            const requestInit = config.headers ? { headers: config.headers } : undefined;
            try {
                this.client = newClient();
                await withTimeout(this.client.connect(new sdk.StreamableHTTPClientTransport(url, { requestInit })), HANDSHAKE_MS, 'MCP handshake');
            } catch (httpErr) {
                // Older servers only speak the HTTP+SSE transport.
                try { await this.client?.close(); } catch {}
                this.client = newClient();
                try {
                    await withTimeout(this.client.connect(new sdk.SSEClientTransport(url, { requestInit })), HANDSHAKE_MS, 'MCP handshake');
                } catch {
                    throw httpErr;
                }
            }
        } else {
            let command: string;
            let args: string[];
            if (config.docker) {
                const parts = splitCommand(config.docker);
                const envFlags = Object.keys(config.env || {}).flatMap(k => ['-e', k]);
                command = 'docker';
                args = ['run', '--rm', '-i', ...envFlags, ...parts.slice(1), parts[0]];
            } else if (config.command) {
                const parts = splitCommand(config.command);
                command = parts[0];
                args = config.args && config.args.length > 0 ? [...parts.slice(1), ...config.args] : parts.slice(1);
            } else {
                throw new Error('Server has no command, docker image or URL');
            }

            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries({ ...process.env, ...(config.env || {}) })) {
                if (v !== undefined) env[k] = v;
            }
            this.client = newClient();
            const transport = new sdk.StdioClientTransport({ command, args, env, stderr: 'pipe' });
            // Keep the tail of stderr: it is the only useful clue when a server dies on launch.
            transport.stderr?.on('data', (d: Buffer) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-2000); });
            try {
                await withTimeout(this.client.connect(transport), HANDSHAKE_MS, 'MCP handshake');
            } catch (e) {
                const last = this.stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 300);
                if (/Connection closed|ENOENT/i.test(errText(e))) {
                    throw new Error(last ? `Server exited: ${last}` : `Server exited right away. Check that "${command}" is installed and on PATH.`);
                }
                throw e;
            }
        }
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        if (this.native) {
            try { await nativeMcpDaemon.request({ op: 'disconnect', server: this.config.name }, 5000); } catch {}
        }
        try { await this.client?.close(); } catch {}
        this.client = null;
        this.connected = false;
        this.native = false;
        this.nativeTools = [];
    }

    async listTools(): Promise<MCPToolConfig[]> {
        if (this.native) return this.nativeTools;
        if (!this.client) return [];
        const tools: MCPToolConfig[] = [];
        let cursor: string | undefined;
        do {
            const res: any = await withTimeout(this.client.listTools(cursor ? { cursor } : undefined), HANDSHAKE_MS, 'tools/list');
            for (const t of res.tools || []) {
                tools.push({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} } });
            }
            cursor = res.nextCursor;
        } while (cursor && tools.length < 500);
        return tools;
    }

    async callTool(toolName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
        if (!this.connected) throw new Error(`MCP server "${this.config.name}" is not connected`);
        if (this.native) {
            const result = await nativeMcpDaemon.request<any>({
                op: 'call', server: this.config.name, tool: toolName, arguments: args,
            }, CALL_MS + 5000);
            return { text: formatMcpResult(result), isError: !!result?.isError };
        }
        if (!this.client) throw new Error(`MCP server "${this.config.name}" is not connected`);
        const res: any = await withTimeout(this.client.callTool({ name: toolName, arguments: args }), CALL_MS, `MCP tool ${toolName}`);
        return { text: formatMcpResult(res), isError: !!res.isError };
    }
}

function formatMcpResult(res: any): string {
    const parts: string[] = [];
    for (const c of res?.content || []) {
        if (c.type === 'text') parts.push(c.text);
        else if (c.type === 'resource' && c.resource?.text) parts.push(c.resource.text);
        else if (c.type === 'resource_link') parts.push(`[resource] ${c.uri}`);
        else if (c.type === 'image' || c.type === 'audio') parts.push(`[${c.type} ${c.mimeType || ''}, ${Math.round((c.data?.length || 0) * 0.75 / 1024)} KB omitted]`);
        else parts.push(JSON.stringify(c));
    }
    if (parts.length === 0 && res?.structuredContent) parts.push(JSON.stringify(res.structuredContent));
    return parts.join('\n\n') || '(no output)';
}

interface ServerEntry {
    config: MCPConfig;
    state: MCPServerState;
    error?: string;
    conn?: MCPConnection;
    tools: MCPToolConfig[];
}

class MCPToolRegistry {
    private servers = new Map<string, ServerEntry>();
    /** agent tool name -> server + original tool name */
    private tools = new Map<string, { server: string; tool: MCPToolConfig }>();
    private listeners = new Set<() => void>();

    onChange(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() { for (const fn of this.listeners) { try { fn(); } catch {} } }

    // ── Persistence ───────────────────────────────────────────────
    private file(): string | null {
        try { return path.join(require('electron').app.getPath('userData'), 'mcp-servers.json'); } catch { return null; }
    }
    private save() {
        const f = this.file();
        if (!f) return;
        const mcpServers: Record<string, Omit<MCPConfig, 'name'>> = {};
        for (const { config } of this.servers.values()) {
            const { name, ...rest } = config;
            mcpServers[name] = rest;
        }
        try { fs.writeFileSync(f, JSON.stringify({ mcpServers }, null, 2), 'utf8'); } catch (e) { console.error('[MCP] Could not save servers:', e); }
    }
    private loadSaved(): MCPConfig[] {
        const f = this.file();
        if (!f || !fs.existsSync(f)) return [];
        try { return parseMcpJson(fs.readFileSync(f, 'utf8')); } catch (e) { console.error('[MCP] Could not read servers:', e); return []; }
    }

    // ── Lifecycle ─────────────────────────────────────────────────
    private dropTools(server: string) {
        for (const [k, v] of this.tools) if (v.server === server) this.tools.delete(k);
    }

    private async connectEntry(entry: ServerEntry): Promise<void> {
        const name = entry.config.name;
        await entry.conn?.disconnect();
        this.dropTools(name);
        entry.tools = [];
        entry.error = undefined;
        if (entry.config.enabled === false) { entry.state = 'disabled'; entry.conn = undefined; this.emit(); return; }

        entry.state = 'connecting';
        this.emit();
        const conn = new MCPConnection(entry.config);
        entry.conn = conn;
        try {
            await conn.connect();
            const tools = await conn.listTools();
            if (entry.conn !== conn) { await conn.disconnect(); return; } // replaced while connecting
            entry.tools = tools;
            for (const tool of tools) {
                let agentName = agentToolName(name, tool.name);
                for (let i = 2; this.tools.has(agentName); i++) agentName = agentToolName(name, `${tool.name}_${i}`);
                this.tools.set(agentName, { server: name, tool });
            }
            entry.state = 'connected';
            console.log(`[MCP] ${name}: ${tools.length} tools`);
        } catch (e) {
            if (entry.conn !== conn) return;
            await conn.disconnect();
            entry.conn = undefined;
            entry.state = 'error';
            entry.error = errText(e);
            console.warn(`[MCP] ${name} failed: ${entry.error}`);
        }
        this.emit();
    }

    /** Add or replace a server, connect it, and (by default) remember it. Returns the tool count. */
    async registerServer(config: MCPConfig, opts: { persist?: boolean } = {}): Promise<number> {
        const name = config.name?.trim();
        if (!name) throw new Error('Server name is required');
        if (!config.command && !config.docker && !config.url) throw new Error('Give a command, a Docker image or a URL');
        const clean: MCPConfig = { ...config, name };
        const prev = this.servers.get(name);
        const entry: ServerEntry = prev ? Object.assign(prev, { config: clean }) : { config: clean, state: 'connecting', tools: [] };
        this.servers.set(name, entry);
        if (opts.persist !== false) this.save();
        await this.connectEntry(entry);
        return entry.tools.length;
    }

    async removeServer(name: string, opts: { persist?: boolean } = {}): Promise<void> {
        const entry = this.servers.get(name);
        if (!entry) return;
        this.servers.delete(name);
        this.dropTools(name);
        await entry.conn?.disconnect();
        if (opts.persist !== false) this.save();
        this.emit();
    }

    async syncSaved(serverNames: unknown, removedNames: unknown): Promise<number> {
        const removed = Array.isArray(removedNames)
            ? removedNames.filter((name): name is string => typeof name === 'string')
            : [];
        for (const name of removed) await this.removeServer(name, { persist: false });

        const requested = new Set(Array.isArray(serverNames)
            ? serverNames.filter((name): name is string => typeof name === 'string')
            : []);
        const configs = this.loadSaved().filter(config => requested.has(config.name));
        const toolCounts = await Promise.all(configs.map(config =>
            this.registerServer(config, { persist: false }).catch(error => {
                console.warn(`[MCP] Could not activate saved server "${config.name}":`, error);
                return 0;
            })
        ));
        return toolCounts.reduce((total, count) => total + count, 0);
    }

    async setEnabled(name: string, enabled: boolean): Promise<void> {
        const entry = this.servers.get(name);
        if (!entry) return;
        entry.config = { ...entry.config, enabled };
        this.save();
        await this.connectEntry(entry);
    }

    async reconnect(name: string): Promise<void> {
        const entry = this.servers.get(name);
        if (entry) await this.connectEntry(entry);
    }

    /** Load saved servers and connect them all in parallel. */
    async loadAndConnect(): Promise<void> {
        const configs = this.loadSaved();
        for (const c of configs) if (!this.servers.has(c.name)) this.servers.set(c.name, { config: c, state: c.enabled === false ? 'disabled' : 'connecting', tools: [] });
        this.emit();
        await Promise.all(configs.map(c => this.connectEntry(this.servers.get(c.name)!)));
    }

    async disconnectAll(): Promise<void> {
        await Promise.all([...this.servers.values()].map(e => e.conn?.disconnect()));
        this.tools.clear();
    }

    // ── Queries ───────────────────────────────────────────────────
    status(): MCPServerStatus[] {
        return [...this.servers.values()].map(e => ({
            config: e.config,
            state: e.state,
            error: e.error,
            tools: [...this.tools.entries()].filter(([, v]) => v.server === e.config.name)
                .map(([agentName, v]) => ({ name: v.tool.name, agentName, description: v.tool.description })),
        }));
    }

    getTool(agentName: string): AgentTool | undefined {
        const hit = this.tools.get(agentName);
        if (!hit) return undefined;
        const { server, tool } = hit;
        const registry = this;
        const desc = (tool.description || `${tool.name} tool`).trim();
        return {
            name: agentName,
            description: `[MCP: ${server}] ${desc}`.slice(0, 1024),
            parameters: tool.inputSchema as any,
            async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void): Promise<ToolResult> {
                const conn = registry.servers.get(server)?.conn;
                if (!conn?.connected) return { success: false, output: `MCP server "${server}" is not connected. Reconnect it in Settings > Tools > MCP servers.` };
                try {
                    onUpdate?.(`Calling ${tool.name} on ${server}`);
                    // The runner adds a UI-only taskName to every schema; servers must not see it.
                    const { taskName: _taskName, ...serverArgs } = (args || {}) as Record<string, unknown>;
                    const r = await conn.callTool(tool.name, serverArgs);
                    return { success: !r.isError, output: r.text };
                } catch (error) {
                    return { success: false, output: `MCP error from ${server}/${tool.name}: ${errText(error)}` };
                }
            },
        };
    }

    listAllTools(): string[] {
        return [...this.tools.keys()];
    }

    getServers(): string[] {
        return [...this.servers.values()].filter(e => e.state === 'connected').map(e => e.config.name);
    }

    describe(name: string): string {
        const e = this.servers.get(name);
        return e ? describeConfig(e.config) : '';
    }
}

/**
 * Accepts Claude Desktop / Cursor style JSON:
 *   { "mcpServers": { "fs": { "command": "npx", "args": [...], "env": {...} }, "remote": { "url": "https://..." } } }
 * a bare { "name": {...} } map, or an array of { name, ... } objects.
 */
export function parseMcpJson(text: string): MCPConfig[] {
    const data = JSON.parse(text);
    const pick = (name: string, v: any): MCPConfig | null => {
        if (!v || typeof v !== 'object') return null;
        const c: MCPConfig = { name: String(v.name || name).trim() };
        if (typeof v.command === 'string') c.command = v.command;
        if (Array.isArray(v.args)) c.args = v.args.map(String);
        if (typeof v.docker === 'string') c.docker = v.docker;
        const url = v.url || v.serverUrl || v.httpUrl;
        if (typeof url === 'string') c.url = url;
        if (v.headers && typeof v.headers === 'object') c.headers = v.headers;
        if (v.env && typeof v.env === 'object') c.env = v.env;
        if (v.enabled === false || v.disabled === true) c.enabled = false;
        return c.name && (c.command || c.docker || c.url) ? c : null;
    };
    let out: (MCPConfig | null)[] = [];
    if (Array.isArray(data)) out = data.map((v: any) => pick(v?.name, v));
    else if (data && typeof data === 'object') {
        const map = data.mcpServers || data.servers || data;
        out = Object.entries(map).map(([k, v]) => pick(k, v));
    }
    return out.filter(Boolean) as MCPConfig[];
}

export const mcpRegistry = new MCPToolRegistry();

/** Connect saved servers in the background; never blocks startup. */
export function initMCPTools(): void {
    mcpRegistry.loadAndConnect().catch(e => console.error('[MCP] init failed:', e));
}

export async function shutdownMCPTools(): Promise<void> {
    await mcpRegistry.disconnectAll();
    await nativeMcpDaemon.stop();
}
