//! Localhost bridge for the Navis companion browser extension (127.0.0.1:4001).
//!
//! This used to live in the Node main process (main/lib/extension-server.ts), which meant
//! the extension could only connect while Node ran. Rust now owns the port from launch:
//! HTTP routes, origin and token checks, the active-session state, and every extension
//! socket. Node, when it runs, connects as the one "desktop" client on `/desktop` with the
//! bridge token and keeps the same `bridgeServer` API (see extension-server.ts).
//!
//! Extension protocol (unchanged):
//!   server -> extension  {type:'state-update', data}  {type:'command', command, requestId?, data}
//!   extension -> server  {type:'handshake'|'heartbeat'|'response', ...}
//! Desktop protocol:
//!   desktop -> server    {type:'request', command, requestId, data}  {type:'broadcast', command, data}
//!                        {type:'session', id|null, url, title}
//!   server -> desktop    {type:'bridge-status', connected, sessions}  {type:'extension-connected', payload}
//!                        {type:'extension-event', payload}  extension responses as sent

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tungstenite::protocol::{Role, WebSocket};
use tungstenite::Message;

pub const DEFAULT_PORT: u16 = 4001;
const MAX_HEADER: usize = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;
/// Extension messages held while the desktop process starts.
const MAX_PENDING: usize = 200;
/// How long before a failed or slow start is tried again.
const WAKE_RETRY: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Extension,
    Desktop,
}

struct Client {
    kind: Kind,
    tx: Sender<String>,
}

#[derive(Clone)]
struct Session {
    id: String,
    url: String,
    title: String,
}

pub struct Hub {
    token: String,
    clients: Mutex<HashMap<u64, Client>>,
    /// Insertion order kept, like the JS Map.
    sessions: Mutex<Vec<Session>>,
    next_id: AtomicU64,
    last_reject_log: Mutex<Option<Instant>>,
    /// Starts the desktop (Node) process; set by the shell.
    wake: OnceLock<Box<dyn Fn() + Send + Sync>>,
    last_wake: Mutex<Option<Instant>>,
    /// Extension messages for the desktop that arrived before it connected.
    pending: Mutex<Vec<String>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_bytes(buf: &mut [u8]) -> io::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        let status = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                buf.as_mut_ptr(),
                buf.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status != 0 {
            return Err(io::Error::other(format!(
                "BCryptGenRandom failed: {status:#x}"
            )));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::fs::File::open("/dev/urandom")?.read_exact(buf)
    }
}

fn random_uuid() -> io::Result<String> {
    let mut b = [0u8; 16];
    random_bytes(&mut b)?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

/// The pairing token in `<everfern>/bridge-token.json`, created if missing or unreadable.
/// Same file and format as the Node server, so Node and the extension keep working.
pub fn load_bridge_token(everfern: &Path) -> io::Result<String> {
    let file = everfern.join("bridge-token.json");
    if let Ok(text) = std::fs::read_to_string(&file) {
        if let Some(t) = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("token").and_then(Value::as_str).map(str::to_string))
        {
            if !t.is_empty() {
                restrict(&file);
                return Ok(t);
            }
        }
    }
    let token = random_uuid()?;
    std::fs::create_dir_all(everfern)?;
    std::fs::write(&file, json!({ "token": token }).to_string())?;
    restrict(&file);
    Ok(token)
}

/// 0600 on POSIX; Windows relies on the per-user profile folder, as before.
fn restrict(_file: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(_file, std::fs::Permissions::from_mode(0o600));
    }
}

fn is_extension_origin(origin: &str) -> bool {
    let o = origin.to_ascii_lowercase();
    o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")
}

fn is_allowed_http_origin(origin: &str) -> bool {
    if is_extension_origin(origin) {
        return true;
    }
    // Dev pages (Next on 3001, Vite on 5173), as NODE_ENV !== 'production' allowed before.
    cfg!(debug_assertions)
        && ["http://localhost:3001", "http://localhost:5173"]
            .iter()
            .any(|p| origin == *p || origin.starts_with(&format!("{p}/")))
}

