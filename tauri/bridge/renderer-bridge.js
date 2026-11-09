/**
 * Runs in the Tauri webview before the app's own scripts.
 *
 * It recreates what Electron's preload gave the page: a `window.electronAPI`
 * built by running the unchanged compiled preload (dist-electron/preload) with
 * a small browser-side `electron` module whose ipcRenderer talks to the Node
 * sidecar over a WebSocket. It also carries out "shell" requests from the
 * sidecar (window controls, dialogs, links, notifications, shortcuts) using
 * the Tauri JS API.
 *
 * src-tauri/build.rs splices the compiled preload in at the marker below.
 */
(function () {
  'use strict';
  if (window.__EF_BRIDGE__) return;
  window.__EF_BRIDGE__ = true;

  var cfg = window.__EF_SIDECAR__ || {};
  var T = function () { return window.__TAURI__ || {}; };
  var invokeRust = function (cmd, args) {
    var core = T().core;
    return core ? core.invoke(cmd, args || {}) : Promise.reject(new Error('Tauri core API missing'));
  };

  // ── Wire format (same as tauri/sidecar/electron-shim.js) ──────────────────
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function encode(v) {
    return JSON.stringify(v, function (k, val) {
      var raw = this[k];
      if (raw instanceof ArrayBuffer) return { __ef_bin: b64(new Uint8Array(raw)) };
      if (ArrayBuffer.isView(raw)) return { __ef_bin: b64(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) };
      if (raw instanceof Map) return Object.fromEntries(raw);
      if (raw instanceof Set) return Array.from(raw);
      if (raw instanceof Error) return { message: raw.message, name: raw.name };
      return val;
    });
  }
  function decode(text) {
    return JSON.parse(text, function (_k, v) {
      if (v && typeof v === 'object' && typeof v.__ef_bin === 'string') {
        var bin = atob(v.__ef_bin), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      return v;
    });
  }

  // ── Socket to the sidecar, with a queue while (re)connecting ──────────────
  var ws = null, open = false, queue = [], seq = 0, pending = new Map(), retry = 0;
  function connect() {
    if (!cfg.port) { console.error('[EverFern] sidecar port missing'); return; }
    ws = new WebSocket('ws://127.0.0.1:' + cfg.port + '/?token=' + encodeURIComponent(cfg.token || ''));
    ws.onopen = function () {
      open = true; retry = 0;
      var q = queue; queue = [];
      q.forEach(function (m) { ws.send(m); });
      reportWindowState();
    };
    ws.onmessage = function (e) { onMessage(decode(e.data)); };
    ws.onclose = function () {
      open = false;
      pending.forEach(function (p) { p.reject(new Error('EverFern background process disconnected')); });
      pending.clear();
      setTimeout(connect, Math.min(5000, 200 * Math.pow(2, retry++)));
    };
  }
  function post(msg) {
    var text = encode(msg);
    if (open) ws.send(text); else queue.push(text);
  }

  // ── Browser-side `electron` module for the preload ────────────────────────
  var listeners = new Map(); // channel -> [{ fn, wrapped }]
  var fakeEvent = { sender: null, senderId: 0, ports: [] };
  var ipcRenderer = {
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (cfg.platform === 'win32' && ['workers:vm-status', 'workers:vm-exec', 'workers:vm-ls'].indexOf(channel) !== -1) {
        return invokeRust('ef_local_vm', { operation: channel.slice('workers:vm-'.length), worker: args[0] || null, command: args[1] || null });
      }
      if (channel === 'system:get-update-status') return Promise.resolve(nativeUpdateStatus);
      if (channel === 'system:check-for-updates') return invokeRust('ef_update', { install: false }).catch(function (error) {
        nativeUpdateStatus.status = 'error'; nativeUpdateStatus.errorMsg = String(error);
        emitEvent('update-error', [String(error)]);
        return { hasUpdate: false, error: String(error) };
      });
      if (channel === 'restart-and-update') return invokeRust('ef_update', { install: true });
      if (channel === 'workers:list' || channel === 'workers:save' || channel === 'workers:delete') {
        return invokeRust('ef_worker_store', { operation: channel.split(':')[1], worker: channel === 'workers:save' ? args[0] : null, id: channel === 'workers:delete' ? args[0] : null });
      }
      if (channel === 'workers:browser-state-load' || channel === 'workers:browser-state-save') {
        return invokeRust('ef_browser_state', { scope: args[0], value: channel === 'workers:browser-state-save' ? { id: args[1], data: args[2], kind: args[3] || null } : null });
      }
      if (channel === 'system:open-external') return invokeRust('ef_open_external', { url: args[0] });
      if (channel === 'system:open-folder') return invokeRust('ef_open_path', { path: args[0] });
      if (channel === 'system:show-in-folder') return invokeRust('ef_show_in_folder', { path: args[0] });
      if (channel === 'system:get-displays') return invokeRust('ef_get_displays');
      if (channel === 'window:control') return invokeRust('ef_window_control', { action: args[0], value: args[1] });
      if (channel === 'system:minimize-window') return invokeRust('ef_window_control', { action: 'minimize' });
      if (channel === 'system:maximize-window') return invokeRust('ef_window_control', { action: 'toggle_maximize' });
      if (channel === 'system:close-window') return invokeRust('ef_window_control', { action: 'close' });
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject, channel: channel });
        post({ t: 'invoke', id: id, channel: channel, args: args });
      });
    },
    send: function (channel) { post({ t: 'send', channel: channel, args: Array.prototype.slice.call(arguments, 1) }); },
    sendSync: function () { console.warn('[EverFern] ipcRenderer.sendSync is not supported'); return undefined; },
    on: function (channel, fn) {
      var list = listeners.get(channel) || [];
      list.push({ fn: fn, once: false });
      listeners.set(channel, list);
      if (channel === LINK_CHANNEL && pendingLinks.length) {
        var queued = pendingLinks.splice(0);
        setTimeout(function () { queued.forEach(function (u) { emitEvent(LINK_CHANNEL, [u]); }); }, 0);
      }
      return ipcRenderer;
    },
    once: function (channel, fn) {
      var list = listeners.get(channel) || [];
      list.push({ fn: fn, once: true });
      listeners.set(channel, list);
      return ipcRenderer;
    },
    removeListener: function (channel, fn) {
      var list = listeners.get(channel);
      if (list) listeners.set(channel, list.filter(function (l) { return l.fn !== fn; }));
      return ipcRenderer;
    },
    removeAllListeners: function (channel) {
      if (channel === undefined) listeners.clear(); else listeners.delete(channel);
      return ipcRenderer;
    },
    listenerCount: function (channel) { return (listeners.get(channel) || []).length; },
    setMaxListeners: function () { return ipcRenderer; },
    postMessage: function () {},
  };
  ipcRenderer.off = ipcRenderer.removeListener;
  ipcRenderer.addListener = ipcRenderer.on;

  // Deep links (everfern-app://...) arrive from the Tauri shell; the app listens on the same channel as under Electron.
  var LINK_CHANNEL = 'acp:protocol-link';
  var pendingLinks = (window.__EF_PENDING_LINKS__ || []).slice();
  window.__EF_DEEPLINK__ = function (url) {
    if ((listeners.get(LINK_CHANNEL) || []).length) emitEvent(LINK_CHANNEL, [url]);
    else pendingLinks.push(url);
  };

  function emitEvent(channel, args) {
    var list = listeners.get(channel);
    if (!list || !list.length) return;
    listeners.set(channel, list.filter(function (l) { return !l.once; }));
    list.forEach(function (l) {
      try { l.fn.apply(null, [fakeEvent].concat(args || [])); } catch (e) { console.error('[EverFern] listener for ' + channel + ' failed', e); }
    });
  }

  var contextBridge = {
    exposeInMainWorld: function (key, api) { window[key] = api; },
    exposeInIsolatedWorld: function (_id, key, api) { window[key] = api; },
  };
  var electronModule = {
    ipcRenderer: ipcRenderer,
    contextBridge: contextBridge,
    webFrame: { setZoomFactor: function () {}, getZoomFactor: function () { return 1; }, setVisualZoomLevelLimits: function () {} },
    webUtils: { getPathForFile: function (f) { return (f && f.path) || ''; } },
    clipboard: {
      writeText: function (t) {
        return invokeRust('ef_clipboard_write_text', { text: String(t) }).catch(function () {
          return navigator.clipboard && navigator.clipboard.writeText(String(t));
        });
      },
      readText: function () {
        return invokeRust('ef_clipboard_read_text').catch(function () {
          return navigator.clipboard ? navigator.clipboard.readText() : '';
        });
      },
    },
    shell: {
      openExternal: function (u) { return invokeRust('ef_open_external', { url: String(u) }); },
      openPath: function (p) { return invokeRust('ef_open_path', { path: String(p) }); },
      showItemInFolder: function (p) { return invokeRust('ef_show_in_folder', { path: String(p) }); },
    },
  };

  // ── Shell requests from the sidecar ───────────────────────────────────────
  function win() { var w = T().window; return w && w.getCurrentWindow ? w.getCurrentWindow() : null; }
  function openUrl(u) {
    return invokeRust('ef_open_external', { url: String(u) }).catch(function () {
      var o = T().opener;
      if (o && o.openUrl) return o.openUrl(String(u));
      return invokeRust('plugin:opener|open_url', { url: String(u) });
    });
  }

  var shellOps = {
    cloudRequest: function (request) { return invokeRust('ef_cloud_request', { path: request.path, method: 'POST', token: request.token, body: JSON.stringify(request.body) }); },
    window: function (op) {
      var args = Array.prototype.slice.call(arguments, 1);
      return invokeRust('ef_window_control', { action: op, value: args[0] }).catch(function () {
        var w = win(); if (!w) return null;
        switch (op) {
          case 'close': return w.destroy ? w.destroy() : w.close();
          case 'focus': return w.setFocus();
          case 'show': return w.show();
          case 'hide': return w.hide();
          case 'minimize': return w.minimize();
          case 'unminimize': return w.unminimize();
          case 'maximize': return w.maximize();
          case 'unmaximize': return w.unmaximize();
          case 'setTitle': return w.setTitle(args[0]);
          case 'setAlwaysOnTop': return w.setAlwaysOnTop(!!args[0]);
          case 'setFullscreen': return w.setFullscreen(!!args[0]);
          case 'requestAttention': return w.requestUserAttention(2);
          default: return null;
        }
      });
    },
    openUrl: function (u) { return openUrl(u).then(function () { return true; }); },
    dialogOpen: function (o) { return invokeRust('plugin:dialog|open', { options: o }); },
    dialogSave: function (o) { return invokeRust('plugin:dialog|save', { options: o }); },
    messageBox: function (o) {
      var d = T().dialog || {
        message: function (message, options) { return invokeRust('plugin:dialog|message', { message: message, title: options.title, kind: options.kind, buttons: 'Ok' }); },
        ask: function (message, options) { return invokeRust('plugin:dialog|message', { message: message, title: options.title, kind: options.kind, buttons: { OkCancelCustom: [options.okLabel, options.cancelLabel] } }).then(function (answer) { return answer === 'Ok' || answer === options.okLabel; }); }
      };
      var buttons = o.buttons || ['OK'];
      var kind = o.type === 'error' ? 'error' : o.type === 'warning' ? 'warning' : 'info';
      if (buttons.length <= 1) return d.message(o.message || '', { title: o.title, kind: kind }).then(function () { return 0; });
      // Two choices map onto ask(); index 0 is Electron's first button.
      return d.ask(o.message || '', { title: o.title, kind: kind, okLabel: buttons[0], cancelLabel: buttons[1] })
        .then(function (yes) { return yes ? 0 : 1; });
    },
    notify: function (o) {
      var n = T().notification;
      if (!n) return invokeRust('ef_notify', { title: o.title || 'EverFern', body: o.body || '' });
      return Promise.resolve(n.isPermissionGranted()).then(function (ok) {
        return ok ? ok : n.requestPermission().then(function (p) { return p === 'granted'; });
      }).then(function (ok) { if (ok) n.sendNotification({ title: o.title, body: o.body }); return ok; });
    },
    shortcutRegister: function (accel) {
      var g = T().globalShortcut;
      if (!g) return invokeRust('ef_shortcut', { accelerator: accel, register: true }).then(function () { return true; }, function () { return false; });
      return g.register(accel, function (e) {
        if (!e || e.state === 'Pressed') post({ t: 'shortcut', accelerator: accel });
      }).then(function () { return true; }, function (err) { console.warn('[EverFern] shortcut ' + accel + ' not registered:', err); return false; });
    },
    shortcutUnregister: function (accel) { var g = T().globalShortcut; return g ? g.unregister(accel) : invokeRust('ef_shortcut', { accelerator: accel, register: false }); },
    display: function () {
      return { width: screen.width, height: screen.height, scaleFactor: window.devicePixelRatio || 1 };
    },
    eval: function (code) { return (0, eval)(code); },
    reload: function () { location.reload(); },
    devtools: function () { return invokeRust('ef_open_devtools'); },
    relaunch: function () { return invokeRust('ef_relaunch'); },
    exit: function (code) { return invokeRust('ef_exit', { code: code || 0 }); },
  };

  function onMessage(msg) {
    if (msg.t === 'result') {
      var p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error("Error invoking remote method '" + p.channel + "': " + msg.error));
    } else if (msg.t === 'event') {
      emitEvent(msg.channel, msg.args);
    } else if (msg.t === 'shell') {
      var fn = shellOps[msg.op];
      Promise.resolve()
        .then(function () { return fn ? fn.apply(null, msg.args || []) : undefined; })
        .then(function (value) { if (msg.id) post({ t: 'shell-result', id: msg.id, value: value === undefined ? null : value }); },
              function (err) { console.warn('[EverFern] shell op ' + msg.op + ' failed', err); if (msg.id) post({ t: 'shell-result', id: msg.id, value: null }); });
    }
  }

  // ── Window state the main process reads synchronously ─────────────────────
  function reportWindowState(event) {
    var w = win(); if (!w) return;
    Promise.all([w.isMaximized(), w.isMinimized(), w.isVisible(), w.isFocused(), w.isFullscreen()])
      .then(function (s) {
        post({ t: 'window-state', event: event, state: { maximized: s[0], minimized: s[1], visible: s[2], focused: s[3], fullscreen: s[4] } });
      }, function () {});
  }
  function watchWindow() {
    var w = win(); if (!w) return;
    var lastMax = null;
    w.onResized(function () {
      w.isMaximized().then(function (m) {
        if (m !== lastMax) { lastMax = m; reportWindowState(m ? 'maximize' : 'unmaximize'); } else reportWindowState('resize');
      });
    });
    w.onFocusChanged(function (e) { reportWindowState(e.payload ? 'focus' : 'blur'); });
    // Alt+F4 / taskbar close: let the main process decide (it may hide to tray).
    w.onCloseRequested(function (e) { e.preventDefault(); post({ t: 'close-requested' }); });
  }

  // Electron's frameless windows drag on `-webkit-app-region: drag`.
  function regionOf(el) {
    for (; el && el !== document.documentElement; el = el.parentElement) {
      var cs = getComputedStyle(el);
      var r = cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('app-region') || cs.webkitAppRegion || cs.appRegion;
      if (r === 'no-drag') return 'no-drag';
      if (r === 'drag') return 'drag';
      if (el.hasAttribute && el.hasAttribute('data-tauri-drag-region')) return 'drag';
    }
    return 'none';
  }
  var interactive = /^(BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL)$/;
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || interactive.test(e.target.tagName)) return;
    if (regionOf(e.target) !== 'drag') return;
    var w = win(); if (!w) return;
    if (e.detail === 2) w.toggleMaximize(); else w.startDragging();
  }, true);

  // ── Start ─────────────────────────────────────────────────────────────────
  var nativeUpdateStatus = { status: 'idle', version: '', progress: null, errorMsg: null };
  if (T().event && T().event.listen) {
    T().event.listen('ef-shortcut', function (event) { post({ t: 'shortcut', accelerator: event.payload.accelerator }); }).catch(function () {});
    ['update-available', 'update-downloaded', 'download-progress', 'update-error'].forEach(function (channel) {
      T().event.listen(channel, function (event) {
        if (channel === 'update-available') { nativeUpdateStatus.status = 'available'; nativeUpdateStatus.version = event.payload.version; }
        if (channel === 'update-downloaded') nativeUpdateStatus.status = 'downloaded';
        if (channel === 'download-progress') { nativeUpdateStatus.status = 'downloading'; nativeUpdateStatus.progress = event.payload; }
        if (channel === 'update-error') { nativeUpdateStatus.status = 'error'; nativeUpdateStatus.errorMsg = event.payload; }
        emitEvent(channel, [event.payload]);
      }).catch(function () {});
    });
  }
  connect();
  if (cfg.autoUpdate) setTimeout(function () {
    invokeRust('ef_update', { install: false }).catch(function (error) {
      nativeUpdateStatus.status = 'error'; nativeUpdateStatus.errorMsg = String(error);
    });
  }, 15000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchWindow); else watchWindow();

  // The unchanged compiled preload runs here, against the shim above.
  (function (require, module, exports, process) {
    /*__EF_PRELOAD__*/
  })(function (name) {
    if (name === 'electron') return electronModule;
    throw new Error('[EverFern] preload cannot require ' + name);
  }, { exports: {} }, {}, { platform: cfg.platform || 'win32', env: {}, versions: {}, type: 'renderer', argv: [] });
})();
