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
exports.CommandRegistry = void 0;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
class CommandRegistry {
    static instance;
    commands = new Map();
    processes = new Map();
    constructor() { }
    static getInstance() {
        if (!CommandRegistry.instance) {
            CommandRegistry.instance = new CommandRegistry();
        }
        return CommandRegistry.instance;
    }
    async execute(id, command, cwd = path.join(os.homedir(), '.everfern')) {
        const info = {
            id,
            command,
            cwd,
            status: 'running',
            output: '',
            startTime: Date.now()
        };
        this.commands.set(id, info);
        const isWin = process.platform === 'win32';
        // Ensure cwd exists
        const fs = require('fs');
        if (!fs.existsSync(cwd)) {
            try {
                fs.mkdirSync(cwd, { recursive: true });
                console.log(`[CommandRegistry] Created missing cwd: ${cwd}`);
            }
            catch (err) {
                console.warn(`[CommandRegistry] Failed to create cwd: ${cwd}. Falling back to home directory. Error: ${err}`);
                cwd = os.homedir();
            }
        }
        let shell = isWin ? 'wsl.exe' : 'bash';
        let args = isWin ? ['--exec', 'bash', '-c', command] : ['-c', command];
        let spawnOptions = { cwd, shell: false };
        // Robust shell detection for Windows
        if (isWin) {
            try {
                // Test if wsl.exe is available
                const { execSync } = require('child_process');
                execSync('wsl.exe --status', { stdio: 'ignore' });
            }
            catch (e) {
                console.warn('[CommandRegistry] wsl.exe not found or not working, falling back to powershell...');
                shell = 'powershell.exe';
                args = ['-NoProfile', '-Command', command];
            }
        }
        const proc = (0, child_process_1.spawn)(shell, args, spawnOptions);
        this.processes.set(id, proc);
        info.pid = proc.pid;
        const MAX_OUTPUT_LENGTH = 50000;
        proc.stdout?.on('data', (data) => {
            info.output += data.toString();
            if (info.output.length > MAX_OUTPUT_LENGTH) {
                info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
            }
        });
        proc.stderr?.on('data', (data) => {
            info.output += data.toString();
            if (info.output.length > MAX_OUTPUT_LENGTH) {
                info.output = '...[Output truncated]...\n' + info.output.slice(-MAX_OUTPUT_LENGTH);
            }
        });
        return new Promise((resolve) => {
            proc.on('close', (code) => {
                info.status = code === 0 ? 'completed' : 'failed';
                info.exitCode = code ?? -1;
                this.processes.delete(id);
                resolve(info);
            });
            proc.on('error', (err) => {
                info.status = 'failed';
                info.output += `\nError: ${err.message}`;
                this.processes.delete(id);
                resolve(info);
            });
        });
    }
    listCommands() {
        return Array.from(this.commands.values());
    }
    terminate(id) {
        const proc = this.processes.get(id);
        if (proc) {
            proc.kill();
            const info = this.commands.get(id);
            if (info)
                info.status = 'terminated';
            this.processes.delete(id);
            return true;
        }
        return false;
    }
}
exports.CommandRegistry = CommandRegistry;
