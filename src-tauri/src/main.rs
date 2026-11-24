// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! EverFern's Tauri shell.
//!
//! Agent orchestration currently runs in the TypeScript compatibility sidecar;
//! migrated data, tool, integration, and operating-system work is served by Rust.
//! This shell starts the sidecar (tauri/sidecar/boot.js) when needed and gives the
//! page a bridge script with the same `window.electronAPI` it had under Electron.
//!
//! The sidecar starts only when it is needed: at launch if a bot, scheduled task
//! or scheduled worker must run in the background, otherwise the first time the
//! page calls something the Rust side does not handle (`ef_sidecar`).

use std::io::{BufRead, BufReader, Read, Write};
mod capture;
mod cloud;
mod data;
mod js;
mod http;
mod image_ops;
mod input;
mod keyhook;
mod mcp_runtime;
mod memory;
mod navis;
mod overlay;
mod shell;
mod sqlite_server;
mod store;
mod terminal_runtime;
mod updater;
mod vm;
mod webviews;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

pub(crate) const BRIDGE_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/bridge.js"));

#[derive(Default)]
struct Sidecar {
    child: Arc<Mutex<Option<Child>>>,
    /// (port, token) once it is listening.
    addr: Mutex<Option<(u16, String)>>,
    /// Held while starting, so concurrent callers share one process.
    starting: Mutex<()>,
}

impl Sidecar {
    fn lock_if_stopped(&self) -> Result<Option<std::sync::MutexGuard<'_, ()>>, String> {
        let guard = match self.starting.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::WouldBlock) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let stopped = self
            .addr
            .lock()
            .map_err(|error| error.to_string())?
            .is_none();
        Ok(stopped.then_some(guard))
    }
}

#[test]
fn stopped_sidecar_guard_excludes_startup_and_live_state() {
    let sidecar = Sidecar::default();
    let operation = sidecar.lock_if_stopped().unwrap().unwrap();
    assert!(sidecar.starting.try_lock().is_err());
    drop(operation);

    let startup = sidecar.starting.lock().unwrap();
    assert!(sidecar.lock_if_stopped().unwrap().is_none());
    *sidecar.addr.lock().unwrap() = Some((1234, String::new()));
    drop(startup);
    assert!(sidecar.lock_if_stopped().unwrap().is_none());
    assert!(sidecar.starting.try_lock().is_ok());
}

/// Starts the sidecar if it is not running yet and returns its (port, token).
fn ensure_sidecar(app: &AppHandle) -> Result<(u16, String), String> {
    let state = app.state::<Sidecar>();
    let _starting = state
        .starting
        .lock()
        .map_err(|_| "sidecar lock poisoned".to_string())?;
    if let Some(addr) = state.addr.lock().unwrap().clone() {
        return Ok(addr);
    }
    let started = std::time::Instant::now();
    let (child, port, token) = start_sidecar(app)?;
    eprintln!(
        "[everfern] background process ready in {} ms",
        started.elapsed().as_millis()
    );
    *state.child.lock().unwrap() = Some(child);
    *state.addr.lock().unwrap() = Some((port, token.clone()));
    if let Some(bridge) = app.try_state::<overlay::BridgeInit>() {
        *bridge.addr.lock().unwrap() = (port, token.clone());
    }

    // When the sidecar ends (app.quit() in the main process, or a crash), close the app.
    let watcher = app.clone();
    let child = state.child.clone();
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

    use tauri::Emitter;
    let _ = app.emit_to(
        "main",
        "ef-sidecar-ready",
        serde_json::json!({ "port": port, "token": token }),
    );
    Ok((port, token))
}

fn start_task_polling(app: AppHandle) {
    std::thread::spawn(move || loop {
        let result = (|| {
            let tasks = data::poll_scheduled_tasks()?;
            if tasks.as_array().is_some_and(|tasks| tasks.is_empty()) {
                return Ok::<(), String>(());
            }
            ensure_sidecar(&app)?;
            let sidecar = app.state::<Sidecar>();
            let mut child = sidecar.child.lock().map_err(|error| error.to_string())?;
            let stdin = child
                .as_mut()
                .and_then(|child| child.stdin.as_mut())
                .ok_or("Sidecar input unavailable")?;
            let mut message = serde_json::to_vec(&serde_json::json!({"scheduledTasks": tasks}))
                .map_err(|error| error.to_string())?;
            message.push(b'\n');
            std::io::Write::write_all(stdin, &message).map_err(|error| error.to_string())
        })();
        if let Err(error) = result {
            eprintln!("[everfern] scheduled-task poll failed: {error}");
        }
        std::thread::sleep(Duration::from_secs(60));
    });
}

