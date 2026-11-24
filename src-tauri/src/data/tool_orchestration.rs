//! Tool-call dependency analysis and parallel grouping used by the agent runner.

use serde_json::{json, Value};

const WRITE_TOOLS: &[&str] = &[
    "write",
    "write_file",
    "edit",
    "delete",
    "bash",
    "run_command",
    "apply_patch",
    "executePwsh",
];
const READ_ONLY_TOOLS: &[&str] = &[
    "read",
    "read_file",
    "web_search",
    "memory_search",
    "recall_fact",
    "list_dir",
    "list_directory",
    "ls",
    "grep",
    "grep_search",
    "glob",
    "find",
    "fetch_url",
    "view_file",
    "analyze_image",
    "skill",
];
const GLOBAL_LOCK_TOOLS: &[&str] = &["run_command", "bash", "apply_patch", "executePwsh"];
const WRITE_OR_EXEC_TOOLS: &[&str] = &[
    "run_command",
    "bash",
    "executePwsh",
    "apply_patch",
    "edit",
    "write",
    "write_file",
];
const PATH_KEYS: &[&str] = &[
    "path",
    "file_path",
    "root",
    "dir",
    "directory",
    "from",
    "to",
    "src",
    "dest",
];

fn listed(values: &[&str], value: &str) -> bool {
    values.contains(&value)
}

fn extract_paths(value: &Value, paths: &mut Vec<String>) {
    match value {
        Value::String(path) if !path.is_empty() => paths.push(path.clone()),
        Value::Array(values) => values.iter().for_each(|value| extract_paths(value, paths)),
        Value::Object(fields) => {
            for (key, value) in fields {
                if PATH_KEYS.contains(&key.to_ascii_lowercase().as_str()) || key == "paths" {
                    extract_paths(value, paths);
                } else if value.is_array() || value.is_object() {
                    extract_paths(value, paths);
                }
            }
        }
        _ => {}
    }
}

fn tool_paths(args: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    extract_paths(args, &mut paths);
    paths
}

fn tool_analysis(tools: &[Value]) -> Vec<Value> {
    tools.iter().map(|tool| {
        let name = tool["name"].as_str().unwrap_or_default();
        let args = tool.get("args").filter(|value| value.is_object()).cloned().unwrap_or_else(|| json!({}));
        let id = tool.get("id").cloned().unwrap_or(Value::Null);
        let is_write = listed(WRITE_TOOLS, name);
        let is_global_locking = listed(GLOBAL_LOCK_TOOLS, name) && args["safe_for_parallel"] != true;
        let is_read_only = listed(READ_ONLY_TOOLS, name) || (!is_write && !is_global_locking);
        let paths = tool_paths(&args);
        let mut conflicts = Vec::new();

        for other in tools {
            if other.get("id") == Some(&id) { continue; }
            let other_name = other["name"].as_str().unwrap_or_default();
            let other_args = other.get("args").filter(|value| value.is_object()).cloned().unwrap_or_else(|| json!({}));
            let other_global_locking = listed(GLOBAL_LOCK_TOOLS, other_name) && other_args["safe_for_parallel"] != true;
            if is_global_locking || other_global_locking {
                conflicts.push(other.get("id").cloned().unwrap_or(Value::Null));
                continue;
            }

            let is_present_files = name == "present_files";
            let other_is_present_files = other_name == "present_files";
            let is_write_or_exec = is_write || listed(WRITE_OR_EXEC_TOOLS, name);
            let other_is_write_or_exec = listed(WRITE_TOOLS, other_name) || listed(WRITE_OR_EXEC_TOOLS, other_name);
            if (is_present_files && other_is_write_or_exec) || (other_is_present_files && is_write_or_exec) {
                conflicts.push(other.get("id").cloned().unwrap_or(Value::Null));
                continue;
            }

            let other_paths = tool_paths(&other_args);
            let overlapping = paths.iter().any(|path| other_paths.contains(path));
            let other_is_write = listed(WRITE_TOOLS, other_name);
            if (is_write || other_is_write) && overlapping {
                conflicts.push(other.get("id").cloned().unwrap_or(Value::Null));
            }
        }

        json!({ "name": name, "args": args, "id": id, "readOnly": is_read_only, "conflicts": conflicts })
    }).collect()
}

fn parallel_groups(analysis: &[Value]) -> Vec<Vec<Value>> {
    let mut remaining = analysis.to_vec();
    let mut groups = Vec::new();
    while !remaining.is_empty() {
        let mut current = Vec::new();
        let mut used_ids = Vec::new();
        for tool in &remaining {
            let conflicts = tool["conflicts"].as_array().cloned().unwrap_or_default();
            if conflicts.iter().any(|id| used_ids.contains(id)) {
                continue;
            }
            current.push(tool.clone());
            used_ids.push(tool["id"].clone());
        }

        if current.is_empty() {
            groups.push(vec![remaining.remove(0)]);
        } else {
            let group_ids: Vec<Value> = current.iter().map(|tool| tool["id"].clone()).collect();
            remaining.retain(|tool| !group_ids.contains(&tool["id"]));
            groups.push(current);
        }
    }
    groups
}

pub fn analyze_and_group(request: &Value) -> Result<Value, String> {
    let tools = request["tools"].as_array().ok_or("Expected tool calls")?;
    let analysis = tool_analysis(tools);
    let groups = parallel_groups(&analysis);
    Ok(json!({ "analysis": analysis, "groups": groups }))
}
