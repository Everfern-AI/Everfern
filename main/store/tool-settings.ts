import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ToolConfig {
  mode: 'local' | 'api';
  headless: boolean;
  apiKey: string;
  useVision?: boolean;
  useThinking?: boolean;
  maxActionsPerStep?: number;
  maxFailures?: number;
}

export interface NavisConfig {
  useVision: boolean;
  headless: boolean;
  maxSteps: number;
  autoLaunchChrome: boolean;
}

export interface ToolSettingsConfig {
  webSearch: ToolConfig;
  webCrawl: ToolConfig;
  browserUse: ToolConfig;
  navis: NavisConfig;
}

export const DEFAULT_NAVIS_SETTINGS: NavisConfig = {
  useVision: false,
  headless: false,
  maxSteps: 25,
  autoLaunchChrome: true,
};

export const DEFAULT_TOOL_SETTINGS: ToolSettingsConfig = {
  webSearch: { mode: 'local', headless: true, apiKey: '' },
  webCrawl:  { mode: 'local', headless: true, apiKey: '' },
  browserUse: { 
    mode: 'local', 
    headless: false, 
    apiKey: '',
    useVision: false,
    useThinking: true,
    maxActionsPerStep: 1,
    maxFailures: 10
  },
  navis: { ...DEFAULT_NAVIS_SETTINGS },
};

const SETTINGS_FILE_PATH = path.join(os.homedir(), '.everfern', 'tool-settings.json');

export class ToolSettingsStore {
  private cache: ToolSettingsConfig;

  constructor() {
    this.cache = this.load();
  }

  private load(): ToolSettingsConfig {
    if (!fs.existsSync(SETTINGS_FILE_PATH)) {
      return { ...DEFAULT_TOOL_SETTINGS };
    }

    try {
      const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
      const loaded = JSON.parse(raw);
      
      // Deep merge with defaults to ensure all keys (like browserUse, navis) exist
      const config = {
        ...DEFAULT_TOOL_SETTINGS,
        ...loaded,
        // Ensure sub-objects are also merged if they exist
        webSearch: { ...DEFAULT_TOOL_SETTINGS.webSearch, ...(loaded.webSearch || {}) },
        webCrawl: { ...DEFAULT_TOOL_SETTINGS.webCrawl, ...(loaded.webCrawl || {}) },
        browserUse: { ...DEFAULT_TOOL_SETTINGS.browserUse, ...(loaded.browserUse || {}) },
        navis: { ...DEFAULT_TOOL_SETTINGS.navis, ...(loaded.navis || {}) },
      };

      return config as ToolSettingsConfig;
    } catch (err) {
      console.warn('[ToolSettings] ⚠️ Malformed tool-settings.json — resetting to defaults:', err);
      this.writeFile(DEFAULT_TOOL_SETTINGS);
      return { ...DEFAULT_TOOL_SETTINGS };
    }
  }

  private writeFile(config: ToolSettingsConfig): void {
    const dir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
  }

  get(): ToolSettingsConfig {
    return this.cache;
  }

  set(config: ToolSettingsConfig): void {
    this.writeFile(config);
    this.cache = config;
  }
}

export const toolSettingsStore = new ToolSettingsStore();
