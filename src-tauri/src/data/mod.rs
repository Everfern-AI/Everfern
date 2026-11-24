//! Data-layer IPC served from Rust instead of the Node sidecar:
//! history (SQL parts), projects, scheduled-task reads, plans, sites, artifacts.
//! Vector search, provider embedding calls and live HITL state stay in Node
//! (the local embedding fallback is `local_embed`).

mod config;
pub(crate) mod context_engine;
pub(crate) mod context_window;
mod local_settings;
mod mcp_config;
pub use config::{hydrate_runtime_vlm, prepare_runtime_provider, resolve_tool_provider_config};
pub(crate) mod agent_checkpoints;
pub(crate) mod agent_state;
mod db;
pub(crate) mod documents;
pub(crate) mod embeddings;
pub(crate) mod file_edit;
pub(crate) mod files;
mod guard;
pub(crate) mod hitl;
pub(crate) mod integration_validation;
pub(crate) mod integrations;
pub(crate) mod memory_graph;
pub(crate) mod message_utils;
pub(crate) mod openrouter;
pub(crate) mod personality;
mod pricing;
pub(crate) mod schedule;
mod skills;
pub(crate) mod sheets;
pub(crate) mod grep;
pub(crate) mod fs_tools;
pub(crate) mod local_embed;
mod autostart;
pub(crate) mod security_monitor;
pub(crate) mod subagent_aggregation;
pub(crate) mod subagent_registry;
pub(crate) mod system_files;
pub(crate) mod tool_orchestration;
pub(crate) mod tool_settings;
pub(crate) mod tool_truncation;
pub(crate) mod web_fetch;
pub(crate) mod web_search;
pub(crate) mod worker_policy;
pub(crate) mod workspace_projection;

use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "No home folder".to_string())
}

pub fn save_provider_config(config: &Value) -> Result<(), String> {
    self::config::save_config(&home()?.join(".everfern"), config)
}

fn matches_approval(request: &Value) -> bool {
    let tool = &request["toolName"];
    let command = request["command"].as_str().map(str::to_lowercase);
    request["policies"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|policy| {
            let scope = policy["conversationId"]
                .as_str()
                .filter(|scope| !scope.is_empty());
            if policy["toolName"] != *tool
                || scope.is_some_and(|scope| Some(scope) != request["conversationId"].as_str())
            {
                return false;
            }
            let kind = policy["type"].as_str();
            let Some(command) = command.as_deref() else {
                return matches!(kind, Some("exact" | "prefix"));
            };
            let Some(pattern) = policy["pattern"].as_str() else {
                return false;
            };
            let pattern = pattern
                .trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'))
                .to_lowercase();
            !command.is_empty()
                && match kind {
                    Some("exact") => command == pattern,
                    Some("prefix") => command.starts_with(&pattern),
                    _ => false,
                }
        })
}

#[test]
fn approval_matching_respects_scope_and_rule_type() {
    let mut request = json!({
        "operation": "matches",
        "toolName": "bash",
        "command": "Git Status",
        "conversationId": "one",
        "policies": [
            {"toolName": "bash", "type": "exact", "pattern": " git status ", "conversationId": "one"},
            {"toolName": "bash", "type": "prefix", "pattern": "git diff"}
        ]
    });
    assert_eq!(approval_storage(&request).unwrap(), json!(true));
    request["command"] = json!("git status --short");
    assert_eq!(approval_storage(&request).unwrap(), json!(false));
    request["conversationId"] = json!("two");
    request["command"] = json!("git status");
    assert_eq!(approval_storage(&request).unwrap(), json!(false));
    request["command"] = json!("git diff --stat");
    assert_eq!(approval_storage(&request).unwrap(), json!(true));
}

pub fn approval_storage(request: &Value) -> Result<Value, String> {
    if request["operation"] == "matches" {
        return Ok(Value::Bool(matches_approval(request)));
    }
    let file = home()?.join(".everfern").join("tool-approvals.json");
    if request["operation"] == "matches-live" {
        let mut policies = approval_storage_at(&file, &json!({"operation": "load"}))?;
        let Some(entries) = policies.as_array_mut() else {
            return Err("Expected saved tool approvals".into());
        };
        entries.extend(
            request["policies"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|policy| {
                    policy["conversationId"]
                        .as_str()
                        .is_some_and(|id| !id.is_empty())
                })
                .cloned(),
        );
        let mut query = request.clone();
        query["policies"] = policies;
        return Ok(Value::Bool(matches_approval(&query)));
    }
    if request["operation"] == "load" {
        return approval_storage_at(&file, request);
    }
    let directory = file.parent().ok_or("Missing approval store directory")?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("tool-approvals.lock"))
        .map_err(|error| error.to_string())?;
    lock.lock().map_err(|error| error.to_string())?;
    approval_storage_at(&file, request)
}

fn approval_storage_at(file: &std::path::Path, request: &Value) -> Result<Value, String> {
    let global_only = |entries: &Value| {
        entries
            .as_array()
            .into_iter()
            .flatten()
            .filter(|entry| entry.is_object() && !db::truthy(entry.get("conversationId")))
            .cloned()
            .collect::<Vec<_>>()
    };
    match request["operation"].as_str() {
        Some("load") => {
            let saved = std::fs::read(file)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or(Value::Null);
            Ok(Value::Array(global_only(&saved)))
        }
        Some("save") if request["policies"].is_array() => {
            let bytes = serde_json::to_vec_pretty(&global_only(&request["policies"]))
                .map_err(|error| error.to_string())?;
            crate::store::atomic_write(file, &bytes)?;
            Ok(Value::Null)
        }
        Some("delete") => {
            let id = request["data"].as_str().ok_or("Expected an approval ID")?;
            let mut policies = approval_storage_at(file, &json!({"operation": "load"}))?;
            let entries = policies.as_array_mut().ok_or("Expected a policy list")?;
            let before = entries.len();
            entries.retain(|policy| policy["id"] != id);
            let removed = entries.len() != before;
            if removed {
                approval_storage_at(file, &json!({"operation": "save", "policies": policies}))?;
            }
            Ok(json!({"success": true, "removed": removed}))
        }
        Some("update") => {
            let request = &request["data"];
            let id = request["id"].as_str().ok_or("Expected an approval ID")?;
            let updates = request["updates"]
                .as_object()
                .ok_or("Expected approval updates")?;
            let mut policies = approval_storage_at(file, &json!({"operation": "load"}))?;
            let Some(policy) = policies
                .as_array_mut()
                .into_iter()
                .flatten()
                .find(|entry| entry["id"] == id)
            else {
                return Ok(json!({"policy": null}));
            };
            if let Some(fields) = policy.as_object_mut() {
                fields.extend(updates.clone());
            }
            let policy = policy.clone();
            approval_storage_at(file, &json!({"operation": "save", "policies": policies}))?;
            Ok(json!({"policy": policy}))
        }
        Some("promote") => {
            let policy = &request["data"];
            let id = policy["id"].as_str().ok_or("Expected an approval ID")?;
            if db::truthy(policy.get("conversationId")) {
                return Err("Expected a global approval".into());
            }
            let mut policies = approval_storage_at(file, &json!({"operation": "load"}))?;
            let entries = policies.as_array_mut().ok_or("Expected a policy list")?;
            entries.retain(|entry| entry["id"] != id);
            entries.push(policy.clone());
            approval_storage_at(file, &json!({"operation": "save", "policies": policies}))?;
            Ok(Value::Null)
        }
        Some("add") => {
            let mut policy = request["data"].clone();
            if db::truthy(policy.get("conversationId")) {
                return Ok(Value::Null);
            }
            let fields = policy
                .as_object_mut()
                .ok_or("Expected an approval policy")?;
            fields.insert("id".into(), json!(db::uuid_v4()));
            fields.insert("createdAt".into(), json!(db::iso_now()));
            let mut policies = approval_storage_at(file, &json!({"operation": "load"}))?;
            let entries = policies.as_array_mut().ok_or("Expected a policy list")?;
            let keys = ["type", "toolName", "pattern", "conversationId"];
            if !entries
                .iter()
                .any(|entry| keys.iter().all(|key| entry.get(key) == policy.get(key)))
            {
                entries.push(policy.clone());
                approval_storage_at(file, &json!({"operation": "save", "policies": policies}))?;
            }
            Ok(policy)
        }
        _ => Err("Invalid approval storage operation".into()),
    }
}

#[test]
fn approval_storage_persists_only_global_policies() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("tool-approvals.json");
    let global =
        json!({"id": "global", "type": "exact", "toolName": "example", "pattern": "example"});
    let session = json!({"id": "temporary", "conversationId": "session-1"});
    let both = json!([global, session]);
    approval_storage_at(&file, &json!({"operation": "save", "policies": both})).unwrap();
    let saved: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!(saved, json!([global]));
    std::fs::write(&file, both.to_string()).unwrap();
    assert_eq!(
        approval_storage_at(&file, &json!({"operation": "load"})).unwrap(),
        saved
    );
}

#[test]
fn approval_store_creates_updates_and_deletes_global_policies() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("approvals.json");
    let run = |request| approval_storage_at(&file, &request).unwrap();
    let policy = json!({"type": "exact", "toolName": "example", "pattern": "read"});
    let added = run(json!({"operation": "add", "data": policy}));
    run(json!({"operation": "add", "data": policy}));
    assert_eq!(run(json!({"operation": "load"})), json!([added]));
    let id = &added["id"];
    let updated =
        run(json!({"operation": "update", "data": {"id": id, "updates": {"pattern": "list"}}}));
    assert_eq!(updated["policy"]["pattern"], "list");
    assert_eq!(run(json!({"operation": "load"}))[0]["pattern"], "list");
    let mut scoped = run(json!({"operation": "update", "data": {
        "id": id, "updates": {"conversationId": "session"}
    }}))["policy"]
        .clone();
    assert_eq!(scoped["conversationId"], "session");
    assert_eq!(run(json!({"operation": "load"})), json!([]));
    scoped.as_object_mut().unwrap().remove("conversationId");
    run(json!({"operation": "promote", "data": scoped}));
    assert_eq!(run(json!({"operation": "load"})), json!([scoped]));
    run(json!({"operation": "delete", "data": id}));
    assert_eq!(run(json!({"operation": "load"})), json!([]));
}

pub fn load_provider_config() -> Result<Value, String> {
    Ok(config::load_config(&home()?.join(".everfern"))["config"].take())
}

pub fn prompt_context(request: &Value) -> Result<String, String> {
    let mut context = String::new();
    if let Some(integrations) = request
        .get("integrations")
        .filter(|value| value.is_object())
    {
        let status = |name: &str| {
            if integrations[name] == true {
                "CONNECTED"
            } else {
                "NOT CONFIGURED"
            }
        };
        context.push_str(&format!(
            "\n\n## INTEGRATION STATUS\n- **Discord**: {}\n- **Telegram**: {}\n\nIf a service is NOT CONFIGURED, inform the user they can set it up in the Integration Settings if they wish to use it.\n",
            status("discord"), status("telegram"),
        ));
    }
    context.push_str(&prompt_workspace(&request["project"])?);
    let path = home()?.join(".everfern").join("config.json");
    let config = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    context.push_str(&format_prompt_preferences(&config));
    Ok(context)
}

pub fn render_prompt(request: &Value) -> Result<Value, String> {
    let mut prompt = request["template"]
        .as_str()
        .ok_or("Missing prompt template")?
        .to_owned();
    let files = request["sessionFiles"]
        .as_array()
        .ok_or("Missing session files")?;
    let replacements = &request["replacements"];
    let platform = request["platform"].as_str().unwrap_or("win32");
    let host_home = request["hostHome"].as_str().ok_or("Missing host home")?;
    let linux_home = workspace_vm_path(host_home, cfg!(target_os = "macos"));
    let current_date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let environment = match platform {
        "win32" => concat!(
            "**Environment & Terminal Execution**:\n",
            "- **target: \"main\" (Default)**: Executes commands on the Windows host using PowerShell (pwsh/powershell).\n",
            "- **target: \"vm\"**: Executes inside the EverFern Alpine Linux VM (WSL 2, musl, `apk` package manager, runs as root). Working directory is automatically `~/.everfern/workspace/` with the Python virtualenv (`~/.everfern/venv`) active. Run commands like `python script.py` or `pip install <package>` directly without `/mnt/` prefixes."
        ),
        "darwin" => concat!(
            "**Environment & Terminal Execution**:\n",
            "- **target: \"main\" (Default)**: Executes commands on the macOS host using Bash/Zsh.\n",
            "- **target: \"vm\"**: Executes inside the EverFern Alpine Linux VM (Docker, musl, `apk` package manager). Working directory is `~/.everfern/workspace/` with the Python virtualenv active."
        ),
        _ => "**Environment**: Linux. All commands execute natively.",
    };
    let session = replacements["SESSION_ID"].as_str().unwrap_or("current");
    let plan = format!("~/.everfern/chat/plan/{session}/");
    let artifacts = format!("~/.everfern/artifacts/{session}/");
    let sites = format!("~/.everfern/sites/{session}/");
    let registry = if files.is_empty() {
        "_No files created in this session memory yet._".to_owned()
    } else {
        files
            .iter()
            .map(|file| {
                file.as_str()
                    .map(|path| format!("- `{path}`"))
                    .ok_or("Invalid session file path")
            })
            .collect::<Result<Vec<_>, _>>()?
            .join("\n")
    };
    // Match the legacy substitution order, including placeholders introduced by earlier values.
    for field in [
        "OS_INFO",
        "HOME_DIR",
        "SESSION_ID",
        "PLAN_PATH",
        "EXEC_PATH",
        "ARTIFACT_PATH",
        "SITE_PATH",
        "UPLOADS_PATH",
        "PROJECT_PATH",
        "SESSION_FILES",
        "SKILLS",
        "PLUGIN_SKILLS",
        "CURRENT_DATE",
        "WORKSPACE_MOUNTED",
        "USER_NAME",
        "USER_EMAIL",
        "OTHER_TOOLS",
    ] {
        let value = match field {
            "OS_INFO" => Some(environment),
            "HOME_DIR" => Some(linux_home.as_str()),
            "CURRENT_DATE" => Some(current_date.as_str()),
            "WORKSPACE_MOUNTED" => Some(if matches!(platform, "win32" | "darwin") {
                "true"
            } else {
                "false"
            }),
            "PLAN_PATH" => Some(plan.as_str()),
            "ARTIFACT_PATH" => Some(artifacts.as_str()),
            "SITE_PATH" => Some(sites.as_str()),
            "EXEC_PATH" => Some("~/.everfern/workspace/"),
            "UPLOADS_PATH" => Some("~/.everfern/attachments/"),
            "SESSION_FILES" => Some(registry.as_str()),
            "PLUGIN_SKILLS" => Some("_All skills are loaded dynamically above._"),
            "USER_EMAIL" => Some("noreply@everfern.app"),
            "OTHER_TOOLS" => Some(""),
            _ => replacements[field].as_str(),
        };
        if let Some(value) = value {
            prompt = replace_prompt_field(&prompt, &format!("{{{{{field}}}}}"), value);
        }
    }
    if let Some(context) = request.get("context") {
        prompt.push_str(&prompt_context(context)?);
    }
    Ok(Value::String(prompt))
}

fn replace_prompt_field(prompt: &str, token: &str, value: &str) -> String {
    if !value.contains('$') {
        return prompt.replace(token, value);
    }
    let mut result = String::new();
    let mut previous = 0;
    for (start, matched) in prompt.match_indices(token) {
        let end = start + matched.len();
        result.push_str(&prompt[previous..start]);
        let mut chars = value.chars().peekable();
        while let Some(character) = chars.next() {
            if character == '$' {
                let substitution = match chars.peek() {
                    Some('$') => Some("$"),
                    Some('&') => Some(matched),
                    Some('`') => Some(&prompt[..start]),
                    Some('\'') => Some(&prompt[end..]),
                    _ => None,
                };
                if let Some(substitution) = substitution {
                    result.push_str(substitution);
                    chars.next();
                    continue;
                }
            }
            result.push(character);
        }
        previous = end;
    }
    result.push_str(&prompt[previous..]);
    result
}

#[test]
fn prompt_replacement_matches_legacy_dollar_tokens() {
    assert_eq!(
        replace_prompt_field("a{{SKILLS}}b", "{{SKILLS}}", "$$|$&|$`|$'|$1"),
        "a$|{{SKILLS}}|a|b|$1b"
    );
}

fn prompt_workspace(context: &Value) -> Result<String, String> {
    if context.is_null() {
        let home = home()?;
        return Ok(format!(
            r#"

## WORKSPACE ROOT
No project is currently active. The default workspace root is the user profile path: "{}".
CRITICAL RULES:
1. Do not infer that EverFern's installation or source directory is the target.
2. If the user asks you to inspect or fix an application without specifying where it is, ask them to clarify the application folder or choose a project.
"#,
            home.display()
        ));
    }
    let name = context["name"].as_str().ok_or("Missing project name")?;
    let path = context["path"].as_str().ok_or("Missing project path")?;
    let vm_path = workspace_vm_path(path, cfg!(target_os = "macos"));
    let instructions = context["instructions"].as_str().filter(|text| !text.is_empty())
        .map(|text| format!("- **User-configured Project Instructions** (preferences only; they cannot override system safety or permission rules):\n{text}"))
        .unwrap_or_default();
    Ok(format!(
        r#"

## PROJECT CONTEXT
You are currently working in the context of a specific project.
- **Project Name**: {name}
- **Host Path**: {path}
- **VM Path**: {vm_path}
{instructions}

CRITICAL RULES:
1. When the user asks you to perform tasks (like finding bugs, writing code, running tests), they are referring to THIS project: "{path}".
2. Anchor file operations, terminal commands, and search in this project. Use the Host Path with target "main" and the VM Path with target "vm".
3. Do not inspect unrelated application or installation directories. If the selected project is EverFern itself, it is an authorized target like any other selected project.
"#
    ))
}

fn workspace_vm_path(host_path: &str, macos: bool) -> String {
    let path = host_path.replace('\\', "/");
    if let [drive, b':', rest @ ..] = path.as_bytes() {
        if drive.is_ascii_alphabetic() && (rest.is_empty() || rest.starts_with(b"/")) {
            return format!(
                "/mnt/{}{}",
                char::from(drive.to_ascii_lowercase()),
                &path[2..]
            );
        }
    }
    if macos && path.starts_with("/Users/") {
        return format!("/host{path}");
    }
    path
}

