import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { getAvailableBrowsers, type BrowserInfo } from '../../../lib/browser-detector';
import { findChromiumExecutable } from '../../../lib/playwright-setup';
import { bridgeServer } from '../../../lib/extension-server';

export interface NavisCompanionPrepareResult {
  success: boolean;
  message: string;
  extensionPath: string;
  browserName?: string;
  executablePath?: string;
  userDataDir?: string;
  profileDirectory?: string;
  connected: boolean;
  browserWasRunning?: boolean;
  needsBrowserRestart?: boolean;
  command?: string;
}

function extensionBaseDir(): string {
  return path.join(os.homedir(), '.everfern', 'extensions');
}

function quoteForDisplay(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function safeUrl(url: string | undefined): string {
  const value = (url || '').trim();
  if (!value) return 'about:blank?everfern-navis-extension=1';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  return `https://${value}`;
}

async function isProcessRunning(exePath: string): Promise<boolean> {
  return new Promise(resolve => {
    const processName = path.basename(exePath);
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${processName}`], (_err, stdout) => {
        resolve(Boolean(stdout) && stdout.toLowerCase().includes(processName.toLowerCase()));
      });
      return;
    }

    execFile('pgrep', ['-f', processName], (_err, stdout) => {
      resolve(Boolean(stdout?.trim()));
    });
  });
}

async function resolveBrowser(selectedBrowserId: string): Promise<BrowserInfo | null> {
  const browsers = await getAvailableBrowsers().catch(() => []);
  const lower = selectedBrowserId.toLowerCase();
  return (
    browsers.find(b => b.id === selectedBrowserId) ||
    browsers.find(b => b.id.toLowerCase().includes(lower) || b.name.toLowerCase().includes(lower)) ||
    (lower.includes('chrome') ? browsers.find(b => b.name.toLowerCase().includes('chrome') || b.id.includes('chrome')) : undefined) ||
    browsers.find(b => b.engine === 'chromium') ||
    null
  );
}

function getLastUsedProfile(userDataDir: string): string | undefined {
  const localStatePath = path.join(userDataDir, 'Local State');
  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
    const lastUsed = localState?.profile?.last_used;
    if (typeof lastUsed === 'string' && fs.existsSync(path.join(userDataDir, lastUsed))) {
      return lastUsed;
    }
  } catch {}

  if (fs.existsSync(path.join(userDataDir, 'Default'))) return 'Default';
  if (fs.existsSync(path.join(userDataDir, 'Profile 1'))) return 'Profile 1';
  return undefined;
}

function getChromiumUserDataDir(browserInfo: BrowserInfo | null): string | undefined {
  const home = os.homedir();
  const id = (browserInfo?.id || '').toLowerCase();
  const name = (browserInfo?.name || '').toLowerCase();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  if (process.platform === 'win32') {
    if (id.includes('edge') || name.includes('edge')) return path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
    if (id.includes('brave') || name.includes('brave')) return path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data');
    if (id.includes('vivaldi') || name.includes('vivaldi')) return path.join(localAppData, 'Vivaldi', 'User Data');
    if (id.includes('opera') || name.includes('opera')) return path.join(localAppData, 'Opera Software', 'Opera Stable');
    return path.join(localAppData, 'Google', 'Chrome', 'User Data');
  }

  if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    if (id.includes('edge') || name.includes('edge')) return path.join(appSupport, 'Microsoft Edge');
    if (id.includes('brave') || name.includes('brave')) return path.join(appSupport, 'BraveSoftware', 'Brave-Browser');
    if (id.includes('vivaldi') || name.includes('vivaldi')) return path.join(appSupport, 'Vivaldi');
    if (id.includes('opera') || name.includes('opera')) return path.join(appSupport, 'com.operasoftware.Opera');
    return path.join(appSupport, 'Google', 'Chrome');
  }

  const config = path.join(home, '.config');
  if (id.includes('edge') || name.includes('edge')) return path.join(config, 'microsoft-edge');
  if (id.includes('brave') || name.includes('brave')) return path.join(config, 'BraveSoftware', 'Brave-Browser');
  if (id.includes('vivaldi') || name.includes('vivaldi')) return path.join(config, 'vivaldi');
  if (id.includes('opera') || name.includes('opera')) return path.join(config, 'opera');
  return path.join(config, 'google-chrome');
}

const companionServiceWorker = String.raw`
const BRIDGE_URL = 'ws://127.0.0.1:4001';
const EXTENSION_ID = 'everfern-navis-companion';
const NAVIS_GROUP_TITLE = 'Navis Agent';
let socket = null;
let reconnectTimer = null;
let navisGroupId = -1;
const navisTabs = new Map();
const lastRefsByTab = new Map();
const panelPorts = new Set();
const navisEvents = [];
let restoredPanelState = false;
let bridgeState = {
  connected: false,
  status: 'disconnected',
  sessionActive: false,
  sessions: [],
  activeTask: '',
  activeMode: 'extension-first',
  activeUrl: '',
  activeTitle: '',
  lastEventType: '',
  lastEventAt: 0,
  lastUpdated: Date.now()
};

function persistPanelState() {
  if (!chrome.storage || !chrome.storage.local) return;
  try {
    chrome.storage.local.set({
      navisPanelState: {
        bridgeState: {
          ...bridgeState,
          connected: false,
          status: bridgeState.connected ? 'disconnected' : bridgeState.status
        },
        events: navisEvents.slice(-100),
        savedAt: Date.now()
      }
    });
  } catch {}
}

function restorePanelState() {
  if (restoredPanelState || !chrome.storage || !chrome.storage.local) return;
  restoredPanelState = true;
  try {
    chrome.storage.local.get('navisPanelState', result => {
    const saved = result && result.navisPanelState;
    if (!saved) return;
    if (Array.isArray(saved.events)) {
      navisEvents.splice(0, navisEvents.length, ...saved.events.slice(-100));
    }
    if (saved.bridgeState && typeof saved.bridgeState === 'object') {
      bridgeState = {
        ...bridgeState,
        ...saved.bridgeState,
        connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
        status: socket && socket.readyState === WebSocket.OPEN ? 'connected' : (saved.bridgeState.status || 'disconnected'),
        lastUpdated: Date.now()
      };
    }
    broadcastToPanels({ type: 'state', state: getPanelState() });
    });
  } catch {}
}

function getPanelState() {
  restorePanelState();
  return {
    ...bridgeState,
    connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
    status: socket && socket.readyState === WebSocket.OPEN ? 'connected' : bridgeState.status,
    events: navisEvents.slice(-100),
    lastUpdated: Date.now()
  };
}

function broadcastToPanels(message) {
  panelPorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch {
      panelPorts.delete(port);
    }
  });
}

function updateBridgeState(patch) {
  bridgeState = { ...bridgeState, ...patch, lastUpdated: Date.now() };
  persistPanelState();
  broadcastToPanels({ type: 'state', state: getPanelState() });
  syncOverlayToTabs('update');
}

function clearNavisEvents() {
  navisEvents.splice(0, navisEvents.length);
  bridgeState.lastEventType = '';
  bridgeState.lastEventAt = 0;
  persistPanelState();
  broadcastToPanels({ type: 'state', state: getPanelState() });
}

function rememberNavisEvent(event) {
  const clean = {
    ...event,
    timestamp: event && event.timestamp ? event.timestamp : new Date().toISOString()
  };
  const task = clean.timelineBranch && clean.timelineBranch.taskDescription;
  const mode = clean.metadata && clean.metadata.mode;
  const metadata = clean.metadata || {};
  const action = clean.action || {};
  const actionParams = action.params || {};
  if (task) bridgeState.activeTask = String(task);
  if (mode) bridgeState.activeMode = String(mode);
  if (metadata.url || actionParams.url) bridgeState.activeUrl = String(metadata.url || actionParams.url);
  if (metadata.title) bridgeState.activeTitle = String(metadata.title);
  bridgeState.lastEventType = String(clean.type || 'step');
  bridgeState.lastEventAt = Date.now();
  navisEvents.push(clean);
  while (navisEvents.length > 140) navisEvents.shift();
  persistPanelState();
  broadcastToPanels({ type: 'navis-event', event: clean, state: getPanelState() });
  syncOverlayToTabs('show');
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function respond(requestId, success, data, error) {
  if (!requestId) return;
  send({ type: 'response', requestId, success, data, error: error ? String(error.message || error) : undefined });
}

function connect() {
  restorePanelState();
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(BRIDGE_URL);
    socket.onopen = () => {
      updateBridgeState({ connected: true, status: 'connected' });
      send({
        type: 'handshake',
        extensionId: EXTENSION_ID,
        extensionVersion: chrome.runtime.getManifest().version,
        mode: 'main-profile',
        userAgent: navigator.userAgent,
        timestamp: Date.now()
      });
    };
    socket.onmessage = async event => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        console.warn('[EverFern Navis] Invalid bridge payload', error);
        return;
      }
      if (payload.type === 'state-update') {
        const sessions = payload.data && Array.isArray(payload.data.sessions) ? payload.data.sessions : [];
        const activeSession = (payload.data && payload.data.playwrightSession) || sessions[0] || null;
        updateBridgeState({
          status: payload.data && payload.data.status || 'connected',
          sessionActive: Boolean(payload.data && payload.data.sessionActive),
          sessions,
          playwrightSession: activeSession,
          activeUrl: activeSession && activeSession.url ? activeSession.url : bridgeState.activeUrl,
          activeTitle: activeSession && activeSession.title ? activeSession.title : bridgeState.activeTitle
        });
        return;
      }
      if (payload.type !== 'command') return;
      if (payload.command === 'navis-progress') {
        rememberNavisEvent(payload.data || {});
        return;
      }
      if (payload.command === 'activate-extension') {
        updateBridgeState({
          status: 'active',
          sessionActive: true,
          sessions: payload.data ? [payload.data] : bridgeState.sessions,
          playwrightSession: payload.data || null
        });
        return;
      }
      try {
        const data = await handleCommand(payload.command, payload.data || {});
        respond(payload.requestId, true, data);
      } catch (error) {
        console.warn('[EverFern Navis] Command failed', payload.command, error);
        respond(payload.requestId, false, null, error);
      }
    };
    socket.onclose = () => {
      updateBridgeState({ connected: false, status: 'reconnecting' });
      scheduleReconnect();
    };
    socket.onerror = () => {
      updateBridgeState({ connected: false, status: 'reconnecting' });
      scheduleReconnect();
    };
  } catch {
    updateBridgeState({ connected: false, status: 'reconnecting' });
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 1000);
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return 'about:blank?navis=true';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  return 'https://' + value;
}