/// Constant-time comparison.
fn token_matches(candidate: Option<&str>, token: &str) -> bool {
    let Some(c) = candidate else { return false };
    if token.is_empty() || c.len() != token.len() {
        return false;
    }
    c.bytes()
        .zip(token.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(
                    std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"),
                    16,
                ) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn read_request(reader: &mut BufReader<TcpStream>) -> io::Result<Request> {
    let mut line = String::new();
    let mut total = reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        let n = reader.read_line(&mut h)?;
        total += n;
        if n == 0 || total > MAX_HEADER {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bad request headers",
            ));
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let (path, qs) = target.split_once('?').unwrap_or((&target, ""));
    let query = qs
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect();
    Ok(Request {
        method,
        path: path.to_string(),
        query,
        headers,
    })
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    cors: &[(String, String)],
    content_type: Option<&str>,
    body: &[u8],
) -> io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in cors {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(ct) = content_type {
        head.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

impl Hub {
    pub fn new(token: String) -> Arc<Hub> {
        Arc::new(Hub {
            token,
            clients: Mutex::new(HashMap::new()),
            sessions: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
            last_reject_log: Mutex::new(None),
            wake: OnceLock::new(),
            last_wake: Mutex::new(None),
            pending: Mutex::new(Vec::new()),
        })
    }

    fn sessions_json(&self) -> Vec<Value> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .map(|s| json!({ "id": s.id, "url": s.url, "title": s.title }))
            .collect()
    }

    fn state_update(&self) -> String {
        let sessions = self.sessions_json();
        json!({
            "type": "state-update",
            "data": {
                "status": if sessions.is_empty() { "idle" } else { "active" },
                "sessionActive": !sessions.is_empty(),
                "playwrightSession": sessions.first().cloned().unwrap_or(Value::Null),
                "sessions": sessions,
                "timestamp": now_ms(),
            }
        })
        .to_string()
    }

    /// What to call when an extension message needs the desktop process and it is not running.
    pub fn set_wake(&self, f: impl Fn() + Send + Sync + 'static) {
        let _ = self.wake.set(Box::new(f));
    }

    /// Sends to the desktop client. If none is connected, holds the message and starts the
    /// desktop process, which gets the held messages when it connects.
    fn to_desktop_or_wake(&self, text: &str) {
        {
            let clients = self.clients.lock().unwrap();
            if clients.values().any(|c| c.kind == Kind::Desktop) {
                for c in clients.values().filter(|c| c.kind == Kind::Desktop) {
                    let _ = c.tx.send(text.to_string());
                }
                return;
            }
            let mut pending = self.pending.lock().unwrap();
            if pending.len() >= MAX_PENDING {
                pending.remove(0);
            }
            pending.push(text.to_string());
        }
        let mut last = self.last_wake.lock().unwrap();
        if last.map(|t| t.elapsed() >= WAKE_RETRY).unwrap_or(true) {
            *last = Some(Instant::now());
            if let Some(wake) = self.wake.get() {
                eprintln!("[navis] extension message needs the background process; starting it");
                wake();
            }
        }
    }

    fn send_to(&self, kind: Kind, text: &str) {
        for c in self.clients.lock().unwrap().values() {
            if c.kind == kind {
                let _ = c.tx.send(text.to_string());
            }
        }
    }

    fn extension_count(&self) -> usize {
        self.clients
            .lock()
            .unwrap()
            .values()
            .filter(|c| c.kind == Kind::Extension)
            .count()
    }

    fn status_message(&self) -> String {
        json!({ "type": "bridge-status", "connected": self.extension_count(), "sessions": self.sessions_json() }).to_string()
    }

    fn broadcast_status(&self) {
        let msg = self.status_message();
        self.send_to(Kind::Desktop, &msg);
    }

    fn handshake_json(&self, session_id: Option<&String>) -> Value {
        let sessions = self.sessions.lock().unwrap();
        let session = match session_id {
            Some(id) => sessions.iter().find(|s| &s.id == id),
            None => sessions.first(),
        };
        json!({
            "success": true,
            "status": if session.is_some() { "active" } else { "idle" },
            "sessionActive": session.is_some(),
            "playwrightSession": session.map(|s| json!({ "id": s.id, "active": true, "url": s.url, "title": s.title })),
            "timestamp": now_ms(),
        })
    }

    fn set_session(&self, id: Option<&str>, url: &str, title: &str) {
        {
            let mut sessions = self.sessions.lock().unwrap();
            match id {
                None => sessions.clear(),
                Some(id) => {
                    let s = Session {
                        id: id.to_string(),
                        url: url.to_string(),
                        title: title.to_string(),
                    };
                    match sessions.iter_mut().find(|x| x.id == id) {
                        Some(existing) => *existing = s,
                        None => sessions.push(s),
                    }
                }
            }
        }
        let state = self.state_update();
        self.send_to(Kind::Extension, &state);
        self.broadcast_status();
    }

    /// A message from an extension socket.
    fn on_extension_message(&self, text: &str) {
        let Ok(payload) = serde_json::from_str::<Value>(text) else {
            eprintln!("[navis] could not parse a message from the extension");
            return;
        };
        match payload.get("type").and_then(Value::as_str) {
            // Answers to the desktop's requests go straight back to it.
            Some("response") if payload.get("requestId").is_some() => {
                self.send_to(Kind::Desktop, text)
            }
            Some("heartbeat") => {}
            // A browser starting reconnects the extension; that alone does not start Node.
            // Node learns the connection from bridge-status when it connects.
            Some("handshake") => {
                let ev = json!({ "type": "extension-connected", "payload": payload }).to_string();
                self.send_to(Kind::Desktop, &ev);
                self.send_to(
                    Kind::Desktop,
                    &json!({ "type": "extension-event", "payload": payload }).to_string(),
                );
            }
            // Anything else is for the desktop to act on.
            _ => self.to_desktop_or_wake(
                &json!({ "type": "extension-event", "payload": payload }).to_string(),
            ),
        }
    }

    /// A message from the desktop (Node) socket. Replies go to `reply`.
    fn on_desktop_message(&self, text: &str, reply: &Sender<String>) {
        let Ok(msg) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let str_of = |k: &str| msg.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let data = msg.get("data").cloned().unwrap_or_else(|| json!({}));
        match msg.get("type").and_then(Value::as_str) {
            Some("request") => {
                let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
                let target = {
                    let clients = self.clients.lock().unwrap();
                    let mut ext: Vec<_> = clients
                        .iter()
                        .filter(|(_, c)| c.kind == Kind::Extension)
                        .collect();
                    ext.sort_by_key(|(id, _)| **id);
                    ext.first().map(|(_, c)| c.tx.clone())
                };
                let command = json!({ "type": "command", "command": str_of("command"), "requestId": request_id, "data": data }).to_string();
                if target.map(|tx| tx.send(command).is_ok()) != Some(true) {
                    let _ = reply.send(
                        json!({ "type": "response", "requestId": request_id, "success": false, "error": "No Navis companion extension is connected" }).to_string(),
                    );
                }
            }
            Some("broadcast") => {
                let command =
                    json!({ "type": "command", "command": str_of("command"), "data": data })
                        .to_string();
                self.send_to(Kind::Extension, &command);
            }
            Some("session") => {
                let id = msg.get("id").and_then(Value::as_str);
                self.set_session(id, &str_of("url"), &str_of("title"));
            }
            _ => {}
        }
    }

    fn log_rejected(&self, origin: Option<&String>) {
        let mut last = self.last_reject_log.lock().unwrap();
        if last
            .map(|t| t.elapsed() < Duration::from_secs(60))
            .unwrap_or(false)
        {
            return;
        }
        *last = Some(Instant::now());
        let o = origin
            .map(|o| o.chars().take(100).collect::<String>())
            .unwrap_or_else(|| "<none>".into());
        eprintln!("[navis] rejected WebSocket upgrade from unauthorized origin: {o}");
    }
}

/// Starts the listener on a background thread. Errors (port taken) are returned, not fatal.
pub fn start(hub: Arc<Hub>, port: u16) -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    let port = listener.local_addr()?.port();
    std::thread::Builder::new()
        .name("navis-bridge".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let hub = hub.clone();
                let _ = std::thread::Builder::new()
                    .name("navis-conn".into())
                    .spawn(move || {
                        if let Err(e) = handle(hub, stream, port) {
                            if e.kind() != io::ErrorKind::UnexpectedEof
                                && e.kind() != io::ErrorKind::ConnectionReset
                            {
                                eprintln!("[navis] connection error: {e}");
                            }
                        }
                    });
            }
        })?;
    Ok(port)
}