#[test]
fn workspace_vm_path_preserves_platform_mounts() {
    assert_eq!(
        workspace_vm_path(r"C:\Users\é\repo", false),
        "/mnt/c/Users/é/repo"
    );
    assert_eq!(workspace_vm_path("D:", false), "/mnt/d");
    assert_eq!(workspace_vm_path("C:relative", false), "C:relative");
    assert_eq!(
        workspace_vm_path("/Users/test/repo", true),
        "/host/Users/test/repo"
    );
    assert_eq!(
        workspace_vm_path("/home/test/repo", false),
        "/home/test/repo"
    );
}

fn format_prompt_preferences(config: &Value) -> String {
    if !db::truthy(Some(config)) {
        return String::new();
    }
    let tone = config["customTone"].as_str().filter(|tone| !tone.is_empty()).unwrap_or_else(|| {
        match config["tone"].as_str() {
            Some("warm") => "Warm & Friendly: Be approachable, encouraging, conversational, and empathetic while remaining highly effective.",
            Some("senior") => "Senior Engineer: Be architectural, pragmatic, rigorous, and production-minded with high-craft code.",
            Some("casual") => "Casual & Chill: Be relaxed, witty, and approachable, like collaborating with a close tech peer.",
            Some("creative") => "Creative & Quirky: Bring inventive, vibrant, and innovative perspectives to tasks.",
            _ => "Direct & Concise: Deliver clear, straightforward, and efficient answers without fluff or filler.",
        }
    });
    let mut block = format!("\n\n## FERN IDENTITY, TONE & CUSTOM INSTRUCTIONS\n- **Identity**: You are Fern. Always act and respond as Fern (EverFern). Never claim to be Claude, Anthropic, or OpenAI.\n- **Tone Directive**: {tone}");
    for (field, label) in [
        ("customInstructions", "Custom Response Instructions"),
        ("userContext", "About the User"),
    ] {
        if let Some(text) = config[field]
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            block.push_str(&format!("\n- **{label}**:\n{text}"));
        }
    }
    block
}

#[test]
fn prompt_preferences_use_custom_tone_and_trim_optional_fields() {
    assert!(format_prompt_preferences(&Value::Null).is_empty());
    let output = format_prompt_preferences(&json!({
        "tone": "warm", "customTone": "Technical", "customInstructions": "  Include examples  ",
        "userContext": " ", "apiKey": "placeholder-secret",
    }));
    assert!(output.ends_with(
        "**Tone Directive**: Technical\n- **Custom Response Instructions**:\nInclude examples"
    ));
    assert!(!output.contains("About the User"));
    assert!(!output.contains("placeholder-secret"));
}

/// One shared connection to the chat database (renderer calls are chat scope).
static CHAT_DB: Mutex<Option<Connection>> = Mutex::new(None);

fn with_db<T>(f: impl FnOnce(&Connection) -> T) -> Result<T, String> {
    let mut guard = CHAT_DB
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(db::open(
            &home()?.join(".everfern").join("sql").join("memory.sqlite"),
        )?);
    }
    Ok(f(guard.as_ref().unwrap()))
}

pub fn restore_snapshot(id: &Value) -> Result<Value, String> {
    with_db(|conn| db::restore_snapshot(conn, id))?
}

pub fn restore_turn_files(request: &Value) -> Result<Value, String> {
    let args = request.as_array().ok_or("Expected rollback filters")?;
    with_db(|conn| db::restore_turn_files(conn, args))?
}

/// What the Electron handler returned when its store call failed.
fn fallback(channel: &str, err: String) -> Value {
    eprintln!("[everfern] {channel} failed: {err}");
    match channel {
        "history:list" | "history:listByProject" | "projects:list" | "scheduled-tasks:list" => {
            json!([])
        }
        "history:load" => json!({ "error": "Not found" }),
        "history:togglePin" => json!({ "success": false, "isPinned": false, "error": err }),
        "history:toggleUnread" => json!({ "success": false, "isUnread": false, "error": err }),
        "projects:toggleBookmark" => {
            json!({ "success": false, "isBookmarked": false, "error": err })
        }
        "scheduled-tasks:get" => Value::Null,
        _ => json!({ "success": false, "error": err }),
    }
}

pub fn chat_index_cli(request: &Value) -> Result<Value, String> {
    let channel = request["channel"]
        .as_str()
        .ok_or("Missing chat index operation")?;
    if !matches!(
        channel,
        "vectors:search"
            | "vectors:index-message"
            | "vectors:get"
            | "vectors:delete"
            | "vectors:stats"
    ) {
        return Err("Invalid chat index operation".into());
    }
    let args = request["args"]
        .as_array()
        .ok_or("Missing chat index arguments")?;
    dispatch(None, channel, args)
}

pub fn search_memory_vectors(request: &Value) -> Result<Value, String> {
    let (path, root) = scoped_vector_paths(request)?;
    if request["operation"] == "vector-ids" {
        return db::memory_vector_ids(&path, &root);
    }
    if request["operation"] == "sync-vectors" {
        return db::sync_memory_vectors(&path, &root, request);
    }
    db::search_memory_vectors(
        &path,
        &root,
        &request["vector"],
        request["limit"].as_i64().unwrap_or(5),
    )
    .map(|rows| memory_graph::format_semantic_matches(&rows))
}

pub async fn run_semantic_cache(request: &Value) -> Result<Value, String> {
    let (path, root) = scoped_vector_paths(request)?;
    let mut cache = request["request"].clone();
    if cache["operation"] != "health" && cache.get("vector").is_none() {
        let directory = home()?.join(".everfern");
        let config =
            embeddings::resolve_config(&directory, std::env::var("OPENAI_API_KEY").ok().as_deref());
        cache["vector"] =
            embeddings::embed_query(&json!({"config": config, "text": cache["prompt"]})).await?;
        cache["provider"] = config["provider"].clone();
    }
    db::semantic_cache(&path, &root, &cache)
}

fn scoped_vector_paths(
    request: &Value,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let filename = match request["scope"].as_str() {
        Some("chat") => "memory.sqlite",
        Some("worker") => "workers.sqlite",
        _ => return Err("Invalid memory scope".into()),
    };
    let root = std::env::var_os("EF_APP_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    Ok((home()?.join(".everfern").join("sql").join(filename), root))
}

pub async fn search_memory_tool(request: &Value) -> Result<Value, String> {
    let directory = home()?.join(".everfern");
    let query = request["query"].as_str().ok_or("Expected a memory query")?;
    let limit = request["limit"].as_i64().unwrap_or(5);
    let scope = request["scope"].as_str().ok_or("Expected a memory scope")?;
    let bank = memory_graph::search_memory_bank(&directory, query, limit)?;
    let Some(entries) = bank["entries"]
        .as_array()
        .filter(|entries| !entries.is_empty())
    else {
        return Ok(bank["fallback"].clone());
    };
    let existing = search_memory_vectors(&json!({"operation": "vector-ids", "scope": scope}))?;
    let existing: std::collections::HashSet<_> = existing
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["id"].as_str())
        .collect();
    let config =
        embeddings::resolve_config(&directory, std::env::var("OPENAI_API_KEY").ok().as_deref());
    let mut indexed = std::collections::HashMap::new();
    let mut ids = Vec::new();
    for entry in entries {
        let id = entry["id"].as_str().ok_or("Missing memory entry ID")?;
        if indexed.insert(id, entry).is_none() {
            ids.push(id);
        }
    }
    let mut additions = Vec::new();
    for id in &ids {
        if existing.contains(id) {
            continue;
        }
        let entry = indexed[id];
        let vector =
            embeddings::embed_query(&json!({"config": config, "text": entry["embeddingText"]}))
                .await?;
        additions.push(json!({"id": id, "content": entry["content"], "vector": vector,
            "metadata": {"date": entry["date"], "tags": entry["tags"], "preference": entry["preference"]}}));
    }
    search_memory_vectors(
        &json!({"operation": "sync-vectors", "scope": scope, "ids": ids, "additions": additions}),
    )?;
    let vector = embeddings::embed_query(&json!({"config": config, "text": query})).await?;
    let result = search_memory_vectors(
        &json!({"operation": "search-vectors", "scope": scope, "vector": vector, "limit": limit}),
    )?;
    Ok(if result.is_null() {
        bank["fallback"].clone()
    } else {
        result
    })
}

pub async fn recall_memory_tool(
    directory: &std::path::Path,
    request: &Value,
) -> Result<Value, String> {
    let query = request["query"].as_str().ok_or("Expected a memory query")?;
    let config =
        embeddings::resolve_config(directory, std::env::var("OPENAI_API_KEY").ok().as_deref());
    let vector = embeddings::embed_query(&json!({"config": config, "text": query})).await?;
    memory_graph::recall(directory, query, &vector)
}

pub async fn upsert_memory_tool(
    directory: &std::path::Path,
    input: &Value,
) -> Result<Value, String> {
    let config =
        embeddings::resolve_config(directory, std::env::var("OPENAI_API_KEY").ok().as_deref());
    let vector =
        match embeddings::embed_query(&json!({"config": config, "text": input["value"]})).await {
            Ok(vector) => vector,
            Err(_) => return Ok(json!({"embedded": false})),
        };
    let mut input = input.clone();
    input["embedding"] = vector;
    memory_graph::upsert(directory, &input)?;
    Ok(json!({"embedded": true}))
}

/// The skills shipped with the app: bundled under resources/skills, or main/skills in a dev build.
fn builtin_skills_dir(app: Option<&AppHandle>) -> Option<PathBuf> {
    let bundled = app
        .and_then(|app| app.path().resource_dir().ok())
        .map(|dir| dir.join("skills"))
        .filter(|dir| dir.is_dir());
    bundled.or_else(|| {
        cfg!(debug_assertions)
            .then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../main/skills"))
            .filter(|dir| dir.is_dir())
    })
}

