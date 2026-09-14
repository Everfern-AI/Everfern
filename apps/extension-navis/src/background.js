const BRIDGE_URL = 'ws://127.0.0.1:4001';
const EXTENSION_ID = 'everfern-navis-extension';
const NAVIS_GROUP_TITLE = 'Navis Agent';

const api = globalThis.browser || globalThis.chrome;
const isFirefoxPromiseApi = Boolean(globalThis.browser);
let socket = null;
let reconnectTimer = null;
let navisGroupId = -1;
let lastActiveTabId = null;
let lastActiveWindowId = null;
// Track the tab the USER was on before Navis started, so we never steal their focus
let userTabId = null;
let userWindowId = null;
const navisTabs = new Map();
const lastRefsByTab = new Map();
const screenshotMutexByTab = new Map(); // Serializes concurrent screenshot requests per tab
const lastMouseByTab = new Map();
const panelPorts = new Set();
const events = [];
let state = {
  connected: false,
  status: 'disconnected',
  sessionActive: false,
  activeTask: '',
  activeMode: 'extension-first',
  activeUrl: '',
  activeTitle: '',
  lastEventType: '',
  lastEventAt: 0,
  events,
};

// Restore events from session storage on service worker restart
if (api.storage && api.storage.session) {
  api.storage.session.get('navisEvents', (result) => {
    if (result && Array.isArray(result.navisEvents)) {
      events.push(...result.navisEvents);
      while (events.length > 140) events.shift();
    }
  });
}

function call(namespace, method, ...args) {
  const target = api[namespace];
  if (!target || typeof target[method] !== 'function') {
    return Promise.reject(new Error(`Extension API unavailable: ${namespace}.${method}`));
  }
  if (isFirefoxPromiseApi) return target[method](...args);
  return new Promise((resolve, reject) => {
    try {
      target[method](...args, result => {
        const err = api.runtime && api.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function maybeCall(namespace, method, ...args) {
  return call(namespace, method, ...args).catch(() => undefined);
}

function nowIso() {
  return new Date().toISOString();
}

function trimText(value, max = 160) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return 'about:blank?navis=true';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  return `https://${value}`;
}

function formatTab(tab) {
  return {
    id: tab && tab.id,
    windowId: tab && tab.windowId,
    url: tab && tab.url,
    title: tab && tab.title,
    active: Boolean(tab && tab.active),
    favIconUrl: tab && tab.favIconUrl,
  };
}

function canInject(tab) {
  const url = String(tab && tab.url || '');
  return Boolean(tab && tab.id && /^(https?:|file:)/i.test(url));
}

// Call this once before Navis starts operating to snapshot what tab the user is on
async function snapshotUserTab() {
  try {
    const tabs = await call('tabs', 'query', { active: true, currentWindow: true });
    if (tabs && tabs[0] && !navisTabs.has(tabs[0].id)) {
      userTabId = tabs[0].id;
      userWindowId = tabs[0].windowId;
    }
  } catch {}
}

async function activeTab() {
  try {
    const tabs = await call('tabs', 'query', { active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      lastActiveTabId = tabs[0].id;
      lastActiveWindowId = tabs[0].windowId;
      return tabs[0];
    }
  } catch (e) {
    console.warn('[Navis] currentWindow query failed:', e);
  }

  if (lastActiveWindowId) {
    try {
      const tabs = await call('tabs', 'query', { active: true, windowId: lastActiveWindowId });
      if (tabs && tabs[0]) {
        lastActiveTabId = tabs[0].id;
        return tabs[0];
      }
    } catch (e) {
      console.warn('[Navis] windowId query failed:', e);
    }
  }

  if (lastActiveTabId) {
    try {
      const tab = await call('tabs', 'get', lastActiveTabId);
      if (tab) {
        lastActiveWindowId = tab.windowId;
        return tab;
      }
    } catch (e) {
      console.warn('[Navis] get last tab failed:', e);
    }
  }

  if (navisGroupId >= 0) {
    try {
      const tabs = await call('tabs', 'query', { groupId: navisGroupId });
      if (tabs && tabs.length > 0) {
        const activeInGroup = tabs.find(t => t.active);
        const selected = activeInGroup || tabs[0];
        lastActiveTabId = selected.id;
        lastActiveWindowId = selected.windowId;
        return selected;
      }
    } catch (e) {
      console.warn('[Navis] groupId query failed:', e);
    }
  }

  try {
    const groups = await call('tabGroups', 'query', { title: NAVIS_GROUP_TITLE });
    if (groups && groups.length > 0) {
      navisGroupId = groups[0].id;
      const tabs = await call('tabs', 'query', { groupId: navisGroupId });
      if (tabs && tabs.length > 0) {
        const activeInGroup = tabs.find(t => t.active);
        const selected = activeInGroup || tabs[0];
        lastActiveTabId = selected.id;
        lastActiveWindowId = selected.windowId;
        return selected;
      }
    }
  } catch (e) {
    console.warn('[Navis] tabGroups query failed:', e);
  }

  try {
    const tabs = await call('tabs', 'query', {});
    const match = tabs.find(t => navisTabs.has(t.id));
    if (match) {
      lastActiveTabId = match.id;
      lastActiveWindowId = match.windowId;
      return match;
    }
  } catch (e) {
    console.warn('[Navis] global tabs query failed:', e);
  }

  return null;
}

async function getTargetTab(tabId) {
  if (tabId) return call('tabs', 'get', Number(tabId));
  return activeTab();
}

async function ensureGroup(tabId) {
  if (!tabId || !api.tabGroups) return;
  try {
    if (navisGroupId < 0) {
      const groups = await call('tabGroups', 'query', { title: NAVIS_GROUP_TITLE });
      if (groups && groups.length) navisGroupId = groups[0].id;
    }
    if (navisGroupId >= 0) {
      await call('tabs', 'group', { tabIds: [tabId], groupId: navisGroupId });
      return;
    }
    navisGroupId = await call('tabs', 'group', { tabIds: [tabId] });
    await call('tabGroups', 'update', navisGroupId, { title: NAVIS_GROUP_TITLE, color: 'blue' });
  } catch {
    navisGroupId = -1;
  }
}

async function deleteTabGroup() {
  if (navisGroupId < 0) return;
  try {
    const group = await call('tabGroups', 'get', navisGroupId).catch(() => null);
    if (!group) {
      navisGroupId = -1;
      return;
    }
    const tabs = await call('tabs', 'query', { groupId: navisGroupId }).catch(() => []);
    const tabIds = tabs.map(t => t.id).filter(Boolean);
    if (tabIds.length > 0) {
      console.log(`[Navis Extension] Closing ${tabIds.length} tabs in group ${navisGroupId} to delete it`);
      await call('tabs', 'remove', tabIds).catch(() => {});
    }
  } catch (err) {
    console.error('[Navis Extension] Failed to delete tab group:', err);
  }
}

async function waitForTabLoad(tabId, timeoutMs = 8000) {
  try {
    const tab = await call('tabs', 'get', tabId).catch(() => null);
    if (tab && tab.status === 'complete') {
      return true;
    }
  } catch {}

  return new Promise((resolve) => {
    let completed = false;
    let timer;
    const listener = (id, changeInfo, updatedTab) => {
      if (id === tabId && (changeInfo.status === 'complete' || updatedTab.status === 'complete')) {
        completed = true;
        api.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(true);
      }
    };
    api.tabs.onUpdated.addListener(listener);
    
    // Fallback polling to catch the race condition
    const poll = setInterval(async () => {
      if (completed) { clearInterval(poll); return; }
      const tab = await call('tabs', 'get', tabId).catch(() => null);
      if (tab && tab.status === 'complete') {
        completed = true;
        api.tabs.onUpdated.removeListener(listener);
        clearInterval(poll);
        clearTimeout(timer);
        resolve(true);
      }
    }, 500);

    timer = setTimeout(() => {
      completed = true;
      api.tabs.onUpdated.removeListener(listener);
      clearInterval(poll);
      resolve(false);
    }, timeoutMs);
  });
}

function captureTabWithDebugger(tabId, quality = 70, clip = null) {
  // 🔑 Screenshot mutex: serialize concurrent requests for the same tab.
  // Without this, parallel calls from the AI loop and the live preview panel both try
  // to chrome.debugger.attach simultaneously, causing one to silently fail.
  const tid = Number(tabId);
  const prev = screenshotMutexByTab.get(tid) || Promise.resolve();
  const next = prev.then(() => _captureTabWithDebuggerImpl(tid, quality, clip));
  screenshotMutexByTab.set(tid, next.catch(() => {})); // don't chain failures
  return next;
}

function _captureTabWithDebuggerImpl(tabId, quality = 70, clip = null) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;
    let finished = false;

    const safetyTimeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.warn(`[Navis Extension] Debugger capture timed out for tab ${tabId}`);
      if (attachedByUs) {
        chrome.debugger.detach(target, () => {});
      }
      reject(new Error('Debugger capture timed out'));
    }, 4000);

    const safeResolve = (val) => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimeout);
      resolve(val);
    };

    const safeReject = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimeout);
      reject(err);
    };
    
    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          sendCommand();
          return;
        }
        safeReject(new Error(`Debugger attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      sendCommand();
    });

    function sendCommand() {
      const params = { format: "jpeg", quality: quality };
      if (clip && typeof clip.width === 'number' && typeof clip.height === 'number' && clip.width > 0 && clip.height > 0) {
        params.clip = {
          x: Math.max(0, Math.round(clip.x || 0)),
          y: Math.max(0, Math.round(clip.y || 0)),
          width: Math.max(10, Math.round(clip.width)),
          height: Math.max(10, Math.round(clip.height)),
          scale: 1
        };
      }

      chrome.debugger.sendCommand(target, "Page.captureScreenshot", params, (result) => {
        const cmdErr = chrome.runtime.lastError;
        
        if (attachedByUs) {
          chrome.debugger.detach(target, () => {
            const detachErr = chrome.runtime.lastError; // Ignore detach errors
          });
        }

        if (cmdErr) {
          safeReject(new Error(`Debugger capture failed: ${cmdErr.message}`));
          return;
        }

        if (result && result.data) {
          safeResolve("data:image/jpeg;base64," + result.data);
        } else {
          safeReject(new Error("Debugger capture returned empty data"));
        }
      });
    }
  });
}

// 🔑 CDP trusted keyboard: fires isTrusted=true keydown/keyup events.
// Synthetic DOM KeyboardEvents are blocked by YouTube player & sites using event.isTrusted guards.
function dispatchKeyWithDebugger(tabId, key) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;

    // CDP key name mapping
    const keyMap = {
      'Enter': { code: 'Enter', keyCode: 13 },
      'Tab': { code: 'Tab', keyCode: 9 },
      'Escape': { code: 'Escape', keyCode: 27 },
      'Backspace': { code: 'Backspace', keyCode: 8 },
      'Delete': { code: 'Delete', keyCode: 46 },
      'ArrowUp': { code: 'ArrowUp', keyCode: 38 },
      'ArrowDown': { code: 'ArrowDown', keyCode: 40 },
      'ArrowLeft': { code: 'ArrowLeft', keyCode: 37 },
      'ArrowRight': { code: 'ArrowRight', keyCode: 39 },
      ' ': { code: 'Space', keyCode: 32 },
      'Space': { code: 'Space', keyCode: 32 },
      'Home': { code: 'Home', keyCode: 36 },
      'End': { code: 'End', keyCode: 35 },
      'PageUp': { code: 'PageUp', keyCode: 33 },
      'PageDown': { code: 'PageDown', keyCode: 34 },
    };
    const mapped = keyMap[key] || { code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          sendKeys();
          return;
        }
        reject(new Error(`CDP key attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      sendKeys();
    });

    async function sendKeys() {
      try {
        const base = { type: 'keyDown', key, code: mapped.code, windowsVirtualKeyCode: mapped.keyCode, nativeVirtualKeyCode: mapped.keyCode };
        await new Promise((res, rej) => {
          chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', base, () => {
            const e = chrome.runtime.lastError; if (e) rej(e); else res();
          });
        });
        await new Promise((res, rej) => {
          chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, () => {
            const e = chrome.runtime.lastError; if (e) rej(e); else res();
          });
        });
        resolve();
      } catch (err) {
        reject(new Error(`CDP key dispatch failed: ${err.message || err}`));
      } finally {
        if (attachedByUs) chrome.debugger.detach(target, () => {});
      }
    }
  });
}

// 🔑 CDP trusted typing: uses Input.insertText which produces isTrusted=true input events.
// Required for Notion, Google Docs, Figma and any contentEditable app that checks event.isTrusted.
function dispatchTypeWithDebugger(tabId, text) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;

    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          sendText();
          return;
        }
        reject(new Error(`CDP type attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      sendText();
    });

    function sendText() {
      chrome.debugger.sendCommand(target, 'Input.insertText', { text }, () => {
        const cmdErr = chrome.runtime.lastError;
        if (attachedByUs) chrome.debugger.detach(target, () => {});
        if (cmdErr) reject(new Error(`CDP insertText failed: ${cmdErr.message}`));
        else resolve();
      });
    }
  });
}

function dispatchClickWithDebugger(tabId, x, y, button = 'left', clickCount = 1) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;
    
    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          sendCommands();
          return;
        }
        reject(new Error(`Debugger attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      sendCommands();
    });

    async function sendCommands() {
      try {
        const cdpButton = button === 'middle' || button === 'right' ? button : 'left';
        
        // 1. Mouse Moved
        await new Promise((res, rej) => {
          chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: x,
            y: y
          }, () => {
            const cmdErr = chrome.runtime.lastError;
            if (cmdErr) rej(cmdErr); else res();
          });
        });
        
        // 2. Mouse Pressed
        await new Promise((res, rej) => {
          chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: x,
            y: y,
            button: cdpButton,
            clickCount: clickCount
          }, () => {
            const cmdErr = chrome.runtime.lastError;
            if (cmdErr) rej(cmdErr); else res();
          });
        });
        
        // 3. Mouse Released
        await new Promise((res, rej) => {
          chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: x,
            y: y,
            button: cdpButton,
            clickCount: clickCount
          }, () => {
            const cmdErr = chrome.runtime.lastError;
            if (cmdErr) rej(cmdErr); else res();
          });
        });
        
        resolve();
      } catch (cmdErr) {
        reject(new Error(`CDP mouse events failed: ${cmdErr.message || cmdErr}`));
      } finally {
        if (attachedByUs) {
          chrome.debugger.detach(target, () => {
            const detachErr = chrome.runtime.lastError; // Ignore detach errors
          });
        }
      }
    }
  });
}