fn handle(hub: Arc<Hub>, stream: TcpStream, _port: u16) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let req = read_request(&mut reader)?;
    let mut stream = stream;

    let origin = req.headers.get("origin").cloned();
    let upgrade = req
        .headers
        .get("upgrade")
        .map(|u| u.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);
    if upgrade {
        let token = req.query.get("token").map(String::as_str);
        let kind = if req.path == "/desktop" {
            // Only Node, which reads the token file, connects here; never a web origin.
            if origin.is_some() || !token_matches(token, &hub.token) {
                hub.log_rejected(origin.as_ref());
                return Ok(());
            }
            Kind::Desktop
        } else {
            let ext = origin.as_deref().map(is_extension_origin).unwrap_or(false);
            if !ext && !token_matches(token, &hub.token) {
                hub.log_rejected(origin.as_ref());
                return Ok(());
            }
            Kind::Extension
        };
        let Some(key) = req.headers.get("sec-websocket-key") else {
            return respond(&mut stream, "400 Bad Request", &[], None, b"");
        };
        let accept = tungstenite::handshake::derive_accept_key(key.as_bytes());
        stream.write_all(
            format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes(),
        )?;
        // Bytes the reader already buffered past the headers belong to the socket.
        let leftover = reader.buffer().to_vec();
        return serve_socket(hub, stream, leftover, kind);
    }

    let mut cors: Vec<(String, String)> = Vec::new();
    if let Some(o) = origin.as_deref().filter(|o| is_allowed_http_origin(o)) {
        cors.push(("Access-Control-Allow-Origin".into(), o.to_string()));
        cors.push(("Vary".into(), "Origin".into()));
    }
    cors.push((
        "Access-Control-Allow-Methods".into(),
        "GET, POST, OPTIONS".into(),
    ));
    cors.push((
        "Access-Control-Allow-Headers".into(),
        "Content-Type, x-everfern-bridge".into(),
    ));

    if req.method == "OPTIONS" {
        return respond(&mut stream, "204 No Content", &cors, None, b"");
    }
    // CSRF guard: state-changing requests must carry a custom header a page cannot forge.
    if (req.path == "/event" || req.path == "/wake")
        && req.method != "GET"
        && req.headers.get("x-everfern-bridge").map(String::as_str) != Some("1")
    {
        return respond(&mut stream, "403 Forbidden", &cors, None, b"Forbidden");
    }
    match (req.path.as_str(), req.method.as_str()) {
        ("/handshake", _) => {
            let body = hub.handshake_json(req.query.get("sessionId")).to_string();
            respond(
                &mut stream,
                "200 OK",
                &cors,
                Some("application/json"),
                body.as_bytes(),
            )
        }
        ("/event", "POST") => {
            let len: usize = req
                .headers
                .get("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if len > MAX_BODY {
                return respond(&mut stream, "413 Payload Too Large", &cors, None, b"");
            }
            let mut body = vec![0u8; len];
            reader.read_exact(&mut body)?;
            match serde_json::from_slice::<Value>(&body) {
                // Tasks start an agent run, so they are only taken from the extension's socket,
                // whose origin is checked, never from a plain HTTP post.
                Ok(event) if event.get("type").and_then(Value::as_str) == Some("user-task") => {
                    respond(
                        &mut stream,
                        "403 Forbidden",
                        &cors,
                        None,
                        b"Tasks must come from the extension",
                    )
                }
                Ok(event) => {
                    hub.to_desktop_or_wake(
                        &json!({ "type": "extension-event", "payload": event }).to_string(),
                    );
                    respond(&mut stream, "200 OK", &cors, None, br#"{"received":true}"#)
                }
                Err(_) => respond(&mut stream, "400 Bad Request", &cors, None, b"Invalid JSON"),
            }
        }
        ("/wake", _) => respond(
            &mut stream,
            "200 OK",
            &cors,
            Some("text/html"),
            WAKE_HTML.as_bytes(),
        ),
        _ => respond(&mut stream, "404 Not Found", &cors, None, b""),
    }
}

