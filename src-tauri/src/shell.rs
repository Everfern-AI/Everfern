use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

// ── Notifications ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn ef_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// ── Global Shortcuts ────────────────────────────────────────────────────────

#[tauri::command]
pub fn ef_shortcut(app: AppHandle, accelerator: String, register: bool) -> Result<(), String> {
    if !register {
        return app
            .global_shortcut()
            .unregister(accelerator.as_str())
            .map_err(|e| e.to_string());
    }
    let name = accelerator.clone();
    app.global_shortcut()
        .on_shortcut(accelerator.as_str(), move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit("ef-shortcut", json!({ "accelerator": name }));
            }
        })
        .map_err(|e| e.to_string())
}

// ── Window Management & Overlays ───────────────────────────────────────────

#[tauri::command]
pub fn ef_window_control(
    app: AppHandle,
    label: Option<String>,
    action: String,
    value: Option<Value>,
) -> Result<Value, String> {
    let target = label.as_deref().unwrap_or("main");
    let win = app
        .get_window(target)
        .ok_or_else(|| format!("Window '{target}' not found"))?;

    match action.as_str() {
        "minimize" => {
            win.minimize().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "maximize" => {
            win.maximize().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "unmaximize" => {
            win.unmaximize().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "toggle_maximize" => {
            let is_max = win.is_maximized().unwrap_or(false);
            if is_max {
                win.unmaximize().map_err(|e| e.to_string())?;
            } else {
                win.maximize().map_err(|e| e.to_string())?;
            }
            Ok(json!({ "maximized": !is_max }))
        }
        "is_maximized" => {
            let is_max = win.is_maximized().unwrap_or(false);
            Ok(json!({ "maximized": is_max }))
        }
        "is_minimized" => {
            let is_min = win.is_minimized().unwrap_or(false);
            Ok(json!({ "minimized": is_min }))
        }
        "is_fullscreen" => {
            let is_fs = win.is_fullscreen().unwrap_or(false);
            Ok(json!({ "fullscreen": is_fs }))
        }
        "close" => {
            win.close().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "destroy" => {
            win.destroy().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "show" => {
            win.show().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "hide" => {
            win.hide().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "focus" => {
            win.set_focus().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        // Bring the window back from the tray or the taskbar.
        "restore" => {
            let _ = win.unminimize();
            win.show().map_err(|e| e.to_string())?;
            let _ = win.set_focus();
            Ok(json!({ "success": true }))
        }
        "center" => {
            win.center().map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "set_title" => {
            let title = value
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "EverFern".into());
            win.set_title(&title).map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "set_always_on_top" => {
            let on_top = value.and_then(|v| v.as_bool()).unwrap_or(true);
            win.set_always_on_top(on_top).map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "set_fullscreen" => {
            let fs = value.and_then(|v| v.as_bool()).unwrap_or(true);
            win.set_fullscreen(fs).map_err(|e| e.to_string())?;
            Ok(json!({ "success": true }))
        }
        "set_ignore_cursor_events" => {
            let ignore = value.and_then(|v| v.as_bool()).unwrap_or(true);
            win.set_ignore_cursor_events(ignore)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "success": true, "ignoreCursorEvents": ignore }))
        }
        "get_size" => {
            let size = win.inner_size().map_err(|e| e.to_string())?;
            Ok(json!({ "width": size.width, "height": size.height }))
        }
        "get_position" => {
            let pos = win.outer_position().map_err(|e| e.to_string())?;
            Ok(json!({ "x": pos.x, "y": pos.y }))
        }
        "set_size" => {
            if let Some(v) = value {
                let w = v.get("width").and_then(Value::as_u64).unwrap_or(1200) as u32;
                let h = v.get("height").and_then(Value::as_u64).unwrap_or(800) as u32;
                win.set_size(PhysicalSize::new(w, h))
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({ "success": true }))
        }
        "set_position" => {
            if let Some(v) = value {
                let x = v.get("x").and_then(Value::as_i64).unwrap_or(0) as i32;
                let y = v.get("y").and_then(Value::as_i64).unwrap_or(0) as i32;
                win.set_position(PhysicalPosition::new(x, y))
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({ "success": true }))
        }
        _ => Err(format!("Unknown window action: {action}")),
    }
}

// ── Display & Screen Information ────────────────────────────────────────────

#[tauri::command]
pub fn ef_get_displays(app: AppHandle) -> Result<Value, String> {
    let main_win = app.get_window("main").ok_or("Main window not found")?;

    let monitors = main_win.available_monitors().map_err(|e| e.to_string())?;

    let primary = main_win.primary_monitor().ok().flatten();

    let list: Vec<Value> = monitors
        .into_iter()
        .map(|m| {
            let name = m.name().cloned().unwrap_or_else(|| "Display".into());
            let size = m.size();
            let pos = m.position();
            let scale = m.scale_factor();
            json!({
                "name": name,
                "width": size.width,
                "height": size.height,
                "x": pos.x,
                "y": pos.y,
                "scaleFactor": scale,
            })
        })
        .collect();

    let primary_info = primary.map(|p| {
        let size = p.size();
        let pos = p.position();
        json!({
            "name": p.name().cloned().unwrap_or_else(|| "Primary Display".into()),
            "width": size.width,
            "height": size.height,
            "x": pos.x,
            "y": pos.y,
            "scaleFactor": p.scale_factor(),
        })
    });

    Ok(json!({
        "displays": list,
        "primary": primary_info,
    }))
}

// ── Shell Launching & Openers ───────────────────────────────────────────────

pub fn validate_external_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Only http and https URLs can be opened externally".into());
    }
    Ok(trimmed)
}

#[tauri::command]
pub fn ef_open_external(app: AppHandle, url: String) -> Result<(), String> {
    let target = validate_external_url(&url)?;
    app.opener()
        .open_url(target, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ef_open_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ef_show_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let mut cmd = Command::new("explorer.exe");
        cmd.arg(format!("/select,\"{}\"", path.replace('/', "\\")));
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd.spawn()
            .map_err(|e| format!("Could not reveal path in Explorer: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Could not reveal path in Finder: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let parent = p.parent().unwrap_or(p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Could not open folder in file manager: {e}"))?;
        Ok(())
    }
}

// ── Native Clipboard ────────────────────────────────────────────────────────

#[tauri::command]
pub fn ef_clipboard_read_text() -> Result<String, String> {
    use std::process::Command;

    let mut cmd = if cfg!(windows) {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", "Get-Clipboard -Raw"]);
        cmd
    } else if cfg!(target_os = "macos") {
        Command::new("pbpaste")
    } else {
        let mut cmd = Command::new("xclip");
        cmd.args(["-selection", "clipboard", "-o"]);
        cmd
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Clipboard read error: {e}"))?;
    if !output.status.success() {
        return Err(format!("Clipboard command failed: {}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let text = if cfg!(windows) {
        text.strip_suffix("\r\n")
            .or_else(|| text.strip_suffix('\n'))
            .unwrap_or(&text)
    } else {
        &text
    };
    Ok(text.to_owned())
}

#[tauri::command]
pub fn ef_clipboard_write_text(text: String) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut cmd = if cfg!(windows) {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", "$input | Set-Clipboard"]);
        cmd
    } else if cfg!(target_os = "macos") {
        Command::new("pbcopy")
    } else {
        let mut cmd = Command::new("xclip");
        cmd.args(["-selection", "clipboard"]);
        cmd
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Clipboard write error: {e}"))?;
    let written = child
        .stdin
        .take()
        .expect("piped clipboard stdin")
        .write_all(text.as_bytes());
    let status = child
        .wait()
        .map_err(|e| format!("Clipboard write error: {e}"))?;
    written.map_err(|e| format!("Clipboard write error: {e}"))?;
    if !status.success() {
        return Err(format!("Clipboard command failed: {status}"));
    }
    Ok(())
}

// ── Native Dialogs ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn ef_pick_file(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(dp) = default_path {
        builder = builder.set_directory(PathBuf::from(dp));
    }
    if let (Some(name), Some(exts)) = (filter_name, extensions) {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &refs);
    }

    let file_path = builder.blocking_pick_file();
    Ok(file_path.map(|p| p.to_string()))
}

#[tauri::command]
pub fn ef_pick_folder(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(dp) = default_path {
        builder = builder.set_directory(PathBuf::from(dp));
    }

    let folder_path = builder.blocking_pick_folder();
    Ok(folder_path.map(|p| p.to_string()))
}

/// Several files at once; an empty list when the dialog is cancelled.
#[tauri::command]
pub async fn ef_pick_files(app: AppHandle, title: Option<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        #[cfg(any(windows, target_os = "macos"))]
        if let Some(window) = app.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        if let Some(t) = title {
            builder = builder.set_title(t);
        }
        builder
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ef_open_file_picker(app: AppHandle, options: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<Value, String> {
            let _window = app.get_webview_window("main").ok_or("Main window not available")?;
            let picker = app.dialog().file();
            #[cfg(any(windows, target_os = "macos"))]
            let picker = picker.set_parent(&_window);
            let mut picker = picker;
            let defaults = json!([
                {"name":"All Files","extensions":["*"]},
                {"name":"Images","extensions":["png","jpg","jpeg","webp","gif"]},
                {"name":"Text & Documents","extensions":["txt","md","json","csv","js","ts","py","log","html","css"]}
            ]);
            let filters = options.as_ref().and_then(|value| value["filters"].as_array())
                .unwrap_or_else(|| defaults.as_array().unwrap());
            for filter in filters {
                if let (Some(name), Some(extensions)) = (filter["name"].as_str(), filter["extensions"].as_array()) {
                    let extensions: Vec<&str> = extensions.iter().filter_map(Value::as_str).collect();
                    picker = picker.add_filter(name, &extensions);
                }
            }
            let Some(file) = picker.blocking_pick_file() else {
                return Ok(json!({"success": false, "canceled": true}));
            };
            let path = file.into_path().map_err(|error| error.to_string())?;
            crate::data::files::import_attachment(&path, &crate::data::home()?.join(".everfern").join("attachments"))
        })();
        result.unwrap_or_else(|error| json!({"success": false, "error": error}))
    }).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ef_open_folder_picker(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(_window) = app.get_webview_window("main") else {
            return Value::Null;
        };
        let picker = app.dialog().file();
        #[cfg(any(windows, target_os = "macos"))]
        let picker = picker.set_parent(&_window);
        let Some(selection) = picker.blocking_pick_folder() else {
            return Value::Null;
        };
        let path = match selection.into_path() {
            Ok(path) => path,
            Err(error) => return json!({ "success": false, "error": error.to_string() }),
        };
        match path.metadata() {
            Ok(metadata) if metadata.is_dir() => json!({
                "success": true,
                "path": path.to_string_lossy(),
                "name": path.file_name().unwrap_or_default().to_string_lossy(),
            }),
            Ok(_) => json!({ "success": false, "error": "Selected path is not a folder." }),
            Err(error) => json!({ "success": false, "error": error.to_string() }),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn ef_save_file(
    app: AppHandle,
    title: Option<String>,
    default_name: Option<String>,
    default_path: Option<String>,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    if let Some(dp) = default_path {
        builder = builder.set_directory(PathBuf::from(dp));
    }
    if let (Some(name), Some(exts)) = (filter_name, extensions) {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &refs);
    }

    let file_path = builder.blocking_save_file();
    Ok(file_path.map(|p| p.to_string()))
}

pub fn pick_memory_backup(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let picker = app
        .dialog()
        .file()
        .set_title("Import & Merge Memory Graph")
        .add_filter("Memory Files", &["json", "zip"])
        .add_filter("JSON", &["json"])
        .add_filter("ZIP Archive", &["zip"]);
    picker
        .blocking_pick_file()
        .map(|file| file.into_path().map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub fn ef_message_box(
    app: AppHandle,
    title: String,
    message: String,
    kind: Option<String>,
    ask: Option<bool>,
    ok_label: Option<String>,
    cancel_label: Option<String>,
) -> Result<bool, String> {
    let dialog_kind = match kind.as_deref() {
        Some("error") => MessageDialogKind::Error,
        Some("warning") => MessageDialogKind::Warning,
        _ => MessageDialogKind::Info,
    };

    let builder = app.dialog().message(message).title(title).kind(dialog_kind);

    if ask.unwrap_or(false) {
        let buttons = MessageDialogButtons::OkCancelCustom(
            ok_label.unwrap_or_else(|| "OK".into()),
            cancel_label.unwrap_or_else(|| "Cancel".into()),
        );
        Ok(builder.buttons(buttons).blocking_show())
    } else {
        builder.blocking_show();
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_external_urls() {
        assert!(validate_external_url("https://example.com").is_ok());
        assert!(validate_external_url("http://localhost:3000").is_ok());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("data:text/html,test").is_err());
        assert!(validate_external_url("powershell.exe").is_err());
    }
}