function dispatchHoverWithDebugger(tabId, x, y) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;
    
    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          sendCommand();
          return;
        }
        reject(new Error(`Debugger attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      sendCommand();
    });

    function sendCommand() {
      chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x,
        y: y
      }, (result) => {
        const cmdErr = chrome.runtime.lastError;
        if (attachedByUs) {
          chrome.debugger.detach(target, () => {
            const detachErr = chrome.runtime.lastError; // Ignore detach errors
          });
        }
        if (cmdErr) reject(cmdErr); else resolve();
      });
    }
  });
}

function setState(patch) {
  const oldSessionActive = state.sessionActive;
  state = {
    ...state,
    ...patch,
    connected: Boolean(socket && socket.readyState === 1),
    events,
    lastUpdated: Date.now(),
  };
  broadcastPanel({ type: 'state', state: panelState() });
  syncOverlay('update').catch(() => {});

    // Tabs remain open by default on session completion
}

function panelState() {
  return {
    ...state,
    connected: Boolean(socket && socket.readyState === 1),
    status: socket && socket.readyState === 1 ? (state.status === 'disconnected' ? 'connected' : state.status) : state.status,
    events: events.slice(-100),
  };
}

function rememberEvent(event) {
  const clean = {
    ...event,
    timestamp: event && event.timestamp ? event.timestamp : nowIso(),
  };
  const metadata = clean.metadata || {};
  const action = clean.action || {};
  const params = action.params || {};
  if (clean.timelineBranch && clean.timelineBranch.taskDescription) state.activeTask = String(clean.timelineBranch.taskDescription);
  if (metadata.mode) state.activeMode = String(metadata.mode);
  if (metadata.url || params.url) state.activeUrl = String(metadata.url || params.url);
  if (metadata.title) state.activeTitle = String(metadata.title);
  
  if (clean.timelineBranch) {
    state.sessionActive = clean.timelineBranch.branchStatus === 'running';
  } else {
    const status = clean.type || '';
    if (status === 'task_complete' || status === 'error' || status === 'complete') {
      state.sessionActive = false;
    } else {
      state.sessionActive = true;
    }
  }

  state.lastEventType = String(clean.type || 'step');
  state.lastEventAt = Date.now();
  events.push(clean);
  while (events.length > 140) events.shift();
  if (api.storage && api.storage.session) {
    api.storage.session.set({ navisEvents: events }).catch(() => {});
  }
  broadcastPanel({ type: 'navis-event', event: clean, state: panelState() });
  syncOverlay('show').catch(() => {});
}

function clearEvents() {
  events.splice(0, events.length);
  state.lastEventType = '';
  state.lastEventAt = 0;
  broadcastPanel({ type: 'feed-cleared', state: panelState() });
}

function broadcastPanel(message) {
  for (const port of Array.from(panelPorts)) {
    try {
      port.postMessage(message);
    } catch {
      panelPorts.delete(port);
    }
  }
}

function send(payload) {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function respond(requestId, success, data, error) {
  if (!requestId) return;
  send({
    type: 'response',
    requestId,
    success,
    data,
    error: error ? String(error.message || error) : undefined,
  });
}

function connect() {
  if (typeof globalThis.WebSocket === 'undefined') {
    console.warn('[Navis Extension] WebSocket is not supported in this browser environment.');
    return;
  }
  if (socket && (socket.readyState === 1 || socket.readyState === 0)) return;
  try {
    socket = new WebSocket(BRIDGE_URL);
    socket.onopen = () => {
      reconnectDelayMs = 1000; // Reset backoff on success
      setState({ connected: true, status: 'connected' });
      send({
        type: 'handshake',
        extensionId: EXTENSION_ID,
        extensionVersion: api.runtime.getManifest().version,
        browser: isFirefoxPromiseApi ? 'firefox' : 'chromium',
        mode: 'extension-first',
        timestamp: Date.now(),
      });
    };
    socket.onmessage = async event => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'state-update') {
        const sessions = payload.data && Array.isArray(payload.data.sessions) ? payload.data.sessions : [];
        const active = payload.data && (payload.data.playwrightSession || sessions[0]) || null;
        setState({
          status: payload.data && payload.data.status || 'connected',
          sessionActive: Boolean(payload.data && payload.data.sessionActive),
          activeUrl: active && active.url || state.activeUrl,
          activeTitle: active && active.title || state.activeTitle,
        });
        return;
      }
      if (payload.type !== 'command') return;
      if (payload.command === 'navis-progress') {
        rememberEvent(payload.data || {});
        return;
      }
      if (payload.command === 'activate-extension') {
        // Remember where the user was before Navis takes over tabs
        snapshotUserTab().catch(() => {});
        setState({
          status: 'active',
          sessionActive: true,
          activeUrl: payload.data && payload.data.url || state.activeUrl,
          activeTitle: payload.data && payload.data.title || state.activeTitle,
        });
        return;
      }
      try {
        const data = await handleCommand(payload.command, payload.data || {});
        respond(payload.requestId, true, data);
      } catch (error) {
        respond(payload.requestId, false, null, error);
      }
    };
    socket.onclose = () => {
      setState({ connected: false, sessionActive: false, status: 'reconnecting' });
      scheduleReconnect();
    };
    socket.onerror = () => {
      setState({ connected: false, sessionActive: false, status: 'reconnecting' });
      scheduleReconnect();
    };
  } catch {
    setState({ connected: false, sessionActive: false, status: 'reconnecting' });
    scheduleReconnect();
  }
}

let reconnectDelayMs = 1000;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000); // Exponential backoff up to 30s
    connect();
  }, reconnectDelayMs);
}

async function executeInTab(tabId, fn, args = []) {
  if (api.scripting && api.scripting.executeScript) {
    const result = await call('scripting', 'executeScript', {
      target: { tabId },
      func: fn,
      args,
    });
    return result && result[0] && result[0].result;
  }
  const code = `(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(',')})`;
  const result = await call('tabs', 'executeScript', tabId, { code });
  return result && result[0];
}

async function pageBridge(action, query, refs) {
  const textOf = (node, max = 160) => {
    if (!node) return '';
    return String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  };
  const attr = (node, name, max = 160) => {
    const value = node.getAttribute && node.getAttribute(name);
    return value ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '';
  };
  const cssEscape = value => {
    const css = window.CSS;
    return css && css.escape ? css.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  };
  const compactSelector = node => {
    const testId = attr(node, 'data-testid') || attr(node, 'data-test') || attr(node, 'data-cy');
    if (testId) return `[data-testid="${cssEscape(testId)}"]`;
    const id = attr(node, 'id');
    if (id && !/\s/.test(id)) return `#${cssEscape(id)}`;
    const name = attr(node, 'name');
    const tag = node.tagName.toLowerCase();
    if (name) return `${tag}[name="${cssEscape(name)}"]`;
    const parts = [];
    let cur = node;
    for (let depth = 0; cur && depth < 4 && cur !== document.body && cur !== document.documentElement; depth += 1) {
      let part = cur.tagName.toLowerCase();
      const role = attr(cur, 'role', 60);
      if (role) part += `[role="${cssEscape(role)}"]`;
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const renderMouse = point => {
    const hostId = 'everfern-navis-mouse';
    const x = Math.max(18, Math.min(window.innerWidth - 18, Number(point && point.x) || 90));
    const y = Math.max(18, Math.min(window.innerHeight - 18, Number(point && point.y) || 90));
    const label = String(point && point.label || 'Navis').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement('div');
      host.id = hostId;
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      host.style.width = '1px';
      host.style.height = '1px';
      document.documentElement.appendChild(host);
    }
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{all:initial}.m{position:absolute;left:0;top:0;transform:translate(-2px,-1px);filter:drop-shadow(0 10px 18px rgba(31,29,26,.24));animation:s 1.8s ease-in-out infinite}.p{position:relative;width:34px;height:34px}.p svg{position:absolute;left:0;top:0;width:26px;height:26px;overflow:visible}.r{position:absolute;left:-11px;top:-11px;width:34px;height:34px;border-radius:999px;border:2px solid rgba(59,130,246,.72);box-shadow:0 0 18px rgba(59,130,246,.38),inset 0 0 12px rgba(124,58,237,.18);animation:c 900ms ease-out infinite}.l{position:absolute;left:18px;top:24px;height:22px;padding:0 8px;border:1px solid rgba(214,204,188,.92);border-radius:999px;background:rgba(255,254,251,.92);color:#1f1d1a;font:700 10.5px/22px Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 8px 20px rgba(31,29,26,.12)}@keyframes c{0%{transform:scale(.52);opacity:.95}70%{transform:scale(1.18);opacity:.16}100%{transform:scale(1.34);opacity:0}}@keyframes s{0%,100%{transform:translate(-2px,-1px) rotate(-2deg)}50%{transform:translate(1px,1px) rotate(2deg)}}</style><div class="m"><div class="p"><span class="r"></span><svg viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".46" stop-color="#8ee7ff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><path d="M6 3 L25 18 L16.5 19.4 L21 29 L16.2 31 L11.8 21.4 L6 27 Z" fill="url(#g)" stroke="#1f1d1a" stroke-width="1.35" stroke-linejoin="round"/></svg><span class="l">${label}</span></div></div>`;
    clearTimeout(window.__everFernNavisMouseTimer);
    window.__everFernNavisMouseTimer = setTimeout(() => {
      const node = document.getElementById(hostId);
      if (node) node.remove();
    }, Number(point && point.durationMs) || 4200);
  };
  const capture = () => {
    // 🔑 Shadow DOM traversal — BrowserOS uses AX tree which crosses shadow roots.
    // querySelectorAll() does NOT cross shadow boundaries. This recursive helper does.
    const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="listbox"],[role="option"],[role="menuitem"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[contenteditable="true"],summary,[tabindex]';

        // 🔑 Helper to categorically ignore third-party extension overlays & injected widgets
    const isExtensionElement = (el) => {
      if (!el || el === document.body || el === document.documentElement) return false;
      try {
        const tag = (el.tagName || '').toLowerCase();
        if (
          tag.includes('grammarly') ||
          tag.includes('extension') ||
          tag.includes('lastpass') ||
          tag.includes('1password') ||
          tag.includes('bitwarden') ||
          tag.includes('honey') ||
          tag.includes('loom-') ||
          tag.startsWith('crx-') ||
          tag.startsWith('ext-') ||
          tag.startsWith('everfern-')
        ) return true;

        const id = (el.id || '').toLowerCase();
        const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
        if (
          id.includes('everfern-navis') ||
          id.includes('grammarly') ||
          id.includes('lastpass') ||
          id.includes('1password') ||
          id.includes('bitwarden') ||
          id.includes('honey') ||
          id.includes('loom-companion') ||
          id.includes('ext-overlay') ||
          className.includes('everfern-navis') ||
          className.includes('grammarly') ||
          className.includes('lastpass') ||
          className.includes('1password') ||
          className.includes('bitwarden')
        ) return true;

        for (const attrName of ['data-extension-id', 'data-grammarly-part', 'data-1p-ignore', 'data-bitwarden-watching', 'data-lastpass-icon-root']) {
          if (el.hasAttribute && el.hasAttribute(attrName)) return true;
        }

        if (el.closest) {
          const extensionAncestor = el.closest(
            '[id*="everfern-navis" i], [id*="grammarly" i], [id*="lastpass" i], [id*="1password" i], [id*="bitwarden" i], [id*="honey" i], [class*="everfern-navis" i], [class*="grammarly" i], [class*="lastpass" i], [data-extension-id], grammarly-extension, grammarly-popups, #everfern-navis-mouse, #everfern-navis-page-overlay, #everfern-navis-active-border, #everfern-navis-bboxes, #everfern-navis-form-highlight'
          );
          if (extensionAncestor) return true;
        }

        const rootNode = el.getRootNode ? el.getRootNode() : null;
        if (rootNode && rootNode instanceof ShadowRoot && rootNode.host) {
          if (isExtensionElement(rootNode.host)) return true;
        }
      } catch (e) {}
      return false;
    };

    function queryShadowAll(root, selector, results = []) {
      try {
        if (root instanceof ShadowRoot && root.host && isExtensionElement(root.host)) {
          return results;
        }
        for (const el of root.querySelectorAll(selector)) {
          if (!isExtensionElement(el)) {
            results.push(el);
          }
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot && !isExtensionElement(el)) {
            queryShadowAll(el.shadowRoot, selector, results);
          }
        }
      } catch (e) {}
      return results;
    }

    const nodes = queryShadowAll(document, INTERACTIVE_SELECTOR)
      .filter(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
        
        // Skip elements inside aria-hidden subtrees
        try { if (node.closest('[aria-hidden="true"]')) return false; } catch (e) {}

        // Parent/Ancestor Opacity Check
        let parentEl = node.parentElement;
        let effectiveOpacity = parseFloat(style.opacity);
        if (isNaN(effectiveOpacity)) effectiveOpacity = 1.0;
        while (parentEl && effectiveOpacity >= 0.01) {
          const parentStyle = getComputedStyle(parentEl);
          const parentOp = parseFloat(parentStyle.opacity);
          if (!isNaN(parentOp)) {
            effectiveOpacity *= parentOp;
          }
          parentEl = parentEl.parentElement;
        }
        if (effectiveOpacity < 0.01) return false;

        // Determine if it's visually covered by something else
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        
        // Keep elements that are off-screen (so the agent can scroll to them)
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
        
        if (isExtensionElement(node)) return false;

        let topNode = document.elementFromPoint(x, y);
        if (topNode && isExtensionElement(topNode)) {
          const allAtPoint = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
          const nonExt = allAtPoint.find(el => !isExtensionElement(el));
          if (nonExt) topNode = nonExt;
        }
        if (!topNode) return true;
        if (topNode === node || node.contains(topNode) || topNode.contains(node)) return true;
        
        // Check if they share the same closest interactive ancestor (like <a> or <button>)
        try {
          const nodeContainer = node.closest('a, button, [role="button"], [role="link"]');
          if (nodeContainer) {
            const topContainer = topNode.closest('a, button, [role="button"], [role="link"]');
            if (nodeContainer === topContainer) return true;
          }
        } catch (e) {}

        // Check if they share a common parent/grandparent within 3 levels (part of the same component)
        let commonAncestor = false;
        let p = node.parentElement;
        for (let i = 0; p && i < 3; i++) {
          if (p.contains(topNode)) {
            commonAncestor = true;
            break;
          }
          p = p.parentElement;
        }
        if (commonAncestor) return true;

        if (topNode.tagName === 'LABEL' && topNode.getAttribute('for') === node.id) return true;

        // Skip sibling decorative overlays (icons, divs, spans inside same component parent)
        if (['SVG', 'SPAN', 'PATH', 'I', 'IMG', 'DIV', 'YT-FORMATTED-STRING'].includes(topNode.tagName)) {
          if (node.parentElement && node.parentElement.contains(topNode)) {
            return true;
          }
        }

        return false;
      })
      .slice(0, 160); // Slightly higher cap to accommodate shadow DOM elements

    // 🔑 Stable ref identity: reuse the same eN for an element if it was seen in a previous capture.
    // We store refId on the element itself via a custom property (survives re-renders if element stays in DOM).
    if (!window.__navisRefCounter) window.__navisRefCounter = 1;
    if (!window.__navisRefMap) window.__navisRefMap = new WeakMap();

    const capturedRefs = nodes.map(node => {
      // Reuse existing ref if element is the same object (stable across captures)
      let ref = window.__navisRefMap.get(node);
      if (!ref) {
        ref = `e${window.__navisRefCounter++}`;
        window.__navisRefMap.set(node, ref);
      }
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
        disabled: Boolean(node.disabled || attr(node, 'aria-disabled') === 'true'),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    });

    // 🔑 Smart Form & Widget Detection (BrowserOS Form Isolation)
    // Discovers explicit forms, search bars, and interactive widget containers (e.g. flight booking cards)
    const detectedForms = [];
    const formCandidates = Array.from(document.querySelectorAll('form, [role="form"], [role="search"], [role="dialog"], fieldset, [data-form], [aria-label*="search" i], [aria-label*="flight" i], [aria-label*="book" i]'));
    
    // Also discover interactive clusters with >= 2 inputs
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"], [role="searchbox"]'));
    const containerCandidates = new Set(formCandidates);
    for (const inp of allInputs) {
      let parent = inp.parentElement;
      for (let i = 0; parent && i < 4; i++) {
        if (['DIV', 'SECTION', 'MAIN', 'ARTICLE', 'NAV', 'FORM'].includes(parent.tagName)) {
          const innerInpCount = parent.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]').length;
          if (innerInpCount >= 2 && innerInpCount <= 30) {
            containerCandidates.add(parent);
          }
        }
        parent = parent.parentElement;
      }
    }

    let formIdx = 1;
    for (const container of Array.from(containerCandidates)) {
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      if (rect.width < 100 || rect.height < 40 || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      
      const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"], [role="textbox"]'));
      if (inputs.length === 0) continue;

      const heading = container.querySelector('h1,h2,h3,h4,legend,caption,[role="heading"]');
      const formName = (
        container.getAttribute('aria-label') ||
        container.getAttribute('name') ||
        (heading ? heading.textContent.trim() : '') ||
        container.id ||
        `Form ${formIdx}`
      ).slice(0, 60);

      const formId = container.id || `form_${formIdx++}`;
      container.setAttribute('data-navis-form-id', formId);

      const containedRefs = capturedRefs
        .filter(r => {
          const node = document.querySelector(`[data-navis-ref="${r.ref}"]`);
          return node && container.contains(node);
        })
        .map(r => r.ref);

      detectedForms.push({
        id: formId,
        name: formName,
        tag: container.tagName.toLowerCase(),
        inputCount: inputs.length,
        rect: {
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          width: Math.min(innerWidth, Math.round(rect.width)),
          height: Math.min(innerHeight, Math.round(rect.height))
        },
        refs: containedRefs,
        isFocused: container.contains(document.activeElement)
      });
    }

    // Sort: focused form first, then by input count
    detectedForms.sort((a, b) => (b.isFocused ? 1 : 0) - (a.isFocused ? 1 : 0) || b.inputCount - a.inputCount);

        // 🔑 Media & Audio Playback Telemetry (Spotify, YouTube, Media SPAs)
    let mediaState = null;
    try {
      let activeMedia = null;
      let title = '';
      let artist = '';
      let album = '';
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        title = navigator.mediaSession.metadata.title || '';
        artist = navigator.mediaSession.metadata.artist || '';
        album = navigator.mediaSession.metadata.album || '';
      }
      const mediaNodes = queryShadowAll(document, 'video, audio');
      for (const node of mediaNodes) {
        if (!node.paused && !node.ended && node.currentTime > 0) {
          activeMedia = node;
          break;
        }
        if (!activeMedia && (node.currentTime > 0 || node.src || node.currentSrc)) {
          activeMedia = node;
        }
      }
      if (activeMedia) {
        mediaState = {
          hasMedia: true,
          isPlaying: !activeMedia.paused && !activeMedia.ended,
          title: title || activeMedia.title || activeMedia.getAttribute('aria-label') || document.title,
          artist: artist || undefined,
          album: album || undefined,
          currentTime: Math.round(activeMedia.currentTime),
          duration: Math.round(activeMedia.duration || 0),
          muted: activeMedia.muted,
          volume: Math.round((activeMedia.volume || 1) * 100),
        };
      } else if (title || artist) {
        mediaState = {
          hasMedia: true,
          isPlaying: navigator.mediaSession ? navigator.mediaSession.playbackState === 'playing' : false,
          title,
          artist: artist || undefined,
          album: album || undefined,
        };
      }
    } catch {}

    // 🔑 Scroll & Infinite Pagination Telemetry
    const scrollInfo = {
      scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
      maxScrollY: Math.round(Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - (window.innerHeight || document.documentElement.clientHeight || 0))),
      canScrollDown: (window.scrollY || document.documentElement.scrollTop || 0) < Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - (window.innerHeight || document.documentElement.clientHeight || 0)) - 20,
      percentScrolled: Math.round(((window.scrollY || document.documentElement.scrollTop || 0) / Math.max(1, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - (window.innerHeight || document.documentElement.clientHeight || 0))) * 100),
      isBottom: (window.scrollY || document.documentElement.scrollTop || 0) >= Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - (window.innerHeight || document.documentElement.clientHeight || 0)) - 20,
    };

    return {
      url: location.href,
      title: document.title,
      text: textOf(document.body, 5000),
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      refs: capturedRefs,
      forms: detectedForms,
      activeForm: detectedForms[0] || null,
      mediaState,
      scrollInfo,
    };
  };
  const resolveNode = meta => {
    if (!meta) return null;
    if (meta.ref) {
      const byRef = document.querySelector(`[data-navis-ref="${String(meta.ref).replace(/"/g, '\\"')}"]`);
      if (byRef) return byRef;
    }
    if (meta.selector) {
      try {
        const bySelector = document.querySelector(meta.selector);
        if (bySelector) return bySelector;
      } catch {}
    }
    // Fallback to finding by text/name/placeholder on the live DOM
    const wanted = norm(meta.name || meta.label || meta.placeholder || meta.text);
    if (wanted) {
      const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex]'));
      for (const node of candidates) {
        const text = norm(attr(node, 'aria-label') || attr(node, 'title') || attr(node, 'placeholder') || node.value || node.textContent);
        if (text && (text === wanted || text.includes(wanted))) return node;
      }
    }
    return null;
  };
  const targetScore = (meta, wantedQuery) => {
    if (!meta || meta.disabled) return -1000;
    const wanted = norm(wantedQuery.text || wantedQuery.target || wantedQuery.name || wantedQuery.ref || '');
    const role = norm(wantedQuery.role || '');
    const href = norm(wantedQuery.href || wantedQuery.url || '');
    const haystacks = [meta.ref, meta.name, meta.label, meta.placeholder, meta.role, meta.tag, meta.href, meta.type].map(norm);
    let score = 0;
    if (wantedQuery.ref && String(meta.ref) === String(wantedQuery.ref)) score += 1000;
    if (wanted) {
      for (const hay of haystacks) {
        if (!hay) continue;
        if (hay === wanted) score += 300;
        else if (hay.includes(wanted)) score += 120;
        else if (wanted.includes(hay) && hay.length > 2) score += 50;
      }
    }
    if (role && norm(meta.role || meta.tag).includes(role)) score += 90;
    if (href && norm(meta.href).includes(href)) score += 90;
    if (/button|link|a/.test(norm(`${meta.role} ${meta.tag}`))) score += 25;
    if (/input|textarea|select|textbox|combobox|search/.test(norm(`${meta.role} ${meta.tag} ${meta.type}`))) score += wantedQuery.preferInput ? 140 : 10;
    const rect = meta.rect || {};
    if (rect.width > 0 && rect.height > 0) score += 20;
    if (rect.width > 600 || rect.height > 220) score -= 40;
    return score;
  };
  const findBest = wantedQuery => {
    let best = null;
    let bestScore = -Infinity;
    for (const meta of Array.isArray(refs) ? refs : []) {
      const score = targetScore(meta, wantedQuery || {});
      if (score > bestScore) {
        best = meta;
        bestScore = score;
      }
    }
    if (best && bestScore > 0) return best;
    const wanted = norm(wantedQuery && (wantedQuery.text || wantedQuery.target || wantedQuery.name));
    if (!wanted) return null;
    const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex]'));
    for (const node of candidates) {
      const text = norm(attr(node, 'aria-label') || attr(node, 'title') || attr(node, 'placeholder') || node.value || node.textContent);
      if (text && (text === wanted || text.includes(wanted))) return { name: text, node, tag: node.tagName.toLowerCase() };
    }
    return null;
  };
  const triggerLinkFallback = node => {
    try {
      const anchor = node.closest('a');
      if (anchor) {
        const rawHref = anchor.getAttribute('href');
        if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
          const targetUrl = anchor.href;
          setTimeout(() => {
            try {
              if (window.location.href !== targetUrl) {
                window.location.href = targetUrl;
              }
            } catch (err) {}
          }, 150);
        }
      }
    } catch (e) {}
  };
  const clickNode = node => {
    const rect = node.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    
    // Dispatch synthetic events directly on the exact node.
    // We already filtered out truly covered nodes during capture.
    // Some React/Angular dropdowns use the exact node but place an invisible wrapper over it.
    // By dispatching directly on the node, we bypass the wrapper issue.
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, which: 1 };
    renderMouse({ x, y, label: 'Click', durationMs: 6500 });
    
    node.dispatchEvent(new PointerEvent('pointerdown', init));
    node.dispatchEvent(new MouseEvent('mousedown', init));
    node.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
    
    // Also trigger native .click() for standard elements like <a href> and <input>
    // Since synthetic events don't trigger native behaviors reliably (e.g., navigating links)
    try {
      if (typeof node.click === 'function') {
        node.click();
      }
      
      // Critical fix: If the target node is nested within an interactive container (a, button, input),
      // we must trigger .click() on the container since synthetic events on child elements
      // do not bubble native browser actions (like page navigation).
      const container = node.closest('a, button, input, [role="button"], [role="link"]');
      if (container && container !== node && typeof container.click === 'function') {
        container.click();
      }
      
      // Trigger the anchor-href fallback to make navigation completely robust
      triggerLinkFallback(node);
    } catch (e) {}

    return { x: Math.round(x), y: Math.round(y), method: 'dom-click' };
  };
  const isEditable = node => {
    if (!node) return false;
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable || attr(node, 'role') === 'textbox' || attr(node, 'contenteditable') === 'true';
  };
  if (action === 'capture') return capture();
  if (action === 'dismiss_popups') {
    const selectors = [
      '#onetrust-accept-btn-handler',
      '#accept-cookie-banner',
      '#cookie-accept',
      '.cookie-consent-accept',
      '[data-testid*="cookie-policy-manage-dialog-accept-button"]',
      '[data-testid*="cookie-accept" i]',
      '[aria-label*="accept all" i]',
      '[aria-label*="accept cookies" i]',
      'button[id*="accept" i]',
      'button[class*="cookie" i][class*="accept" i]',
      'button[class*="consent" i][class*="accept" i]',
    ];
    for (const selector of selectors) {
      try {
        const btn = document.querySelector(selector);
        if (btn && typeof btn.click === 'function') {
          btn.click();
          return { success: true, message: `Dismissed popup: ${selector}`, stateChanged: true };
        }
      } catch {}
    }
    return { success: false, message: 'No consent popup detected', stateChanged: false };
  }

  
  if (action === 'draw_boxes') {
    let container = document.getElementById('everfern-navis-bboxes');
    if (container) container.remove();
    container = document.createElement('div');
    container.id = 'everfern-navis-bboxes';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '2147483647';
    document.documentElement.appendChild(container);

    const snapshot = capture();
    for (const meta of snapshot.refs) {
      if (!meta.rect || meta.rect.width === 0 || meta.rect.height === 0) continue;
      // Draw box
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = `${meta.rect.x}px`;
      box.style.top = `${meta.rect.y}px`;
      box.style.width = `${meta.rect.width}px`;
      box.style.height = `${meta.rect.height}px`;
      box.style.border = '2px solid rgba(255, 0, 0, 0.7)';
      box.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
      box.style.boxSizing = 'border-box';
      
      // Draw label
      const label = document.createElement('div');
      label.textContent = `[${meta.ref}]`;
      label.style.position = 'absolute';
      label.style.top = '-16px';
      label.style.left = '0';
      label.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
      label.style.color = 'white';
      label.style.fontSize = '12px';
      label.style.fontWeight = 'bold';
      label.style.padding = '0 4px';
      label.style.borderRadius = '3px';
      label.style.whiteSpace = 'nowrap';
      
      box.appendChild(label);
      container.appendChild(box);
    }
    return { success: true };
  }
  
  if (action === 'clear_boxes') {
    const container = document.getElementById('everfern-navis-bboxes');
    if (container) container.remove();
    return { success: true };
  }

  if (action === 'draw_form_highlight') {
    let container = document.getElementById('everfern-navis-form-highlight');
    if (container) container.remove();
    const formId = query?.formId;
    let formEl = formId ? document.querySelector(`[data-navis-form-id="${formId}"], #${formId}`) : null;
    if (!formEl) formEl = document.querySelector('form, [role="form"], [role="search"]');
    if (formEl) {
      container = document.createElement('div');
      container.id = 'everfern-navis-form-highlight';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '2147483646';
      document.documentElement.appendChild(container);

      const r = formEl.getBoundingClientRect();
      const highlight = document.createElement('div');
      highlight.style.position = 'absolute';
      highlight.style.left = `${Math.max(0, r.x - 4)}px`;
      highlight.style.top = `${Math.max(0, r.y - 4)}px`;
      highlight.style.width = `${r.width + 8}px`;
      highlight.style.height = `${r.height + 8}px`;
      highlight.style.border = '3px solid #f59e0b'; // High-contrast amber border
      highlight.style.borderRadius = '8px';
      highlight.style.boxShadow = '0 0 0 2px rgba(245, 158, 11, 0.25), 0 8px 24px rgba(0,0,0,0.12)';
      highlight.style.boxSizing = 'border-box';
      
      const label = document.createElement('div');
      label.textContent = `🎯 FOCUS: ${query?.formName || formEl.getAttribute('aria-label') || 'Target Form'}`;
      label.style.position = 'absolute';
      label.style.top = '-22px';
      label.style.left = '0';
      label.style.backgroundColor = '#f59e0b';
      label.style.color = '#000000';
      label.style.fontSize = '11px';
      label.style.fontWeight = 'bold';
      label.style.padding = '2px 6px';
      label.style.borderRadius = '4px';
      label.style.whiteSpace = 'nowrap';
      highlight.appendChild(label);

      container.appendChild(highlight);
      return {
        success: true,
        rect: {
          x: Math.max(0, Math.round(r.x - 8)),
          y: Math.max(0, Math.round(r.y - 8)),
          width: Math.round(r.width + 16),
          height: Math.round(r.height + 16)
        }
      };
    }
    return { success: false };
  }

  if (action === 'clear_form_highlight') {
    const container = document.getElementById('everfern-navis-form-highlight');
    if (container) container.remove();
    return { success: true };
  }

  if (action === 'get_center') {
    let meta = null;
    if (query && query.x != null && query.y != null) {
      const rx = Math.floor((Math.abs(Number(query.x)) / 1000.0) * innerWidth);
      const ry = Math.floor((Math.abs(Number(query.y)) / 1000.0) * innerHeight);
      meta = { name: 'coordinates', node: document.elementFromPoint(rx, ry), x: rx, y: ry };
    } else {
      meta = findBest(query || {});
    }
    const node = meta && (meta.node || resolveNode(meta));
    if (!node) return null; // signal "not found" — caller falls back to DOM click
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    // 🔑 BrowserOS approach: re-read rect AFTER scroll so coords are post-scroll viewport position
    // scrollIntoView is synchronous for behavior:'instant' so rect is immediately accurate
    const rect = node.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    renderMouse({ x, y, label: 'Click', durationMs: 6500 });
    if (node.focus) node.focus({ preventScroll: true });
    return { x: Math.round(x), y: Math.round(y), name: meta.name || meta.ref || 'element', ref: meta.ref };
  }

  if (action === 'click') {
    let meta = null;
    if (query && query.x != null && query.y != null) {
      const rx = Math.floor((Math.abs(Number(query.x)) / 1000.0) * innerWidth);
      const ry = Math.floor((Math.abs(Number(query.y)) / 1000.0) * innerHeight);
      meta = { name: 'coordinates', node: document.elementFromPoint(rx, ry) };
    } else {
      meta = findBest(query || {});
    }
    const node = meta && (meta.node || resolveNode(meta));
    if (!node) throw new Error('No clickable target found');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    if (node.focus) node.focus({ preventScroll: true });
    const click = clickNode(node);
    return { success: true, message: `Clicked ${meta.name || meta.ref || 'element'}`, stateChanged: true, target: meta.name || meta.ref || '', ref: meta.ref, ...click };
  }
  if (action === 'type') {
    const requested = { ...(query || {}), preferInput: true };
    let meta = findBest(requested);
    let node = meta && (meta.node || resolveNode(meta));
    if (!isEditable(node) && isEditable(document.activeElement)) node = document.activeElement;
    if (!isEditable(node)) node = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"],[role="textbox"]')).find(isEditable);
    if (!isEditable(node)) throw new Error('No editable target found');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    if (node.focus) node.focus({ preventScroll: true });
    const value = String(requested.text || '');
    node.dispatchEvent(new Event('focus', { bubbles: true }));
    
    // 🔑 BrowserOS fillNode approach: clear existing content with Ctrl+A then Backspace
    // This is more reliable than property descriptor hacks on controlled inputs (React/Vue)
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent('keyup',   { key: 'a', code: 'KeyA', ctrlKey: true, metaKey: true, bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }));
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    node.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true }));
    
    if ('value' in node) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
      if (descriptor && descriptor.set) descriptor.set.call(node, value);
      else node.value = value;
    } else {
      node.textContent = value;
    }
    
    // Better support for React/Vue/Angular controlled inputs
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keypress', { key: 'a', bubbles: true }));
    node.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    
    if (requested.submit) {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      node.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      node.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      
      try {
        const form = node.closest('form');
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(submitBtn || undefined);
          } else {
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);
            if (!submitEvent.defaultPrevented) {
              form.submit();
            }
          }
        } else {
          let parent = node.parentElement;
          let searchBtn = null;
          for (let i = 0; parent && i < 3; i++) {
            searchBtn = parent.querySelector('button, [role="button"], #search-icon-legacy');
            if (searchBtn && searchBtn !== node) break;
            parent = parent.parentElement;
          }
          if (searchBtn && typeof searchBtn.click === 'function') {
            searchBtn.click();
          }
        }
      } catch (e) {
        console.error('[Navis] Enter submit fallback in type action failed:', e);
      }
    }
    return { success: true, message: `Typed into ${(meta && (meta.name || meta.ref)) || 'input'}`, stateChanged: true, value: 'value' in node ? node.value : node.textContent };
  }
  if (action === 'press_key') {
    const key = String(query && query.key || 'Enter');
    const keyCode = key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : key === 'Backspace' ? 8 : key === 'Delete' ? 46 : 0;
    const code = key === 'Enter' ? 'Enter' : key === 'Tab' ? 'Tab' : key === 'Escape' ? 'Escape' : key;
    
    // If a ref is provided, resolve and focus that element first
    let node = document.activeElement || document.body;
    if (query && query.ref) {
      const meta = findBest(query);
      const resolved = meta && (meta.node || resolveNode(meta));
      if (resolved) {
        node = resolved;
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (node.focus) node.focus({ preventScroll: true });
      }
    } else if (node.focus) {
      node.focus({ preventScroll: true });
    }
    
    // Dispatch standard key events
    node.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent('keypress', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    
    // If key is Enter, trigger form submission fallback
    if (key === 'Enter' && node.tagName && ['INPUT', 'TEXTAREA'].includes(node.tagName.toUpperCase())) {
      try {
        const form = node.closest('form');
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(submitBtn || undefined);
          } else {
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);
            if (!submitEvent.defaultPrevented) {
              form.submit();
            }
          }
        } else {
          let parent = node.parentElement;
          let searchBtn = null;
          for (let i = 0; parent && i < 3; i++) {
            searchBtn = parent.querySelector('button, [role="button"], #search-icon-legacy');
            if (searchBtn && searchBtn !== node) break;
            parent = parent.parentElement;
          }
          if (searchBtn && typeof searchBtn.click === 'function') {
            searchBtn.click();
          }
        }
      } catch (e) {
        console.error('[Navis] Enter key form submission fallback failed:', e);
      }
    }

    return { success: true, message: `Pressed ${key}`, stateChanged: true, key };
  }
  // 🔑 BrowserOS select action — for native <select> dropdowns and ARIA listboxes
  if (action === 'select_option') {
    let meta = findBest(query || {});
    let node = meta && (meta.node || resolveNode(meta));
    if (!node) return { success: false, message: 'No select target found', stateChanged: false };
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    if (node.focus) node.focus({ preventScroll: true });
    const value = String(query && (query.value || query.text || query.option) || '');
    if (node.tagName && node.tagName.toLowerCase() === 'select') {
      // Native <select> — set value directly
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
      if (descriptor && descriptor.set) descriptor.set.call(node, value);
      else node.value = value;
      // Try matching by text label too
      for (const opt of node.options || []) {
        if (opt.text.trim().toLowerCase() === value.toLowerCase() || opt.value === value) {
          const optDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
          if (optDescriptor && optDescriptor.set) optDescriptor.set.call(node, opt.value);
          else node.value = opt.value;
          break;
        }
      }
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Selected "${value}" in ${meta.name || meta.ref}`, stateChanged: true };
    } else {
      // ARIA listbox / combobox — click the matching option by text
      const opts = Array.from(document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"]'));
      const target = opts.find(o => {
        const t = (o.textContent || '').trim().toLowerCase();
        return t === value.toLowerCase() || t.includes(value.toLowerCase());
      });
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { success: true, message: `Clicked option "${value}"`, stateChanged: true };
      }
      return { success: false, message: `Option "${value}" not found in listbox`, stateChanged: false };
    }
  }
  if (action === 'scroll') {

    const direction = String(query && query.direction || 'down').toLowerCase();
    const amount = Number(query && query.amount || Math.round(innerHeight * 0.78));
    const delta = direction.includes('up') ? -amount : amount;
    
    // Try to find the inner scrollable container first
    let scrollTarget = window;
    const active = document.activeElement;
    if (active && active !== document.body) {
      let cur = active;
      while (cur && cur !== document.body) {
        if (cur.scrollHeight > cur.clientHeight) {
          const style = getComputedStyle(cur);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            scrollTarget = cur;
            break;
          }
        }
        cur = cur.parentElement;
      }
    }
    
    scrollTarget.scrollBy({ top: delta, behavior: 'smooth' });
    return { success: true, message: `Scrolled ${direction}`, stateChanged: true, direction };
  }
  if (action === 'extract') {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map(node => trim(node.textContent)).filter(Boolean);
    const paragraphs = Array.from(document.querySelectorAll('p,li,article,main,section')).slice(0, 120).map(node => trim(node.textContent, 700)).filter(Boolean);
    const text = [document.title, ...headings, ...paragraphs].join('\n').slice(0, 18000);
    return { success: true, message: text || 'No text content found', stateChanged: false, title: document.title, url: location.href, content: text, text };
  }
  if (action === 'wait_dom') {
    const timeoutMs = Math.max(200, Number(query && query.timeoutMs) || 3000);
    const waitText = query && (query.text || query.wait_for_text);
    const waitSelector = query && (query.selector || query.wait_for_selector);

    // 🔑 BrowserOS wait_for_text / wait_for_selector: poll until content appears or timeout.
    if (waitText || waitSelector) {
      const deadline = Date.now() + timeoutMs;
      return new Promise(resolve => {
        function check() {
          const now = Date.now();
          let found = false;
          if (waitSelector) {
            try { found = !!document.querySelector(waitSelector); } catch (e) {}
          }
          if (!found && waitText) {
            found = document.body && document.body.innerText && document.body.innerText.includes(waitText);
          }
          if (found) {
            resolve({ success: true, message: `Found: ${waitSelector || waitText}`, stateChanged: true, url: location.href, title: document.title });
          } else if (now >= deadline) {
            resolve({ success: false, message: `Timeout waiting for: ${waitSelector || waitText}`, stateChanged: false, url: location.href, title: document.title });
          } else {
            setTimeout(check, 150);
          }
        }
        check();
      });
    }

    // Default: wait for any DOM mutation
    return new Promise(resolve => {
      let changed = false;
      const observer = new MutationObserver(() => { changed = true; });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        resolve({ success: true, message: changed ? 'DOM changed' : 'No DOM change before timeout', stateChanged: changed, url: location.href, title: document.title });
      }, timeoutMs);
    });
  }
  if (action === 'go_back') {
    history.back();
    return { success: true, message: 'Went back', stateChanged: true, url: location.href, title: document.title };
  }
  if (action === 'browser_click') {
    const rawX = Number(query?.x ?? 0);
    const rawY = Number(query?.y ?? 0);
    const x = Math.floor((Math.abs(rawX) / 1000.0) * innerWidth);
    const y = Math.floor((Math.abs(rawY) / 1000.0) * innerHeight);
    
    const node = document.elementFromPoint(x, y) || document.body;
    
    renderMouse({ x, y, label: 'Click', durationMs: 6500 });
    
    // Hover sequence
    const hoverInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    node.dispatchEvent(new PointerEvent('pointerover', hoverInit));
    node.dispatchEvent(new PointerEvent('pointerenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new MouseEvent('mouseover', hoverInit));
    node.dispatchEvent(new MouseEvent('mouseenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new PointerEvent('pointermove', hoverInit));
    node.dispatchEvent(new MouseEvent('mousemove', hoverInit));

    // Down sequence
    const downInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, which: 1 };
    node.dispatchEvent(new PointerEvent('pointerdown', downInit));
    node.dispatchEvent(new MouseEvent('mousedown', downInit));
    
    if (node.focus) node.focus({ preventScroll: true });

    // Up sequence
    const upInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0, which: 1 };
    node.dispatchEvent(new PointerEvent('pointerup', upInit));
    node.dispatchEvent(new MouseEvent('mouseup', upInit));
    node.dispatchEvent(new MouseEvent('click', upInit));
    
    try {
      if (typeof node.click === 'function') node.click();
      
      const container = node.closest('a, button, input, [role="button"], [role="link"]');
      if (container && container !== node && typeof container.click === 'function') {
        container.click();
      }
      triggerLinkFallback(node);
    } catch (e) {}
    
    return { success: true, message: `Clicked at coordinates (${x}, ${y})`, stateChanged: true, x, y };
  }
  if (action === 'browser_double_click') {
    const rawX = Number(query?.x ?? 0);
    const rawY = Number(query?.y ?? 0);
    const x = Math.floor((Math.abs(rawX) / 1000.0) * innerWidth);
    const y = Math.floor((Math.abs(rawY) / 1000.0) * innerHeight);
    
    const node = document.elementFromPoint(x, y) || document.body;
    
    renderMouse({ x, y, label: 'Double Click', durationMs: 6500 });
    
    // Hover sequence
    const hoverInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    node.dispatchEvent(new PointerEvent('pointerover', hoverInit));
    node.dispatchEvent(new PointerEvent('pointerenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new MouseEvent('mouseover', hoverInit));
    node.dispatchEvent(new MouseEvent('mouseenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new PointerEvent('pointermove', hoverInit));
    node.dispatchEvent(new MouseEvent('mousemove', hoverInit));

    // First click down/up/click
    const init1 = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, which: 1, detail: 1 };
    node.dispatchEvent(new PointerEvent('pointerdown', init1));
    node.dispatchEvent(new MouseEvent('mousedown', init1));
    if (node.focus) node.focus({ preventScroll: true });
    node.dispatchEvent(new PointerEvent('pointerup', { ...init1, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('mouseup', { ...init1, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('click', { ...init1, buttons: 0 }));
    
    // Second click down/up/click/dblclick
    const init2 = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, which: 1, detail: 2 };
    node.dispatchEvent(new PointerEvent('pointerdown', init2));
    node.dispatchEvent(new MouseEvent('mousedown', init2));
    node.dispatchEvent(new PointerEvent('pointerup', { ...init2, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('mouseup', { ...init2, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('click', { ...init2, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0, which: 1, detail: 2 }));
    
    try {
      if (typeof node.click === 'function') node.click();
      
      const container = node.closest('a, button, input, [role="button"], [role="link"]');
      if (container && container !== node && typeof container.click === 'function') {
        container.click();
      }
      triggerLinkFallback(node);
    } catch (e) {}
    
    return { success: true, message: `Double-clicked at coordinates (${x}, ${y})`, stateChanged: true, x, y };
  }
  if (action === 'browser_right_click') {
    let node = null;
    let x = 0, y = 0;
    if (query && query.ref) {
      const meta = findBest(query);
      node = meta && (meta.node || resolveNode(meta));
      if (node) {
        const rect = node.getBoundingClientRect();
        x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      }
    } else {
      const rawX = Number(query?.x ?? 0);
      const rawY = Number(query?.y ?? 0);
      x = Math.floor((Math.abs(rawX) / 1000.0) * innerWidth);
      y = Math.floor((Math.abs(rawY) / 1000.0) * innerHeight);
      node = document.elementFromPoint(x, y) || document.body;
    }
    if (!node) throw new Error('No target element found for right click');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    
    renderMouse({ x, y, label: 'Right Click', durationMs: 6500 });
    
    // Hover sequence
    const hoverInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    node.dispatchEvent(new PointerEvent('pointerover', hoverInit));
    node.dispatchEvent(new PointerEvent('pointerenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new MouseEvent('mouseover', hoverInit));
    node.dispatchEvent(new MouseEvent('mouseenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new PointerEvent('pointermove', hoverInit));
    node.dispatchEvent(new MouseEvent('mousemove', hoverInit));

    // Right-click down/up/contextmenu
    const init = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 2, buttons: 2, which: 3 };
    node.dispatchEvent(new PointerEvent('pointerdown', init));
    node.dispatchEvent(new MouseEvent('mousedown', init));
    if (node.focus) node.focus({ preventScroll: true });
    node.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    node.dispatchEvent(new MouseEvent('contextmenu', { ...init, buttons: 0 }));
    
    return { success: true, message: `Right-clicked element at coordinates (${x}, ${y})`, stateChanged: true, x, y };
  }
  if (action === 'browser_hover') {
    let node = null;
    let x = 0, y = 0;
    if (query && query.ref) {
      const meta = findBest(query);
      node = meta && (meta.node || resolveNode(meta));
      if (node) {
        const rect = node.getBoundingClientRect();
        x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      }
    } else {
      const rawX = Number(query?.x ?? 0);
      const rawY = Number(query?.y ?? 0);
      x = Math.floor((Math.abs(rawX) / 1000.0) * innerWidth);
      y = Math.floor((Math.abs(rawY) / 1000.0) * innerHeight);
      node = document.elementFromPoint(x, y) || document.body;
    }
    if (!node) throw new Error('No target element found for hover');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    
    renderMouse({ x, y, label: 'Hover', durationMs: 6500 });
    
    const hoverInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    node.dispatchEvent(new PointerEvent('pointerover', hoverInit));
    node.dispatchEvent(new PointerEvent('pointerenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new MouseEvent('mouseover', hoverInit));
    node.dispatchEvent(new MouseEvent('mouseenter', { ...hoverInit, bubbles: false }));
    node.dispatchEvent(new PointerEvent('pointermove', hoverInit));
    node.dispatchEvent(new MouseEvent('mousemove', hoverInit));
    
    return { success: true, message: `Hovered element at coordinates (${x}, ${y})`, stateChanged: true, x, y };
  }
  if (action === 'select') {
    const meta = findBest(query || {});
    const node = meta && (meta.node || resolveNode(meta));
    if (!node) throw new Error('No dropdown target found');
    node.scrollIntoView({ block: 'center', inline: 'center' });
    
    const value = String(query.value || query.option || query.label || '');
    
    if (node.tagName.toLowerCase() === 'select') {
      let found = false;
      for (let i = 0; i < node.options.length; i++) {
        if (node.options[i].value === value || node.options[i].textContent.trim() === value) {
          node.selectedIndex = i;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          found = true;
          break;
        }
      }
      if (!found) throw new Error(`Option '${value}' not found in dropdown`);
      return { success: true, message: `Selected option '${value}' on standard dropdown`, stateChanged: true };
    }
    
    clickNode(node);
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const normVal = value.trim().toLowerCase();
    const options = Array.from(document.querySelectorAll('[role="option"], li, a, button, span, div')).filter(el => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const text = String(el.textContent || '').trim().toLowerCase();
      return text === normVal || text.includes(normVal);
    });
    
    if (options.length > 0) {
      options.sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectA.width * rectA.height) - (rectB.width * rectB.height);
      });
      clickNode(options[0]);
      return { success: true, message: `Selected option '${value}' from custom dropdown`, stateChanged: true };
    }
    
    throw new Error(`Failed to find custom option matching '${value}'`);
  }
  if (action === 'overlay') {
    renderOverlay(query || {});
    return { success: true, message: 'Overlay updated', stateChanged: false };
  }
  if (action === 'mouse') {
    renderMouse(query || {});
    return { success: true, message: 'Mouse indicator shown', stateChanged: false };
  }
  throw new Error(`Unknown page action: ${action}`);

  function trim(value, max = 160) {
    const out = String(value || '').replace(/\s+/g, ' ').trim();
    return out.length > max ? `${out.slice(0, max - 1)}...` : out;
  }
  function renderOverlay(input) {
    const hostId = 'everfern-navis-page-overlay';
    const borderId = 'everfern-navis-active-border';
    let host = document.getElementById(hostId);
    if (input.mode === 'hide') {
      if (window.__navis_cleanup_lock) {
        window.__navis_cleanup_lock();
        delete window.__navis_cleanup_lock;
      }
      if (host) host.remove();
      const border = document.getElementById(borderId);
      if (border) border.remove();
      return;
    }
    if (input.mode === 'toggle' && host) {
      if (window.__navis_cleanup_lock) {
        window.__navis_cleanup_lock();
        delete window.__navis_cleanup_lock;
      }
      host.remove();
      const border = document.getElementById(borderId);
      if (border) border.remove();
      return;
    }

    // Create a shimmering active border indicating Navis control
    let border = document.getElementById(borderId);
    if (!border) {
      border = document.createElement('div');
      border.id = borderId;
      border.style.position = 'fixed';
      border.style.top = '0';
      border.style.left = '0';
      border.style.width = '100vw';
      border.style.height = '100vh';
      border.style.boxSizing = 'border-box';
      border.style.pointerEvents = 'none';
      border.style.zIndex = '2147483646';
      border.style.overflow = 'hidden';
      
      const styleId = 'everfern-navis-active-border-style';
      let styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
          #${borderId} {
            border: none !important;
            box-shadow: 
              inset 0 0 24px rgba(255, 120, 40, 0.4),
              inset 0 0 48px rgba(236, 72, 153, 0.28),
              inset 0 0 72px rgba(190, 60, 255, 0.15) !important;
            animation: navis-glow-pulse 4s infinite ease-in-out !important;
          }
          @keyframes navis-glow-pulse {
            0%, 100% {
              box-shadow: 
                inset 0 0 24px rgba(255, 120, 40, 0.4),
                inset 0 0 48px rgba(236, 72, 153, 0.28),
                inset 0 0 72px rgba(190, 60, 255, 0.15) !important;
            }
            50% {
              box-shadow: 
                inset 0 0 40px rgba(255, 120, 40, 0.6),
                inset 0 0 72px rgba(236, 72, 153, 0.45),
                inset 0 0 96px rgba(190, 60, 255, 0.25) !important;
            }
          }
        `;
        document.head.appendChild(styleEl);
      }
      document.documentElement.appendChild(border);
    }

    if (!host) {
      host = document.createElement('div');
      host.id = hostId;
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'auto';
      document.documentElement.appendChild(host);
    }

    // Always start host in corner-panel layout, unless it was already expanded to full screen by user interaction
    const wasAlreadyLocked = host && host.style.inset === '0px';
    if (!wasAlreadyLocked) {
      host.style.inset = '';
      host.style.top = '14px';
      host.style.right = '14px';
      host.style.width = 'min(380px, calc(100vw - 28px))';
      host.style.maxHeight = 'calc(100vh - 28px)';
    }

    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const panel = input.state || {};
    const panelEvents = Array.isArray(panel.events) ? panel.events.slice(-8).reverse() : [];
    const latest = panelEvents[0] || {};
    const escape = value => trim(value, 700).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const logoSrc = input.logoUrl || '';

    root.innerHTML = `<style>
      :host { all: initial; }
      .shell {
        box-sizing: border-box;
        max-height: calc(100vh - 28px);
        overflow: auto;
        padding: 14px;
        border-radius: 24px;
        background: #f4f2ec;
        border: 1px solid rgba(222,215,202,.9);
        box-shadow: 0 18px 50px rgba(32,30,26,.18), inset 0 1px 0 rgba(255,255,255,.8);
        font-family: Figtree, Inter, ui-sans-serif, system-ui, sans-serif;
        font-feature-settings: "ss01" 1,"cv05" 1;
        color: #201e1a;
      }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
      .brand { display: flex; align-items: center; gap: 10px; }
      .logo { width: 34px; height: 34px; border-radius: 12px; object-fit: cover; box-shadow: 0 1px 2px rgba(32,30,26,.12), inset 0 1px 0 rgba(255,255,255,.55); }
      .title strong { display: block; font-size: 14px; }
      .title span { display: block; color: #817a70; font-size: 11px; }
      .close { width: 30px; height: 30px; border: 1px solid #ded7ca; border-radius: 11px; background: #fffefb; color: #817a70; }
      .card { border-radius: 18px; background: #fffefb; border: 1px solid #ded7ca; padding: 12px; margin-top: 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,.7), 0 2px 8px rgba(32,30,26,.05); }
      .orb { width: 38px; height: 38px; border-radius: 999px; background: radial-gradient(circle at 30% 24%, #fff 0%, #a5f3fc 20%, #3b82f6 52%, #8b5cf6 100%); animation: pulse 2.2s ease-in-out infinite; }
      .now { display: grid; grid-template-columns: 38px 1fr; gap: 11px; align-items: center; }
      .k { display: block; color: #a19a91; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
      .card strong { display: block; margin-top: 4px; font-size: 13px; line-height: 1.35; }
      .card p { margin: 5px 0 0; color: #625d55; font-size: 11.5px; line-height: 1.45; }
      .feed { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .feed li { border-radius: 14px; background: #f8f6ef; border: 1px solid #e7dfd1; padding: 9px; }
      .feed b { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8c857d; }
      .feed p { margin: 4px 0 0; color: #4a4640; font-size: 11px; line-height: 1.4; }
      
      /* Backdrop Lock Shield */
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(1px);
        display: ${wasAlreadyLocked ? 'flex' : 'none'};
        align-items: center;
        justify-content: center;
        cursor: not-allowed;
        pointer-events: ${wasAlreadyLocked ? 'all' : 'none'};
        user-select: none;
        transition: opacity 0.35s ease;
      }
      .backdrop.fading { opacity: 0; pointer-events: none; }
      .card-lock {
        box-sizing: border-box;
        padding: 20px 28px;
        border-radius: 16px;
        background: #111;
        border: 1px solid rgba(255,255,255,.1);
        box-shadow: 0 8px 40px rgba(0,0,0,.8);
        font-family: Figtree, Inter, ui-sans-serif, system-ui, sans-serif;
        color: #fff;
        text-align: center;
        max-width: 300px;
        cursor: default;
      }
      .icon-lock { font-size: 28px; margin-bottom: 8px; display: block; }
      .title-lock { font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 4px; }
      .desc-lock { font-size: 11.5px; color: rgba(255,255,255,.5); line-height: 1.5; margin: 0; }
      @keyframes pulse { 0%,100%{transform:scale(.94)} 50%{transform:scale(1.04)} }
    </style>
    
    <aside class="shell">
      <div class="top">
        <div class="brand">
          ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="EverFern" />` : ''}
          <div class="title"><strong>EverFern Navis</strong><span>Live browser agent</span></div>
        </div>
        <button class="close">x</button>
      </div>
      <section class="card">
        <span class="k">Task</span>
        <strong>${escape(panel.activeTask || 'No active Navis task yet')}</strong>
      </section>
      <section class="card now">
        <div class="orb"></div>
        <div>
          <span class="k">Now</span>
          <strong>${escape(latest.type || 'Waiting')}</strong>
          <p>${escape(latest.content || latest.message || latest.detail || 'Navis thoughts and browser actions will appear here.')}</p>
        </div>
      </section>
      <section class="card">
        <span class="k">Current page</span>
        <strong>${escape(panel.activeTitle || document.title || 'Current tab')}</strong>
        <p>${escape(panel.activeUrl || location.href)}</p>
      </section>
      <ol class="feed">
        ${panelEvents.map(event => `<li><b>${escape(event.type || 'step')}</b><p>${escape(event.content || event.message || event.detail || (event.action && event.action.description) || 'Working through the browser.')}</p></li>`).join('')}
      </ol>
    </aside>
    
    <div class="backdrop">
      <div class="card-lock">
        <span class="icon-lock">🔒</span>
        <p class="title-lock">AI is controlling this tab</p>
        <p class="desc-lock">Don't interact while Navis is working.</p>
      </div>
    </div>`;

    root.querySelector('.close')?.addEventListener('click', () => {
      if (window.__navis_cleanup_lock) {
        window.__navis_cleanup_lock();
        delete window.__navis_cleanup_lock;
      }
      host.remove();
      const border = document.getElementById(borderId);
      if (border) border.remove();
    }, { once: true });

    // Lock interaction handler: trigger backdrop full-screen lock only when user tries to click/scroll/type
    if (window.__navis_cleanup_lock) {
      window.__navis_cleanup_lock();
      delete window.__navis_cleanup_lock;
    }

    if (input.locked) {
      let lockDismissTimer = null;
      let isMouseOverPanel = false;

      const onMouseEnter = () => { isMouseOverPanel = true; };
      const onMouseLeave = () => { isMouseOverPanel = false; };
      host.addEventListener('mouseenter', onMouseEnter);
      host.addEventListener('mouseleave', onMouseLeave);

      const hideLock = () => {
        const backdrop = root.querySelector('.backdrop');
        if (!backdrop || backdrop.style.display === 'none') return;
        backdrop.classList.add('fading');
        setTimeout(() => {
          backdrop.style.display = 'none';
          backdrop.style.pointerEvents = 'none';
          backdrop.classList.remove('fading');
          // Restore host to corner panel
          host.style.inset = '';
          host.style.top = '14px';
          host.style.right = '14px';
          host.style.width = 'min(380px, calc(100vw - 28px))';
          host.style.maxHeight = 'calc(100vh - 28px)';
        }, 350);
      };

      const showLock = (e) => {
        // Allow all actions, copying, and scrolling if the user's mouse is over the panel
        if (isMouseOverPanel) return;

        // Allow clicks/interactions inside the host panel itself (light DOM, shadow DOM, or composed path)
        if (host.contains(e.target) || root.contains(e.target) || (e.composedPath && e.composedPath().includes(host))) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        const backdrop = root.querySelector('.backdrop');
        if (backdrop) {
          backdrop.style.display = 'flex';
          backdrop.style.pointerEvents = 'all';
          backdrop.classList.remove('fading');
          host.style.inset = '0';
          host.style.width = '';
          host.style.height = '';
          host.style.top = '';
          host.style.right = '';
          host.style.maxHeight = '';
        }

        // Auto-dismiss after 2 seconds
        if (lockDismissTimer) clearTimeout(lockDismissTimer);
        lockDismissTimer = setTimeout(hideLock, 2000);
      };

      window.addEventListener('mousedown', showLock, { capture: true, passive: false });
      window.addEventListener('wheel', showLock, { capture: true, passive: false });
      window.addEventListener('keydown', showLock, { capture: true, passive: false });

      window.__navis_cleanup_lock = () => {
        if (lockDismissTimer) clearTimeout(lockDismissTimer);
        host.removeEventListener('mouseenter', onMouseEnter);
        host.removeEventListener('mouseleave', onMouseLeave);
        window.removeEventListener('mousedown', showLock, { capture: true });
        window.removeEventListener('wheel', showLock, { capture: true });
        window.removeEventListener('keydown', showLock, { capture: true });
      };
    }
  }
}

async function runPage(tabId, action, data = {}) {
  const tab = await maybeCall('tabs', 'get', Number(tabId));
  if (!canInject(tab)) {
    throw new Error(`Cannot run page action '${action}': Browser restricts scripting on internal/restricted pages (${tab ? tab.url : 'restricted url'}). Please navigate to a standard website first.`);
  }
  const refs = lastRefsByTab.get(tabId) || [];
  
  let timeoutMs = 8000;
  if (action === 'wait_dom' && data && data.timeoutMs) {
    timeoutMs = Math.max(8000, Number(data.timeoutMs) + 4000);
  }
  
  return Promise.race([
    executeInTab(tabId, pageBridge, [action, data, refs]),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Page action '${action}' timed out (tab might be unresponsive)`)), timeoutMs))
  ]);
}

