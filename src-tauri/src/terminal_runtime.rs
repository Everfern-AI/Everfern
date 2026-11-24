//! Persistent host and VM shell sessions for the TypeScript compatibility sidecar.
//!
//! The sidecar owns tool policy and callbacks; Rust owns the child shells, command queue,
//! output capture, timeout/background state, and process termination. The private JSONL
//! protocol is intentionally small so the existing terminal tool surface stays unchanged.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DISTRO: &str = "EverFern-Alpine";
const CONTAINER: &str = "everfern-alpine";
const MAX_OUTPUT_CHARS: usize = 50_000;
const STREAM_INTERVAL: Duration = Duration::from_secs(2);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandInfo {
    id: String,
    command: String,
    cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    status: String,
    output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    start_time: u128,
    target: String,
}

#[derive(Clone)]
struct Queued {
    rid: u64,
    id: String,
    command: String,
    cwd: String,
    timeout: Duration,
}

struct Active {
    request: Queued,
    marker: String,
    output: String,
    start_time: u128,
    timeout_at: Instant,
    last_stream: Instant,
    last_streamed_bytes: usize,
    response_sent: bool,
}

struct Pending {
    id: String,
    marker: String,
    output: String,
}

struct Shell {
    target: String,
    child: Child,
    stdin: ChildStdin,
    cwd: String,
    active: Option<Active>,
    queue: VecDeque<Queued>,
    pending: Vec<Pending>,
    stdout_closed: bool,
    stderr_closed: bool,
    exited: bool,
    exit_code: i32,
}

