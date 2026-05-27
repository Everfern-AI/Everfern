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
exports.toolSettingsStore = exports.ToolSettingsStore = exports.DEFAULT_TOOL_SETTINGS = exports.DEFAULT_NAVIS_SETTINGS = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.DEFAULT_NAVIS_SETTINGS = {
    useVision: false,
    headless: false,
    maxSteps: 200,
};
exports.DEFAULT_TOOL_SETTINGS = {
    webSearch: { mode: 'local', headless: true, apiKey: '' },
    webCrawl: { mode: 'local', headless: true, apiKey: '' },
    browserUse: {
        mode: 'local',
        headless: false,
        apiKey: '',
        useVision: false,
        useThinking: true,
        maxActionsPerStep: 1,
        maxFailures: 10
    },
    navis: { ...exports.DEFAULT_NAVIS_SETTINGS },
};
const SETTINGS_FILE_PATH = path.join(os.homedir(), '.everfern', 'tool-settings.json');
class ToolSettingsStore {
    cache;
    constructor() {
        this.cache = this.load();
    }
    load() {
        if (!fs.existsSync(SETTINGS_FILE_PATH)) {
            return { ...exports.DEFAULT_TOOL_SETTINGS };
        }
        try {
            const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
            const loaded = JSON.parse(raw);
            // Deep merge with defaults to ensure all keys (like browserUse, navis) exist
            const config = {
                ...exports.DEFAULT_TOOL_SETTINGS,
                ...loaded,
                // Ensure sub-objects are also merged if they exist
                webSearch: { ...exports.DEFAULT_TOOL_SETTINGS.webSearch, ...(loaded.webSearch || {}) },
                webCrawl: { ...exports.DEFAULT_TOOL_SETTINGS.webCrawl, ...(loaded.webCrawl || {}) },
                browserUse: { ...exports.DEFAULT_TOOL_SETTINGS.browserUse, ...(loaded.browserUse || {}) },
                navis: { ...exports.DEFAULT_TOOL_SETTINGS.navis, ...(loaded.navis || {}) },
            };
            return config;
        }
        catch (err) {
            console.warn('[ToolSettings] ⚠️ Malformed tool-settings.json — resetting to defaults:', err);
            this.writeFile(exports.DEFAULT_TOOL_SETTINGS);
            return { ...exports.DEFAULT_TOOL_SETTINGS };
        }
    }
    writeFile(config) {
        const dir = path.dirname(SETTINGS_FILE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
    }
    get() {
        return this.cache;
    }
    set(config) {
        this.writeFile(config);
        this.cache = config;
    }
}
exports.ToolSettingsStore = ToolSettingsStore;
exports.toolSettingsStore = new ToolSettingsStore();
