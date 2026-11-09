/**
 * A stand-in for the `electron` module so EverFern's existing main process
 * (dist-electron/main) runs in plain Node as the Tauri app's sidecar.
 *
 * - ipcMain is served over a local WebSocket that the Tauri webview connects
 *   to (see tauri/bridge/renderer-bridge.js).
 * - webContents.send() becomes an event pushed to that webview.
 * - Things only the shell can do (window controls, dialogs, opening links,
 *   notifications, global shortcuts) are sent to the webview as "shell"
 *   requests, which it carries out with the Tauri JS API.
 * - Anything not implemented yet is a harmless no-op, so the main process
 *   keeps booting while features are ported.
 */
'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const log = (...a) => process.stderr.write(`[sidecar] ${a.join(' ')}\n`);
const DEBUG = process.env.EF_SIDECAR_DEBUG === '1';

// ── Wire format: JSON, with binary data as base64 ──────────────────────────
function encode(value) {
  return JSON.stringify(value, function (key, v) {
    const raw = this[key];
    if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) return { __ef_bin: Buffer.from(raw).toString('base64') };
    if (raw instanceof ArrayBuffer) return { __ef_bin: Buffer.from(raw).toString('base64') };
    if (raw instanceof Map) return Object.fromEntries(raw);
    if (raw instanceof Set) return Array.from(raw);
    if (raw instanceof Error) return { message: raw.message, name: raw.name, stack: raw.stack };
    if (typeof raw === 'bigint') return raw.toString();
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return { __ef_bin: Buffer.from(v.data).toString('base64') };
    return v;
  });
}
function decode(text) {
  return JSON.parse(text, (_k, v) => (v && typeof v === 'object' && typeof v.__ef_bin === 'string' ? Buffer.from(v.__ef_bin, 'base64') : v));
}

// A no-op object for APIs that are not ported yet (session, Menu, Tray...).
function inert(name) {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => `[inert ${name}]`;
      if (prop === 'then') return undefined; // never look like a promise
      if (prop === 'toString') return () => `[inert ${name}]`;
      return proxy;
    },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

// ── Transport ──────────────────────────────────────────────────────────────
const TOKEN = process.env.EF_SIDECAR_TOKEN || crypto.randomBytes(16).toString('hex');
const clients = new Set();
const pendingShell = new Map();
const outbox = []; // messages queued until the webview connects
let shellSeq = 0;
let readyResolve;
const rendererReady = new Promise((r) => (readyResolve = r));

function broadcast(msg) {
  const text = encode(msg);
  if (clients.size === 0) { outbox.push(text); if (outbox.length > 2000) outbox.shift(); return; }
  for (const ws of clients) if (ws.readyState === 1) ws.send(text);
}

/** Ask the webview to do something only the Tauri shell can do. */
function shell(op, ...args) {
  const id = ++shellSeq;
  return new Promise((resolve) => {
    pendingShell.set(id, resolve);
    broadcast({ t: 'shell', id, op, args });
    setTimeout(() => { if (pendingShell.delete(id)) resolve(undefined); }, op === 'cloudRequest' ? 155000 : 10 * 60 * 1000);
  });
}

const ipcMain = new EventEmitter();
ipcMain.setMaxListeners(500);
const handlers = new Map();
ipcMain.handle = (ch, fn) => { handlers.set(ch, fn); };
ipcMain.handleOnce = (ch, fn) => { handlers.set(ch, async (...a) => { handlers.delete(ch); return fn(...a); }); };
ipcMain.removeHandler = (ch) => { handlers.delete(ch); };

function startServer() {
  const port = Number(process.env.EF_SIDECAR_PORT || 0);
  const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 512 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.searchParams.get('token') !== TOKEN) { ws.close(4001, 'bad token'); return; }
    clients.add(ws);
    log('webview connected');
    for (const text of outbox.splice(0)) ws.send(text);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => onMessage(ws, data.toString()));
    if (clients.size === 1) {
      readyResolve();
      for (const w of windows) if (w._isMain) w._rendererConnected();
    }
  });
  wss.on('listening', () => {
    const actual = wss.address().port;
    // The Tauri shell waits for this exact line.
    process.__efControlWrite(`EF_SIDECAR_READY ${actual} ${TOKEN}\n`);
  });
}

