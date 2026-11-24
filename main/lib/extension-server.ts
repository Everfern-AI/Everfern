import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID, timingSafeEqual } from 'crypto';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';

const EXTENSION_ORIGIN_PATTERNS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i];
const DEV_ORIGIN_PATTERN = /^http:\/\/localhost:(3001|5173)(?:\/|$)/;

/**
 * EverFern Localhost Bridge Server (WebSocket Edition)
 * 
 * Provides a low-latency, bi-directional communication hub between the 
 * Chrome Extension and the Electron App.
 */
class ExtensionBridgeServer extends EventEmitter {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 4001;
  private activeSessions: Map<string, { id: string; url: string; title: string }> = new Map();
  private nextRequestId = 1;
  private pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: NodeJS.Timeout }>();
  private bridgeToken = '';
  private lastUpgradeRejectLogAt = 0;

  /**
   * Pairing token for defense-in-depth on the localhost bridge (MP-SEC-06).
   * Loaded once per server start; persisted to ~/.everfern/bridge-token.json (0600).
   * The 0600 hardening is POSIX-only: Windows ignores chmod and relies on its
   * same-user permission model instead.
   */
  getBridgeToken(): string {
    return this.bridgeToken;
  }

  private isAllowedHttpOrigin(origin: string): boolean {
    if (EXTENSION_ORIGIN_PATTERNS.some(p => p.test(origin))) return true;
    if (process.env.NODE_ENV !== 'production' && DEV_ORIGIN_PATTERN.test(origin)) return true;
    return false;
  }

  private tokenMatches(candidate: string | null): boolean {
    if (!candidate || !this.bridgeToken) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.bridgeToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private loadBridgeToken() {
    const tokenFile = path.join(os.homedir(), '.everfern', 'bridge-token.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (parsed && typeof parsed.token === 'string' && parsed.token) {
        this.bridgeToken = parsed.token;
        // Re-harden pre-existing token files that may have been written with
        // looser modes (POSIX only — Windows ignores chmod, see JSDoc above).
        if (process.platform !== 'win32') fs.chmodSync(tokenFile, 0o600);
        return;
      }
    } catch { /* regenerate below */ }
    this.bridgeToken = randomUUID();
    try {
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, JSON.stringify({ token: this.bridgeToken }), { mode: 0o600 });
      fs.chmodSync(tokenFile, 0o600);
    } catch (e) {
      console.warn('[BridgeServer] ⚠️ Could not persist bridge token:', e);
    }
  }

  private logRejectedUpgrade(origin: string | undefined) {
    const now = Date.now();
    if (now - this.lastUpgradeRejectLogAt < 60000) return;
    this.lastUpgradeRejectLogAt = now;
    console.warn(`[BridgeServer] 🚫 Rejected WebSocket upgrade from unauthorized origin: ${origin ? origin.slice(0, 100) : '<none>'}`);
  }

  start() {
    if (this.server) return;

    this.loadBridgeToken();

    this.server = http.createServer((req, res) => {
      // CORS: reflect Origin only for known extension/dev origins (MP-SEC-06)
      const origin = req.headers.origin;
      if (origin && this.isAllowedHttpOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-everfern-bridge');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '', `http://localhost:${this.port}`);

      // CSRF guard: state-changing requests must carry a non-forgeable custom header
      if (
        (url.pathname === '/event' || url.pathname === '/wake') &&
        req.method !== 'GET' &&
        req.headers['x-everfern-bridge'] !== '1'
      ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // ── HTTP Routes ───────────────────────────────────────────────────────

      // 1. Handshake / Heartbeat (Source of Truth)
      if (url.pathname === '/handshake') {
        const sessionId = url.searchParams.get('sessionId');
        const session = sessionId ? this.activeSessions.get(sessionId) : Array.from(this.activeSessions.values())[0];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: session ? 'active' : 'idle',
          sessionActive: !!session,
          playwrightSession: session ? {
              id: session.id,
              active: true,
              url: session.url,
              title: session.title
          } : null,
          timestamp: Date.now()
        }));
        return;
      }


      // 2. Event Ingest (Legacy Fallback)
      if (url.pathname === '/event' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            // Tasks start an agent run, so they are only taken from the extension's socket.
            if (event?.type === 'user-task') {
              res.writeHead(403);
              res.end('Tasks must come from the extension');
              return;
            }
            this.emit('extension-event', event);
            res.writeHead(200);
            res.end(JSON.stringify({ received: true }));
          } catch (e) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }

      if (url.pathname === '/wake') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <title>EverFern Navis — Active</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: radial-gradient(circle at top left, #1c1a17, #0e0d0c);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #eae7e0;
      text-align: center;
    }
    .card {
      box-sizing: border-box;
      max-width: 420px;
      width: 90%;
      padding: 40px 30px;
      border-radius: 28px;
      background: rgba(30, 28, 25, 0.7);
      border: 1px solid rgba(222, 215, 202, 0.1);
      backdrop-filter: blur(12px);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      animation: fadeIn 0.8s ease-out;
    }
    .orb {
      width: 72px;
      height: 72px;
      margin: 0 auto 24px;
      border-radius: 999px;
      background: radial-gradient(circle at 30% 24%, #ffffff 0%, #38bdf8 30%, #3b82f6 60%, #8b5cf6 100%);
      box-shadow: 0 0 35px rgba(59, 130, 246, 0.4);
      animation: pulse 3s ease-in-out infinite;
    }
    h2 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 10px 0;
      background: linear-gradient(135deg, #fff 0%, #d4cfc5 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.02em;
    }
    p {
      color: #a19a91;
      font-size: 14.5px;
      line-height: 1.6;
      margin: 0 0 24px 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 999px;
      color: #34d399;
      font-size: 12.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(0.96); filter: brightness(1); }
      50% { transform: scale(1.04); filter: brightness(1.1); }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="orb"></div>
    <h2>Navis Companion Active</h2>
    <p>The companion extension has successfully connected to the desktop app. You can safely keep this tab open or close it at any time.</p>
    <div class="status">
      <span style="width: 6px; height: 6px; background: #10b981; border-radius: 999px; display: inline-block;"></span>
      Connected
    </div>
  </div>
</body>
</html>`);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // ── WebSocket Server ──────────────────────────────────────────────────
    this.wss = new WebSocketServer({ noServer: true });

    // Origin/token validation on upgrade (MP-SEC-06)
    this.server.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      const isExtensionOrigin = !!origin && EXTENSION_ORIGIN_PATTERNS.some(p => p.test(origin));
      const token = new URL(req.url || '', `http://localhost:${this.port}`).searchParams.get('token');
      if (!isExtensionOrigin && !this.tokenMatches(token)) {
        socket.destroy();
        this.logRejectedUpgrade(origin);
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, ws => this.wss!.emit('connection', ws, req));
    });

    this.wss.on('connection', (ws) => {
      console.log('[BridgeServer] 🔌 Extension connected via WebSocket');
      
      // Force immediate activation state on the extension if sessions are active
      if (this.activeSessions.size > 0) {
          const firstSession = Array.from(this.activeSessions.values())[0];
          ws.send(JSON.stringify({
              type: 'command',
              command: 'activate-extension',
              data: { 
                  sessionId: firstSession.id, 
                  playwrightDetected: true,
                  url: firstSession.url,
                  title: firstSession.title
              }
          }));
      }

      // Send initial state
      this.sendState(ws);

      ws.on('message', (message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (payload.type !== 'heartbeat') {
            console.log(`[BridgeServer] 📥 Message received [${payload.type}]`);
          }

          if (payload.type === 'response' && payload.requestId) {
            const pending = this.pendingRequests.get(payload.requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(payload.requestId);
              if (payload.success === false) {
                pending.reject(new Error(payload.error || 'Extension command failed'));
              } else {
                pending.resolve(payload.data);
              }
            }
            return;
          }
          
          if (payload.type === 'handshake') {
              console.log(`[BridgeServer] 👋 Handshake from extension: ${payload.extensionId}`);
              this.emit('extension-connected', payload);
          }
          
          this.emit('extension-event', payload);
        } catch (e) {
          console.error('[BridgeServer] ❌ Failed to parse WS message:', e);
        }
      });

      ws.on('close', () => {
          console.log('[BridgeServer] 🔌 Extension disconnected');
          this.emit('extension-disconnected');
      });
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[BridgeServer] 🚀 Real-time localhost bridge active on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('[BridgeServer] Error:', err);
    });
  }

  setSession(id: string | null, url = '', title = '') {
    if (!id) {
        this.activeSessions.clear();
    } else {
        this.activeSessions.set(id, { id, url, title });
    }
    console.log(`[BridgeServer] Session updated: ${id || 'all cleared'} (${url})`);
    
    // Broadcast state change to all connected extensions
    this.broadcastState();
  }

  private broadcastState() {
    if (!this.wss) return;
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        this.sendState(client);
      }
    });
  }

  private sendState(ws: WebSocket) {
    const sessions = Array.from(this.activeSessions.values());
    ws.send(JSON.stringify({
      type: 'state-update',
      data: {
        status: sessions.length > 0 ? 'active' : 'idle',
        sessionActive: sessions.length > 0,
        sessions: sessions, // All active sessions
        playwrightSession: sessions[0] || null, // Primary session for popup
        timestamp: Date.now()
      }
    }));
  }

  /**
   * Send a direct command to all connected extension instances
   */
  broadcastCommand(command: string, data: any = {}) {
    if (!this.wss) return;
    console.log(`[BridgeServer] 📢 Broadcasting command: ${command}`);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'command',
          command,
          data
        }));
      }
    });
  }

  hasConnectedExtensions(): boolean {
    if (!this.wss) return false;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  getStatus() {
    return {
      listening: !!this.server,
      port: this.port,
      connectedExtensions: this.wss
        ? Array.from(this.wss.clients).filter(client => client.readyState === WebSocket.OPEN).length
        : 0,
      sessions: Array.from(this.activeSessions.values()),
    };
  }

  waitForExtensionConnection(timeoutMs = 10000): Promise<boolean> {
    if (this.hasConnectedExtensions()) return Promise.resolve(true);

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.off('extension-connected', onConnected);
        resolve(false);
      }, timeoutMs);
      const onConnected = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      this.once('extension-connected', onConnected);
    });
  }

  sendRequest(command: string, data: any = {}, timeoutMs = 10000): Promise<any> {
    if (!this.wss) return Promise.reject(new Error('Extension bridge server is not running'));

    const client = Array.from(this.wss.clients).find(c => c.readyState === WebSocket.OPEN);
    if (!client) return Promise.reject(new Error('No Navis companion extension is connected'));

    const requestId = `navis-${Date.now()}-${this.nextRequestId++}`;
    const payload = {
      type: 'command',
      command,
      requestId,
      data,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timed out waiting for Navis extension command: ${command}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      client.send(JSON.stringify(payload));
    });
  }

  stop() {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Extension bridge server stopped'));
      this.pendingRequests.delete(requestId);
    }
    this.wss?.close();
    this.server?.close();
    this.server = null;
    this.wss = null;
  }
}