function fetchAccessibilityTree(tabId) {
  return new Promise((resolve) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;

    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          getTree();
          return;
        }
        resolve(null);
        return;
      }
      attachedByUs = true;
      getTree();
    });

    function getTree() {
      chrome.debugger.sendCommand(target, "Accessibility.getFullAXTree", { depth: -1 }, (result) => {
        const cmdErr = chrome.runtime.lastError;
        if (attachedByUs) {
          chrome.debugger.detach(target, () => {});
        }
        if (cmdErr || !result || !result.nodes) {
          resolve(null);
        } else {
          resolve(result.nodes);
        }
      });
    }
  });
}

function fetchElementCenterCDP(tabId, backendNodeId) {
  return new Promise((resolve, reject) => {
    const target = { tabId: Number(tabId) };
    let attachedByUs = false;

    chrome.debugger.attach(target, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (err.message && err.message.includes("already attached")) {
          getCoords();
          return;
        }
        reject(new Error(`CDP attach failed: ${err.message}`));
        return;
      }
      attachedByUs = true;
      getCoords();
    });

    async function getCoords() {
      try {
        await new Promise((res) => {
          chrome.debugger.sendCommand(target, "DOM.scrollIntoViewIfNeeded", { backendNodeId: Number(backendNodeId) }, () => {
            res();
          });
        });

        await new Promise(res => setTimeout(res, 80));

        chrome.debugger.sendCommand(target, "DOM.getBoxModel", { backendNodeId: Number(backendNodeId) }, (result) => {
          const cmdErr = chrome.runtime.lastError;
          if (attachedByUs) {
            chrome.debugger.detach(target, () => {});
          }
          if (cmdErr) {
            reject(new Error(`DOM.getBoxModel failed: ${cmdErr.message}`));
            return;
          }
          if (result && result.model && result.model.content) {
            const content = result.model.content;
            const x = Math.round((content[0] + content[2] + content[4] + content[6]) / 4);
            const y = Math.round((content[1] + content[3] + content[5] + content[7]) / 4);
            resolve({ x, y });
          } else {
            reject(new Error("Box model content not found"));
          }
        });
      } catch (err) {
        if (attachedByUs) {
          chrome.debugger.detach(target, () => {});
        }
        reject(err);
      }
    }
  });
}