function makeEvent(ws) {
  return {
    sender: mainWebContents(),
    senderFrame: { url: '' },
    frameId: 0,
    processId: 0,
    returnValue: undefined,
    reply: (channel, ...args) => ws.send(encode({ t: 'event', channel, args })),
    preventDefault() {},
  };
}

async function onMessage(ws, text) {
  let msg;
  try { msg = decode(text); } catch { return; }
  if (DEBUG && (msg.t === 'invoke' || msg.t === 'send')) log(`${msg.t} ${msg.channel}`);
  if (msg.t === 'invoke') {
    const fn = handlers.get(msg.channel);
    if (!fn) {
      ws.send(encode({ t: 'result', id: msg.id, ok: false, error: `No handler registered for '${msg.channel}'` }));
      return;
    }
    try {
      const value = await fn(makeEvent(ws), ...(msg.args || []));
      ws.send(encode({ t: 'result', id: msg.id, ok: true, value }));
    } catch (e) {
      ws.send(encode({ t: 'result', id: msg.id, ok: false, error: (e && e.message) || String(e) }));
    }
  } else if (msg.t === 'send') {
    ipcMain.emit(msg.channel, makeEvent(ws), ...(msg.args || []));
  } else if (msg.t === 'shell-result') {
    const resolve = pendingShell.get(msg.id);
    if (resolve) { pendingShell.delete(msg.id); resolve(msg.value); }
  } else if (msg.t === 'window-state') {
    const w = mainWindow();
    if (w) Object.assign(w._state, msg.state || {});
    if (w && msg.event) w.emit(msg.event);
  } else if (msg.t === 'shortcut') {
    const cb = shortcuts.get(msg.accelerator);
    if (cb) try { cb(); } catch (e) { log('shortcut error', e.message); }
  } else if (msg.t === 'deep-link') {
    app.emit('open-url', { preventDefault() {} }, msg.url);
    app.emit('second-instance', {}, [process.execPath, msg.url], process.cwd());
  } else if (msg.t === 'close-requested') {
    const w = mainWindow();
    if (w) w.close(); else app.quit();
  } else if (msg.t === 'quit') {
    app.quit();
  }
}

// ── app ────────────────────────────────────────────────────────────────────
const pkg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.EF_APP_PATH || process.cwd(), 'package.json'), 'utf8')); } catch { return {}; }
})();

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

const isPackaged = process.env.EF_PACKAGED === '1';
// Same folder Electron used, so existing users keep their data after moving to Tauri.
const appName = isPackaged ? (pkg.build && pkg.build.productName) || 'EverFern' : pkg.name || 'EverFern';
const userData = process.env.EF_USER_DATA || path.join(appDataDir(), appName);
const paths = {
  home: os.homedir(),
  appData: appDataDir(),
  userData,
  sessionData: userData,
  temp: os.tmpdir(),
  exe: process.execPath,
  module: process.execPath,
  desktop: path.join(os.homedir(), 'Desktop'),
  documents: path.join(os.homedir(), 'Documents'),
  downloads: path.join(os.homedir(), 'Downloads'),
  music: path.join(os.homedir(), 'Music'),
  pictures: path.join(os.homedir(), 'Pictures'),
  videos: path.join(os.homedir(), 'Videos'),
  logs: path.join(userData, 'logs'),
  crashDumps: path.join(userData, 'Crashpad'),
  recent: os.homedir(),
};

