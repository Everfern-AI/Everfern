//! Extra windows the main process opens with `new BrowserWindow(...)`: the computer-use
//! cursor overlay, the voice overlay, the desktop-automation border and the debug window.
//!
//! The sidecar's BrowserWindow shim forwards each call here as `ef_overlay(id, op, args)`.
//! Every overlay gets the same renderer bridge as the main window (with its own window id),
//! so its page talks to the sidecar directly and `webContents.send` reaches it.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

/// What every injected bridge needs: the sidecar address and the origin check.
/// The address is (0, "") until the sidecar starts; the main window then asks for it
/// with `ef_sidecar`. Overlays are opened by the sidecar, so it is always known for them.
pub struct BridgeInit {
    pub addr: Mutex<(u16, String)>,
    pub version: String,
    pub trusted_origin: String,
}

impl BridgeInit {
    /// The init script for a window. `win` is None for the main window.
    pub fn script(&self, win: Option<u32>, bridge_js: &str) -> String {
        let platform = if cfg!(windows) {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };
        let win = win.map(|w| format!(",win:\"{w}\"")).unwrap_or_default();
        let addr = self.addr.lock().map(|a| a.clone()).unwrap_or_default();
        format!(
            "if(window.top===window&&({trusted})){{window.__EF_SIDECAR__={{port:{port},token:{token:?},version:{version:?},platform:{platform:?},autoUpdate:{auto}{win}}};\n{bridge_js}\n}}",
            trusted = self.trusted_origin,
            port = addr.0,
            token = addr.1,
            version = self.version,
            auto = !cfg!(debug_assertions) && win.is_empty(),
        )
    }
}

/// HTML for windows the main process loads from `data:` URLs, served on efov://.
#[derive(Default)]
pub struct OverlayPages(pub Mutex<HashMap<String, String>>);

pub fn label(id: u32) -> String {
    format!("ov-{id}")
}

/// `http://efov.localhost/<id>` on Windows, `efov://localhost/<id>` elsewhere.
fn page_url(id: u32) -> String {
    if cfg!(windows) {
        format!("http://efov.localhost/{id}")
    } else {
        format!("efov://localhost/{id}")
    }
}

/// Serves the stored `data:` pages.
pub fn serve_page(app: &AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let key = path
        .trim_start_matches('/')
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .to_string();
    let html = app
        .state::<OverlayPages>()
        .0
        .lock()
        .unwrap()
        .get(&key)
        .cloned();
    let (status, body) = match html {
        Some(h) => (200, h.into_bytes()),
        None => (404, b"Not Found".to_vec()),
    };
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(body)
        .unwrap()
}

fn map_url(url: &str) -> Result<WebviewUrl, String> {
    // The packaged app loads pages from everfern-app://./<route>/index.html.
    if let Some(rest) = url.strip_prefix("everfern-app://") {
        let path = rest.trim_start_matches("./").trim_start_matches('/');
        let path = if path.is_empty() { "index.html" } else { path };
        return Ok(WebviewUrl::App(path.into()));
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        return url
            .parse()
            .map(WebviewUrl::External)
            .map_err(|e| format!("bad url {url}: {e}"));
    }
    Err(format!("unsupported overlay url {url}"))
}

/// Shows a window without taking focus away from what the user is doing.
pub fn show_inactive(window: &tauri::Window) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        let hwnd = window.hwnd()?;
        unsafe { ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE) };
        Ok(())
    }
    #[cfg(not(windows))]
    window.show()
}

fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

fn flag(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}