function renderAccessibilityTree(nodes, contentScriptRefs) {
  const byId = new Map();
  for (const node of nodes) {
    byId.set(node.nodeId, node);
  }

  const rootRoles = new Set(['RootWebArea', 'WebArea', 'Document']);
  const entryNodeIds = [];
  for (const node of nodes) {
    const role = typeof node.role?.value === 'string' ? node.role.value : '';
    if (rootRoles.has(role)) {
      entryNodeIds.push(node.nodeId);
    }
  }
  if (entryNodeIds.length === 0 && nodes[0]) {
    entryNodeIds.push(nodes[0].nodeId);
  }

  // Roles that can receive a [ref=eN] for interaction
  const interactiveRoles = new Set([
    'button', 'link', 'textbox', 'searchbox', 'textarea', 'checkbox', 'radio',
    'combobox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch',
    'slider', 'spinbutton', 'option', 'treeitem', 'listbox', 'DisclosureTriangle',
    'select', 'scrollbar'
  ]);
  // Roles shown with name/context but no ref (structural/descriptive)
  const contextRoles = new Set([
    'heading', 'img', 'image', 'figure', 'paragraph', 'list', 'listitem',
    'article', 'section', 'navigation', 'banner', 'main', 'contentinfo', 'complementary', 'region'
  ]);
  // Roles completely skipped (pure noise)
  const skipRoles = new Set([
    'none', 'presentation', 'LineBreak', 'InlineTextBox', 'StaticText', 'text',
    'LayoutTable', 'LayoutTableRow', 'LayoutTableCell', 'LayoutTableSection'
  ]);
  // Roles where we show the current value
  const valueRoles = new Set(['textbox', 'searchbox', 'textarea', 'combobox', 'spinbutton']);

  // Build a ref-tag index from content script refs for faster matching
  const refsByTag = new Map();
  const refsByName = new Map();
  for (const r of (contentScriptRefs || [])) {
    const tag = (r.tag || '').toLowerCase();
    if (!refsByTag.has(tag)) refsByTag.set(tag, []);
    refsByTag.get(tag).push(r);
    const name = (r.name || '').toLowerCase().trim();
    if (name) {
      if (!refsByName.has(name)) refsByName.set(name, []);
      refsByName.get(name).push(r);
    }
  }

  const matchedRefs = new Set();

  // Match an AX node to a content script ref to get its [ref=eN]
  const findRef = (role, name, href) => {
    const candidates = [];
    // Map AX role → likely HTML tags
    const tagCandidates = {
      'link': ['a'],
      'button': ['button'],
      'textbox': ['input', 'textarea'],
      'searchbox': ['input'],
      'textarea': ['textarea'],
      'combobox': ['select', 'input'],
      'checkbox': ['input'],
      'radio': ['input'],
    };
    const tags = tagCandidates[role] || [];
    for (const tag of tags) {
      for (const r of (refsByTag.get(tag) || [])) {
        if (!matchedRefs.has(r.ref)) candidates.push(r);
      }
    }
    // Also search by href if available (most reliable for links)
    if (href) {
      for (const r of (contentScriptRefs || [])) {
        if (!matchedRefs.has(r.ref) && r.href && (r.href.endsWith(href) || r.href.includes(href))) {
          return r;
        }
      }
    }
    // Match by name substring
    const normName = (name || '').toLowerCase().trim().slice(0, 80);
    if (normName && candidates.length === 0) {
      for (const r of (contentScriptRefs || [])) {
        if (matchedRefs.has(r.ref)) continue;
        const rn = (r.name || '').toLowerCase().trim();
        if (rn && (rn.includes(normName.slice(0, 40)) || normName.includes(rn.slice(0, 40)))) {
          candidates.push(r);
        }
      }
    }
    if (candidates.length === 0) return null;
    // Among candidates, prefer the one whose name best matches
    candidates.sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const aScore = normName && an.includes(normName.slice(0, 30)) ? 1 : 0;
      const bScore = normName && bn.includes(normName.slice(0, 30)) ? 1 : 0;
      return bScore - aScore;
    });
    return candidates[0] || null;
  };

  const MAX_NAME_LEN = 120;
  const truncate = (s, max = MAX_NAME_LEN) => {
    if (!s) return '';
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
  };

  const lines = [];

  const visit = (nodeId, depth) => {
    const node = byId.get(nodeId);
    if (!node) return;
    if (node.ignored) {
      for (const childId of node.childIds || []) visit(childId, depth);
      return;
    }

    const role = typeof node.role?.value === 'string' ? node.role.value : '';
    const name = truncate(typeof node.name?.value === 'string' ? node.name.value : '');
    // Get href from AX node url property or value
    let href = '';
    for (const prop of node.properties || []) {
      if (prop.name === 'url' && typeof prop.value?.value === 'string') {
        href = prop.value.value;
      }
    }
    if (!href && typeof node.value?.value === 'string' && role === 'link') {
      href = node.value.value;
    }

    // Skip entirely useless nodes
    if (!role || skipRoles.has(role) || rootRoles.has(role)) {
      for (const childId of node.childIds || []) visit(childId, depth);
      return;
    }

    // Skip unnamed generic/group nodes — they're layout wrappers
    if ((role === 'generic' || role === 'group') && !name) {
      for (const childId of node.childIds || []) visit(childId, depth);
      return;
    }

    const indent = '  '.repeat(depth);
    let line = `${indent}- ${role}`;
    if (name) line += ` ${JSON.stringify(name)}`;

    // Add AX properties
    for (const prop of node.properties || []) {
      const v = prop.value?.value;
      switch (prop.name) {
        case 'checked':
          if (v === true) line += ' [checked]';
          else if (v === 'mixed') line += ' [indeterminate]';
          break;
        case 'disabled':
          if (v === true) line += ' [disabled]';
          break;
        case 'expanded':
          if (v === true) line += ' [expanded]';
          else if (v === false) line += ' [collapsed]';
          break;
        case 'required':
          if (v === true) line += ' [required]';
          break;
        case 'selected':
          if (v === true) line += ' [selected]';
          break;
        case 'level':
          if (role === 'heading') line += ` [level=${v}]`;
          break;
        case 'haspopup':
          if (v && v !== false) line += ' [haspopup]';
          break;
      }
    }

    // Attach [ref=eN] for interactive elements
    if (interactiveRoles.has(role)) {
      const match = findRef(role, name, href);
      if (match) {
        matchedRefs.add(match.ref);
        line += ` [ref=${match.ref}]`;
        if (node.backendDOMNodeId) {
          match.backendNodeId = node.backendDOMNodeId;
        }
      }
    }

    // Show current value for input-like roles
    if (valueRoles.has(role)) {
      const value = truncate(typeof node.value?.value === 'string' ? node.value.value : '', 80);
      if (value) line += `: "${value}"`;
    }

    // 🔑 KEY BrowserOS feature: show link URL so AI can distinguish video links from UI buttons
    if (role === 'link' && href && !href.startsWith('javascript:')) {
      // Show a truncated relative href for readability
      const shortHref = href.startsWith('http') ? href.replace(/^https?:\/\/[^/]+/, '') : href;
      if (shortHref && shortHref !== '/') {
        line += ` url:${truncate(shortHref, 60)}`;
      }
    }

    // For images/figures, add a brief label
    if ((role === 'img' || role === 'image' || role === 'figure') && name) {
      // name already added above, no extra needed
    }

    lines.push(line);

    // For context roles (headings, articles, sections), recurse into children to show structure
    // For interactive nodes that are simple leaves (no interactive children), skip deep recursion
    for (const childId of node.childIds || []) {
      visit(childId, depth + 1);
    }
  };

  for (const rootId of entryNodeIds) {
    visit(rootId, 0);
  }

  // Deduplicate consecutive identical lines (some AX trees have duplicates)
  const deduped = [];
  let prev = '';
  for (const line of lines) {
    if (line !== prev) deduped.push(line);
    prev = line;
  }

  // Append any content-script refs that weren't matched by AX tree (DOM-only elements)
  const unmatchedRefs = (contentScriptRefs || []).filter(r => !matchedRefs.has(r.ref));
  if (unmatchedRefs.length > 0) {
    deduped.push('');
    deduped.push('-- Additional interactive elements (not in AX tree) --');
    for (const r of unmatchedRefs) {
      let line = `- ${r.role || r.tag || 'element'}`;
      if (r.name) line += ` ${JSON.stringify(truncate(r.name, 80))}`;
      if (r.href) {
        const shortHref = r.href.startsWith('http') ? r.href.replace(/^https?:\/\/[^/]+/, '') : r.href;
        if (shortHref && shortHref !== '/') line += ` url:${truncate(shortHref, 60)}`;
      }
      line += ` [ref=${r.ref}]`;
      deduped.push(line);
    }
  }

  return deduped.join('\n');
}



