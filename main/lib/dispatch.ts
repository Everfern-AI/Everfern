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
  private isConnected: boolean = false;
  private apiUrl: string = 'https://api.everfern.app';
  private token: string | null = null;

  private onActiveCallback: (() => void) | null = null;

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

  /**
   * Initialize the Dispatch service with PIN pairing configuration
   */
  public async initialize(config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }, onActive?: () => void) {
    if (!config.url || !config.key || !config.userId || !config.token) {
      console.warn(`DispatchService: Missing Supabase credentials or User ID. URL: ${!!config.url}, Key: ${!!config.key}, UserID: ${!!config.userId}, Token: ${!!config.token}`);
      return;
    }

    this.userId = config.userId;
    this.sessionId = config.sessionId;
    this.apiUrl = config.apiUrl || 'https://api.everfern.app';
    this.token = config.token;
    this.onActiveCallback = onActive || null;
    
    // Create Supabase client with the user's access token (for DB queries)
    this.supabase = createClient(config.url, config.key, {
      global: {
        headers: {
          Authorization: `Bearer ${config.token}`
        }
      }
    });

    // Initialize Socket.io
    this.socket = io(this.apiUrl, {
      auth: { token: config.token }
    });
    
    this.socket.on('connect', () => {
      console.log('DispatchService: Socket.io connected');
    });

    this.socket.on('disconnect', () => {
      console.log('DispatchService: Socket.io disconnected');
      this.isConnected = false;
    });

    await this.setupPairing(config.sessionId, config.pinCode, config.isForever);
  }

  public async restoreSession() {
    if (!this.token) return { success: false, error: 'No token' };
    
    try {
      const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/api/dispatch/session/current?device_name=${encodeURIComponent(os.hostname())}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (!response.ok) return { success: false };
      
      const data = await response.json();
      if (data.session) {
        this.sessionId = data.session.id;
        console.log(`DispatchService: Restoring session ${this.sessionId}`);
        
        if (data.session.status === 'active') {
          if (this.onActiveCallback) this.onActiveCallback();
          this.setupCommandChannel();
        }
        
        this.listenToSession(this.sessionId as string);
        return { success: true, session: data.session };
      }
      return { success: false };
    } catch (err) {
      console.error('DispatchService: Failed to restore session', err);
      return { success: false, error: err };
    }
  }

  private async setupPairing(sessionId: string, pinCode: string, isForever: boolean = false) {
    if (!this.supabase) return;

    try {
      // Register device as online
      await this.supabase.from('devices').upsert({
        id: this.deviceId,
        user_id: this.userId,
        device_name: os.hostname(),
        status: 'online'
      }, { onConflict: 'id' });

      // Create the dispatch session via Python backend API
      const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/api/dispatch/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          pin_code: pinCode,
          device_name: os.hostname(),
          is_forever: isForever
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('DispatchService: Failed to create session via API:', errorData);
        throw new Error(errorData.error || 'Failed to create session');
      }

      console.log(`DispatchService: Session ${sessionId} created. Waiting for PIN pairing...`);
      this.listenToSession(sessionId);
    } catch (err) {
      console.error('DispatchService: Error setting up connection', err);
      throw err;
    }
  }

  private listenToSession(sessionId: string) {
    if (!this.socket) return;
    
    // Join the session room
    this.socket.emit('join_session', { session_id: sessionId });

    // Listen for session updates via Socket.IO
    this.socket.on('broadcast', (payload: any) => {
      if (payload.event === 'dispatch_connected') {
        console.log('DispatchService: Web app connected via Socket.IO Broadcast! Activating command channel.');
        if (this.onActiveCallback) {
          this.onActiveCallback();
        }
        this.setupCommandChannel();
      } else if (payload.event === 'dispatch_closed') {
        console.log('DispatchService: Session closed remotely.');
        this.disconnect();
      }
    });

    // Handle graceful shutdown to mark offline
    process.on('exit', () => this.disconnect());
    process.on('SIGINT', () => {
      this.disconnect().then(() => process.exit(0));
    });
  }

  private async setupCommandChannel() {
    if (!this.socket || !this.userId) return;

    this.socket.emit('join_session', { session_id: `dispatch:user_${this.userId}` });
    
    // Commands will be received on the main broadcast handler, 
    // but since we only have one 'broadcast' event listener in Socket.io natively without removing previous ones,
    // we should just add another listener or handle it centrally.
    // Actually socket.on appends listeners.
    this.socket.on('broadcast', (payload: any) => {
      if (payload.event === 'command') {
        this.handleIncomingCommand(payload.payload);
      }
    });

    this.isConnected = true;
    console.log('DispatchService: Connected to Dispatch Command Channel via Socket.IO.');
  }

  private handleIncomingCommand(payload: any) {
    console.log('DispatchService: Received command:', payload);
    // Echo back a response for now
    this.broadcastToWeb('command_ack', {
      status: 'received',
      command: payload
    });
  }

  public broadcastToWeb(event: string, data: any) {
    if (!this.socket || !this.isConnected || !this.userId) return;
    this.socket.emit('broadcast', {
      room: `dispatch:user_${this.userId}`,
      event: event,
      payload: data
    });
  }

  public async disconnect() {
    if (!this.supabase || !this.userId) return;
    try {
      await this.supabase.from('devices').update({ status: 'offline' }).eq('id', this.deviceId);
      
      if (this.sessionId) {
        await this.supabase.from('dispatch_sessions').update({ status: 'closed' }).eq('id', this.sessionId);
      }
      
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.isConnected = false;
      this.sessionId = null;
    } catch (err) {
      console.error('DispatchService: Error disconnecting', err);
    }
  }
}
