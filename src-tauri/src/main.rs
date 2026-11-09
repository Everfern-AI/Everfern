// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! EverFern's Tauri shell.
//!
//! The agent, tools, database and integrations still live in the existing
//! TypeScript main process. This shell starts it as a Node sidecar
//! (tauri/sidecar/boot.js), waits for it to print its WebSocket port, then
//! opens the window with a bridge script that gives the page the same
//! `window.electronAPI` it had under Electron.

use std::io::{BufRead, BufReader, Write};
mod cloud;
mod store;
mod updater;
mod vm;
mod http;
mod shell;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const BRIDGE_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/bridge.js"));

struct Sidecar(Arc<Mutex<Option<Child>>>);

/// Where the app's package.json, dist-electron/ and node_modules/ live.
fn app_root(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("EF_APP_PATH") {
        return PathBuf::from(p);
    }
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("app");
        if bundled.join("tauri/sidecar/boot.js").is_file() { return bundled; }
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    }
    app.path().resource_dir().map(|d| d.join("app")).unwrap_or_else(|_| PathBuf::from("."))
}

fn node_binary(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("EVERFERN_NODE") {
        return PathBuf::from(p);
    }
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("node").join(exe);
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(exe)
}

/// Starts the sidecar and returns (child, port, token) once it is listening.
fn start_sidecar(app: &AppHandle) -> Result<(Child, u16, String), String> {
    let root = app_root(app);
    let packaged = !cfg!(debug_assertions) || app.path().resource_dir().map(|dir| dir.join("app") == root).unwrap_or(false);
    let mut cmd = Command::new(node_binary(app));
    cmd.arg(root.join("tauri").join("sidecar").join("boot.js"))
        .current_dir(&root)
        .env("EF_APP_PATH", &root)
        .env("EF_USER_DATA", store::root(app)?)
        .env("EF_NATIVE_EXE", std::env::current_exe().map_err(|e| e.to_string())?)
        .env("EF_APP_VERSION", app.package_info().version.to_string())
        .env("EF_PACKAGED", if packaged { "1" } else { "0" })
        .stdin(Stdio::piped()) // the sidecar exits when this closes
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Ok(dir) = app.path().resource_dir() {
        cmd.env("EF_RESOURCES_PATH", dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("could not start Node ({e}). Is Node.js installed?"))?;
    let stdout = child.stdout.take().ok_or("no sidecar stdout")?;
    let (tx, rx) = mpsc::channel::<(u16, String)>();

    // Pass the sidecar's log through, and pick out the ready line.
    std::thread::spawn(move || {
        let mut tx = Some(tx);
        let out = std::io::stdout();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("EF_SIDECAR_READY ") {
                let mut parts = rest.split_whitespace();
                if let (Some(port), Some(token)) = (parts.next(), parts.next()) {
                    if let (Some(tx), Ok(port)) = (tx.take(), port.parse::<u16>()) {
                        let _ = tx.send((port, token.to_string()));
                    }
                }
                continue;
            }
            let _ = writeln!(out.lock(), "{line}");
        }
    });

    match rx.recv_timeout(Duration::from_secs(300)) {
        Ok((port, token)) => Ok((child, port, token)),
        Err(_) => {
            let _ = child.kill();
            Err("the EverFern background process did not start within 5 minutes".into())
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

const LINK_SCHEME: &str = "everfern-app://";

/// Hands an everfern-app:// link to the renderer (the bridge queues it until the app listens).
fn deliver_link(app: &AppHandle, url: &str) {
    if !url.starts_with(LINK_SCHEME) {
        return;
    }
    if let (Some(w), Ok(js_url)) = (app.get_webview_window("main"), serde_json::to_string(url)) {
        let _ = w.eval(&format!(
            "(window.__EF_DEEPLINK__||function(u){{(window.__EF_PENDING_LINKS__=window.__EF_PENDING_LINKS__||[]).push(u)}})({js_url})"
        ));
    }
    show_main(app);
}

fn stop_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<Sidecar>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            drop(child.stdin.take()); // lets it shut down cleanly
            std::thread::sleep(Duration::from_millis(300));
            let _ = child.kill();
        }
    }
}

#[tauri::command]
fn ef_open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[tauri::command]
fn ef_relaunch(app: AppHandle) {
    stop_sidecar(&app);
    app.restart();
}