async function captureActive(data = {}) {
  const tab = await getTargetTab(data.tabId);
  if (!tab || !tab.id) throw new Error('No active tab available');

  // If the tab is loading, wait up to 2.5 seconds for it to finish loading or settle
  if (tab.status === 'loading') {
    await waitForTabLoad(tab.id, 2500).catch(() => {});
  }
  
  // Wait a small buffer (e.g. 350ms) to let dynamically loaded elements render
  await new Promise(resolve => setTimeout(resolve, 350));

  if (!canInject(tab)) {
    const snapshot = {
      url: tab.url || 'about:blank',
      title: tab.title || 'Restricted Page',
      text: 'This is an internal/restricted browser page (e.g. chrome://, chrome-extension://, or about:blank) that Navis cannot access or inject scripts into. To browse, please navigate to a standard website or open a new tab.',
      viewport: { width: 1024, height: 768, scrollX: 0, scrollY: 0 },
      refs: [],
    };
    lastRefsByTab.set(tab.id, []);
    setState({ activeUrl: tab.url, activeTitle: tab.title || 'Restricted Page' });
    return {
      success: true,
      message: 'Captured active tab DOM (Restricted Page)',
      stateChanged: false,
      tab: formatTab(tab),
      tabId: tab.id,
      url: tab.url,
      title: tab.title || 'Restricted Page',
      refs: [],
      snapshot,
    };
  }

  const snapshot = await runPage(tab.id, 'capture', {});

  // 🔑 BrowserOS-style stability loop: fetch AX tree and verify the URL didn't change mid-capture.
  // If navigation fires while we're reading the AX tree, the snapshot is half-stale.
  // Retry up to 3 times to get a stable snapshot.
  const MAX_STABLE_ATTEMPTS = 3;
  let renderedTree = null;
  for (let attempt = 0; attempt < MAX_STABLE_ATTEMPTS; attempt++) {
    const urlBefore = tab.url;
    try {
      const nodes = await fetchAccessibilityTree(tab.id);
      // Check if the tab URL changed during the AX tree fetch
      const currentTab = await maybeCall('tabs', 'get', Number(tab.id));
      const urlAfter = currentTab && currentTab.url;
      if (urlAfter && urlBefore && urlAfter !== urlBefore) {
        console.warn(`[Navis] AX tree capture: URL changed during attempt ${attempt + 1} (${urlBefore} → ${urlAfter}), retrying...`);
        // Update tab reference and snapshot for the new page
        if (attempt < MAX_STABLE_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
      }
      if (nodes && nodes.length > 0) {
        renderedTree = renderAccessibilityTree(nodes, snapshot.refs || []);
      }
    } catch (err) {
      console.warn(`[Navis] AX tree capture attempt ${attempt + 1} failed:`, err);
    }
    break; // stable or max attempts reached
  }
  if (renderedTree) {
    snapshot.text = renderedTree;
  }

  // 🔑 Scoped Form DOM Filtering (Token Saver)
  if (data.scope === 'form' || data.formId) {
    const targetForm = (snapshot.forms || []).find(f => f.id === data.formId) || snapshot.activeForm || (snapshot.forms || [])[0];
    if (targetForm && targetForm.refs && targetForm.refs.length > 0) {
      const formRefSet = new Set(targetForm.refs);
      const scopedRefs = (snapshot.refs || []).filter(r => formRefSet.has(r.ref));
      const filteredLines = (snapshot.text || '').split('\n').filter(line => {
        const match = line.match(/\[ref=(e\d+)\]/);
        return match ? formRefSet.has(match[1]) : (line.includes(targetForm.name) || line.startsWith('  - heading'));
      });
      snapshot.text = `[🎯 SCOPED FORM DOM: ${targetForm.name} (${targetForm.inputCount} fields)] (Send scope="page" for full site DOM)\n` + filteredLines.join('\n');
      snapshot.refs = scopedRefs;
      snapshot.scopedForm = targetForm;
    }
  }

  lastRefsByTab.set(tab.id, snapshot && Array.isArray(snapshot.refs) ? snapshot.refs : []);
  setState({ activeUrl: snapshot && snapshot.url || tab.url, activeTitle: snapshot && snapshot.title || tab.title });
  return {
    success: true,
    message: data.scope === 'form' || data.formId ? 'Captured scoped form DOM' : 'Captured active tab DOM',
    stateChanged: false,
    tab: formatTab(tab),
    tabId: tab.id,
    url: snapshot && snapshot.url || tab.url,
    title: snapshot && snapshot.title || tab.title,
    refs: snapshot && Array.isArray(snapshot.refs) ? snapshot.refs : [],
    forms: snapshot && snapshot.forms || [],
    activeForm: snapshot && snapshot.activeForm || null,
    scopedForm: snapshot && snapshot.scopedForm || null,
    snapshot,
  };
}

async function syncOverlay(mode = 'update') {
  if (!state.sessionActive && mode !== 'hide' && mode !== 'toggle') return;
  const current = await activeTab().catch(() => null);
  const candidates = [];
  const seen = new Set();
  
  if (canInject(current)) {
    candidates.push(current);
    seen.add(current.id);
  }
  
  // Fetch tabs in parallel rather than sequentially
  const tabIdsToCheck = Array.from(navisTabs.keys()).filter(id => !seen.has(id));
  const tabs = await Promise.all(
    tabIdsToCheck.map(id => maybeCall('tabs', 'get', Number(id)))
  );
  
  for (const tab of tabs) {
    if (canInject(tab)) candidates.push(tab);
  }
  
  const logoUrl = api.runtime.getURL('logos/everfern-rounded.png');
  await Promise.all(candidates.map(tab => {
    const isLocked = state.sessionActive && navisTabs.has(tab.id);
    return runPage(tab.id, 'overlay', { mode, state: panelState(), logoUrl, locked: isLocked }).catch(() => {});
  }));
}

async function clickLike(tab, data) {
  // Phase 1: Resolve the element center coordinates via CDP (using backendNodeId) or the content script.
  let coords = null;
  let refs = lastRefsByTab.get(tab.id) || [];
  let meta = refs.find(r => r.ref === data.ref);

  // Phase 1a: Try CDP backendNodeId (fastest path)
  if (meta && meta.backendNodeId) {
    try {
      const cdpCoords = await fetchElementCenterCDP(tab.id, meta.backendNodeId);
      if (cdpCoords && cdpCoords.x != null && cdpCoords.y != null) {
        coords = { ...cdpCoords, name: meta.name || data.ref, ref: meta.ref };
        console.log(`[Navis] Resolved element ${data.ref} center via CDP: (${coords.x}, ${coords.y})`);
      }
    } catch (err) {
      console.warn(`[Navis] CDP resolve coords failed for ref=${data.ref}:`, err.message || err);
    }
  }

  // Phase 1b: Try content-script get_center (3-tier resolveNode: data-navis-ref, selector, text)
  if (!coords) {
    try {
      const centerResult = await runPage(tab.id, 'get_center', data);
      if (centerResult && centerResult.x != null && centerResult.y != null) {
        coords = centerResult;
      }
    } catch (_) {}
  }

  // Phase 1c: STALE REF RECOVERY — re-capture the page to re-stamp data-navis-ref attributes,
  // then retry get_center. This handles SPA re-renders that strip the custom attribute.
  if (!coords && data.ref) {
    console.log(`[Navis] Ref ${data.ref} resolve failed — re-capturing page to refresh data-navis-ref attributes...`);
    try {
      const freshSnapshot = await captureActive({ tabId: tab.id });
      const freshRefs = freshSnapshot && Array.isArray(freshSnapshot.snapshot?.refs) ? freshSnapshot.snapshot.refs : [];
      lastRefsByTab.set(tab.id, freshRefs);
      const freshMeta = freshRefs.find(r => r.ref === data.ref);
      if (freshMeta) {
        const retryResult = await runPage(tab.id, 'get_center', data);
        if (retryResult && retryResult.x != null && retryResult.y != null) {
          coords = retryResult;
          console.log(`[Navis] ✅ Stale ref recovery succeeded for ${data.ref} after re-capture`);
        }
      } else {
        console.warn(`[Navis] Ref ${data.ref} not found even after re-capture — element may have been removed`);
      }
    } catch (err) {
      console.warn('[Navis] Re-capture for stale ref recovery failed:', err.message || err);
    }
  }

  if (coords) {
    lastMouseByTab.set(tab.id, { x: coords.x, y: coords.y, label: 'Click', updatedAt: Date.now() });
    navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });

    // Phase 2: Fire a pure CDP trusted click at the resolved coordinates.
    // Trusted events (isTrusted === true) are required by SPAs like YouTube.
    // Wait for any pending debugger detach (e.g. from AX tree fetch) to settle.
    await new Promise(resolve => setTimeout(resolve, 80));
    let cdpOk = false;
    try {
      await dispatchClickWithDebugger(tab.id, coords.x, coords.y, data.button || 'left');
      console.log(`[Navis] ✅ CDP trusted click at (${coords.x}, ${coords.y}) for ref=${data.ref || '?'}`);
      cdpOk = true;
    } catch (err) {
      console.warn('[Navis] CDP trusted click failed, falling back to DOM events:', err.message || err);
    }

    // Phase 3: Also fire DOM synthetic events as supplementary signals (e.g. for React state updates).
    // We do this AFTER the CDP click so the trusted event always lands first.
    try {
      const domResult = await runPage(tab.id, 'click', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...domResult, cdpOk };
    } catch (_) {
      return {
        tabId: tab.id, url: tab.url, title: tab.title,
        success: cdpOk, message: `Clicked ${coords.name || data.ref || 'element'}`,
        stateChanged: true, cdpOk
      };
    }
  }

  // Fallback: no coords resolved — try DOM click, then re-capture + retry if that also fails.
  let result = await runPage(tab.id, 'click', data);
  if (result && result.x != null && result.y != null) {
    lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Click', updatedAt: Date.now() });
    navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 80));
    try {
      await dispatchClickWithDebugger(tab.id, result.x, result.y, data.button || 'left');
      console.log(`[Navis] ✅ CDP fallback click at (${result.x}, ${result.y})`);
    } catch (err) {
      console.warn('[Navis] CDP fallback click failed:', err.message || err);
    }
  } else if (data.ref) {
    // Last resort: re-capture to refresh data-navis-ref, then retry DOM click
    console.log(`[Navis] DOM click fallback also failed for ref=${data.ref} — re-capturing...`);
    try {
      const freshSnapshot = await captureActive({ tabId: tab.id });
      const freshRefs = freshSnapshot && Array.isArray(freshSnapshot.snapshot?.refs) ? freshSnapshot.snapshot.refs : [];
      lastRefsByTab.set(tab.id, freshRefs);
      result = await runPage(tab.id, 'click', data);
      if (result && result.x != null && result.y != null) {
        lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Click', updatedAt: Date.now() });
        await new Promise(resolve => setTimeout(resolve, 80));
        try {
          await dispatchClickWithDebugger(tab.id, result.x, result.y, data.button || 'left');
          console.log(`[Navis] ✅ CDP re-capture click at (${result.x}, ${result.y})`);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[Navis] Re-capture click fallback failed:', err.message || err);
    }
  }
  return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
}

async function handleCommand(command, data) {
  switch (command) {
    case 'get_tabs':
    case 'navis-get-tabs': {
      const tabs = await call('tabs', 'query', {});
      return { success: true, message: 'Fetched browser tabs', stateChanged: false, tabs: tabs.map(formatTab) };
    }
    case 'open_tab':
    case 'navis-open-tab': {
      // Create Navis tabs in the BACKGROUND so the user's focused tab never changes
      const tab = await call('tabs', 'create', { url: normalizeUrl(data.url), active: false });
      navisTabs.set(tab.id, { sessionId: data.sessionId || 'default', createdAt: Date.now() });
      lastActiveTabId = tab.id;
      lastActiveWindowId = tab.windowId;
      await ensureGroup(tab.id);
      await waitForTabLoad(tab.id, 8000).catch(() => {});
      setState({ activeUrl: tab.url, activeTitle: tab.title || '' });
      return { success: true, message: 'Opened tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'activate_tab':
    case 'navis-activate-tab': {
      let tabId = Number(data.tabId);
      if (!tabId && data.index !== undefined) {
        let tabs = [];
        if (lastActiveWindowId) {
          try { tabs = await call('tabs', 'query', { windowId: lastActiveWindowId }); } catch {}
        }
        if (!tabs || tabs.length === 0) {
          try { tabs = await call('tabs', 'query', { currentWindow: true }); } catch {}
        }
        if ((!tabs || tabs.length === 0) && navisGroupId >= 0) {
          try { tabs = await call('tabs', 'query', { groupId: navisGroupId }); } catch {}
        }
        tabId = Number(tabs && tabs[Number(data.index)] && tabs[Number(data.index)].id);
      }
      if (!tabId && data.target) {
        const tabs = await call('tabs', 'query', {});
        const target = String(data.target).toLowerCase();
        const match = tabs.find(tab => String(tab.url || '').toLowerCase().includes(target) || String(tab.title || '').toLowerCase().includes(target));
        tabId = Number(match && match.id);
      }
      if (!tabId) throw new Error('No tab matched activation request');
      // Switch active tab within our internal tracking only - don't steal user's window focus
      const tab = await call('tabs', 'get', tabId);
      if (tab.windowId) lastActiveWindowId = tab.windowId;
      lastActiveTabId = tab.id;
      setState({ activeUrl: tab.url, activeTitle: tab.title || '' });
      return { success: true, message: 'Activated tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url, title: tab.title };
    }
    case 'navigate':
    case 'navis-navigate': {
      const url = normalizeUrl(data.url);
      // Navigate IN PLACE (update existing tab URL) without making it active, or create in background
      const tab = data.tabId
        ? await call('tabs', 'update', Number(data.tabId), { url })
        : await call('tabs', 'create', { url, active: false });
      navisTabs.set(tab.id, { sessionId: data.sessionId || 'default', createdAt: Date.now() });
      lastActiveTabId = tab.id;
      lastActiveWindowId = tab.windowId;
      await ensureGroup(tab.id);
      await waitForTabLoad(tab.id, 8000).catch(() => {});
      setState({ activeUrl: tab.url || url, activeTitle: tab.title || '' });
      return { success: true, message: 'Navigated tab', stateChanged: true, tab: formatTab(tab), tabId: tab.id, url: tab.url || url, title: tab.title };
    }
    case 'capture':
    case 'navis-capture-active':
      return captureActive(data);
    case 'screenshot':
    case 'navis-screenshot-active': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');

      const RESTRICTED_PAGE_SVG = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1024' height='768' viewBox='0 0 1024 768'%3E%3Crect width='1024' height='768' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='45%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%23374151' font-weight='bold'%3ERestricted Browser Page%3C/text%3E%3Ctext x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16' fill='%236b7280'%3ENavis cannot access internal browser pages (e.g., chrome://, extensions, or about:blank).%3C/text%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16' fill='%233b82f6' font-weight='bold'%3EPlease navigate to a standard website (e.g., use the navigate command) to start automation.%3C/text%3E%3C/svg%3E";
      const CAPTURE_FAILED_SVG = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1024' height='768' viewBox='0 0 1024 768'%3E%3Crect width='1024' height='768' fill='%23fef2f2'/%3E%3Ctext x='50%25' y='45%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%23991b1b' font-weight='bold'%3EScreenshot Capture Failed%3C/text%3E%3Ctext x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16' fill='%237f1d1d'%3EError: The extension lacks permission to capture this tab or the tab is still loading.%3C/text%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='16' fill='%232563eb' font-weight='bold'%3EIf this persists, please try reloading the extension or refreshing the page.%3C/text%3E%3C/svg%3E";

      let dataUrl;
      let targetForm = null;
      let clip = null;

      if (!canInject(tab)) {
        dataUrl = RESTRICTED_PAGE_SVG;
      } else {
        // Hide overlay during capture
        if (state.sessionActive) {
          await runPage(tab.id, 'overlay', { mode: 'hide' }).catch(() => {});
        }

        // 🔑 Form Scope Detection & Highlighting (Token Saver)
        const isFormScope = Boolean(data.scope === 'form' || data.formId || data.targetForm);
        if (isFormScope) {
          const formHighlightRes = await runPage(tab.id, 'draw_form_highlight', {
            formId: data.formId || data.targetForm,
            formName: data.formName
          }).catch(() => null);

          if (formHighlightRes && formHighlightRes.rect) {
            clip = formHighlightRes.rect;
            targetForm = { id: data.formId || 'active_form', rect: clip };
          }
        } else {
          await runPage(tab.id, 'draw_boxes', {}).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 120));

        // Primary capture using debugger with optional clip
        try {
          dataUrl = await captureTabWithDebugger(tab.id, data.quality || 70, clip);
        } catch (dbgErr) {
          console.warn('[Navis Extension] Debugger capture failed, falling back to captureVisibleTab:', dbgErr);
          try {
            if (!tab.active) await call('tabs', 'update', tab.id, { active: true });
            if (tab.windowId) await maybeCall('windows', 'update', tab.windowId, { focused: true });
            await new Promise(resolve => setTimeout(resolve, 80));
            dataUrl = await call('tabs', 'captureVisibleTab', tab.windowId, { format: 'jpeg', quality: data.quality || 70 });
          } catch (visErr) {
            console.error('[Navis Extension] Both capture methods failed:', visErr);
            dataUrl = CAPTURE_FAILED_SVG;
          }
        }

        // Clean up highlights
        if (isFormScope) {
          await runPage(tab.id, 'clear_form_highlight', {}).catch(() => {});
        } else {
          await runPage(tab.id, 'clear_boxes', {}).catch(() => {});
        }

        // Restore overlay
        if (state.sessionActive) {
          const logoUrl = api.runtime.getURL('logos/everfern-rounded.png');
          const isLocked = navisTabs.has(tab.id);
          await runPage(tab.id, 'overlay', { mode: 'show', state: panelState(), logoUrl, locked: isLocked }).catch(() => {});
        }
      }

      return {
        success: true,
        message: targetForm ? `Captured scoped form screenshot (${targetForm.id || 'target'})` : 'Captured tab screenshot',
        stateChanged: false,
        tab: formatTab(tab),
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        scope: targetForm ? 'form' : 'page',
        scopedForm: targetForm,
        dataUrl
      };
    }
    case 'click':
    case 'navis-click-ref': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      return clickLike(tab, { ref: String(data.ref || ''), ...data });
    }
    case 'click_text':
    case 'smart_click': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      return clickLike(tab, data);
    }
    case 'browser_click': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'browser_click', data);
      if (result && result.x != null && result.y != null) {
        lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Click', updatedAt: Date.now() });
        navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });
        
        // 🔑 CDP Trusted Click Fallback
        try {
          await dispatchClickWithDebugger(tab.id, result.x, result.y, data.button || 'left');
        } catch (err) {
          console.warn('[Navis] Debugger trusted browser_click failed:', err);
        }
      }
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'browser_double_click': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'browser_double_click', data);
      if (result && result.x != null && result.y != null) {
        lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Double Click', updatedAt: Date.now() });
        navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });
        
        // 🔑 CDP Trusted Double Click Fallback
        try {
          await dispatchClickWithDebugger(tab.id, result.x, result.y, data.button || 'left', 2);
        } catch (err) {
          console.warn('[Navis] Debugger trusted browser_double_click failed:', err);
        }
      }
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'browser_right_click': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'browser_right_click', data);
      if (result && result.x != null && result.y != null) {
        lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Right Click', updatedAt: Date.now() });
        navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });
        
        // 🔑 CDP Trusted Right Click Fallback
        try {
          await dispatchClickWithDebugger(tab.id, result.x, result.y, 'right', 1);
        } catch (err) {
          console.warn('[Navis] Debugger trusted browser_right_click failed:', err);
        }
      }
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'browser_hover': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'browser_hover', data);
      if (result && result.x != null && result.y != null) {
        lastMouseByTab.set(tab.id, { x: result.x, y: result.y, label: 'Hover', updatedAt: Date.now() });
        navisTabs.set(tab.id, { sessionId: 'default', createdAt: Date.now() });
        
        // 🔑 CDP Trusted Hover Fallback
        try {
          await dispatchHoverWithDebugger(tab.id, result.x, result.y);
        } catch (err) {
          console.warn('[Navis] Debugger trusted browser_hover failed:', err);
        }
      }
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'select_option': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'select', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'input':
    case 'navis-input-ref': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'type', { ref: String(data.ref || ''), text: String(data.text || ''), ...data });
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'smart_type':
    case 'browser_type': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      // Step 1: DOM-based type (focuses, clears with Ctrl+A, sets value, fires React/Vue events)
      const result = await runPage(tab.id, 'type', data);
      // Step 2: 🔑 Also fire CDP trusted Input.insertText for contentEditable apps
      // (Notion, Google Docs, Figma) that check event.isTrusted and ignore synthetic events.
      const text = String(data.text || '');
      if (text) {
        try {
          await dispatchTypeWithDebugger(tab.id, text);
          console.log(`[Navis] ✅ CDP trusted insertText: "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`);
        } catch (err) {
          console.warn('[Navis] CDP insertText failed (non-fatal, DOM path already ran):', err.message || err);
        }
      }
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'press_key': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      // 🔑 Fire CDP trusted key event FIRST (isTrusted=true required for YouTube, video players, etc.)
      // Then also fire DOM synthetic events for React/Vue state updates.
      const key = String(data.key || 'Enter');
      try {
        await dispatchKeyWithDebugger(tab.id, key);
        console.log(`[Navis] ✅ CDP trusted key: ${key}`);
      } catch (err) {
        console.warn(`[Navis] CDP key dispatch failed for key=${key}, falling back to DOM:`, err.message || err);
      }
      const result = await runPage(tab.id, 'press_key', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'scroll': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'scroll', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'wait_for_dom_change': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'wait_dom', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'extract_content': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'extract', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'upload_file': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      
      const refs = lastRefsByTab.get(tab.id) || [];
      const meta = refs.find(r => r.ref === data.ref);
      if (!meta || !meta.backendNodeId) {
        throw new Error(`Could not find element metadata for ref=${data.ref}`);
      }
      
      const rawFiles = data.files || data.file;
      if (!rawFiles) throw new Error('Missing files parameter');
      const filesArray = Array.isArray(rawFiles) ? rawFiles : [String(rawFiles)];

      // Use CDP DOM.setFileInputFiles
      await new Promise((resolve, reject) => {
        const target = { tabId: Number(tab.id) };
        let attachedByUs = false;
        chrome.debugger.attach(target, "1.3", () => {
          const err = chrome.runtime.lastError;
          if (err) {
            if (err.message && err.message.includes("already attached")) {
              setFiles();
              return;
            }
            reject(new Error(`CDP attach failed: ${err.message}`));
            return;
          }
          attachedByUs = true;
          setFiles();
        });

        function setFiles() {
          chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
            files: filesArray,
            backendNodeId: Number(meta.backendNodeId)
          }, () => {
            const cmdErr = chrome.runtime.lastError;
            if (attachedByUs) chrome.debugger.detach(target, () => {});
            if (cmdErr) reject(new Error(`CDP setFileInputFiles failed: ${cmdErr.message}`));
            else resolve();
          });
        }
      });

      return { success: true, message: `Uploaded files to ref=${data.ref}`, stateChanged: true, tabId: tab.id };
    }
    case 'go_back': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'go_back', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'dismiss_popups': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      const result = await runPage(tab.id, 'dismiss_popups', data);
      return { tabId: tab.id, url: tab.url, title: tab.title, ...result };
    }
    case 'close_tab': {
      const tab = await getTargetTab(data.tabId);
      if (!tab || !tab.id) throw new Error('No active tab available');
      await call('tabs', 'remove', tab.id);
      return { success: true, message: 'Closed tab', stateChanged: true, tabId: tab.id };
    }
    default:
      throw new Error(`Unknown Navis extension command: ${command}`);
  }
}