const app = new EventEmitter();
app.setMaxListeners(200);
let quitting = false;
Object.assign(app, {
  name: appName,
  isPackaged,
  commandLine: { appendSwitch() {}, appendArgument() {}, hasSwitch: () => false, getSwitchValue: () => '' },
  getName: () => appName,
  setName() {},
  getVersion: () => process.env.EF_APP_VERSION || pkg.version || '0.0.0',
  getAppPath: () => process.env.EF_APP_PATH || process.cwd(),
  getPath: (n) => paths[n] || userData,
  setPath: (n, p) => { paths[n] = p; },
  getLocale: () => Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
  getSystemLocale: () => Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
  isReady: () => true,
  whenReady: () => Promise.resolve(),
  requestSingleInstanceLock: () => true, // the Tauri single-instance plugin owns this
  hasSingleInstanceLock: () => true,
  releaseSingleInstanceLock() {},
  setAppUserModelId() {},
  setAsDefaultProtocolClient: () => true,
  removeAsDefaultProtocolClient: () => true,
  isDefaultProtocolClient: () => true,
  setLoginItemSettings() {},
  getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: process.argv.includes('--autostart') }),
  focus() { shell('window', 'focus'); },
  show() { shell('window', 'show'); },
  hide() { shell('window', 'hide'); },
  setBadgeCount() { return true; },
  getGPUFeatureStatus: () => ({}),
  disableHardwareAcceleration() {},
  relaunch() { shell('relaunch'); },
  quit() {
    if (quitting) return;
    const ev = { _prevented: false, preventDefault() { this._prevented = true; } };
    app.emit('before-quit', ev);
    if (ev._prevented) return; // the handler will call app.exit() itself
    quitting = true;
    app.emit('will-quit', { preventDefault() {} });
    app.exit(0);
  },
  exit(code = 0) {
    quitting = true;
    broadcast({ t: 'shell', id: 0, op: 'exit', args: [code] });
    setTimeout(() => process.exit(code), 150);
  },
  dock: inert('app.dock'),
});
// Electron fires these once the app is up.
setImmediate(() => { app.emit('will-finish-launching'); app.emit('ready', {}, {}); });

// ── BrowserWindow / webContents ────────────────────────────────────────────
const windows = [];
let nextId = 1;

class WebContents extends EventEmitter {
  constructor(win) {
    super();
    this.setMaxListeners(200);
    this._win = win;
    this.id = win.id;
    this.session = session.defaultSession;
    this._url = '';
  }
  send(channel, ...args) {
    // Only the main window has a real webview. Overlay windows are not ported yet.
    if (this._win._isMain && !this._win._destroyed) broadcast({ t: 'event', channel, args });
  }
  isDestroyed() { return this._win._destroyed; }
  isLoading() { return false; }
  isCrashed() { return false; }
  getURL() { return this._url; }
  getTitle() { return 'EverFern'; }
  loadURL(u) { this._url = u; return Promise.resolve(); }
  loadFile(f) { this._url = `file://${f}`; return Promise.resolve(); }
  reload() { if (this._win._isMain) shell('reload'); }
  reloadIgnoringCache() { this.reload(); }
  openDevTools() { if (this._win._isMain) shell('devtools'); }
  closeDevTools() {}
  isDevToolsOpened() { return false; }
  toggleDevTools() { this.openDevTools(); }
  executeJavaScript(code) { return this._win._isMain ? shell('eval', String(code)) : Promise.resolve(undefined); }
  insertCSS() { return Promise.resolve(''); }
  setWindowOpenHandler() {}
  setZoomFactor() {}
  getZoomFactor() { return 1; }
  setZoomLevel() {}
  setBackgroundThrottling() {}
  setAudioMuted() {}
  setUserAgent() {}
  getUserAgent() { return 'EverFern'; }
  capturePage() { return Promise.resolve(nativeImage.createEmpty()); }
  focus() { if (this._win._isMain) shell('window', 'focus'); }
  print() {}
  printToPDF() { return Promise.reject(new Error('printToPDF is not available in the Tauri build yet')); }
  getOSProcessId() { return process.pid; }
  postMessage() {}
  get mainFrame() { return { url: this._url, executeJavaScript: (c) => this.executeJavaScript(c), on() {}, once() {} }; }
  get debugger() { return inert('debugger'); }
}

