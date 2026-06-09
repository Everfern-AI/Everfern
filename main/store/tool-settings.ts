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
  useChromeProfile: boolean;
  selectedBrowserId: string;
  useIsolatedBrowser: boolean;
  automationMode: 'extension-first' | 'playwright';
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
  maxSteps: 200,
  useChromeProfile: false,
  selectedBrowserId: 'chrome',
  useIsolatedBrowser: true,
  automationMode: 'extension-first',
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
        navis: { ...DEFAULT_NAVIS_SETTINGS, ...(loaded.navis || {}) },
      };

      // Ensure new Navis fields are populated
      if (loaded.navis?.selectedBrowserId === undefined) {
        config.navis.selectedBrowserId = 'chrome';
      }
      if (loaded.navis?.useIsolatedBrowser === undefined) {
        config.navis.useIsolatedBrowser = !config.navis.useChromeProfile;
      }
      if (loaded.navis?.automationMode === undefined) {
        config.navis.automationMode = config.navis.useChromeProfile && !config.navis.useIsolatedBrowser
          ? 'extension-first'
          : 'playwright';
      }

      // Check if schema drifted (e.g., loaded stringified length vs config stringified length)
      // A more robust check is whether any keys were added by the merge
      const drifted = JSON.stringify(loaded) !== JSON.stringify(config);
      if (drifted) {
        console.log('[ToolSettings] Schema drift detected. Auto-updating tool-settings.json to latest schema.');
        this.writeFile(config);
      }

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