api.runtime.onInstalled?.addListener(connect);
api.runtime.onStartup?.addListener(connect);
api.runtime.onConnect.addListener(port => {
  if (port.name !== 'navis-panel') return;
  panelPorts.add(port);
  port.postMessage({ type: 'state', state: panelState() });
  port.onMessage.addListener(async message => {
    if (!message || message.type === 'refresh_state') {
      port.postMessage({ type: 'state', state: panelState() });
      return;
    }
    if (message.type === 'capture_active') {
      try {
        const result = await captureActive({});
        rememberEvent({ type: 'step', content: 'Captured active tab DOM from the Navis panel.', metadata: { url: result.url, title: result.title, refs: result.refs.length } });
        port.postMessage({ type: 'capture-result', data: result, state: panelState() });
      } catch (error) {
        port.postMessage({ type: 'panel-error', error: String(error && error.message || error), state: panelState() });
      }
      return;
    }
    if (message.type === 'clear_feed') clearEvents();
  });
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type === 'get-state') {
    sendResponse(panelState());
    return true;
  }
  if (message.type === 'open-overlay') {
    syncOverlay('toggle').then(() => sendResponse({ success: true, state: panelState() })).catch(error => sendResponse({ success: false, error: String(error && error.message || error), state: panelState() }));
    return true;
  }
  if (message.type === 'capture-active') {
    captureActive({}).then(result => {
      rememberEvent({ type: 'step', content: 'Captured active tab DOM from the popup.', metadata: { url: result.url, title: result.title, refs: result.refs.length } });
      sendResponse({ success: true, data: result, state: panelState() });
    }).catch(error => sendResponse({ success: false, error: String(error && error.message || error), state: panelState() }));
    return true;
  }
  if (message.type === 'clear-feed') {
    clearEvents();
    sendResponse({ success: true, state: panelState() });
    return true;
  }
  return false;
});

