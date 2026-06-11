/**
 * Navis — BrowserSession
 *
 * Manages a single Playwright browser lifecycle for the Navis agent.
 */

import { chromium as pwChromium, firefox as pwFirefox, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OVERLAY_SCRIPT } from './overlay';
import { NavisLogger } from './logger';
import { findChromiumExecutable } from '../../../lib/playwright-setup';
import { getAvailableBrowsers, type BrowserInfo } from '../../../lib/browser-detector';

const chromium = pwChromium;

export interface SessionConfig {
  headless?: boolean;
  startUrl?: string;
  logger?: NavisLogger;
  useChromeProfile?: boolean;
  selectedBrowserId?: string;
  useIsolatedBrowser?: boolean;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

export interface NavisDebugBrowserLaunchResult {
  success: boolean;
  message: string;
  endpoint?: string;
  browserName?: string;
  profileDir?: string;
  command?: string;
  usedExistingEndpoint?: boolean;
  usingReusableProfile?: boolean;
}

async function resolveSelectedBrowserInfo(selectedBrowserId?: string): Promise<BrowserInfo | undefined> {
  if (!selectedBrowserId) return undefined;
  try {
    const browsers = await getAvailableBrowsers();
    let resolvedBrowserInfo = browsers.find(b => b.id === selectedBrowserId);

    if (!resolvedBrowserInfo && (selectedBrowserId === 'chrome' || selectedBrowserId.startsWith('chrome'))) {
      resolvedBrowserInfo = browsers.find(b => b.id.includes('google') || b.id.includes('chrome') || b.name.toLowerCase().includes('chrome'));
    }

    if (!resolvedBrowserInfo && (selectedBrowserId === 'firefox' || selectedBrowserId.startsWith('firefox'))) {
      resolvedBrowserInfo = browsers.find(b => b.engine === 'firefox' || b.name.toLowerCase().includes('firefox'));
    }

    if (!resolvedBrowserInfo) {
      const prefix = selectedBrowserId.split('-').slice(0, 2).join('-');
      resolvedBrowserInfo = browsers.find(b => b.id.startsWith(prefix));
    }

    return resolvedBrowserInfo;
  } catch (e) {
    console.warn(`[Navis] Failed to resolve browser '${selectedBrowserId}':`, e);
    return undefined;
  }
}

export async function openNavisDebugBrowser(_selectedBrowserId: string = 'chrome'): Promise<NavisDebugBrowserLaunchResult> {
  return {
    success: false,
    message: 'Navis profile automation now requires the companion extension. Install it for logged-in Chrome/Firefox control, or switch Navis to isolated browser mode.',
  };
}

function ensureNavisTabGroupExtension(): string {
  const baseExtensionDir = path.join(os.homedir(), '.everfern', 'extensions');
  const chromeDir = path.join(baseExtensionDir, 'chrome-tab-group');
  const firefoxDir = path.join(baseExtensionDir, 'firefox-tab-group');

  fs.mkdirSync(chromeDir, { recursive: true });
  fs.mkdirSync(firefoxDir, { recursive: true });

  // --- CHROME EXTENSION ---
  fs.writeFileSync(
    path.join(chromeDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'EverFern Navis Tab Group (Chrome)',
        version: '1.0.0',
        permissions: ['tabs', 'tabGroups', 'scripting', 'activeTab', 'alarms', 'storage'],
        host_permissions: ['<all_urls>'],
        background: { service_worker: 'service-worker.js' },
        action: { default_title: 'EverFern Navis Tab Control' },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const chromeServiceWorker = `
const BRIDGE_URL = 'ws://127.0.0.1:4001';
const NAVIS_GROUP_TITLE = 'Navis Agent';
let socket = null;
let reconnectTimer = null;
let navisGroupId = -1;
const navisTabs = new Set();
const navisEvents = [];
let restoredPanelState = false;
let bridgeState = {
  connected: false,
  status: 'disconnected',
  sessionActive: false,
  activeTask: '',
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
          connected: false
        },
        events: navisEvents.slice(-100),
        savedAt: Date.now()
      }
    });
  } catch {}
}

function restorePanelState(callback) {
  if (restoredPanelState) {
    if (callback) callback();
    return;
  }
  restoredPanelState = true;
  try {
    chrome.storage.local.get('navisPanelState', result => {
      const saved = result && result.navisPanelState;
      if (saved) {
        if (Array.isArray(saved.events)) {
          navisEvents.splice(0, navisEvents.length, ...saved.events);
        }
        if (saved.bridgeState) {
          bridgeState = {
            ...bridgeState,
            ...saved.bridgeState,
            connected: Boolean(socket && socket.readyState === WebSocket.OPEN)
          };
        }
      }
      if (callback) callback();
    });
  } catch {
    if (callback) callback();
  }
}

function getPanelState() {
  return {
    ...bridgeState,
    connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
    status: socket && socket.readyState === WebSocket.OPEN ? 'connected' : bridgeState.status,
    events: navisEvents.slice(-100),
    lastUpdated: Date.now()
  };
}

async function ensureNavisGroup(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.windowId < 0) return;

    // Only group tabs explicitly flagged by Navis to avoid grouping user's personal tabs
    if (!tab.url || !tab.url.includes('navis=true')) return;

    if (navisGroupId < 0) {
      const groups = await chrome.tabGroups.query({ title: NAVIS_GROUP_TITLE });
      if (groups.length > 0) {
        navisGroupId = groups[0].id;
      }
    }

    if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
      if (tab.groupId === navisGroupId) return;
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.title === NAVIS_GROUP_TITLE) {
          navisGroupId = group.id;
          return;
        }
      } catch {}
    }

    if (navisGroupId >= 0) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: navisGroupId });
        return;
      } catch {
        navisGroupId = -1;
      }
    }

    navisGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(navisGroupId, { title: NAVIS_GROUP_TITLE, color: 'blue' });
  } catch (error) {
    console.warn('[Navis Tab Group] Failed to group tab', error);
  }
}

function rememberNavisEvent(event) {
  const clean = {
    ...event,
    timestamp: event && event.timestamp ? event.timestamp : new Date().toISOString()
  };
  const task = clean.timelineBranch && clean.timelineBranch.taskDescription;
  const metadata = clean.metadata || {};
  const action = clean.action || {};
  const actionParams = action.params || {};
  if (task) bridgeState.activeTask = String(task);
  if (metadata.url || actionParams.url) bridgeState.activeUrl = String(metadata.url || actionParams.url);
  if (metadata.title) bridgeState.activeTitle = String(metadata.title);
  bridgeState.lastEventType = String(clean.type || 'step');
  bridgeState.lastEventAt = Date.now();
  navisEvents.push(clean);
  while (navisEvents.length > 100) navisEvents.shift();
  persistPanelState();
  syncOverlayToTabs('update');
}

function connect() {
  restorePanelState();
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(BRIDGE_URL);
    socket.onopen = () => {
      bridgeState.connected = true;
      bridgeState.status = 'connected';
    };
    socket.onmessage = async event => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (payload.type === 'state-update') {
        const sessionActive = Boolean(payload.data && payload.data.sessionActive);
        bridgeState.sessionActive = sessionActive;
        if (!sessionActive) {
          bridgeState.activeTask = '';
          navisEvents.length = 0;
        }
        syncOverlayToTabs('update');
        return;
      }
      if (payload.type === 'command' && payload.command === 'navis-progress') {
        rememberNavisEvent(payload.data || {});
        return;
      }
    };
    socket.onclose = () => {
      bridgeState.connected = false;
      bridgeState.status = 'disconnected';
      scheduleReconnect();
    };
    socket.onerror = () => {
      bridgeState.connected = false;
      bridgeState.status = 'disconnected';
      scheduleReconnect();
    };
  } catch {
    bridgeState.connected = false;
    bridgeState.status = 'disconnected';
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

function canInjectIntoTab(tab) {
  const url = String(tab && tab.url || '');
  return Boolean(tab && tab.id && /^(https?:|file:)/i.test(url));
}

async function syncOverlayToTabs(mode) {
  const state = getPanelState();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!canInjectIntoTab(tab)) continue;
    const isNavisGroup = navisGroupId >= 0 && tab.groupId === navisGroupId;
    if (tab.url && (tab.url.includes('navis=true') || navisTabs.has(tab.id) || isNavisGroup)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: renderEverFernNavisOverlay,
          args: [state, { mode: mode || 'update' }]
        });
      } catch (error) {}
    }
  }
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
    const text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
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
    '<div class="ef-status"><div class="ef-status-left"><span class="ef-kicker">Task</span><strong>\' + esc(state && state.activeTask || \'No active Navis task yet\') + \'</strong></div><span class="ef-pill \' + (state && state.connected ? \'\' : \'waiting\') + \'">\' + (state && state.connected ? \'Live\' : \'Waiting\') + \'</span></div>',
    '<div class="ef-mission"><div class="ef-orb"></div><div><span class="ef-kicker">Now</span><strong>\' + esc(eventTitle(latest)) + \'</strong><p>\' + esc(eventBody(latest)) + \'</p><div class="ef-progress"><span></span></div><div class="ef-fresh">\' + esc(timeLabel(latest && latest.timestamp)) + \'</div></div></div>',
    '<div class="ef-page"><span class="ef-kicker">Current page</span><strong>\' + esc(state && state.activeTitle || document.title || \'Current tab\') + \'</strong><p>\' + esc(state && state.activeUrl || location.href) + \'</p></div>',
    '<div class="ef-feed-title"><span>Agent activity</span><span>\' + events.length + \' events</span></div>',
    '<ol class="ef-feed">\' + feed + \'</ol>',
    '</section>',
    '</aside>'
  ].join('');

  const closeButton = root.querySelector('.ef-close');
  if (closeButton) closeButton.addEventListener('click', () => host.remove(), { once: true });
  return { success: true, visible: true };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isNavisGroup = navisGroupId >= 0 && tab && tab.groupId === navisGroupId;
  if ((tab && tab.url && tab.url.includes('navis=true')) || isNavisGroup) {
    navisTabs.add(tabId);
  }
  if (changeInfo.status === 'complete' || changeInfo.groupId !== undefined) {
    if (isNavisGroup || navisTabs.has(tabId)) {
      ensureNavisGroup(tabId);
      syncOverlayToTabs('show');
    }
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  navisTabs.delete(tabId);
});

chrome.action.onClicked.addListener(async tab => {
  try {
    if (canInjectIntoTab(tab)) {
      navisTabs.add(tab.id);
      restorePanelState(async () => {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: renderEverFernNavisOverlay,
          args: [getPanelState(), { mode: 'toggle' }]
        });
      });
    }
  } catch (error) {
    console.warn('[Navis Tab Control] Failed to toggle overlay', error);
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'navis-keepalive') connect();
});
chrome.alarms.create('navis-keepalive', { periodInMinutes: 0.5 });

connect();
  `;

  fs.writeFileSync(path.join(chromeDir, 'service-worker.js'), chromeServiceWorker, 'utf-8');

  // --- FIREFOX EXTENSION ---
  fs.writeFileSync(
    path.join(firefoxDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'EverFern Navis Tab Group (Firefox)',
        version: '1.0.0',
        permissions: ['tabs'],
        host_permissions: ['<all_urls>'],
        background: { scripts: ['background.js'] },
        browser_specific_settings: {
          gecko: {
            id: "navis-tab-group@everfern.com",
            strict_min_version: "138.0"
          }
        }
      },
      null,
      2,
    ),
    'utf-8',
  );

  const firefoxBackgroundScript = `
const NAVIS_GROUP_TITLE = 'Navis Agent';
let navisGroupId = -1;

async function ensureNavisGroup(tabId) {
  if (!tabId) return;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab || tab.windowId < 0) return;

    // Only group tabs explicitly flagged by Navis
    if (!tab.url || !tab.url.includes('navis=true')) return;

    if (typeof browser.tabs.group !== 'function') {
      console.warn('[Navis Tab Group] browser.tabs.group API not supported in this Firefox version.');
      return;
    }

    // Since Firefox integrates tab grouping into the tabs API, we can just group it.
    // If we already have a groupId, we can try to use it, or just group the tab without an ID
    // and let Firefox create the group, then we can capture the new groupId.

    const groupOptions = { tabIds: [tabId] };
    if (navisGroupId >= 0) {
      groupOptions.groupId = navisGroupId;
    }

    try {
      navisGroupId = await browser.tabs.group(groupOptions);
      // In Firefox, setting the title/color is often omitted or done differently,
      // but we try anyway if there is a way. For now, just grouping is enough.
    } catch (error) {
      // If our cached navisGroupId is invalid, try creating a new group
      navisGroupId = await browser.tabs.group({ tabIds: [tabId] });
    }
  } catch (error) {
    console.warn('[Navis Tab Group] Failed to group tab', error);
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  } else if (tab.url && tab.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  }
});
`.trimStart();

  fs.writeFileSync(path.join(firefoxDir, 'background.js'), firefoxBackgroundScript, 'utf-8');

  return chromeDir;
}

export class BrowserSession {
  private static sharedBrowser: any | null = null;
  private static sharedContext: any | null = null;
  private static sharedActivePage: any | null = null;
  private static sharedTempUserDataDir: string | null = null;
  private static sharedRecentDownloads: string[] = [];
  private static sharedAttachedToExternalBrowser = false;
  private static sharedAttachedProfileLabel = 'browser profile';
  private static sharedNavisPages = new Set<Page>();

  private logger: NavisLogger | null = null;

  // Getters/setters to map instance properties to static shared properties
  private get browser(): any | null { return BrowserSession.sharedBrowser; }
  private set browser(val: any | null) { BrowserSession.sharedBrowser = val; }

  private get context(): any | null { return BrowserSession.sharedContext; }
  private set context(val: any | null) { BrowserSession.sharedContext = val; }

  private get activePage(): any | null { return BrowserSession.sharedActivePage; }
  private set activePage(val: any | null) { BrowserSession.sharedActivePage = val; }

  private get tempUserDataDir(): string | null { return BrowserSession.sharedTempUserDataDir; }
  private set tempUserDataDir(val: string | null) { BrowserSession.sharedTempUserDataDir = val; }

  public get recentDownloads(): string[] { return BrowserSession.sharedRecentDownloads; }
  public set recentDownloads(val: string[]) { BrowserSession.sharedRecentDownloads = val; }

  private get attachedToExternalBrowser(): boolean { return BrowserSession.sharedAttachedToExternalBrowser; }
  private set attachedToExternalBrowser(val: boolean) { BrowserSession.sharedAttachedToExternalBrowser = val; }

  private get attachedProfileLabel(): string { return BrowserSession.sharedAttachedProfileLabel; }
  private set attachedProfileLabel(val: string) { BrowserSession.sharedAttachedProfileLabel = val; }

  private get navisPages(): Set<Page> { return BrowserSession.sharedNavisPages; }

  setActivePage(page: Page) {
    this.activePage = page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error('Browser not initialized. Call launch() first.');
    return this.context;
  }

  get page(): Page {
    if (!this.activePage) throw new Error('No active page. Call openTab() first.');
    return this.activePage;
  }

  get allPages(): Page[] {
    if (!this.context) throw new Error('Browser not initialized.');
    return this.context.pages();
  }

  async ensureOverlay(page: Page): Promise<void> {
    try {
      const hasOverlay = await page.evaluate(() => !!(window as any).__navis_controls).catch(() => false);
      if (!hasOverlay) {
        await page.evaluate(OVERLAY_SCRIPT).catch(() => {});
      }
    } catch (err) {
      console.warn('[Navis] Failed to ensure overlay:', err);
    }
  }

  async launch(config: SessionConfig = {}): Promise<void> {
    const {
      headless = false,
      startUrl,
      logger,
      useChromeProfile: requestedUseChromeProfile = false,
      selectedBrowserId = 'chrome',
      useIsolatedBrowser: requestedUseIsolatedBrowser = true,
    } = config;
    let useChromeProfile = requestedUseChromeProfile;
    let useIsolatedBrowser = requestedUseIsolatedBrowser;
    this.logger = logger || null;

    if (useChromeProfile || !useIsolatedBrowser) {
      console.warn('[Navis] Browser profile automation now requires the Navis extension. BrowserSession is falling back to isolated Playwright mode.');
      this.logger?.browserLaunch('Profile automation requires the Navis extension; using isolated Playwright mode');
      useChromeProfile = false;
      useIsolatedBrowser = true;
    }

    // Resolve browser info from the selectedBrowserId if not using isolated mode
    let resolvedBrowserInfo: BrowserInfo | undefined;
    if (!useIsolatedBrowser && selectedBrowserId) {
      resolvedBrowserInfo = await resolveSelectedBrowserInfo(selectedBrowserId);
      if (resolvedBrowserInfo) {
        console.log(`[Navis] Resolved selected browser: ${resolvedBrowserInfo.name} (${resolvedBrowserInfo.engine}) at ${resolvedBrowserInfo.path}`);
      } else {
        console.warn(`[Navis] Selected browser '${selectedBrowserId}' not found, falling back to isolated mode`);
      }
    }

    const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    if (this.browser) {
      this.logger?.browserLaunch('already launched, opening new tab');
      await this.openTab(startUrl || 'about:blank');
      return;
    }

    this.attachedToExternalBrowser = false;
    this.attachedProfileLabel = 'browser profile';
    this.navisPages.clear();

    // Always launch fresh browser
    try {
      const launchArgs = [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-translate',
        '--disable-features=ChromeWhatsNewUI',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--disable-component-update',
        '--safebrowsing-disable-auto-update',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-domain-reliability',
        '--disable-features=IsolateOrigins,site-per-process',
        '--lang=en-US',
        '--window-size=1280,1024',
      ];

      {
        const engine = resolvedBrowserInfo?.engine || 'chromium';
        const executablePath = resolvedBrowserInfo?.path || findChromiumExecutable() || undefined;

        console.log(`[Navis] 🌐 Isolated browser mode (engine: ${engine})`);
        if (executablePath) {
          console.log(`[Navis] Using executable: ${executablePath}`);
        }

        if (engine === 'firefox') {
          // Build the firefox extension dir and load it via a persistent profile
          ensureNavisTabGroupExtension(); // ensure extension files are written to disk
          const firefoxExtDir = path.join(os.homedir(), '.everfern', 'extensions', 'firefox-tab-group');
          const firefoxProfileDir = path.join(os.homedir(), '.everfern', 'navis-firefox-profile');
          fs.mkdirSync(firefoxProfileDir, { recursive: true });

          try {
            this.context = await pwFirefox.launchPersistentContext(firefoxProfileDir, {
              headless,
              executablePath,
              args: [
                '--no-remote',
                `--load-extension=${firefoxExtDir}`,
              ],
              firefoxUserPrefs: {
                'xpinstall.signatures.required': false,
                'extensions.autoDisableScopes': 0,
                'extensions.enableScopes': 15,
              },
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
            this.browser = this.context.browser();
            console.log(`[Navis] ✅ Firefox launched with Navis tab group extension`);
          } catch (firefoxExtErr: any) {
            console.warn(`[Navis] Firefox with extension failed (${firefoxExtErr.message}), falling back to basic Playwright Firefox`);
            this.browser = await pwFirefox.launch({
              headless,
              args: ['--no-remote'],
            });
            this.context = await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
          }
        } else {
          const extensionPath = ensureNavisTabGroupExtension();
          const profileLaunchArgs = [
            ...launchArgs,
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ];

          this.context = await chromium.launchPersistentContext('', {
            headless,
            executablePath,
            args: profileLaunchArgs,
            viewport: { width: 1280, height: 1024 },
            userAgent: realUA,
            locale: 'en-US',
            timezoneId: 'America/New_York',
            acceptDownloads: true,
          });
          this.browser = this.context.browser(); // Will be null, which is expected for persistent contexts
        }

        this.logger?.browserLaunch(`Isolated Playwright Chromium (headless=${headless})`);
      }

    if (this.attachedToExternalBrowser) {
      console.log(`[Navis] Attached to ${this.attachedProfileLabel}; overlay will be injected only into Navis-owned tabs`);
      this.context.on('page', async (newPage: Page) => {
        const opener = await newPage.opener().catch(() => null);
        if (opener && this.navisPages.has(opener)) {
          this.navisPages.add(newPage);
          newPage.on('framenavigated', async (frame: any) => {
            if (frame === newPage.mainFrame()) {
              await this.ensureOverlay(newPage).catch(() => {});
            }
          });
          await this.ensureOverlay(newPage).catch(() => {});
        }
      });
    } else {
      // Inject overlay into all future pages in Navis-owned contexts.
      await this.context.addInitScript(OVERLAY_SCRIPT);
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[Navis] Overlay script registered at context level');

      // Register 'page' listener on context to handle tabs opened dynamically (e.g. click with target="_blank")
      this.context.on('page', async (newPage: Page) => {
        this.navisPages.add(newPage);
        newPage.on('framenavigated', async (frame: any) => {
          if (frame === newPage.mainFrame()) {
            await this.ensureOverlay(newPage).catch(() => {});
          }
        });
        await this.ensureOverlay(newPage).catch(() => {});
      });

      // Ensure overlay and navigation listener are running on all already-open pages in this Navis-owned context
      const existingPages = this.context.pages();
      for (const page of existingPages) {
        this.navisPages.add(page);
        await this.ensureOverlay(page);
        page.on('framenavigated', async (frame: any) => {
          if (frame === page.mainFrame()) {
            await this.ensureOverlay(page).catch(() => {});
          }
        });
      }

      // Trigger tab grouping via extension service worker if available
      try {
        let sw = this.context.serviceWorkers()[0];
        if (!sw) {
          sw = await Promise.race([
            this.context.waitForEvent('serviceworker'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]).catch(() => null);
        }
        if (sw) {
          console.log('[Navis] Extension service worker detected, triggering initial tab grouping...');
          await sw.evaluate(() => {
            if (typeof (globalThis as any).groupAllTabs === 'function') {
              (globalThis as any).groupAllTabs();
            }
          }).catch((e: any) => console.warn('[Navis] Failed to trigger groupAllTabs inside SW:', e.message));
        }
      } catch (swErr) {
        console.warn('[Navis] Extension service worker detection/invocation failed:', swErr);
      }
    }

    } catch (err) {
      if (this.browser && !this.attachedToExternalBrowser) {
        await this.browser.close().catch(() => {});
      }
      this.context = null;
      this.browser = null;
      this.activePage = null;
      this.attachedToExternalBrowser = false;
      this.attachedProfileLabel = 'browser profile';
      this.navisPages.clear();
      throw err;
    }

    // Navigate to startUrl or open initial tab
    if (startUrl && startUrl !== 'about:blank') {
      await this.openTab(startUrl);
    } else if (!this.activePage) {
      await this.openTab('about:blank');
    }

    // Only log generic message if we haven't already logged a specific one.
    if (!this.logger) {
      console.log(`[Navis] Browser ready: headless=${useChromeProfile ? false : headless}, 1280x1024`);
    }
  }

  async openTab(url?: string): Promise<Page> {
    if (!this.context) throw new Error('Browser not initialized.');

    const targetPage = await this.context.newPage();
    this.navisPages.add(targetPage);

    // Flag this tab as a Navis tab so the persistent extension knows to group it
    await targetPage.goto('about:blank?navis=true').catch(() => {});

    if (url && url !== 'about:blank') {
      // Use a more robust goto that doesn't hang on domcontentloaded
      await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(async (err: any) => {
        console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
        return targetPage!.goto(url, { waitUntil: 'commit', timeout: 5000 }).catch(() => {});
      });
    }

    // Inject overlay script directly into the page after load to ensure it's present
    // This handles cases where addInitScript didn't work or the page loaded too fast
    await this.ensureOverlay(targetPage);

    // Set up navigation listener to re-inject overlay on every page navigation
    targetPage.on('framenavigated', async (frame: any) => {
      if (frame === targetPage.mainFrame()) {
        console.log('[Navis] Page navigated, re-injecting overlay...');
        try {
          await targetPage.evaluate((overlayScript: string) => {
            // Check if overlay is already initialized
            if (!(window as any).__navis_controls) {
              // Inject the overlay script directly
              const script = document.createElement('script');
              script.textContent = overlayScript;
              document.documentElement.appendChild(script);
            }
          }, OVERLAY_SCRIPT).catch(() => {});
        } catch (err) {
          console.warn('[Navis] Failed to re-inject overlay after navigation:', err);
        }
      }
    });

    // Track downloads
    targetPage.on('download', async (download: any) => {
      try {
        const fileName = download.suggestedFilename() || 'downloaded_file';
        const downloadsDir = path.join(os.homedir(), '.everfern', 'downloads');
        fs.mkdirSync(downloadsDir, { recursive: true });

        const savePath = path.join(downloadsDir, fileName);
        console.log(`[Navis] ⬇️ Download started: saving to ${savePath}`);

        await download.saveAs(savePath);
        this.recentDownloads.push(savePath);
        console.log(`[Navis] ✅ Download complete: ${savePath}`);
      } catch (err) {
        console.warn(`[Navis] ❌ Failed to save download:`, err);
      }
    });

    await targetPage.bringToFront();
    this.activePage = targetPage;
    return targetPage;
  }

  async closeTab(page: Page): Promise<void> {
    if (!this.context) return;

    await page.close().catch(() => {});

    const remaining = this.context.pages();
    if (remaining.length > 0) {
      this.activePage = remaining[remaining.length - 1];
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    if (!this.context) return [];

    const pages = this.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = '';
      try {
        title = await p.title();
      } catch {
        title = 'Loading...';
      }
      tabs.push({
        id: `tab-${i + 1}`,
        url: p.url(),
        title,
        isActive: p === this.activePage,
      });
    }

    return tabs;
  }

  async switchToTab(indexOrTitle: number | string): Promise<void> {
    const pages = this.allPages;

    if (typeof indexOrTitle === 'number') {
      if (indexOrTitle < 0 || indexOrTitle >= pages.length) {
        throw new Error(`Tab index ${indexOrTitle} out of range. Available tabs: 0-${pages.length - 1}`);
      }
      this.activePage = pages[indexOrTitle];
    } else {
      const page = pages.find(p => {
        try {
          return p.title().then(t => t.toLowerCase().includes(indexOrTitle.toLowerCase()));
        } catch {
          return false;
        }
      });
      if (!page) {
        throw new Error(`No tab found matching "${indexOrTitle}". Available: ${pages.map((p, i) => `#${i}: ${p.url()}`).join(', ')}`);
      }
      this.activePage = page;
    }

    await this.activePage.bringToFront();
    await this.ensureOverlay(this.activePage);
  }

  async close(force = true): Promise<void> {
    if (!force) {
      console.log('[Navis] Keeping browser session open for persistence.');
      return;
    }
    const closeStartTime = Date.now();
    console.log('[Navis] 🔴 CLOSURE INITIATED - Starting browser session cleanup');

    try {
      if (this.attachedToExternalBrowser) {
        console.log('[Navis] 🔴 Attached browser cleanup: closing Navis-owned tabs only');
        const pagesToClose = new Set<Page>(this.navisPages);
        if (this.activePage) pagesToClose.add(this.activePage);

        for (const page of pagesToClose) {
          try {
            if (!page.isClosed()) {
              await page.close().catch(() => {});
            }
          } catch (pageErr) {
            console.warn(`[Navis] ⚠️ Error closing Navis tab: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
          }
        }

        this.navisPages.clear();
        this.activePage = null;
        this.context = null;
        this.browser = null;
        this.attachedToExternalBrowser = false;
        this.attachedProfileLabel = 'browser profile';

        const totalCloseTime = Date.now() - closeStartTime;
        console.log(`[Navis] ✅ Detached from external browser without closing profile (${totalCloseTime}ms)`);
        return;
      }

      // Force close all pages first to prevent hanging
      if (this.context) {
        console.log('[Navis] 🔴 Force closing all pages...');
        const pages = this.context.pages();
        for (const page of pages) {
          try {
            await page.close().catch(() => {});
          } catch (pageErr) {
            console.warn(`[Navis] ⚠️ Error closing page: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
          }
        }
        console.log(`[Navis] ✅ All pages closed (${pages.length} pages)`);
      }

      // Close context with timeout
      if (this.context) {
        console.log('[Navis] 🔴 Closing browser context...');
        const contextCloseStart = Date.now();
        try {
          // Use Promise.race to enforce timeout on context close
          await Promise.race([
            this.context.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Context close timeout')), 5000)
            )
          ]);
          const contextCloseTime = Date.now() - contextCloseStart;
          console.log(`[Navis] ✅ Browser context closed successfully (${contextCloseTime}ms)`);
        } catch (contextErr) {
          const contextCloseTime = Date.now() - contextCloseStart;
          console.warn(`[Navis] ⚠️ Context close timeout or error (${contextCloseTime}ms): ${contextErr instanceof Error ? contextErr.message : String(contextErr)}`);
        }
        this.context = null;
      } else {
        console.log('[Navis] ℹ️ No context to close');
      }

      // Close browser with timeout
      if (this.browser) {
        console.log('[Navis] 🔴 Closing browser instance...');
        const browserCloseStart = Date.now();
        try {
          // Use Promise.race to enforce timeout on browser close
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser close timeout')), 5000)
            )
          ]);
          const browserCloseTime = Date.now() - browserCloseStart;
          console.log(`[Navis] ✅ Browser instance closed successfully (${browserCloseTime}ms)`);
        } catch (browserErr) {
          const browserCloseTime = Date.now() - browserCloseStart;
          console.warn(`[Navis] ⚠️ Browser close timeout or error (${browserCloseTime}ms): ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`);
        }
        this.browser = null;
      } else {
        console.log('[Navis] ℹ️ No browser instance to close');
      }

      // Clear active page reference
      this.activePage = null;

      // Clean up temporary user data directory if it was created
      if (this.tempUserDataDir && fs.existsSync(this.tempUserDataDir)) {
        console.log(`[Navis] 🔴 Cleaning up temporary Chrome profile: ${this.tempUserDataDir}`);
        try {
          fs.rmSync(this.tempUserDataDir, { recursive: true, force: true });
          console.log('[Navis] ✅ Temporary Chrome profile cleaned up');
        } catch (rmErr) {
          console.warn('[Navis] ⚠️ Failed to delete temporary Chrome profile folder:', rmErr);
        }
        this.tempUserDataDir = null;
      }

      const totalCloseTime = Date.now() - closeStartTime;
      console.log(`[Navis] ✅ CLOSURE COMPLETE - Total cleanup time: ${totalCloseTime}ms`);

    } catch (err) {
      const totalCloseTime = Date.now() - closeStartTime;
      console.error(`[Navis] ❌ CLOSURE FAILED - Unexpected error during cleanup (${totalCloseTime}ms):`, err);
      this.activePage = null;
    }
  }

  async setOverlayStatus(text: string): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((t: string) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.setStatus(t);
    }, text).catch(() => {});
  }

  async highlightElement(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((r: { x: number; y: number; width: number; height: number }) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.highlight(r);
    }, rect).catch(() => {});
  }

