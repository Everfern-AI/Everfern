//! Native browser panes for the worker desktop's `<webview>` elements, and the
//! `everfern-site` scheme that serves generated sites and artifacts.
//!
//! The renderer bridge turns each `<webview>` into a child WebView2 of the main window
//! (one persistent profile per Electron partition) and keeps it over the element's box.
//! Page events come back as `ef-webview` events with the element's id.

use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

fn label(id: u32) -> String {
    format!("wv-{id}")
}

/// `persist:worker-abc` -> `<app data>/webviews/persist_worker-abc`.
fn profile_dir(app: &AppHandle, partition: &str) -> Result<PathBuf, String> {
    let safe: String = partition
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("webviews");
    Ok(base.join(if safe.is_empty() {
        "default".into()
    } else {
        safe
    }))
}

fn emit(app: &AppHandle, id: u32, kind: &str, extra: Value) {
    let mut payload = json!({ "id": id, "type": kind });
    if let (Some(p), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
        p.extend(e.clone());
    }
    let _ = app.emit_to("main", "ef-webview", payload);
}

fn num(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}

#[tauri::command]
pub async fn ef_webview(app: AppHandle, id: u32, op: String, args: Value) -> Result<Value, String> {
    let label = label(id);
    if op == "create" {
        if app.get_webview(&label).is_some() {
            return Ok(json!(true));
        }
        let url: tauri::Url = args
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("about:blank")
            .parse()
            .map_err(|e| format!("bad url: {e}"))?;
        if !matches!(url.scheme(), "http" | "https" | "about") {
            return Err(format!("webview cannot open {} URLs", url.scheme()));
        }
        let partition = args.get("partition").and_then(Value::as_str).unwrap_or("");
        let (a1, a2, a3) = (app.clone(), app.clone(), app.clone());
        let mut b = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .data_directory(profile_dir(&app, partition)?)
            .on_page_load(move |wv, payload| {
                let url = payload.url().to_string();
                let started = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
                let _ = &wv;
                emit(
                    &a1,
                    id,
                    if started { "start" } else { "finish" },
                    json!({ "url": url }),
                );
            })
            .on_document_title_changed(move |_, title| {
                emit(&a2, id, "title", json!({ "title": title }))
            })
            .on_navigation(move |url| {
                emit(&a3, id, "navigate", json!({ "url": url.as_str() }));
                true
            });
        if let Some(ua) = args
            .get("userAgent")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            b = b.user_agent(ua);
        }
        let window = app.get_window("main").ok_or("main window missing")?;
        let webview = window
            .add_child(
                b,
                LogicalPosition::new(num(&args, "x"), num(&args, "y")),
                LogicalSize::new(num(&args, "width").max(1.0), num(&args, "height").max(1.0)),
            )
            .map_err(|e| e.to_string())?;
        if args.get("visible").and_then(Value::as_bool) == Some(false) {
            let _ = webview.hide();
        }
        return Ok(json!(true));
    }

    let Some(wv) = app.get_webview(&label) else {
        return Ok(Value::Null);
    };
    let ok = |r: tauri::Result<()>| r.map(|_| json!(true)).map_err(|e| e.to_string());
    match op.as_str() {
        // One call, so the view never shows a frame at the new place with the old size.
        "bounds" => ok(wv.set_bounds(tauri::Rect {
            position: LogicalPosition::new(num(&args, "x"), num(&args, "y")).into(),
            size: LogicalSize::new(num(&args, "width").max(1.0), num(&args, "height").max(1.0))
                .into(),
        })),
        "show" => ok(wv.show()),
        "hide" => ok(wv.hide()),
        "focus" => ok(wv.set_focus()),
        "load" => {
            let url: tauri::Url = args
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("bad url: {e}"))?;
            if !matches!(url.scheme(), "http" | "https" | "about") {
                return Err(format!("webview cannot open {} URLs", url.scheme()));
            }
            ok(wv.navigate(url))
        }
        "reload" => ok(wv.reload()),
        "back" => ok(wv.eval("history.back()")),
        "forward" => ok(wv.eval("history.forward()")),
        "stop" => ok(wv.eval("window.stop()")),
        "devtools" => {
            wv.open_devtools();
            Ok(json!(true))
        }
        "exec" => {
            // Runs the page script and returns its (awaited) value as JSON.
            let code = args
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("undefined");
            let wrapped = format!(
                "(async()=>{{try{{const v=await (0,eval)({code});return JSON.stringify({{ok:true,v:v===undefined?null:v}})}}catch(e){{return JSON.stringify({{ok:false,e:String(e&&e.message||e)}})}}}})()",
                code = serde_json::to_string(code).unwrap()
            );
            let (tx, rx) = tokio::sync::oneshot::channel::<String>();
            let tx = std::sync::Mutex::new(Some(tx));
            wv.eval_with_callback(wrapped, move |result| {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
            })
            .map_err(|e| e.to_string())?;
            let raw = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
                .await
                .map_err(|_| "executeJavaScript timed out".to_string())?
                .map_err(|_| "webview closed".to_string())?;
            // WebView2 hands back the promise's JSON string, itself JSON-encoded.
            let text: String = serde_json::from_str(&raw).unwrap_or(raw);
            let result: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            if result["ok"].as_bool() == Some(true) {
                Ok(result["v"].clone())
            } else {
                Err(result["e"].as_str().unwrap_or("script failed").to_string())
            }
        }
        "destroy" => ok(wv.close()),
        _ => Err(format!("unknown webview op {op}")),
    }
}