if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener(() => syncOverlay('toggle').catch(() => {}));
}
if (api.sidePanel && api.sidePanel.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isTracked = navisTabs.has(tabId) || (tab && tab.url && tab.url.includes('navis=true'));
  if (isTracked) navisTabs.set(tabId, { sessionId: 'default', createdAt: Date.now() });
  if (isTracked && (changeInfo.status === 'complete' || changeInfo.url)) {
    setState({ activeUrl: tab && tab.url || state.activeUrl, activeTitle: tab && tab.title || state.activeTitle });
    ensureGroup(tabId);
    if (state.sessionActive) syncOverlay('show').catch(() => {});
  }
  if ((changeInfo.status === 'loading' || changeInfo.status === 'complete') && lastMouseByTab.has(tabId)) {
    const point = lastMouseByTab.get(tabId);
    if (state.sessionActive) {
      const isLocked = navisTabs.has(tabId);
      runPage(tabId, 'overlay', { mode: 'show', state: panelState(), locked: isLocked }).catch(() => {});
    }
    runPage(tabId, 'mouse', {
      x: point.x,
      y: point.y,
      label: changeInfo.status === 'loading' ? 'Loading' : 'Click',
      durationMs: changeInfo.status === 'loading' ? 2200 : 5200,
    }).catch(() => {});
  }
});