fn start_worker_wake_polling(app: AppHandle) {
    std::thread::spawn(move || loop {
        if app.state::<Sidecar>().addr.lock().unwrap().is_some() {
            break;
        }
        if store::has_due_worker(&app).unwrap_or(false) {
            match ensure_sidecar(&app) {
                Ok(_) => break,
                Err(error) => eprintln!("[everfern] could not start worker dispatcher: {error}"),
            }
        }
        std::thread::sleep(Duration::from_secs(15));
    });
}

/// The sidecar's address for the main window's bridge; `start` starts it if needed.
#[tauri::command]
async fn ef_sidecar(
    app: AppHandle,
    start: bool,
    reason: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let addr = if start {
        if app.state::<Sidecar>().addr.lock().unwrap().is_none() {
            // Which call needed Node: the list of what still keeps Node from staying asleep.
            eprintln!(
                "[everfern] starting the background process for {}",
                reason.as_deref().unwrap_or("an unknown call")
            );
        }
        let handle = app.clone();
        Some(
            tauri::async_runtime::spawn_blocking(move || ensure_sidecar(&handle))
                .await
                .map_err(|e| e.to_string())??,
        )
    } else {
        app.state::<Sidecar>().addr.lock().unwrap().clone()
    };
    Ok(addr.map(|(port, token)| serde_json::json!({ "port": port, "token": token })))
}

/// Shortcuts the main process registers at startup. While it is not running, Rust registers
/// them and the bridge handles the press in the page (see renderer-bridge.js).
const BUILT_IN_SHORTCUTS: [&str; 3] = [
    "CommandOrControl+Shift+P",
    "Alt+CommandOrControl+B",
    "Alt+CommandOrControl+H",
];

/// Where the app's package.json, dist-electron/ and node_modules/ live.
fn app_root(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("EF_APP_PATH") {
        return PathBuf::from(p);
    }
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("app");
        if bundled.join("tauri/sidecar/boot.js").is_file() {
            return bundled;
        }
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    }
    app.path()
        .resource_dir()
        .map(|d| d.join("app"))
        .unwrap_or_else(|_| PathBuf::from("."))
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
    let packaged = !cfg!(debug_assertions)
        || app
            .path()
            .resource_dir()
            .map(|dir| dir.join("app") == root)
            .unwrap_or(false);
    let mut cmd = Command::new(node_binary(app));
    cmd.arg(root.join("tauri").join("sidecar").join("boot.js"))
        .current_dir(&root)
        .env("EF_APP_PATH", &root)
        .env("EF_USER_DATA", store::root(app)?)
        .env(
            "EF_NATIVE_EXE",
            std::env::current_exe().map_err(|e| e.to_string())?,
        )
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

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start Node ({e}). Is Node.js installed?"))?;
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
    if let Some(w) = app.get_window("main") {
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
    if let (Some(w), Ok(js_url)) = (app.get_webview("main"), serde_json::to_string(url)) {
        let _ = w.eval(&format!(
            "(window.__EF_DEEPLINK__||function(u){{(window.__EF_PENDING_LINKS__=window.__EF_PENDING_LINKS__||[]).push(u)}})({js_url})"
        ));
    }
    show_main(app);
}

fn stop_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<Sidecar>() {
        if let Some(mut child) = state.child.lock().unwrap().take() {
            drop(child.stdin.take()); // lets it shut down cleanly
            std::thread::sleep(Duration::from_millis(300));
            let _ = child.kill();
        }
    }
}