// ── everfern-site:// ───────────────────────────────────────────────────────

/// `window.open('everfern-site://...')`: a plain window on the site. Its label is
/// outside the capability windows, so the page gets no Tauri commands.
#[tauri::command]
pub async fn ef_open_site(app: AppHandle, url: String) -> Result<(), String> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let parsed: tauri::Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    let allowed = match parsed.scheme() {
        "http" => parsed.host_str() == Some("everfern-site.localhost"),
        "everfern-site" => true,
        _ => false,
    };
    if !allowed {
        return Err("only everfern-site pages can be opened here".into());
    }
    let label = format!(
        "site-{}",
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title("EverFern")
        .inner_size(1200.0, 800.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolves `/<chatId>/<path>` under ~/.everfern/sites, then ~/.everfern/artifacts.
/// Returns None for anything that would leave those folders.
pub fn resolve_site(home: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path.split(['?', '#']).next().unwrap_or(""));
    let mut parts = decoded.trim_start_matches('/').splitn(2, '/');
    let chat = parts.next().filter(|c| !c.is_empty())?;
    let mut rel = parts.next().unwrap_or("").to_string();
    if rel.is_empty() || rel.ends_with('/') {
        rel.push_str("index.html");
    }
    let rel_path = Path::new(&rel);
    let chat_path = Path::new(chat);
    let safe = |p: &Path| p.components().all(|c| matches!(c, Component::Normal(_)));
    if !safe(rel_path) || !safe(chat_path) || chat_path.components().count() != 1 {
        return None;
    }
    ["sites", "artifacts"]
        .iter()
        .map(|root| home.join(".everfern").join(root).join(chat).join(rel_path))
        .find(|p| p.is_file())
}

pub fn serve_site(url_path: &str) -> tauri::http::Response<Vec<u8>> {
    let respond = |status: u16, ctype: &str, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", ctype)
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap()
    };
    let Some(home) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
    else {
        return respond(500, "text/plain", b"No home folder".to_vec());
    };
    match resolve_site(&home, url_path) {
        Some(p) => match std::fs::read(&p) {
            Ok(bytes) => respond(200, mime(&p), bytes),
            Err(_) => respond(404, "text/plain", b"Not Found".to_vec()),
        },
        None => respond(404, "text/plain", b"Not Found".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_paths_stay_inside_the_site_folders() {
        let home = tempfile::tempdir().unwrap();
        let site = home.path().join(".everfern/sites/chat1");
        std::fs::create_dir_all(&site).unwrap();
        std::fs::write(site.join("index.html"), "hi").unwrap();
        std::fs::write(home.path().join("secret.txt"), "no").unwrap();
        assert!(resolve_site(home.path(), "/chat1/").is_some());
        assert!(resolve_site(home.path(), "/chat1/index.html").is_some());
        assert!(resolve_site(home.path(), "/chat1/../../../secret.txt").is_none());
        assert!(resolve_site(home.path(), "/chat1/%2e%2e/%2e%2e/%2e%2e/secret.txt").is_none());
        assert!(resolve_site(home.path(), "/../secret.txt").is_none());
        assert!(resolve_site(home.path(), "/chat1/C:/Windows/win.ini").is_none());
    }
}
