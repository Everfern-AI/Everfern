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
      const background = fs.readFileSync(path.join(extensionPath, 'background.js'), 'utf-8');
      const panelHtml = fs.readFileSync(path.join(extensionPath, 'panel.html'), 'utf-8');
      const panelJs = fs.readFileSync(path.join(extensionPath, 'panel.js'), 'utf-8');
      const panelCss = fs.readFileSync(path.join(extensionPath, 'panel.css'), 'utf-8');
      const popupHtml = fs.readFileSync(path.join(extensionPath, 'popup.html'), 'utf-8');
      const popupJs = fs.readFileSync(path.join(extensionPath, 'popup.js'), 'utf-8');

      expect(manifest.name).toBe('EverFern Navis');
      expect(manifest.permissions).toContain('scripting');
      expect(manifest.permissions).toContain('debugger');
      expect(manifest.permissions).toContain('sidePanel');
      expect(manifest.permissions).toContain('storage');
      expect(manifest.permissions).toContain('tabs');
      expect(manifest.permissions).toContain('tabGroups');
      expect(manifest.side_panel.default_path).toBe('panel.html');
      expect(manifest.action.default_title).toBe('EverFern Navis');
      expect(manifest.action.default_popup).toBe('popup.html');
      expect(manifest.host_permissions).toContain('<all_urls>');
      expect(manifest.background.service_worker).toBe('background.js');
      expect(background).toContain('ws://127.0.0.1:4001');
      expect(background).toContain("case 'open_tab'");
      expect(background).toContain("case 'navis-open-tab'");
      expect(background).toContain("case 'capture'");
      expect(background).toContain("case 'navis-capture-active'");
      expect(background).toContain("case 'click_text'");
      expect(background).toContain("case 'smart_click'");
      expect(background).toContain("case 'smart_type'");
      expect(background).toContain("case 'press_key'");
      expect(background).toContain("case 'scroll'");
      expect(background).toContain("case 'wait_for_dom_change'");
      expect(background).toContain("case 'extract_content'");
      expect(background).toContain('const targetScore');
      expect(background).toContain("Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')");
      expect(background).toContain("new InputEvent('input'");
      expect(background).toContain("new Event('change'");
      expect(background).toContain("payload.command === 'navis-progress'");
      expect(background).toContain('api.runtime.onConnect.addListener');
      expect(background).toContain('panelState');
      expect(background).toContain("message.type === 'clear-feed'");
      expect(background).toContain('api.action.onClicked.addListener');
      expect(background).toContain('function renderOverlay');
      expect(background).toContain('everfern-navis-page-overlay');
      expect(background).toContain('const renderMouse');
      expect(background).toContain('everfern-navis-mouse');
      expect(background).toContain('lastMouseByTab');
      expect(background).toContain("runPage(tabId, 'mouse'");
      expect(background).toContain("syncOverlay('show')");
      expect(background).toContain('Live browser agent');
      expect(panelHtml).toContain('Extension-first browser control');
      expect(panelHtml).toContain('Current task');
      expect(panelHtml).toContain('Current page');
      expect(panelHtml).toContain('captureBtn');
      expect(panelJs).toContain("runtime.connect({ name: 'navis-panel' })");
      expect(panelJs).toContain('capture_active');
      expect(panelJs).toContain('titleValue');
      expect(panelJs).toContain('events.slice(-80).reverse()');
      expect(panelJs).toContain('Actions and thoughts will stream here.');
      expect(panelJs).toContain("type: 'clear-feed'");
      expect(panelCss).toContain('.feed li');
      expect(panelCss).toContain('.orb');
      expect(panelCss).toContain('.mission-card');
      expect(popupHtml).toContain('Show page panel');
      expect(popupHtml).toContain('Capture current tab');
      expect(popupHtml).toContain('statusCapsule');
      expect(popupJs).toContain("type: 'open-overlay'");
      expect(popupJs).toContain("type: 'capture-active'");
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
    expect(toolSource).toContain('playwright-isolated');
    expect(toolSource).toContain('broadcastNavisCompanionProgress');
    expect(extensionOrchestratorSource).toContain('Choosing the next browser action from the DOM snapshot');
    expect(extensionOrchestratorSource).toContain('this.logger.stepComplete');
  });
});