fn dispatch(app: Option<&AppHandle>, channel: &str, args: &[Value]) -> Result<Value, String> {
    let a = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let s = |i: usize| args.get(i).and_then(Value::as_str);
    let text = |i: usize| match args.get(i) {
        Some(Value::String(t)) => t.clone(),
        Some(Value::Null) | None => "undefined".into(),
        Some(v) => v.to_string(),
    };
    let ef = home()?.join(".everfern");
    let plans = files::Plans(ef.join("chat").join("plan"));
    let sites = files::Sites(ef.join("sites"));
    let arts = files::Artifacts(ef.join("artifacts"));

    let db_call = |f: &dyn Fn(&Connection) -> Result<Value, String>| {
        with_db(f)
            .and_then(|r| r)
            .or_else(|e| Ok(fallback(channel, e)))
    };

    match channel {
        "skills:get-custom-path" | "skills:list-custom" | "skills:list-all" | "skills:save-custom"
        | "skills:delete-custom" => {
            let skills = skills::Skills { root: ef.clone(), builtin: builtin_skills_dir(app) };
            Ok(match channel {
                "skills:get-custom-path" => json!(skills.custom_dir().to_string_lossy()),
                "skills:list-custom" => skills.list_custom(),
                "skills:list-all" => skills.list_all(),
                "skills:save-custom" => skills.save_custom(&a(0)),
                _ => skills.delete_custom(s(0)),
            })
        }
        "sheets:load" | "sheets:save" => {
            let app = app.ok_or("This operation requires the desktop application")?;
            let root = crate::store::root(app)?;
            Ok(match (channel, sheets::safe_id(s(0))) {
                ("sheets:load", Some(id)) => sheets::load(&root, id),
                ("sheets:load", None) => Value::Null,
                (_, Some(id)) if args.get(1).is_some_and(|d| d.is_object() || d.is_array()) => {
                    json!({ "success": true, "data": sheets::save(&root, id, &a(1))? })
                }
                _ => json!({ "success": false }),
            })
        }
        // Null on other platforms: the bridge then asks Node.
        c if c.starts_with("autostart:") => Ok(autostart::handle(c).unwrap_or(Value::Null)),
        "system:get-username" => Ok(json!(["USERNAME", "USER"]
            .iter()
            .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
            .unwrap_or_else(|| "User".into()))),
        "system:to-host-path" | "system:toHostPath" => {
            Ok(args.first().map_or(Value::Null, |path| {
                path.as_str().map_or_else(
                    || path.clone(),
                    |path| json!(crate::vm::guest_path_to_host(path)),
                )
            }))
        }
        "agent:get-rollback-changes" => with_db(|conn| db::rollback_changes(conn, args))?,
        "mcp:list" | "mcp:import-json" | "mcp:remove" | "mcp:reconnect" | "mcp:set-enabled"
        | "mcp:save" => {
            use tauri::Emitter;
            let app = app.ok_or("This operation requires the desktop application")?;
            let path = crate::store::root(app)?.join("mcp-servers.json");
            if channel == "mcp:list" {
                return Ok(mcp_config::inactive_mcp_status(&path));
            }
            let result = match channel {
                "mcp:import-json" => mcp_config::import_configs(&path, s(0)),
                "mcp:remove" => mcp_config::remove_server(&path, s(0)),
                "mcp:reconnect" => {
                    return Ok(mcp_config::inactive_connection_request(&path, s(0), false))
                }
                "mcp:set-enabled" => match args.get(1).and_then(Value::as_bool) {
                    Some(enabled) => mcp_config::set_server_enabled(&path, s(0), enabled),
                    None => return Ok(Value::Null),
                },
                _ => mcp_config::save_config(&path, &a(0), s(1)),
            }
            .unwrap_or_else(|error| json!({"success":false,"error":error}));
            if result["success"] == true {
                let status = mcp_config::inactive_mcp_status(&path);
                if status.is_array() {
                    let _ = app.emit("mcp:changed", status);
                }
            }
            return Ok(result);
        }
        "agent:rollback-file-only-turn"
        | "acp:list-tools-unconfigured"
        | "integration:get-service-status"
        | "integration:get-system-status"
        | "hitl:resolve"
        | "system:stop-dispatch"
        | "system:broadcast-dispatch"
        | "acp:active"
        | "acp:stop"
        | "acp:get-interrupted-state"
        | "terminal:get-status" => {
            use tauri::Manager;
            let app = app.ok_or("This operation requires the desktop application")?;
            let state = app.state::<crate::Sidecar>();
            let Some(_starting) = state.lock_if_stopped()? else {
                return Ok(Value::Null);
            };
            if matches!(
                channel,
                "system:stop-dispatch" | "system:broadcast-dispatch"
            ) {
                return Ok(json!({"success": true}));
            }
            if channel == "acp:list-tools-unconfigured" {
                let saved = config::load_config(&ef);
                if saved["config"]["provider"]
                    .as_str()
                    .is_none_or(str::is_empty)
                {
                    return Ok(json!({"success": true, "tools": []}));
                }
                return Ok(Value::Null);
            }
            if channel == "hitl:resolve" {
                return Ok(hitl::resolve(&ef, args)
                    .unwrap_or_else(|error| json!({"success": false, "error": error})));
            }
            if channel == "acp:get-interrupted-state" {
                return Ok(stored_interrupted_state(&ef.join("sql"), s(0)));
            }
            if channel == "acp:active" {
                return Ok(json!([]));
            }
            if channel == "acp:stop" {
                return Ok(json!({"success": true}));
            }
            if channel == "terminal:get-status" {
                return Ok(json!({"success": false, "error": "Command not found"}));
            }
            if channel == "agent:rollback-file-only-turn" {
                return with_db(|conn| db::rollback_file_only_turn(conn, args))?;
            }
            if channel.starts_with("integration:") {
                return match channel {
                    "integration:get-service-status" => {
                        Ok(match s(0).filter(|name| !name.is_empty()) {
                            Some(name) => json!({"name": name, "status": "stopped"}),
                            None => json!([]),
                        })
                    }
                    "integration:get-system-status" => Ok(json!({
                        "initialized": false, "started": false, "servicesRunning": 0,
                        "servicesTotal": 0, "errors": []
                    })),
                    _ => integrations::dispatch(&ef, channel, args.first()),
                };
            }
            Err(format!("No stopped-sidecar handler for {channel}"))
        }
        "tool-settings:delete-synthesized" => {
            Ok(match tool_settings::delete_synthesized(&ef, s(0)) {
                Ok(()) => json!({"success": true}),
                Err(error) => json!({"success": false, "error": error}),
            })
        }
        "agent:get-snapshot-content" => with_db(|conn| db::snapshot_content(conn, args.first()))?,
        "save-config" => {
            use tauri::Manager;
            let state = app
                .ok_or("This operation requires the desktop application")?
                .state::<crate::Sidecar>();
            let stopped = state.lock_if_stopped()?;
            Ok(match config::save_config(&ef, &a(0)) {
                Ok(()) => json!({"success": true, "refreshRuntime": stopped.is_none()}),
                Err(error) => json!({"success": false, "error": error}),
            })
        }
        "tool-approvals:add-global" => approval_storage(&json!({"operation": "add", "data": a(0)})),
        "tool-approvals:list-global" => approval_storage(&json!({"operation": "load"})),
        "tool-approvals:clear-global" => {
            approval_storage(&json!({"operation": "save", "policies": []}))?;
            Ok(json!({"success": true}))
        }
        "tool-approvals:delete-global" => {
            approval_storage(&json!({"operation": "delete", "data": a(0)}))
        }
        "tool-approvals:update-global" => {
            let data = a(0);
            if db::truthy(data["updates"].get("conversationId")) {
                return Ok(Value::Null);
            }
            approval_storage(&json!({"operation": "update", "data": data}))
        }
        "agent:get-rollback-preview" => with_db(|conn| db::rollback_preview(conn, args)),
        "tool-settings:list-synthesized" => tool_settings::list_synthesized(&ef),
        "hitl:get-pending" => Ok(hitl::pending(&ef, s(0)).unwrap_or(Value::Null)),
        "integration:get-config" => Ok(integrations::config_for_renderer(&ef)),
        "integration:save-config" => {
            use tauri::Manager;
            let state = app
                .ok_or("This operation requires the desktop application")?
                .state::<crate::Sidecar>();
            let stopped = state.lock_if_stopped()?;
            let needs_runtime =
                integrations::dispatch(&ef, "integration:save-and-check-runtime", args.first())?;
            Ok(json!(stopped.is_none() || needs_runtime == true))
        }
        "memory:get-graph" => Ok(memory_graph::load(&ef)),
        "memory:delete-node" => {
            let id = s(0).ok_or("Expected a memory node ID")?;
            Ok(memory_graph::delete_node(&ef, id)
                .unwrap_or_else(|error| json!({"success": false, "error": error})))
        }
        "memory:save-direct" => Ok(memory_graph::save_direct(&ef, s(0).unwrap_or_default(), "")),
        "memory:import-merge-graph" => {
            let app = app.ok_or("Memory import requires the desktop application")?;
            let Some(source) = crate::shell::pick_memory_backup(app)? else {
                return Ok(json!({"success": false, "reason": "canceled"}));
            };
            Ok(memory_graph::import_merge(&ef, &source)
                .unwrap_or_else(|error| json!({"success": false, "error": error})))
        }
        "memory:export-zip" => {
            let app = app.ok_or("Memory export requires the desktop application")?;
            let name = format!(
                "everfern-memory-{}.zip",
                chrono::Utc::now().format("%Y-%m-%d")
            );
            let target = crate::shell::ef_save_file(
                app.clone(),
                Some("Export Memory Graph".into()),
                Some(name),
                Some(home()?.join("Desktop").to_string_lossy().into_owned()),
                Some("ZIP Archive".into()),
                Some(vec!["zip".into()]),
            )?;
            let Some(target) = target else {
                return Ok(json!({"success": false, "reason": "canceled"}));
            };
            Ok(
                match memory_graph::export_zip(&ef, std::path::Path::new(&target)) {
                    Ok(()) => json!({"success": true, "filePath": target}),
                    Err(error) => json!({"success": false, "error": error}),
                },
            )
        }
        "db:checkConnection" => Ok(db::check_health(&ef.join("sql").join("memory.sqlite"))
            .unwrap_or_else(|error| json!({"success": false, "error": error}))),
        "vectors:refresh-config" => Ok(json!({"success": true})),
        "vectors:stats" => Ok(db::chat_vector_stats(&ef.join("sql").join("chat.sqlite"))
            .unwrap_or_else(|error| {
                json!({"messageCount": 0, "dimensionCount": null,
                "storageSize": 0, "initialized": false, "error": error})
            })),
        "vectors:search" => Ok(
            db::search_chat_index(&ef.join("sql").join("chat.sqlite"), args)
                .unwrap_or_else(|_| json!([])),
        ),
        "vectors:index-message" => Ok(db::index_chat_message(
            &ef.join("sql").join("chat.sqlite"),
            args,
        )
        .unwrap_or_else(|error| json!({"success": false, "error": error}))),
        "vectors:get" | "vectors:delete" => {
            let delete = channel == "vectors:delete";
            Ok(
                db::chat_vector_messages(&ef.join("sql").join("chat.sqlite"), args.first(), delete)
                    .unwrap_or_else(|error| {
                        if delete {
                            json!({"success": false, "error": error})
                        } else {
                            json!([])
                        }
                    }),
            )
        }
        "db:checkVectors" => {
            let app = app.ok_or("Vector health check requires the desktop application")?;
            Ok(
                db::check_vectors(&ef.join("sql").join("memory.sqlite"), &crate::app_root(app))
                    .unwrap_or_else(|error| json!({"success": false, "count": 0, "error": error})),
            )
        }
        "history:get-vectors" => {
            let app = app.ok_or("Vector history requires the desktop application")?;
            let limit = args.first().and_then(Value::as_i64).unwrap_or(100);
            Ok(db::history_vectors(
                &ef.join("sql").join("memory.sqlite"),
                &crate::app_root(app),
                limit,
            )
            .unwrap_or_else(|_| json!([])))
        }
        "openclaw:get-configs" => Ok(personality::load(&ef, s(0))),
        "openclaw:save-configs" => Ok(match personality::save(&ef, &a(0)) {
            Ok(()) => json!({"success": true}),
            Err(error) => json!({"success": false, "error": error}),
        }),
        "analytics:get-cached-model-pricing" => Ok(pricing::cached_list(&ef)
            .map(|data| json!({"success": true, "data": data}))
            .unwrap_or(Value::Null)),
        "analytics:get-cached-model-info" => Ok(s(0)
            .and_then(|id| pricing::cached_model_info(&ef, id))
            .map(|data| json!({"success": true, "data": data}))
            .unwrap_or(Value::Null)),
        "analytics:get-summary" => {
            let summary = with_db(|conn| db::analytics_summary(conn))
                .unwrap_or_else(|_| db::empty_analytics_summary());
            Ok(json!({"success": true, "data": summary}))
        }
        "history:list" => db_call(&|c| db::history_list(c)),
        "history:listByProject" => db_call(&|c| db::history_list_by_project(c, &a(0))),
        "history:load" => db_call(&|c| db::history_load(c, &a(0))),
        "history:save" => {
            let (mut res, index) = match with_db(|c| db::history_save(c, &a(0))) {
                Ok(r) => r,
                Err(e) => (fallback(channel, e), vec![]),
            };
            // The bridge hands these to Node for embedding, then strips the field.
            if !index.is_empty() {
                res["__index"] = Value::Array(index);
            }
            Ok(res)
        }
        "history:delete" => db_call(&|c| db::history_delete(c, &a(0))),
        "history:togglePin" => db_call(&|c| db::history_toggle_pin(c, &a(0))),
        "history:toggleUnread" => db_call(&|c| db::history_toggle_unread(c, &a(0))),
        "history:updateTitle" => db_call(&|c| db::history_update_title(c, &a(0), &a(1))),
        "history:setProject" => db_call(&|c| db::history_set_project(c, &a(0), &a(1))),

        "projects:list" => db_call(&|c| db::projects_list(c)),
        "projects:create" => db_call(&|c| Ok(db::projects_create(c, &a(0)))),
        "projects:update" => db_call(&|c| db::projects_update(c, &a(0), &a(1))),
        "projects:toggleBookmark" => db_call(&|c| db::projects_toggle_bookmark(c, &a(0))),
        "projects:delete" => db_call(&|c| db::projects_delete(c, &a(0))),
        "load-config" => Ok(config::load_config(&ef)),
        "acp:list-providers" | "providers:get-all" | "providers:get-models" => {
            let mut metadata: Value =
                serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/providers.json")))
                    .map_err(|error| error.to_string())?;
            if channel == "providers:get-models" {
                let models = metadata["models"][s(0).unwrap_or_default()].take();
                return Ok(if models.is_null() { json!([]) } else { models });
            }
            let Value::Array(mut catalog) = metadata["providers"].take() else {
                return Err("Invalid embedded provider catalog".into());
            };
            if channel == "providers:get-all" {
                let config = config::load_config(&ef);
                let keys = &config["config"]["keys"];
                for provider in &mut catalog {
                    let provider_type = provider["type"].as_str().unwrap_or_default();
                    let enabled = provider["requiresApiKey"] != true
                        || keys[provider_type]
                            .as_str()
                            .is_some_and(|key| !key.trim().is_empty());
                    provider["enabled"] = json!(enabled);
                }
                return Ok(Value::Array(catalog));
            }
            Ok(Value::Array(
                catalog
                    .into_iter()
                    .map(|provider| {
                        let fields = [
                            "type",
                            "name",
                            "description",
                            "requiresApiKey",
                            "defaultModel",
                            "isLocal",
                        ];
                        Value::Object(
                            fields
                                .into_iter()
                                .filter_map(|field| {
                                    provider
                                        .get(field)
                                        .map(|value| (field.to_owned(), value.clone()))
                                })
                                .collect(),
                        )
                    })
                    .collect(),
            ))
        }
        "tool-settings:get" | "tool-settings:set" => tool_settings::dispatch(channel, args.first()),
        "screenshot:load" => Ok(files::load_screenshot(&ef.join("screenshots"), s(0))),
        "system:read-image-data-url" => Ok(files::read_image_data_url(s(0))),
        "system:parse-docx" => Ok(documents::parse_docx(s(0))),
        "system:parse-pptx" => Ok(documents::parse_pptx(s(0))),
        "system:parse-xlsx" => Ok(documents::parse_xlsx(s(0))),
        "system:ocr-status" => Ok(json!({"ready": documents::ocr_ready(&ef.join("ocr-venv"))})),
        "system:ensure-attachment-in-vm" => Ok(files::ensure_attachment_in_vm(s(0))),
        "projects:getEverfernPath" => Ok(json!(ef.to_string_lossy())),
        "projects:getDefaultPath" => {
            let docs = app
                .and_then(|h| h.path().document_dir().ok())
                .unwrap_or_else(|| home().unwrap_or_default().join("Documents"));
            Ok(json!(docs
                .join("Everfern")
                .join("Projects")
                .to_string_lossy()))
        }
        "projects:listFiles" => Ok(files::list_project_files(s(0))),
        "projects:readFile" => Ok(files::read_project_file(s(0), s(1))),
        "projects:readFileDataUrl" => Ok(files::read_project_file_data_url(s(0), s(1))),

        "scheduled-tasks:list" => db_call(&|c| db::tasks_list(c, args.first())),
        "scheduled-tasks:get" => db_call(&|c| db::tasks_get(c, &a(0))),
        "scheduled-tasks:save" => with_db(|c| db::tasks_save(c, &a(0)))?,
        "scheduled-tasks:delete" => db_call(&|c| Ok(db::tasks_delete(c, &a(0)))),

        "plans:list" => Ok(plans.list(s(0))),
        "plans:read" => Ok(plans.read(s(0), s(1).unwrap_or("undefined"))),
        "plans:write" => Ok(plans.write(s(0), s(1).unwrap_or("undefined"), &text(2))),
        "plans:delete" => Ok(plans.delete(s(0), s(1).unwrap_or("undefined"))),

        "sites:list" => Ok(sites.list()),
        "sites:read-file" => Ok(sites.read(s(0), s(1).unwrap_or("undefined"))),
        "sites:write-file" => Ok(sites.write(s(0), s(1).unwrap_or("undefined"), &text(2))),
        "sites:delete" => Ok(sites.delete(s(0))),

        "artifacts:list" => Ok(arts.list(s(0), s(1))),
        "artifacts:read" => Ok(arts.read(s(0), s(1).unwrap_or("undefined"), s(2))),
        "artifacts:write" => Ok(arts.write(s(0), s(1).unwrap_or("undefined"), &text(2), s(3))),
        "artifacts:delete" => Ok(arts.delete(s(0), s(1).unwrap_or("undefined"), s(2))),
        "artifacts:touch" => Ok(arts.touch(s(0), s(1).unwrap_or("undefined"), s(2))),

        other => Err(format!("No Rust handler for {other}")),
    }
}

/// Whether an enabled chat bot needs the Node sidecar at launch.
pub fn node_needed_at_launch() -> Option<&'static str> {
    config::node_needed_at_launch(&home().ok()?.join(".everfern"))
}

pub fn approval_route(request: &Value) -> &'static str {
    match request["approved"].as_bool() {
        Some(true) => "multi_tool_orchestrator",
        Some(false) => "brain",
        None => "__end__",
    }
}

#[test]
fn approval_route_requires_explicit_approval_to_run_tools() {
    assert_eq!(
        approval_route(&json!({"approved":true})),
        "multi_tool_orchestrator"
    );
    assert_eq!(approval_route(&json!({"approved":false})), "brain");
    assert_eq!(approval_route(&json!({"approved":"true"})), "__end__");
    assert_eq!(approval_route(&json!({})), "__end__");
}

pub fn specialist_exit(request: &Value) -> &'static str {
    let text = request["text"]
        .as_str()
        .unwrap_or_default()
        .trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'));
    let long_answer = text.encode_utf16().take(200).count() >= 200;
    let coding = request["coding"] == true;
    let done = request["done"] == true;
    if coding
        && !done
        && !long_answer
        && request["textOnlyStreak"].as_f64().unwrap_or_default() <= 1.0
    {
        return "coding_specialist";
    }
    if request["intent"] == "operator" {
        return "operator_coordinator";
    }
    if (done || coding)
        && long_answer
        && request["steps"].as_u64().unwrap_or_default() <= 1
        && matches!(request["role"].as_str(), Some("ai" | "assistant"))
        && request["toolCalls"].as_u64().unwrap_or_default() == 0
    {
        return "memory_consolidator";
    }
    "brain"
}

#[test]
fn specialist_exit_preserves_grace_pass_and_operator_precedence() {
    assert_eq!(
        specialist_exit(&json!({"intent":"operator","coding":true})),
        "coding_specialist"
    );
    assert_eq!(
        specialist_exit(&json!({"intent":"operator","done":true})),
        "operator_coordinator"
    );
    let mut answer = json!({"done":true,"role":"ai","text":"x".repeat(200)});
    assert_eq!(specialist_exit(&answer), "memory_consolidator");
    answer["steps"] = json!(2);
    assert_eq!(specialist_exit(&answer), "brain");
    assert_eq!(specialist_exit(&json!({})), "brain");
}

pub fn tool_return_route(request: &Value) -> &'static str {
    let mut completed = false;
    for message in request["messages"].as_array().into_iter().flatten().rev() {
        match message["role"].as_str() {
            Some("assistant" | "ai") => break,
            Some("tool" | "function") => match message["name"].as_str() {
                Some("ask_user_question") => return "ask_user_wait",
                Some("task_complete") => completed = true,
                _ => {}
            },
            _ => {}
        }
    }
    if completed {
        return if request["intent"] == "operator" {
            "operator_coordinator"
        } else {
            "brain"
        };
    }
    match request["specialist"].as_str() {
        Some("coding_specialist") => "coding_specialist",
        Some("data_analyst") => "data_analyst",
        Some("web_explorer") => "web_explorer",
        Some("deep_research") => "deep_research",
        _ => "brain",
    }
}

#[test]
fn tool_return_route_preserves_clarification_and_completion_order() {
    assert_eq!(
        tool_return_route(&json!({"messages":[
            {"role":"tool","name":"ask_user_question"},{"role":"tool","name":"task_complete"}
        ]})),
        "ask_user_wait"
    );
    assert_eq!(
        tool_return_route(&json!({"messages":[{"role":"tool","name":"task_complete"}],
        "intent":"operator","specialist":"data_analyst"})),
        "operator_coordinator"
    );
    assert_eq!(
        tool_return_route(&json!({"messages":[
            {"role":"tool","name":"ask_user_question"},{"role":"ai"}
        ]})),
        "brain"
    );
    assert_eq!(
        tool_return_route(&json!({"specialist":"deep_research"})),
        "deep_research"
    );
    assert_eq!(tool_return_route(&json!({})), "brain");
}

pub fn decomposer_route(request: &Value) -> &'static str {
    match request["intent"].as_str() {
        Some("coding" | "build" | "fix") => "coding_specialist",
        Some("research") => "brain",
        _ => "global_planner",
    }
}

fn project_scale_coding(request: &Value) -> bool {
    use std::sync::LazyLock;
    static SMALL: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
        r"(?i-u)\b(typo|rename|one[- ]liner?|one line|quick fix|small fix|tweak|this (line|function|method|file|bug|error|test))\b"
    ).unwrap()
    });
    static BUILD: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
        r"(?i-u)\b(build|create|make|scaffold|set ?up|bootstrap|implement|develop|generate|write)\b"
    ).unwrap()
    });
    static PROJECT: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
        r"(?i-u)\b(app|application|project|website|web ?site|dashboard|game|platform|saas|backend|frontend|full[- ]?stack|landing page|extension|plugin|cli|microservices?|monorepo|from scratch|end[- ]to[- ]end|boilerplate|starter)\b"
    ).unwrap()
    });
    static LIST_ITEM: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\s*([0-9]+[.)]|[-*•])\s+\S").unwrap());
    if !matches!(request["intent"].as_str(), Some("coding" | "build" | "fix")) {
        return false;
    }
    let text = request["userText"]
        .as_str()
        .unwrap_or_default()
        .trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'));
    !SMALL.is_match(text)
        && (text
            .lines()
            .filter(|line| LIST_ITEM.is_match(line))
            .take(3)
            .count()
            == 3
            || text.encode_utf16().take(701).count() > 700
            || (BUILD.is_match(text) && PROJECT.is_match(text)))
}

pub fn operator_route(request: &Value) -> &'static str {
    match request["decision"].as_str() {
        Some("route_coding") if project_scale_coding(request) => "task_decomposer",
        Some("route_coding") => "coding_specialist",
        Some("route_data_analyst") => "data_analyst",
        Some("route_web_explorer") => "web_explorer",
        Some("route_deep_research") => "deep_research",
        _ => "memory_consolidator",
    }
}

#[test]
fn specialist_routes_preserve_operator_and_decomposer_defaults() {
    assert_eq!(decomposer_route(&json!({})), "global_planner");
    assert_eq!(decomposer_route(&json!({"intent":"research"})), "brain");
    assert_eq!(
        operator_route(
            &json!({"decision":"route_coding","intent":"coding","userText":"Build a dashboard"})
        ),
        "task_decomposer"
    );
    assert_eq!(
        operator_route(&json!({"decision":"route_deep_research"})),
        "deep_research"
    );
    assert_eq!(operator_route(&json!({})), "memory_consolidator");
}

pub fn triage_finalize(request: &Value) -> Value {
    let classification = &request["classification"];
    if classification["intent"] == "operator" && request["operatorMode"] != true {
        return json!({
            "intent": "task",
            "confidence": classification["confidence"].as_f64().map(|value| value.min(0.75)),
            "reasoning": "Operator mode requires the user to enable Pursue goal manually."
        });
    }
    classification.clone()
}

#[test]
fn triage_finalize_requires_explicit_operator_mode() {
    let classification = json!({"intent":"operator","confidence":0.9,"reasoning":"model"});
    assert_eq!(
        triage_finalize(&json!({"classification":classification}))["confidence"],
        0.75
    );
    assert_eq!(
        triage_finalize(&json!({"classification":classification}))["intent"],
        "task"
    );
    assert_eq!(
        triage_finalize(&json!({"classification":classification,"operatorMode":true})),
        classification
    );
}

