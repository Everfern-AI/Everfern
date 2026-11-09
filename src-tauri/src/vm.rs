//! Local worker commands are executed only in the named Alpine distribution.
use serde_json::{json, Value};
use std::time::Duration;

fn worker_script(id: &str, command: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("Invalid worker id".into());
    }
    if command.trim().is_empty() || command.len() > 64 * 1024 { return Err("Invalid VM command".into()); }
    Ok(format!("mkdir -p \"$HOME/everfern-workers/{id}\" && cd \"$HOME/everfern-workers/{id}\" && {command}"))
}

async fn execute(script: String) -> Result<std::process::Output, String> {
    if !cfg!(windows) { return Err("Alpine WSL is supported on Windows".into()); }
    let mut command = tokio::process::Command::new("wsl.exe");
    command.args(["-d", "EverFern-Alpine", "-u", "root", "--exec", "sh", "-lc", &script]);
    command.kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x0800_0000);
    tokio::time::timeout(Duration::from_secs(120), command.output()).await
        .map_err(|_| "Worker VM command timed out".to_string())?
        .map_err(|e| format!("Could not reach the Alpine VM: {e}"))
}

#[tauri::command]
pub async fn ef_local_vm(operation: String, worker: Option<String>, command: Option<String>) -> Result<Value, String> {
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
        if !output.status.success() { return Ok(json!({"files": [], "error": stderr})); }
        return Ok(json!({"files": stdout.lines().filter(|line| !line.is_empty()).collect::<Vec<_>>(), "path": format!("~/everfern-workers/{id}")}));
    }
    Ok(json!({"stdout": stdout, "stderr": stderr, "exitCode": output.status.code().unwrap_or(-1)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolates_worker_paths_before_shell_execution() {
        for id in ["../root", "worker; rm", "$(host)", "", "a/b"] { assert!(worker_script(id, "pwd").is_err()); }
        assert!(worker_script("worker-1", "pwd").unwrap().contains("$HOME/everfern-workers/worker-1"));
    }
}
