//! Workspace context projected into the agent prompt: git changes and active-file imports.

use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

static JS_IMPORTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"from\s+['\"]([^'\"]+)['\"]|import\s+['\"]([^'\"]+)['\"]"#).unwrap()
});
static PY_IMPORTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:import\s+([a-zA-Z0-9_., ]+)|from\s+([a-zA-Z0-9_.]+)\s+import)").unwrap()
});

async fn git_status(workspace: &Path) -> String {
    let mut command = tokio::process::Command::new("git");
    command
        .args(["status", "--porcelain"])
        .current_dir(workspace)
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    match tokio::time::timeout(Duration::from_secs(2), command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                "Workspace is clean (no uncommitted Git modifications).".into()
            } else {
                stdout
                    .trim()
                    .lines()
                    .map(|line| {
                        let status = line.get(..2).unwrap_or_default().trim();
                        let file = line.get(3..).unwrap_or_default().trim();
                        format!("- `{file}` [Status: {status}]")
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        _ => "No active Git repository detected or git is not installed.".into(),
    }
}

fn imports(content: &str) -> Vec<String> {
    let mut found = Vec::new();
    for captures in JS_IMPORTS.captures_iter(content) {
        if let Some(dependency) = captures
            .get(1)
            .or_else(|| captures.get(2))
            .map(|value| value.as_str())
        {
            if dependency.starts_with('.') || dependency.starts_with("@/") {
                found.push(dependency.to_string());
            }
        }
    }
    for captures in PY_IMPORTS.captures_iter(content) {
        if let Some(dependency) = captures
            .get(1)
            .or_else(|| captures.get(2))
            .map(|value| value.as_str())
        {
            found.extend(
                dependency
                    .split(',')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .map(str::to_string),
            );
        }
    }
    let mut unique = Vec::new();
    for dependency in found {
        if !unique.contains(&dependency) {
            unique.push(dependency);
        }
        if unique.len() >= 10 {
            break;
        }
    }
    unique
}

fn active_dependencies(workspace: &Path, files: &[String]) -> String {
    let mut dependency_map: Vec<(String, Vec<String>)> = Vec::new();
    for file in files {
        let full_path = if Path::new(file).is_absolute() {
            PathBuf::from(file)
        } else {
            workspace.join(file)
        };
        let Ok(metadata) = std::fs::metadata(&full_path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(bytes) = std::fs::read(&full_path) else {
            return "No active file dependencies mapped.".into();
        };
        let content = String::from_utf8_lossy(&bytes);
        let found = imports(&content);
        if found.is_empty() {
            continue;
        }
        let basename = Path::new(file)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(file)
            .to_string();
        if let Some((_, existing)) = dependency_map
            .iter_mut()
            .find(|(name, _)| name == &basename)
        {
            *existing = found;
        } else {
            dependency_map.push((basename, found));
        }
    }
    if dependency_map.is_empty() {
        return "No active file dependencies mapped.".into();
    }
    dependency_map
        .into_iter()
        .map(|(file, dependencies)| {
            format!(
                "- `{file}` dependencies:\n{}",
                dependencies
                    .into_iter()
                    .map(|dep| format!("  - `{dep}`"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn active_files_from_history(history: &[Value]) -> Vec<String> {
    let path_keys = ["path", "filePath", "file_path", "src", "dest", "TargetFile"];
    let mut files = Vec::new();
    for record in history {
        let args = if super::db::truthy(record.get("args")) {
            record.get("args")
        } else {
            record.get("arguments")
        };
        let Some(args) = args.and_then(Value::as_object) else {
            continue;
        };
        for key in path_keys {
            let Some(value) = args.get(key).and_then(Value::as_str) else {
                continue;
            };
            if value.contains('.')
                && !value.contains("node_modules")
                && !files.iter().any(|file| file == value)
            {
                files.push(value.to_string());
                if files.len() == 10 {
                    return files;
                }
            }
        }
    }
    files
}

/// Mirrors `getWorkspaceProjection` without bringing Node's filesystem or child process layer
/// into the Tauri sidecar path. `nodeVersion` is passed by the compatibility adapter because it
/// describes the bundled Node runtime, not the Rust host process.
pub async fn project(request: &Value) -> Value {
    let workspace = request["workspaceDir"].as_str().unwrap_or_default();
    let files: Vec<String> = if let Some(history) = request["history"].as_array() {
        active_files_from_history(history)
    } else {
        request["activeFiles"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    let git_status = git_status(Path::new(workspace)).await;
    let active_dependencies = active_dependencies(Path::new(workspace), &files);
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let normalized_root = workspace.replace('\\', "/");
    let node_version = request["nodeVersion"].as_str().unwrap_or("unknown");
    json!({
        "gitStatus": git_status,
        "activeDependencies": active_dependencies,
        "environmentInfo": format!("- **Node Version**: {node_version}\n- **Platform**: {platform}\n- **Root Path**: `{normalized_root}`"),
    })
}