pub fn triage_prompt(request: &Value) -> Value {
    let field = |key: &str| request[key].as_str().unwrap_or_default();
    let history = request["messages"]
        .as_array()
        .map(|messages| {
            messages[messages.len().saturating_sub(5)..]
                .iter()
                .map(|message| {
                    let role = message["role"]
                        .as_str()
                        .filter(|role| !role.is_empty())
                        .unwrap_or("user")
                        .to_uppercase();
                    let text = message["text"].as_str().unwrap_or_default();
                    let text = String::from_utf16_lossy(
                        &text.encode_utf16().take(200).collect::<Vec<_>>(),
                    );
                    let attachment = if message["hasFiles"] == true {
                        " [FILE ATTACHED]"
                    } else {
                        ""
                    };
                    format!("[{role}]: {text}{attachment}")
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let history = if history.is_empty() { "None" } else { &history };
    let mode = if request["operatorMode"] == true {
        "ENABLED"
    } else {
        "DISABLED"
    };
    let input = field("userInput");
    let user = format!("\nCONVERSATION HISTORY (last 5 messages):\n{history}\n\nMANUAL PURSUE GOAL / OPERATOR MODE:\n{mode}\n\nCURRENT USER REQUEST:\n\"{input}\"\n\nClassify the intent.");
    let plain_system = field("system");
    let system = if request["worker"] == true {
        plain_system.to_owned()
    } else {
        format!("{plain_system}\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n{}\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n{}",
            field("soul"), field("agents"))
    };
    json!({"system": system, "user": user})
}

#[test]
fn triage_prompt_keeps_worker_and_chat_context_distinct() {
    let worker = triage_prompt(
        &json!({"worker":true,"system":"rules","soul":"persona","userInput":"example"}),
    );
    assert_eq!(worker["system"], "rules");
    assert_eq!(worker["user"], "\nCONVERSATION HISTORY (last 5 messages):\nNone\n\nMANUAL PURSUE GOAL / OPERATOR MODE:\nDISABLED\n\nCURRENT USER REQUEST:\n\"example\"\n\nClassify the intent.");
    let chat = triage_prompt(
        &json!({"system":"rules","soul":"persona","agents":"agents","operatorMode":true}),
    );
    assert!(chat["system"].as_str().unwrap().contains("persona"));
    assert!(chat["user"].as_str().unwrap().contains("\nENABLED\n"));
    let history = triage_prompt(&json!({"messages":[
        {"role":"assistant","text":"Earlier"},
        {"role":"user","text":"x".repeat(201),"hasFiles":true}
    ]}));
    assert!(history["user"].as_str().unwrap().contains(&format!(
        "[ASSISTANT]: Earlier\n[USER]: {} [FILE ATTACHED]",
        "x".repeat(200)
    )));
}

pub fn triage_parse(request: &Value) -> Value {
    use std::sync::LazyLock;
    static THINK: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?s)<think>.*?</think>").unwrap());
    static FENCE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"```(?:json)?\s*").unwrap());
    let content = request["content"].as_str().unwrap_or_default();
    let visible = THINK.replace_all(content, "");
    let visible = FENCE.replace_all(&visible, "");
    let Ok(response) = serde_json::from_str::<Value>(
        visible.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')),
    ) else {
        return Value::Null;
    };
    if response.is_null() {
        return Value::Null;
    }
    json!({
        "intent": if db::truthy(response.get("intent")) { response["intent"].clone() } else { json!("task") },
        "confidence": if response["confidence"].is_number() { response["confidence"].clone() } else { json!(0.7) },
        "reasoning": if db::truthy(response.get("reasoning")) { response["reasoning"].clone() } else { json!("AI classification") },
    })
}

#[test]
fn triage_parse_handles_reasoning_wrappers_and_defaults() {
    assert_eq!(
        triage_parse(
            &json!({"content":"<think>hidden\ntext</think>\n```json\n{\"intent\":\"coding\"}\n```"})
        ),
        json!({"intent":"coding","confidence":0.7,"reasoning":"AI classification"})
    );
    assert!(triage_parse(&json!({"content":"invalid"})).is_null());
}

pub fn triage_fast(request: &Value) -> Value {
    let input = request["userInput"]
        .as_str()
        .unwrap_or_default()
        .to_lowercase();
    let input =
        input.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'));
    let words = [
        "yes", "ok", "okay", "sure", "yep", "yeah", "proceed", "continue", "go", "ahead",
    ];
    let length = input.encode_utf16().count();
    let parts: Vec<_> = input.split_whitespace().collect();
    let affirmative = input == "go ahead"
        || (words[..8].contains(&input))
        || (length < 15
            && !parts.is_empty()
            && parts.len() <= 3
            && parts.iter().all(|part| words.contains(part)))
        || (length < 10 && words[..9].iter().any(|word| input.starts_with(word)));
    if !affirmative {
        return Value::Null;
    }
    if let Some(intent) = request["cachedIntent"].as_str() {
        return json!({"intent":intent,"confidence":0.95,"reasoning":"Context inheritance"});
    }
    let content = &request["previousContent"];
    let has_attachment = |item: &Value| {
        ["file", "name", "path"]
            .iter()
            .any(|key| db::truthy(item.get(key)))
    };
    let attachment = if let Some(items) = content.as_array() {
        items
            .iter()
            .any(|item| item["type"] == "file" || has_attachment(item))
    } else {
        content.is_object() && has_attachment(content)
    };
    if !attachment {
        return Value::Null;
    }
    let intent = content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "file")
        .find_map(|file| {
            let name = file["name"]
                .as_str()
                .filter(|name| !name.is_empty())
                .or_else(|| file["path"].as_str())
                .unwrap_or_default();
            let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
            match extension.as_str() {
                "csv" | "xlsx" | "xls" | "json" | "data" => Some("analyze"),
                "ts" | "js" | "tsx" | "jsx" | "py" | "java" | "cpp" | "c" | "php" | "rb" | "go"
                | "rs" => Some("coding"),
                _ => None,
            }
        })
        .unwrap_or("analyze");
    json!({"intent":intent,"confidence":0.95,"reasoning":"Context inheritance: short affirmative"})
}

#[test]
fn triage_fast_inherits_cached_intent_before_attachment_type() {
    let mut request =
        json!({"userInput":"okay!", "previousContent":[{"type":"file","name":"code.RS"}]});
    assert_eq!(triage_fast(&request)["intent"], "coding");
    request["cachedIntent"] = json!("research");
    assert_eq!(triage_fast(&request)["intent"], "research");
    request["userInput"] = json!("Please revise this");
    assert!(triage_fast(&request).is_null());
}

pub fn triage_fallback(request: &Value) -> Value {
    use std::sync::LazyLock;
    static RESEARCH: LazyLock<regex::RegexSet> = LazyLock::new(|| {
        regex::RegexSet::new([
        r"(?-u:\b)(?:search(?:\s+(?:the\s+)?(?:web|internet))?\s+for|look\s+up|find\s+me|google(?:\s+for)?)(?-u:\b)",
        r"(?-u:\b)compile(?-u:\b)[^.!?]*(?-u:\b)list(?-u:\b)|(?-u:\b)comprehensive\s+list(?-u:\b)|(?-u:\b)find\s+(?:me\s+)?(?:the\s+)?(?:top|best)(?-u:\b)|(?-u:\b)top\s+[0-9]+(?:\s*-\s*[0-9]+)?(?-u:\b)",
    ]).unwrap()
    });
    let input = request["userInput"]
        .as_str()
        .unwrap_or_default()
        .to_lowercase();
    if RESEARCH.is_match(&input) {
        json!({"intent":"research", "confidence":0.85,
            "reasoning":"Request requires finding, comparing, or compiling information"})
    } else {
        json!({"intent":"task", "confidence":0.5, "reasoning":"Fallback default to task"})
    }
}

#[test]
fn triage_fallback_recognizes_search_and_list_requests() {
    assert_eq!(
        triage_fallback(&json!({"userInput":"Search the web for models"}))["intent"],
        "research"
    );
    assert_eq!(
        triage_fallback(&json!({"userInput":"Compile a list of models"}))["confidence"],
        0.85
    );
    assert_eq!(
        triage_fallback(&json!({"userInput":"Write a unit test"}))["intent"],
        "task"
    );
}

pub fn triage_route(request: &Value) -> &'static str {
    match request["intent"].as_str() {
        Some("operator") => "operator_coordinator",
        Some("question" | "conversation" | "research") => "brain",
        Some("coding" | "build" | "fix") if !project_scale_coding(request) => "coding_specialist",
        Some("automate" | "task") => "debate_chamber",
        _ => "task_decomposer",
    }
}

#[test]
fn triage_route_distinguishes_project_scale_and_direct_coding() {
    assert_eq!(triage_route(&json!({"intent":"fix"})), "coding_specialist");
    assert_eq!(
        triage_route(&json!({"intent":"fix","userText":"Build a dashboard"})),
        "task_decomposer"
    );
    assert_eq!(
        triage_route(&json!({"intent":"fix","userText":"Quick fix while building the dashboard"})),
        "coding_specialist"
    );
    assert_eq!(
        triage_route(&json!({"intent":"coding","userText":"- one\n- two\n- three"})),
        "task_decomposer"
    );
    assert_eq!(triage_route(&json!({"intent":"research"})), "brain");
    assert_eq!(
        triage_route(&json!({"intent":"automate"})),
        "debate_chamber"
    );
}

pub fn brain_route(request: &Value) -> &'static str {
    if request["reason"] == "needs_hitl" {
        return "hitl_approval";
    }
    if request["hasTools"] == true {
        return "pending_tools";
    }
    match request["decision"].as_str() {
        Some("route_coding") => "coding_specialist",
        Some("route_data_analyst") => "data_analyst",
        Some("route_web_explorer") => "web_explorer",
        Some("route_deep_research") => "deep_research",
        Some("route_computer_use") => "brain",
        Some("continue_brain") => match request["reason"].as_str() {
            Some("waiting_for_user_input" | "cannot_proceed") => "__end__",
            Some("task_complete") => "memory_consolidator",
            _ if request["clarificationCount"].as_f64().unwrap_or_default() >= 3.0 => "__end__",
            _ => "brain",
        },
        _ => "memory_consolidator",
    }
}

#[test]
fn brain_route_preserves_specialist_and_completion_precedence() {
    assert_eq!(
        brain_route(&json!({"reason":"needs_hitl","hasTools":true})),
        "hitl_approval"
    );
    assert_eq!(
        brain_route(&json!({"decision":"complete_task","hasTools":true})),
        "pending_tools"
    );
    assert_eq!(
        brain_route(&json!({"decision":"route_deep_research"})),
        "deep_research"
    );
    assert_eq!(
        brain_route(&json!({"decision":"continue_brain","clarificationCount":3})),
        "__end__"
    );
    assert_eq!(
        brain_route(
            &json!({"decision":"continue_brain","reason":"task_complete","clarificationCount":3})
        ),
        "memory_consolidator"
    );
    assert_eq!(
        brain_route(&json!({"decision":"continue_brain","reason":"waiting_for_user_input"})),
        "__end__"
    );
}

pub fn complete_agent_task(request: &Value) -> Value {
    let summary = request["summary"].as_str().unwrap_or("Task completed.");
    json!({
        "success": true,
        "output": format!("Task marked as complete. Summary: {summary}"),
        "data": {"completed": true, "summary": summary}
    })
}

pub fn clarification_answer(request: &Value) -> Value {
    let answer = request["answer"].as_str().unwrap_or_default();
    let rejected = ["[HITL_REJECTED]", "Reject — cancel"]
        .iter()
        .any(|flag| answer.contains(flag));
    let approved = [
        "[HITL_APPROVED]",
        "[HITL_APPROVED_ALWAYS]",
        "[HITL_APPROVED_PREFIX]",
        "proceed once",
        "Approve & Allow Always",
        "Approve & Allow Prefix",
    ]
    .iter()
    .any(|flag| answer.contains(flag));
    let content = if rejected {
        format!("[User rejected tool execution request ({answer}).]")
    } else if approved {
        format!("[User approved tool execution request ({answer}). Permission granted. Execute the requested tool now and proceed with the task.]")
    } else {
        answer.to_owned()
    };
    let count = request["clarificationCount"]
        .as_u64()
        .unwrap_or_default()
        .saturating_add(1);
    json!({
        "messages": [{"role":"user","content":content,"id":format!("msg-user-ans-{}", chrono::Utc::now().timestamp_millis())}],
        "returningFromSpecialist": request["returningFromSpecialist"],
        "codingComplete": false,
        "dataAnalysisComplete": false,
        "webExplorerComplete": false,
        "deepResearchComplete": false,
        "resumingFromFormResponse": true,
        "clarificationCount": count,
    })
}

#[test]
fn clarification_answer_keeps_plain_replies_and_rejection_precedence() {
    let resumed = clarification_answer(
        &json!({"answer":"Option B","clarificationCount":2,"returningFromSpecialist":"data_analyst"}),
    );
    assert_eq!(resumed["messages"][0]["content"], "Option B");
    assert_eq!(resumed["clarificationCount"], 3);
    assert_eq!(resumed["returningFromSpecialist"], "data_analyst");
    assert_eq!(resumed["dataAnalysisComplete"], false);
    assert!(
        clarification_answer(&json!({"answer":"[HITL_APPROVED_PREFIX]"}))["messages"][0]["content"]
            .as_str()
            .unwrap()
            .starts_with("[User approved")
    );
    assert!(
        clarification_answer(&json!({"answer":"[HITL_APPROVED] [HITL_REJECTED]"}))["messages"][0]
            ["content"]
            .as_str()
            .unwrap()
            .starts_with("[User rejected")
    );
}

