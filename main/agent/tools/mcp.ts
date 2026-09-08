/**
 * EverFern — MCP Tool Integration
 * 
 * Supports MCP servers via:
 * - Command (local process): `node ~/mcp-servers/gmail/index.js`
 * - Docker: `docker run -i ghcr.io/modelcontextprotocol/server-filesystem /data`
 * - Stdio: Direct stdio communication
 * 
 * Convert MCP tools to EverFern tools and register them.
 */

import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { 
  ListToolsRequestSchema, 
  ListToolsResultSchema,
  CallToolResultSchema 
} from '@modelcontextprotocol/sdk/types.js';

/** Connection spec for one MCP server: local command or docker image, plus env/args. */
export interface MCPConfig {
    name: string;
    command?: string;
    docker?: string;
    env?: Record<string, string>;
    args?: string[];
}

/** Tool descriptor harvested from an MCP server's tools/list response. */
interface MCPToolConfig {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * Manages one MCP server connection: spawns the transport (command or docker),
 * performs the handshake, and proxies tools/list + tools/call requests.
 */
class MCPConnection {
    public client: Client | null = null;
    public connected = false;
    private process: ChildProcess | null = null;

    constructor(private config: MCPConfig) {}

    /**
     * Connect via whichever transport the config specifies (command or docker).
     * @returns true on successful handshake; false (never throws) on failure.
     */
    async connect(): Promise<boolean> {
        try {
            if (this.config.command) {
                return await this.connectCommand();
            } else if (this.config.docker) {
                return await this.connectDocker();
            }
            return false;
        } catch (error) {
            console.error(`[MCP] Failed to connect: ${this.config.name}`, error);
            return false;
        }
    }

    private async connectCommand(): Promise<boolean> {
        const { command, args = [], env = {} } = this.config;
        if (!command) return false;

        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const cmdArgs = args.length > 0 ? args : parts.slice(1);

        const cleanEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries({ ...process.env, ...env })) {
            if (value !== undefined) {
                cleanEnv[key] = value;
            }
        }

        const transport = new StdioClientTransport({
            command: cmd,
            args: cmdArgs,
            env: cleanEnv
        });

        this.client = new Client(
            { name: this.config.name, version: '1.0.0' },
            { capabilities: {} }
        );

        try {
            // 15s handshake cap: a hung MCP server process must not stall the
            // whole tool-registration pass at app startup.
            await Promise.race([
                this.client.connect(transport),
                new Promise((_, reject) => setTimeout(() => reject(new Error('MCP server connection handshake timed out (15s)')), 15000))
            ]);
            this.connected = true;
            console.log(`[MCP] Connected: ${this.config.name}`);
            return true;
        } catch (error) {
            console.error(`[MCP] Init failed: ${this.config.name}`, error);
            return false;
        }
    }

    private async connectDocker(): Promise<boolean> {
        const { docker, env = {} } = this.config;
        if (!docker) return false;

        const dockerParts = docker.split(/\s+/).filter(Boolean);
        const image = dockerParts[0];
        const dockerArgs = dockerParts.slice(1);

        const transport = new StdioClientTransport({
            command: 'docker',
            args: ['run', '--rm', '-i', ...dockerArgs, image],
            env: { ...process.env, ...env } as Record<string, string>
        });

        this.client = new Client(
            { name: this.config.name, version: '1.0.0' },
            { capabilities: {} }
        );

        try {
            // Same 15s handshake cap as connectCommand — a hung docker pull/run
            // must not stall the startup tool-registration pass.
            await Promise.race([
                this.client.connect(transport),
                new Promise((_, reject) => setTimeout(() => reject(new Error('MCP server Docker connection handshake timed out (15s)')), 15000))
            ]);
            this.connected = true;
            console.log(`[MCP] Connected (Docker): ${this.config.name}`);
            return true;
        } catch (error) {
            console.error(`[MCP] Docker init failed: ${this.config.name}`, error);
            return false;
        }
    }

