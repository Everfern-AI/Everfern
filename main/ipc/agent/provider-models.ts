import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { acpManager } from '../../acp/manager';
import { AgentRunner } from '../../agent/runner/runner';
import { AIClient } from '../../lib/ai-client';
import { getAllModelsFlat, FlatModelEntry } from '../../lib/providers';
import { applyOpenRouterCapabilities, getOpenRouterCatalog } from '../../lib/openrouter-model-capabilities';
import { hydrateConfigWithIsolatedKeys } from '../../lib/vlm-config';

function loadConfigSync() {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const configPath = path.join(configDir, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return hydrateConfigWithIsolatedKeys(config, configDir);
    }
  } catch (err) {
    console.error('[Config] Error loading config:', err);
  }
  return null;
}

function scopedLocalModelId(provider: string, model: string): string {
  return provider === 'ollama' || provider === 'lmstudio' || provider === 'llamacpp' ? `${provider}:${model}` : model;
}

export function registerProviderModelHandlers(): void {
  ipcMain.handle('acp:list-providers', () => acpManager.listProviders());

  ipcMain.handle('screenshot:load', async (_event, filePath: string) => {
    try {
      const allowedDir = path.normalize(path.join(os.homedir(), '.everfern', 'screenshots'));
      const resolved = path.normalize(path.resolve(filePath));

      const isWindows = process.platform === 'win32';
      const allowedDirNorm = isWindows ? allowedDir.toLowerCase() : allowedDir;
      const resolvedNorm   = isWindows ? resolved.toLowerCase()   : resolved;

      const prefix = allowedDirNorm.endsWith(path.sep) ? allowedDirNorm : allowedDirNorm + path.sep;
      if (!resolvedNorm.startsWith(prefix)) {
        return { error: 'Access denied: path is outside the screenshots directory.' };
      }
      if (!fs.existsSync(resolved)) {
        return { error: 'File not found.' };
      }
      const buf = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const base64 = buf.toString('base64');
      return { base64, dataUrl: `data:${mime};base64,${base64}` };
    } catch (err) {
      console.error('[screenshot:load] Error:', err);
      return { error: String(err) };
    }
  });

  ipcMain.handle('acp:set-provider', async (_event, config) => {
    return acpManager.setProvider(config);
  });

  ipcMain.handle('acp:health-check', async () => acpManager.healthCheck());

  ipcMain.handle('acp:list-tools', async () => {
    try {
      const activeConfig = acpManager.getActiveConfig();
      const client = acpManager.getClient();
      if (!client) return { success: true, tools: [] };

      const runner = new AgentRunner(client, {
        visionModel: activeConfig?.vlm?.model,
        vlm: activeConfig?.vlm,
      });

      await runner.waitForToolsReady();

      const tools = runner.tools.map(t => ({
        name: t.name,
        description: t.description,
      }));

      return { success: true, tools };
    } catch (error) {
      console.error('[acp:list-tools] Error:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('acp:list-models', async () => {
    try {
      const config = { ...loadConfigSync(), ...acpManager.getActiveConfig() };
      let providerType = config.provider || 'everfern';
      if ((providerType as string) === 'google') providerType = 'gemini';

      const activeModels = getAllModelsFlat().filter(m => m.providerType === providerType);

      if ((providerType === 'nvidia' || providerType === 'openrouter' || providerType === 'ollama-cloud') && (config as any)?.customModel) {
        const customId = String((config as any).customModel).trim();
        if (customId && !activeModels.find(m => m.id === customId)) {
          const providerDisplayName = providerType === 'openrouter' ? 'OpenRouter' : providerType === 'nvidia' ? 'NVIDIA NIM' : 'Ollama Cloud';
          activeModels.unshift({
            id: customId,
            name: customId + " (Custom)",
            provider: providerDisplayName,
            providerType: providerType as any
          });
        }
      }

      let ollamaModels: FlatModelEntry[] = [];
      try {
        const ollamaClient = new AIClient({ provider: 'ollama' });
        const rawOllama = await ollamaClient.listModels();
        ollamaModels = rawOllama.map((m: string) => ({
          id: scopedLocalModelId('ollama', m),
          name: m,
          provider: 'Ollama',
          providerType: 'ollama' as any
        }));
        if (rawOllama.length === 0) {
          ollamaModels.push({ id: 'ollama-empty', name: 'No models found in Ollama', provider: 'Ollama', providerType: 'ollama' as any });
        }
      } catch {
        ollamaModels.push({ id: 'ollama-error', name: 'Ollama is not running/installed', provider: 'Ollama', providerType: 'ollama' as any });
      }

      let lmstudioModels: FlatModelEntry[] = [];
      try {
        const lmClient = new AIClient({ provider: 'lmstudio' });
        const rawLm = await lmClient.listModels();
        lmstudioModels = rawLm.map((m: string) => ({
          id: scopedLocalModelId('lmstudio', m),
          name: m,
          provider: 'LM Studio',
          providerType: 'lmstudio' as any
        }));
        if (rawLm.length === 0) {
          lmstudioModels.push({ id: 'lmstudio-empty', name: 'No models found in LM Studio', provider: 'LM Studio', providerType: 'lmstudio' as any });
        }
      } catch {
        lmstudioModels.push({ id: 'lmstudio-error', name: 'LM Studio is not running/installed', provider: 'LM Studio', providerType: 'lmstudio' as any });
      }

      const merged = [...activeModels];
      let llamacppModels: FlatModelEntry[] = [];
      try {
        const client = new AIClient({
          provider: 'llamacpp',
          baseUrl: (config?.provider === 'llamacpp' ? config.baseUrl : undefined) || (config as any)?.baseUrls?.llamacpp,
          apiKey: (config as any)?.keys?.llamacpp || (config?.provider === 'llamacpp' ? config.apiKey : undefined),
        });
        llamacppModels = (await client.listModels()).map(id => ({
          id: scopedLocalModelId('llamacpp', id), name: id, provider: 'llama.cpp', providerType: 'llamacpp',
        }));
      } catch { /* A local server is optional. */ }
      // Keep the configured model selectable while its server is temporarily offline.
      if (providerType === 'llamacpp' && !llamacppModels.length && config.model) {
        const model = config.model.replace(/^llamacpp:/, '');
        llamacppModels.push({ id: scopedLocalModelId('llamacpp', model), name: model, provider: 'llama.cpp', providerType: 'llamacpp' });
      }

      for (const om of [...ollamaModels, ...lmstudioModels, ...llamacppModels]) {
         if (!merged.find(m => m.id === om.id && m.providerType === om.providerType)) merged.push(om);
      }

      if (merged.length === 0) {
        merged.push({ id: 'everfern-1', name: 'Fern-1', provider: 'EverFern Cloud', providerType: 'everfern' as any });
      }

      const catalog = await getOpenRouterCatalog();
      return { success: true, models: applyOpenRouterCapabilities(merged, catalog) };
    } catch (error) {
      console.error('[acp:list-models] Error:', error);
      return { success: false, models: [], error: String(error) };
    }
  });
}
