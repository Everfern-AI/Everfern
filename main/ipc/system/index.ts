import { registerHardwareHandlers, KNOWN_MODELS, detectHardwareSpecsAsync, enrichModelWithHardware } from './hardware-handlers';
import { registerOcrDocHandlers, installOcrWithProgress, launchOcrInstallTerminal, imageMimeFromPath } from './ocr-doc-handlers';
import { registerEnvironmentHandlers } from './environment-handlers';
import { registerOllamaAudioHandlers, getOllamaBinary, launchNativeTerminalCommand } from './ollama-audio-handlers';
import { registerDispatchHandlers } from './dispatch-handlers';
import { registerUpdateHandlers } from './update-handlers';
import { registerWindowFsHandlers } from './window-fs-handlers';
import { registerWorkerHandlers } from './worker-handlers';
import { registerSheetHandlers } from './sheet-handlers';
import { registerMigrationHandlers } from './migration-handlers';

export {
  KNOWN_MODELS,
  detectHardwareSpecsAsync,
  enrichModelWithHardware,
  installOcrWithProgress,
  launchOcrInstallTerminal,
  imageMimeFromPath,
  getOllamaBinary,
  launchNativeTerminalCommand,
};

export function registerSystemHandlers(): void {
  registerHardwareHandlers();
  registerOcrDocHandlers();
  registerEnvironmentHandlers();
  registerOllamaAudioHandlers();
  registerDispatchHandlers();
  registerUpdateHandlers();
  registerWindowFsHandlers();
  registerWorkerHandlers();
  registerSheetHandlers();
  registerMigrationHandlers();
}