/// A stream that first yields bytes already read past the HTTP headers.
struct Prefixed {
    prefix: Vec<u8>,
    pos: usize,
    inner: TcpStream,
}

impl Read for Prefixed {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos < self.prefix.len() {
            let n = (self.prefix.len() - self.pos).min(buf.len());
            buf[..n].copy_from_slice(&self.prefix[self.pos..self.pos + n]);
            self.pos += n;
            return Ok(n);
        }
        self.inner.read(buf)
    }
}

impl Write for Prefixed {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.inner.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn serve_socket(hub: Arc<Hub>, stream: TcpStream, leftover: Vec<u8>, kind: Kind) -> io::Result<()> {
    // Short read timeout so one thread can both read and send queued messages.
    stream.set_read_timeout(Some(Duration::from_millis(15)))?;
    stream.set_nodelay(true)?;
    let mut ws = WebSocket::from_raw_socket(
        Prefixed {
            prefix: leftover,
            pos: 0,
            inner: stream,
        },
        Role::Server,
        None,
    );
    let (tx, rx): (Sender<String>, Receiver<String>) = channel();
    let id = hub.next_id.fetch_add(1, Ordering::Relaxed);

    if kind == Kind::Extension {
        eprintln!("[navis] extension connected");
        if let Some(first) = hub.sessions.lock().unwrap().first().cloned() {
            let _ = tx.send(
                json!({ "type": "command", "command": "activate-extension",
                    "data": { "sessionId": first.id, "playwrightDetected": true, "url": first.url, "title": first.title } })
                .to_string(),
            );
        }
        let _ = tx.send(hub.state_update());
    }
    if kind == Kind::Desktop {
        eprintln!("[navis] background process connected");
        let _ = tx.send(hub.status_message());
        // Insert and drain under the clients lock, so no held message is missed or reordered.
        let mut clients = hub.clients.lock().unwrap();
        clients.insert(
            id,
            Client {
                kind,
                tx: tx.clone(),
            },
        );
        for text in hub.pending.lock().unwrap().drain(..) {
            let _ = tx.send(text);
        }
        *hub.last_wake.lock().unwrap() = None;
    } else {
        hub.clients.lock().unwrap().insert(
            id,
            Client {
                kind,
                tx: tx.clone(),
            },
        );
        hub.broadcast_status();
    }