async function ensureNavisGroup(tabId) {
  if (!tabId || !chrome.tabGroups) return;
  try {
    if (navisGroupId < 0) {
      const groups = await chrome.tabGroups.query({ title: NAVIS_GROUP_TITLE });
      if (groups.length) navisGroupId = groups[0].id;
    }
    if (navisGroupId >= 0) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: navisGroupId });
      return;
    }
    navisGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(navisGroupId, { title: NAVIS_GROUP_TITLE, color: 'blue' });
  } catch (error) {
    console.warn('[EverFern Navis] Failed to group tab', error);
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function canInjectIntoTab(tab) {
  const url = String(tab && tab.url || '');
  return Boolean(tab && tab.id && /^(https?:|file:)/i.test(url));
}

async function overlayTargetTabs() {
  const targets = [];
  const seen = new Set();
  const active = await activeTab().catch(() => null);
  if (canInjectIntoTab(active)) {
    targets.push(active);
    seen.add(active.id);
  }
  for (const tabId of navisTabs.keys()) {
    if (seen.has(tabId)) continue;
    try {
      const tab = await chrome.tabs.get(Number(tabId));
      if (canInjectIntoTab(tab)) {
        targets.push(tab);
        seen.add(tab.id);
      }
    } catch {}
  }
  if (navisGroupId >= 0) {
    try {
      const groupTabs = await chrome.tabs.query({ groupId: navisGroupId });
      for (const tab of groupTabs) {
        if (seen.has(tab.id)) continue;
        if (canInjectIntoTab(tab)) {
          targets.push(tab);
          seen.add(tab.id);
        }
      }
    } catch {}
  }
  return targets;
}

async function syncOverlayToTabs(mode) {
  const state = getPanelState();
  const tabs = await overlayTargetTabs().catch(() => []);
  await Promise.all(tabs.map(async tab => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: renderEverFernNavisOverlay,
        args: [state, { mode: mode || 'update' }]
      });
    } catch (error) {
      console.debug('[EverFern Navis] Overlay injection skipped:', error && error.message || error);
    }
  }));
}

