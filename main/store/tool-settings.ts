import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ToolConfig {
  mode: 'local' | 'api';
  provider?: 'exa' | 'firecrawl';
  headless: boolean;
  apiKey: string;
  exaApiKey?: string;
  firecrawlApiKey?: string;
  useVision?: boolean;
  useThinking?: boolean;
  maxActionsPerStep?: number;
  maxFailures?: number;
}

export interface NavisConfig {
  useVision: boolean;
  onlyVision: boolean;
  headless: boolean;
  maxSteps: number;
  useChromeProfile: boolean;
  selectedBrowserId: string;
  useIsolatedBrowser: boolean;
  automationMode: 'extension-first' | 'playwright';
}

export interface PdfOcrConfig {
  engine: 'ocrmypdf' | 'tesseract' | 'paddleocr' | 'paddleocr-vl' | 'vision-send';
  backend: 'auto' | 'openvino';
  autoOcr: boolean;
}

export interface ToolSettingsConfig {
  webSearch: ToolConfig;
  webCrawl: ToolConfig;
  browserUse: ToolConfig;
  navis: NavisConfig;
  pdfOcr: PdfOcrConfig;
}

export const DEFAULT_NAVIS_SETTINGS: NavisConfig = {
  useVision: false,
  onlyVision: false,
  headless: false,
  maxSteps: 200,
  useChromeProfile: true,
  selectedBrowserId: 'chrome',
  useIsolatedBrowser: false,
  automationMode: 'extension-first',
};

export const DEFAULT_PDF_OCR_SETTINGS: PdfOcrConfig = {
  engine: 'ocrmypdf',
  backend: 'auto',
  autoOcr: true,
};

export const DEFAULT_TOOL_SETTINGS: ToolSettingsConfig = {
  webSearch: { mode: 'local', provider: 'exa', headless: true, apiKey: '', exaApiKey: '', firecrawlApiKey: '' },
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
  pdfOcr: { ...DEFAULT_PDF_OCR_SETTINGS },
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
        pdfOcr: { ...DEFAULT_PDF_OCR_SETTINGS, ...(loaded.pdfOcr || {}) },
      };

      // Ensure new Navis fields are populated
      if (loaded.navis?.onlyVision === undefined) {
        config.navis.onlyVision = false;
      }
      if (loaded.navis?.selectedBrowserId === undefined) {
        config.navis.selectedBrowserId = 'chrome';
      }
      // Force only extension mode (useIsolatedBrowser = false, useChromeProfile = true, automationMode = extension-first)
      config.navis.useIsolatedBrowser = false;
      config.navis.useChromeProfile = true;
      config.navis.automationMode = 'extension-first';

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

  reset(): void {
    this.cache = { ...DEFAULT_TOOL_SETTINGS };
    this.writeFile(this.cache);
  }
}

export const toolSettingsStore = new ToolSettingsStore();