  async moveCursor(x: number, y: number, click = false): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate(({ x, y, click }: { x: number; y: number; click: boolean }) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.moveCursor(x, y, click);
    }, { x, y, click }).catch(() => {});
  }


  /**
   * Annotates interactive elements with visual labels (e1, e2, etc.) directly on the page.
   * This is used for vision-mode grounding so the AI can "see" the refs on the screenshot.
   */
  async annotateElements(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        // Remove existing first to avoid double-labeling
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());

        const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [data-scroll-ref]');
        elements.forEach((el: Element) => {
          const ref = el.getAttribute('data-ref') || el.getAttribute('data-scroll-ref');
          if (!ref) return;

          const rect = el.getBoundingClientRect();
          // Only label visible elements
          if (rect.width > 2 && rect.height > 2 && rect.top < window.innerHeight && rect.left < window.innerWidth) {
            const label = document.createElement('div');
            label.className = '__navis_ref_label';
            label.textContent = ref;
            const isScroll = ref.startsWith('s');
            Object.assign(label.style, {
              position: 'fixed',
              top: `${Math.max(0, rect.top)}px`,
              left: `${Math.max(0, rect.left)}px`,
              backgroundColor: isScroll ? '#007AFF' : '#ff3366',
              color: 'white',
              fontSize: '11px',
              fontWeight: 'bold',
              padding: '2px 4px',
              borderRadius: '4px',
              zIndex: '2147483640',
              pointerEvents: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
              lineHeight: '1',
              fontFamily: 'system-ui, sans-serif',
              border: '1px solid white',
              transform: 'translate(-50%, -50%)',
            });
            document.body.appendChild(label);
          }
        });
      });
    } catch (err) {
      console.warn('[Navis] Failed to annotate elements:', err);
    }
  }

  /**
   * Removes all visual ref labels from the page.
   */
  async removeAnnotations(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
      });
    } catch (err) {
      console.warn('[Navis] Failed to remove annotations:', err);
    }
  }
}