function renderEverFernNavisOverlay(state, options) {
  const hostId = 'everfern-navis-page-overlay';
  const existing = document.getElementById(hostId);
  const mode = options && options.mode || 'update';
  if (mode === 'hide') {
    if (existing) existing.remove();
    return { success: true, visible: false };
  }
  if (mode === 'toggle' && existing) {
    existing.remove();
    return { success: true, visible: false };
  }
  const events = Array.isArray(state && state.events) ? state.events.slice(-10) : [];
  if (mode === 'update' && !existing && !events.length && !(state && state.sessionActive)) {
    return { success: true, visible: false };
  }

  function clean(value, fallback) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text || fallback || '';
  }
  function esc(value) {
    return clean(value, '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function kind(event) {
    if (!event) return 'step';
    if (event.type === 'reasoning') return 'thought';
    if (event.type === 'action') return 'action';
    if (event.type === 'complete') return 'done';
    if (event.type === 'abort' || event.type === 'error') return 'error';
    return 'step';
  }
  function kindLabel(value) {
    if (value === 'thought') return 'Thinking';
    if (value === 'action') return 'Action';
    if (value === 'done') return 'Done';
    if (value === 'error') return 'Issue';
    return 'Step';
  }
  function eventTitle(event) {
    if (!event) return 'Waiting for Navis';
    if (event.type === 'reasoning') return 'Thinking';
    if (event.type === 'action') return clean(event.action && event.action.description, 'Browser action');
    if (event.type === 'complete') return 'Task complete';
    if (event.type === 'abort' || event.type === 'error') return 'Needs attention';
    return 'Working';
  }
  function eventBody(event) {
    if (!event) return 'Navis will stream browser thoughts and actions here.';
    return clean(event.content || event.detail || event.message || (event.metadata && event.metadata.title), 'Working through the current page.');
  }
  function timeLabel(timestamp) {
    if (!timestamp) return 'No updates yet';
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return 'Updated recently';
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 5) return 'Live just now';
    if (seconds < 60) return 'Updated ' + seconds + 's ago';
    return 'Updated ' + Math.round(seconds / 60) + 'm ago';
  }
  function meta(event) {
    const parts = [];
    if (event && event.stepNumber) parts.push('step ' + event.stepNumber + (event.totalSteps ? '/' + event.totalSteps : ''));
    if (event && event.metadata && event.metadata.refs !== undefined) parts.push(event.metadata.refs + ' refs');
    if (event && event.timestamp) parts.push(timeLabel(event.timestamp));
    return parts.join(' · ');
  }

  const latest = events[events.length - 1];
  const progress = latest && latest.stepNumber && latest.totalSteps
    ? Math.max(3, Math.min(100, Math.round((Number(latest.stepNumber) / Number(latest.totalSteps)) * 100)))
    : (latest ? 20 : 0);

  const host = existing || document.createElement('div');
  host.id = hostId;
  host.style.position = 'fixed';
  host.style.top = '14px';
  host.style.right = '14px';
  host.style.width = 'min(390px, calc(100vw - 28px))';
  host.style.height = 'calc(100vh - 28px)';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'auto';
  if (!existing) document.documentElement.appendChild(host);
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });

  const feed = events.slice().reverse().map(event => {
    const eventKind = kind(event);
    return [
      '<li class="ef-feed-item ' + eventKind + '">',
      '<span class="ef-dot"></span>',
      '<div class="ef-feed-copy">',
      '<div class="ef-feed-heading"><span>' + kindLabel(eventKind) + '</span><strong>' + esc(eventTitle(event)) + '</strong></div>',
      '<p>' + esc(eventBody(event)) + '</p>',
      '<small>' + esc(meta(event)) + '</small>',
      '</div>',
      '</li>'
    ].join('');
  }).join('') || '<li class="ef-empty">Navis thoughts, clicks, typing, and page reads will appear here as soon as a task starts.</li>';

  root.innerHTML = [
    '<style>',
    '@import url("https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700;800;900&display=swap");',
    ':host{all:initial}',
    '.ef-shell{height:100%;display:flex;flex-direction:column;box-sizing:border-box;background:#f3f6fa;border:2px solid rgba(255,255,255,0.75);border-radius:28px;box-shadow:8px 8px 20px rgba(163,177,198,0.45),-8px -8px 20px rgba(255,255,255,0.85),inset 4px 4px 10px rgba(163,177,198,0.22),inset -4px -4px 10px rgba(255,255,255,0.92);font-family:"Figtree",system-ui,sans-serif;color:#2e3a59;overflow:hidden}',
    '.ef-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 20px 14px}',
    '.ef-brand{display:flex;align-items:center;gap:12px;min-width:0}',
    '.ef-logo{width:38px;height:38px;border-radius:12px;background:#3b82f6;color:#fff;display:grid;place-items:center;font-weight:900;font-size:16px;box-shadow:3px 3px 6px rgba(59,130,246,0.3),inset 2px 2px 4px rgba(255,255,255,0.4),inset -2px -2px 4px rgba(0,0,0,0.2)}',
    '.ef-title{min-width:0}.ef-title strong{display:block;font-size:15px;line-height:1.2;font-weight:800;color:#1a202c}.ef-title span{display:block;margin-top:2px;color:#718096;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ef-close{width:30px;height:30px;border:none;border-radius:11px;background:#fff;color:#718096;font:16px/1 "Figtree",sans-serif;font-weight:700;cursor:pointer;display:grid;place-items:center;box-shadow:3px 3px 6px rgba(163,177,198,0.3),-3px -3px 6px rgba(255,255,255,0.8),inset 2px 2px 4px rgba(163,177,198,0.1),inset -2px -2px 4px rgba(255,255,255,0.9);transition:all 0.2s ease}',
    '.ef-close:active{box-shadow:inset 2px 2px 4px rgba(163,177,198,0.2),inset -2px -2px 4px rgba(255,255,255,0.4)}',
    '.ef-body{display:flex;flex-direction:column;gap:14px;min-height:0;flex:1;padding:14px;overflow-y:auto}',
    '.ef-body::-webkit-scrollbar{width:8px}',
    '.ef-body::-webkit-scrollbar-track{background:transparent}',
    '.ef-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px}',
    '.ef-status{display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:20px;background:#fff;padding:12px 14px;border:1px solid rgba(255,255,255,0.85);box-shadow:4px 4px 10px rgba(163,177,198,0.22),-4px -4px 10px rgba(255,255,255,0.85),inset 2px 2px 4px rgba(163,177,198,0.15),inset -2px -2px 4px rgba(255,255,255,0.9)}',
    '.ef-status-left{flex:1;min-width:0}',
    '.ef-status strong{display:block;margin-top:4px;font-size:13px;line-height:1.35;font-weight:750;color:#2d3748;overflow-wrap:anywhere;max-height:120px;overflow-y:auto;padding-right:10px}',
    '.ef-status strong::-webkit-scrollbar{width:6px}',
    '.ef-status strong::-webkit-scrollbar-track{background:#f3f6fa;border-radius:10px;box-shadow:inset 1px 1px 3px rgba(163,177,198,0.2)}',
    '.ef-status strong::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px}',
    '.ef-status strong::-webkit-scrollbar-thumb:hover{background:#a3b1c6}',
    '.ef-kicker{display:block;color:#a0aec0;font-size:9.5px;text-transform:uppercase;font-weight:800;letter-spacing:.08em}',
    '.ef-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;background:#e6f4ea;border:1px solid rgba(255,255,255,0.9);color:#137333;font-size:10.5px;font-weight:700;white-space:nowrap;box-shadow:2px 2px 4px rgba(163,177,198,0.15),inset 1px 1px 2px rgba(255,255,255,0.4),inset -1px -1px 2px rgba(0,0,0,0.05)}.ef-pill:before{content:"";width:7px;height:7px;border-radius:99px;background:#1e8e3e;box-shadow:0 0 10px rgba(30,142,62,.4)}.ef-pill.waiting{background:#fef7e0;color:#b06000}.ef-pill.waiting:before{background:#f9ab00;box-shadow:none}',
    '.ef-mission{display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;align-items:center;border-radius:20px;background:#fff;padding:14px;border:1px solid rgba(255,255,255,0.85);box-shadow:4px 4px 10px rgba(163,177,198,0.22),-4px -4px 10px rgba(255,255,255,0.85),inset 2px 2px 4px rgba(163,177,198,0.15),inset -2px -2px 4px rgba(255,255,255,0.9)}',
    '.ef-orb{width:40px;height:40px;border-radius:999px;background:radial-gradient(circle at 30% 24%,#fff 0%,#a5f3fc 20%,#3b82f6 50%,#8b5cf6 80%,#06b6d4 100%);box-shadow:0 4px 12px rgba(59,130,246,0.25),inset 2px 2px 4px rgba(255,255,255,0.9),inset -2px -2px 4px rgba(0,0,0,0.2);animation:efPulse 2.4s ease-in-out infinite}@keyframes efPulse{0%,100%{transform:scale(.95)}50%{transform:scale(1.05)}}',
    '.ef-mission strong{display:block;font-size:14px;line-height:1.25;font-weight:800;color:#1a202c}.ef-mission p{margin:5px 0 0;color:#4a5568;font-size:12px;line-height:1.45;overflow-wrap:anywhere}',
    '.ef-progress{height:8px;margin-top:10px;border-radius:999px;background:#e2e8f0;box-shadow:inset 1px 1px 3px rgba(0,0,0,0.15),inset -1px -1px 3px rgba(255,255,255,0.85);overflow:hidden}',
    '.ef-progress span{display:block;height:100%;width:' + progress + '%;border-radius:inherit;background:linear-gradient(90deg,#38bdf8,#3b82f6 48%,#8b5cf6);box-shadow:inset 1px 1px 2px rgba(255, 255, 255, 0.4),inset -1px -1px 2px rgba(0, 0, 0, 0.15);transition:width .22s ease}.ef-fresh{margin-top:6px;color:#a0aec0;font-size:10.5px}',
    '.ef-page{border-radius:20px;background:#fff;padding:12px 14px;border:1px solid rgba(255,255,255,0.85);box-shadow:4px 4px 10px rgba(163,177,198,0.22),-4px -4px 10px rgba(255,255,255,0.85),inset 2px 2px 4px rgba(163,177,198,0.15),inset -2px -2px 4px rgba(255,255,255,0.9)}.ef-page strong{display:block;margin-top:4px;font-size:12.5px;line-height:1.35;font-weight:750;color:#2d3748;overflow-wrap:anywhere}.ef-page p{margin:4px 0 0;color:#718096;font-size:11.5px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ef-feed-title{display:flex;align-items:center;justify-content:space-between;margin:4px 4px 0;color:#718096;font-size:10.5px;text-transform:uppercase;font-weight:800;letter-spacing:.08em}',
    '.ef-feed{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;min-height:0;overflow:auto;padding-right:2px}',
    '.ef-feed::-webkit-scrollbar{width:8px}',
    '.ef-feed::-webkit-scrollbar-track{background:#f3f6fa;border-radius:10px;box-shadow:inset 2px 2px 5px rgba(163,177,198,0.22),inset -2px -2px 5px rgba(255,255,255,0.92)}',
    '.ef-feed::-webkit-scrollbar-thumb{background:#a3b1c6;border-radius:10px;border:2px solid #f3f6fa;box-shadow:1px 1px 3px rgba(163,177,198,0.4),-1px -1px 3px rgba(255,255,255,0.8)}',
    '.ef-feed::-webkit-scrollbar-thumb:hover{background:#718096}',
    '.ef-feed-item,.ef-empty{display:grid;grid-template-columns:12px minmax(0,1fr);gap:10px;border-radius:18px;background:#fff;padding:11px 12px;border:1px solid rgba(255,255,255,0.85);box-shadow:3px 3px 8px rgba(163,177,198,0.15),-3px -3px 8px rgba(255,255,255,0.7),inset 2px 2px 4px rgba(163,177,198,0.15),inset -2px -2px 4px rgba(255,255,255,0.9)}.ef-empty{display:block;color:#718096;font-size:12px;line-height:1.5}',
    '.ef-feed-item.thought{background:linear-gradient(90deg,#f3e8ff,#fff 40%)}.ef-feed-item.action{background:linear-gradient(90deg,#e0f2fe,#fff 40%)}.ef-feed-item.done{background:linear-gradient(90deg,#dcfce7,#fff 40%)}',
    '.ef-dot{width:9px;height:9px;margin-top:5px;border-radius:999px;background:#3b82f6;box-shadow:inset 1px 1px 2px rgba(255,255,255,0.8)}.ef-feed-item.thought .ef-dot{background:#8b5cf6}.ef-feed-item.done .ef-dot{background:#22a566}.ef-feed-item.error .ef-dot{background:#ef4444}',
    '.ef-feed-heading{display:flex;align-items:center;gap:7px;min-width:0}.ef-feed-heading span{height:18px;padding:0 7px;border-radius:999px;background:#edf2f7;color:#4a5568;font-size:9.5px;font-weight:800;line-height:18px;text-transform:uppercase;letter-spacing:.04em}.ef-feed-heading strong{min-width:0;color:#1a202c;font-size:12.5px;line-height:1.35;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ef-feed-copy p{margin:5px 0 0;color:#4a5568;font-size:11.5px;line-height:1.45}.ef-feed-copy small{display:block;margin-top:6px;color:#a0aec0;font:10px ui-monospace,monospace}',
    '@media (max-width:520px){.ef-shell{border-radius:22px}.ef-top{padding:16px}.ef-body{padding:12px}}',
    '</style>',
    '<aside class="ef-shell" role="complementary" aria-label="EverFern Navis live task panel">',
    '<header class="ef-top"><div class="ef-brand"><div class="ef-logo">N</div><div class="ef-title"><strong>EverFern Navis</strong><span>Live browser agent</span></div></div><button class="ef-close" type="button" aria-label="Close EverFern Navis panel">x</button></header>',
    '<section class="ef-body">',
    '<div class="ef-status"><div class="ef-status-left"><span class="ef-kicker">Task</span><strong>' + esc(state && state.activeTask || 'No active Navis task yet') + '</strong></div><span class="ef-pill ' + (state && state.connected ? '' : 'waiting') + '">' + (state && state.connected ? 'Live' : 'Waiting') + '</span></div>',
    '<div class="ef-mission"><div class="ef-orb"></div><div><span class="ef-kicker">Now</span><strong>' + esc(eventTitle(latest)) + '</strong><p>' + esc(eventBody(latest)) + '</p><div class="ef-progress"><span></span></div><div class="ef-fresh">' + esc(timeLabel(latest && latest.timestamp)) + '</div></div></div>',
    '<div class="ef-page"><span class="ef-kicker">Current page</span><strong>' + esc(state && state.activeTitle || document.title || 'Current tab') + '</strong><p>' + esc(state && state.activeUrl || location.href) + '</p></div>',
    '<div class="ef-feed-title"><span>Agent activity</span><span>' + events.length + ' events</span></div>',
    '<ol class="ef-feed">' + feed + '</ol>',
    '</section>',
    '</aside>'
  ].join('');

  const closeButton = root.querySelector('.ef-close');
  if (closeButton) closeButton.addEventListener('click', () => host.remove(), { once: true });
  return { success: true, visible: true };
}