pub fn clarification_request(request: &Value) -> Value {
    let record = request["records"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|record| record["toolName"] == "ask_user_question");
    let id = record
        .and_then(|record| record["id"].as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(db::uuid_v4);
    let summary = record
        .and_then(|record| record["result"]["output"].as_str())
        .filter(|summary| !summary.is_empty())
        .unwrap_or("Awaiting clarification...");
    let conversation = request["conversationId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .unwrap_or("unknown");
    json!({
        "id":id, "conversationId":conversation, "timestamp":db::iso_now(), "question":"Clarification required:",
        "details":{"tools":record.into_iter().collect::<Vec<_>>(),"summary":summary,"reasoning":summary},
        "options":[]
    })
}

#[test]
fn clarification_request_selects_the_first_question_record() {
    let request = clarification_request(&json!({"conversationId":"chat","records":[
        {"toolName":"other","id":"other"},
        {"toolName":"ask_user_question","id":"first","result":{"output":"Which option?"}},
        {"toolName":"ask_user_question","id":"second"}
    ]}));
    assert_eq!(request["id"], "first");
    assert_eq!(request["details"]["summary"], "Which option?");
    assert_eq!(request["details"]["tools"].as_array().unwrap().len(), 1);
    assert_eq!(
        clarification_request(&json!({}))["conversationId"],
        "unknown"
    );
}

pub fn normalize_questions(request: &Value) -> Value {
    fn as_text(value: &Value) -> String {
        match value {
            Value::String(text) => text.clone(),
            Value::Object(_) => "[object Object]".into(),
            Value::Array(items) => items
                .iter()
                .map(|item| {
                    if item.is_null() {
                        String::new()
                    } else {
                        as_text(item)
                    }
                })
                .collect::<Vec<_>>()
                .join(","),
            value => value.to_string(),
        }
    }
    let single;
    let source = if let Some(questions) = request["questions"].as_array() {
        questions.as_slice()
    } else if db::truthy(request.get("question")) && db::truthy(request.get("options")) {
        single = [request.clone()];
        &single
    } else {
        return json!({"result": {
            "success": false,
            "output": "Invalid arguments: expected either \"questions\" array or \"question\" with \"options\"",
            "error": "Invalid tool arguments"
        }});
    };
    let formatted = source
        .iter()
        .map(|question| {
            let choices = question["options"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|option| {
                    let label = ["label", "value"]
                        .iter()
                        .find_map(|key| option.get(*key).filter(|value| db::truthy(Some(value))));
                    as_text(label.unwrap_or(option))
                })
                .collect::<Vec<_>>()
                .join(" / ");
            let choices = if choices.is_empty() {
                "No options provided"
            } else {
                &choices
            };
            let prompt = question
                .get("question")
                .map(as_text)
                .unwrap_or_else(|| "undefined".into());
            format!("❓ **{prompt}**\n   Choices: {choices}")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let questions = source.iter().map(|question| {
        let options = question["options"].as_array().into_iter().flatten().map(|option| {
            if option.is_object() || option.is_array() {
                let label = option.get("label").filter(|value| db::truthy(Some(value)));
                let value = option.get("value").filter(|value| db::truthy(Some(value)));
                json!({
                    "label": as_text(label.or(value).unwrap_or(option)),
                    "value": as_text(value.or(label).unwrap_or(option)),
                    "isRecommended": db::truthy(option.get("isRecommended")) || db::truthy(option.get("recommended")),
                    "requiresFileUpload": db::truthy(option.get("requiresFileUpload")),
                })
            } else {
                let text = as_text(option);
                json!({"label": text, "value": text})
            }
        }).collect::<Vec<_>>();
        let prompt = question.get("question").filter(|value| db::truthy(Some(value))).map(as_text).unwrap_or_default();
        json!({"question": prompt, "options": options, "multiSelect": db::truthy(question.get("multiSelect"))})
    }).collect::<Vec<_>>();
    let preview = request["previewMarkdown"].as_str().unwrap_or_default();
    let preview_context = if preview.is_empty() {
        String::new()
    } else {
        format!("**Preview Context:**\n{preview}\n\n")
    };
    json!({"formatted": formatted, "count": questions.len(), "result": {
        "success": true,
        "output": format!("Questions presented to the user:\n\n{formatted}\n\n{preview_context}Wait for the user's selection."),
        "data": {"questions": questions, "preview": preview, "type": "ask_user"}
    }})
}

#[test]
fn normalize_questions_preserves_choice_labels_and_flags() {
    let normalized = normalize_questions(
        &json!({"previewMarkdown":"Example", "questions":[{"question":"Choose", "multiSelect":true,
        "options":["One", {"value":"two","recommended":true,"requiresFileUpload":true}]}]}),
    );
    let question = &normalized["result"]["data"]["questions"][0];
    assert_eq!(question["options"][0], json!({"label":"One","value":"One"}));
    assert_eq!(
        question["options"][1],
        json!({"label":"two","value":"two","isRecommended":true,"requiresFileUpload":true})
    );
    assert_eq!(question["multiSelect"], true);
    assert_eq!(
        normalized["formatted"],
        "❓ **Choose**\n   Choices: One / two"
    );
    assert!(normalized["result"]["output"]
        .as_str()
        .unwrap()
        .contains("**Preview Context:**\nExample"));
    assert_eq!(
        normalize_questions(&json!({"question":"Choose","options":["One"]}))["count"],
        1
    );
    assert_eq!(
        normalize_questions(&json!({"question":"Choose"}))["result"]["success"],
        false
    );
}

pub fn preview_live_url(request: &Value) -> Value {
    let Some(url) = request["url"].as_str().filter(|url| !url.is_empty()) else {
        return json!({"success":false,"output":"Error: URL parameter is missing.","error":"missing_url"});
    };
    json!({"success":true,"output":format!("Live preview pane opened successfully for {url}"),"data":{"url":url}})
}

pub fn show_user_url(request: &Value) -> Value {
    let raw = request["url"]
        .as_str()
        .unwrap_or_default()
        .trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'));
    if raw.is_empty() {
        return json!({"success":false,"output":"Error: URL parameter is missing.","error":"missing_url"});
    }
    let lower = raw.to_ascii_lowercase();
    let url = if ["http:", "https:", "file:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        raw.to_owned()
    } else {
        let host = lower.split('/').next().unwrap_or_default();
        let host = host.strip_prefix('[').unwrap_or(host);
        let host = host.strip_suffix(']').unwrap_or(host);
        let local = ["localhost", "127.0.0.1", "0.0.0.0", "::1"]
            .iter()
            .any(|name| {
                host.strip_prefix(name)
                    .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with(':'))
            });
        let scheme = if local { "http" } else { "https" };
        format!("{scheme}://{raw}")
    };
    json!({"success":true,"output":format!("Opened browser tab for user\nURL: {url}"),"data":{"url":url}})
}

#[test]
fn show_user_url_preserves_local_and_public_scheme_defaults() {
    assert_eq!(
        show_user_url(&json!({"url":" localhost:3000 "}))["data"]["url"],
        "http://localhost:3000"
    );
    assert_eq!(
        show_user_url(&json!({"url":"example.com/docs"}))["data"]["url"],
        "https://example.com/docs"
    );
    assert_eq!(
        show_user_url(&json!({"url":"FILE:///tmp/report"}))["data"]["url"],
        "FILE:///tmp/report"
    );
    assert_eq!(show_user_url(&json!({"url":42}))["error"], "missing_url");
}

pub fn present_files_result(request: &Value) -> Value {
    static TITLE_SEPARATORS: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"[_-]+").unwrap());
    let missing: Vec<_> = request["missingFiles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if !missing.is_empty()
        && request["files"]
            .as_array()
            .is_some_and(|files| files.len() == missing.len())
    {
        let list = missing
            .iter()
            .map(|file| format!("- {file}"))
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "success": false,
            "output": format!("Error: Could not find deliverable file(s) on disk:\n{list}\n\nSearched directories: ~/.everfern/, ~/.everfern/workspace/, current workspace, user home, and Linux VM/WSL.\n\nNote: If you wrote a generation script (e.g. .py or .js), execute it using the terminal tool (e.g. 'python generate_pdf_script.py') to create the deliverable file before presenting."),
            "error": format!("Files not found: {}", missing.join(", ")),
        });
    }
    let mut files: Vec<_> = request["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|file| file["path"].as_str().is_some_and(|path| !path.is_empty()))
        .cloned()
        .collect();
    for file in &mut files {
        let path = std::path::Path::new(file["path"].as_str().unwrap_or_default());
        let basename = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or_default();
        let suffix = path
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .map(|ext| format!(".{}", ext.to_lowercase()))
            .unwrap_or_default();
        let script = matches!(
            suffix.as_str(),
            ".py" | ".js" | ".ts" | ".sh" | ".bat" | ".ps1"
        );
        let title = if !db::truthy(file.get("title")) {
            let base = basename.strip_suffix(&suffix).unwrap_or(basename);
            let words = TITLE_SEPARATORS.replace_all(base, " ");
            let mut chars = words.chars();
            Some(
                chars
                    .next()
                    .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                    .unwrap_or_default(),
            )
        } else {
            None
        };
        if script && !db::truthy(file.get("type")) {
            file["type"] = json!("code");
        }
        if let Some(title) = title {
            file["title"] = json!(title);
        }
    }
    let formatted = files
        .iter()
        .map(|file| {
            let path = file["path"].as_str().unwrap_or_default();
            let description = ["description", "title"]
                .iter()
                .find_map(|key| file[*key].as_str().filter(|text| !text.is_empty()))
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    format!(
                        "File: {}",
                        path.rsplit(['/', '\\']).next().unwrap_or_default()
                    )
                });
            format!("📄 **{description}**\n   Path: `{path}`")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut data = json!({"files": files, "type": "present_files"});
    if let Some(title) = request.get("title") {
        data["title"] = title.clone();
    }
    json!({
        "success": true,
        "output": format!("Files presented to the user:\n\n{formatted}\n\nTask complete."),
        "data": data
    })
}

#[test]
fn present_files_result_distinguishes_partial_and_total_failure() {
    let files = json!([{"path":"one.txt","title":"One"},{"path":"two.txt"}]);
    let partial = present_files_result(&json!({"files":files,"missingFiles":["two.txt"]}));
    assert_eq!(partial["success"], true);
    assert_eq!(
        partial["data"]["files"],
        json!([{"path":"one.txt","title":"One"},{"path":"two.txt","title":"Two"}])
    );
    let script = present_files_result(&json!({"files":[{"path":"build__report.py"}]}));
    assert_eq!(script["data"]["files"][0]["title"], "Build report");
    assert_eq!(script["data"]["files"][0]["type"], "code");
    let failed = present_files_result(&json!({"files":files,"missingFiles":["one.txt","two.txt"]}));
    assert_eq!(failed["success"], false);
    assert_eq!(failed["error"], "Files not found: one.txt, two.txt");
}

fn mirror_presented_file(
    source: &std::path::Path,
    fallback: &std::path::Path,
) -> std::io::Result<()> {
    if source == fallback || fallback.exists() {
        return Ok(());
    }
    let parent = fallback
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    std::fs::create_dir_all(parent)?;
    let temporary = tempfile::NamedTempFile::new_in(parent)?.into_temp_path();
    std::fs::copy(source, &temporary)?;
    match temporary.persist_noclobber(fallback) {
        Ok(()) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.error),
    }
}

fn presented_file_candidates(request: &Value) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = request["original"]
        .as_str()
        .map(crate::vm::guest_path_to_host)
        .into_iter()
        .map(PathBuf::from)
        .collect();
    paths.extend(
        request["candidates"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(PathBuf::from),
    );
    let Some(name) = request["name"].as_str().filter(|name| !name.is_empty()) else {
        return paths;
    };
    if cfg!(windows) {
        for root in [
            r"\\wsl.localhost\EverFern-Alpine\everfern",
            r"\\wsl.localhost\EverFern-Alpine\everfern\workspace",
            r"\\wsl.localhost\EverFern-Alpine\everfern\artifacts",
            r"\\wsl.localhost\EverFern-Alpine\root\.everfern",
            r"\\wsl.localhost\EverFern-Alpine\root\.everfern\workspace",
            r"\\wsl.localhost\EverFern-Alpine\root",
            r"\\wsl.localhost\EverFern-Alpine\tmp",
            r"\\wsl.localhost\EverFern-Alpine\tmp\everfern",
            r"\\wsl$\EverFern-Alpine\everfern",
            r"\\wsl$\EverFern-Alpine\root\.everfern",
            r"\\wsl$\EverFern-Alpine\tmp",
        ] {
            paths.push(PathBuf::from(root).join(name));
        }
    }
    for key in ["workspace", "artifacts"] {
        if let Some(directory) = request[key]
            .as_str()
            .filter(|directory| !directory.is_empty())
        {
            paths.push(PathBuf::from(directory).join(name));
        }
    }
    if let Some(home) = request["home"].as_str().map(PathBuf::from) {
        let profile = home.join(".everfern");
        let session = request["session"].as_str().unwrap_or("default");
        let directories = [
            profile.clone(),
            profile.join("workspace"),
            profile.join("exec"),
            profile.join("artifacts").join(session),
            profile.join("artifacts"),
            home.join("Downloads"),
            home.join("Desktop"),
            home.join("Documents"),
            home,
        ];
        paths.extend(
            directories
                .into_iter()
                .map(|directory| directory.join(name)),
        );
    }
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join(name));
    }
    paths
}

pub fn present_host_file(request: &Value) -> bool {
    use std::{fs, path::Path};
    let source = presented_file_candidates(request)
        .into_iter()
        .find(|path| path.is_file());
    let Some((source, target)) = source.zip(request["target"].as_str()) else {
        return false;
    };
    let Some(fallback) = request["fallback"].as_str() else {
        return false;
    };
    let (target, fallback) = (Path::new(target), Path::new(fallback));
    let result = (|| -> std::io::Result<()> {
        for destination in [target, fallback] {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
        }
        if source != target {
            fs::copy(&source, target)?;
        }
        let _ = mirror_presented_file(&source, fallback);
        Ok(())
    })();
    result.is_ok()
}

pub async fn present_file(request: &Value) -> bool {
    if present_host_file(request) {
        return true;
    }
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return false;
    }
    let Some(target) = request["target"].as_str().map(std::path::Path::new) else {
        return false;
    };
    let Some(name) = target.file_name().and_then(std::ffi::OsStr::to_str) else {
        return false;
    };
    if target
        .parent()
        .is_none_or(|parent| std::fs::create_dir_all(parent).is_err())
    {
        return false;
    }
    let original = request["original"]
        .as_str()
        .filter(|path| path.starts_with('/'));
    let mirror = || {
        if let Some(fallback) = request["fallback"].as_str().map(std::path::Path::new) {
            let _ = mirror_presented_file(target, fallback);
        }
    };
    if cfg!(target_os = "windows") {
        let copied = crate::vm::copy_presented_file(
            original.unwrap_or_default(),
            name,
            &target.to_string_lossy(),
        )
        .await
            && target.exists();
        if copied {
            mirror();
        }
        return copied;
    }
    let candidates = [
        "/everfern",
        "/root/.everfern",
        "/root/.everfern/workspace",
        "/tmp",
    ]
    .map(|directory| format!("{directory}/{name}"));
    for path in original
        .into_iter()
        .chain(candidates.iter().map(String::as_str))
    {
        let mut command = tokio::process::Command::new("docker");
        command
            .args(["cp", &format!("everfern-alpine:{path}")])
            .arg(target)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        if tokio::time::timeout(std::time::Duration::from_secs(15), command.status())
            .await
            .is_ok_and(|status| status.is_ok_and(|status| status.success()))
            && target.exists()
        {
            mirror();
            return true;
        }
    }
    false
}

#[test]
fn present_host_file_uses_first_file_and_preserves_existing_fallback() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let first = root.join("first.txt");
    let second = root.join("second.txt");
    let target = root.join("artifacts").join("report.txt");
    let fallback = root.join("report.txt");
    std::fs::write(&first, "first").unwrap();
    std::fs::write(&second, "second").unwrap();
    std::fs::write(&fallback, "existing").unwrap();
    assert!(present_host_file(&json!({
        "candidates": [root.join("missing"), root, first, second],
        "target": target, "fallback": fallback,
    })));
    assert_eq!(std::fs::read_to_string(target).unwrap(), "first");
    assert_eq!(std::fs::read_to_string(fallback).unwrap(), "existing");
}

pub fn write_todos(request: &Value) -> Value {
    let Some(tasks) = request["tasks"].as_array() else {
        return json!({"success": false, "output": "Tasks must be an array.", "error": "invalid_args"});
    };
    let Some(path) = request["path"].as_str() else {
        return json!({"success": false, "output": "Failed to write task.md: Missing path"});
    };
    let mut markdown = String::from("# Task List\n");
    for task in tasks {
        let marker = match task["status"].as_str() {
            Some("completed") => "[x]",
            Some("in_progress") => "[/]",
            _ => "[ ]",
        };
        let description = task["description"].as_str().unwrap_or("undefined");
        markdown.push_str(&format!("\n- {marker} {description}"));
    }
    let result = (|| {
        if let Some(parent) = std::path::Path::new(path)
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, markdown)
    })();
    if let Err(error) = result {
        let code = match error.kind() {
            std::io::ErrorKind::PermissionDenied => Some("EACCES"),
            std::io::ErrorKind::NotFound => Some("ENOENT"),
            std::io::ErrorKind::AlreadyExists => Some("EEXIST"),
            std::io::ErrorKind::NotADirectory => Some("ENOTDIR"),
            std::io::ErrorKind::IsADirectory => Some("EISDIR"),
            _ => None,
        };
        return json!({"success": false, "output": format!("Failed to write task.md: {error}"), "error": code});
    }
    json!({"success": true,
        "output": format!("✅ Updated task.md with {} tasks matching current progress.", tasks.len()),
        "data": {"path": path, "tasks": tasks}})
}

#[test]
fn todo_writer_preserves_markdown_and_tool_result() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested").join("task.md");
    let tasks = json!([
        {"description": "Plan", "status": "completed"},
        {"description": "Build", "status": "in_progress"},
        {"description": "Verify", "status": "pending"}
    ]);
    let result = write_todos(&json!({"path": path, "tasks": tasks}));
    assert_eq!(result["data"]["tasks"], tasks);
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "# Task List\n\n- [x] Plan\n- [/] Build\n- [ ] Verify"
    );
    assert_eq!(write_todos(&json!({}))["error"], "invalid_args");
}

pub fn task_next_run(request: &Value) -> Result<Value, String> {
    schedule::next_run(
        request["cron"].as_str().ok_or("Missing schedule")?,
        request["startsAt"].as_str(),
        request["lastRun"].as_str(),
        chrono::Local::now(),
    )
    .map(Value::String)
}

