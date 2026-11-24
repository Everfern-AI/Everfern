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
  var secureSession = window.__EF_SECURE_SESSION__ || {};
  delete window.__EF_SECURE_SESSION__;
  // Reloads replay the startup snapshot. Suppress it after any session change.
  try {
    if (sessionStorage.getItem('__ef_session_changed')) secureSession = {};
  } catch (_) {}
  // Overlay windows (computer / voice / desktop overlay, debug) carry their window id.
  var isOverlay = !!cfg.win;
  var T = function () { return window.__TAURI__ || {}; };
  var invokeRust = function (cmd, args) {
    var core = T().core;
    return core ? core.invoke(cmd, args || {}) : Promise.reject(new Error('Tauri core API missing'));
  };
  // The initialization script is reused across reloads. Refresh the startup snapshot
  // from Rust, and preserve any changes the preload makes while the refresh is pending.
  var sessionChanged = new Set();
  if (!isOverlay) {
    invokeRust('ef_secure_session_load').then(function (current) {
      Object.keys(secureSession).forEach(function (key) {
        if (!sessionChanged.has(key) && !Object.hasOwn(current, key)) delete secureSession[key];
      });
      Object.keys(current).forEach(function (key) {
        if (!sessionChanged.has(key)) secureSession[key] = current[key];
      });
    }).catch(function (error) { console.warn('[EverFern] Session refresh failed', error); });
  }

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
  // The main window may load before the sidecar runs (it starts on first use, see
  // src-tauri/src/main.rs). Messages wait in the queue; the first one that needs an
  // answer from the main process starts it. Overlays are opened by the sidecar, so
  // they always have its port.
  var ws = null, open = false, queue = [], seq = 0, pending = new Map(), retry = 0, starting = null;
  // Sends that can wait until something else starts the sidecar.
  var DEFERRED = { 'workers:scheduler-ready': true, 'history:index-messages': true };
  // Messages with no effect while the sidecar is not running (Rust hides the window on
  // close, and the window state is reported again when the socket opens).
  var DROPPED = { 'window-state': true, 'close-requested': true, 'overlay-closed': true };
  function useAddr(addr) {
    if (!addr || !addr.port || ws) return;
    cfg.port = addr.port; cfg.token = addr.token;
    connect();
  }
  function startSidecar(reason) {
    if (cfg.port || isOverlay) return Promise.resolve();
    if (!starting) {
      starting = invokeRust('ef_sidecar', { start: true, reason: reason ? String(reason).slice(0, 80) : null }).then(useAddr, function (err) {
        starting = null;
        console.error('[EverFern] background process failed to start', err);
        var q = queue; queue = [];
        q.forEach(function (m) { if (m.id) failPending(m.id, err); });
      });
    }
    return starting;
  }
  function failPending(id, err) {
    var p = pending.get(id);
    if (p) { pending.delete(id); p.reject(new Error('EverFern background process failed to start: ' + err)); }
  }
  function connect() {
    if (!cfg.port) { if (isOverlay) console.error('[EverFern] sidecar port missing'); return; }
    ws = new WebSocket('ws://127.0.0.1:' + cfg.port + '/?token=' + encodeURIComponent(cfg.token || '') + (isOverlay ? '&win=' + encodeURIComponent(cfg.win) : ''));
    ws.onopen = function () {
      open = true; retry = 0;
      var q = queue; queue = [];
      q.forEach(function (m) { ws.send(m.text); });
      if (!isOverlay) reportWindowState();
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
    if (open) { ws.send(text); return; }
    if (!cfg.port && !isOverlay) {
      if (DROPPED[msg.t]) return;
      if (!(msg.t === 'send' && DEFERRED[msg.channel])) startSidecar(msg.channel || msg.t);
    }
    queue.push({ text: text, id: msg.t === 'invoke' ? msg.id : 0 });
  }

  // ── Browser-side `electron` module for the preload ────────────────────────
  // Data-layer channels served by Rust (src-tauri/src/data). Vector search,
  // embeddings and live HITL state stay in Node.
  var RUST_DATA = {};
  [
    'analytics:get-summary', 'analytics:record-usage', 'tool-settings:list-synthesized', 'tool-settings:delete-synthesized',
    'agent:get-rollback-changes', 'agent:get-rollback-preview', 'agent:get-snapshot-content',
    'openclaw:get-configs', 'openclaw:save-configs',
    'hitl:get-pending', 'memory:get-graph', 'memory:delete-node', 'memory:export-zip',
    'memory:import-merge-graph', 'memory:save-direct', 'integration:get-config',
    'api:checkHealth', 'db:checkConnection', 'db:checkVectors', 'health:repair',
    'vectors:get', 'vectors:delete', 'vectors:stats', 'vectors:search', 'vectors:index-message', 'vectors:refresh-config',
    'history:list', 'history:listByProject', 'history:load', 'history:save', 'history:delete', 'history:get-vectors',
    'history:togglePin', 'history:toggleUnread', 'history:updateTitle', 'history:setProject',
    'projects:list', 'projects:create', 'projects:update', 'projects:toggleBookmark', 'projects:delete',
    'projects:getDefaultPath', 'projects:getEverfernPath', 'projects:listFiles', 'projects:readFile', 'projects:readFileDataUrl',
    'scheduled-tasks:list', 'scheduled-tasks:get', 'scheduled-tasks:save', 'scheduled-tasks:delete',
    'plans:list', 'plans:read', 'plans:write', 'plans:delete',
    'sites:list', 'sites:read-file', 'sites:write-file', 'sites:delete',
    'artifacts:list', 'artifacts:read', 'artifacts:write', 'artifacts:delete',
    'load-config', 'screenshot:load', 'system:read-image-data-url', 'system:ensure-attachment-in-vm',
    'tool-settings:get', 'tool-settings:set', 'system:parse-docx', 'system:parse-pptx', 'system:parse-xlsx',
    'system:ocr-status', 'system:to-host-path', 'system:toHostPath',
    'acp:list-providers', 'providers:get-all', 'providers:get-models',
    'skills:list-all', 'skills:list-custom', 'skills:save-custom', 'skills:delete-custom', 'skills:get-custom-path',
    'sheets:load', 'sheets:save', 'system:get-username'
  ].forEach(function (c) { RUST_DATA[c] = true; });
  var RUST_VM_CHECKS = {
    'system:checkWSL': 'installed',
    'system:getWSLInfo': 'info',
    'system:checkDocker': 'docker',
    'system:checkEnvironmentDependencies': 'deps',
  };
  var listeners = new Map(); // channel -> [{ fn, wrapped }]
  var fakeEvent = { sender: null, senderId: 0, ports: [] };
  function invokeSidecar(channel, args) {
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject, channel: channel });
      post({ t: 'invoke', id: id, channel: channel, args: args });
    });
  }
  function installOcr() {
    return invokeRust('ef_ocr_install_packages');
  }
  var ipcRenderer = {
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (channel === 'tool-approvals:update' &&
          !(args[0] && args[0].updates && args[0].updates.conversationId)) {
        return invokeRust('ef_data', { channel: 'tool-approvals:update-global', args: args })
          .then(function (result) {
            if (result && result.policy) return result.policy;
            if (cfg.port || starting || isOverlay) return invokeSidecar(channel, args);
            return null;
          });
      }
      if (channel === 'tool-approvals:add' && args[0] && !args[0].conversationId) {
        return invokeRust('ef_data', { channel: 'tool-approvals:add-global', args: args });
      }
      if (channel === 'tool-approvals:delete') {
        return invokeRust('ef_data', { channel: 'tool-approvals:delete-global', args: args })
          .then(function (result) {
            if (!result.removed && (cfg.port || starting || isOverlay)) return invokeSidecar(channel, args);
            return { success: result.success };
          });
      }
      if (channel === 'tool-approvals:get-all') {
        var globalPolicies = invokeRust('ef_data', { channel: 'tool-approvals:list-global', args: [] });
        if (!cfg.port && !starting && !isOverlay) return globalPolicies;
        return Promise.all([globalPolicies, invokeSidecar('tool-approvals:list-conversation', [])])
          .then(function (lists) { return lists[0].concat(lists[1]); });
      }
      if (channel === 'tool-approvals:clear-all') {
        return invokeRust('ef_data', { channel: 'tool-approvals:clear-global', args: [] })
          .then(function (result) {
            if (cfg.port || starting || isOverlay) return invokeSidecar('tool-approvals:clear-conversation', []);
            return result;
          });
      }
      if (channel === 'chat:generate-title') {
        invokeRust('ef_data', { channel: 'chat:generate-title-local', args: args })
          .catch(function () { return null; })
          .then(function (result) { if (result === null) return invokeSidecar(channel, args); })
          .catch(function () {});
        return Promise.resolve({ queued: true });
      }
      if (!cfg.port && !isOverlay && !starting &&
          (channel === 'acp:active' || channel === 'acp:stop' || channel === 'terminal:get-status' ||
           channel === 'hitl:resolve')) {
        return invokeRust('ef_data', { channel: channel, args: args })
          .then(function (result) { return result === null ? invokeSidecar(channel, args) : result; });
      }
      if (!cfg.port && !isOverlay && !starting && channel === 'agent:rollback-turn') {
        return invokeRust('ef_data', { channel: 'agent:rollback-file-only-turn', args: args })
          .then(function (result) { return result === null ? invokeSidecar(channel, args) : result; });
      }
      if (channel === 'analytics:get-model-info' || channel === 'analytics:get-model-pricing') {
        var cachedChannel = channel === 'analytics:get-model-info'
          ? 'analytics:get-cached-model-info' : 'analytics:get-cached-model-pricing';
        return invokeRust('ef_data', { channel: cachedChannel, args: args })
          .catch(function (error) { return { success: false, error: String(error) }; });
      }
      if (channel === 'debug:copy-to-clipboard') {
        return invokeRust('ef_clipboard_write_text', { text: String(args[0]) }).then(function () {
          return true;
        }).catch(function () {
          return true; // The legacy debug route treats clipboard failures as best effort.
        });
      }
      if (channel === 'save-config') {
        return invokeRust('ef_data', { channel: channel, args: args })
          .then(function (result) {
            if (result.success && (result.refreshRuntime || cfg.port || starting || isOverlay)) {
              return invokeSidecar('apply-saved-provider-config', []);
            }
            return result.success ? { success: true } : result;
          });
      }
      if (channel === 'acp:health-check') {
        if (cfg.port || starting) return invokeSidecar(channel, args);
        return invokeRust('ef_saved_provider_health').then(function (result) {
          return result ?? invokeSidecar(channel, args);
        });
      }
      if (channel === 'acp:list-tools' && !cfg.port && !starting && !isOverlay) {
        return invokeRust('ef_data', { channel: 'acp:list-tools-unconfigured', args: [] })
          .then(function (result) { return result ?? invokeSidecar(channel, args); });
      }
      if (channel === 'acp:list-models') {
        var liveConfig = cfg.port || starting
          ? invokeSidecar('acp:model-picker-config', [])
          : Promise.resolve(null);
        return liveConfig.then(function (activeConfig) {
          return invokeRust('ef_list_agent_models', { activeConfig: activeConfig });
        }).catch(function (error) {
          return { success: false, models: [], error: String(error) };
        });
      }
      if (channel === 'system:ocr-install') return installOcr();
      if (channel === 'system:pdf-pages' || channel === 'system:ocr-pdf') {
        var command = channel === 'system:pdf-pages' ? 'ef_pdf_pages' : 'ef_ocr_pdf';
        return invokeRust(command, { params: args[0] ?? null }).then(function (result) {
          if (result !== null) return result;
          return installOcr().then(function (install) {
            if (install.ok) return invokeRust(command, { params: Object.assign({}, args[0], { installIfMissing: false }) });
            if (channel === 'system:pdf-pages') return { ok: false, pages: [], totalPages: 0, rendered: 0, error: install.message };
            var options = args[0] || {};
            var engine = ['tesseract', 'paddleocr', 'paddleocr-vl', 'vision-send'].includes(options.engine) ? options.engine : 'ocrmypdf';
            return { status: 'skipped', text: '', engine: engine, backend: options.backend === 'openvino' ? 'openvino' : 'auto', error: install.message };
          });
        });
      }
      if (channel === 'secure-session:set') {
        sessionChanged.add(args[0]);
        try { sessionStorage.setItem('__ef_session_changed', '1'); } catch (_) {}
        return invokeRust('ef_secure_session_set', { key: args[0] ?? null, value: args[1] ?? null });
      }
      if (cfg.platform === 'win32' && ['workers:vm-status', 'workers:vm-exec', 'workers:vm-ls'].indexOf(channel) !== -1) {
        return invokeRust('ef_local_vm', { operation: channel.slice('workers:vm-'.length), worker: args[0] || null, command: args[1] || null });
      }
      // Settings > Linux VM status checks, answered by Rust (src-tauri/src/vm.rs).
      if (cfg.platform === 'win32' && Object.prototype.hasOwnProperty.call(RUST_VM_CHECKS, channel)) {
        return invokeRust('ef_local_vm', { operation: RUST_VM_CHECKS[channel], worker: null, command: null });
      }
      if (channel === 'system:get-update-status') return Promise.resolve(nativeUpdateStatus);
      if (channel === 'system:detect-hardware') {
        return invokeRust('ef_host_hardware');
      }
      if (channel === 'system:get-local-models') {
        return invokeRust('ef_host_local_models', { params: args[0] ?? null });
      }
      if (['mcp:import-json', 'mcp:remove', 'mcp:set-enabled', 'mcp:save'].indexOf(channel) !== -1) {
        return invokeRust('ef_data', { channel: channel, args: args }).then(function (result) {
          if (result === null) return invokeSidecar(channel, args);
          if (!result || !result.success) return result;
          var needsRuntime = result.needsRuntime;
          var serverNames = result.serverNames || [];
          var removedNames = result.removedNames || [];
          delete result.needsRuntime;
          delete result.serverNames;
          delete result.removedNames;
            // Keep an already-running registry in sync even for disabled-only edits.
            // Start Node only when an enabled profile actually needs connecting.
            if (!needsRuntime && !cfg.port && !starting && !isOverlay) return result;
          return invokeSidecar('mcp:sync-saved', { serverNames: serverNames, removedNames: removedNames })
            .then(function (syncResult) {
              if (channel === 'mcp:save' && syncResult && syncResult.success) result.data = syncResult.data || 0;
              return result;
            });
        });
      }
      // The running agent can have a newer in-memory snapshot than SQLite.
      if (!cfg.port && !isOverlay && !starting &&
          (channel === 'acp:get-interrupted-state' || channel === 'mcp:list' ||
           channel === 'mcp:reconnect' ||
           channel === 'system:stop-dispatch' || channel === 'system:broadcast-dispatch' ||
           channel === 'integration:get-service-status' || channel === 'integration:get-system-status')) {
        return invokeRust('ef_data', { channel: channel, args: args }).then(function (result) {
          if (result === null) return invokeSidecar(channel, args);
          if (channel === 'system:broadcast-dispatch') return undefined;
          return result;
        });
      }
      if (channel === 'integration:save-config') {
        return invokeRust('ef_data', { channel: channel, args: args }).then(function (needsRuntime) {
          if (needsRuntime || cfg.port || starting || isOverlay) {
            return invokeSidecar('integration:apply-saved-config', []);
          }
        });
      }
      if (channel === 'integration:test-connection' && args[0] !== 'telegram' && args[0] !== 'discord') {
        return Promise.resolve(false);
      }
      if (!cfg.port && !isOverlay && !starting && channel === 'integration:test-connection') {
        return invokeRust('ef_data', { channel: 'integration:probe-inactive', args: args })
          .catch(function () { return null; })
          .then(function (result) { return result === null ? invokeSidecar(channel, args) : result; });
      }
      // Answered here so opening the window does not need the main process.
      if (channel === 'system:get-version' && cfg.version) return Promise.resolve(cfg.version);
      if (channel === 'system:get-platform' && cfg.platform) return Promise.resolve(cfg.platform);
      if (channel === 'window:is-maximized' && !isOverlay && win()) return win().isMaximized();
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
      if (channel === 'system:open-folder-picker') return invokeRust('ef_open_folder_picker');
      if (channel === 'system:open-file-picker') return invokeRust('ef_open_file_picker', { options: args[0] ?? null });
      if (channel === 'system:show-in-folder') return invokeRust('ef_show_in_folder', { path: args[0] });
      if (channel === 'system:get-displays') return invokeRust('ef_get_displays');
      if (channel === 'window:control') return invokeRust('ef_window_control', { action: args[0], value: args[1] });
      if (channel === 'system:minimize-window') return invokeRust('ef_window_control', { action: 'minimize' });
      if (channel === 'system:maximize-window') return invokeRust('ef_window_control', { action: 'toggle_maximize' });
      if (channel === 'system:close-window') return invokeRust('ef_window_control', { action: 'close' });
      if (channel === 'window:minimize') return invokeRust('ef_window_control', { action: 'minimize' }).then(function () {});
      if (channel === 'window:maximize') return invokeRust('ef_window_control', { action: 'toggle_maximize' }).then(function () {});
      if (channel === 'window:close') return invokeRust('ef_window_control', { action: 'close' }).then(function () {});
      // The tray icon itself is built in Rust (main.rs), so these only move the window.
      if (channel === 'tray:show-window') return invokeRust('ef_window_control', { action: 'restore' });
      if (channel === 'tray:hide-to-tray') return invokeRust('ef_window_control', { action: 'hide' });
      if (channel === 'tray:is-supported') return Promise.resolve({ supported: true });
      if (channel === 'tray:update-menu') return Promise.resolve({ success: true });
      if (channel === 'projects:selectFolder') return invokeRust('ef_open_folder_picker').then(function (r) { return r && r.success ? r.path : null; });
      if (channel === 'projects:selectFiles') return invokeRust('ef_pick_files', { title: null });
      if (channel === 'projects:openFolder') {
        if (!args[0]) return Promise.resolve({ success: false, error: 'No path provided' });
        return invokeRust('ef_open_path', { path: args[0] })
          .then(function () { return { success: true }; }, function (error) { return { success: false, error: String(error) }; });
      }
      // Rust handles Windows (the HKCU Run key) and returns null elsewhere.
      if (channel.indexOf('autostart:') === 0) {
        return invokeRust('ef_data', { channel: channel, args: args })
          .then(function (result) { return result === null ? invokeSidecar(channel, args) : result; });
      }
      if (RUST_DATA[channel]) {
        return invokeRust('ef_data', { channel: channel, args: args }).then(function (res) {
          // Saved messages still get embedded by Node, which owns vector search.
          if (res && res.__index) {
            post({ t: 'send', channel: 'history:index-messages', args: [res.__index] });
            delete res.__index;
          }
          // Node caches the skill list it gives the agent.
          if (res && res.success && (channel === 'skills:save-custom' || channel === 'skills:delete-custom')) {
            post({ t: 'send', channel: 'skills:changed', args: [] });
          }
          return res;
        });
      }
      return invokeSidecar(channel, args);
    },
    send: function (channel) { post({ t: 'send', channel: channel, args: Array.prototype.slice.call(arguments, 1) }); },
    sendSync: function (channel) {
      if (channel === 'secure-session:load') return secureSession;
      console.warn('[EverFern] ipcRenderer.sendSync is not supported');
      return undefined;
    },
    on: function (channel, fn) {
      var list = listeners.get(channel) || [];
      list.push({ fn: fn, once: false });
      listeners.set(channel, list);
      if (channel === LINK_CHANNEL && pendingLinks.length) {
        var queued = pendingLinks.splice(0);
        setTimeout(function () { queued.forEach(function (u) { emitEvent(LINK_CHANNEL, [u]); }); }, 0);
      }
      var held = heldEvents.get(channel);
      if (held && held.length) {
        heldEvents.delete(channel);
        setTimeout(function () { held.forEach(function (a) { emitEvent(channel, a); }); }, 0);
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

  // Tasks sent from the Navis extension can wake Node before the chat page has subscribed.
  // Hold those events until a listener attaches instead of dropping them.
  var HOLD_CHANNELS = { 'system:dispatch-command': true };
  var heldEvents = new Map();

  function emitEvent(channel, args) {
    var list = listeners.get(channel);
    if (!list || !list.length) {
      if (HOLD_CHANNELS[channel]) {
        var h = heldEvents.get(channel) || [];
        if (h.length < 20) h.push(args);
        heldEvents.set(channel, h);
      }
      return;
    }
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
      // Native message box: one, two or three buttons (Electron's index is returned).
      var buttons = (o.buttons && o.buttons.length ? o.buttons : ['OK']).map(String);
      var kind = o.type === 'error' ? 'error' : o.type === 'warning' ? 'warning' : 'info';
      var message = o.message || '';
      if (o.detail) message += '\n\n' + o.detail;
      var spec = buttons.length <= 1 ? (buttons[0] === 'OK' ? 'Ok' : { OkCustom: buttons[0] })
        : buttons.length === 2 ? { OkCancelCustom: [buttons[0], buttons[1]] }
        : { YesNoCancelCustom: [buttons[0], buttons[1], buttons[2]] };
      if (buttons.length > 3) console.warn('[EverFern] message box shows only the first three of ' + buttons.length + ' buttons');
      var cancelIndex = typeof o.cancelId === 'number' ? o.cancelId : Math.min(buttons.length, 3) - 1;
      return invokeRust('plugin:dialog|message', { message: message, title: o.title || 'EverFern', kind: kind, buttons: spec })
        .then(function (answer) {
          var i = buttons.indexOf(String(answer));
          if (i !== -1) return i;
          if (answer === 'Ok' || answer === 'Yes') return 0;
          if (answer === 'No') return 1;
          return buttons.length === 1 ? 0 : cancelIndex;
        });
    },
    notify: function (o) {
      var n = T().notification;
      if (!n) return invokeRust('ef_notify', { title: o.title || 'EverFern', body: o.body || '' });
      return Promise.resolve(n.isPermissionGranted()).then(function (ok) {
        return ok ? ok : n.requestPermission().then(function (p) { return p === 'granted'; });
      }).then(function (ok) { if (ok) n.sendNotification({ title: o.title, body: o.body }); return ok; });
    },
    shortcutRegister: function (accel) {
      // Already registered by Rust at launch; its presses arrive as `ef-shortcut`.
      if (RUST_SHORTCUTS.indexOf(accel) !== -1) return Promise.resolve(true);
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
    overlay: function (id, op, args) { return invokeRust('ef_overlay', { id: Number(id), op: op, args: args || {} }); },
    reload: function () { location.reload(); },
    devtools: function () { return invokeRust('ef_open_devtools'); },
    claimScheduledWorker: function () {
      if (isOverlay) return;
      return invokeRust('ef_worker_store', { operation: 'claim', worker: null, id: null });
    },
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
      if (isOverlay && msg.op === 'claimScheduledWorker') return;
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

  // ── everfern-site:// (generated sites and artifacts) ──────────────────────
  // WebView2 serves custom schemes as http://<scheme>.localhost, so rewrite the
  // Electron-style URLs the app builds wherever they are handed to the page.
  var SITE_BASE = cfg.platform === 'win32' ? 'http://everfern-site.localhost/' : 'everfern-site://localhost/';
  function siteUrl(u) {
    if (typeof u !== 'string' || u.slice(0, 16).toLowerCase() !== 'everfern-site://') return u;
    return SITE_BASE + u.slice(16);
  }
  function installSiteScheme() {
    [window.HTMLIFrameElement, window.HTMLImageElement, window.HTMLScriptElement, window.HTMLSourceElement, window.HTMLMediaElement, window.HTMLEmbedElement].forEach(function (C) {
      if (!C) return;
      var d = Object.getOwnPropertyDescriptor(C.prototype, 'src');
      if (!d || !d.set) return;
      Object.defineProperty(C.prototype, 'src', { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, siteUrl(v)); } });
    });
    var setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (typeof value === 'string' && (name === 'src' || name === 'href')) value = siteUrl(value);
      return setAttr.call(this, name, value);
    };
    var open = window.open;
    window.open = function (u) {
      if (typeof u === 'string' && siteUrl(u) !== u) {
        invokeRust('ef_open_site', { url: siteUrl(u) }).catch(function (e) { console.warn('[EverFern] could not open site', e); });
        return null;
      }
      return open.apply(window, arguments);
    };
  }

  // ── <webview> (worker apps' browser panes) ────────────────────────────────
  // Each <webview> element becomes a native child WebView2 of the main window
  // (src-tauri/src/webviews.rs) kept over the element's box. Native views always
  // draw above the page, so the pane is hidden whenever its box is covered.
  function installWebviews() {
    var nextId = 1, live = new Set();
    function fire(el, name, props) {
      var ev = new Event(name);
      if (props) for (var k in props) { try { Object.defineProperty(ev, k, { value: props[k], enumerable: true }); } catch (e) {} }
      el.dispatchEvent(ev);
    }
    function emptyImage() {
      return { isEmpty: function () { return true; }, resize: function () { return this; }, crop: function () { return this; },
        toDataURL: function () { return ''; }, toPNG: function () { return new Uint8Array(0); }, toJPEG: function () { return new Uint8Array(0); },
        getSize: function () { return { width: 0, height: 0 }; } };
    }
    function upgrade(el) {
      if (el.__efwv) return;
      var st = el.__efwv = { id: nextId++, created: false, creating: null, url: '', title: '', loading: false, visible: null, rect: '', nav: 0, fwd: 0, waiters: [] };
      var call = function (op, args) {
        var go = function () { return invokeRust('ef_webview', { id: st.id, op: op, args: args || {} }); };
        return st.creating ? st.creating.then(go) : go();
      };
      st.call = call;
      var methods = {
        loadURL: function (u) {
          st.url = String(u);
          if (!st.created && !st.creating) return Promise.resolve();
          return call('load', { url: st.url }).then(function () {
            return new Promise(function (resolve) { st.waiters.push(resolve); setTimeout(resolve, 30000); });
          });
        },
        getURL: function () { return st.url; },
        getTitle: function () { return st.title; },
        isLoading: function () { return st.loading; },
        isLoadingMainFrame: function () { return st.loading; },
        isWaitingForResponse: function () { return false; },
        stop: function () { call('stop'); },
        reload: function () { call('reload'); },
        reloadIgnoringCache: function () { call('reload'); },
        canGoBack: function () { return st.nav > 1; },
        canGoForward: function () { return st.fwd > 0; },
        canGoToOffset: function () { return false; },
        goBack: function () { if (st.nav > 1) { st.nav -= 2; st.fwd++; } call('back'); },
        goForward: function () { if (st.fwd > 0) st.fwd--; call('forward'); },
        executeJavaScript: function (code) { return call('exec', { code: String(code) }); },
        insertCSS: function (css) {
          return call('exec', { code: '(()=>{const s=document.createElement("style");s.textContent=' + JSON.stringify(String(css)) + ';document.documentElement.appendChild(s);return ""})()' });
        },
        openDevTools: function () { call('devtools'); },
        closeDevTools: function () {},
        isDevToolsOpened: function () { return false; },
        // Navis drives Electron webContents by id; native panes have none, so callers skip it.
        getWebContentsId: function () { throw new Error('webContents ids are not available in this build'); },
        capturePage: function () { return Promise.resolve(emptyImage()); },
        getUserAgent: function () { return el.getAttribute('useragent') || navigator.userAgent; },
        setUserAgent: function () {},
        setZoomFactor: function () {}, getZoomFactor: function () { return 1; },
        setZoomLevel: function () {}, getZoomLevel: function () { return 0; },
        setAudioMuted: function () {}, isAudioMuted: function () { return false; },
        send: function () {}, sendInputEvent: function () {}, print: function () {},
        focus: function () { call('focus'); },
      };
      Object.keys(methods).forEach(function (k) { Object.defineProperty(el, k, { value: methods[k], configurable: true, writable: true }); });
      Object.defineProperty(el, 'src', { configurable: true,
        get: function () { return st.url || el.getAttribute('src') || ''; },
        set: function (v) { el.setAttribute('src', String(v)); } });
      live.add(el);
      schedule();
    }
    function create(el, st, r, visible) {
      st.url = st.url || el.getAttribute('src') || 'about:blank';
      st.creating = invokeRust('ef_webview', { id: st.id, op: 'create', args: {
        url: st.url, partition: el.getAttribute('partition') || '', userAgent: el.getAttribute('useragent') || '',
        x: r.left, y: r.top, width: r.width, height: r.height, visible: visible } })
        .then(function () { st.created = true; }, function (e) { console.warn('[EverFern] webview failed', e); fire(el, 'did-fail-load', { errorCode: -1, errorDescription: String(e), validatedURL: st.url, isMainFrame: true }); })
        .then(function () { st.creating = null; });
      st.visible = visible;
      st.rect = [r.left, r.top, r.width, r.height].join(',');
    }
    function covered(el, r) {
      var x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      var hit = document.elementFromPoint(x, y);
      return hit !== el && !(hit && el.contains(hit));
    }
    function sync() {
      live.forEach(function (el) {
        var st = el.__efwv;
        if (!el.isConnected) {
          live.delete(el);
          if (st.created || st.creating) st.call('destroy');
          st.created = false;
          return;
        }
        var r = el.getBoundingClientRect();
        var visible = r.width > 1 && r.height > 1 && document.visibilityState !== 'hidden' && !covered(el, r);
        if (!st.created && !st.creating) { if (r.width > 1 && r.height > 1) create(el, st, r, visible); return; }
        var key = [r.left, r.top, r.width, r.height].join(',');
        if (visible && key !== st.rect) { st.rect = key; st.call('bounds', { x: r.left, y: r.top, width: r.width, height: r.height }); }
        if (visible !== st.visible) { st.visible = visible; st.call(visible ? 'show' : 'hide'); }
      });
    }
    var queued = false;
    function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; sync(); }); }
    setInterval(sync, 250);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('visibilitychange', schedule);

    // Upgrade as React creates the element, so refs and effects see the methods.
    var createElement = Document.prototype.createElement;
    Document.prototype.createElement = function (tag) {
      var el = createElement.apply(this, arguments);
      if (typeof tag === 'string' && tag.toLowerCase() === 'webview') upgrade(el);
      return el;
    };
    new MutationObserver(function (records) {
      records.forEach(function (rec) {
        if (rec.type === 'attributes') {
          var st = rec.target.__efwv;
          var u = rec.target.getAttribute('src');
          if (st && u && u !== st.url) rec.target.loadURL(u);
          return;
        }
        rec.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'WEBVIEW') upgrade(n);
          if (n.querySelectorAll) n.querySelectorAll('webview').forEach(upgrade);
        });
        if (rec.removedNodes.length) schedule();
      });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

    if (T().event && T().event.listen) {
      T().event.listen('ef-webview', function (event) {
        var m = event.payload || {}, el = null;
        live.forEach(function (x) { if (x.__efwv.id === m.id) el = x; });
        if (!el) return;
        var st = el.__efwv;
        if (m.type === 'navigate') {
          fire(el, 'did-start-navigation', { url: m.url, isMainFrame: true, isInPlace: false, isSameDocument: false });
          fire(el, 'will-navigate', { url: m.url });
        } else if (m.type === 'start') {
          st.loading = true; st.url = m.url || st.url; st.nav++;
          fire(el, 'did-start-loading');
          fire(el, 'did-navigate', { url: st.url, httpResponseCode: 200, httpStatusText: 'OK' });
        } else if (m.type === 'finish') {
          st.loading = false; st.url = m.url || st.url;
          fire(el, 'dom-ready');
          fire(el, 'did-finish-load', { isMainFrame: true });
          fire(el, 'did-stop-loading');
          st.waiters.splice(0).forEach(function (w) { w(); });
        } else if (m.type === 'title') {
          st.title = m.title || '';
          fire(el, 'page-title-updated', { title: st.title, explicitSet: true });
        }
      }).catch(function () {});
    }
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  var nativeUpdateStatus = { status: 'idle', version: '', progress: null, errorMsg: null };
  var RUST_SHORTCUTS = (!isOverlay && window.__EF_RUST_SHORTCUTS__) || [];
  // What the main process does for its built-in shortcuts, done here until it runs.
  var LOCAL_SHORTCUTS = {
    'CommandOrControl+Shift+P': 'shortcut:command-palette',
    'Alt+CommandOrControl+B': 'shortcut:resume-chat',
    'Alt+CommandOrControl+H': 'shortcut:show-history'
  };
  if (isOverlay && typeof window.require !== 'function') {
    // Pages the main process builds as data: URLs use nodeIntegration-style require('electron').
    window.require = function (name) {
      if (name === 'electron') return electronModule;
      throw new Error('[EverFern] overlay pages cannot require ' + name);
    };
  }
  if (T().event && T().event.listen) {
    ['chat:title-updated', 'mcp:changed'].forEach(function (channel) {
      T().event.listen(channel, function (event) {
        emitEvent(channel, [event.payload]);
      }).catch(function () {});
    });
  }
  if (!isOverlay && T().event && T().event.listen) {
    T().event.listen('system:ocr-progress', function (event) {
      emitEvent('system:ocr-progress', [event.payload]);
    }).catch(function () {});
    T().event.listen('ef-overlay-closed', function (event) { post({ t: 'overlay-closed', id: event.payload }); }).catch(function () {});
    T().event.listen('ef-shortcut', function (event) {
      var accel = event.payload.accelerator;
      if (cfg.port || !LOCAL_SHORTCUTS[accel]) post({ t: 'shortcut', accelerator: accel });
      else emitEvent(LOCAL_SHORTCUTS[accel], []); // the debug window needs the main process; skipped
    }).catch(function () {});
    T().event.listen('ef-sidecar-ready', function (event) { useAddr(event.payload); }).catch(function () {});
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
  if (cfg.port || isOverlay) connect();
  else invokeRust('ef_sidecar', { start: false }).then(useAddr, function () {});
  if (!isOverlay) { installSiteScheme(); installWebviews(); }
  if (cfg.autoUpdate && !isOverlay) setTimeout(function () {
    invokeRust('ef_update', { install: false }).catch(function (error) {
      nativeUpdateStatus.status = 'error'; nativeUpdateStatus.errorMsg = String(error);
    });
  }, 15000);
  if (!isOverlay) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchWindow); else watchWindow();
  }

  // The unchanged compiled preload runs here, against the shim above.
  (function (require, module, exports, process) {
    /*__EF_PRELOAD__*/
  })(function (name) {
    if (name === 'electron') return electronModule;
    throw new Error('[EverFern] preload cannot require ' + name);
  }, { exports: {} }, {}, { platform: cfg.platform || 'win32', env: {}, versions: {}, type: 'renderer', argv: [] });
})();