function capturePageSnapshot() {
  const textOf = (node, max = 160) => {
    if (!node) return '';
    return String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  };
  const attr = (node, name, max = 160) => {
    const value = node.getAttribute(name);
    return value ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '';
  };
  const cssEscape = value => {
    const css = window.CSS;
    return css && css.escape ? css.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  };
  const compactSelector = node => {
    const testId = node.getAttribute('data-testid') || node.getAttribute('data-test') || node.getAttribute('data-cy');
    if (testId) return '[data-testid="' + cssEscape(testId) + '"]';
    const id = node.getAttribute('id');
    if (id && !/\s/.test(id)) return '#' + cssEscape(id);
    const name = node.getAttribute('name');
    const tag = node.tagName.toLowerCase();
    if (name) return tag + '[name="' + cssEscape(name) + '"]';
    const parts = [];
    let cur = node;
    for (let depth = 0; cur && depth < 4 && cur !== document.body && cur !== document.documentElement; depth++) {
      let part = cur.tagName.toLowerCase();
      const role = cur.getAttribute('role');
      if (role) part += '[role="' + cssEscape(role) + '"]';
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.tagName === cur.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };
  const nodes = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"],summary,[tabindex]'))
    .filter(node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .slice(0, 700);
  const refs = nodes.map((node, index) => {
    const ref = 'e' + (index + 1);
    node.setAttribute('data-navis-ref', ref);
    const rect = node.getBoundingClientRect();
    return {
      ref,
      tag: node.tagName.toLowerCase(),
      role: attr(node, 'role', 60) || undefined,
      name: attr(node, 'aria-label') || attr(node, 'title') || attr(node, 'value') || textOf(node),
      label: attr(node, 'aria-labelledby') || undefined,
      placeholder: attr(node, 'placeholder') || undefined,
      href: node.href || attr(node, 'href', 220) || undefined,
      selector: compactSelector(node),
      type: attr(node, 'type', 40) || undefined,
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  });
  return {
    url: location.href,
    title: document.title,
    text: textOf(document.body, 5000),
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
    refs
  };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveNode(meta) {
  if (!meta) return null;
  if (meta.ref) {
    const byRef = document.querySelector('[data-navis-ref="' + String(meta.ref).replace(/"/g, '\\"') + '"]');
    if (byRef) return byRef;
  }
  if (meta.selector) {
    try {
      const bySelector = document.querySelector(meta.selector);
      if (bySelector) return bySelector;
    } catch {}
  }
  return null;
}

function targetScore(meta, query) {
  if (!meta || meta.disabled) return -1000;
  const wanted = normalizeText(query.text || query.target || query.name || query.ref || '');
  const role = normalizeText(query.role || '');
  const href = normalizeText(query.href || query.url || '');
  const haystacks = [
    meta.ref,
    meta.name,
    meta.label,
    meta.placeholder,
    meta.role,
    meta.tag,
    meta.href,
    meta.type
  ].map(normalizeText);
  let score = 0;
  if (query.ref && String(meta.ref) === String(query.ref)) score += 1000;
  if (wanted) {
    for (const hay of haystacks) {
      if (!hay) continue;
      if (hay === wanted) score += 300;
      else if (hay.includes(wanted)) score += 120;
      else if (wanted.includes(hay) && hay.length > 2) score += 50;
    }
  }
  if (role && normalizeText(meta.role || meta.tag).includes(role)) score += 90;
  if (href && normalizeText(meta.href).includes(href)) score += 90;
  if (/button|link|a/.test(normalizeText(meta.role || meta.tag))) score += 25;
  if (/input|textarea|select|textbox|combobox|search/.test(normalizeText(meta.role + ' ' + meta.tag + ' ' + meta.type))) score += query.preferInput ? 140 : 10;
  const rect = meta.rect || {};
  if (rect.width > 0 && rect.height > 0) score += 20;
  if (rect.width > 600 || rect.height > 220) score -= 40;
  return score;
}

function findBestTarget(refs, query) {
  const safeRefs = Array.isArray(refs) ? refs : [];
  let best = null;
  let bestScore = -Infinity;
  for (const meta of safeRefs) {
    const score = targetScore(meta, query || {});
    if (score > bestScore) {
      best = meta;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) return best;

  const wanted = normalizeText(query && (query.text || query.target || query.name));
  if (!wanted) return null;
  const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],[tabindex]'));
  for (const node of candidates) {
    const text = normalizeText(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.value || node.textContent);
    if (text && (text === wanted || text.includes(wanted))) {
      return { ref: node.getAttribute('data-navis-ref') || '', name: text, selector: '', tag: node.tagName.toLowerCase(), node };
    }
  }
  return null;
}

function dispatchPointerClick(node) {
  const rect = node.getBoundingClientRect();
  const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
  const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
  const topNode = document.elementFromPoint(x, y);
  const target = topNode && (node.contains(topNode) || topNode.contains(node)) ? topNode : node;
  const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  target.dispatchEvent(new MouseEvent('mousedown', eventInit));
  target.dispatchEvent(new PointerEvent('pointerup', eventInit));
  target.dispatchEvent(new MouseEvent('mouseup', eventInit));
  target.dispatchEvent(new MouseEvent('click', eventInit));
  if (typeof node.click === 'function') node.click();
  return { x: Math.round(x), y: Math.round(y), method: target === node ? 'dom-click' : 'point-click' };
}

function clickTargetInPage(query, refs) {
  const meta = query && query.x != null && query.y != null
    ? { name: 'coordinates', node: document.elementFromPoint(Number(query.x), Number(query.y)) }
    : findBestTarget(refs, query || {});
  const node = meta && (meta.node || resolveNode(meta));
  if (!node) throw new Error('No clickable target found');
  node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  if (typeof node.focus === 'function') node.focus({ preventScroll: true });
  const click = dispatchPointerClick(node);
  return { success: true, message: 'Clicked ' + (meta.name || meta.ref || 'element'), stateChanged: true, target: meta.name || meta.ref || '', ref: meta.ref, ...click };
}

function isEditable(node) {
  if (!node) return false;
  const tag = node.tagName ? node.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable || node.getAttribute('role') === 'textbox' || node.getAttribute('contenteditable') === 'true';
}

function setEditableValue(node, text) {
  const value = String(text || '');
  node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  if (typeof node.focus === 'function') node.focus({ preventScroll: true });
  if ('value' in node) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
    if (descriptor && descriptor.set) descriptor.set.call(node, value);
    else node.value = value;
  } else {
    node.textContent = value;
  }
  node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
  const actual = 'value' in node ? node.value : node.textContent;
  return String(actual || '');
}

function inputTargetInPage(query, refs) {
  const requested = { ...(query || {}), preferInput: true };
  let meta = requested.ref ? findBestTarget(refs, requested) : findBestTarget(refs, requested);
  let node = meta && (meta.node || resolveNode(meta));
  if (!isEditable(node) && isEditable(document.activeElement)) node = document.activeElement;
  if (!isEditable(node)) {
    const firstEditable = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"],[role="textbox"]')).find(isEditable);
    if (firstEditable) node = firstEditable;
  }
  if (!isEditable(node)) throw new Error('No editable target found');
  const actual = setEditableValue(node, requested.text);
  if (requested.submit) {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  return { success: true, message: 'Typed into ' + ((meta && (meta.name || meta.ref)) || 'input'), stateChanged: true, target: meta && (meta.name || meta.ref), value: actual };
}

function pressKeyInPage(query, refs) {
  const meta = query && query.ref ? findBestTarget(refs, query) : null;
  const node = (meta && resolveNode(meta)) || document.activeElement || document.body;
  const key = String((query && query.key) || 'Enter');
  if (node && typeof node.focus === 'function') node.focus({ preventScroll: true });
  node.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
  node.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
  return { success: true, message: 'Pressed ' + key, stateChanged: true, key };
}

function scrollInPage(query, refs) {
  const direction = String((query && query.direction) || 'down').toLowerCase();
  const amount = Number((query && query.amount) || Math.round(window.innerHeight * 0.78));
  const delta = direction.includes('up') ? -amount : amount;
  const meta = query && query.ref ? findBestTarget(refs, query) : null;
  const node = meta && resolveNode(meta);
  if (node && node.scrollHeight > node.clientHeight) node.scrollBy({ top: delta, behavior: 'smooth' });
  else window.scrollBy({ top: delta, behavior: 'smooth' });
  return { success: true, message: 'Scrolled ' + direction, stateChanged: true, direction };
}

function waitForDomChangeInPage(timeoutMs) {
  return new Promise(resolve => {
    let changed = false;
    const observer = new MutationObserver(() => { changed = true; });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    setTimeout(() => {
      observer.disconnect();
      resolve({ success: true, message: changed ? 'DOM changed' : 'No DOM change before timeout', stateChanged: changed, url: location.href, title: document.title });
    }, Math.max(200, Number(timeoutMs) || 1000));
  });
}

function extractContentInPage(query) {
  const title = document.title;
  const url = location.href;
  const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map(h => String(h.textContent || '').trim()).filter(Boolean);
  const paragraphs = Array.from(document.querySelectorAll('p,li,article,main,section')).slice(0, 120).map(p => String(p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = [title, ...headings, ...paragraphs].join('\n').slice(0, 18000);
  const goal = query && query.goal ? String(query.goal) : 'Extract page content';
  return { success: true, message: text || 'No text content found', stateChanged: false, title, url, goal, content: text, text };
}

async function captureActive(data) {
  const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
  if (!tab || !tab.id) throw new Error('No active tab available');
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePageSnapshot });
  const snapshot = result && result.result;
  lastRefsByTab.set(tab.id, snapshot && Array.isArray(snapshot.refs) ? snapshot.refs : []);
  return {
    success: true,
    message: 'Captured active tab DOM',
    stateChanged: false,
    tab: formatTab(tab),
    tabId: tab.id,
    url: snapshot && snapshot.url || tab.url,
    title: snapshot && snapshot.title || tab.title,
    refs: snapshot && Array.isArray(snapshot.refs) ? snapshot.refs : [],
    snapshot
  };
}

function formatTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    favIconUrl: tab.favIconUrl
  };
}

async function handleCommand(command, data) {
  switch (command) {
    case 'get_tabs':
    case 'navis-get-tabs': {
      const tabs = await chrome.tabs.query({});
      return { success: true, message: 'Fetched browser tabs', stateChanged: false, tabs: tabs.map(formatTab) };
    }
    case 'open_tab':
    case 'navis-open-tab': {
      const tab = await chrome.tabs.create({ url: normalizeUrl(data.url), active: data.active !== false });
      navisTabs.set(tab.id, { sessionId: data.sessionId || 'default', createdAt: Date.now() });
      await ensureNavisGroup(tab.id);
      return { success: true, message: 'Opened tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'activate_tab':
    case 'navis-activate-tab': {
      let tabId = Number(data.tabId);
      if (!tabId && data.index !== undefined) {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const byIndex = tabs[Number(data.index)];
        tabId = Number(byIndex && byIndex.id);
      }
      if (!tabId && data.target) {
        const tabs = await chrome.tabs.query({});
        const target = String(data.target).toLowerCase();
        const match = tabs.find(tab => String(tab.url || '').toLowerCase().includes(target) || String(tab.title || '').toLowerCase().includes(target));
        tabId = Number(match && match.id);
      }
      if (!tabId) throw new Error('No tab matched activation request');
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return { success: true, message: 'Activated tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'navigate':
    case 'navis-navigate': {
      const tab = data.tabId ? await chrome.tabs.update(Number(data.tabId), { url: normalizeUrl(data.url), active: true }) : await chrome.tabs.create({ url: normalizeUrl(data.url), active: true });
      navisTabs.set(tab.id, { sessionId: data.sessionId || 'default', createdAt: Date.now() });
      await ensureNavisGroup(tab.id);
      return { success: true, message: 'Navigated tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'capture':
    case 'navis-capture-active':
      return await captureActive(data);
    case 'screenshot':
    case 'navis-screenshot-active': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.windowId) throw new Error('No active tab available');
      if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: data.quality || 70 });
      return { success: true, message: 'Captured visible tab screenshot', stateChanged: false, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title, dataUrl };
    }
    case 'click':
    case 'navis-click-ref': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clickTargetInPage, args: [{ ref: String(data.ref || ''), ...data }, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'click_text':
    case 'smart_click': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clickTargetInPage, args: [data, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'input':
    case 'navis-input-ref': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inputTargetInPage, args: [{ ref: String(data.ref || ''), text: String(data.text || ''), ...data }, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'smart_type': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inputTargetInPage, args: [data, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'press_key': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pressKeyInPage, args: [data, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'scroll': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const refs = lastRefsByTab.get(tab.id) || [];
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollInPage, args: [data, refs] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'wait_for_dom_change': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: waitForDomChangeInPage, args: [data.timeoutMs || 1000] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'extract_content': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractContentInPage, args: [data] });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result.result };
    }
    case 'go_back': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.back() });
      return { success: true, message: 'Went back', stateChanged: true, tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'close_tab': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      await chrome.tabs.remove(tab.id);
      return { success: true, message: 'Closed tab', stateChanged: true, tabId: tab.id };
    }
    case 'navis-debugger-command': {
      const tab = data.tabId ? await chrome.tabs.get(Number(data.tabId)) : await activeTab();
      if (!tab || !tab.id) throw new Error('No active tab available');
      await chrome.debugger.attach({ tabId: tab.id }, '1.3').catch(() => {});
      return await chrome.debugger.sendCommand({ tabId: tab.id }, data.method, data.params || {});
    }
    default:
      throw new Error('Unknown Navis extension command: ' + command);
  }
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async tab => {
    try {
      if (canInjectIntoTab(tab)) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: renderEverFernNavisOverlay,
          args: [getPanelState(), { mode: 'toggle' }]
        });
        return;
      }
      await syncOverlayToTabs('toggle');
    } catch (error) {
      console.warn('[EverFern Navis] Failed to toggle page overlay', error);
    }
  });
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'navis-panel') return;
  panelPorts.add(port);
  port.postMessage({ type: 'state', state: getPanelState() });
  port.onMessage.addListener(async message => {
    if (!message || message.type === 'refresh_state') {
      port.postMessage({ type: 'state', state: getPanelState() });
      return;
    }
    if (message.type === 'capture_active') {
      try {
        const result = await captureActive({});
        rememberNavisEvent({
          type: 'step',
          content: 'Captured active tab DOM from the extension panel.',
          metadata: { url: result.url, title: result.title, refs: Array.isArray(result.refs) ? result.refs.length : 0 }
        });
        port.postMessage({ type: 'capture-result', data: result });
      } catch (error) {
        port.postMessage({ type: 'panel-error', error: String(error && error.message || error) });
      }
      return;
    }
    if (message.type === 'clear_feed') {
      clearNavisEvents();
      port.postMessage({ type: 'feed-cleared', state: getPanelState() });
    }
  });
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type === 'get-state') {
    sendResponse(getPanelState());
    return true;
  }
  if (message.type === 'open-side-panel') {
    const openPanel = async () => {
      await syncOverlayToTabs('toggle');
      if (!chrome.sidePanel || !chrome.sidePanel.open) {
        return { success: true, overlay: true, sidePanel: false };
      }
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      return { success: true, overlay: true, sidePanel: true };
    };
    openPanel().then(sendResponse).catch(error => sendResponse({ success: false, error: String(error && error.message || error) }));
    return true;
  }
  if (message.type === 'clear-feed') {
    clearNavisEvents();
    sendResponse({ success: true, state: getPanelState() });
    return true;
  }
  return false;
});

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isNavisGroup = navisGroupId >= 0 && tab && tab.groupId === navisGroupId;
  if ((tab && tab.url && tab.url.includes('navis=true')) || isNavisGroup) {
    if (!navisTabs.has(tabId)) {
      navisTabs.set(tabId, { sessionId: 'default', createdAt: Date.now() });
    }
  }
  if (changeInfo.status === 'complete' || changeInfo.groupId !== undefined) {
    if (isNavisGroup || navisTabs.has(tabId)) {
      ensureNavisGroup(tabId);
      syncOverlayToTabs('show');
    }
  }
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'navis-bridge-keepalive') connect();
});
chrome.alarms.create('navis-bridge-keepalive', { periodInMinutes: 0.5 });
connect();
`;

const companionSidePanelHtml = String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EverFern Navis</title>
  <link rel="stylesheet" href="side-panel.css" />
</head>
<body>
  <main class="panel-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">N</div>
        <div>
          <h1>Navis</h1>
          <p>Extension-first browser control</p>
        </div>
      </div>
      <span id="statusPill" class="status-pill disconnected">Disconnected</span>
    </header>

    <section class="summary-card">
      <div class="summary-row">
        <span class="label">Mode</span>
        <strong id="modeValue">extension-first</strong>
      </div>
      <div class="summary-row">
        <span class="label">Bridge</span>
        <strong id="bridgeValue">Waiting</strong>
      </div>
      <div class="summary-row">
        <span class="label">Task</span>
        <strong id="taskValue">No active Navis task yet</strong>
      </div>
    </section>

    <section class="mission-card">
      <div class="mission-orb" aria-hidden="true"></div>
      <div class="mission-copy">
        <span class="label">Live state</span>
        <strong id="latestValue">Waiting for Navis</strong>
        <p id="stepValue">No browser steps yet</p>
        <div class="progress-track" aria-hidden="true">
          <span id="progressBar"></span>
        </div>
        <p id="freshnessValue" class="freshness">No live updates yet</p>
      </div>
    </section>

    <section class="page-card">
      <span class="label">Current page</span>
      <strong id="activeTitleValue">No active page captured</strong>
      <p id="activeUrlValue">Capture the current tab or start a Navis task.</p>
    </section>

    <section class="actions-card">
      <button id="captureBtn" type="button">Capture current page DOM</button>
      <button id="clearBtn" type="button" class="ghost">Clear feed</button>
    </section>

    <section class="feed-section">
      <div class="section-title">
        <span>Live thinking</span>
        <span id="eventCount">0 events</span>
      </div>
      <div class="feed-filters" role="tablist" aria-label="Filter Navis feed">
        <button class="filter-chip active" type="button" data-filter="all">All</button>
        <button class="filter-chip" type="button" data-filter="reasoning">Thoughts</button>
        <button class="filter-chip" type="button" data-filter="action">Actions</button>
      </div>
      <ol id="feed" class="feed">
        <li class="empty-state">Navis thoughts and browser actions will stream here while a task runs.</li>
      </ol>
    </section>
  </main>
  <script src="side-panel.js"></script>
</body>
</html>
`;