    let result = (|| -> io::Result<()> {
        loop {
            match ws.read() {
                Ok(Message::Text(t)) => match kind {
                    Kind::Extension => hub.on_extension_message(t.as_str()),
                    Kind::Desktop => hub.on_desktop_message(t.as_str(), &tx),
                },
                Ok(Message::Binary(b)) => {
                    if let Ok(t) = std::str::from_utf8(&b) {
                        match kind {
                            Kind::Extension => hub.on_extension_message(t),
                            Kind::Desktop => hub.on_desktop_message(t, &tx),
                        }
                    }
                }
                Ok(Message::Close(_)) => return Ok(()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) => {}
                Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                    return Ok(())
                }
                Err(e) => return Err(io::Error::other(e.to_string())),
            }
            let mut wrote = false;
            while let Ok(text) = rx.try_recv() {
                ws.write(Message::text(text))
                    .map_err(|e| io::Error::other(e.to_string()))?;
                wrote = true;
            }
            if wrote {
                match ws.flush() {
                    Ok(()) => {}
                    Err(tungstenite::Error::Io(e)) if e.kind() == io::ErrorKind::WouldBlock => {}
                    Err(e) => return Err(io::Error::other(e.to_string())),
                }
            }
        }
    })();

    hub.clients.lock().unwrap().remove(&id);
    if kind == Kind::Extension {
        eprintln!("[navis] extension disconnected");
        hub.broadcast_status();
    }
    result
}

