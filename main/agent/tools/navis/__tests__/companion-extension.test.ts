import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureNavisCompanionExtension } from '../companion-extension';

function withTempDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-navis-extension-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Navis companion extension', () => {
  it('writes a main-profile companion extension with bridge and browser-control permissions', () => {
    withTempDir((dir) => {
      const extensionPath = ensureNavisCompanionExtension(dir);
      const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf-8'));
      const serviceWorker = fs.readFileSync(path.join(extensionPath, 'service-worker.js'), 'utf-8');
      const sidePanelHtml = fs.readFileSync(path.join(extensionPath, 'side-panel.html'), 'utf-8');
      const sidePanelJs = fs.readFileSync(path.join(extensionPath, 'side-panel.js'), 'utf-8');
      const sidePanelCss = fs.readFileSync(path.join(extensionPath, 'side-panel.css'), 'utf-8');
      const popupHtml = fs.readFileSync(path.join(extensionPath, 'popup.html'), 'utf-8');
      const popupJs = fs.readFileSync(path.join(extensionPath, 'popup.js'), 'utf-8');

      expect(manifest.name).toBe('EverFern Navis Companion');
      expect(manifest.permissions).toContain('scripting');
      expect(manifest.permissions).toContain('debugger');
      expect(manifest.permissions).toContain('sidePanel');
      expect(manifest.permissions).toContain('storage');
      expect(manifest.side_panel.default_path).toBe('side-panel.html');
      expect(manifest.action.default_title).toBe('EverFern Navis');
      expect(manifest.action.default_popup).toBeUndefined();
      expect(manifest.host_permissions).toContain('<all_urls>');
      expect(serviceWorker).toContain('ws://127.0.0.1:4001');
      expect(serviceWorker).toContain("case 'navis-open-tab'");
      expect(serviceWorker).toContain("case 'navis-capture-active'");
      expect(serviceWorker).toContain("case 'navis-click-ref'");
      expect(serviceWorker).toContain("case 'navis-debugger-command'");
      expect(serviceWorker).toContain("case 'capture'");
      expect(serviceWorker).toContain("case 'click_text'");
      expect(serviceWorker).toContain("case 'smart_click'");
      expect(serviceWorker).toContain("case 'smart_type'");
      expect(serviceWorker).toContain("case 'press_key'");
      expect(serviceWorker).toContain("case 'scroll'");
      expect(serviceWorker).toContain("case 'wait_for_dom_change'");
      expect(serviceWorker).toContain("case 'extract_content'");
      expect(serviceWorker).toContain('function targetScore');
      expect(serviceWorker).toContain('function setEditableValue');
      expect(serviceWorker).toContain("payload.command === 'navis-progress'");
      expect(serviceWorker).toContain("chrome.runtime.onConnect.addListener");
      expect(serviceWorker).toContain('navisPanelState');
      expect(serviceWorker).toContain('function clearNavisEvents');
      expect(serviceWorker).toContain("message.type === 'clear_feed'");
      expect(serviceWorker).toContain('chrome.action.onClicked.addListener');
      expect(serviceWorker).toContain('function renderEverFernNavisOverlay');
      expect(serviceWorker).toContain('everfern-navis-page-overlay');
      expect(serviceWorker).toContain("syncOverlayToTabs('show')");
      expect(serviceWorker).toContain('EverFern Navis live task panel');
      expect(sidePanelHtml).toContain('Live thinking');
      expect(sidePanelHtml).toContain('Live state');
      expect(sidePanelHtml).toContain('Current page');
      expect(sidePanelHtml).toContain('progressBar');
      expect(sidePanelHtml).toContain('freshnessValue');
      expect(sidePanelHtml).toContain('data-filter="reasoning"');
      expect(sidePanelJs).toContain("chrome.runtime.connect({ name: 'navis-panel' })");
      expect(sidePanelJs).toContain('capture_active');
      expect(sidePanelJs).toContain("activeFilter = 'all'");
      expect(sidePanelJs).toContain('activeTitleValue');
      expect(sidePanelJs).toContain('setCaptureLoading');
      expect(sidePanelJs).toContain('timeAgo');
      expect(sidePanelJs).toContain('kindLabel');
      expect(sidePanelJs).toContain('setInterval');
      expect(sidePanelJs).toContain("type: 'clear-feed'");
      expect(sidePanelCss).toContain('.feed-item');
      expect(sidePanelCss).toContain('.mission-orb');
      expect(sidePanelCss).toContain('.progress-track');
      expect(sidePanelCss).toContain('.event-kind');
      expect(popupHtml).toContain('Open Navis side panel');
      expect(popupHtml).toContain('statusCapsule');
      expect(popupJs).toContain('open-side-panel');
    });
  });

  it('exposes prepare/status IPC and renderer preload hooks', () => {
    const ipcSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'ipc', 'tool-settings-handlers.ts'), 'utf-8');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'preload', 'preload.ts'), 'utf-8');
    const toolSource = fs.readFileSync(path.join(__dirname, '..', 'tool.ts'), 'utf-8');
    const extensionOrchestratorSource = fs.readFileSync(path.join(__dirname, '..', 'extension-orchestrator.ts'), 'utf-8');

    expect(ipcSource).toContain("ipcMain.handle('navis-extension:prepare-main-profile'");
    expect(ipcSource).toContain("ipcMain.handle('navis-extension:status'");
    expect(preloadSource).toContain('prepareNavisMainProfileExtension');
    expect(preloadSource).toContain('getNavisExtensionStatus');
    expect(toolSource).toContain('prepareNavisMainProfileExtension');
    expect(toolSource).toContain('NavisExtensionOrchestrator');
    expect(toolSource).toContain('Using extension-first browser control');
    expect(toolSource).toContain('playwright-fallback');
    expect(toolSource).toContain('broadcastNavisCompanionProgress');
    expect(extensionOrchestratorSource).toContain('Choosing the next browser action from the DOM snapshot');
    expect(extensionOrchestratorSource).toContain('this.logger.stepComplete');
  });
});