const companionSidePanelCss = String.raw`
:root {
  color-scheme: light;
  --bg: #f5f4f0;
  --surface: #fffefb;
  --surface-muted: #faf8f2;
  --border: #e6dfd1;
  --border-strong: #d5ccbc;
  --text: #1f1d1a;
  --muted: #77716a;
  --dim: #aaa39a;
  --green: #22a566;
  --blue: #3b82f6;
  --purple: #7c3aed;
  --red: #ef4444;
  --amber: #d97706;
  --shadow: 0 10px 26px rgba(32, 30, 26, 0.06), 0 1px 2px rgba(32, 30, 26, 0.08), inset 0 1px 0 rgba(255,255,255,0.82);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  background: var(--bg);
  color: var(--text);
}

.panel-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: #1f1d1a;
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
  box-shadow: var(--shadow);
}

h1 {
  margin: 0;
  font-size: 16px;
  line-height: 1.1;
  font-weight: 680;
  letter-spacing: 0;
}

p {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--muted);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.status-pill::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dim);
}

.status-pill.connected {
  color: var(--green);
}

.status-pill.connected::before {
  background: var(--green);
  box-shadow: 0 0 10px rgba(34, 165, 102, 0.35);
}

.summary-card,
.actions-card,
.mission-card,
.page-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.summary-card {
  padding: 12px;
}

.summary-row {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(230, 223, 209, 0.72);
}

.summary-row:last-child { border-bottom: 0; }

.mission-card {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 11px;
  align-items: center;
  padding: 12px;
  background:
    radial-gradient(circle at 10% 0%, rgba(59,130,246,0.10), transparent 32%),
    radial-gradient(circle at 100% 0%, rgba(124,58,237,0.09), transparent 30%),
    var(--surface);
}

.mission-orb {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 32% 25%, rgba(255,255,255,0.95) 0%, rgba(142,231,255,0.92) 17%, rgba(59,130,246,0.92) 46%, rgba(124,58,237,0.9) 76%, rgba(20,184,166,0.82) 100%);
  box-shadow: 0 0 22px rgba(59,130,246,0.28), inset 0 1px 3px rgba(255,255,255,0.88);
  animation: navis-pulse 2.7s ease-in-out infinite;
}

@keyframes navis-pulse {
  0%, 100% { transform: scale(0.96); filter: saturate(1); }
  50% { transform: scale(1.04); filter: saturate(1.2); }
}

.mission-copy p,
.page-card p {
  overflow-wrap: anywhere;
}

.progress-track {
  position: relative;
  height: 6px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(32, 30, 26, 0.08);
}

.progress-track span {
  display: block;
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #8ee7ff, #3b82f6 48%, #7c3aed);
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.32);
  transition: width 220ms ease;
}

.freshness {
  margin-top: 6px;
  color: var(--dim);
  font-size: 10.5px;
}

.page-card {
  padding: 12px;
}

.label {
  color: var(--dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

strong {
  min-width: 0;
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.45;
  font-weight: 540;
  overflow-wrap: anywhere;
}

.actions-card {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 10px;
}

button {
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--text);
  color: #ffffff;
  font: inherit;
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
}

button.ghost {
  background: var(--surface-muted);
  color: var(--text);
}

button:hover {
  filter: brightness(0.98);
}

button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.feed-section {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 9px;
  color: var(--muted);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.feed-filters {
  display: inline-flex;
  gap: 6px;
  width: max-content;
  max-width: 100%;
  margin: 0 0 9px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 254, 251, 0.68);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72);
}

.filter-chip {
  height: 25px;
  padding: 0 10px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.filter-chip.active {
  background: var(--text);
  color: white;
  box-shadow: 0 4px 10px rgba(32, 30, 26, 0.12);
}

.feed {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feed-item,
.empty-state {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 11px 12px;
  box-shadow: var(--shadow);
}

.empty-state {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.feed-item {
  display: grid;
  grid-template-columns: 13px minmax(0, 1fr);
  gap: 10px;
}

.feed-item.reasoning {
  background:
    linear-gradient(90deg, rgba(124,58,237,0.08), transparent 44%),
    var(--surface);
}

.feed-item.action {
  background:
    linear-gradient(90deg, rgba(59,130,246,0.08), transparent 44%),
    var(--surface);
}

.feed-item.complete {
  background:
    linear-gradient(90deg, rgba(34,165,102,0.08), transparent 44%),
    var(--surface);
}

.event-dot {
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff 0%, #8ee7ff 20%, #3b82f6 55%, #7c3aed 100%);
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.34);
}

.event-dot.reasoning {
  background: radial-gradient(circle at 35% 30%, #ffffff 0%, #c4b5fd 20%, #7c3aed 58%, #3b82f6 100%);
  box-shadow: 0 0 14px rgba(124, 58, 237, 0.34);
}

.event-dot.action { background: var(--blue); box-shadow: 0 0 10px rgba(59, 130, 246, 0.24); }
.event-dot.step { background: var(--amber); box-shadow: 0 0 10px rgba(217, 119, 6, 0.2); }
.event-dot.complete { background: var(--green); box-shadow: none; }
.event-dot.abort { background: var(--red); box-shadow: none; }

.event-title {
  margin: 0;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 610;
  line-height: 1.35;
}

.event-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.event-kind {
  flex: 0 0 auto;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(32, 30, 26, 0.06);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 18px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.event-body {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.event-meta {
  margin: 6px 0 0;
  color: var(--dim);
  font: 10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
}
`;