const WAKE_HTML: &str = include_str!("navis-wake.html");

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;
    use tungstenite::client::IntoClientRequest;

    fn client(
        port: u16,
        path: &str,
        origin: Option<&str>,
    ) -> tungstenite::Result<WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>> {
        let mut req = format!("ws://127.0.0.1:{port}{path}")
            .into_client_request()
            .unwrap();
        if let Some(o) = origin {
            req.headers_mut().insert("Origin", o.parse().unwrap());
        }
        tungstenite::connect(req).map(|(ws, _)| ws)
    }

    fn next_json(ws: &mut WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>) -> Value {
        loop {
            if let Message::Text(t) = ws.read().unwrap() {
                return serde_json::from_str(t.as_str()).unwrap();
            }
        }
    }

    fn http(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn token_file_is_created_once_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let a = load_bridge_token(dir.path()).unwrap();
        assert_eq!(a.len(), 36);
        assert_eq!(load_bridge_token(dir.path()).unwrap(), a);
        std::fs::write(dir.path().join("bridge-token.json"), "not json").unwrap();
        assert_ne!(load_bridge_token(dir.path()).unwrap(), a);
    }

    #[test]
    fn relays_requests_sessions_and_http_routes() {
        let hub = Hub::new("secret-token".into());
        let port = start(hub.clone(), 0).unwrap();

        // Unauthorized upgrades are refused; the desktop path needs the token and no origin.
        assert!(client(port, "/", Some("https://evil.example")).is_err());
        assert!(client(port, "/desktop?token=wrong", None).is_err());
        assert!(client(
            port,
            "/desktop?token=secret-token",
            Some("chrome-extension://abc")
        )
        .is_err());

        let mut desk = client(port, "/desktop?token=secret-token", None).unwrap();
        assert_eq!(next_json(&mut desk)["connected"], 0);

        // No extension yet: requests fail at once.
        desk.send(Message::text(
            json!({ "type": "request", "command": "capture", "requestId": "r1", "data": {} })
                .to_string(),
        ))
        .unwrap();
        let r = next_json(&mut desk);
        assert_eq!(
            (r["requestId"].as_str(), r["success"].as_bool()),
            (Some("r1"), Some(false))
        );

        // A session set before the extension connects activates it on connect.
        desk.send(Message::text(json!({ "type": "session", "id": "s1", "url": "https://a.test", "title": "Navis Active" }).to_string())).unwrap();
        assert_eq!(next_json(&mut desk)["sessions"][0]["id"], "s1");

        let mut ext = client(port, "/", Some("chrome-extension://abcdef")).unwrap();
        let first = next_json(&mut ext);
        assert_eq!(
            (
                first["command"].as_str(),
                first["data"]["sessionId"].as_str()
            ),
            (Some("activate-extension"), Some("s1"))
        );
        assert_eq!(next_json(&mut ext)["data"]["status"], "active");
        assert_eq!(next_json(&mut desk)["connected"], 1);

        // Request -> extension -> response back to the desktop.
        desk.send(Message::text(json!({ "type": "request", "command": "get_tabs", "requestId": "r2", "data": { "x": 1 } }).to_string())).unwrap();
        let cmd = next_json(&mut ext);
        assert_eq!(
            (
                cmd["command"].as_str(),
                cmd["requestId"].as_str(),
                cmd["data"]["x"].as_i64()
            ),
            (Some("get_tabs"), Some("r2"), Some(1))
        );
        ext.send(Message::text(json!({ "type": "response", "requestId": "r2", "success": true, "data": { "tabs": [] } }).to_string())).unwrap();
        let resp = next_json(&mut desk);
        assert_eq!(
            (resp["type"].as_str(), resp["requestId"].as_str()),
            (Some("response"), Some("r2"))
        );

        // Handshake is announced to the desktop.
        ext.send(Message::text(
            json!({ "type": "handshake", "extensionId": "abc" }).to_string(),
        ))
        .unwrap();
        assert_eq!(next_json(&mut desk)["type"], "extension-connected");
        assert_eq!(next_json(&mut desk)["type"], "extension-event");

        // Broadcast reaches the extension; clearing sessions updates its state.
        desk.send(Message::text(
            json!({ "type": "broadcast", "command": "navis-progress", "data": { "step": 2 } })
                .to_string(),
        ))
        .unwrap();
        assert_eq!(next_json(&mut ext)["command"], "navis-progress");
        desk.send(Message::text(
            json!({ "type": "session", "id": null }).to_string(),
        ))
        .unwrap();
        assert_eq!(next_json(&mut ext)["data"]["status"], "idle");
        assert_eq!(
            next_json(&mut desk)["sessions"].as_array().map(Vec::len),
            Some(0)
        );

        // HTTP routes.
        let hs = http(
            port,
            "GET /handshake HTTP/1.1\r\nHost: x\r\nOrigin: chrome-extension://abc\r\n\r\n",
        );
        assert!(
            hs.starts_with("HTTP/1.1 200")
                && hs.contains("Access-Control-Allow-Origin: chrome-extension://abc")
                && hs.contains("\"status\":\"idle\""),
            "{hs}"
        );
        let hs = http(
            port,
            "GET /handshake HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\n\r\n",
        );
        assert!(!hs.contains("Access-Control-Allow-Origin"), "{hs}");
        assert!(http(
            port,
            "POST /event HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{}"
        )
        .starts_with("HTTP/1.1 403"));
        let task = http(port, "POST /event HTTP/1.1\r\nHost: x\r\nx-everfern-bridge: 1\r\nContent-Length: 20\r\n\r\n{\"type\":\"user-task\"}");
        assert!(task.starts_with("HTTP/1.1 403"), "{task}");
        let ev = http(port, "POST /event HTTP/1.1\r\nHost: x\r\nx-everfern-bridge: 1\r\nContent-Length: 11\r\n\r\n{\"a\":\"b c\"}");
        assert!(ev.contains("{\"received\":true}"), "{ev}");
        assert_eq!(next_json(&mut desk)["payload"]["a"], "b c");
        assert!(
            http(port, "GET /wake HTTP/1.1\r\nHost: x\r\n\r\n").contains("Navis Companion Active")
        );
        assert!(http(port, "GET /nope HTTP/1.1\r\nHost: x\r\n\r\n").starts_with("HTTP/1.1 404"));

        // With no desktop connected, an extension message is held and the desktop is woken once.
        drop(desk);
        std::thread::sleep(Duration::from_millis(100));
        let woken = Arc::new(AtomicU64::new(0));
        let w = woken.clone();
        hub.set_wake(move || {
            w.fetch_add(1, Ordering::SeqCst);
        });
        ext.send(Message::text(json!({ "type": "heartbeat" }).to_string()))
            .unwrap();
        ext.send(Message::text(json!({ "type": "handshake" }).to_string()))
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            woken.load(Ordering::SeqCst),
            0,
            "heartbeat and handshake must not start Node"
        );
        ext.send(Message::text(
            json!({ "type": "user-task", "n": 1 }).to_string(),
        ))
        .unwrap();
        ext.send(Message::text(
            json!({ "type": "user-task", "n": 2 }).to_string(),
        ))
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(woken.load(Ordering::SeqCst), 1);
        let mut desk = client(port, "/desktop?token=secret-token", None).unwrap();
        assert_eq!(next_json(&mut desk)["connected"], 1);
        assert_eq!(next_json(&mut desk)["payload"]["n"], 1);
        assert_eq!(next_json(&mut desk)["payload"]["n"], 2);

        // Extension leaving is reported.
        drop(ext);
        assert_eq!(next_json(&mut desk)["connected"], 0);
    }
}
