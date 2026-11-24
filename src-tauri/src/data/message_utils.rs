//! LangChain message normalization and context-saving history consolidation.

use serde_json::{json, Map, Value};

fn truthy(value: Option<&Value>) -> bool {
    super::db::truthy(value)
}

fn first_truthy<'a>(message: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| message.get(*key))
        .find(|value| truthy(Some(value)))
}

fn js_or<'a>(message: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let mut last = None;
    for key in keys {
        last = message.get(*key);
        if last.is_some_and(|value| truthy(Some(value))) {
            return last;
        }
    }
    last
}

fn tool_call_id(message: &Value) -> Option<&Value> {
    let snake_case = message.get("tool_call_id");
    let camel_case = message.get("toolCallId");
    if snake_case.is_some_and(|value| truthy(Some(value))) {
        return snake_case;
    }
    if camel_case.is_some_and(|value| truthy(Some(value))) {
        return camel_case;
    }
    snake_case
}

fn message_type(message: &Value) -> Option<&str> {
    first_truthy(message, &["type"]).and_then(Value::as_str)
}

fn normalize_message(message: &Value) -> Value {
    let tool_id = tool_call_id(message);
    let role = message.get("role");
    let kind = message_type(message);
    let is_tool = role.and_then(Value::as_str) == Some("tool") || kind == Some("tool");
    let pseudo = tool_id
        .and_then(Value::as_str)
        .is_some_and(|id| matches!(id, "harness_recovery" | "harness_rollback"));
    if is_tool && pseudo {
        let content = match message.get("content") {
            Some(Value::String(content)) => content.clone(),
            Some(content) if truthy(Some(content)) => {
                serde_json::to_string(content).unwrap_or_default()
            }
            _ => "\"\"".into(),
        };
        return json!({"role":"system", "content":content});
    }

    let standard = truthy(role) && message.get("content").is_some();
    let normalized_role = if standard {
        role.cloned().unwrap_or(Value::Null)
    } else {
        match kind {
            Some("human") => json!("user"),
            Some("ai") => json!("assistant"),
            Some("system") => json!("system"),
            Some("tool") => json!("tool"),
            _ => match role.and_then(Value::as_str) {
                Some("user") => json!("user"),
                Some("assistant") => json!("assistant"),
                Some("system") => json!("system"),
                Some("tool") => json!("tool"),
                _ => json!("user"),
            },
        }
    };
    let mut output = Map::new();
    output.insert("role".into(), normalized_role);
    if let Some(content) = message.get("content") {
        let content = if standard || truthy(Some(content)) {
            content.clone()
        } else {
            json!("")
        };
        output.insert("content".into(), content);
    } else if !standard {
        output.insert("content".into(), json!(""));
    }
    if let Some(value) = js_or(message, &["name", "tool_name", "toolName"]) {
        output.insert("name".into(), value.clone());
    }
    if let Some(value) = tool_id {
        output.insert("tool_call_id".into(), value.clone());
    }
    if let Some(value) = js_or(message, &["tool_calls", "toolCalls"]) {
        output.insert("tool_calls".into(), value.clone());
    }
    if let Some(value) = js_or(message, &["reasoning_content", "thought"]) {
        output.insert("reasoning_content".into(), value.clone());
    }
    Value::Object(output)
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

fn is_failure(content: &str) -> bool {
    let lower = content.to_lowercase();
    lower.contains("failed") || lower.contains("error") || lower.contains("exit code: 1")
}

fn truncate_tool_logs(message: &Value) -> Value {
    if message["role"] != "tool" {
        return message.clone();
    }
    let Some(content) = message["content"].as_str() else {
        return message.clone();
    };
    let name = message["name"].as_str().unwrap_or_default();
    let terminal = [
        "run_command",
        "terminal_execute",
        "executePwsh",
        "command_status",
    ]
    .contains(&name);
    let length = utf16_len(content);
    if !terminal || length <= 2000 {
        return message.clone();
    }
    let lower = content.to_lowercase();
    let failure = [
        "error",
        "failed",
        "exception",
        "exit code: 1",
        "exit code: 2",
    ]
    .iter()
    .any(|needle| lower.contains(needle));
    let replacement = if !failure {
        format!(
            "{}\n\n... [Truncated {} characters of successful output logs] ...\n\n{}",
            utf16_slice(content, 0, 600),
            length - 1200,
            utf16_slice(content, length - 600, length)
        )
    } else if length > 8000 {
        format!(
            "{}\n\n... [Truncated {} characters of long error logs] ...\n\n{}",
            utf16_slice(content, 0, 1000),
            length - 4000,
            utf16_slice(content, length - 3000, length)
        )
    } else {
        return message.clone();
    };
    let mut message = message.clone();
    message["content"] = json!(replacement);
    message
}

fn one_tool_call(message: &Value) -> Option<&Value> {
    let calls = message["tool_calls"].as_array()?;
    (message["role"] == "assistant" && calls.len() == 1).then(|| &calls[0])
}

fn consolidate_history(messages: &[Value]) -> Value {
    if messages.is_empty() {
        return json!(messages);
    }
    let processed: Vec<Value> = messages.iter().map(truncate_tool_logs).collect();
    let mut consolidated = Vec::new();
    let mut index = 0usize;
    while index < processed.len() {
        let first = &processed[index];
        let paired = one_tool_call(first)
            .filter(|_| index + 1 < processed.len() && processed[index + 1]["role"] == "tool");
        if let Some(call) = paired {
            let result = &processed[index + 1];
            let is_failed = result["content"].as_str().is_some_and(is_failure);
            if is_failed {
                let tool_name = &call["name"];
                let mut scan = index + 2;
                let mut success_index = None;
                while scan + 1 < processed.len() {
                    let next_call = one_tool_call(&processed[scan]);
                    if let Some(next_call) = next_call {
                        if next_call["name"] == *tool_name && processed[scan + 1]["role"] == "tool"
                        {
                            let next_failure = processed[scan + 1]["content"]
                                .as_str()
                                .is_some_and(is_failure);
                            if !next_failure {
                                success_index = Some(scan);
                                break;
                            }
                        }
                    }
                    scan += 1;
                }
                if let Some(success_index) = success_index {
                    let retries = (success_index - index) as f64 / 2.0;
                    let name = tool_name.as_str().unwrap_or("undefined");
                    consolidated.push(json!({"role":"system", "content":format!("[System Memory Consolidation: {retries} intermediate attempts of tool \"{name}\" failed with errors before succeeding. Failed logs collapsed to preserve context budget.]" )}));
                    index = success_index;
                    continue;
                }
            }
        }
        consolidated.push(first.clone());
        index += 1;
    }
    Value::Array(consolidated)
}

fn normalize_messages(messages: &[Value]) -> Value {
    let normalized: Vec<Value> = messages
        .iter()
        .filter(|message| {
            let metadata = if truthy(message.get("metadata")) {
                message.get("metadata")
            } else {
                message.get("_metadata")
            };
            metadata
                .and_then(|value| value.get("isNarrative"))
                .and_then(Value::as_bool)
                != Some(true)
        })
        .map(normalize_message)
        .collect();
    consolidate_history(&normalized)
}

pub fn dispatch(request: &Value) -> Value {
    match request["operation"].as_str().unwrap_or_default() {
        "normalize_message" => request
            .get("message")
            .map(normalize_message)
            .unwrap_or(Value::Null),
        "normalize_messages" => request["messages"]
            .as_array()
            .map(|messages| normalize_messages(messages))
            .unwrap_or(Value::Null),
        "consolidate_history" => request["messages"]
            .as_array()
            .map(|messages| consolidate_history(messages))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}