#[tauri::command]
pub async fn ef_overlay(app: AppHandle, id: u32, op: String, args: Value) -> Result<Value, String> {
    let label = label(id);
    if op == "create" {
        return create(&app, id, &label, &args).map(|_| json!(true));
    }
    let Some(w) = app.get_window(&label) else {
        return Ok(Value::Null); // not created yet, or already gone
    };
    let e = |r: tauri::Result<()>| r.map(|_| json!(true)).map_err(|e| e.to_string());
    match op.as_str() {
        "show" | "showInactive" => e(show_inactive(&w)),
        "focus" => e(w.show().and_then(|_| w.set_focus())),
        "hide" => e(w.hide()),
        "destroy" | "close" => {
            app.state::<OverlayPages>()
                .0
                .lock()
                .unwrap()
                .remove(&id.to_string());
            e(w.destroy())
        }
        "setBounds" => {
            if let (Some(x), Some(y)) = (num(&args, "x"), num(&args, "y")) {
                w.set_position(LogicalPosition::new(x, y))
                    .map_err(|e| e.to_string())?;
            }
            if let (Some(wd), Some(h)) = (num(&args, "width"), num(&args, "height")) {
                w.set_size(LogicalSize::new(wd, h))
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!(true))
        }
        "setIgnoreMouseEvents" => e(w.set_ignore_cursor_events(flag(&args, "value", false))),
        "setAlwaysOnTop" => e(w.set_always_on_top(flag(&args, "value", false))),
        "setContentProtection" => e(w.set_content_protected(flag(&args, "value", false))),
        "setTitle" => e(w.set_title(args.get("value").and_then(Value::as_str).unwrap_or(""))),
        "minimize" => e(w.minimize()),
        "maximize" => e(w.maximize()),
        "unmaximize" => e(w.unmaximize()),
        "unminimize" => e(w.unminimize()),
        "setFullscreen" => e(w.set_fullscreen(flag(&args, "value", false))),
        "center" => e(w.center()),
        "reload" => match app.get_webview(&label) {
            Some(v) => e(v.reload()),
            None => Ok(Value::Null),
        },
        "devtools" => {
            if let Some(v) = app.get_webview(&label) {
                v.open_devtools();
            }
            Ok(json!(true))
        }
        _ => Err(format!("unknown overlay op {op}")),
    }
}

fn create(app: &AppHandle, id: u32, label: &str, o: &Value) -> Result<(), String> {
    if app.get_window(label).is_some() {
        return Ok(());
    }
    let url = match o.get("html").and_then(Value::as_str) {
        Some(html) => {
            app.state::<OverlayPages>()
                .0
                .lock()
                .unwrap()
                .insert(id.to_string(), html.to_string());
            WebviewUrl::External(page_url(id).parse().map_err(|e| format!("{e}"))?)
        }
        None => map_url(o.get("url").and_then(Value::as_str).unwrap_or(""))?,
    };
    let init = app.state::<BridgeInit>().script(Some(id), crate::BRIDGE_JS);
    let frame = flag(o, "frame", true);
    let transparent = flag(o, "transparent", false);
    let mut b = WebviewWindowBuilder::new(app, label, url)
        .title(o.get("title").and_then(Value::as_str).unwrap_or("EverFern"))
        .decorations(frame)
        .transparent(transparent)
        .always_on_top(flag(o, "alwaysOnTop", false))
        .skip_taskbar(flag(o, "skipTaskbar", false))
        .focusable(flag(o, "focusable", true))
        .focused(false)
        .resizable(flag(o, "resizable", true))
        .shadow(frame && flag(o, "hasShadow", true))
        .content_protected(flag(o, "contentProtection", false))
        .visible(false)
        .inner_size(
            num(o, "width").unwrap_or(800.0),
            num(o, "height").unwrap_or(600.0),
        )
        .initialization_script(&init);
    if let (Some(x), Some(y)) = (num(o, "x"), num(o, "y")) {
        b = b.position(x, y);
    } else {
        b = b.center();
    }
    if transparent {
        b = b.background_color(tauri::window::Color(0, 0, 0, 0));
    }
    let w = b.build().map_err(|e| e.to_string())?;
    if flag(o, "ignoreMouseEvents", false) {
        let _ = w.set_ignore_cursor_events(true);
    }
    if flag(o, "show", false) {
        if let Some(win) = app.get_window(label) {
            let _ = show_inactive(&win);
        }
    }
    Ok(())
}