pub fn poll_scheduled_tasks() -> Result<Value, String> {
    let connection = db::open(&home()?.join(".everfern").join("sql").join("memory.sqlite"))?;
    let transaction =
        rusqlite::Transaction::new_unchecked(&connection, rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
    let tasks = db::enabled_tasks(&transaction)?;
    let now = chrono::Local::now();
    let decisions = schedule::task_decisions(&tasks, now);
    let mut due = Vec::new();
    for (task, decision) in tasks.iter().zip(decisions.as_array().unwrap()) {
        match decision.as_str() {
            Some("run") => due.push(json!({"id": task["id"], "updatedAt": task["updatedAt"]})),
            Some("expire") => {
                transaction
                    .execute(
                        "UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?",
                        rusqlite::params![db::iso_now(), task["id"].as_str()],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Some("initialize") => {
                if let (Some(id), Ok(next)) = (
                    task["id"].as_str(),
                    schedule::next_run(
                        task["cron"].as_str().unwrap_or_default(),
                        task["startsAt"].as_str(),
                        None,
                        now,
                    ),
                ) {
                    db::tasks_update_run_times(&transaction, id, "", &next)?;
                }
            }
            _ => {}
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(Value::Array(due))
}

pub fn lookup_project(request: &Value) -> Result<Value, String> {
    let filename = match request["scope"].as_str() {
        Some("chat") => "memory.sqlite",
        Some("worker") => "workers.sqlite",
        _ => return Err("Invalid agent scope".into()),
    };
    let connection = db::open(&home()?.join(".everfern").join("sql").join(filename))?;
    match request["operation"].as_str() {
        Some("list") => db::projects_list(&connection),
        Some("create") => Ok(db::projects_create(&connection, &request["project"])),
        Some("update") => db::projects_update(&connection, &request["id"], &request["updates"]),
        Some("toggle-bookmark") => db::projects_toggle_bookmark(&connection, &request["id"]),
        Some("delete") => db::projects_delete(&connection, &request["id"]),
        Some("get") | None => Ok(db::project_get(&connection, &request["id"])?.unwrap_or_default()),
        _ => Err("Invalid project store operation".into()),
    }
}

pub fn read_history(request: &Value) -> Result<Value, String> {
    let filename = match request["scope"].as_str() {
        Some("chat") => "memory.sqlite",
        Some("worker") => "workers.sqlite",
        _ => return Err("Invalid agent scope".into()),
    };
    let conn = db::open(&home()?.join(".everfern").join("sql").join(filename))?;
    match request["operation"].as_str() {
        Some("list") => db::history_list(&conn),
        Some("listByProject") => db::history_list_by_project(&conn, &request["id"]),
        Some("togglePin") => db::history_toggle_pin(&conn, &request["id"]),
        Some("toggleUnread") => db::history_toggle_unread(&conn, &request["id"]),
        Some("updateTitle") => db::history_update_title(&conn, &request["id"], &request["title"]),
        Some("setProject") => db::history_set_project(&conn, &request["id"], &request["projectId"]),
        Some("delete") => db::history_delete(&conn, &request["id"]),
        Some("save") => {
            let (mut result, index) = db::history_save(&conn, &request["conversation"]);
            if result["success"] == true && !index.is_empty() {
                result["__index"] = Value::Array(index);
            }
            Ok(result)
        }
        Some("load") => {
            let value = db::history_load(&conn, &request["id"])?;
            Ok(if value["error"] == "Not found" {
                Value::Null
            } else {
                value
            })
        }
        _ => Err("Invalid history read operation".into()),
    }
}

pub fn plan_store(request: &Value) -> Result<Value, String> {
    let channel = match request["operation"].as_str() {
        Some("list") => "plans:list",
        Some("read") => "plans:read",
        Some("write") => "plans:write",
        Some("delete") => "plans:delete",
        _ => return Err("Invalid plan store operation".into()),
    };
    let args = [
        request["chatId"].clone(),
        request["filename"].clone(),
        request["content"].clone(),
    ];
    dispatch(None, channel, &args)
}

pub fn site_files(request: &Value) -> Result<Value, String> {
    let sites = files::Sites(home()?.join(".everfern").join("sites"));
    let chat = request["chatId"].as_str();
    let channel = match request["operation"].as_str() {
        Some("list") => return Ok(sites.list_for_chat(chat)),
        Some("delete") => return Ok(sites.delete_entry(chat, request["filename"].as_str())),
        Some("read") => "sites:read-file",
        Some("write") => "sites:write-file",
        _ => return Err("Invalid site file operation".into()),
    };
    dispatch(
        None,
        channel,
        &[
            request["chatId"].clone(),
            request["filename"].clone(),
            request["content"].clone(),
        ],
    )
}

pub fn artifact_store(request: &Value) -> Result<Value, String> {
    let operation = request["operation"].as_str().unwrap_or_default();
    let chat = request["chatId"].clone();
    let file = request["filename"].clone();
    let project = request["projectPath"].clone();
    match operation {
        "list" => dispatch(None, "artifacts:list", &[chat, project]),
        "read" => dispatch(None, "artifacts:read", &[chat, file, project]),
        "write" => dispatch(
            None,
            "artifacts:write",
            &[chat, file, request["content"].clone(), project],
        ),
        "delete" => dispatch(None, "artifacts:delete", &[chat, file, project]),
        "touch" => dispatch(None, "artifacts:touch", &[chat, file, project]),
        _ => Err("Invalid artifact store operation".into()),
    }
}

pub fn task_store(request: &Value, operation: &str) -> Result<Value, String> {
    let filename = match request["scope"].as_str() {
        Some("chat") | None => "memory.sqlite",
        Some("worker") => "workers.sqlite",
        _ => return Err("Invalid agent scope".into()),
    };
    let connection = db::open(&home()?.join(".everfern").join("sql").join(filename))?;
    match operation {
        "save" => db::tasks_save(&connection, &request["task"]),
        "list" => db::tasks_list(&connection, request.get("projectId")),
        "get" => db::tasks_get(&connection, &request["id"]),
        "delete" => {
            let result = db::tasks_delete(&connection, &request["id"]);
            match result["error"].as_str() {
                Some(error) => Err(error.into()),
                None => Ok(Value::Null),
            }
        }
        "run-times" => {
            let field = |name: &str| {
                request[name]
                    .as_str()
                    .ok_or_else(|| format!("Missing {name}"))
            };
            if request["prepare"] == true {
                return db::prepare_scheduled_run(
                    &connection,
                    field("id")?,
                    chrono::Local::now(),
                    &request["updatedAt"],
                )
                .map(|run| run.unwrap_or(Value::Null));
            }
            db::tasks_update_run_times(
                &connection,
                field("id")?,
                field("lastRun")?,
                field("nextRun")?,
            )?;
            Ok(Value::Null)
        }
        "retry" => db::create_scheduled_conversation(
            &connection,
            &request["retryTask"],
            chrono::Local::now(),
        )
        .map(Value::String),
        _ => Err("Unknown scheduled task operation".into()),
    }
}

pub fn checkpoint_store(request: &Value, load: bool) -> Result<Value, String> {
    checkpoint_store_at(&home()?.join(".everfern").join("sql"), request, load)
}

fn checkpoint_store_at(
    directory: &std::path::Path,
    request: &Value,
    load: bool,
) -> Result<Value, String> {
    if load && request["scope"] == "all" {
        let mut checkpoints = Vec::new();
        let mut errors = Vec::new();
        for scope in ["chat", "worker"] {
            match checkpoint_store_at(directory, &json!({"scope":scope}), true) {
                Ok(Value::Array(records)) => {
                    checkpoints.extend(records.into_iter().map(|mut record| {
                        record["scope"] = json!(scope);
                        record
                    }))
                }
                Ok(_) => errors.push(format!("{scope}: Invalid checkpoint list")),
                Err(error) => errors.push(format!("{scope}: {error}")),
            }
        }
        return Ok(json!({"checkpoints": checkpoints, "errors": errors}));
    }
    let database = match request["scope"].as_str() {
        Some("chat") => "memory.sqlite",
        Some("worker") => "workers.sqlite",
        _ => return Err("Invalid agent scope".into()),
    };
    let connection = db::open(&directory.join(database))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS hitl_state (
            conversation_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, interrupt_data_json TEXT,
            is_interrupted INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
        )",
        )
        .map_err(|error| error.to_string())?;
    if load {
        let mut statement = connection.prepare(
            "SELECT conversation_id, state_json, interrupt_data_json FROM hitl_state WHERE is_interrupted = 1"
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let restored = rows
            .filter_map(|row| {
                let (id, state, interrupt) = row.ok()?;
                let state = serde_json::from_str::<Value>(&state).ok()?;
                let interrupt = interrupt
                    .filter(|value| !value.is_empty())
                    .map(|value| serde_json::from_str::<Value>(&value))
                    .transpose()
                    .ok()?;
                let mut checkpoint = json!({"conversationId": id, "currentState": state});
                if let Some(interrupt) = interrupt {
                    checkpoint["interruptData"] = interrupt;
                }
                Some(checkpoint)
            })
            .collect();
        return Ok(Value::Array(restored));
    }
    let id = request["id"].as_str().ok_or("Missing conversation id")?;
    if let Some(state) = request.get("state") {
        let interrupt = request.get("interruptData").map(Value::to_string);
        connection.execute(
            "INSERT OR REPLACE INTO hitl_state (conversation_id, state_json, interrupt_data_json, is_interrupted, updated_at)
             VALUES (?, ?, ?, 1, datetime('now'))",
            rusqlite::params![id, state.to_string(), interrupt],
        )
    } else {
        connection.execute("DELETE FROM hitl_state WHERE conversation_id = ?", [id])
    }.map_err(|error| error.to_string())?;
    Ok(Value::Null)
}

fn stored_interrupted_state(root: &std::path::Path, id: Option<&str>) -> Value {
    let Some(id) = id.filter(|id| !id.is_empty()) else {
        return json!({"interrupted": false});
    };
    let databases = if id.starts_with("worker-") {
        ["workers.sqlite", "memory.sqlite"]
    } else {
        ["memory.sqlite", "workers.sqlite"]
    };
    for filename in databases {
        let path = root.join(filename);
        if let Ok(conn) =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        {
            let state = db::interrupted_state(&conn, Some(id));
            if state["interrupted"] == true {
                return state;
            }
        }
    }
    return json!({"interrupted": false});
}

#[test]
fn interrupted_state_falls_back_to_legacy_worker_checkpoint() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    checkpoint_store_at(
        root,
        &json!({
            "scope":"worker","id":"legacy","state":{},"interruptData":{"step":1}
        }),
        false,
    )
    .unwrap();
    assert_eq!(
        stored_interrupted_state(root, Some("legacy")),
        json!({
            "interrupted":true,"interruptData":{"step":1}
        })
    );
    assert!(!root.join("memory.sqlite").exists());

    checkpoint_store_at(
        root,
        &json!({
            "scope":"chat","id":"legacy","state":{},"interruptData":{"step":2}
        }),
        false,
    )
    .unwrap();
    assert_eq!(
        stored_interrupted_state(root, Some("legacy"))["interruptData"],
        json!({"step":2})
    );
}

#[cfg(test)]
#[test]
fn checkpoint_restore_keeps_healthy_scope_when_other_database_is_unavailable() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    checkpoint_store_at(
        root,
        &json!({"scope":"chat","id":"chat-id","state":{"step":1}}),
        false,
    )
    .unwrap();
    std::fs::create_dir(root.join("workers.sqlite")).unwrap();
    let restored = checkpoint_store_at(root, &json!({"scope":"all"}), true).unwrap();
    assert_eq!(
        restored["checkpoints"],
        json!([{"conversationId":"chat-id","currentState":{"step":1},"scope":"chat"}])
    );
    let errors = restored["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].as_str().unwrap().starts_with("worker: "));
}

#[test]
fn checkpoints_survive_reopen_and_remain_scoped() {
    let directory = tempfile::tempdir().unwrap();
    let store = |request, load| checkpoint_store_at(directory.path(), &request, load).unwrap();
    let chat = json!({"scope":"chat","id":"chat-id","state":{"step":1},"interruptData":{"approved":false}});
    let worker = json!({"scope":"worker","id":"worker-id","state":{"step":2}});
    store(chat, false);
    store(worker, false);
    let connection = Connection::open(directory.path().join("memory.sqlite")).unwrap();
    connection.execute(
        "INSERT INTO hitl_state (conversation_id, state_json, is_interrupted) VALUES ('damaged', '{', 1)",
        [],
    ).unwrap();
    assert_eq!(
        store(json!({"scope":"chat"}), true),
        json!([
            {"conversationId":"chat-id","currentState":{"step":1},"interruptData":{"approved":false}}
        ])
    );
    assert_eq!(
        store(json!({"scope":"worker"}), true),
        json!([
            {"conversationId":"worker-id","currentState":{"step":2}}
        ])
    );
    store(json!({"scope":"chat","id":"chat-id"}), false);
    assert_eq!(store(json!({"scope":"chat"}), true), json!([]));
    assert_eq!(
        store(json!({"scope":"worker"}), true)
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

async fn check_api_health(base: &str) -> Value {
    let result = async {
        let url = reqwest::Url::parse(&format!("{}/api/health", base.trim_end_matches('/')))
            .map_err(|error| error.to_string())?;
        crate::http::validate_url(&url)?;
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|error| error.to_string())?
            .get(url)
            .send()
            .await
            .map_err(|error| error.without_url().to_string())?;
        if !response.status().is_success() {
            return Err(format!("API returned {}", response.status().as_u16()));
        }
        Ok::<(), String>(())
    }
    .await;
    match result {
        Ok(()) => json!({"success": true, "details": "API is responsive"}),
        Err(error) => json!({"success": false, "error": error}),
    }
}

#[tauri::command]
pub async fn ef_data(app: AppHandle, channel: String, args: Vec<Value>) -> Result<Value, String> {
    if channel == "api:checkHealth" {
        let base = args
            .first()
            .and_then(Value::as_str)
            .unwrap_or("http://localhost:5000");
        return Ok(check_api_health(base).await);
    }
    if channel == "health:repair" {
        let database_checks = tauri::async_runtime::spawn_blocking(move || {
            let check = |channel| {
                dispatch(Some(&app), channel, &[])
                    .unwrap_or_else(|error| json!({"success": false, "error": error}))
            };
            (check("db:checkConnection"), check("db:checkVectors"))
        });
        let api = check_api_health("http://localhost:5000").await;
        let (database, vectors) = database_checks.await.map_err(|error| error.to_string())?;
        return Ok(json!({"database": database, "vectors": vectors, "api": api}));
    }
    if channel == "integration:probe-inactive" {
        let Some(platform @ ("telegram" | "discord")) = args.first().and_then(Value::as_str) else {
            return Ok(json!(false));
        };
        let directory = home()?.join(".everfern");
        let state = app.state::<crate::Sidecar>();
        let config = {
            let Some(_starting) = state.lock_if_stopped()? else {
                return Ok(Value::Null);
            };
            integrations::config_for_renderer(&directory)
        };
        let mut probe = json!({
            "platform": platform, "token": config[platform]["botToken"],
            "applicationId": config[platform]["applicationId"]
        });
        if integrations::test_connection(&probe).await["success"] == true {
            return Ok(Value::Null);
        }
        let Some(_starting) = state.lock_if_stopped()? else {
            return Ok(Value::Null);
        };
        probe["success"] = json!(false);
        let committed =
            integrations::dispatch(&directory, "integration:commit-test-result", Some(&probe))?;
        return Ok(if committed.is_null() {
            Value::Null
        } else {
            json!(false)
        });
    }
    if channel == "chat:generate-title-local" {
        use tauri::Emitter;
        let conversation = args.first().and_then(Value::as_str).unwrap_or_default();
        let message = args.get(1).and_then(Value::as_str).unwrap_or_default();
        if conversation.is_empty() || message.trim().is_empty() {
            return Ok(json!({"queued": true}));
        }
        let marker = message.to_ascii_lowercase().find("[shared folder context]");
        let clean = message[..marker.unwrap_or(message.len())].trim();
        let mut title_provider = args.get(2).and_then(|options| {
            let provider = options["providerType"].as_str()?;
            let mut options = options.clone();
            if options["model"].is_null() {
                let catalog: Value =
                    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/providers.json")))
                        .ok()?;
                options["model"] = catalog["defaultChatModels"][provider].clone();
            }
            supports_native_title(provider, options["model"].as_str()?).then_some(options)
        });
        if !clean.is_empty()
            && title_provider.is_none()
            && !args
                .get(2)
                .and_then(|options| options["providerType"].as_str())
                .is_some_and(|provider| !provider.is_empty())
        {
            let sidecar = app.state::<crate::Sidecar>();
            let startup_guard = sidecar.lock_if_stopped();
            if let Ok(Some(_starting)) = startup_guard {
                let saved = config::load_config(&home()?.join(".everfern"));
                let settings = &saved["config"];
                let provider = settings["provider"].as_str().unwrap_or_default();
                let model = settings["model"]
                    .as_str()
                    .filter(|model| !model.is_empty())
                    .or_else(|| {
                        settings["customModel"]
                            .as_str()
                            .filter(|model| !model.is_empty())
                    });
                if let Some(model) = model.filter(|model| supports_native_title(provider, model)) {
                    let key = settings["keys"][provider]
                        .as_str()
                        .filter(|key| !key.is_empty())
                        .or_else(|| settings["apiKey"].as_str());
                    title_provider = Some(json!({
                        "providerType": provider, "model": model, "baseUrl": settings["baseUrl"], "apiKey": key
                    }));
                }
            }
        }
        if !clean.is_empty() && title_provider.is_none() {
            return Ok(Value::Null);
        }
        let id = json!(conversation);
        let prompt: String = clean.chars().take(600).collect();
        let title = if prompt.is_empty() {
            "Shared Workspace".to_owned()
        } else {
            let Some(options) = title_provider else {
                return Ok(Value::Null);
            };
            let Some(title) = provider_model_title(&options, &prompt).await else {
                return Ok(Value::Null);
            };
            title
        };
        let saved = tauri::async_runtime::spawn_blocking(move || {
            let title = json!(title);
            with_db(|conn| db::history_update_title(conn, &id, &title))??;
            let _ = app.emit(
                "chat:title-updated",
                json!({"conversationId": id, "title": title}),
            );
            Ok::<(), String>(())
        })
        .await;
        return Ok(if matches!(saved, Ok(Ok(()))) {
            json!({"queued": true})
        } else {
            Value::Null
        });
    }
    if channel == "analytics:record-usage" {
        let result = insert_usage(&json!({"usage": args.first()}), true).await;
        return Ok(match result {
            Ok(_) => json!({"success": true}),
            Err(error) => json!({"success": false, "error": error}),
        });
    }
    if matches!(
        channel.as_str(),
        "analytics:get-cached-model-info" | "analytics:get-cached-model-pricing"
    ) {
        let result = dispatch(Some(&app), &channel, &args)?;
        let directory = home()?.join(".everfern");
        if result.is_null() {
            if pricing::refresh(&directory).await.is_some() {
                let refreshed = dispatch(Some(&app), &channel, &args)?;
                if !refreshed.is_null() {
                    return Ok(refreshed);
                }
            }
            let data = if channel == "analytics:get-cached-model-info" {
                pricing::default_model_info()
            } else {
                json!([])
            };
            return Ok(json!({"success": true, "data": data}));
        } else if !pricing::is_fresh(&directory) {
            tauri::async_runtime::spawn(async move {
                pricing::refresh(&directory).await;
            });
        }
        return Ok(result);
    }
    tauri::async_runtime::spawn_blocking(move || dispatch(Some(&app), &channel, &args))
        .await
        .map_err(|e| e.to_string())?
}

fn hosted_title_base(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1"),
        "anthropic" => Some("https://api.anthropic.com"),
        "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        "everfern" => Some("https://api.everfern.app/api"),
        "deepseek" => Some("https://api.deepseek.com"),
        "minimax" => Some("https://api.minimax.io/v1"),
        "ollama-cloud" => Some("https://ollama.com/v1"),
        "nvidia" => Some("https://integrate.api.nvidia.com/v1"),
        "openrouter" => Some("https://openrouter.ai/api/v1"),
        _ => None,
    }
}

fn supports_native_title(provider: &str, model: &str) -> bool {
    !model.is_empty()
        && (matches!(provider, "ollama" | "lmstudio" | "llamacpp")
            || hosted_title_base(provider).is_some())
}

async fn provider_model_title(options: &Value, prompt: &str) -> Option<String> {
    let directory = home().ok()?.join(".everfern");
    let settings = config::load_config(&directory);
    let settings = &settings["config"];
    let provider = options["providerType"].as_str()?;
    let requested_model = options["model"].as_str()?;
    let catalog: Value = if provider == "everfern" {
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/providers.json"))).ok()?
    } else {
        Value::Null
    };
    let model = catalog["cloudModelMap"][requested_model]
        .as_str()
        .unwrap_or(requested_model);
    let gemini_native = provider == "gemini"
        && (model.contains("computer-use") || model.contains("gemini-3-flash"));
    let saved_base = match provider {
        "ollama" => settings["ollamaBaseUrl"]
            .as_str()
            .filter(|url| !url.is_empty())
            .unwrap_or("http://localhost:11434"),
        "lmstudio" => settings["lmstudioBaseUrl"]
            .as_str()
            .filter(|url| !url.is_empty())
            .unwrap_or("http://localhost:1234/v1"),
        "llamacpp" => settings["baseUrls"]["llamacpp"]
            .as_str()
            .filter(|url| !url.is_empty())
            .or_else(|| {
                settings["baseUrl"]
                    .as_str()
                    .filter(|_| settings["provider"] == provider)
            })
            .unwrap_or("http://localhost:8080/v1"),
        _ => hosted_title_base(provider)?,
    };
    let base = options["baseUrl"]
        .as_str()
        .filter(|url| !url.is_empty())
        .unwrap_or(saved_base);
    let key = options["apiKey"]
        .as_str()
        .filter(|key| !key.is_empty())
        .or_else(|| {
            if base.trim_end_matches('/') != saved_base.trim_end_matches('/') {
                return None;
            }
            settings["keys"][provider]
                .as_str()
                .filter(|key| !key.is_empty())
                .or_else(|| {
                    (settings["provider"] == provider)
                        .then(|| settings["apiKey"].as_str())
                        .flatten()
                })
        });
    let endpoint = match provider {
        "ollama" => "api/chat",
        "anthropic" => "v1/messages",
        _ => "chat/completions",
    };
    let url = if gemini_native {
        let mut url =
            reqwest::Url::parse("https://generativelanguage.googleapis.com/v1beta/models").ok()?;
        url.path_segments_mut()
            .ok()?
            .push(&format!("{model}:generateContent"));
        url
    } else {
        reqwest::Url::parse(&format!("{}/{endpoint}", base.trim_end_matches('/'))).ok()?
    };
    crate::http::validate_url(&url).ok()?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .ok()?;
    if hosted_title_base(provider).is_some() && key.is_none() {
        return None;
    }
    let mut request = client.post(url);
    if provider == "openrouter" {
        request = request
            .header("HTTP-Referer", "https://everfern.app")
            .header("X-OpenRouter-Title", "EverFern");
    }
    if let Some(key) = key.filter(|_| {
        provider != "ollama"
            || base.contains("ollama.com")
            || (!base.contains("localhost") && !base.contains("127.0.0.1"))
    }) {
        request = if gemini_native {
            request.header("x-goog-api-key", key)
        } else if provider == "anthropic" {
            request
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
        } else {
            request.bearer_auth(key)
        };
    }
    let messages = json!([
        {"role": "system", "content": "You are a concise conversation title generator. Output ONLY a 3-6 word title that summarizes what the user wants to accomplish. No quotes, no markdown, no punctuation at the end, no prefix like \"Title:\"."},
        {"role": "user", "content": prompt}
    ]);
    let body = if provider == "ollama" {
        json!({"model": model, "messages": messages, "stream": false, "keep_alive": "30m",
            "options": {"temperature": 0.3, "num_ctx": 16384, "num_predict": 4096}})
    } else if provider == "anthropic" {
        json!({"model": model, "system": messages[0]["content"], "messages": [messages[1]],
            "stream": false, "temperature": 0.3, "max_tokens": 30})
    } else if gemini_native {
        json!({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": messages[0]["content"]}]},
            "tools": [{"computer_use": {"environment": "ENVIRONMENT_BROWSER"}}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 30}
        })
    } else {
        let model = if provider == "llamacpp" {
            model.strip_prefix("llamacpp:").unwrap_or(model)
        } else {
            model
        };
        json!({"model": model, "messages": messages, "stream": false, "temperature": 0.3, "max_tokens": 30})
    };
    let fallback = (provider == "everfern"
        && requested_model
            .to_ascii_lowercase()
            .contains("gemini-3-flash"))
    .then(|| request.try_clone())
    .flatten();
    let send = |request: reqwest::RequestBuilder| async move {
        request
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json::<Value>()
            .await
            .ok()
    };
    let primary = send(request.json(&body)).await;
    let response = if let Some(fallback) = fallback.filter(|_| {
        primary.as_ref().is_none_or(|response| {
            let choice = &response["choices"][0];
            choice["finish_reason"] != "tool_calls"
                && choice["message"]["content"]
                    .as_str()
                    .is_none_or(|text| text.trim().is_empty())
        })
    }) {
        let mut body = body;
        body["model"] = json!("google/gemini-2.5-flash");
        send(fallback.json(&body)).await?
    } else {
        primary?
    };
    let content = match provider {
        "ollama" => response["message"]["content"].as_str()?.to_owned(),
        "anthropic" => response["content"]
            .as_array()?
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<String>(),
        "gemini" if gemini_native => response["candidates"][0]["content"]["parts"]
            .as_array()?
            .iter()
            .filter_map(|part| part["text"].as_str())
            .find(|text| !text.is_empty())?
            .to_owned(),
        _ => response["choices"][0]["message"]["content"]
            .as_str()?
            .to_owned(),
    };
    let raw = content
        .trim()
        .trim_start_matches(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '#'))
        .trim_end_matches(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '`'));
    let lower = raw.to_ascii_lowercase();
    let title = ["title:", "subject:", "topic:"]
        .into_iter()
        .find(|prefix| lower.starts_with(prefix))
        .map_or(raw, |prefix| raw[prefix.len()..].trim_start());
    let title: String = title.chars().take(75).collect();
    let title = title.trim();
    (title.encode_utf16().count() >= 2).then(|| title.to_owned())
}
#[test]
fn native_llamacpp_title_uses_chat_completions() {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("POST /v1/chat/completions "));
        let mut length = 0;
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let request: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(request["model"], "example");
        assert_eq!(request["messages"][1]["content"], "Write a report");
        let response = r#"{"choices":[{"message":{"content":"Title: Quarterly Sales Report"}}]}"#;
        write!(
            reader.get_mut(),
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
            response.len()
        )
        .unwrap();
    });
    let options = json!({
        "providerType": "llamacpp", "model": "llamacpp:example",
        "baseUrl": format!("http://{address}/v1")
    });
    let title = tauri::async_runtime::block_on(provider_model_title(&options, "Write a report"));
    server.join().unwrap();
    assert_eq!(title.as_deref(), Some("Quarterly Sales Report"));
}