/**
 * Under the Tauri shell the bridge port belongs to Rust (src-tauri/src/navis.rs), so the
 * extension can connect while Node is not running. Node connects to it as the one desktop
 * client and keeps the same API, so callers do not change.
 */
class RustBridgeClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private port = Number(process.env.EF_NAVIS_PORT) || 4001;
  private bridgeToken = '';
  private running = false;
  private retryMs = 500;
  private retryTimer: NodeJS.Timeout | null = null;
  private connected = 0;
  private sessions: Array<{ id: string; url: string; title: string }> = [];
  private nextRequestId = 1;
  private pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: NodeJS.Timeout }>();
  /** The last session update, replayed after a reconnect. */
  private lastSession: { id: string | null; url: string; title: string } | null = null;
  private warnedError = false;
  /** Extension events that arrive before anything listens (the sidecar connects early). */
  private backlog: any[] = [];

  constructor() {
    super();
    this.on('newListener', (event: string | symbol) => {
      if (event !== 'extension-event' || !this.backlog.length) return;
      // After the listener is attached.
      setImmediate(() => {
        const held = this.backlog.splice(0);
        for (const payload of held) this.emit('extension-event', payload);
      });
    });
  }

  getBridgeToken(): string {
    return this.bridgeToken;
  }

  start() {
    if (this.running) return;
    this.running = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.everfern', 'bridge-token.json'), 'utf8'));
      this.bridgeToken = typeof parsed?.token === 'string' ? parsed.token : '';
    } catch {
      this.bridgeToken = '';
    }
    this.connect();
  }

  private connect() {
    if (!this.running) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/desktop?token=${encodeURIComponent(this.bridgeToken)}`);
    this.socket = ws;
    ws.on('open', () => {
      this.retryMs = 500;
      this.warnedError = false;
      console.log(`[Bridge] Connected to the Navis bridge on 127.0.0.1:${this.port}`);
      if (this.lastSession) ws.send(JSON.stringify({ type: 'session', ...this.lastSession }));
    });
    ws.on('message', raw => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'bridge-status') {
        const had = this.connected;
        this.connected = Number(msg.connected) || 0;
        this.sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
        if (!had && this.connected) this.emit('extension-connected', {});
      } else if (msg.type === 'response' && msg.requestId && this.pendingRequests.has(msg.requestId)) {
        const pending = this.pendingRequests.get(msg.requestId)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.requestId);
        if (msg.success === false) pending.reject(new Error(msg.error || 'Navis extension command failed'));
        else pending.resolve(msg.data);
      } else if (msg.type === 'extension-connected') {
        this.emit('extension-connected', msg.payload);
      } else if (msg.type === 'extension-event') {
        if (this.listenerCount('extension-event')) this.emit('extension-event', msg.payload);
        else if (this.backlog.push(msg.payload) > 200) this.backlog.shift();
      }
    });
    ws.on('error', err => {
      // Reconnects on close; warn once per outage.
      if (!this.warnedError) console.warn(`[Bridge] Navis bridge on port ${this.port} unreachable: ${err.message}`);
      this.warnedError = true;
    });
    ws.on('close', () => {
      if (this.socket === ws) this.socket = null;
      this.connected = 0;
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Navis bridge connection closed'));
        this.pendingRequests.delete(id);
      }
      if (!this.running) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10000);
    });
  }

  private send(message: any): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  setSession(id: string | null, url = '', title = '') {
    this.lastSession = { id, url, title };
    this.send({ type: 'session', id, url, title });
  }

  broadcastCommand(command: string, data: any = {}) {
    this.send({ type: 'broadcast', command, data });
  }

  hasConnectedExtensions(): boolean {
    return this.connected > 0;
  }

  getStatus() {
    return {
      listening: this.socket?.readyState === WebSocket.OPEN,
      port: this.port,
      connectedExtensions: this.connected,
      sessions: this.sessions,
    };
  }

  waitForExtensionConnection(timeoutMs = 10000): Promise<boolean> {
    if (this.hasConnectedExtensions()) return Promise.resolve(true);
    return new Promise(resolve => {
      const onConnected = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        this.off('extension-connected', onConnected);
        resolve(false);
      }, timeoutMs);
      this.once('extension-connected', onConnected);
    });
  }

  sendRequest(command: string, data: any = {}, timeoutMs = 10000): Promise<any> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Extension bridge server is not running'));
    if (!this.connected) return Promise.reject(new Error('No Navis companion extension is connected'));
    const requestId = `navis-${Date.now()}-${this.nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timed out waiting for Navis extension command: ${command}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      this.send({ type: 'request', command, requestId, data });
    });
  }

  stop() {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const bridgeServer: ExtensionBridgeServer | RustBridgeClient =
  process.env.EVERFERN_SHELL === 'tauri' ? new RustBridgeClient() : new ExtensionBridgeServer();