class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.setMaxListeners(200);
    this.id = nextId++;
    this._opts = opts;
    this._isMain = false;
    this._destroyed = false;
    this._state = { visible: opts.show !== false, maximized: false, minimized: false, focused: false, fullscreen: false, alwaysOnTop: !!opts.alwaysOnTop };
    this._bounds = { x: opts.x || 0, y: opts.y || 0, width: opts.width || 800, height: opts.height || 600 };
    this.webContents = new WebContents(this);
    windows.push(this);
  }
  static getAllWindows() { return windows.filter((w) => !w._destroyed); }
  static getFocusedWindow() { const m = mainWindow(); return m && m._state.focused ? m : null; }
  static fromWebContents(wc) { return (wc && wc._win) || mainWindow(); }
  static fromId(id) { return windows.find((w) => w.id === id) || null; }

  _markMain() {
    if (this._isMain) return;
    for (const w of windows) w._isMain = false;
    this._isMain = true;
    if (clients.size) this._rendererConnected();
  }
  _rendererConnected() {
    setImmediate(() => {
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
      this.emit('ready-to-show');
    });
  }
  _op(op, ...args) { if (this._isMain && !this._destroyed) shell('window', op, ...args); }

  loadURL(u) { return this.webContents.loadURL(u); }
  loadFile(f) { return this.webContents.loadFile(f); }
  show() { this._state.visible = true; this._op('show'); }
  showInactive() { this.show(); }
  hide() { this._state.visible = false; this._op('hide'); }
  focus() { this._state.focused = true; this._op('focus'); }
  blur() {}
  minimize() { this._state.minimized = true; this._op('minimize'); }
  restore() { this._state.minimized = false; this._op('unminimize'); }
  maximize() { this._state.maximized = true; this._op('maximize'); }
  unmaximize() { this._state.maximized = false; this._op('unmaximize'); }
  setFullScreen(v) { this._state.fullscreen = !!v; this._op('setFullscreen', !!v); }
  close() {
    if (!this._isMain) { this.destroy(); return; }
    const ev = { _p: false, preventDefault() { this._p = true; } };
    this.emit('close', ev);
    if (!ev._p) this._op('close');
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.emit('closed');
    this.webContents.emit('destroyed');
  }
  isDestroyed() { return this._destroyed; }
  isVisible() { return this._state.visible; }
  isFocused() { return this._state.focused; }
  isMinimized() { return this._state.minimized; }
  isMaximized() { return this._state.maximized; }
  isFullScreen() { return this._state.fullscreen; }
  isAlwaysOnTop() { return this._state.alwaysOnTop; }
  isResizable() { return true; }
  isMovable() { return true; }
  isEnabled() { return true; }
  setTitle(t) { this._op('setTitle', String(t)); }
  getTitle() { return 'EverFern'; }
  setAlwaysOnTop(v) { this._state.alwaysOnTop = !!v; this._op('setAlwaysOnTop', !!v); }
  setBounds(b) { Object.assign(this._bounds, b); }
  getBounds() { return { ...this._bounds }; }
  getContentBounds() { return { ...this._bounds }; }
  setSize(w, h) { this._bounds.width = w; this._bounds.height = h; }
  getSize() { return [this._bounds.width, this._bounds.height]; }
  getContentSize() { return this.getSize(); }
  setPosition(x, y) { this._bounds.x = x; this._bounds.y = y; }
  getPosition() { return [this._bounds.x, this._bounds.y]; }
  center() {}
  setMinimumSize() {}
  setMaximumSize() {}
  setResizable() {}
  setMovable() {}
  setSkipTaskbar() {}
  setIgnoreMouseEvents() {}
  setFocusable() {}
  setOpacity() {}
  setBackgroundColor() {}
  setIcon() {}
  setMenu() {}
  setMenuBarVisibility() {}
  setAutoHideMenuBar() {}
  removeMenu() {}
  setVisibleOnAllWorkspaces() {}
  setContentProtection() {}
  setProgressBar() {}
  setOverlayIcon() {}
  setThumbarButtons() { return true; }
  flashFrame(v) { if (v) this._op('requestAttention'); }
  moveTop() {}
  getNativeWindowHandle() { return Buffer.alloc(8); }
  setVibrancy() {}
  setBackgroundMaterial() {}
  setWindowButtonVisibility() {}
}

function mainWindow() { return windows.find((w) => w._isMain && !w._destroyed) || null; }
function mainWebContents() { const w = mainWindow(); return w ? w.webContents : null; }

// main.ts publishes its window as global.mainWindow; use that to pick the real one.
let _globalMain;
Object.defineProperty(global, 'mainWindow', {
  configurable: true,
  get: () => _globalMain,
  set: (w) => { _globalMain = w; if (w && w instanceof BrowserWindow) w._markMain(); },
});

const webContents = {
  getAllWebContents: () => windows.filter((w) => !w._destroyed).map((w) => w.webContents),
  getFocusedWebContents: () => mainWebContents(),
  fromId: (id) => { const w = windows.find((x) => x.id === id); return w ? w.webContents : undefined; },
};