// 🔒 TAB LOCK: If the user tries to interact with a Navis-controlled tab, show a locked notice
api.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId, windowId } = activeInfo;
  // If a navis tab is becoming active AND a session is running, it means the user clicked on it.
  // Show the locked overlay so they know the AI controls this tab.
  if (state.sessionActive && navisTabs.has(tabId)) {
    try {
      const logoUrl = api.runtime.getURL('logos/everfern-rounded.png');
      await runPage(tabId, 'overlay', { mode: 'show', state: panelState(), logoUrl, locked: true }).catch(() => {});
    } catch {}
  }
  // Update the user's tab if it's NOT a navis tab (so we always know where the user is)
  if (!navisTabs.has(tabId)) {
    userTabId = tabId;
    userWindowId = windowId;
  }
});

api.alarms?.onAlarm?.addListener(alarm => {
  if (alarm.name === 'navis-bridge-keepalive') connect();
});
api.alarms?.create?.('navis-bridge-keepalive', { periodInMinutes: 0.5 });

function keepAlive() {
  if (api.runtime && typeof api.runtime.getPlatformInfo === 'function') {
    api.runtime.getPlatformInfo(() => {});
  }
  if (socket && socket.readyState === 1) {
    try {
      socket.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
    } catch (e) {}
  }
}
setInterval(keepAlive, 15000);

// Use a safe asynchronous connect to prevent synchronous network exceptions during registration
setTimeout(() => {
  try {
    connect();
  } catch (err) {
    console.error('[Navis Extension] Failed to execute connect on startup:', err);
  }
}, 100);