    /** Close the client and kill any spawned process; safe to call when already down. */
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.close();
            } catch {}
        }

        if (this.process) {
            this.process.kill();
            this.process = null;
        }

        this.connected = false;
        this.client = null;
        console.log(`[MCP] Disconnected: ${this.config.name}`);
    }

    /** Fetch the server's tool descriptors; returns [] when not connected or on error. */
    async listTools(): Promise<MCPToolConfig[]> {
        if (!this.connected || !this.client) return [];

        try {
            const response = await this.client.request(
                { method: 'tools/list' },
                ListToolsResultSchema
            );
            
            return (response.tools || []).map((tool: any) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }));
        } catch (error) {
            console.error(`[MCP] List tools failed: ${this.config.name}`, error);
            return [];
        }
    }

    /** Invoke a tool by name on this server; rethrows MCP errors after logging. */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
        if (!this.connected || !this.client) {
            throw new Error(`MCP not connected: ${this.config.name}`);
        }

        try {
            const response = await this.client.request(
                { 
                    method: 'tools/call', 
                    params: { name: toolName, arguments: args } 
                },
                CallToolResultSchema
            );
            
            if (response.content?.[0]?.type === 'text') {
                return response.content[0].text;
            }
            return JSON.stringify(response.content);
        } catch (error) {
            console.error(`[MCP] Call tool failed: ${toolName}`, error);
            throw error;
        }
    }
}

/**
 * Aggregates MCP connections and exposes their tools as flat name → tool entries.
 * Tool names are namespaced as "server/tool" to stay collision-free.
 */
class MCPToolRegistry {
    private connections = new Map<string, MCPConnection>();
    private tools = new Map<string, { connection: MCPConnection; config: MCPToolConfig }>();

    /**
     * Connect a server and register all of its tools.
     * @returns number of tools registered (0 if the connection failed).
     */
    async registerServer(config: MCPConfig): Promise<number> {
        // Connect first; a failed handshake aborts registration before any
        // entries land in the maps below, so tools/servers stay consistent.
        const conn = new MCPConnection(config);
        const success = await conn.connect();

        if (!success) {
            console.warn(`[MCP] Failed to register: ${config.name}`);
            return 0;
        }

        this.connections.set(config.name, conn);

        const tools = await conn.listTools();
        for (const tool of tools) {
            // Namespaced "server/tool" key harvests the server name so tools
            // from different MCP servers can never collide in the registry.
            const fullName = `${config.name}/${tool.name}`;
            this.tools.set(fullName, { connection: conn, config: tool });
        }

        console.log(`[MCP] Registered ${tools.length} tools from ${config.name}`);
        return tools.length;
    }

    /** Disconnect every server and clear the tool map (app shutdown path). */
    async disconnectAll(): Promise<void> {
        for (const conn of this.connections.values()) {
            await conn.disconnect();
        }
        this.connections.clear();
        this.tools.clear();
    }

    /** Wrap a registered "server/tool" entry as an AgentTool for the runner. */
    getTool(name: string): AgentTool | undefined {
        const toolEntry = this.tools.get(name);
        if (!toolEntry) return undefined;

        const { connection, config } = toolEntry;
        
        return {
            name: name,
            description: config.description,
            parameters: config.inputSchema as any,

            async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
                try {
                    onUpdate?.(`Calling MCP tool: ${name}`);
                    const result = await connection.callTool(config.name, args as Record<string, unknown>);
                    
                    return {
                        success: true,
                        output: typeof result === 'string' ? result : JSON.stringify(result)
                    };
                } catch (error) {
                    return {
                        success: false,
                        output: `Error: ${error}`
                    };
                }
            }
        };
    }

    /** All registered tool names, in their namespaced "server/tool" form. */
    listAllTools(): string[] {
        return Array.from(this.tools.keys());
    }

    /** Names of every server that has a live registered connection. */
    getServers(): string[] {
        return Array.from(this.connections.keys());
    }
}

/**
 * Shared process-wide MCP tool registry. Populated by initMCPTools() at
 * startup and drained by shutdownMCPTools() on app shutdown.
 */
export const mcpRegistry = new MCPToolRegistry();

/** Built-in MCP server configs auto-registered at startup via initMCPTools(). */
const DEFAULT_MCP_CONFIGS: MCPConfig[] = [
    {
        name: 'everfern-test',
        command: 'python test-mcp-server.py'
    },
];

/**
 * Connect all configured default MCP servers and populate the registry.
 * Per-server failures are logged and swallowed so one bad server cannot
 * block the rest from registering.
 */
async function initMCPTools(): Promise<void> {
    for (const config of DEFAULT_MCP_CONFIGS) {
        try {
            await mcpRegistry.registerServer(config);
        } catch (error) {
            console.error(`[MCP] Failed to init ${config.name}:`, error);
        }
    }
}

/**
 * Disconnect every registered MCP server (app shutdown path);
 * delegates to mcpRegistry.disconnectAll().
 */
export async function shutdownMCPTools(): Promise<void> {
    await mcpRegistry.disconnectAll();
}
