/**
 * Global type declarations for Electron API
 *
 * This file extends the Window interface to include the electronAPI
 * exposed by the preload script via contextBridge.
 */

import type { ElectronAPI } from '../../preload/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }

  namespace NodeJS {
    interface Process {
      resourcesPath?: string;
      defaultApp?: boolean;
    }
  }
}

export {};