// ── Shell-backed APIs ──────────────────────────────────────────────────────
function openWithOS(target) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    return '';
  } catch (e) { return e.message; }
}

const shellApi = {
  openExternal: async (url) => { const r = await shell('openUrl', String(url)); if (r === undefined) openWithOS(String(url)); },
  openPath: async (p) => openWithOS(String(p)),
  showItemInFolder: (p) => {
    if (process.platform === 'win32') spawn('explorer.exe', ['/select,', String(p)], { detached: true, stdio: 'ignore' }).unref();
    else openWithOS(path.dirname(String(p)));
  },
  beep() {},
  trashItem: async (p) => { await fs.promises.rm(String(p), { recursive: true, force: true }); },
  writeShortcutLink: () => false,
  readShortcutLink: () => ({}),
};

const dialog = {
  showOpenDialog: async (_w, o) => {
    const opts = (o || (_w && !(_w instanceof BrowserWindow) ? _w : {})) || {};
    const props = opts.properties || [];
    const r = await shell('dialogOpen', {
      title: opts.title,
      defaultPath: opts.defaultPath,
      directory: props.includes('openDirectory'),
      multiple: props.includes('multiSelections'),
      filters: (opts.filters || []).map((f) => ({ name: f.name, extensions: f.extensions })),
    });
    const filePaths = r == null ? [] : Array.isArray(r) ? r : [r];
    return { canceled: filePaths.length === 0, filePaths };
  },
  showSaveDialog: async (_w, o) => {
    const opts = (o || (_w && !(_w instanceof BrowserWindow) ? _w : {})) || {};
    const r = await shell('dialogSave', { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters || [] });
    return { canceled: !r, filePath: r || undefined };
  },
  showMessageBox: async (_w, o) => {
    const opts = (o || (_w && !(_w instanceof BrowserWindow) ? _w : {})) || {};
    const r = await shell('messageBox', { title: opts.title, message: [opts.message, opts.detail].filter(Boolean).join('\n\n'), buttons: opts.buttons || ['OK'], type: opts.type });
    return { response: typeof r === 'number' ? r : 0, checkboxChecked: false };
  },
  showErrorBox: (title, content) => { shell('messageBox', { title, message: content, buttons: ['OK'], type: 'error' }); },
  showOpenDialogSync: () => undefined,
  showSaveDialogSync: () => undefined,
  showMessageBoxSync: () => 0,
};

class Notification extends EventEmitter {
  constructor(opts = {}) { super(); this.opts = opts; }
  static isSupported() { return true; }
  show() { shell('notify', { title: this.opts.title || 'EverFern', body: this.opts.body || '' }).then(() => this.emit('show')); }
  close() {}
}

const shortcuts = new Map();
const globalShortcut = {
  register(accel, cb) { shortcuts.set(accel, cb); shell('shortcutRegister', accel); return true; },
  registerAll(accels, cb) { accels.forEach((a) => this.register(a, cb)); },
  isRegistered: (accel) => shortcuts.has(accel),
  unregister(accel) { shortcuts.delete(accel); shell('shortcutUnregister', accel); },
  unregisterAll() { for (const a of shortcuts.keys()) shell('shortcutUnregister', a); shortcuts.clear(); },
};

function clipboardRead() {
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', windowsHide: true }).replace(/\r?\n$/, '');
    if (process.platform === 'darwin') return execFileSync('pbpaste', { encoding: 'utf8' });
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' });
  } catch { return ''; }
}
function clipboardWrite(text) {
  try {
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', '$input | Set-Clipboard'], { input: String(text), windowsHide: true });
    else if (process.platform === 'darwin') execFileSync('pbcopy', { input: String(text) });
    else execFileSync('xclip', ['-selection', 'clipboard'], { input: String(text) });
  } catch { /* ignore */ }
}
const clipboard = {
  readText: clipboardRead,
  writeText: clipboardWrite,
  readHTML: () => '',
  writeHTML: (h) => clipboardWrite(h),
  readImage: () => nativeImage.createEmpty(),
  writeImage() {},
  clear: () => clipboardWrite(''),
  availableFormats: () => ['text/plain'],
  write: (d) => d && d.text != null && clipboardWrite(d.text),
};