#[tauri::command]
fn ef_open_devtools(webview: tauri::Webview) {
    webview.open_devtools();
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
    // Software rendering by default: the WebView2 GPU process alone costs 150-250 MB.
    // EF_GPU=1 turns it back on.
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none()
        && std::env::var("EF_GPU").as_deref() != Ok("1")
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --disable-gpu-compositing",
        );
    }
    // Monitor layout and screenshots for the sidecar's `screen` / `desktopCapturer`.
    match std::env::args().nth(1).as_deref() {
        Some("--ef-mcp-daemon") => {
            mcp_runtime::run_daemon();
            return;
        }
        Some("--ef-terminal-daemon") => {
            terminal_runtime::run_daemon();
            return;
        }
        Some("--ef-workspace-projection") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = tauri::async_runtime::block_on(
                        data::workspace_projection::project(&request),
                    );
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-context-window") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = data::context_window::dispatch(&request);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-message-utils") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = data::message_utils::dispatch(&request);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-context-engine") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = data::context_engine::dispatch(&request);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-subagent-registry") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::subagent_registry::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-subagent-aggregation") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::subagent_aggregation::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-integration-validation") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::integration_validation::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-security-monitor") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::security_monitor::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-web-fetch") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = tauri::async_runtime::block_on(data::web_fetch::execute(&request));
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-web-search") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result =
                        tauri::async_runtime::block_on(data::web_search::execute(&request))
                            .unwrap_or_else(|failure| failure);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-grep") => {
            // Null tells Node to run its own grep (a pattern this engine cannot run).
            let result = serde_json::from_reader(std::io::stdin().lock()).ok().and_then(|r| data::grep::execute(&r));
            if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                std::process::exit(1);
            }
            return;
        }
        Some("--ef-fs-tool") => {
            // The coding agent's read/ls/find. Null tells Node to run the package's tool.
            let result = serde_json::from_reader(std::io::stdin().lock()).ok().and_then(|r| data::fs_tools::execute(&r));
            if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                std::process::exit(1);
            }
            return;
        }
        Some("--ef-embed-local") => {
            // Local MiniLM embeddings; the process exits afterwards, freeing the model.
            let result = serde_json::from_reader(std::io::stdin().lock())
                .map_err(|e| e.to_string())
                .and_then(|r| data::local_embed::execute(&r))
                .unwrap_or_else(|e| serde_json::json!({ "error": e }));
            if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                std::process::exit(1);
            }
            return;
        }
        Some("--ef-sheet-op") => {
            let result = serde_json::from_reader(std::io::stdin().lock())
                .map_err(|e| e.to_string())
                .and_then(|r| data::sheets::op(&r));
            match result {
                Ok(result) => {
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-system-files") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = data::system_files::execute(&request);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-agent-state-restore") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    let result = data::agent_state::restore(&request);
                    if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-agent-checkpoints") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::agent_checkpoints::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-tool-orchestration") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::tool_orchestration::analyze_and_group(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-smart-replace") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::file_edit::dispatch(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-worker-tool-policy") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => {
                    if serde_json::to_writer(
                        std::io::stdout().lock(),
                        &data::worker_policy::decide(&request),
                    )
                    .is_err()
                    {
                        std::process::exit(1);
                    }
                }
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-tool-truncate") => {
            let request = serde_json::from_reader(std::io::stdin().lock());
            match request {
                Ok(request) => match data::tool_truncation::truncate(&request) {
                    Ok(result) => {
                        if serde_json::to_writer(std::io::stdout().lock(), &result).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        std::process::exit(1);
                    }
                },
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-displays") => {
            println!("{}", capture::displays());
            return;
        }
        Some("--ef-capture") => {
            let index = std::env::args()
                .nth(2)
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            match capture::capture_png(index) {
                Ok(png) => {
                    if std::io::stdout().write_all(&png).is_err() {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        // Computer-use: a screenshot shrunk or cropped for the model, and mouse/keyboard input.
        Some("--ef-screenshot") => {
            let args: Vec<String> = std::env::args().skip(2).collect();
            match capture::screenshot_cli(&args) {
                Ok(v) => println!("{v}"),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-input") => {
            let mut raw = String::new();
            let result = std::io::stdin()
                .read_to_string(&mut raw)
                .map_err(|e| e.to_string())
                .and_then(|_| {
                    serde_json::from_str::<Vec<serde_json::Value>>(&raw).map_err(|e| e.to_string())
                })
                .and_then(|ops| input::run(&ops));
            match result {
                Ok(v) => println!("{v}"),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        // In place of the sharp, sqlite3 and uiohook-napi addons the sidecar used to load.
        Some("--ef-image") => {
            let mut raw = String::new();
            match std::io::stdin()
                .read_to_string(&mut raw)
                .map_err(|e| e.to_string())
                .and_then(|_| {
                    serde_json::from_str::<Vec<serde_json::Value>>(&raw).map_err(|e| e.to_string())
                }) {
                Ok(ops) => println!("{}", image_ops::run(&ops)),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        Some("--ef-sqlite") => {
            let path = std::env::args().nth(2).unwrap_or_else(|| ":memory:".into());
            sqlite_server::serve(&path);
        }
        Some("--ef-keyhook") => {
            if let Err(e) = keyhook::serve() {
                eprintln!("{e}");
                std::process::exit(1);
            }
            return;
        }
        _ => {}
    }
    if let Some(mode) = std::env::args().nth(1).filter(|mode| {
        matches!(
            mode.as_str(),
            "--ef-hydrate-vlm" | "--ef-tool-provider-config" | "--ef-runtime-provider"
        )
    }) {
        let result = data::home().and_then(|home| {
            let input = serde_json::from_reader(std::io::stdin().lock())
                .map_err(|error| error.to_string())?;
            let directory = home.join(".everfern");
            let config = match mode.as_str() {
                "--ef-tool-provider-config" => {
                    data::resolve_tool_provider_config(&directory, &input)
                }
                "--ef-runtime-provider" => data::prepare_runtime_provider(&directory, &input),
                _ => data::hydrate_runtime_vlm(&directory, &input),
            };
            serde_json::to_writer(std::io::stdout().lock(), &config)
                .map_err(|error| error.to_string())
        });
        if result.is_err() {
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-load-config") {
        let result = data::load_provider_config().and_then(|config| {
            serde_json::to_writer(std::io::stdout().lock(), &config)
                .map_err(|error| error.to_string())
        });
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-openrouter-catalog") {
        let catalog = tauri::async_runtime::block_on(data::openrouter::fetch_catalog());
        if serde_json::to_writer(std::io::stdout().lock(), &catalog).is_err() {
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-ocr-pdf") {
        let result = serde_json::from_reader(std::io::stdin().lock())
            .map_err(|error| error.to_string())
            .and_then(|params| {
                tauri::async_runtime::block_on(data::documents::ef_ocr_pdf(Some(params)))
            });
        match result {
            Ok(value) => {
                if serde_json::to_writer(std::io::stdout().lock(), &value).is_err() {
                    std::process::exit(1);
                }
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-ocr-pip") {
        if let Err(error) = tauri::async_runtime::block_on(data::documents::prepare_ocr_pip()) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-ocr-package") {
        let package = std::env::args().nth(2).unwrap_or_default();
        if let Err(error) =
            tauri::async_runtime::block_on(data::documents::install_ocr_package(&package))
        {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-ocr-bootstrap") {
        if let Err(error) = tauri::async_runtime::block_on(data::documents::bootstrap_ocr_venv()) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-http") {
        use std::io::Read;
        let mut input = String::new();
        let result = std::io::stdin()
            .take(40 * 1024 * 1024)
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                let request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
                tauri::async_runtime::block_on(http::relay(request))
            });
        if result.is_err() {
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-cloud-request") {
        use std::io::Read;
        let mut input = String::new();
        let result = std::io::stdin()
            .take(40 * 1024 * 1024)
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                let request: serde_json::Value =
                    serde_json::from_str(&input).map_err(|e| e.to_string())?;
                tauri::async_runtime::block_on(cloud::ef_cloud_request(
                    request["path"].as_str().ok_or("Missing path")?.into(),
                    request["method"].as_str().unwrap_or("POST").into(),
                    request["token"].as_str().ok_or("Missing token")?.into(),
                    request.get("body").map(|v| v.to_string()),
                ))
            });
        match result {
            Ok(response) => {
                if serde_json::to_writer(std::io::stdout(), &response).is_err() {
                    std::process::exit(1);
                }
            }
            Err(_) => std::process::exit(1),
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--ef-task-retry") {
        use std::io::{BufRead, Read};
        let result = (|| -> Result<serde_json::Value, String> {
            let mut line = String::new();
            std::io::stdin()
                .lock()
                .read_line(&mut line)
                .map_err(|error| error.to_string())?;
            let request: serde_json::Value =
                serde_json::from_str(&line).map_err(|error| error.to_string())?;
            let delay = match request["retryAttempt"].as_u64() {
                Some(2) => 10,
                Some(3) => 20,
                _ => return Ok(serde_json::Value::Null),
            };
            let (closed, parent) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = std::io::stdin().lock().read(&mut [0]);
                let _ = closed.send(());
            });
            if parent.recv_timeout(Duration::from_secs(delay))
                != Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            {
                return Ok(serde_json::Value::Null);
            }
            data::task_store(&request, "retry")
        })();
        match result {
            Ok(value) if serde_json::to_writer(std::io::stdout().lock(), &value).is_ok() => {}
            _ => std::process::exit(1),
        }
        return;
    }
    if let Some(mode) = std::env::args().nth(1).filter(|mode| {
        matches!(
            mode.as_str(),
            "--ef-write-todos"
                | "--ef-task-complete"
                | "--ef-brain-route"
                | "--ef-triage-route"
                | "--ef-decomposer-route"
                | "--ef-operator-route"
                | "--ef-tool-return-route"
                | "--ef-specialist-exit"
                | "--ef-approval-route"
                | "--ef-triage-fallback"
                | "--ef-triage-fast"
                | "--ef-triage-parse"
                | "--ef-triage-prompt"
                | "--ef-triage-finalize"
                | "--ef-present-host-file"
                | "--ef-present-files-result"
                | "--ef-show-user-url"
                | "--ef-preview-live-url"
                | "--ef-normalize-questions"
                | "--ef-clarification-request"
                | "--ef-clarification-answer"
        )
    }) {
        let result =
            serde_json::from_reader(std::io::stdin().lock()).map(|request| match mode.as_str() {
                "--ef-write-todos" => data::write_todos(&request),
                "--ef-brain-route" => serde_json::json!(data::brain_route(&request)),
                "--ef-triage-route" => serde_json::json!(data::triage_route(&request)),
                "--ef-decomposer-route" => serde_json::json!(data::decomposer_route(&request)),
                "--ef-operator-route" => serde_json::json!(data::operator_route(&request)),
                "--ef-tool-return-route" => serde_json::json!(data::tool_return_route(&request)),
                "--ef-specialist-exit" => serde_json::json!(data::specialist_exit(&request)),
                "--ef-approval-route" => serde_json::json!(data::approval_route(&request)),
                "--ef-triage-fallback" => data::triage_fallback(&request),
                "--ef-triage-fast" => data::triage_fast(&request),
                "--ef-triage-parse" => data::triage_parse(&request),
                "--ef-triage-prompt" => data::triage_prompt(&request),
                "--ef-triage-finalize" => data::triage_finalize(&request),
                "--ef-present-host-file" => {
                    serde_json::json!(tauri::async_runtime::block_on(data::present_file(&request)))
                }
                "--ef-present-files-result" => data::present_files_result(&request),
                "--ef-show-user-url" => data::show_user_url(&request),
                "--ef-preview-live-url" => data::preview_live_url(&request),
                "--ef-normalize-questions" => data::normalize_questions(&request),
                "--ef-clarification-request" => data::clarification_request(&request),
                "--ef-clarification-answer" => data::clarification_answer(&request),
                _ => data::complete_agent_task(&request),
            });
        if result
            .ok()
            .is_none_or(|value| serde_json::to_writer(std::io::stdout().lock(), &value).is_err())
        {
            std::process::exit(1);
        }
        return;
    }
    if let Some(mode) = std::env::args().nth(1).filter(|mode| {
        matches!(
            mode.as_str(),
            "--ef-embed-query"
                | "--ef-memory-graph"
                | "--ef-hitl-write"
                | "--ef-chat-index"
                | "--ef-personality-read"
                | "--ef-restore-turn-files"
                | "--ef-restore-snapshot"
                | "--ef-usage-insert"
                | "--ef-approval-storage"
                | "--ef-site-files"
                | "--ef-artifact-store"
                | "--ef-plan-store"
                | "--ef-history-read"
                | "--ef-project-lookup"
                | "--ef-render-prompt"
                | "--ef-save-config"
                | "--ef-local-health"
                | "--ef-tool-settings"
                | "--ef-integration-store"
                | "--ef-integration-test"
                | "--ef-task-run-times"
                | "--ef-task-save"
                | "--ef-task-next-run"
                | "--ef-task-list"
                | "--ef-task-get"
                | "--ef-task-delete"
                | "--ef-checkpoint-write"
                | "--ef-checkpoint-load"
        )
    }) {
        let result = (|| {
            let request: serde_json::Value = serde_json::from_reader(std::io::stdin().lock())
                .map_err(|error| error.to_string())?;
            if mode == "--ef-embed-query" {
                if request["operation"] == "resolve-config" {
                    return Ok(data::embeddings::resolve_config(
                        &data::home()?.join(".everfern"),
                        std::env::var("OPENAI_API_KEY").ok().as_deref(),
                    ));
                }
                if request.get("texts").is_some() {
                    return tauri::async_runtime::block_on(data::embeddings::embed_documents(
                        &request,
                    ));
                }
                return tauri::async_runtime::block_on(data::embeddings::embed_query(&request));
            }
            if mode == "--ef-memory-graph" {
                let directory = data::home()?.join(".everfern");
                return match request["operation"].as_str() {
                    Some("load") => Ok(data::memory_graph::load(&directory)),
                    Some("sensitive-preference") => Ok(data::memory_graph::sensitive_preference(
                        &directory,
                        request["query"].as_str().unwrap_or_default(),
                    )),
                    Some("recall") => data::memory_graph::recall(
                        &directory,
                        request["query"].as_str().unwrap_or_default(),
                        &request["vector"],
                    ),
                    Some("recall-with-embedding") => tauri::async_runtime::block_on(
                        data::recall_memory_tool(&directory, &request),
                    ),
                    Some("search-bank") => data::memory_graph::search_memory_bank(
                        &directory,
                        request["query"].as_str().unwrap_or_default(),
                        request["limit"].as_i64().unwrap_or(5),
                    ),
                    Some("search-vectors" | "sync-vectors" | "vector-ids") => {
                        data::search_memory_vectors(&request)
                    }
                    Some("semantic-cache") => {
                        tauri::async_runtime::block_on(data::run_semantic_cache(&request))
                    }
                    Some("search") => {
                        tauri::async_runtime::block_on(data::search_memory_tool(&request))
                    }
                    Some("save-direct") => Ok(data::memory_graph::save_direct(
                        &directory,
                        request["content"].as_str().unwrap_or_default(),
                        request["tags"].as_str().unwrap_or_default(),
                    )),
                    Some("save") => data::memory_graph::save(&directory, &request["graph"])
                        .map(|()| serde_json::Value::Null),
                    Some("upsert") => data::memory_graph::upsert(&directory, &request["memory"])
                        .map(|()| serde_json::Value::Null),
                    Some("upsert-with-embedding") => tauri::async_runtime::block_on(
                        data::upsert_memory_tool(&directory, &request["memory"]),
                    ),
                    Some("delete") => data::memory_graph::delete_node(
                        &directory,
                        request["id"].as_str().ok_or("Expected a memory node ID")?,
                    ),
                    _ => Err("Invalid memory graph operation".into()),
                };
            }
            if mode == "--ef-hitl-write" {
                let directory = data::home()?.join(".everfern");
                return match request["operation"].as_str() {
                    Some("request") => data::hitl::save_request(&directory, &request["record"]),
                    Some("response") => data::hitl::save_response(&directory, &request["record"]),
                    Some("list") => Ok(serde_json::Value::Array(
                        data::hitl::list(&directory, request["conversationId"].as_str())
                            .unwrap_or_default(),
                    )),
                    Some("get") => Ok(data::hitl::get(
                        &directory,
                        &request["conversationId"],
                        &request["requestId"],
                    )
                    .unwrap_or(serde_json::Value::Null)),
                    Some("delete") => data::hitl::delete_conversation(
                        &directory,
                        request["conversationId"].as_str(),
                    ),
                    _ => Err("Invalid approval storage operation".into()),
                };
            }
            if mode == "--ef-chat-index" {
                return data::chat_index_cli(&request);
            }
            if mode == "--ef-personality-read" {
                return Ok(data::personality::load(
                    &data::home()?.join(".everfern"),
                    request.as_str(),
                ));
            }
            if mode == "--ef-restore-turn-files" {
                return data::restore_turn_files(&request);
            }
            if mode == "--ef-restore-snapshot" {
                return data::restore_snapshot(&request);
            }
            if mode == "--ef-usage-insert" {
                return tauri::async_runtime::block_on(data::insert_usage(&request, false));
            }

            if mode == "--ef-local-health" {
                return Ok(
                    tauri::async_runtime::block_on(data::local_provider_health(&request))
                        .unwrap_or_default(),
                );
            }
            if mode == "--ef-project-lookup" {
                return data::lookup_project(&request);
            }
            if mode == "--ef-history-read" {
                return data::read_history(&request);
            }
            if mode == "--ef-plan-store" {
                return data::plan_store(&request);
            }
            if mode == "--ef-approval-storage" {
                return data::approval_storage(&request);
            }
            if mode == "--ef-site-files" {
                return data::site_files(&request);
            }
            if mode == "--ef-artifact-store" {
                return data::artifact_store(&request);
            }
            if mode == "--ef-render-prompt" {
                return data::render_prompt(&request);
            }
            if mode == "--ef-save-config" {
                data::save_provider_config(&request)?;
                return Ok(serde_json::Value::Null);
            }
            if mode == "--ef-integration-test" {
                return Ok(tauri::async_runtime::block_on(
                    data::integrations::test_connection(&request),
                ));
            }
            if matches!(
                mode.as_str(),
                "--ef-checkpoint-write" | "--ef-checkpoint-load"
            ) {
                return data::checkpoint_store(&request, mode == "--ef-checkpoint-load");
            }
            if mode == "--ef-task-next-run" {
                return data::task_next_run(&request);
            }
            if let Some(operation) = mode.strip_prefix("--ef-task-") {
                return data::task_store(&request, operation);
            }
            let channel = request["channel"]
                .as_str()
                .ok_or("Missing store operation")?;
            if mode == "--ef-integration-store" {
                data::integrations::dispatch(
                    &data::home()?.join(".everfern"),
                    channel,
                    request.get("config"),
                )
            } else if channel == "tool-settings:delete-synthesized" {
                data::tool_settings::delete_synthesized(
                    &data::home()?.join(".everfern"),
                    request["config"].as_str(),
                )?;
                Ok(serde_json::Value::Null)
            } else if channel == "tool-settings:list-synthesized" {
                data::tool_settings::list_synthesized(&data::home()?.join(".everfern"))
            } else if channel == "tool-settings:approve-synthesized" {
                data::tool_settings::approve_synthesized(
                    &data::home()?.join(".everfern"),
                    request["config"].as_str(),
                )
            } else if channel == "tool-settings:save-pending-synthesized" {
                data::tool_settings::save_pending_synthesized(
                    &data::home()?.join(".everfern"),
                    &request["config"],
                )?;
                Ok(serde_json::Value::Null)
            } else {
                data::tool_settings::dispatch(channel, request.get("config"))
            }
        })();
        match result {
            Ok(response) => {
                if serde_json::to_writer(std::io::stdout().lock(), &response).is_err() {
                    std::process::exit(1);
                }
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    // Synchronous, pipe-only crypto bridge for legacy Node safeStorage callers.
    // No secret material is placed in command-line arguments or logs.
    if let Some(mode) = std::env::args()
        .nth(1)
        .filter(|v| v == "--ef-encrypt" || v == "--ef-decrypt")
    {
        use std::io::Read;
        let mut bytes = Vec::new();
        let result = std::io::stdin()
            .take(40 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())
            .and_then(|_| store::protect(&bytes, mode == "--ef-decrypt"));
        match result {
            Ok(output) => {
                if std::io::stdout().write_all(&output).is_err() {
                    std::process::exit(1);
                }
            }
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
        // Pages the main process loads from data: URLs, and generated sites / artifacts.
        .register_uri_scheme_protocol("efov", |ctx, request| overlay::serve_page(ctx.app_handle(), request.uri().path()))
        .register_uri_scheme_protocol("everfern-site", |_ctx, request| webviews::serve_site(request.uri().path()))
        .on_window_event(|window, event| match event {
            // The main window hides to the tray; the main process decides when to really quit.
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
                memory::set_low(window, true);
            }
            // Main window minimized, restored or shown again: match WebView2's memory target to it.
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) if window.label() == "main" => {
                memory::set_low(window, memory::is_out_of_sight(window));
            }
            // An overlay or debug window closed by the user: tell the sidecar's BrowserWindow.
            tauri::WindowEvent::Destroyed => {
                if let Some(id) = window.label().strip_prefix("ov-").and_then(|v| v.parse::<u32>().ok()) {
                    use tauri::Emitter;
                    let _ = window.app_handle().emit_to("main", "ef-overlay-closed", id);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            ef_open_devtools,
            ef_relaunch,
            ef_exit,
            cloud::ef_cloud_request,
            store::ef_worker_store,
            data::documents::ef_pdf_pages,
            data::documents::ef_ocr_pdf,
            data::ef_list_agent_models,
            data::ef_saved_provider_health,
            data::ef_host_hardware,
            data::ef_host_local_models,
            data::documents::ef_ocr_install_packages,
            store::ef_secure_session_set,
            store::ef_secure_session_load,
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
            shell::ef_pick_files,
            shell::ef_open_folder_picker,
            shell::ef_open_file_picker,
            shell::ef_save_file,
            shell::ef_message_box,
            overlay::ef_overlay,
            webviews::ef_webview,
            webviews::ef_open_site,
            data::ef_data,
            ef_sidecar
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            store::recover_workers(&handle)?;
            if let Err(error) = data::home().and_then(|home| data::personality::initialize(&home.join(".everfern"))) {
                eprintln!("[everfern] Could not initialize personality files: {error}");
            }
            app.manage(Sidecar::default());

            // The Navis extension bridge is Rust's, so the extension connects without Node.
            // Node connects to it as the desktop client when it runs (extension-server.ts).
            if std::env::var("EVERFERN_LITE").as_deref() != Ok("1") {
                let port = std::env::var("EF_NAVIS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(navis::DEFAULT_PORT);
                match data::home().map_err(std::io::Error::other).and_then(|h| navis::load_bridge_token(&h.join(".everfern"))) {
                    Ok(token) => {
                        let hub = navis::Hub::new(token);
                        // An extension message for Node starts it, like the page's first call does.
                        let waker = handle.clone();
                        hub.set_wake(move || {
                            let app = waker.clone();
                            std::thread::spawn(move || {
                                if let Err(e) = ensure_sidecar(&app) {
                                    eprintln!("[navis] could not start the background process: {e}");
                                }
                            });
                        });
                        match navis::start(hub, port) {
                        Ok(p) => eprintln!("[navis] bridge listening on 127.0.0.1:{p}"),
                        Err(e) => eprintln!("[navis] bridge not started on port {port}: {e}"),
                        }
                    }
                    Err(e) => eprintln!("[navis] bridge token unavailable: {e}"),
                }
            }

            // Start the sidecar at launch only for work that must run without the window
            // (EF_NODE_AT_LAUNCH=1 always does). Otherwise the page starts it on first use.
            let reason = if std::env::var("EF_NODE_AT_LAUNCH").as_deref() == Ok("1") {
                Some("EF_NODE_AT_LAUNCH=1")
            } else {
                data::node_needed_at_launch()
            };
            // Shortcuts Rust registers itself while the sidecar is not running.
            // Only the ones that registered are handed to the page; another app may hold a key.
            let rust_shortcuts: Vec<&str> = if reason.is_some() {
                Vec::new()
            } else {
                BUILT_IN_SHORTCUTS
                    .into_iter()
                    .filter(|accel| match shell::ef_shortcut(handle.clone(), accel.to_string(), true) {
                        Ok(()) => true,
                        Err(e) => {
                            eprintln!("[everfern] shortcut {accel} not registered: {e}");
                            false
                        }
                    })
                    .collect()
            };

            let native_origin = "(location.protocol==='tauri:'&&location.hostname==='localhost')||(['http:','https:'].includes(location.protocol)&&location.hostname==='tauri.localhost')";
            let trusted_origin = if cfg!(debug_assertions) {
                format!("({native_origin})||(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='3001')")
            } else { native_origin.to_string() };
            // Overlay windows may also be served from efov:// (pages the main process builds as data: URLs).
            let bridge = overlay::BridgeInit {
                addr: Mutex::new((0, String::new())),
                version: handle.package_info().version.to_string(),
                trusted_origin: format!("({trusted_origin})||(location.protocol==='http:'&&location.hostname==='efov.localhost')||(location.protocol==='efov:'&&location.hostname==='localhost')"),
            };
            let session = store::session_script(&handle)?;
            let init = format!(
                "if(window.top===window&&({trusted_origin})){{{session}window.__EF_RUST_SHORTCUTS__={};{}}}",
                serde_json::json!(rust_shortcuts),
                bridge.script(None, BRIDGE_JS)
            );
            app.manage(bridge);
            app.manage(overlay::OverlayPages::default());
            let migration = store::migration_script(&handle).map_err(|e| format!("Cannot restore migration data: {e}"))?;
            let start_url = if cfg!(debug_assertions) {
                // EF_START_PATH (debug builds only) opens another page, e.g. /chat, for RAM checks.
                let path = std::env::var("EF_START_PATH").ok().filter(|p| p.starts_with('/') && !p.starts_with("//")).unwrap_or_default();
                WebviewUrl::External(format!("http://localhost:3001{path}").parse().unwrap())
            } else {
                WebviewUrl::App("index.html".into())
            };
            WebviewWindowBuilder::new(app, "main", start_url)
                .title("EverFern")
                .inner_size(1400.0, 900.0)
                .min_inner_size(560.0, 520.0)
                .decorations(false)
                .auto_resize() // stays full size once worker webviews are added as children
                .center()
                // Launched at login (see data/autostart.rs): stay in the tray until opened.
                .visible(!std::env::args().any(|arg| arg == "--auto-start"))
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

            if let Some(reason) = reason {
                eprintln!("[everfern] starting the background process at launch: {reason}");
                let starter = handle.clone();
                std::thread::spawn(move || {
                    if let Err(e) = ensure_sidecar(&starter) {
                        eprintln!("[everfern] {e}");
                    }
                });
            } else {
                eprintln!("[everfern] background process will start on first use");
            }
            if !matches!(std::env::var("EVERFERN_LITE").as_deref(), Ok("1" | "true")) {
                start_task_polling(handle.clone());
                start_worker_wake_polling(handle.clone());
            }
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
