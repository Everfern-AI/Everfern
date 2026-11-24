//! Local worker commands are executed only in the named Alpine distribution.
use serde_json::{json, Value};
use std::time::Duration;

fn worker_script(id: &str, command: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid worker id".into());
    }
    if command.trim().is_empty() || command.len() > 64 * 1024 {
        return Err("Invalid VM command".into());
    }
    Ok(format!("mkdir -p \"$HOME/everfern-workers/{id}\" && cd \"$HOME/everfern-workers/{id}\" && {command}"))
}

const DISTRO: &str = "EverFern-Alpine";

pub fn guest_path_to_host(path: &str) -> String {
    if cfg!(windows) {
        let clean = path.replace('\\', "/");
        if clean.starts_with("//")
            || matches!(clean.as_bytes(), [drive, b':', b'/', ..] if drive.is_ascii_alphabetic())
        {
            return clean.replace('/', "\\");
        }
        if let Some(rest) = clean.strip_prefix("/mnt/") {
            if let [drive, ..] = rest.as_bytes() {
                if drive.is_ascii_alphabetic() && (rest.len() == 1 || rest.as_bytes()[1] == b'/') {
                    return format!(
                        "{}:{}",
                        drive.to_ascii_uppercase() as char,
                        rest[1..].replace('/', "\\")
                    );
                }
            }
        }
        let relative = clean.strip_prefix('/').unwrap_or(&clean).replace('/', "\\");
        return format!(r"\\wsl.localhost\{DISTRO}\{relative}");
    }
    if cfg!(target_os = "macos") {
        if let Some(relative) = path.strip_prefix("/host/Users/") {
            return format!("/Users/{relative}");
        }
    }
    path.to_owned()
}

#[cfg(windows)]
#[test]
fn guest_path_to_host_translates_mounts_and_guest_paths() {
    assert_eq!(
        guest_path_to_host("/mnt/c/Users/Test User/report.txt"),
        r"C:\Users\Test User\report.txt"
    );
    assert_eq!(
        guest_path_to_host("/tmp/report.txt"),
        r"\\wsl.localhost\EverFern-Alpine\tmp\report.txt"
    );
    assert_eq!(
        guest_path_to_host("//server/share/report.txt"),
        r"\\server\share\report.txt"
    );
}

fn windows_path_to_wsl(path: &str) -> String {
    let path = path.replace('\\', "/");
    for prefix in ["//wsl.localhost/", "//wsl$/", "//wsl/"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let (distro, suffix) = rest.split_once('/').unwrap_or((rest, ""));
            if !distro.is_empty() {
                return format!("/{suffix}");
            }
        }
    }
    if let [drive, b':', b'/', ..] = path.as_bytes() {
        if drive.is_ascii_alphabetic() {
            return format!("/mnt/{}/{}", drive.to_ascii_lowercase() as char, &path[3..]);
        }
    }
    path
}

#[test]
fn windows_path_to_wsl_handles_drive_mounts_and_distro_shares() {
    assert_eq!(
        windows_path_to_wsl(r"C:\Users\Test User\artifact.txt"),
        "/mnt/c/Users/Test User/artifact.txt"
    );
    assert_eq!(
        windows_path_to_wsl(r"\\wsl.localhost\EverFern-Alpine\tmp\file"),
        "/tmp/file"
    );
    assert_eq!(windows_path_to_wsl(r"\\wsl$\EverFern-Alpine"), "/");
    assert_eq!(windows_path_to_wsl("/tmp/file"), "/tmp/file");
}