// ── Display info (the webview reports the real values when it connects) ─────
const displayInfo = { width: 1920, height: 1080, scaleFactor: 1 };
const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: displayInfo.width, height: displayInfo.height },
    workArea: { x: 0, y: 0, width: displayInfo.width, height: displayInfo.height - 48 },
    size: { width: displayInfo.width, height: displayInfo.height },
    workAreaSize: { width: displayInfo.width, height: displayInfo.height - 48 },
    scaleFactor: displayInfo.scaleFactor,
    rotation: 0,
  }),
  getAllDisplays() { return [this.getPrimaryDisplay()]; },
  getDisplayNearestPoint() { return this.getPrimaryDisplay(); },
  getDisplayMatching() { return this.getPrimaryDisplay(); },
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  dipToScreenPoint: (p) => p,
  screenToDipPoint: (p) => p,
});
rendererReady.then(async () => {
  const d = await shell('display');
  if (d && d.width) Object.assign(displayInfo, d);
  if (DEBUG) {
    // Self-test: is the bridge in the page, and does a round trip through ipcMain work?
    const probe = await shell('eval', `(async () => {
      const api = window.electronAPI;
      if (!api) return { bridge: !!window.__EF_BRIDGE__, electronAPI: false, href: location.href };
      let roundTrip;
      try { roundTrip = typeof (await api.window.isMaximized()); } catch (e) { roundTrip = 'error: ' + e.message; }
      return { bridge: true, electronAPI: Object.keys(api).length, tauri: !!window.__TAURI__, roundTrip, href: location.href };
    })()`);
    log('self-test', JSON.stringify(probe));
    if (process.env.EF_SIDECAR_CHAT_TEST === '1') {
      // End-to-end chat: renderer -> acp:stream -> model -> acp:stream-chunk events -> renderer.
      const chat = await shell('eval', `(async () => {
        const acp = window.electronAPI && window.electronAPI.acp;
        if (!acp) return { error: 'no acp api' };
        let health; try { health = await acp.healthCheck(); } catch (e) { health = 'error: ' + e.message; }
        let chunks = 0, text = '';
        const off = acp.onStreamChunk((c) => { chunks++; if (c && c.delta) text += c.delta; });
        const t0 = Date.now();
        let res;
        try {
          const id = 'tauri-smoke-' + t0;
          res = await acp.stream({ conversationId: id, assistantMessageId: id + '-a',
            messages: [{ role: 'user', content: 'Reply with exactly: hello from tauri' }] });
        } catch (e) { res = { error: e.message }; }
        if (typeof off === 'function') off();
        return { health, chunks, text: text.slice(0, 200), error: res && res.error, ms: Date.now() - t0 };
      })()`);
      log('chat-test', JSON.stringify(chat));
    }
  }
});

// ── nativeImage (enough for icons and screenshots) ─────────────────────────
function makeImage(buf, size) {
  const data = buf || Buffer.alloc(0);
  return {
    isEmpty: () => data.length === 0,
    toPNG: () => data,
    toJPEG: () => data,
    toBitmap: () => data,
    getBitmap: () => data,
    toDataURL: () => (data.length ? `data:image/png;base64,${data.toString('base64')}` : ''),
    getSize: () => size || { width: 0, height: 0 },
    getAspectRatio: () => 1,
    resize() { return this; },
    crop() { return this; },
    setTemplateImage() {},
    isTemplateImage: () => false,
    addRepresentation() {},
  };
}
const nativeImage = {
  createEmpty: () => makeImage(),
  createFromPath: (p) => { try { return makeImage(fs.readFileSync(p)); } catch { return makeImage(); } },
  createFromBuffer: (b) => makeImage(Buffer.from(b)),
  createFromDataURL: (u) => makeImage(Buffer.from(String(u).split(',')[1] || '', 'base64')),
  createFromBitmap: (b, o) => makeImage(Buffer.from(b), o),
};