const companionSidePanelJs = String.raw`
const statusPill = document.getElementById('statusPill');
const modeValue = document.getElementById('modeValue');
const bridgeValue = document.getElementById('bridgeValue');
const taskValue = document.getElementById('taskValue');
const latestValue = document.getElementById('latestValue');
const stepValue = document.getElementById('stepValue');
const progressBar = document.getElementById('progressBar');
const freshnessValue = document.getElementById('freshnessValue');
const activeTitleValue = document.getElementById('activeTitleValue');
const activeUrlValue = document.getElementById('activeUrlValue');
const feed = document.getElementById('feed');
const eventCount = document.getElementById('eventCount');
const captureBtn = document.getElementById('captureBtn');
const clearBtn = document.getElementById('clearBtn');
const filterChips = Array.from(document.querySelectorAll('.filter-chip'));

let localEvents = [];
let port = null;
let activeFilter = 'all';
let captureLoading = false;

function text(value, fallback) {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  return out || fallback || '';
}

function labelFor(event) {
  if (!event) return 'Event';
  if (event.type === 'reasoning') return 'Thinking';
  if (event.type === 'action') return event.action && event.action.description || 'Browser action';
  if (event.type === 'screenshot') return 'Captured screen';
  if (event.type === 'complete') return 'Task complete';
  if (event.type === 'abort' || event.type === 'error') return 'Stopped';
  return 'Step';
}

function kindLabel(kind) {
  if (kind === 'reasoning') return 'Thought';
  if (kind === 'action') return 'Action';
  if (kind === 'complete') return 'Done';
  if (kind === 'abort') return 'Error';
  return 'Step';
}

function eventKind(event) {
  if (!event) return 'step';
  if (event.type === 'reasoning') return 'reasoning';
  if (event.type === 'action') return 'action';
  if (event.type === 'complete') return 'complete';
  if (event.type === 'abort' || event.type === 'error') return 'abort';
  return 'step';
}

function timeAgo(timestamp) {
  if (!timestamp) return 'No live updates yet';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Updated recently';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 5) return 'Live just now';
  if (seconds < 60) return 'Updated ' + seconds + 's ago';
  const minutes = Math.round(seconds / 60);
  return 'Updated ' + minutes + 'm ago';
}

function bodyFor(event) {
  if (!event) return '';
  if (event.type !== 'action' && event.action && event.action.description) return event.action.description;
  return text(event.content || event.detail || event.message || (event.metadata && event.metadata.title), '');
}

function metaFor(event) {
  const parts = [];
  if (event.stepNumber) parts.push('step ' + event.stepNumber + (event.totalSteps ? '/' + event.totalSteps : ''));
  if (event.metadata && event.metadata.refs !== undefined) parts.push(event.metadata.refs + ' refs');
  if (event.metadata && event.metadata.url) parts.push(event.metadata.url);
  if (event.timestamp) {
    try { parts.push(new Date(event.timestamp).toLocaleTimeString()); } catch {}
  }
  return parts.join(' | ');
}

function renderState(state) {
  const connected = Boolean(state && state.connected);
  statusPill.textContent = connected ? 'Connected' : 'Disconnected';
  statusPill.className = 'status-pill ' + (connected ? 'connected' : 'disconnected');
  modeValue.textContent = text(state && state.activeMode, 'extension-first');
  bridgeValue.textContent = connected ? 'Live on localhost bridge' : text(state && state.status, 'Waiting for EverFern');
  taskValue.textContent = text(state && state.activeTask, 'No active Navis task yet');
  activeTitleValue.textContent = text(state && state.activeTitle, 'No active page captured');
  activeUrlValue.textContent = text(state && state.activeUrl, 'Capture the current tab or start a Navis task.');
  if (state && Array.isArray(state.events)) {
    localEvents = state.events.slice(-100);
  }
  renderFeed();
}

function renderFeed() {
  const latest = localEvents[localEvents.length - 1];
  latestValue.textContent = latest ? labelFor(latest) : 'Waiting for Navis';
  stepValue.textContent = latest
    ? (bodyFor(latest) || metaFor(latest) || 'Navis is working through the current browser state.')
    : 'No browser steps yet';
  const progress = latest && latest.stepNumber && latest.totalSteps
    ? Math.max(2, Math.min(100, Math.round((Number(latest.stepNumber) / Number(latest.totalSteps)) * 100)))
    : (latest ? 18 : 0);
  progressBar.style.width = progress + '%';
  freshnessValue.textContent = latest ? timeAgo(latest.timestamp) : 'No live updates yet';

  const visibleEvents = localEvents.filter(event => activeFilter === 'all' || eventKind(event) === activeFilter);
  eventCount.textContent = visibleEvents.length + ' shown';
  if (visibleEvents.length === 0) {
    feed.innerHTML = '<li class="empty-state">Navis thoughts and browser actions will stream here while a task runs.</li>';
    return;
  }
  feed.innerHTML = '';
  visibleEvents.slice(-100).reverse().forEach(event => {
    const li = document.createElement('li');
    const kind = eventKind(event);
    li.className = 'feed-item ' + kind;
    const dot = document.createElement('span');
    dot.className = 'event-dot ' + kind;
    const body = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'event-heading';
    const badge = document.createElement('span');
    badge.className = 'event-kind';
    badge.textContent = kindLabel(kind);
    const title = document.createElement('p');
    title.className = 'event-title';
    title.textContent = labelFor(event);
    heading.append(badge, title);
    const content = document.createElement('p');
    content.className = 'event-body';
    content.textContent = bodyFor(event) || 'Working through the current browser state.';
    const meta = document.createElement('p');
    meta.className = 'event-meta';
    meta.textContent = metaFor(event);
    body.append(heading, content, meta);
    li.append(dot, body);
    feed.appendChild(li);
  });
}

function setCaptureLoading(value) {
  captureLoading = Boolean(value);
  captureBtn.disabled = captureLoading;
  captureBtn.textContent = captureLoading ? 'Capturing current page...' : 'Capture current page DOM';
}

function connectPanel() {
  try {
    port = chrome.runtime.connect({ name: 'navis-panel' });
    port.onMessage.addListener(message => {
      if (message.type === 'state') renderState(message.state);
      if (message.type === 'navis-event') {
        localEvents = (message.state && message.state.events ? message.state.events : localEvents.concat(message.event)).slice(-100);
        renderState(message.state || {});
      }
      if (message.type === 'capture-result') {
        setCaptureLoading(false);
        localEvents = localEvents.concat({
          type: 'step',
          content: 'Captured active tab DOM.',
          metadata: {
            title: message.data && message.data.title,
            url: message.data && message.data.url,
            refs: message.data && message.data.refs ? message.data.refs.length : 0
          },
          timestamp: new Date().toISOString()
        }).slice(-100);
        if (message.data && message.data.title) activeTitleValue.textContent = message.data.title;
        if (message.data && message.data.url) activeUrlValue.textContent = message.data.url;
        renderFeed();
      }
      if (message.type === 'panel-error') {
        setCaptureLoading(false);
        localEvents = localEvents.concat({ type: 'abort', content: message.error, timestamp: new Date().toISOString() }).slice(-100);
        renderFeed();
      }
      if (message.type === 'feed-cleared') {
        localEvents = [];
        renderState(message.state || {});
      }
    });
    port.onDisconnect.addListener(() => {
      bridgeValue.textContent = 'Panel disconnected. Reopen to reconnect.';
    });
    port.postMessage({ type: 'refresh_state' });
  } catch {
    chrome.runtime.sendMessage({ type: 'get-state' }, renderState);
  }
}

captureBtn.addEventListener('click', () => {
  setCaptureLoading(true);
  if (port) {
    port.postMessage({ type: 'capture_active' });
  } else {
    chrome.runtime.sendMessage({ type: 'get-state' }, renderState);
    setCaptureLoading(false);
  }
  setTimeout(() => {
    if (captureLoading) setCaptureLoading(false);
  }, 8000);
});

clearBtn.addEventListener('click', () => {
  localEvents = [];
  renderFeed();
  if (port) {
    port.postMessage({ type: 'clear_feed' });
  } else {
    chrome.runtime.sendMessage({ type: 'clear-feed' }, response => {
      if (response && response.state) renderState(response.state);
    });
  }
});

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter || 'all';
    filterChips.forEach(item => item.classList.toggle('active', item === chip));
    renderFeed();
  });
});

setInterval(() => {
  if (localEvents.length) renderFeed();
}, 15000);

connectPanel();
`;

