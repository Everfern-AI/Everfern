//! Agent tool selection by task relevance, matching the desktop runner policy.

use serde_json::{json, Map, Value};
use std::collections::HashSet;

const CATEGORIES: &[(&str, &[&str])] = &[
    (
        "filesystem",
        &[
            "file",
            "read",
            "write",
            "save",
            "create",
            "edit",
            "delete",
            "rename",
            "move",
            "copy",
            "folder",
            "directory",
            "path",
            "ls",
            "grep",
            "search",
            "find",
            "glob",
            "code",
            "script",
            "source",
        ],
    ),
    (
        "terminal",
        &[
            "run",
            "execute",
            "command",
            "shell",
            "bash",
            "zsh",
            "pwsh",
            "powershell",
            "cmd",
            "terminal",
            "install",
            "npm",
            "pip",
            "build",
            "compile",
            "test",
            "deploy",
            "docker",
            "git",
        ],
    ),
    (
        "web",
        &[
            "search",
            "fetch",
            "url",
            "http",
            "https",
            "website",
            "web",
            "online",
            "api",
            "rest",
            "scrape",
            "crawl",
            "link",
            "page",
            "documentation",
        ],
    ),
    (
        "vision",
        &[
            "screenshot",
            "screen",
            "capture",
            "image",
            "photo",
            "picture",
            "see",
            "look",
            "view",
            "visual",
            "ocr",
            "desktop",
            "gui",
            "ui",
            "icon",
            "button",
            "window",
        ],
    ),
    (
        "memory",
        &[
            "remember",
            "forget",
            "memory",
            "recall",
            "fact",
            "profile",
            "preference",
            "store",
            "learn",
            "user",
        ],
    ),
    (
        "planning",
        &[
            "plan",
            "step",
            "task",
            "todo",
            "decompose",
            "execute",
            "strategy",
            "pipeline",
            "workflow",
            "stage",
            "phase",
            "milestone",
        ],
    ),
    (
        "communication",
        &[
            "discord", "telegram", "slack", "email", "message", "send", "notify", "share", "post",
        ],
    ),
    (
        "synthesis",
        &[
            "synthesize",
            "combine",
            "merge",
            "unify",
            "aggregate",
            "consolidate",
            "summary",
            "report",
        ],
    ),
    (
        "subagent",
        &[
            "delegate",
            "spawn",
            "subagent",
            "swarm",
            "parallel",
            "background",
            "child",
            "worker",
            "agent",
            "specialist",
        ],
    ),
    (
        "browser",
        &[
            "navis", "browser", "navigate", "click", "scroll", "type", "fill", "form", "login",
            "extract", "dom", "page", "url", "webpage", "cookies",
        ],
    ),
    (
        "artifact",
        &[
            "artifact",
            "dashboard",
            "chart",
            "report",
            "visualize",
            "presentation",
            "pptx",
            "slide",
            "deck",
            "html",
            "svg",
        ],
    ),
    (
        "mcp",
        &[
            "mcp",
            "server",
            "connect",
            "tool",
            "registry",
            "modelcontextprotocol",
        ],
    ),
    (
        "scheduling",
        &[
            "schedule",
            "cron",
            "timer",
            "interval",
            "recurring",
            "remind",
            "alert",
        ],
    ),
    (
        "preview",
        &[
            "preview", "live", "url", "show", "display", "open", "launch", "render",
        ],
    ),
    (
        "skill",
        &[
            "skill", "tutorial", "guide", "template", "workflow", "recipe",
        ],
    ),
    (
        "config",
        &[
            "config",
            "setting",
            "preference",
            "option",
            "enable",
            "disable",
            "toggle",
        ],
    ),
    (
        "ai",
        &[
            "model",
            "prompt",
            "llm",
            "ai",
            "generate",
            "reply",
            "respond",
            "chat",
            "conversation",
        ],
    ),
    (
        "data",
        &[
            "csv",
            "json",
            "excel",
            "spreadsheet",
            "sheets",
            "sheet",
            "database",
            "sql",
            "query",
            "table",
            "row",
            "rows",
            "cell",
            "column",
            "record",
            "dataset",
            "analyze",
            "analytics",
            "statistics",
            "chart",
            "graph",
            "plot",
        ],
    ),
];

