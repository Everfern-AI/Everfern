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
exports.terminalStatusTool = exports.terminalTool = void 0;
const registry_1 = require("./registry");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/** Default working directory for agent commands — ~/.everfern (cross-platform) */
const AGENT_DEFAULT_CWD = path.join(os.homedir(), '.everfern');
/**
 * Enhanced Terminal Tool
 * Provides persistent command execution with status tracking.
 */
exports.terminalTool = {
    name: 'terminal_execute',
    description: 'Execute a terminal command with persistence and tracking. Use for long-running tasks or when you need to monitor output.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command to execute' },
            cwd: { type: 'string', description: 'Working directory (defaults to ~/.everfern)' },
            id: { type: 'string', description: 'Optional unique ID for this command session' }
        },
        required: ['command']
    },
    execute: async (args, onUpdate, emitEvent, toolCallId) => {
        const registry = registry_1.CommandRegistry.getInstance();
        const command = args.command;
        const cwd = args.cwd || AGENT_DEFAULT_CWD;
        const id = args.id || toolCallId || `term_${Date.now()}`;
        onUpdate?.(`Terminal [${id}]: Executing "${command}"...`);
        const info = await registry.execute(id, command, cwd);
        if (info.status === 'completed') {
            return {
                success: true,
                output: info.output || 'Command completed with no output.',
                data: info
            };
        }
        else {
            return {
                success: false,
                output: info.output || 'Command failed.',
                error: `Exit code: ${info.exitCode}`,
                data: info
            };
        }
    }
};
/**
 * Terminal Status Tool
 * Check output of a running command.
 */
exports.terminalStatusTool = {
    name: 'terminal_status',
    description: 'Check the status and output of a previously started terminal command.',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'The unique ID of the command session' }
        },
        required: ['id']
    },
    execute: async (args, onUpdate, emitEvent, toolCallId) => {
        const registry = registry_1.CommandRegistry.getInstance();
        const id = args.id;
        const commands = registry.listCommands();
        const info = commands.find(c => c.id === id);
        if (!info) {
            return { success: false, output: `No command found with ID: ${id}`, error: 'not_found' };
        }
        return {
            success: true,
            output: info.output || 'No output yet.',
            data: info
        };
    }
};
