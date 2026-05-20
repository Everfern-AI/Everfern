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
exports.presentFilesTool = exports.createPresentFilesTool = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const linux_vm_executor_1 = require("./linux-vm-executor");
const createPresentFilesTool = (runner) => ({
    name: 'present_files',
    description: 'Present final output files (artifacts, reports, spreadsheets) to the user. ' +
        'Surfaces them as interactive cards. Mandatory final step after work.',
    parameters: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                description: 'List of files to present to the user.',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Absolute path to the file.' },
                        description: { type: 'string', description: 'Short summary of what this file contains.' },
                        type: {
                            type: 'string',
                            enum: ['document', 'spreadsheet', 'presentation', 'code', 'image', 'other'],
                            description: 'General category for UI rendering.'
                        },
                        title: { type: 'string', description: 'Title for the file.' }
                    },
                    required: ['path']
                }
            },
            paths: {
                type: 'array',
                description: 'Alternative format: list of file paths to present.',
                items: { type: 'string' }
            },
            title: {
                type: 'string',
                description: 'Optional title for the presentation.'
            }
        },
        required: ['files']
    },
    async execute(args, onUpdate, emitEvent, toolCallId) {
        // Handle different input formats
        let files = [];
        if (Array.isArray(args.files)) {
            files = args.files;
        }
        else if (Array.isArray(args.paths)) {
            // Alternative format: just paths
            files = args.paths.map((p) => ({ path: p }));
        }
        else if (args.files && typeof args.files === 'object') {
            // Single file object
            files = [args.files];
        }
        else {
            return {
                success: false,
                output: 'present_files requires a "files" array parameter with at least one file.',
                error: 'Invalid arguments: expected { files: [{ path: string, description: string }] }'
            };
        }
        if (files.length === 0) {
            return {
                success: false,
                output: 'No files provided to present.',
                error: 'Empty files array'
            };
        }
        // Determine artifacts directory to copy files to
        const sessionId = runner?.currentConversationId || 'default';
        let artifactsDir;
        if (runner?.workspaceDir) {
            artifactsDir = path.join(runner.workspaceDir, '.everfern', 'artifacts');
        }
        else {
            artifactsDir = path.join(os.homedir(), '.everfern', 'artifacts', sessionId);
        }
        // Auto-save files to the artifacts directory
        for (const f of files) {
            if (!f.path)
                continue;
            const fileName = path.basename(f.path);
            const targetPath = path.join(artifactsDir, fileName);
            // If already in target path, skip copying
            if (f.path === targetPath)
                continue;
            let fileCopied = false;
            if (process.platform === 'win32') {
                // Check if the path is a WSL-internal path (e.g. starts with / and not /mnt/)
                const isWslInternal = f.path.startsWith('/') && !f.path.startsWith('/mnt/');
                if (isWslInternal) {
                    try {
                        // Translate target path to WSL
                        const wslTargetPath = (0, linux_vm_executor_1.translateWindowsPathToLinux)(targetPath);
                        // Ensure target directory exists on host first
                        fs.mkdirSync(artifactsDir, { recursive: true });
                        // Copy file from WSL to the Windows mount
                        await (0, linux_vm_executor_1.runInLinuxVM)(`cp "${f.path}" "${wslTargetPath}"`);
                        fileCopied = true;
                        console.log(`[PresentFiles] Copied WSL file ${f.path} to host artifacts at ${targetPath}`);
                    }
                    catch (err) {
                        console.warn(`[PresentFiles] Failed to copy WSL file via VM:`, err);
                    }
                }
            }
            if (!fileCopied) {
                // Standard copy (handles /mnt/c/ translation via translateLinuxPathToHost)
                try {
                    const hostPath = (0, linux_vm_executor_1.translateLinuxPathToHost)(f.path);
                    if (fs.existsSync(hostPath)) {
                        fs.mkdirSync(artifactsDir, { recursive: true });
                        fs.copyFileSync(hostPath, targetPath);
                        fileCopied = true;
                        console.log(`[PresentFiles] Copied file from ${hostPath} to artifacts at ${targetPath}`);
                    }
                    else {
                        console.warn(`[PresentFiles] Source file not found: ${hostPath}`);
                    }
                }
                catch (err) {
                    console.warn(`[PresentFiles] Failed to copy host file to artifacts:`, err);
                }
            }
            if (fileCopied) {
                f.path = targetPath;
            }
        }
        const formatted = files
            .filter((f) => f && f.path)
            .map((f) => {
            const desc = f.description || f.title || `File: ${f.path.split(/[\\/]/).pop()}`;
            return `📄 **${desc}**\n   Path: \`${f.path}\``;
        }).join('\n\n');
        const count = files.filter((f) => f && f.path).length;
        onUpdate?.(`🎁 Presenting ${count} artifact${count !== 1 ? 's' : ''} to the user...`);
        return {
            success: true,
            output: `Files presented to the user:\n\n${formatted}\n\nTask complete.`,
            data: {
                files: files.filter((f) => f && f.path),
                type: 'present_files',
                title: args.title
            }
        };
    }
});
exports.createPresentFilesTool = createPresentFilesTool;
exports.presentFilesTool = (0, exports.createPresentFilesTool)();