const ALWAYS_INCLUDE: &[&str] = &[
    "ask_user_question",
    "local_permission",
    "terminal_execute",
    "bash",
    "executePwsh",
    "terminal_status",
    "read",
    "write",
    "ls",
    "edit",
    "multi_file_edit",
    "navis",
    "computer_use",
    "skill",
    "create_artifact",
    "edit_artifact",
    "visualize",
    "present_files",
    "todo_write",
    "planner",
    "memory_save",
    "memory_search",
    "web_search",
    "web_fetch",
    "analyze_image",
    "spawn_agent",
    "spawn_swarm",
    "task_complete",
    "update_step",
    "execution_plan",
    "open_app",
    "switch_app",
    "list_apps",
    "close_app",
    "worker_bash",
    "worker_exec",
    "worker_read_file",
    "worker_write_file",
    "worker_list_files",
    "worker_upload_files",
    "sheets_read",
    "sheets_write",
    "sheets_append",
    "sheets_clear",
    "sheets_create",
    "sheets_import",
    "sheets_export",
    "sheets_format",
    "sheets_add_sheet",
    "worker_click",
    "worker_type",
    "worker_describe",
    "files_action",
    "terminal_run",
];

fn score_text(text: &str, signals: &[&str]) -> i64 {
    let lower = text.to_lowercase();
    let mut score = 0;
    for keyword in signals {
        let mut cursor = 0;
        let mut count = 0;
        while cursor <= lower.len() && count < 3 {
            let Some(position) = lower[cursor..].find(keyword) else {
                break;
            };
            count += 1;
            score += 1;
            // JavaScript indexOf resumes one UTF-16 code unit after the prior match,
            // allowing overlapping ASCII-keyword matches such as "aaaa" / "aa".
            cursor += position + 1;
        }
    }
    score
}

fn exact(name: &str, values: &[&str]) -> bool {
    values.contains(&name)
}

fn tool_category(name: &str) -> Option<&'static str> {
    let name = name.to_ascii_lowercase();
    if exact(
        &name,
        &[
            "read_file",
            "write_to_file",
            "replace_file_content",
            "grep_search",
            "list_dir",
            "system_files",
            "create_file",
            "delete_file",
            "move_file",
            "copy_file",
            "rename_file",
            "search_files",
            "create_directory",
            "delete_directory",
            "list_directory",
            "batch_write",
        ],
    ) || exact(
        &name,
        &[
            "read",
            "write",
            "edit",
            "multi_file_edit",
            "delete",
            "rename",
            "move",
            "copy",
            "mkdir",
            "touch",
            "append_file",
            "prepend_file",
            "create_project",
            "open_file",
            "save_file",
            "file",
            "ls",
            "grep",
            "find",
        ],
    ) {
        return Some("filesystem");
    }
    if exact(
        &name,
        &[
            "terminal",
            "terminal_status",
            "terminal_execute",
            "run_command",
            "exec",
            "execute_command",
            "run_script",
            "run_code",
            "bash",
            "executepwsh",
            "powershell",
            "cmd",
        ],
    ) {
        return Some("terminal");
    }
    if exact(
        &name,
        &[
            "web_search",
            "web_search_bing",
            "web_fetch",
            "web_scrape",
            "fetch_url",
        ],
    ) {
        return Some("web");
    }
    if exact(
        &name,
        &[
            "analyze_image",
            "visual_classification_sheet",
            "computer_use",
            "screenshot",
            "screen_capture",
            "ocr",
        ],
    ) {
        return Some("vision");
    }
    if exact(
        &name,
        &[
            "memory_save",
            "memory_search",
            "remember_fact",
            "recall_fact",
            "update_profile",
            "profile",
        ],
    ) {
        return Some("memory");
    }
    if exact(
        &name,
        &[
            "planner",
            "update_step",
            "execution_plan",
            "todo_write",
            "todo_list",
            "create_plan",
            "update_plan_step",
        ],
    ) {
        return Some("planning");
    }
    if exact(
        &name,
        &[
            "send_discord_message",
            "send_telegram_message",
            "send_email",
            "send_slack_message",
        ],
    ) {
        return Some("communication");
    }
    if exact(
        &name,
        &[
            "synthesize_tool",
            "synthesize_skill",
            "merge",
            "combine",
            "aggregate",
        ],
    ) {
        return Some("synthesis");
    }
    if exact(
        &name,
        &[
            "spawn_agent",
            "spawn_swarm",
            "broadcast_swarm_fact",
            "read_swarm_memory",
        ],
    ) {
        return Some("subagent");
    }
    if exact(
        &name,
        &[
            "navis",
            "browser",
            "browser_use",
            "page_navigate",
            "page_click",
            "page_type",
            "page_scroll",
            "page_extract",
            "dom_extract",
        ],
    ) {
        return Some("browser");
    }
    if exact(
        &name,
        &[
            "create_artifact",
            "edit_artifact",
            "visualize",
            "present_files",
            "create_chart",
            "create_report",
            "create_dashboard",
        ],
    ) {
        return Some("artifact");
    }
    if [
        "search_mcp_registry",
        "connect_mcp_server",
        "list_mcp_tools",
        "mcp_",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        return Some("mcp");
    }
    if [
        "create_scheduled_task",
        "list_scheduled_tasks",
        "delete_scheduled_task",
        "scheduled_task",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        return Some("scheduling");
    }
    if exact(
        &name,
        &[
            "preview_live_url",
            "show_user_url",
            "open_url",
            "launch_url",
        ],
    ) {
        return Some("preview");
    }
    if name == "skill" {
        return Some("skill");
    }
    if exact(
        &name,
        &[
            "ask_user_question",
            "local_permission",
            "allow_file_delete",
            "approve_actions",
            "confirm",
        ],
    ) {
        return Some("config");
    }
    if [
        "analyze_data",
        "query_data",
        "sql_query",
        "dataframe",
        "plot",
        "chart",
        "statistics",
        "sheets_",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        return Some("data");
    }
    None
}