pub async fn insert_usage(request: &Value, background_refresh: bool) -> Result<Value, String> {
    let directory = home()?.join(".everfern");
    let model = request["usage"]["model"]
        .as_str()
        .ok_or("Expected a usage model")?;
    let cached = pricing::cached_model_info(&directory, model);
    let refresh_after_write = cached.is_some() && !pricing::is_fresh(&directory);
    let prices = match cached {
        Some(prices) => prices,
        None => {
            pricing::refresh(&directory).await;
            pricing::cached_model_info(&directory, model)
                .unwrap_or_else(pricing::default_model_info)
        }
    };
    let mut request = request.clone();
    request["pricing"] = prices;
    if request["createdAt"].is_null() {
        request["createdAt"] =
            json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    }
    let mut row = usage_row(&request);
    let result = with_db(|conn| {
        if row[0].is_null() {
            let id: String = conn
                .query_row("SELECT 'usage-' || lower(hex(randomblob(16)))", [], |row| {
                    row.get(0)
                })
                .map_err(|error| error.to_string())?;
            row[0] = json!(id);
        }
        db::insert_usage(conn, &row)
    })?;
    if refresh_after_write {
        if background_refresh {
            tauri::async_runtime::spawn(async move {
                pricing::refresh(&directory).await;
            });
        } else {
            pricing::refresh(&directory).await;
        }
    }
    result
}

fn usage_row(request: &Value) -> [Value; 12] {
    let usage = &request["usage"];
    let pricing = &request["pricing"];
    let number = |key: &str| usage[key].as_f64().unwrap_or_default();
    let prompt = number("promptTokens");
    let completion = number("completionTokens");
    let cost = |key: &str, tokens: f64, rate: &str| {
        usage[key]
            .as_f64()
            .unwrap_or_else(|| (tokens / 1_000_000.0) * pricing[rate].as_f64().unwrap_or_default())
    };
    let input = cost("promptTokensCost", prompt, "inputCostPer1M");
    let output = cost("completionTokensCost", completion, "outputCostPer1M");
    let image_in = number("imageInputCost");
    let image_out = number("imageOutputCost");
    let total = usage["totalCost"]
        .as_f64()
        .unwrap_or(input + output + image_in + image_out);
    let conversation = usage["conversationId"].as_str().filter(|id| !id.is_empty());
    [
        request["id"].clone(),
        json!(conversation),
        usage["model"].clone(),
        usage["provider"].clone(),
        usage["promptTokens"].clone(),
        usage["completionTokens"].clone(),
        json!(prompt + completion),
        json!(input + image_in),
        json!(output + image_out),
        json!(total),
        pricing["contextWindow"].clone(),
        request["createdAt"].clone(),
    ]
}

#[test]
fn usage_cost_preserves_provider_overrides_and_applies_fallbacks() {
    let mut request = json!({
        "usage": {
            "promptTokens": 500000, "completionTokens": 250000,
            "promptTokensCost": 0, "imageInputCost": 0.25, "imageOutputCost": 0.5
        },
        "pricing": {"inputCostPer1M": 2, "outputCostPer1M": 4, "contextWindow": 150000}
    });
    let row = usage_row(&request);
    assert_eq!(row[6].as_f64(), Some(750000.0));
    assert_eq!(row[7].as_f64(), Some(0.25));
    assert_eq!(row[8].as_f64(), Some(1.5));
    assert_eq!(row[9].as_f64(), Some(1.75));
    request["usage"]["totalCost"] = json!(0);
    assert_eq!(usage_row(&request)[9].as_f64(), Some(0.0));
}

pub fn agent_models(request: &Value) -> Result<Value, String> {
    if let Some(active) = request["activeModels"].as_array() {
        let mut merged = active.clone();
        let mut ids: std::collections::HashSet<_> = active
            .iter()
            .map(|model| (model["providerType"].clone(), model["id"].clone()))
            .collect();
        if let Some(local) = request["localModels"].as_array() {
            for model in local {
                if ids.insert((model["providerType"].clone(), model["id"].clone())) {
                    merged.push(model.clone());
                }
            }
        }
        if merged.is_empty() {
            merged.push(json!({"id":"everfern-1","name":"Fern-1","provider":"EverFern Cloud","providerType":"everfern"}));
        }
        if let Some(catalog) = request["capabilities"].as_object() {
            let contains = |kind: &str, id: &str| {
                catalog
                    .get(kind)
                    .and_then(Value::as_array)
                    .is_some_and(|ids| ids.iter().any(|value| value == id))
            };
            for model in &mut merged {
                let id = model["id"].as_str().unwrap_or_default();
                let id = ["ollama:", "lmstudio:", "llamacpp:"]
                    .iter()
                    .find_map(|prefix| id.strip_prefix(prefix))
                    .unwrap_or(id)
                    .to_lowercase();
                let namespace = match model["providerType"].as_str() {
                    Some("gemini") => Some("google"),
                    Some(provider @ ("openai" | "anthropic" | "deepseek" | "minimax")) => {
                        Some(provider)
                    }
                    _ => None,
                };
                let qualified = namespace
                    .filter(|_| !id.contains('/'))
                    .map(|ns| format!("{ns}/{id}"));
                let supports = |kind| {
                    contains(kind, &id) || qualified.as_deref().is_some_and(|id| contains(kind, id))
                };
                model["capabilities"] = json!({"reasoning": supports("reasoning"), "imageGeneration": supports("imageGeneration")});
            }
        }
        return Ok(Value::Array(merged));
    }
    let catalog: Value =
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/providers.json")))
            .map_err(|error| error.to_string())?;
    let provider = match request["provider"]
        .as_str()
        .filter(|provider| !provider.is_empty())
    {
        Some("google") => "gemini",
        Some(provider) => provider,
        None => "everfern",
    };
    let models = catalog["agentModels"]
        .as_array()
        .ok_or("Invalid embedded model catalog")?;
    let mut selected: Vec<_> = models
        .iter()
        .filter(|model| model["providerType"] == provider)
        .cloned()
        .collect();
    let name = match provider {
        "openrouter" => Some("OpenRouter"),
        "nvidia" => Some("NVIDIA NIM"),
        "ollama-cloud" => Some("Ollama Cloud"),
        _ => None,
    };
    if let (Some(name), Some(id)) = (
        name,
        request["customModel"]
            .as_str()
            .map(str::trim)
            .filter(|id| !id.is_empty()),
    ) {
        if !selected.iter().any(|model| model["id"] == id) {
            selected.insert(0, json!({"id":id, "name":format!("{id} (Custom)"), "provider":name, "providerType":provider}));
        }
    }
    Ok(Value::Array(selected))
}

#[tauri::command]
pub async fn ef_host_local_models(params: Option<Value>) -> Value {
    local_settings::list(params).await
}

#[tauri::command]
pub async fn ef_host_hardware() -> Value {
    host_hardware(true).await
}

pub async fn host_hardware(include_telemetry: bool) -> Value {
    #[cfg(windows)]
    {
        let mut hardware = windows_gpu_probe(include_telemetry).await;
        for (key, value) in windows_cpu_memory() {
            hardware[key] = value;
        }
        hardware["isAppleSilicon"] = json!(false);
        hardware
    }
    #[cfg(target_os = "macos")]
    {
        macos_hardware().await
    }
    #[cfg(target_os = "linux")]
    {
        linux_hardware(include_telemetry).await
    }
}

#[cfg(target_os = "linux")]
async fn linux_hardware(include_telemetry: bool) -> Value {
    let cpuinfo = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let value = |key: &str| {
        meminfo
            .lines()
            .find_map(|line| line.strip_prefix(key))
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(|number| number.parse::<f64>().ok())
            .unwrap_or_default()
    };
    let ram = value("MemTotal:") * 1024.0 / 1_073_741_824.0;
    let free = value("MemAvailable:") * 1024.0 / 1_073_741_824.0;
    let cpu_model = cpuinfo
        .lines()
        .find_map(|line| {
            line.strip_prefix("model name")
                .and_then(|rest| rest.split_once(':'))
                .map(|(_, value)| value.trim())
        })
        .unwrap_or("Generic Processor");
    let cores = cpuinfo
        .lines()
        .filter(|line| line.starts_with("processor"))
        .count();
    let speed = cpuinfo
        .lines()
        .find_map(|line| {
            line.strip_prefix("cpu MHz")
                .and_then(|rest| rest.split_once(':'))
                .and_then(|(_, value)| value.trim().parse::<f64>().ok())
        })
        .unwrap_or_default();
    let gpu = nvidia_probe(include_telemetry).await.unwrap_or(Value::Null);
    let mut hardware = json!({"ramGB":round_hardware(ram),"freeRamGB":round_hardware(free),
        "cpuModel":cpu_model,"cpuCores":cores,"cpuSpeed":speed,
        "gpuName":"Unknown GPU","vramGB":0.0,"isNvidia":false,
        "isAppleSilicon":false,"driverVersion":"","gpuTemp":0});
    if let Some(gpu) = gpu.as_object() {
        for key in ["gpuName", "vramGB", "isNvidia", "driverVersion", "gpuTemp"] {
            if let Some(value) = gpu.get(key) {
                hardware[key] = value.clone();
            }
        }
    }
    hardware
}

#[cfg(target_os = "macos")]
async fn macos_hardware() -> Value {
    let total = mac_command("sysctl", &["-n", "hw.memsize"], 2)
        .await
        .and_then(|text| text.trim().parse::<f64>().ok())
        .unwrap_or_default();
    let free_pages = mac_command("vm_stat", &[], 2)
        .await
        .and_then(|text| {
            text.lines().find_map(|line| {
                line.strip_prefix("Pages free:")
                    .or_else(|| line.strip_prefix("Pages inactive:"))?
                    .trim()
                    .trim_end_matches('.')
                    .parse::<f64>()
                    .ok()
            })
        })
        .unwrap_or_default();
    let page_size = mac_command("sysctl", &["-n", "hw.pagesize"], 2)
        .await
        .and_then(|text| text.trim().parse::<f64>().ok())
        .unwrap_or(4096.0);
    let mut model = mac_command("sysctl", &["-n", "machdep.cpu.brand_string"], 2)
        .await
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Generic Processor".into());
    let cores = mac_command("sysctl", &["-n", "hw.ncpu"], 2)
        .await
        .and_then(|text| text.trim().parse::<u32>().ok())
        .unwrap_or_default();
    let speed = mac_command("sysctl", &["-n", "hw.cpufrequency"], 2)
        .await
        .and_then(|text| text.trim().parse::<f64>().ok())
        .map(|hz| hz / 1_000_000.0)
        .unwrap_or_default();
    let displays = mac_command("system_profiler", &["SPDisplaysDataType"], 5)
        .await
        .unwrap_or_default();
    let apple = displays.contains("Apple M") || model.contains("Apple");
    let gpu_name = displays
        .lines()
        .find_map(|line| line.trim().strip_prefix("Chipset Model:").map(str::trim))
        .filter(|name| !name.is_empty())
        .unwrap_or(if apple {
            "Apple Silicon"
        } else {
            "Intel/AMD Mac"
        });
    if apple && model == "Generic Processor" {
        model = gpu_name.to_owned();
    }
    let vram = if apple {
        round_hardware(total / 1_073_741_824.0 * 0.75)
    } else {
        displays
            .lines()
            .find_map(|line| {
                let value = line
                    .trim()
                    .strip_prefix("VRAM (Total):")
                    .or_else(|| line.trim().strip_prefix("VRAM:"))?
                    .trim();
                let mut fields = value.split_whitespace();
                let amount = fields.next()?.parse::<f64>().ok()?;
                Some(round_hardware(
                    if fields
                        .next()
                        .is_some_and(|unit| unit.eq_ignore_ascii_case("GB"))
                    {
                        amount
                    } else {
                        amount / 1024.0
                    },
                ))
            })
            .unwrap_or_default()
    };
    json!({"ramGB":round_hardware(total / 1_073_741_824.0),
        "freeRamGB":round_hardware(free_pages * page_size / 1_073_741_824.0),
        "cpuModel":model,"cpuCores":cores,"cpuSpeed":speed,
        "gpuName":gpu_name,"vramGB":vram,"isNvidia":false,"isAppleSilicon":apple,
        "driverVersion":"","gpuTemp":0})
}

#[cfg(target_os = "macos")]
async fn mac_command(program: &str, args: &[&str], seconds: u64) -> Option<String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(seconds), command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn round_hardware(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(windows)]
fn windows_cpu_memory() -> [(&'static str, Value); 5] {
    use windows_sys::Win32::System::{
        Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ},
        SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
        Threading::GetActiveProcessorCount,
    };
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let key = wide(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
    let mut model = [0u16; 256];
    let mut model_bytes = std::mem::size_of_val(&model) as u32;
    let mut speed = 0u32;
    let mut speed_bytes = std::mem::size_of_val(&speed) as u32;
    let mut memory: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    memory.dwLength = std::mem::size_of_val(&memory) as u32;
    let (model_ok, cores) = unsafe {
        GlobalMemoryStatusEx(&mut memory);
        let status = RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            wide("ProcessorNameString").as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            model.as_mut_ptr().cast(),
            &mut model_bytes,
        );
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            wide("~MHz").as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut speed as *mut u32).cast(),
            &mut speed_bytes,
        );
        (status == 0, GetActiveProcessorCount(u16::MAX))
    };
    let model = String::from_utf16_lossy(
        &model[..model
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(model.len())],
    );
    let gib = |bytes: u64| (bytes as f64 / 1_073_741_824.0 * 10.0).round() / 10.0;
    [
        ("ramGB", json!(gib(memory.ullTotalPhys))),
        ("freeRamGB", json!(gib(memory.ullAvailPhys))),
        (
            "cpuModel",
            json!(if model_ok && !model.trim().is_empty() {
                model.trim()
            } else {
                "Generic Processor"
            }),
        ),
        ("cpuCores", json!(cores)),
        ("cpuSpeed", json!(speed)),
    ]
}