#[tauri::command]
fn ef_exit(app: AppHandle, code: i32) {
    stop_sidecar(&app);
    app.exit(code);
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--ef-http") {
        use std::io::Read;
        let mut input = String::new();
        let result = std::io::stdin().take(40 * 1024 * 1024).read_to_string(&mut input)
            .map_err(|e| e.to_string()).and_then(|_| {
                let request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
                tauri::async_runtime::block_on(http::relay(request))
            });
        if result.is_err() { std::process::exit(1); }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-cloud-request") {
        use std::io::Read;
        let mut input = String::new();
        let result = std::io::stdin().take(40 * 1024 * 1024).read_to_string(&mut input)
            .map_err(|e| e.to_string()).and_then(|_| {
                let request: serde_json::Value = serde_json::from_str(&input).map_err(|e| e.to_string())?;
                tauri::async_runtime::block_on(cloud::ef_cloud_request(
                    request["path"].as_str().ok_or("Missing path")?.into(),
                    request["method"].as_str().unwrap_or("POST").into(),
                    request["token"].as_str().ok_or("Missing token")?.into(),
                    request.get("body").map(|v| v.to_string()),
                ))
            });
        match result {
            Ok(response) => { if serde_json::to_writer(std::io::stdout(), &response).is_err() { std::process::exit(1); } }
            Err(_) => std::process::exit(1),
        }
        return;
    }
    // Synchronous, pipe-only crypto bridge for legacy Node safeStorage callers.
    // No secret material is placed in command-line arguments or logs.
    if let Some(mode) = std::env::args().nth(1).filter(|v| v == "--ef-encrypt" || v == "--ef-decrypt") {
        use std::io::Read;
        let mut bytes = Vec::new();
        let result = std::io::stdin().take(40 * 1024 * 1024).read_to_end(&mut bytes)
            .map_err(|e| e.to_string()).and_then(|_| store::protect(&bytes, mode == "--ef-decrypt"));
        match result {
            Ok(output) => { if std::io::stdout().write_all(&output).is_err() { std::process::exit(1); } }
            Err(_) => std::process::exit(1),
        }
        return;
    }
    let app = tauri::Builder::default()
        // A second launch (including a clicked everfern-app:// link on Windows/Linux) focuses this window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app);
            for arg in argv.iter().filter(|a| a.starts_with(LINK_SCHEME)) {
                deliver_link(app, arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            ef_open_devtools,
            ef_relaunch,
            ef_exit,
            cloud::ef_cloud_request,
            store::ef_worker_store,
            store::ef_browser_state,
            updater::ef_update,
            vm::ef_local_vm,
            shell::ef_notify,
            shell::ef_shortcut,
            shell::ef_window_control,
            shell::ef_get_displays,
            shell::ef_open_external,
            shell::ef_open_path,
            shell::ef_show_in_folder,
            shell::ef_clipboard_read_text,
            shell::ef_clipboard_write_text,
            shell::ef_pick_file,
            shell::ef_pick_folder,
            shell::ef_save_file,
            shell::ef_message_box
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            store::recover_workers(&handle)?;
            let (child, port, token) = start_sidecar(&handle).map_err(|e| {
                eprintln!("[everfern] {e}");
                e
            })?;
            let child = Arc::new(Mutex::new(Some(child)));
            app.manage(Sidecar(child.clone()));

            // When the sidecar ends (app.quit() in the main process, or a crash), close the app.
            let watcher = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(500));
                let mut guard = child.lock().unwrap();
                match guard.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(status))) => {
                        guard.take();
                        drop(guard);
                        watcher.exit(status.code().unwrap_or(0));
                        break;
                    }
                    None => break,
                    _ => {}
                }
            });

            let native_origin = "(location.protocol==='tauri:'&&location.hostname==='localhost')||(['http:','https:'].includes(location.protocol)&&location.hostname==='tauri.localhost')";
            let trusted_origin = if cfg!(debug_assertions) {
                format!("({native_origin})||(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='3001')")
            } else { native_origin.to_string() };
            let init = format!(
                "if(window.top===window&&({trusted_origin})){{window.__EF_SIDECAR__={{port:{port},token:{token:?},platform:{platform:?},autoUpdate:{auto_update}}};\n{BRIDGE_JS}\n}}",
                platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" },
                auto_update = !cfg!(debug_assertions),
            );
            let migration = store::migration_script(&handle).map_err(|e| format!("Cannot restore migration data: {e}"))?;
            let start_url = if cfg!(debug_assertions) {
                WebviewUrl::External("http://localhost:3001".parse().unwrap())
            } else {
                WebviewUrl::App("index.html".into())
            };
            WebviewWindowBuilder::new(app, "main", start_url)
                .title("EverFern")
                .inner_size(1400.0, 900.0)
                .min_inner_size(560.0, 520.0)
                .decorations(false)
                .center()
                .initialization_script(&init)
                .initialization_script(format!("if(window.top===window&&({trusted_origin})){{{migration}}}"))
                .build()?;

            // everfern-app:// links (sign-in callbacks, shared workers). Register at runtime on
            // Windows/Linux so dev builds work too; macOS uses the bundle's Info.plist.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(windows, target_os = "linux"))]
                if !cfg!(debug_assertions) || std::env::var_os("EF_REGISTER_DEEP_LINK").is_some() {
                    let _ = app.deep_link().register_all();
                }
                let links = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        deliver_link(&links, url.as_str());
                    }
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        deliver_link(&handle, url.as_str());
                    }
                }
            }

            let show = MenuItem::with_id(app, "show", "Show EverFern", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("EverFern")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        stop_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start EverFern");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_sidecar(handle);
        }
    });
}