fn mcp_relevant(name: &str, haystack: &str) -> bool {
    let Some(rest) = name.strip_prefix("mcp__") else {
        return false;
    };
    let Some((server, tool)) = rest.split_once("__") else {
        return false;
    };
    if server.is_empty() || tool.is_empty() {
        return false;
    }
    let mut words = vec![server.to_lowercase()];
    words.extend(server.split(['_', '-']).map(str::to_lowercase));
    words.push(
        tool.split(['_', '-'])
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase(),
    );
    words
        .into_iter()
        .any(|word| word.encode_utf16().count() >= 3 && haystack.contains(&word))
}

pub fn truncate(request: &Value) -> Result<Value, String> {
    let names = request["names"].as_array().ok_or("Expected tool names")?;
    let user = request["userInput"].as_str().unwrap_or_default();
    let assistant = request["recentAssistantOutput"]
        .as_str()
        .unwrap_or_default();
    let threshold = request["relevanceThreshold"].as_f64().unwrap_or(1.0);
    let always_extra = request["alwaysInclude"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();

    let mut scores = Map::new();
    for (category, signals) in CATEGORIES {
        let score = score_text(user, signals) + score_text(assistant, signals);
        if score > 0 {
            scores.insert((*category).to_string(), json!(score));
        }
    }

    let relevant = scores
        .iter()
        .filter_map(|(category, score)| {
            (score.as_f64().unwrap_or(0.0) >= threshold).then_some(category.as_str())
        })
        .collect::<HashSet<_>>();
    let haystack = format!("{user} {assistant}").to_lowercase();
    let mut kept_indices = Vec::new();
    let mut removed_indices = Vec::new();

    for (index, name_value) in names.iter().enumerate() {
        let name = name_value.as_str().unwrap_or_default();
        if ALWAYS_INCLUDE.contains(&name) || always_extra.contains(name) {
            kept_indices.push(index);
            continue;
        }
        if name.starts_with("mcp__") {
            if relevant.contains("mcp") || mcp_relevant(name, &haystack) {
                kept_indices.push(index);
            } else {
                removed_indices.push(index);
            }
            continue;
        }
        if tool_category(name).is_some_and(|category| relevant.contains(category)) {
            kept_indices.push(index);
        } else {
            removed_indices.push(index);
        }
    }

    let minimum = 8usize.max((names.len() as f64 * 0.2).ceil() as usize);
    let candidate_kept = kept_indices.len();
    let fallback = candidate_kept < minimum;
    if fallback {
        kept_indices = (0..names.len()).collect();
        removed_indices.clear();
    }
    Ok(
        json!({"keptIndices": kept_indices, "removedIndices": removed_indices, "scores": scores, "fallback": fallback, "candidateKept": candidate_kept}),
    )
}