const companionPopupHtml = String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EverFern Navis</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main class="popup-shell">
    <div class="brand-row">
      <div class="brand-mark">N</div>
      <div>
        <h1>Navis Companion</h1>
        <p id="statusText">Checking bridge...</p>
      </div>
    </div>
    <div id="statusCapsule" class="status-capsule disconnected">
      <span></span>
      <strong>Disconnected</strong>
    </div>
    <button id="openPanel" type="button">Open Navis side panel</button>
    <div class="mini-stats">
      <span id="eventStat">0 live events</span>
      <span id="modeStat">extension-first</span>
    </div>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`;

const companionPopupCss = String.raw`
body {
  width: 292px;
  margin: 0;
  background: #f5f4f0;
  color: #201e1a;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.popup-shell {
  padding: 14px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: #201e1a;
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 14px;
  line-height: 1.2;
}

p {
  margin: 3px 0 0;
  color: #77716a;
  font-size: 11.5px;
}

.status-capsule {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin-bottom: 10px;
  padding: 0 10px;
  border: 1px solid #e2dacb;
  border-radius: 999px;
  background: #fffefb;
  color: #77716a;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.78), 0 1px 2px rgba(32,30,26,0.06);
}

.status-capsule span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #aaa39a;
}

.status-capsule strong {
  font-size: 11.5px;
  font-weight: 640;
}