pub async fn copy_presented_file(original: &str, name: &str, target: &str) -> bool {
    const SCRIPT: &str = r#"
original=$1
name=$2
target=$3
case "$original" in
    /*) if [ -f "$original" ] && cp -- "$original" "$target"; then exit 0; fi ;;
esac
for dir in /everfern /everfern/workspace /everfern/artifacts "$HOME/.everfern" \
    "$HOME/.everfern/workspace" "$HOME/.everfern/artifacts" "$HOME/everfern" \
    "$HOME/workspace" "$HOME" /tmp /tmp/everfern /var/tmp; do
    file="$dir/$name"
    if [ -f "$file" ] && cp -- "$file" "$target"; then exit 0; fi
done
file=$(find /everfern /tmp /home -maxdepth 4 -name "$name" -type f -print -quit 2>/dev/null)
[ -n "$file" ] && cp -- "$file" "$target"
"#;
    let target = windows_path_to_wsl(target);
    run(
        "wsl.exe",
        &[
            "-d",
            DISTRO,
            "--exec",
            "sh",
            "-c",
            SCRIPT,
            "present-file",
            original,
            name,
            &target,
        ],
        Duration::from_secs(120),
    )
    .await
    .is_ok_and(|output| output.status.success())
}

/// Runs a program with no console window, killed when the timeout passes.
async fn run(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args);
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| format!("{program} timed out"))?
        .map_err(|e| format!("Could not run {program}: {e}"))
}

async fn execute(script: String) -> Result<std::process::Output, String> {
    if !cfg!(windows) {
        return Err("Alpine WSL is supported on Windows".into());
    }
    run(
        "wsl.exe",
        &["-d", DISTRO, "-u", "root", "--exec", "sh", "-lc", &script],
        Duration::from_secs(120),
    )
    .await
    .map_err(|e| {
        if e.ends_with("timed out") {
            "Worker VM command timed out".to_string()
        } else {
            format!("Could not reach the Alpine VM: {e}")
        }
    })
}

/// `wsl.exe` writes its own messages in UTF-16LE; the shell inside writes UTF-8.
pub(crate) fn decode_windows_output(bytes: &[u8]) -> String {
    let utf16 = (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe)
        || (bytes.len() > 3 && bytes[1] == 0 && bytes[3] == 0);
    if utf16 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
            .replace('\u{feff}', "")
            .replace('\0', "")
    } else {
        String::from_utf8_lossy(bytes).replace('\0', "")
    }
}

/// True once EverFern's own Alpine distro exists (other WSL distros do not count).
async fn alpine_installed() -> bool {
    if !cfg!(windows) {
        return false;
    }
    match run("wsl.exe", &["--list", "--quiet"], Duration::from_secs(8)).await {
        Ok(out) => decode_windows_output(&out.stdout)
            .lines()
            .any(|n| n.trim().eq_ignore_ascii_case(DISTRO)),
        Err(_) => false,
    }
}

fn format_uptime(total_secs: u64) -> String {
    if total_secs < 60 {
        return format!("Active ({total_secs}s)");
    }
    let (d, h, m) = (
        total_secs / 86400,
        (total_secs % 86400) / 3600,
        (total_secs % 3600) / 60,
    );
    let parts: Vec<String> = [(d, "d"), (h, "h"), (m, "m")]
        .iter()
        .filter(|(v, _)| *v > 0)
        .map(|(v, u)| format!("{v}{u}"))
        .collect();
    format!("Active ({})", parts.join(" "))
}

/// Same result as Node's `system:getWSLInfo`.
async fn vm_info() -> Value {
    let script =
        "cat /etc/os-release 2>/dev/null; echo __EF_UPTIME__; cat /proc/uptime 2>/dev/null";
    let out = match run(
        "wsl.exe",
        &[
            "-d", DISTRO, "-u", "root", "--exec", "/bin/sh", "-c", script,
        ],
        Duration::from_secs(15),
    )
    .await
    {
        Ok(out) if out.status.success() => out,
        Ok(out) => {
            let err = decode_windows_output(&out.stderr);
            let err = if err.trim().is_empty() {
                decode_windows_output(&out.stdout)
            } else {
                err
            };
            return json!({"healthy": false, "error": err.trim(), "distro": DISTRO});
        }
        Err(e) => return json!({"healthy": false, "error": e, "distro": DISTRO}),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let (release, uptime_text) = text.split_once("__EF_UPTIME__").unwrap_or((&text, ""));
    let os_name = release
        .lines()
        .find_map(|l| {
            l.trim()
                .strip_prefix("PRETTY_NAME=\"")
                .and_then(|v| v.strip_suffix('"'))
        })
        .unwrap_or("Alpine Linux");
    let uptime = uptime_text
        .split_whitespace()
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .map(|secs| format_uptime(secs.max(0.0) as u64))
        .unwrap_or_else(|| "Active".into());
    json!({"healthy": true, "osName": os_name, "uptime": uptime, "distro": DISTRO})
}

async fn docker_available() -> bool {
    matches!(run("docker", &["info"], Duration::from_secs(5)).await, Ok(out) if out.status.success())
}

/// The probe Node's checkEnvironmentDependencies runs in the VM (linux-vm-executor.ts).
const DEPS_PROBE: &str = include_str!("vm_deps_probe.sh");

/// First match of `prefix` followed by digits and dots, e.g. "Python 3.12.3" or "v22.1.0".
fn version_after(text: &str, prefix: &str) -> Option<String> {
    text.match_indices(prefix).find_map(|(i, _)| {
        let rest = &text[i + prefix.len()..];
        let n = rest
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(rest.len());
        (n > 0).then(|| format!("{prefix}{}", &rest[..n]))
    })
}

/// Same result as Node's checkEnvironmentDependencies, from the probe's output.
fn parse_deps(output: &str, vm_ready: bool) -> Value {
    let has = |m: &str| output.contains(m);
    let mut missing: Vec<&str> = Vec::new();
    let python = has("PY: Python") || has("Python 3") || has("Python 2");
    if !python {
        missing.push("Python 3");
    }
    let node = !has("NO_NODE")
        && output.lines().any(|l| {
            l.strip_prefix("NODE:")
                .map(|v| v.trim_start())
                .and_then(|v| v.strip_prefix('v'))
                .map(|v| v.starts_with(|c: char| c.is_ascii_digit()))
                .unwrap_or(false)
        });
    if !node {
        missing.push("Node.js");
    }
    let venv = has("VENV_EXISTS") || (python && has("PDF_OK") && has("EXCEL_OK"));
    if !venv {
        missing.push("Python Virtualenv (~/.everfern/venv)");
    }
    let (pdf, excel, pptx, docx, data) = (
        has("PDF_OK"),
        has("EXCEL_OK"),
        has("PPTX_OK"),
        has("DOCX_OK"),
        has("DATA_OK"),
    );
    if !pdf {
        missing.push("PDF Libraries (pypdf)");
    }
    if !excel {
        missing.push("Excel Libraries (pandas, openpyxl)");
    }
    if !pptx {
        missing.push("PPTX Libraries (python-pptx)");
    }
    if !docx {
        missing.push("DOCX Libraries (python-docx)");
    }
    if !data {
        missing.push("Data Science Libraries (numpy, matplotlib)");
    }
    let pip = has("PY_PKGS_OK");
    let node_pkgs = has("NODE_PKGS_OK");
    if !pip {
        missing.push("Python skill libraries");
    }
    if !node_pkgs {
        missing.push("Node.js skill packages");
    }
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let mut result = json!({
        "available": vm_ready && python && (venv || pip),
        "platform": platform,
        "vmReady": vm_ready,
        "pythonInstalled": python,
        "nodeInstalled": node,
        "venvReady": venv,
        "pipPackagesInstalled": pip,
        "nodePackagesInstalled": node_pkgs,
        "details": {"pdf": pdf, "excel": excel, "pptx": pptx, "docx": docx, "data": data},
        "missingList": missing,
    });
    if python {
        if let Some(v) = version_after(output, "Python ") {
            result["pythonVersion"] = json!(v);
        }
    }
    if node {
        if let Some(v) = output
            .lines()
            .find_map(|l| l.strip_prefix("NODE:"))
            .and_then(|l| version_after(l, "v"))
        {
            result["nodeVersion"] = json!(v);
        }
    }
    result
}

/// Runs the probe in the VM as its default user, retrying once like Node does.
async fn check_deps() -> Value {
    for attempt in 0..2 {
        if let Ok(out) = run(
            "wsl.exe",
            &[
                "--distribution",
                DISTRO,
                "--exec",
                "/bin/sh",
                "-c",
                DEPS_PROBE,
            ],
            Duration::from_secs(30),
        )
        .await
        {
            if out.status.success() {
                return parse_deps(&String::from_utf8_lossy(&out.stdout), true);
            }
        }
        if attempt == 0 {
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
    }
    parse_deps("", false)
}

#[tauri::command]
pub async fn ef_local_vm(
    operation: String,
    worker: Option<String>,
    command: Option<String>,
) -> Result<Value, String> {
    // The Settings page's Linux VM checks, so opening Settings does not start Node.
    match operation.as_str() {
        "installed" => return Ok(json!(alpine_installed().await)),
        "info" => return Ok(vm_info().await),
        "docker" => return Ok(json!(docker_available().await)),
        "deps" => {
            return Ok(if cfg!(windows) {
                check_deps().await
            } else {
                parse_deps("", false)
            })
        }
        _ => {}
    }
    if operation == "status" {
        return Ok(match execute("true".into()).await {
            Ok(output) if output.status.success() => json!({"available": true}),
            _ => json!({"available": false, "reason": "EverFern Alpine VM is unavailable"}),
        });
    }
    let id = worker.ok_or("Missing worker")?;
    let script = match operation.as_str() {
        "exec" => worker_script(&id, &command.ok_or("Missing command")?)?,
        "ls" => worker_script(&id, "ls -1Ap 2>/dev/null | head -200")?,
        _ => return Err("Unknown VM operation".into()),
    };
    let output = execute(script).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if operation == "ls" {
        if !output.status.success() {
            return Ok(json!({"files": [], "error": stderr}));
        }
        return Ok(
            json!({"files": stdout.lines().filter(|line| !line.is_empty()).collect::<Vec<_>>(), "path": format!("~/everfern-workers/{id}")}),
        );
    }
    Ok(json!({"stdout": stdout, "stderr": stderr, "exitCode": output.status.code().unwrap_or(-1)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolates_worker_paths_before_shell_execution() {
        for id in ["../root", "worker; rm", "$(host)", "", "a/b"] {
            assert!(worker_script(id, "pwd").is_err());
        }
        assert!(worker_script("worker-1", "pwd")
            .unwrap()
            .contains("$HOME/everfern-workers/worker-1"));
    }

    /// Runs the Settings checks against the real VM: `cargo test --bin everfern live_vm_checks -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_vm_checks() {
        tauri::async_runtime::block_on(async {
            println!("installed: {}", alpine_installed().await);
            println!("info: {}", vm_info().await);
            println!("docker: {}", docker_available().await);
            println!("deps: {}", check_deps().await);
        });
    }

    #[test]
    fn decodes_wsl_list_output() {
        let utf16: Vec<u8> = "Ubuntu\r\nEverFern-Alpine\r\n"
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        assert!(decode_windows_output(&utf16)
            .lines()
            .any(|n| n.trim().eq_ignore_ascii_case(DISTRO)));
        assert_eq!(decode_windows_output(b"plain"), "plain");
    }

    #[test]
    fn formats_uptime_like_node() {
        assert_eq!(format_uptime(42), "Active (42s)");
        assert_eq!(format_uptime(3600), "Active (1h)");
        assert_eq!(format_uptime(90061), "Active (1d 1h 1m)");
    }

    #[test]
    fn parses_dependency_probe() {
        let ready = "PY: Python 3.12.3\nNODE: v22.11.0\nVENV_EXISTS\nPY_PKGS_OK\nPDF_OK\nEXCEL_OK\nPPTX_OK\nDOCX_OK\nDATA_OK\nNODE_PKGS_OK\n";
        let r = parse_deps(ready, true);
        assert_eq!(r["available"], true);
        assert_eq!(r["pythonVersion"], "Python 3.12.3");
        assert_eq!(r["nodeVersion"], "v22.11.0");
        assert_eq!(r["missingList"].as_array().unwrap().len(), 0);
        let empty = parse_deps("", false);
        assert_eq!(empty["available"], false);
        assert_eq!(empty["missingList"].as_array().unwrap().len(), 10);
        let no_node = parse_deps("PY: Python 3.12.3\nNO_NODE\nNO_VENV\nNO_PY_PKGS\nNO_PDF\nNO_EXCEL\nNO_PPTX\nNO_DOCX\nNO_DATA\nNO_NODE_PKGS\n", true);
        assert_eq!(no_node["nodeInstalled"], false);
        assert!(no_node.get("nodeVersion").is_none());
    }
}
