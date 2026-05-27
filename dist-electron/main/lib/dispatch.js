"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchService = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const socket_io_client_1 = require("socket.io-client");
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
class DispatchService {
    static instance;
    supabase = null;
    socket = null;
    deviceId;
    userId = null;
    sessionId = null;
    isConnected = false;
    apiUrl = 'https://api.everfern.app';
    token = null;
    onActiveCallback = null;
    constructor() {
        const configPath = path_1.default.join(os_1.default.homedir(), '.everfern', 'device_id.txt');
        if (fs_1.default.existsSync(configPath)) {
            this.deviceId = fs_1.default.readFileSync(configPath, 'utf8').trim();
        }
        else {
            this.deviceId = (0, crypto_1.randomUUID)();
            fs_1.default.mkdirSync(path_1.default.dirname(configPath), { recursive: true });
            fs_1.default.writeFileSync(configPath, this.deviceId);
        }
    }
    static getInstance() {
        if (!DispatchService.instance) {
            DispatchService.instance = new DispatchService();
        }
        return DispatchService.instance;
    }
    /**
     * Initialize the Dispatch service with PIN pairing configuration
     */
    async initialize(config, onActive) {
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
        this.supabase = (0, supabase_js_1.createClient)(config.url, config.key, {
            global: {
                headers: {
                    Authorization: `Bearer ${config.token}`
                }
            }
        });
        // Initialize Socket.io
        this.socket = (0, socket_io_client_1.io)(this.apiUrl, {
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
    async restoreSession() {
        if (!this.token)
            return { success: false, error: 'No token' };
        try {
            const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/api/dispatch/session/current?device_name=${encodeURIComponent(os_1.default.hostname())}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok)
                return { success: false };
            const data = await response.json();
            if (data.session) {
                this.sessionId = data.session.id;
                console.log(`DispatchService: Restoring session ${this.sessionId}`);
                if (data.session.status === 'active') {
                    if (this.onActiveCallback)
                        this.onActiveCallback();
                    this.setupCommandChannel();
                }
                this.listenToSession(this.sessionId);
                return { success: true, session: data.session };
            }
            return { success: false };
        }
        catch (err) {
            console.error('DispatchService: Failed to restore session', err);
            return { success: false, error: err };
        }
    }
    async setupPairing(sessionId, pinCode, isForever = false) {
        if (!this.supabase)
            return;
        try {
            // Register device as online
            await this.supabase.from('devices').upsert({
                id: this.deviceId,
                user_id: this.userId,
                device_name: os_1.default.hostname(),
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
                    device_name: os_1.default.hostname(),
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
        }
        catch (err) {
            console.error('DispatchService: Error setting up connection', err);
            throw err;
        }
    }
    listenToSession(sessionId) {
        if (!this.socket)
            return;
        // Join the session room
        this.socket.emit('join_session', { session_id: sessionId });
        // Listen for session updates via Socket.IO
        this.socket.on('broadcast', (payload) => {
            if (payload.event === 'dispatch_connected') {
                console.log('DispatchService: Web app connected via Socket.IO Broadcast! Activating command channel.');
                if (this.onActiveCallback) {
                    this.onActiveCallback();
                }
                this.setupCommandChannel();
            }
            else if (payload.event === 'dispatch_closed') {
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
    async setupCommandChannel() {
        if (!this.socket || !this.userId)
            return;
        this.socket.emit('join_session', { session_id: `dispatch:user_${this.userId}` });
        // Commands will be received on the main broadcast handler, 
        // but since we only have one 'broadcast' event listener in Socket.io natively without removing previous ones,
        // we should just add another listener or handle it centrally.
        // Actually socket.on appends listeners.
        this.socket.on('broadcast', (payload) => {
            if (payload.event === 'command') {
                this.handleIncomingCommand(payload.payload);
            }
        });
        this.isConnected = true;
        console.log('DispatchService: Connected to Dispatch Command Channel via Socket.IO.');
    }
    handleIncomingCommand(payload) {
        console.log('DispatchService: Received command:', payload);
        // Echo back a response for now
        this.broadcastToWeb('command_ack', {
            status: 'received',
            command: payload
        });
    }
    broadcastToWeb(event, data) {
        if (!this.socket || !this.isConnected || !this.userId)
            return;
        this.socket.emit('broadcast', {
            room: `dispatch:user_${this.userId}`,
            event: event,
            payload: data
        });
    }
    async disconnect() {
        if (!this.supabase || !this.userId)
            return;
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
        }
        catch (err) {
            console.error('DispatchService: Error disconnecting', err);
        }
    }
}
exports.DispatchService = DispatchService;
