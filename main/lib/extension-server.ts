import * as http from 'http';
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';

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

  start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '', `http://localhost:${this.port}`);

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
    this.wss = new WebSocketServer({ server: this.server });

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

export const bridgeServer = new ExtensionBridgeServer();
