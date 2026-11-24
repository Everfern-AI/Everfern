import { ipcMain } from 'electron';
import { execFile } from 'child_process';
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
  if (process.env.EVERFERN_SHELL === 'tauri') {
    ipcMain.handle('acp:model-picker-config', () => {
      const active = acpManager.getActiveConfig();
      if (!active) return null;
      const { provider, model, baseUrl, customModel } = active as typeof active & { customModel?: string };
      return { provider, model, baseUrl, customModel };
    });
  }

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

  ipcMain.handle('acp:health-check', async () => {
    const active = acpManager.getActiveConfig();
    const executable = process.env.EVERFERN_SHELL === 'tauri' ? process.env.EF_NATIVE_EXE : undefined;
    const client = acpManager.getClient();
    if (!executable || !active || !client) {
      return acpManager.healthCheck();
    }
    try {
      const { provider, baseUrl, apiKey } = client.providerHealthConfig();
      return await new Promise((resolve, reject) => {
        const child = execFile(executable, ['--ef-local-health'], { windowsHide: true, timeout: 10000 }, (error, output) => {
          if (error) return reject(error);
          try { resolve(JSON.parse(output)); } catch (parseError) { reject(parseError); }
        });
        child.stdin?.once('error', reject);
        child.stdin?.end(JSON.stringify({ provider, baseUrl, apiKey }));
      });
    } catch {
      return { ok: false, provider: active.provider, error: 'Native provider health check failed' };
    }
  });

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

  if (process.env.EVERFERN_SHELL === 'tauri') return;
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

      const listLocalModels = (provider: 'ollama' | 'lmstudio' | 'llamacpp', options: { baseUrl?: string; apiKey?: string } = {}) =>
        new AIClient({ provider, ...options }).listModels();

      let ollamaModels: FlatModelEntry[] = [];
      try {
        const rawOllama = await listLocalModels('ollama');
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
        const rawLm = await listLocalModels('lmstudio');
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

      let llamacppModels: FlatModelEntry[] = [];
      try {
        const models = await listLocalModels('llamacpp', {
          baseUrl: (config?.provider === 'llamacpp' ? config.baseUrl : undefined) || (config as any)?.baseUrls?.llamacpp,
          apiKey: (config as any)?.keys?.llamacpp || (config?.provider === 'llamacpp' ? config.apiKey : undefined),
        });
        llamacppModels = models.map(id => ({
          id: scopedLocalModelId('llamacpp', id), name: id, provider: 'llama.cpp', providerType: 'llamacpp',
        }));
      } catch { /* A local server is optional. */ }
      // Keep the configured model selectable while its server is temporarily offline.
      if (providerType === 'llamacpp' && !llamacppModels.length && config.model) {
        const model = config.model.replace(/^llamacpp:/, '');
        llamacppModels.push({ id: scopedLocalModelId('llamacpp', model), name: model, provider: 'llama.cpp', providerType: 'llamacpp' });
      }

      const localModels = [...ollamaModels, ...lmstudioModels, ...llamacppModels];
      const catalog = await getOpenRouterCatalog();
      const merged = [...activeModels];
      for (const om of localModels) {
         if (!merged.find(m => m.id === om.id && m.providerType === om.providerType)) merged.push(om);
      }

      if (merged.length === 0) {
        merged.push({ id: 'everfern-1', name: 'Fern-1', provider: 'EverFern Cloud', providerType: 'everfern' as any });
      }

      return { success: true, models: applyOpenRouterCapabilities(merged, catalog) };
    } catch (error) {
      console.error('[acp:list-models] Error:', error);
      return { success: false, models: [], error: String(error) };
    }
  });
}
