import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { io, Socket } from 'socket.io-client';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export class DispatchService {
  private static instance: DispatchService;
  private supabase: SupabaseClient | null = null;
  private socket: Socket | null = null;
  private deviceId: string;
  private userId: string | null = null;
  private sessionId: string | null = null;
  private apiUrl: string = 'https://api.everfern.app';
  private token: string | null = null;

  private onActiveCallback: (() => void) | null = null;
  /** Called when a command arrives from the web. */
  public onCommand: ((command: string) => void) | null = null;

  private constructor() {
    const configPath = path.join(os.homedir(), '.everfern', 'device_id.txt');
    if (fs.existsSync(configPath)) {
      this.deviceId = fs.readFileSync(configPath, 'utf8').trim();
    } else {
      this.deviceId = randomUUID();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, this.deviceId);
    }
  }

  public static getInstance(): DispatchService {
    if (!DispatchService.instance) {
      DispatchService.instance = new DispatchService();
    }
    return DispatchService.instance;
  }

  // ── Public: check if socket is live ───────────────────────────────────────
  public get isSocketConnected(): boolean {
    return !!this.socket?.connected;
  }

  /**
   * Initialize the Dispatch service.
   */
  public async initialize(
    config: {
      sessionId: string;
      pinCode: string;
      url: string;
      apiUrl: string;
      key: string;
      token: string;
      userId: string;
      isForever?: boolean;
    },
    onActive?: () => void
  ) {
    if (!config.url || !config.key || !config.userId || !config.token) {
      console.warn('[DispatchService] Missing credentials — aborting init.');
      return;
    }

    this.userId        = config.userId;
    this.sessionId     = config.sessionId;
    this.apiUrl        = config.apiUrl || 'https://api.everfern.app';
    this.token         = config.token;
    this.onActiveCallback = onActive || null;

    this.supabase = createClient(config.url, config.key, {
      global: { headers: { Authorization: `Bearer ${config.token}` } }
    });

    // Disconnect any existing socket cleanly before making a new one
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io(this.apiUrl, {
      auth: { token: config.token },
      transports: ['websocket', 'polling'],   // prefer WebSocket, fall back to polling
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[DispatchService] Socket connected:', this.socket!.id);
      this.joinUserRoom();
    });

    this.socket.on('connect_error', (err) => {
      console.error('[DispatchService] Socket connect_error:', err.message);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[DispatchService] Socket disconnected:', reason);
    });

    // Central broadcast handler
    this.socket.on('broadcast', (payload: any) => {
      const event = payload?.event;
      const data  = payload?.payload;

      console.log('[DispatchService] broadcast received:', event);

      if (event === 'dispatch_connected') {
        console.log('[DispatchService] Web app connected — activating.');
        if (this.onActiveCallback) this.onActiveCallback();

      } else if (event === 'command') {
        this.handleIncomingCommand(data);

      } else if (event === 'ping') {
        console.log('[DispatchService] ping received — sending pong');
        this.broadcastToWeb('pong', {
          timestamp:   data?.timestamp,
          respondedAt: Date.now(),
          deviceName:  os.hostname(),
        });

      } else if (event === 'dispatch_closed') {
        console.log('[DispatchService] Remote close requested.');
        this.disconnect();
      }
    });

    // Graceful shutdown
    process.on('exit', () => this.disconnect());
    process.on('SIGINT', () => { this.disconnect().then(() => process.exit(0)); });

    // Only create a new session if we actually have pairing credentials.
    // When restoring an existing session, these will be empty.
    if (config.sessionId && config.pinCode) {
      await this.setupPairing(config.sessionId, config.pinCode, config.isForever);
    }
  }

  // ── Restore a previously active session ───────────────────────────────────
  public async restoreSession() {
    if (!this.token) return { success: false, error: 'No token' };

    try {
      const res = await fetch(
        `${this.apiUrl.replace(/\/$/, '')}/api/dispatch/session/current?device_name=${encodeURIComponent(os.hostname())}`,
        { headers: { Authorization: `Bearer ${this.token}` } }
      );
      if (!res.ok) return { success: false };

      const data = await res.json();
      if (data.session) {
        this.sessionId = data.session.id;
        console.log(`[DispatchService] Restoring session ${this.sessionId}`);
        if (data.session.status === 'active' && this.onActiveCallback) {
          this.onActiveCallback();
        }
        return { success: true, session: data.session };
      }
      return { success: false };
    } catch (err) {
      console.error('[DispatchService] restoreSession error:', err);
      return { success: false, error: err };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────
  private joinUserRoom() {
    if (!this.socket) return;
    
    if (this.userId) {
      const userRoom = `dispatch:user_${this.userId}`;
      this.socket.emit('join_session', { session_id: userRoom });
      console.log(`[DispatchService] Joined room: ${userRoom}`);
    }
    
    if (this.sessionId) {
      this.socket.emit('join_session', { session_id: this.sessionId });
      console.log(`[DispatchService] Joined room: ${this.sessionId}`);
    }
  }

  private async setupPairing(sessionId: string, pinCode: string, isForever = false) {
    if (!this.supabase) return;

    try {
      // Register device
      await this.supabase.from('devices').upsert({
        id: this.deviceId,
        user_id: this.userId,
        device_name: os.hostname(),
        status: 'online'
      }, { onConflict: 'id' });

      // Create dispatch session via backend
      const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}/api/dispatch/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          pin_code:   pinCode,
          device_name: os.hostname(),
          is_forever:  isForever
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[DispatchService] Failed to create session:', err);
        throw new Error(err.error || 'Failed to create session');
      }

      console.log(`[DispatchService] Session ${sessionId} created. Awaiting PIN entry from web…`);
    } catch (err) {
      console.error('[DispatchService] setupPairing error:', err);
      throw err;
    }
  }

  private handleIncomingCommand(payload: any) {
    const action: string = payload?.action || payload?.command || String(payload);
    console.log('[DispatchService] Command received:', action);

    // ACK immediately so the web UI knows the desktop got it
    this.broadcastToWeb('command_ack', { status: 'received', command: action });

    if (this.onCommand) {
      try {
        this.onCommand(action);
      } catch (err) {
        console.error('[DispatchService] onCommand threw:', err);
        this.broadcastToWeb('state_update', {
          messages: [{
            id: Date.now().toString(),
            role: 'assistant',
            content: `❌ Error running command: ${err}`,
            timestamp: Date.now()
          }]
        });
      }
    } else {
      console.warn('[DispatchService] No onCommand handler registered.');
      this.broadcastToWeb('state_update', {
        messages: [{
          id: Date.now().toString(),
          role: 'assistant',
          content: `⚡ Command received: "${action}"\n\nThe desktop received it — make sure you have the chat window open.`,
          timestamp: Date.now()
        }]
      });
    }
  }

  /**
   * Emit an event back to the web client via the server-side broadcast room.
   * NOTE: no isConnected gate — socket.connected is the ground truth.
   */
  public broadcastToWeb(event: string, data: any) {
    // Rely on Socket.IO's native offline buffer instead of dropping messages
    if (!this.socket) {
      console.warn('[DispatchService] broadcastToWeb skipped — no socket instance');
      return;
    }
    if (!this.userId) {
      console.warn('[DispatchService] broadcastToWeb skipped — no userId');
      return;
    }
    this.socket.emit('broadcast', {
      // The backend adds a 'session_' prefix when joining, so we must include it when broadcasting
      room:    `session_dispatch:user_${this.userId}`,
      event,
      payload: data,
    });
  }

  public async disconnect() {
    try {
      if (this.supabase && this.userId) {
        await this.supabase.from('devices')
          .update({ status: 'offline' })
          .eq('id', this.deviceId);

        if (this.sessionId) {
          await this.supabase.from('dispatch_sessions')
            .update({ status: 'closed' })
            .eq('id', this.sessionId);
        }
      }
    } catch (err) {
      console.error('[DispatchService] disconnect DB error:', err);
    } finally {
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }
      this.sessionId = null;
    }
  }
}
