import { ipcMain } from 'electron';
import { toolSettingsStore, ToolSettingsConfig, ToolConfig } from '../store/tool-settings';
import { getAvailableBrowsers } from '../lib/browser-detector';
import { getNavisCompanionStatus, prepareNavisMainProfileExtension } from '../agent/tools/navis/companion-extension';
import { redactConfigSecrets } from '../lib/secret-redaction';

// MP-SEC-11: tool-settings carries exa/firecrawl/browser API keys. The
// renderer receives redacted views and writes raw keys only when the user
// actually typed a new value (a plain string, never a SecretView).
type SecretKey = 'apiKey' | 'exaApiKey' | 'firecrawlApiKey';

function mergeToolSecrets(incoming: ToolConfig, stored: ToolConfig): ToolConfig {
  const isSecretView = (v: unknown) =>
    !!v && typeof v === 'object' && 'configured' in (v as Record<string, unknown>);
  const mergeKey = (k: SecretKey): string | undefined => {
    const incomingValue: unknown = incoming[k];
    if (isSecretView(incomingValue)) {
      // Renderer echoed the redacted view back — keep the stored secret.
      return stored[k];
    }
    // Plain string typed by the user; undefined means "field untouched".
    const typed = typeof incomingValue === 'string' ? incomingValue : undefined;
    return typed ?? stored[k];
  };
  return {
    ...incoming,
    apiKey: mergeKey('apiKey') ?? '',
    exaApiKey: mergeKey('exaApiKey'),
    firecrawlApiKey: mergeKey('firecrawlApiKey'),
  };
}

export function registerToolSettingsHandlers(): void {
  ipcMain.handle('tool-settings:get', () => redactConfigSecrets(toolSettingsStore.get()));
  ipcMain.handle('tool-settings:set', (_e, config: ToolSettingsConfig) => {
    const current = toolSettingsStore.get();
    toolSettingsStore.set({
      ...config,
      webSearch: mergeToolSecrets(config.webSearch, current.webSearch),
      webCrawl: mergeToolSecrets(config.webCrawl, current.webCrawl),
      browserUse: mergeToolSecrets(config.browserUse, current.browserUse),
    });
    return { success: true };
  });
  ipcMain.handle('tool-settings:get-browsers', async () => {
    return await getAvailableBrowsers();
  });
  ipcMain.handle('navis-extension:prepare-main-profile', async (_event, startUrl?: string) => {
    const config = toolSettingsStore.get();
    return await prepareNavisMainProfileExtension(config.navis.selectedBrowserId || 'chrome', startUrl);
  });
  ipcMain.handle('navis-extension:status', async () => {
    return getNavisCompanionStatus();
  });
}