// ── Not ported yet: harmless stand-ins ─────────────────────────────────────
const session = { defaultSession: inert('session.defaultSession'), fromPartition: () => inert('session'), fromPath: () => inert('session') };
const desktopCapturer = { getSources: async () => [] };
const powerMonitor = Object.assign(new EventEmitter(), { getSystemIdleTime: () => 0, getSystemIdleState: () => 'active', isOnBatteryPower: () => false, onBatteryPower: false });
const powerSaveBlocker = { start: () => 1, stop() {}, isStarted: () => false };
const systemPreferences = Object.assign(new EventEmitter(), {
  getMediaAccessStatus: () => 'granted',
  askForMediaAccess: async () => true,
  isTrustedAccessibilityClient: () => true,
  getAccentColor: () => '0078d4ff',
  getColor: () => '#000000',
  isDarkMode: () => true,
  getUserDefault: () => undefined,
  subscribeNotification: () => 0,
  unsubscribeNotification() {},
});
const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: true, themeSource: 'system', shouldUseHighContrastColors: false });
const safeStorage = {
  isEncryptionAvailable: () => process.platform === 'win32' && !!process.env.EF_NATIVE_EXE,
  encryptString: (s) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
    const encrypted = execFileSync(process.env.EF_NATIVE_EXE, ['--ef-encrypt'], { input: Buffer.from(String(s)), windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
    return Buffer.concat([Buffer.from('EFDPAPI1'), encrypted]);
  },
  decryptString: (b) => {
    const bytes = Buffer.from(b);
    if (!safeStorage.isEncryptionAvailable() || !bytes.subarray(0, 8).equals(Buffer.from('EFDPAPI1'))) {
      throw new Error('Legacy credential needs migration through the Electron bridge release');
    }
    return execFileSync(process.env.EF_NATIVE_EXE, ['--ef-decrypt'], { input: bytes.subarray(8), windowsHide: true, maxBuffer: 40 * 1024 * 1024 }).toString('utf8');
  },
};
const protocol = { registerSchemesAsPrivileged() {}, handle() {}, unhandle() {}, isProtocolHandled: () => false, registerFileProtocol: () => true, registerBufferProtocol: () => true, registerStringProtocol: () => true, registerHttpProtocol: () => true, interceptFileProtocol: () => true };
const net = { fetch: (...a) => fetch(...a), isOnline: () => true, online: true, request: inert('net.request') };

class Tray extends EventEmitter {
  constructor() { super(); } // the Tauri shell draws the real tray icon
  setToolTip() {} setContextMenu() {} setImage() {} setTitle() {} destroy() {} isDestroyed() { return false; }
  displayBalloon() {} popUpContextMenu() {} closeContextMenu() {} getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
}
class MenuItem { constructor(o) { Object.assign(this, o); } }
class Menu {
  constructor() { this.items = []; }
  static buildFromTemplate(t) { const m = new Menu(); m.items = (t || []).map((i) => new MenuItem(i)); return m; }
  static setApplicationMenu() {}
  static getApplicationMenu() { return null; }
  append(i) { this.items.push(i); }
  insert(pos, i) { this.items.splice(pos, 0, i); }
  popup() {}
  closePopup() {}
  getMenuItemById(id) { return this.items.find((i) => i.id === id) || null; }
}
class BrowserView { constructor() { this.webContents = new WebContents({ id: 0, _isMain: false, _destroyed: false }); } setBounds() {} setAutoResize() {} setBackgroundColor() {} }
class WebContentsView extends BrowserView { constructor() { super(); this.webContents = new WebContents({ id: 0, _isMain: false, _destroyed: false }); } }

const crashReporter = { start() {}, getLastCrashReport: () => null, getUploadedReports: () => [] };
const autoUpdater = inert('autoUpdater');

module.exports = {
  app, ipcMain, BrowserWindow, BrowserView, WebContentsView, webContents, shell: shellApi, dialog, Notification,
  globalShortcut, clipboard, screen, nativeImage, session, desktopCapturer, powerMonitor, powerSaveBlocker,
  systemPreferences, nativeTheme, safeStorage, protocol, net, Tray, Menu, MenuItem, crashReporter, autoUpdater,
  // contextBridge / ipcRenderer are renderer-only and must stay undefined here
  // (electron-log, for one, treats their presence as "running in a preload").
  // Internal hooks for boot.js
  __ef: { startServer, shell, broadcast, rendererReady,
    nativeCloudRequest: async (path, token, body) => {
      const response = await shell('cloudRequest', { path, token, body });
      if (!response || !Number.isInteger(response.status)) throw new Error('Native cloud transport disconnected');
      return response;
    },
  },
};
module.exports.default = module.exports;