enum Event {
    Output {
        target: String,
        text: String,
        stderr: bool,
    },
    StreamClosed {
        target: String,
        stderr: bool,
    },
    Request(Value),
    InputClosed,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn emit(value: Value) {
    let mut out = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut out, &value);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn response(rid: u64, result: Value) {
    emit(json!({"type":"response", "rid":rid, "result":result}));
}

fn info_value(info: &CommandInfo) -> Value {
    serde_json::to_value(info).unwrap_or_else(|_| json!({}))
}

fn clean_output(raw: &str, windows: bool) -> String {
    if !windows {
        return raw.trim().to_string();
    }
    raw.split(|c| c == '\n' || c == '\r')
        .filter_map(|line| {
            let mut line = line.trim().to_string();
            if let Some(rest) = line.strip_prefix("PS ") {
                if let Some((_, command)) = rest.split_once('>') {
                    line = command.trim().to_string();
                }
            }
            let hidden = line.is_empty()
                || line.starts_with(">>")
                || line.starts_with("$global:EF_")
                || line.starts_with("[Console]::OutputEncoding")
                || line.starts_with("$OutputEncoding")
                || line.starts_with("$ProgressPreference")
                || line.starts_with("try {")
                || line.starts_with("& {")
                || line.starts_with("Set-Location -LiteralPath")
                || line.starts_with("if ($LASTEXITCODE")
                || line.starts_with("} catch {")
                || line.starts_with("Write-Output")
                || line.contains("__EF_DONE_")
                || line.contains("$global:EF_M")
                || line.contains("$global:EF_EXIT");
            (!hidden).then_some(line)
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn truncate_output(output: &mut String) {
    let count = output.chars().count();
    if count > MAX_OUTPUT_CHARS {
        let skip = count - MAX_OUTPUT_CHARS;
        let tail: String = output.chars().skip(skip).collect();
        *output = format!("...[Output truncated]...\n{tail}");
    }
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn windows_to_linux(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    for prefix in ["//wsl.localhost/", "//wsl$/", "//wsl/"] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            let (_, suffix) = rest.split_once('/').unwrap_or((rest, ""));
            return if suffix.is_empty() {
                "/".into()
            } else {
                format!("/{suffix}")
            };
        }
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return format!(
            "/mnt/{}/{}",
            (bytes[0] as char).to_ascii_lowercase(),
            &normalized[3..]
        );
    }
    normalized
}

fn mac_to_docker(path: &str) -> String {
    path.strip_prefix("/Users/")
        .map(|rest| format!("/host/Users/{rest}"))
        .unwrap_or_else(|| path.to_string())
}

fn guest_to_host(path: &str) -> String {
    if cfg!(windows) {
        let clean = path.replace('\\', "/");
        let bytes = clean.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/'
        {
            return clean.replace('/', "\\");
        }
        if let Some(rest) = clean.strip_prefix("/mnt/") {
            let bytes = rest.as_bytes();
            if !bytes.is_empty()
                && bytes[0].is_ascii_alphabetic()
                && (bytes.len() == 1 || bytes[1] == b'/')
            {
                return format!(
                    "{}:{}",
                    (bytes[0] as char).to_ascii_uppercase(),
                    rest[1..].replace('/', "\\")
                );
            }
        }
        if clean.starts_with("//") {
            return clean.replace('/', "\\");
        }
        return format!(
            r"\\wsl.localhost\{DISTRO}\{}",
            clean.trim_start_matches('/').replace('/', "\\")
        );
    }
    if cfg!(target_os = "macos") {
        if let Some(rest) = path.strip_prefix("/host/Users/") {
            return format!("/Users/{rest}");
        }
    }
    path.to_string()
}

fn is_dev_server(command: &str) -> bool {
    let c = command.to_lowercase();
    [
        "npm run dev",
        "next dev",
        "vite",
        "npm start",
        "yarn dev",
        "pnpm dev",
        "gatsby develop",
    ]
    .iter()
    .any(|pattern| c.contains(pattern))
}

fn server_ready(output: &str) -> bool {
    let c = output.to_lowercase();
    [
        "ready in",
        "local: http",
        "http://localhost:",
        "server running",
        "compiled successfully",
        "vite v",
    ]
    .iter()
    .any(|pattern| c.contains(pattern))
}

fn auto_target(command: &str, target: &str) -> String {
    if !cfg!(windows) || target != "main" {
        return target.to_string();
    }
    let c = command.trim().to_lowercase();
    let starts_native = [
        "npm",
        "npx",
        "yarn",
        "node",
        "git",
        "powershell",
        "pwsh",
        "cmd",
    ]
    .iter()
    .any(|prefix| c.starts_with(prefix));
    let indicators = c.contains("/mnt/")
        || c.contains("/home/")
        || c.contains("/tmp/")
        || c.split_whitespace().any(|word| word == "source")
        || ["python", "pip", "apt-get"]
            .iter()
            .any(|word| c.contains(word))
        || ((c.contains("&&") || c.contains("||")) && !starts_native);
    if indicators {
        "vm".into()
    } else {
        target.into()
    }
}

fn shell_command(
    target: &str,
    cwd: &str,
    tx: &Sender<Event>,
) -> Result<(Child, ChildStdin, String), String> {
    let mut actual_cwd = PathBuf::from(cwd);
    if !actual_cwd.exists() {
        if let Err(error) = std::fs::create_dir_all(&actual_cwd) {
            eprintln!(
                "[terminal] could not create cwd {}: {error}; using home",
                actual_cwd.display()
            );
            actual_cwd = std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
        }
    }
    let host_cwd = actual_cwd.to_string_lossy().into_owned();
    let mut command = if cfg!(windows) && target == "vm" {
        let mut c = Command::new("wsl.exe");
        c.args(["-d", DISTRO, "-u", "root", "--exec", "bash"])
            .env("WSL_UTF8", "1")
            .env("WSLENV", "");
        c
    } else if cfg!(windows) {
        let powershell = Command::new("where.exe")
            .arg("pwsh.exe")
            .output()
            .is_ok_and(|output| output.status.success());
        let mut c = Command::new(if powershell {
            "pwsh.exe"
        } else {
            "powershell.exe"
        });
        c.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
        c.current_dir(&actual_cwd);
        c
    } else if cfg!(target_os = "macos") && target == "vm" {
        let mut c = Command::new("docker");
        c.args(["exec", "-i", "-w", "/root", CONTAINER, "bash"]);
        c.current_dir(
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or(actual_cwd),
        );
        c
    } else {
        let mut c = Command::new("bash");
        c.current_dir(&actual_cwd);
        c
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| {
        if target == "vm" && cfg!(windows) {
            format!("The EverFern Linux VM (Alpine) is not available on this system: {error}")
        } else if target == "vm" && cfg!(target_os = "macos") {
            format!("Could not start the EverFern Alpine Docker container: {error}")
        } else {
            format!("Could not start terminal shell: {error}")
        }
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Terminal shell stdin is unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Terminal shell stdout is unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Terminal shell stderr is unavailable")?;
    // Reader threads own the pipes; restore no ownership to Child after spawn.
    let mut stdin = stdin;
    if cfg!(windows) && target == "main" {
        stdin.write_all(b"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\n$ProgressPreference = \"SilentlyContinue\"\n").map_err(|e| e.to_string())?;
    } else {
        stdin.write_all(b"export PATH=\"$HOME/.everfern/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin\"\n").map_err(|e| e.to_string())?;
    }
    // Spawn readers after initialization so their Event messages are ordered after shell setup.
    let target_name = target.to_string();
    spawn_reader(stdout, tx.clone(), target_name.clone(), false);
    spawn_reader(stderr, tx.clone(), target_name, true);
    Ok((child, stdin, host_cwd))
}

fn spawn_reader<R: Read + Send + 'static>(
    mut pipe: R,
    tx: Sender<Event>,
    target: String,
    stderr: bool,
) {
    thread::spawn(move || {
        let mut bytes = [0u8; 4096];
        loop {
            match pipe.read(&mut bytes) {
                Ok(0) => break,
                Ok(length) => {
                    let chunk = String::from_utf8_lossy(&bytes[..length]).replace('\0', "");
                    if tx
                        .send(Event::Output {
                            target: target.clone(),
                            text: chunk,
                            stderr,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(Event::StreamClosed { target, stderr });
    });
}

fn process_input(request: Value, tx: &Sender<Event>) {
    if tx.send(Event::Request(request)).is_err() {
        eprintln!("[terminal] daemon request channel closed");
    }
}

fn launch_shell(target: &str, cwd: &str, tx: &Sender<Event>) -> Result<Shell, String> {
    let (child, stdin, cwd) = shell_command(target, cwd, tx)?;
    Ok(Shell {
        target: target.into(),
        child,
        stdin,
        cwd,
        active: None,
        queue: VecDeque::new(),
        pending: Vec::new(),
        stdout_closed: false,
        stderr_closed: false,
        exited: false,
        exit_code: -1,
    })
}

fn append_chunk(shell: &mut Shell, text: &str, stderr: bool) {
    if stderr {
        eprintln!("[Terminal Error {}] {}", shell.target, text.trim_end());
    } else {
        eprintln!("[Terminal {}] {}", shell.target, text.trim_end());
    }
    for pending in &mut shell.pending {
        pending.output.push_str(text);
    }
    let Some(active) = shell.active.as_mut() else {
        return;
    };
    active.output.push_str(text);
    truncate_output(&mut active.output);
    emit(json!({"type":"chunk", "commandId":active.request.id, "data":text}));
}

fn command_info(
    shell: &Shell,
    active: &Active,
    status: &str,
    output: String,
    exit_code: Option<i32>,
) -> CommandInfo {
    CommandInfo {
        id: active.request.id.clone(),
        command: active.request.command.clone(),
        cwd: shell.cwd.clone(),
        pid: Some(shell.child.id()),
        status: status.into(),
        output,
        exit_code,
        start_time: active.start_time,
        target: shell.target.clone(),
    }
}

fn start_next(shell: &mut Shell, commands: &mut HashMap<String, CommandInfo>, tx: &Sender<Event>) {
    if shell.active.is_some() {
        return;
    }
    let Some(request) = shell.queue.pop_front() else {
        return;
    };
    let marker = format!("__EF_DONE_{}_{}__", now_ms(), request.rid);
    let start_time = now_ms();
    let timeout = if request.timeout.is_zero() {
        DEFAULT_TIMEOUT
    } else {
        request.timeout
    };
    let active = Active {
        request: request.clone(),
        marker: marker.clone(),
        output: String::new(),
        start_time,
        timeout_at: Instant::now() + timeout,
        last_stream: Instant::now(),
        last_streamed_bytes: 0,
        response_sent: false,
    };
    let initial = CommandInfo {
        id: request.id.clone(),
        command: request.command.clone(),
        cwd: shell.cwd.clone(),
        pid: Some(shell.child.id()),
        status: "running".into(),
        output: String::new(),
        exit_code: None,
        start_time,
        target: shell.target.clone(),
    };
    commands.insert(request.id.clone(), initial.clone());
    emit(json!({"type":"update", "info":info_value(&initial)}));
    shell.active = Some(active);

    let need_cd = request.cwd != shell.cwd;
    let is_powershell = cfg!(windows) && shell.target == "main";
    let result = if is_powershell {
        let formatted = request
            .command
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .trim()
            .to_string();
        let cd = if need_cd {
            format!("Set-Location -LiteralPath {}\n", ps_quote(&request.cwd))
        } else {
            String::new()
        };
        let script = format!(
            "$global:EF_M = '{marker}'\n$global:EF_EXIT = 0\n{cd}try {{\n  & {{\n    $global:LASTEXITCODE = $null\n    {formatted}\n  }}\n  if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {{ $global:EF_EXIT = $LASTEXITCODE }} elseif (-not $?) {{ $global:EF_EXIT = 1 }} else {{ $global:EF_EXIT = 0 }}\n}} catch {{ Write-Error $_; $global:EF_EXIT = 1 }}\nWrite-Output \"$global:EF_M $global:EF_EXIT\"\nWrite-Output (Get-Location).Path\n\n"
        );
        shell.stdin.write_all(script.as_bytes())
    } else {
        let shell_cwd = if cfg!(windows) && shell.target == "vm" {
            windows_to_linux(&request.cwd)
        } else if cfg!(target_os = "macos") && shell.target == "vm" {
            mac_to_docker(&request.cwd)
        } else {
            request.cwd.clone()
        };
        let formatted = request
            .command
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .trim()
            .to_string();
        let cd = if need_cd {
            format!("cd {}\n", bash_quote(&shell_cwd))
        } else {
            String::new()
        };
        let script = format!("export EF_M='{marker}'\n{cd}{formatted}\necho \"$EF_M $?\"\npwd\n");
        shell.stdin.write_all(script.as_bytes())
    };
    if let Err(error) = result {
        if let Some(active) = shell.active.take() {
            let info = command_info(
                shell,
                &active,
                "failed",
                format!("Terminal shell input failed: {error}"),
                Some(-1),
            );
            commands.insert(info.id.clone(), info.clone());
            emit(json!({"type":"update", "info":info_value(&info)}));
            response(request.rid, info_value(&info));
            let _ = shell.child.kill();
        }
    }
    let _ = tx;
}

fn finish_active(
    shell: &mut Shell,
    commands: &mut HashMap<String, CommandInfo>,
    status: &str,
    output: String,
    exit_code: Option<i32>,
    respond: bool,
) {
    let Some(active) = shell.active.take() else {
        return;
    };
    let info = command_info(shell, &active, status, output, exit_code);
    commands.insert(info.id.clone(), info.clone());
    emit(json!({"type":"update", "info":info_value(&info)}));
    if respond && !active.response_sent {
        response(active.request.rid, info_value(&info));
    }
}

fn parse_marker(output: &str, marker: &str) -> Option<(i32, String, usize)> {
    let start = output.find(marker)?;
    let after = &output[start + marker.len()..];
    let lines: Vec<&str> = after.split('\n').collect();
    if lines.len() < 3 {
        return None;
    }
    let status = lines[0]
        .trim()
        .split_whitespace()
        .next()?
        .parse::<i32>()
        .ok()?;
    let cwd = lines[1].trim().trim_end_matches('\r').to_string();
    let cut = start;
    Some((status, cwd, cut))
}

fn handle_output(
    shells: &mut HashMap<String, Shell>,
    commands: &mut HashMap<String, CommandInfo>,
    target: &str,
    text: String,
    stderr: bool,
    tx: &Sender<Event>,
) {
    let Some(shell) = shells.get_mut(target) else {
        return;
    };
    append_chunk(shell, &text, stderr);
    if let Some(active) = shell.active.as_mut() {
        if is_dev_server(&active.request.command)
            && server_ready(&active.output)
            && !active.response_sent
        {
            let active = shell.active.take().unwrap();
            let output = format!(
                "{}\n[Dev Server active in background. Logs will stream live.]",
                active.output
            );
            let info = CommandInfo {
                id: active.request.id.clone(),
                command: active.request.command.clone(),
                cwd: shell.cwd.clone(),
                pid: Some(shell.child.id()),
                status: "running".into(),
                output: output.clone(),
                exit_code: None,
                start_time: active.start_time,
                target: shell.target.clone(),
            };
            shell.pending.push(Pending {
                id: active.request.id.clone(),
                marker: active.marker,
                output: active.output,
            });
            commands.insert(info.id.clone(), info.clone());
            emit(json!({"type":"update", "info":info_value(&info)}));
            response(active.request.rid, info_value(&info));
            start_next(shell, commands, tx);
            return;
        }
        if let Some((exit_code, cwd, cut)) = parse_marker(&active.output, &active.marker) {
            if !cwd.is_empty() {
                shell.cwd = if shell.target == "vm" && (cfg!(windows) || cfg!(target_os = "macos"))
                {
                    guest_to_host(&cwd)
                } else {
                    cwd
                };
            }
            let cleaned = clean_output(&active.output[..cut], cfg!(windows));
            finish_active(
                shell,
                commands,
                if exit_code == 0 {
                    "completed"
                } else {
                    "failed"
                },
                cleaned,
                Some(exit_code),
                true,
            );
            start_next(shell, commands, tx);
            return;
        }
    }

    let mut finished = Vec::new();
    for (i, pending) in shell.pending.iter().enumerate() {
        if let Some((exit_code, cwd, cut)) = parse_marker(&pending.output, &pending.marker) {
            finished.push((i, exit_code, cwd, cut));
        }
    }
    for (index, exit_code, cwd, cut) in finished.into_iter().rev() {
        if index >= shell.pending.len() {
            continue;
        }
        let pending = shell.pending.remove(index);
        if !cwd.is_empty() {
            shell.cwd = if shell.target == "vm" && (cfg!(windows) || cfg!(target_os = "macos")) {
                guest_to_host(&cwd)
            } else {
                cwd
            };
        }
        if let Some(existing) = commands.get_mut(&pending.id) {
            existing.status = if exit_code == 0 {
                "completed"
            } else {
                "failed"
            }
            .into();
            existing.output = clean_output(&pending.output[..cut], cfg!(windows));
            existing.exit_code = Some(exit_code);
            existing.cwd = shell.cwd.clone();
            emit(json!({"type":"update", "info":info_value(existing)}));
        }
    }
    if shell.active.is_none() {
        start_next(shell, commands, tx);
    }
}

fn tick(
    shells: &mut HashMap<String, Shell>,
    commands: &mut HashMap<String, CommandInfo>,
    tx: &Sender<Event>,
) {
    let targets: Vec<String> = shells.keys().cloned().collect();
    let mut remove_targets = Vec::new();
    for target in targets {
        let Some(shell) = shells.get_mut(&target) else {
            continue;
        };
        if let Some(active) = shell.active.as_mut() {
            if active.output.len() > active.last_streamed_bytes
                && active.last_stream.elapsed() >= STREAM_INTERVAL
            {
                let raw = active
                    .output
                    .get(active.last_streamed_bytes..)
                    .unwrap_or("")
                    .to_string();
                active.last_streamed_bytes = active.output.len();
                active.last_stream = Instant::now();
                let logs = clean_output(&raw, cfg!(windows));
                if !logs.is_empty() {
                    emit(
                        json!({"type":"stream", "commandId":active.request.id, "event":{
                            "type":"terminal_log_stream", "id":active.request.id, "command":active.request.command,
                            "logs":logs, "timestamp":now_ms()
                        }}),
                    );
                }
            }
            if !active.response_sent && Instant::now() >= active.timeout_at {
                let active = shell.active.take().unwrap();
                let cleaned = clean_output(&active.output, cfg!(windows));
                let timeout_message = format!("\n[⏱ Timeout after {}s — command is still running. Check with terminal_status(id=\"{}\").]",
                    active.request.timeout.as_secs_f64(), active.request.id);
                let output = if cleaned.is_empty() {
                    timeout_message.clone()
                } else {
                    format!("{cleaned}{timeout_message}")
                };
                emit(
                    json!({"type":"chunk", "commandId":active.request.id, "data":timeout_message}),
                );
                let info = CommandInfo {
                    id: active.request.id.clone(),
                    command: active.request.command.clone(),
                    cwd: shell.cwd.clone(),
                    pid: Some(shell.child.id()),
                    status: "running".into(),
                    output: output.clone(),
                    exit_code: None,
                    start_time: active.start_time,
                    target: shell.target.clone(),
                };
                commands.insert(info.id.clone(), info.clone());
                emit(json!({"type":"update", "info":info_value(&info)}));
                response(active.request.rid, info_value(&info));
                shell.pending.push(Pending {
                    id: active.request.id.clone(),
                    marker: active.marker,
                    output: active.output,
                });
                start_next(shell, commands, tx);
            }
        }
        match shell.child.try_wait() {
            Ok(Some(status)) => {
                shell.exited = true;
                shell.exit_code = status.code().unwrap_or(-1);
            }
            _ => {}
        }
        if shell.exited && shell.stdout_closed && shell.stderr_closed {
            if let Some(active) = shell.active.take() {
                let info = CommandInfo {
                    id: active.request.id.clone(),
                    command: active.request.command.clone(),
                    cwd: shell.cwd.clone(),
                    pid: Some(shell.child.id()),
                    status: "failed".into(),
                    output: format!(
                        "{}\n[Shell exited unexpectedly with code {}]",
                        active.output, shell.exit_code
                    ),
                    exit_code: Some(shell.exit_code),
                    start_time: active.start_time,
                    target: shell.target.clone(),
                };
                commands.insert(info.id.clone(), info.clone());
                emit(json!({"type":"update", "info":info_value(&info)}));
                if !active.response_sent {
                    response(active.request.rid, info_value(&info));
                }
            }
            while let Some(request) = shell.queue.pop_front() {
                let info = CommandInfo {
                    id: request.id.clone(),
                    command: request.command,
                    cwd: shell.cwd.clone(),
                    pid: None,
                    status: "failed".into(),
                    output: "Shell exited unexpectedly before command execution".into(),
                    exit_code: Some(shell.exit_code),
                    start_time: now_ms(),
                    target: shell.target.clone(),
                };
                commands.insert(info.id.clone(), info.clone());
                response(request.rid, info_value(&info));
            }
            for pending in shell.pending.drain(..) {
                if let Some(existing) = commands.get_mut(&pending.id) {
                    existing.status = "failed".into();
                    existing.exit_code = Some(shell.exit_code);
                    existing.output.push_str("\n[Shell exited unexpectedly]");
                    emit(json!({"type":"update", "info":info_value(existing)}));
                }
            }
            remove_targets.push(target.clone());
        }
    }
    for target in remove_targets {
        shells.remove(&target);
    }
}

fn as_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn handle_request(
    request: Value,
    shells: &mut HashMap<String, Shell>,
    commands: &mut HashMap<String, CommandInfo>,
    tx: &Sender<Event>,
) {
    let rid = as_u64(&request, "rid").unwrap_or(0);
    match request.get("op").and_then(Value::as_str).unwrap_or("") {
        "execute" => {
            let id = request
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let command = request
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cwd = request
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    std::env::var_os("HOME")
                        .or_else(|| std::env::var_os("USERPROFILE"))
                        .map(|v| {
                            PathBuf::from(v)
                                .join(".everfern")
                                .to_string_lossy()
                                .into_owned()
                        })
                })
                .unwrap_or_else(|| ".".into());
            let requested = request
                .get("target")
                .and_then(Value::as_str)
                .unwrap_or("main");
            let target = auto_target(&command, requested);
            let timeout_ms = request
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_TIMEOUT.as_millis() as u64);
            let queued = Queued {
                rid,
                id: id.clone(),
                command: command.clone(),
                cwd: cwd.clone(),
                timeout: Duration::from_millis(timeout_ms),
            };
            commands.insert(
                id.clone(),
                CommandInfo {
                    id,
                    command,
                    cwd: cwd.clone(),
                    pid: None,
                    status: "running".into(),
                    output: String::new(),
                    exit_code: None,
                    start_time: now_ms(),
                    target: target.clone(),
                },
            );
            if !shells.contains_key(&target) {
                match launch_shell(&target, &cwd, tx) {
                    Ok(shell) => {
                        shells.insert(target.clone(), shell);
                    }
                    Err(error) => {
                        let hint = if target == "vm" {
                            "\nThe EverFern VM is not ready. Ask the user to set it up in Settings, or run the command on this PC with target \"main\" (asks for permission)."
                        } else {
                            ""
                        };
                        let info = CommandInfo {
                            id: queued.id.clone(),
                            command: queued.command.clone(),
                            cwd: queued.cwd.clone(),
                            pid: None,
                            status: "failed".into(),
                            output: format!("Error: {error}{hint}"),
                            exit_code: Some(-1),
                            start_time: now_ms(),
                            target: target.clone(),
                        };
                        commands.insert(info.id.clone(), info.clone());
                        emit(json!({"type":"update", "info":info_value(&info)}));
                        response(rid, info_value(&info));
                        return;
                    }
                }
            }
            if let Some(shell) = shells.get_mut(&target) {
                shell.queue.push_back(queued);
                start_next(shell, commands, tx);
            }
        }
        "status" => {
            let id = request.get("id").and_then(Value::as_str).unwrap_or("");
            response(rid, commands.get(id).map(info_value).unwrap_or(Value::Null));
        }
        "list" => response(
            rid,
            Value::Array(commands.values().map(info_value).collect()),
        ),
        "terminate" => {
            let id = request
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut terminated = false;
            let targets: Vec<String> = shells.keys().cloned().collect();
            for target in targets {
                let Some(shell) = shells.get_mut(&target) else {
                    continue;
                };
                if shell
                    .active
                    .as_ref()
                    .is_some_and(|active| active.request.id == id)
                {
                    let active = shell.active.take().unwrap();
                    let info = CommandInfo {
                        id: id.clone(),
                        command: active.request.command.clone(),
                        cwd: shell.cwd.clone(),
                        pid: Some(shell.child.id()),
                        status: "terminated".into(),
                        output: format!("{}\n[Command terminated by user/agent]", active.output),
                        exit_code: Some(-1),
                        start_time: active.start_time,
                        target: target.clone(),
                    };
                    commands.insert(id.clone(), info.clone());
                    emit(json!({"type":"update", "info":info_value(&info)}));
                    response(active.request.rid, info_value(&info));
                    let _ = shell.child.kill();
                    for pending in shell.pending.drain(..) {
                        if let Some(existing) = commands.get_mut(&pending.id) {
                            existing.status = "terminated".into();
                            existing
                                .output
                                .push_str("\n[Command terminated by user/agent]");
                            existing.exit_code = Some(-1);
                            emit(json!({"type":"update", "info":info_value(existing)}));
                        }
                    }
                    terminated = true;
                    break;
                }
                if shell.pending.iter().any(|pending| pending.id == id) {
                    let _ = shell.child.kill();
                    for pending in shell.pending.drain(..) {
                        if let Some(existing) = commands.get_mut(&pending.id) {
                            existing.status = "terminated".into();
                            existing
                                .output
                                .push_str("\n[Command terminated by user/agent]");
                            existing.exit_code = Some(-1);
                            emit(json!({"type":"update", "info":info_value(existing)}));
                        }
                    }
                    terminated = true;
                    break;
                }
                if let Some(index) = shell.queue.iter().position(|queued| queued.id == id) {
                    let queued = shell.queue.remove(index).unwrap();
                    let info = CommandInfo {
                        id: id.clone(),
                        command: queued.command,
                        cwd: shell.cwd.clone(),
                        pid: Some(shell.child.id()),
                        status: "terminated".into(),
                        output: "Command terminated before execution started".into(),
                        exit_code: Some(-1),
                        start_time: now_ms(),
                        target: target.clone(),
                    };
                    commands.insert(id.clone(), info.clone());
                    response(queued.rid, info_value(&info));
                    emit(json!({"type":"update", "info":info_value(&info)}));
                    terminated = true;
                    break;
                }
            }
            response(rid, json!(terminated));
        }
        _ => response(rid, json!({"error":"Unknown terminal operation"})),
    }
}

/// Runs as `everfern --ef-terminal-daemon`; stdout contains only the JSONL protocol.
pub fn run_daemon() {
    let (tx, rx): (Sender<Event>, Receiver<Event>) = mpsc::channel();
    let input_tx = tx.clone();
    thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            match line {
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(request) => process_input(request, &input_tx),
                    Err(error) => eprintln!("[terminal] invalid daemon request: {error}"),
                },
                Err(_) => break,
            }
        }
        let _ = input_tx.send(Event::InputClosed);
    });
    let mut shells: HashMap<String, Shell> = HashMap::new();
    let mut commands: HashMap<String, CommandInfo> = HashMap::new();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Event::Request(request)) => handle_request(request, &mut shells, &mut commands, &tx),
            Ok(Event::Output {
                target,
                text,
                stderr,
            }) => handle_output(&mut shells, &mut commands, &target, text, stderr, &tx),
            Ok(Event::StreamClosed { target, stderr }) => {
                if let Some(shell) = shells.get_mut(&target) {
                    if stderr {
                        shell.stderr_closed = true;
                    } else {
                        shell.stdout_closed = true;
                    }
                }
            }
            Ok(Event::InputClosed) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        tick(&mut shells, &mut commands, &tx);
    }
    for (_, mut shell) in shells {
        let _ = shell.child.kill();
    }
}
