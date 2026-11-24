import { execFileSync } from 'child_process';

/** Undefined selects the Electron store. Null means Tauri has no saved config. */
export function loadNativeProviderConfig<T>(): T | null | undefined {
  return readNativeConfig<T | null>('--ef-load-config');
}

export function hydrateNativeVlm<T>(config: object): T | null | undefined {
  return readNativeConfig<T | null>('--ef-hydrate-vlm', JSON.stringify(config));
}

export function resolveNativeToolProviderConfig<T>(config: object): T | undefined {
  return readNativeConfig<T>('--ef-tool-provider-config', JSON.stringify(config));
}

export function prepareNativeRuntimeProvider<T>(config: object): T | undefined {
  try {
    return readNativeConfig<T>('--ef-runtime-provider', JSON.stringify(config));
  } catch {
    return undefined;
  }
}

export function renderNativePrompt(template: string, replacements: Record<string, string>, sessionFiles: string[], platform: string, hostHome: string, context?: object): string | undefined {
  return readNativeConfig<string>('--ef-render-prompt', JSON.stringify({ template, replacements, sessionFiles, platform, hostHome, context }));
}

function readNativeConfig<T>(command: string, input?: string): T | undefined {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  return JSON.parse(execFileSync(executable, [command], {
    encoding: 'utf8',
    windowsHide: true,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    timeout: 10000,
  }));
}