.status-capsule.connected span {
  background: #22a566;
  box-shadow: 0 0 10px rgba(34, 165, 102, 0.36);
}

.status-capsule.connected strong {
  color: #16784a;
}

button {
  width: 100%;
  height: 36px;
  border: 1px solid #d5ccbc;
  border-radius: 11px;
  background: #201e1a;
  color: white;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}

.mini-stats {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #8d857a;
  font-size: 10.5px;
}
`;

const companionPopupJs = String.raw`
const statusText = document.getElementById('statusText');
const statusCapsule = document.getElementById('statusCapsule');
const eventStat = document.getElementById('eventStat');
const modeStat = document.getElementById('modeStat');
const openPanel = document.getElementById('openPanel');

function render(state) {
  const connected = Boolean(state && state.connected);
  statusText.textContent = connected ? 'Connected to EverFern' : 'Waiting for EverFern bridge';
  statusCapsule.className = 'status-capsule ' + (connected ? 'connected' : 'disconnected');
  statusCapsule.querySelector('strong').textContent = connected ? 'Live bridge connected' : 'Bridge waiting';
  const events = state && Array.isArray(state.events) ? state.events : [];
  eventStat.textContent = events.length + ' live event' + (events.length === 1 ? '' : 's');
  modeStat.textContent = state && state.activeMode || 'extension-first';
}

chrome.runtime.sendMessage({ type: 'get-state' }, render);

openPanel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-side-panel' }, response => {
    if (!response || response.success === false) {
      statusText.textContent = response && response.error ? response.error : 'Could not open side panel';
    }
  });
});
`;

export function ensureNavisCompanionExtension(baseDir = extensionBaseDir()): string {
  const extensionPath = path.join(baseDir, 'navis-companion');
  fs.mkdirSync(extensionPath, { recursive: true });

  const manifest = {
    manifest_version: 3,
    name: 'EverFern Navis Companion',
    description: 'Lets Navis work inside your normal browser profile through a local EverFern bridge.',
    version: '0.3.0',
    permissions: ['tabs', 'tabGroups', 'scripting', 'debugger', 'activeTab', 'alarms', 'storage', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'service-worker.js' },
    action: { default_title: 'EverFern Navis' },
    side_panel: { default_path: 'side-panel.html' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:4001 http://127.0.0.1:4001;",
    },
  };

  fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'service-worker.js'), companionServiceWorker.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'side-panel.html'), companionSidePanelHtml.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'side-panel.css'), companionSidePanelCss.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'side-panel.js'), companionSidePanelJs.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'popup.html'), companionPopupHtml.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'popup.css'), companionPopupCss.trimStart(), 'utf-8');
  fs.writeFileSync(path.join(extensionPath, 'popup.js'), companionPopupJs.trimStart(), 'utf-8');
  fs.writeFileSync(
    path.join(extensionPath, 'README.md'),
    [
      '# EverFern Navis Companion',
      '',
      'This unpacked extension connects the user browser profile to the local EverFern bridge at ws://127.0.0.1:4001.',
      'EverFern writes this folder automatically; do not edit it by hand.',
      '',
    ].join('\n'),
    'utf-8',
  );

  return extensionPath;
}

export async function prepareNavisMainProfileExtension(selectedBrowserId = 'chrome', startUrl?: string): Promise<NavisCompanionPrepareResult> {
  const extensionPath = ensureNavisCompanionExtension();
  const browserInfo = await resolveBrowser(selectedBrowserId);

  if (browserInfo && browserInfo.engine !== 'chromium') {
    return {
      success: false,
      connected: bridgeServer.hasConnectedExtensions(),
      extensionPath,
      browserName: browserInfo.name,
      message: `${browserInfo.name} is not Chromium-based. The Navis main-profile companion currently supports Chrome, Edge, Brave, Vivaldi, and other Chromium browsers.`,
    };
  }

  const executablePath = browserInfo?.path || findChromiumExecutable() || '';
  if (!executablePath || !fs.existsSync(executablePath)) {
    return {
      success: false,
      connected: bridgeServer.hasConnectedExtensions(),
      extensionPath,
      message: 'No Chromium browser executable was found for the Navis companion extension.',
    };
  }

  const userDataDir = getChromiumUserDataDir(browserInfo);
  const profileDirectory = userDataDir && fs.existsSync(userDataDir) ? getLastUsedProfile(userDataDir) : undefined;
  const browserWasRunning = await isProcessRunning(executablePath);

  const args = [
    userDataDir ? `--user-data-dir=${userDataDir}` : '',
    profileDirectory ? `--profile-directory=${profileDirectory}` : '',
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--new-window',
    safeUrl(startUrl),
  ].filter(Boolean);

  const command = [quoteForDisplay(executablePath), ...args.map(quoteForDisplay)].join(' ');

  try {
    const child = spawn(executablePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  } catch (error: any) {
    return {
      success: false,
      connected: bridgeServer.hasConnectedExtensions(),
      extensionPath,
      browserName: browserInfo?.name || 'Chromium',
      executablePath,
      userDataDir,
      profileDirectory,
      browserWasRunning,
      command,
      message: `Failed to launch the browser with the Navis companion extension: ${error?.message || String(error)}`,
    };
  }

  const connected = await bridgeServer.waitForExtensionConnection(12000);

  return {
    success: connected,
    connected,
    extensionPath,
    browserName: browserInfo?.name || 'Chromium',
    executablePath,
    userDataDir,
    profileDirectory,
    browserWasRunning,
    needsBrowserRestart: !connected && browserWasRunning,
    command,
    message: connected
      ? `Navis companion extension is connected in ${browserInfo?.name || 'Chromium'} using the main profile.`
      : browserWasRunning
        ? `${browserInfo?.name || 'Chromium'} was detected as running (possibly in the background). Chrome may have ignored --load-extension. Close all browser windows, run 'taskkill /f /im ${path.basename(executablePath)}' in your terminal/command prompt to terminate background processes, and click Prepare main profile extension again.`
        : `Launched ${browserInfo?.name || 'Chromium'} with the Navis companion extension, but it did not connect to EverFern within the timeout.`,
  };
}

export function getNavisCompanionStatus() {
  const extensionPath = ensureNavisCompanionExtension();
  const bridge = bridgeServer.getStatus();
  return {
    ...bridge,
    extensionPath,
    connected: bridge.connectedExtensions > 0,
  };
}

export function broadcastNavisCompanionProgress(event: Record<string, unknown>): void {
  bridgeServer.broadcastCommand('navis-progress', event);
}

export async function sendNavisCompanionCommand(command: string, data: any = {}, timeoutMs = 10000): Promise<any> {
  return await bridgeServer.sendRequest(command, data, timeoutMs);
}