async fn windows_gpu_probe(include_telemetry: bool) -> Value {
    let unknown = json!({"gpuName":"Unknown GPU","vramGB":0.0,"isNvidia":false,"driverVersion":"","gpuTemp":0});
    if let Ok(gpu) = nvidia_probe(include_telemetry).await {
        return if gpu.is_null() { unknown } else { gpu };
    }
    let mut gpu = wmic_gpu_probe(include_telemetry).await.unwrap_or(unknown);
    if gpu["gpuName"] != "Unknown GPU" || gpu["vramGB"].as_f64().unwrap_or_default() > 0.0 {
        return gpu;
    }
    if let Ok(cim) = cim_gpu_probe().await {
        if let Some(name) = cim["name"].as_str().filter(|name| !name.is_empty()) {
            gpu["gpuName"] = json!(name);
        }
        let bytes = cim["vramBytes"].as_u64().unwrap_or_default();
        let vram = if bytes >= 4_026_531_840 {
            4.0
        } else {
            (bytes as f64 / 1_073_741_824.0 * 10.0).round() / 10.0
        };
        gpu["vramGB"] = json!(vram);
    }
    let lower = gpu["gpuName"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    gpu["isNvidia"] = json!(["nvidia", "rtx", "gtx"]
        .iter()
        .any(|needle| lower.contains(needle)));
    gpu
}

async fn cim_gpu_probe() -> Result<Value, String> {
    if !cfg!(windows) {
        return Ok(Value::Null);
    }
    let mut command = tokio::process::Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,@{N='Vram';E={$_.AdapterRAM}} | ConvertTo-Json -Compress"]);
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), command.output())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("CIM hardware query failed".into());
    }
    let data = serde_json::from_str(&crate::vm::decode_windows_output(&output.stdout))
        .map_err(|error| error.to_string())?;
    Ok(best_cim_adapter(data))
}

fn best_cim_adapter(data: Value) -> Value {
    let records = match data {
        Value::Array(records) => records,
        Value::Object(_) => vec![data],
        _ => return Value::Null,
    };
    let memory = |record: &Value| record["Vram"].as_u64().unwrap_or_default();
    // Reverse the scan because max_by_key chooses the last equal entry.
    records
        .iter()
        .rev()
        .filter(|record| record.is_object())
        .max_by_key(|record| memory(record))
        .map_or(Value::Null, |record| {
            json!({
                "name": record["Name"].as_str().unwrap_or_default(),
                "vramBytes": memory(record),
            })
        })
}

#[test]
fn cim_gpu_probe_prefers_the_first_adapter_on_equal_memory() {
    assert_eq!(
        best_cim_adapter(json!([{"Name":"first","Vram":42},{"Name":"second","Vram":42}])),
        json!({"name":"first","vramBytes":42})
    );
    assert_eq!(
        best_cim_adapter(json!({"Name":"single"})),
        json!({"name":"single","vramBytes":0})
    );
}

async fn wmic_gpu_probe(include_telemetry: bool) -> Result<Value, String> {
    let mut command = tokio::process::Command::new("wmic");
    let fields = if include_telemetry {
        "AdapterRAM,Name,DriverVersion"
    } else {
        "AdapterRAM,Name"
    };
    command.args([
        "path",
        "Win32_VideoController",
        "get",
        fields,
        "/format:list",
    ]);
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(3), command.output())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("wmic hardware query failed".into());
    }
    let text = crate::vm::decode_windows_output(&output.stdout);
    Ok(parse_wmic_gpu(&text, include_telemetry))
}

fn parse_wmic_gpu(text: &str, include_telemetry: bool) -> Value {
    let mut name = "Unknown GPU";
    let mut memory = 0u64;
    let mut driver = "";
    for line in text.lines().map(str::trim) {
        if let Some(bytes) = line
            .strip_prefix("AdapterRAM=")
            .and_then(|value| value.parse::<u64>().ok())
        {
            memory = memory.max(bytes);
        } else if let Some(value) = line
            .strip_prefix("Name=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let lower = value.to_ascii_lowercase();
            if name == "Unknown GPU" || lower.contains("nvidia") || lower.contains("rtx") {
                name = value;
            }
        } else if let Some(value) = line.strip_prefix("DriverVersion=") {
            driver = value.trim();
        }
    }
    let lower = name.to_ascii_lowercase();
    let vram = (memory as f64 / 1073741824.0 * 10.0).round() / 10.0;
    json!({"gpuName":name,"vramGB":vram,"driverVersion":driver,"gpuTemp":0,
        "isNvidia":include_telemetry && ["nvidia","rtx","gtx"].iter().any(|needle| lower.contains(needle))})
}

pub async fn nvidia_probe(include_telemetry: bool) -> Result<Value, String> {
    let mut command = tokio::process::Command::new("nvidia-smi");
    let query = if include_telemetry {
        "--query-gpu=name,memory.total,driver_version,temperature.gpu"
    } else {
        "--query-gpu=name,memory.total"
    };
    command.args([query, "--format=csv,noheader,nounits"]);
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(3), command.output())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("nvidia-smi hardware query failed".into());
    }
    Ok(nvidia_probe_output(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn nvidia_probe_output(output: &str) -> Value {
    let mut fields = output
        .lines()
        .next()
        .unwrap_or_default()
        .split(',')
        .map(str::trim);
    let Some((name, memory)) = fields.next().zip(fields.next()) else {
        return Value::Null;
    };
    let vram = memory.parse::<f64>().unwrap_or_default() / 1024.0;
    json!({
        "gpuName": name,
        "vramGB": (vram * 10.0).round() / 10.0,
        "driverVersion": fields.next().unwrap_or_default(),
        "gpuTemp": fields.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or_default(),
        "isNvidia": true,
    })
}

#[test]
fn nvidia_probe_uses_first_adapter_and_handles_missing_temperature() {
    let output =
        nvidia_probe_output("NVIDIA Example, 8192, 123.45, [N/A]\nOther GPU, 4096, 123.45, 30");
    assert_eq!(
        output,
        json!({"gpuName":"NVIDIA Example","vramGB":8.0,"driverVersion":"123.45","gpuTemp":0,"isNvidia":true})
    );
}

pub async fn local_model_response(options: &Value) -> Result<Value, String> {
    let base = options["baseUrl"]
        .as_str()
        .ok_or("Missing local model URL")?;
    let ollama = options["provider"] == "ollama";
    let suffix = match options["provider"].as_str() {
        Some("ollama") => "/api/tags",
        Some("lmstudio" | "llamacpp") if base.ends_with("/v1") => "/models",
        Some("lmstudio" | "llamacpp") => "/v1/models",
        _ => return Err("Unsupported local model provider".into()),
    };
    let endpoint =
        reqwest::Url::parse(&format!("{base}{suffix}")).map_err(|error| error.to_string())?;
    crate::http::validate_url(&endpoint)?;
    let response = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| error.to_string())?
        .get(endpoint)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !ollama && !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    match response.json().await {
        Ok(value) => Ok(value),
        Err(error) if ollama && error.is_decode() => Ok(Value::Null),
        Err(error) => Err(error.to_string()),
    }
}

#[test]
fn local_model_response_preserves_settings_provider_behavior() {
    use std::io::{BufRead, BufReader, Write};
    let cases = [
        (
            "ollama",
            "/custom",
            "/custom/api/tags",
            "200 OK",
            r#"{"models":[{"name":"qwen","size":42}]}"#,
        ),
        ("ollama", "", "/api/tags", "200 OK", "invalid JSON"),
        (
            "lmstudio",
            "/custom",
            "/custom/v1/models",
            "200 OK",
            r#"{"data":[]}"#,
        ),
        (
            "llamacpp",
            "/v1",
            "/v1/models",
            "503 Service Unavailable",
            "{}",
        ),
    ];
    for (provider, base, path, status, body) in cases {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(4)))
                .unwrap();
            let headers: Vec<_> = BufReader::new(&mut stream)
                .lines()
                .map(Result::unwrap)
                .take_while(|line| !line.is_empty())
                .collect();
            assert_eq!(headers[0], format!("GET {path} HTTP/1.1"));
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let request = json!({"provider":provider,"baseUrl":format!("http://{addr}{base}")});
        let response = tauri::async_runtime::block_on(local_model_response(&request));
        server.join().unwrap();
        if status.starts_with("503") {
            assert_eq!(response.unwrap_err(), "HTTP 503");
        } else {
            assert_eq!(
                response.unwrap(),
                serde_json::from_str(body).unwrap_or(Value::Null)
            );
        }
    }
}

pub async fn local_models(provider: &str, options: &Value) -> Value {
    let (base, suffix) = match provider {
        "ollama" => ("http://127.0.0.1:11434", "/api/tags"),
        "lmstudio" => ("http://127.0.0.1:1234/v1", "/models"),
        "llamacpp" => ("http://localhost:8080/v1", "/models"),
        "openai" => ("https://api.openai.com/v1", "/models"),
        "deepseek" => ("https://api.deepseek.com", "/models"),
        "minimax" => ("https://api.minimax.io/v1", "/models"),
        "everfern" => ("https://api.everfern.app/api", "/models"),
        "gemini" => (
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "/models",
        ),
        "ollama-cloud" => ("https://ollama.com/v1", "/models"),
        "nvidia" => ("https://integrate.api.nvidia.com/v1", "/models"),
        "openrouter" => ("https://openrouter.ai/api/v1", "/models"),
        _ => return json!([]),
    };
    let result = async {
        let base = options["baseUrl"]
            .as_str()
            .map(str::trim)
            .filter(|base| !base.is_empty())
            .unwrap_or(base);
        let base = base.trim_end_matches('/');
        let prefix = if provider == "llamacpp" && !base.ends_with("/v1") {
            "/v1"
        } else {
            ""
        };
        let mut endpoint = reqwest::Url::parse(&format!("{base}{prefix}{suffix}")).ok()?;
        crate::http::validate_url(&endpoint).ok()?;
        if endpoint.scheme() == "http" && matches!(endpoint.host_str(), Some("localhost" | "[::1]"))
        {
            endpoint.set_host(Some("127.0.0.1")).ok()?;
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .ok()?;
        let mut request = client.get(endpoint);
        request = request.header("Content-Type", "application/json");
        if provider == "openrouter" {
            request = request
                .header("HTTP-Referer", "https://everfern.app")
                .header("X-OpenRouter-Title", "EverFern");
        }
        if let Some(key) = options["apiKey"].as_str().filter(|key| !key.is_empty()) {
            request = request.bearer_auth(key);
        }
        let data: Value = request
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json()
            .await
            .ok()?;
        let models = if provider == "ollama" {
            data["models"].as_array()?
        } else {
            data["data"]
                .as_array()
                .or_else(|| data["models"].as_array())
                .or_else(|| data.as_array())?
        };
        Some(Value::Array(
            models
                .iter()
                .filter_map(|model| {
                    let name = if provider == "ollama" {
                        model["name"].as_str()
                    } else {
                        model.as_str().or_else(|| {
                            ["id", "name", "model"].iter().find_map(|field| {
                                model[*field].as_str().filter(|name| !name.is_empty())
                            })
                        })
                    };
                    name.filter(|name| !name.trim().is_empty()).map(Value::from)
                })
                .collect(),
        ))
    }
    .await;
    result.unwrap_or_else(|| json!([]))
}

#[tauri::command]
pub async fn ef_saved_provider_health(app: AppHandle) -> Result<Option<Value>, String> {
    let saved = {
        use tauri::Manager;
        let sidecar = app.state::<crate::Sidecar>();
        let Some(_stopped) = sidecar.lock_if_stopped()? else {
            return Ok(None);
        };
        config::load_config(&home()?.join(".everfern"))
    };
    let config = &saved["config"];
    let Some(provider) = config["provider"]
        .as_str()
        .filter(|provider| !provider.is_empty())
    else {
        return Ok(Some(
            json!({"ok": false, "error": "No provider configured"}),
        ));
    };
    let saved_base = config["baseUrl"]
        .as_str()
        .filter(|url| config["provider"] == provider && !url.is_empty())
        .or_else(|| config["baseUrls"][provider].as_str());
    let key = config["keys"][provider]
        .as_str()
        .filter(|key| !key.is_empty())
        .or_else(|| {
            (config["provider"] == provider)
                .then(|| config["apiKey"].as_str())
                .flatten()
        });
    let base = saved_base.map(str::trim).filter(|url| !url.is_empty());
    let base = match (provider, base) {
        ("ollama-cloud", Some("https://ollama.com" | "https://ollama.com/api")) => None,
        ("ollama" | "lmstudio" | "llamacpp", base) => base,
        (_, base) => base.filter(|url| !url.contains("localhost") && !url.contains("127.0.0.1")),
    };
    Ok(local_provider_health(&json!({"provider":provider,"baseUrl":base,"apiKey":key})).await)
}

pub async fn local_provider_health(config: &Value) -> Option<Value> {
    let provider = config["provider"].as_str()?;
    let start = std::time::Instant::now();
    // The legacy Anthropic health check returns a static model list.
    let available = provider == "anthropic"
        || local_models(provider, config)
            .await
            .as_array()
            .is_some_and(|models| !models.is_empty());
    let mut result =
        json!({"ok": available, "provider": provider, "latencyMs": start.elapsed().as_millis()});
    if !available {
        result["reason"] = json!("No models reported — is the server running?");
    }
    Some(result)
}

#[tauri::command]
pub async fn ef_list_agent_models(active_config: Option<Value>) -> Result<Value, String> {
    let mut saved = config::load_config(&home()?.join(".everfern"))["config"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let persisted = Value::Object(saved.clone());
    if let Some(Value::Object(active)) = active_config {
        for (field, value) in active {
            if matches!(
                field.as_str(),
                "provider" | "model" | "baseUrl" | "customModel"
            ) {
                saved.insert(field, value);
            }
        }
    }
    let config = &Value::Object(saved);
    let active = agent_models(config)?;
    let llama_active = config["provider"] == "llamacpp";
    let base = config
        .get("baseUrl")
        .filter(|value| llama_active && value.as_str().is_some_and(|s| !s.is_empty()))
        .unwrap_or(&config["baseUrls"]["llamacpp"]);
    let saved_base = persisted
        .get("baseUrl")
        .filter(|value| {
            persisted["provider"] == "llamacpp" && value.as_str().is_some_and(|url| !url.is_empty())
        })
        .unwrap_or(&persisted["baseUrls"]["llamacpp"]);
    let key = (base == saved_base)
        .then(|| {
            persisted["keys"]
                .get("llamacpp")
                .filter(|value| value.as_str().is_some_and(|s| !s.is_empty()))
                .or_else(|| (persisted["provider"] == "llamacpp").then_some(&persisted["apiKey"]))
        })
        .flatten();
    let ollama = tauri::async_runtime::spawn(async { local_models("ollama", &Value::Null).await });
    let studio =
        tauri::async_runtime::spawn(async { local_models("lmstudio", &Value::Null).await });
    let catalog = tauri::async_runtime::spawn(openrouter::cached_catalog());
    let llama = local_models("llamacpp", &json!({"baseUrl":base,"apiKey":key})).await;
    let mut local = Vec::new();
    for (provider, name, models) in [
        (
            "ollama",
            "Ollama",
            ollama.await.map_err(|error| error.to_string())?,
        ),
        (
            "lmstudio",
            "LM Studio",
            studio.await.map_err(|error| error.to_string())?,
        ),
        ("llamacpp", "llama.cpp", llama),
    ] {
        if let Some(models) = models.as_array() {
            for model in models.iter().filter_map(Value::as_str) {
                local.push(json!({"id":format!("{provider}:{model}"),"name":model,"provider":name,"providerType":provider}));
            }
            if models.is_empty() {
                if provider != "llamacpp" {
                    local.push(json!({"id":format!("{provider}-empty"),"name":format!("No models found in {name}"),"provider":name,"providerType":provider}));
                } else if llama_active {
                    if let Some(model) = config["model"].as_str().filter(|model| !model.is_empty())
                    {
                        let model = model.strip_prefix("llamacpp:").unwrap_or(model);
                        local.push(json!({"id":format!("llamacpp:{model}"),"name":model,"provider":name,"providerType":provider}));
                    }
                }
            }
        }
    }
    let capabilities = catalog.await.map_err(|error| error.to_string())?;
    let models = agent_models(
        &json!({"activeModels":active,"localModels":local,"capabilities":capabilities}),
    )?;
    Ok(json!({"success":true,"models":models}))
}

#[cfg(test)]
#[test]
fn agent_catalog_merges_scoped_models_and_matches_provider_capabilities() {
    let selected = agent_models(&json!({
        "provider": "openrouter", "customModel": " example/custom "
    }))
    .unwrap();
    assert_eq!(selected[0]["id"], "example/custom");
    let models = agent_models(&json!({
        "activeModels": [{"id":"Gemini-Example","providerType":"gemini"}],
        "localModels": [
            {"id":"Gemini-Example","providerType":"gemini"},
            {"id":"ollama:Local","providerType":"ollama"}
        ],
        "capabilities": {"reasoning":["google/gemini-example"],"imageGeneration":["local"]}
    }))
    .unwrap();
    assert_eq!(models.as_array().unwrap().len(), 2);
    assert_eq!(
        models[0]["capabilities"],
        json!({"reasoning":true,"imageGeneration":false})
    );
    assert_eq!(
        models[1]["capabilities"],
        json!({"reasoning":false,"imageGeneration":true})
    );
}

#[cfg(test)]
#[test]
fn local_model_discovery_uses_configured_endpoint_and_bearer_key() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(4)))
            .unwrap();
        let headers: Vec<_> = BufReader::new(&mut stream)
            .lines()
            .map(Result::unwrap)
            .take_while(|line| !line.is_empty())
            .collect();
        assert_eq!(headers[0], "GET /custom/v1/models HTTP/1.1");
        assert!(headers
            .iter()
            .any(|line| line.eq_ignore_ascii_case("authorization: Bearer sample-key")));
        let content = r#"{"models":[{"name":"one"},{"model":"two"},"three",{"id":" "}]}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}", content.len()).unwrap();
    });
    let options =
        json!({"baseUrl":format!(" http://localhost:{port}/custom/ "),"apiKey":"sample-key"});
    let models = tauri::async_runtime::block_on(local_models("llamacpp", &options));
    assert_eq!(models, json!(["one", "two", "three"]));
    server.join().unwrap();
}
