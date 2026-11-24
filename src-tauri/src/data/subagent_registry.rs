//! Durable subagent lifecycle state used by the TypeScript orchestration adapter.
//!
//! The sidecar keeps its synchronous in-process view for callbacks and polling,
//! while Rust owns registry loading, lifecycle transitions, pruning and writes.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const RETENTION_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_FINISHED: usize = 100;

fn registry_path() -> Result<PathBuf, String> {
    Ok(crate::data::home()?
        .join(".everfern")
        .join("subagent-registry.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn read_entries() -> Result<Vec<Value>, String> {
    let path = registry_path()?;
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_entries(entries: &[Value]) -> Result<(), String> {
    let path = registry_path()?;
    let directory = path.parent().ok_or("Missing registry directory")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let serialized = serde_json::to_vec_pretty(entries).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn is_finished(entry: &Value) -> bool {
    matches!(
        entry["status"].as_str(),
        Some("completed" | "failed" | "aborted")
    )
}

fn cleanup(entries: &mut Vec<Value>, now: u64) -> usize {
    let cutoff = now.saturating_sub(RETENTION_MS);
    let before = entries.len();
    entries.retain(|entry| entry["updatedAt"].as_u64().unwrap_or(0) >= cutoff);
    before - entries.len()
}

fn trim_finished(entries: &mut Vec<Value>, max_finished: usize) -> usize {
    let mut finished: Vec<(u64, usize)> = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| is_finished(entry))
        .map(|(index, entry)| (entry["updatedAt"].as_u64().unwrap_or(0), index))
        .collect();
    let excess = finished.len().saturating_sub(max_finished);
    if excess == 0 {
        return 0;
    }
    finished.sort_by_key(|(updated_at, index)| (*updated_at, *index));
    let remove: std::collections::HashSet<usize> = finished
        .into_iter()
        .take(excess)
        .map(|(_, index)| index)
        .collect();
    let mut index = 0;
    entries.retain(|_| {
        let keep = !remove.contains(&index);
        index += 1;
        keep
    });
    excess
}

fn merge(existing: &Value, updates: &Value) -> Value {
    let mut result = existing.as_object().cloned().unwrap_or_default();
    if let Some(updates) = updates.as_object() {
        for (key, value) in updates {
            result.insert(key.clone(), value.clone());
        }
    }
    Value::Object(result)
}

fn snapshot(entries: &[Value]) -> Value {
    Value::Array(entries.to_vec())
}

pub(crate) fn dispatch(request: &Value) -> Result<Value, String> {
    let operation = request["operation"].as_str().unwrap_or_default();
    if operation == "generate_id" {
        let id = uuid::Uuid::new_v4().simple().to_string();
        return Ok(json!(format!("agent_{}", &id[..12])));
    }

    let mut entries =
        if operation == "load" || request.get("entries").and_then(Value::as_array).is_none() {
            read_entries()?
        } else {
            request["entries"].as_array().cloned().unwrap_or_default()
        };
    if operation == "load" {
        let cutoff = now_ms().saturating_sub(RETENTION_MS);
        entries.retain(|entry| entry["updatedAt"].as_u64().unwrap_or(0) > cutoff);
        return Ok(snapshot(&entries));
    }
    // The sidecar supplies its current snapshot so a long running active agent
    // remains updateable even after its last persisted update ages past startup
    // retention. Rust is still responsible for applying each mutation and saving it.

    let now = now_ms();
    let mut result = Value::Null;
    let mut changed = false;
    let mut cleaned = 0usize;
    let mut trimmed = 0usize;

    match operation {
        "register" => {
            let mut entry = request
                .get("entry")
                .and_then(Value::as_object)
                .cloned()
                .ok_or("Missing subagent entry")?;
            entry.insert("createdAt".into(), json!(now));
            entry.insert("updatedAt".into(), json!(now));
            let entry = Value::Object(entry);
            let agent_id = entry["agentId"].as_str().ok_or("Missing agent ID")?;
            if let Some(index) = entries
                .iter()
                .position(|current| current["agentId"].as_str() == Some(agent_id))
            {
                entries[index] = entry.clone();
            } else {
                entries.push(entry.clone());
            }
            result = entry;
            cleaned = cleanup(&mut entries, now);
            trimmed = trim_finished(&mut entries, MAX_FINISHED);
            changed = true;
        }
        "update" | "complete" | "abort" => {
            let agent_id = request["agentId"].as_str().ok_or("Missing agent ID")?;
            if let Some(index) = entries
                .iter()
                .position(|entry| entry["agentId"].as_str() == Some(agent_id))
            {
                let mut updates = request
                    .get("updates")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_else(Map::new);
                match operation {
                    "complete" => {
                        let error = request.get("error").filter(|value| {
                            !value.is_null() && value.as_str().is_none_or(|value| !value.is_empty())
                        });
                        updates.insert(
                            "status".into(),
                            json!(if error.is_some() {
                                "failed"
                            } else {
                                "completed"
                            }),
                        );
                        updates.insert("completedAt".into(), json!(now));
                        if let Some(result) = request.get("result").filter(|value| !value.is_null())
                        {
                            updates.insert("result".into(), result.clone());
                        } else {
                            updates.remove("result");
                        }
                        if let Some(error) = error {
                            updates.insert("error".into(), error.clone());
                        } else {
                            updates.remove("error");
                        }
                    }
                    "abort" => {
                        updates.insert("status".into(), json!("aborted"));
                        updates.insert("completedAt".into(), json!(now));
                    }
                    _ => {}
                }
                updates.insert("updatedAt".into(), json!(now));
                let updated = merge(&entries[index], &Value::Object(updates));
                entries[index] = updated.clone();
                result = updated;
                changed = true;
            }
        }
        "cleanup" => {
            cleaned = cleanup(&mut entries, now);
            changed = cleaned > 0;
            result = json!(cleaned);
        }
        "spawn_depth" => {
            let sponsor_key = request["sponsorSessionKey"].as_str();
            let sponsor = sponsor_key.and_then(|key| {
                entries
                    .iter()
                    .find(|entry| entry["sessionKey"].as_str() == Some(key))
            });
            let parent_depth = sponsor
                .and_then(|entry| entry["currentDepth"].as_f64())
                .unwrap_or(0.0);
            let current_depth = if parent_depth == 0.0 {
                1.0
            } else {
                parent_depth + 1.0
            };
            let error = sponsor
                .and_then(|entry| entry["maxDepth"].as_f64())
                .filter(|limit| current_depth > *limit)
                .map(|limit| format!("Maximum spawn depth ({limit}) exceeded"))
                .or_else(|| {
                    request["maxSpawnDepth"]
                        .as_f64()
                        .filter(|limit| current_depth > *limit)
                        .map(|limit| format!("Max spawn depth ceiling ({limit}) reached. Finish this task with your own tools."))
                })
                .or_else(|| {
                    request["maxGlobalDepth"]
                        .as_f64()
                        .filter(|limit| current_depth > *limit)
                        .map(|limit| format!("Maximum spawn depth ceiling ({limit}) reached to prevent recursion. Use a more direct task."))
                });
            result = json!({ "currentDepth": current_depth, "error": error });
        }
        "trim_finished" => {
            let max_finished = request["maxFinished"]
                .as_u64()
                .unwrap_or(MAX_FINISHED as u64) as usize;
            trimmed = trim_finished(&mut entries, max_finished);
            changed = trimmed > 0;
            result = json!(trimmed);
        }
        _ => return Err(format!("Unknown subagent registry operation: {operation}")),
    }

    if changed {
        save_entries(&entries)?;
    }
    Ok(json!({
        "result": result,
        "entries": snapshot(&entries),
        "cleaned": cleaned,
        "trimmed": trimmed
    }))
}
