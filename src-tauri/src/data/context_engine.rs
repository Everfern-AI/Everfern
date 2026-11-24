//! Deterministic context assembly and multi-pass compaction used by the agent.

use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

static DISTILL_ERRORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:error|fail|exception|fatal|traceback)[^\n]*").unwrap());
static THINK_BLOCKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?is)<think>[\s\S]*?</think>|<thought>[\s\S]*?</thought>|\[thought\][\s\S]*?\[/thought\]",
    )
    .unwrap()
});

fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn js_slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

fn truthy(value: Option<&Value>) -> bool {
    super::db::truthy(value)
}

fn or<'a>(values: impl IntoIterator<Item = Option<&'a Value>>) -> Option<&'a Value> {
    let mut last = None;
    for value in values {
        last = value;
        if truthy(value) {
            return value;
        }
    }
    last
}

fn estimate_text(text: &str) -> u64 {
    ((js_len(text) + 3) / 4) as u64
}

fn json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".into())
}

fn estimate_messages(messages: &[Value]) -> u64 {
    let mut total = 0u64;
    for message in messages {
        total += 4;
        match message.get("content") {
            Some(Value::String(content)) => total = total.saturating_add(estimate_text(content)),
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    if !block.is_object() {
                        continue;
                    }
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        total = total.saturating_add(estimate_text(text));
                    } else if block.get("image_url").is_some() {
                        total += 85;
                    }
                }
            }
            _ => {}
        }
        if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
            for call in tool_calls {
                let name = or([
                    call.get("name"),
                    call.get("function").and_then(|f| f.get("name")),
                ])
                .and_then(Value::as_str)
                .unwrap_or_default();
                let raw_args = [
                    call.get("arguments"),
                    call.get("args"),
                    call.get("function").and_then(|f| f.get("arguments")),
                ]
                .into_iter()
                .flatten()
                .find(|value| truthy(Some(value)))
                .cloned()
                .unwrap_or_else(|| json!({}));
                let args = raw_args
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| json_string(&raw_args));
                total = total
                    .saturating_add(estimate_text(&format!("{name}{args}")))
                    .saturating_add(6);
            }
        }
    }
    total
}

fn distill_tool_output(content: &str, max_chars: usize, preserve_errors: bool) -> String {
    let original_len = js_len(content);
    if original_len <= max_chars {
        return content.to_string();
    }
    let has_errors = preserve_errors
        && Regex::new(r"(?i)error|fail|exception|fatal|traceback|cannot find")
            .unwrap()
            .is_match(content);
    let head_chars = ((max_chars as f64) * 0.45).floor() as usize;
    let tail_chars = head_chars;
    let head = js_slice(content, 0, head_chars);
    let tail = js_slice(
        content,
        original_len.saturating_sub(tail_chars),
        original_len,
    );
    let error_snippet = if has_errors {
        let matches: Vec<String> = DISTILL_ERRORS
            .find_iter(content)
            .take(3)
            .map(|m| m.as_str().to_string())
            .collect();
        if matches.is_empty() {
            String::new()
        } else {
            format!("\n  [Extracted Error Context: {}]", matches.join("; "))
        }
    } else {
        String::new()
    };
    format!("{head}\n\n... [Tool Output Distilled: {} chars compressed to save tokens{error_snippet}] ...\n\n{tail}", original_len.saturating_sub(head_chars + tail_chars))
}

fn strip_thinking(content: &str) -> String {
    let clean = THINK_BLOCKS.replace_all(content, "");
    clean
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .to_string()
}

fn tool_name(call: &Value, fallback: &str) -> String {
    or([
        call.get("name"),
        call.get("function").and_then(|f| f.get("name")),
    ])
    .and_then(Value::as_str)
    .unwrap_or(fallback)
    .to_string()
}

fn tool_arguments(call: &Value) -> Value {
    or([
        call.get("arguments"),
        call.get("args"),
        call.get("function").and_then(|f| f.get("arguments")),
    ])
    .cloned()
    .unwrap_or_else(|| json!({}))
}

fn summarize_turn_history(messages: &[Value]) -> String {
    let mut user_queries = Vec::new();
    let mut file_actions = Vec::new();
    let mut command_actions = Vec::new();
    let mut assistant_summary = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or_default();
        if role == "user" {
            if let Some(content) = message["content"].as_str() {
                if !content.is_empty() && !content.starts_with('[') {
                    user_queries.push(js_slice(content, 0, 150));
                }
            }
        } else if role == "assistant" {
            if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let name = tool_name(call, "tool");
                    let raw_args = tool_arguments(call);
                    let args = if let Some(raw) = raw_args.as_str() {
                        serde_json::from_str::<Value>(raw).unwrap_or_else(|_| json!({"raw":raw}))
                    } else if raw_args.is_object() {
                        raw_args
                    } else {
                        json!({})
                    };
                    if [
                        "write_to_file",
                        "replace_file_content",
                        "multi_replace_file_content",
                    ]
                    .contains(&name.as_str())
                    {
                        let target = or([
                            args.get("TargetFile"),
                            args.get("targetFile"),
                            args.get("path"),
                        ])
                        .and_then(Value::as_str)
                        .unwrap_or("file");
                        let file_name = target.split(['/', '\\']).last().unwrap_or(target);
                        file_actions.push(format!("Modified {file_name}"));
                    } else if ["run_command", "execute_command"].contains(&name.as_str()) {
                        if let Some(command) = or([
                            args.get("CommandLine"),
                            args.get("command"),
                            args.get("cmd"),
                        ])
                        .and_then(Value::as_str)
                        {
                            if !command.is_empty() {
                                command_actions
                                    .push(format!("Executed: {}", js_slice(command, 0, 60)));
                            }
                        }
                    }
                }
            } else if let Some(content) = message["content"].as_str() {
                if !content.trim().is_empty() {
                    let clean = strip_thinking(content);
                    if !clean.is_empty() {
                        assistant_summary.push(js_slice(&clean, 0, 180));
                    }
                }
            }
        }
    }
    let mut sections = Vec::new();
    if !user_queries.is_empty() {
        sections.push(format!(
            "- User Objectives: {}",
            user_queries
                .iter()
                .rev()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    if !file_actions.is_empty() {
        let mut unique = Vec::new();
        for action in file_actions {
            if !unique.contains(&action) {
                unique.push(action);
            }
        }
        sections.push(format!(
            "- Files Touched: {}",
            unique
                .iter()
                .rev()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !command_actions.is_empty() {
        sections.push(format!(
            "- Commands Run: {}",
            command_actions
                .iter()
                .rev()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }
    if !assistant_summary.is_empty() {
        sections.push(format!(
            "- Assistant Progress: {}",
            assistant_summary
                .iter()
                .rev()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    sections.join("\n")
}

fn dag_summary(nodes: &[Value]) -> String {
    if nodes.is_empty() {
        return String::new();
    }
    let mut lines = vec!["### DAG Execution Graph Lineage State".to_string()];
    for node in nodes {
        let status = node["status"].as_str().unwrap_or_default();
        let icon = match status {
            "completed" => "✅",
            "running" => "⏳",
            "failed" => "❌",
            "skipped" => "⏭️",
            _ => "⏹️",
        };
        let suffix = if truthy(node.get("summary")) {
            format!(": {}", node["summary"].as_str().unwrap_or_default())
        } else {
            String::new()
        };
        lines.push(format!(
            "- {icon} **Node [{}] ({})** - {}{suffix}",
            node["nodeId"].as_str().unwrap_or_default(),
            node["nodeName"].as_str().unwrap_or_default(),
            status.to_uppercase()
        ));
    }
    lines.join("\n")
}

fn option_f64(options: &Value, key: &str, default: f64) -> f64 {
    options.get(key).and_then(Value::as_f64).unwrap_or(default)
}
fn option_usize(options: &Value, key: &str, default: usize) -> usize {
    options
        .get(key)
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(default)
}
fn preserve_errors(options: &Value, default: bool) -> bool {
    options
        .get("preserveErrors")
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

fn observation_distillation(
    messages: &[Value],
    preserve_recent: f64,
    options: &Value,
    default_max: usize,
) -> Vec<Value> {
    let threshold = messages.len() as f64 - preserve_recent;
    messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            if (index as f64) >= threshold {
                return message.clone();
            }
            let mut next = message.clone();
            if message["role"] == "tool" {
                if let Some(content) = message["content"].as_str() {
                    next["content"] = json!(distill_tool_output(
                        content,
                        option_usize(options, "maxToolOutputChars", default_max),
                        preserve_errors(options, true)
                    ));
                }
            }
            if message["role"] == "assistant" {
                if let Some(content) = message["content"].as_str() {
                    next["content"] = json!(strip_thinking(content));
                }
            }
            next
        })
        .collect()
}

fn slice_recent(messages: &[Value], preserve_recent: f64) -> Vec<Value> {
    let length = messages.len() as f64;
    let start = if preserve_recent >= 0.0 {
        (length - preserve_recent).max(0.0)
    } else {
        (-preserve_recent).max(0.0)
    };
    let start = (start.trunc() as usize).min(messages.len());
    messages[start..].to_vec()
}

fn slice_old(messages: &[Value], preserve_recent: f64) -> Vec<Value> {
    let length = messages.len() as f64;
    let raw_end = length - preserve_recent;
    let end = if raw_end >= 0.0 {
        raw_end.min(length)
    } else {
        (length + raw_end).max(0.0)
    };
    let end = (end.trunc() as usize).min(messages.len());
    messages[..end].to_vec()
}

fn inject_summary(
    system: &[Value],
    conversation: &[Value],
    summary: &str,
    preserve_recent: f64,
) -> Vec<Value> {
    let recent = slice_recent(conversation, preserve_recent);
    let summary_message = json!({"role":"system", "content":format!(
        "## CONTEXT COMPACTION SUMMARY (Compressed Historical Turns)\nThe following is a structured summary of execution turns prior to recent messages:\n\n{summary}\n"
    )});
    system
        .iter()
        .cloned()
        .chain(std::iter::once(summary_message))
        .chain(recent)
        .collect()
}

fn compact(messages: &[Value], budget: f64, options: &Value) -> Value {
    if messages.is_empty() {
        return json!({"ok":true,"compacted":false,"reason":"No messages to compact"});
    }
    let initial_tokens = estimate_messages(messages);
    let preserve_recent = option_f64(options, "preserveRecentTurnCount", 6.0);
    let system: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"] == "system")
        .cloned()
        .collect();
    let conversation: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"] != "system")
        .cloned()
        .collect();
    let mut stage1 = Vec::with_capacity(conversation.len());
    let threshold = conversation.len() as f64 - preserve_recent;
    for (index, message) in conversation.iter().enumerate() {
        let recent = index as f64 >= threshold;
        let mut next = message.clone();
        if !recent && message["role"] == "assistant" {
            if let Some(content) = message["content"].as_str() {
                next["content"] = json!(strip_thinking(content));
            }
        }
        if !recent && message["role"] == "tool" {
            if let Some(content) = message["content"].as_str() {
                let distillation = options.get("distillation").unwrap_or(&Value::Null);
                next["content"] = json!(distill_tool_output(
                    content,
                    option_usize(distillation, "maxToolOutputChars", 600),
                    preserve_errors(distillation, true)
                ));
            }
        }
        if !recent && message["role"] == "assistant" {
            if let Some(calls) = message["tool_calls"].as_array() {
                let mut next_calls = Vec::with_capacity(calls.len());
                for call in calls {
                    if !call.is_object() {
                        next_calls.push(call.clone());
                        continue;
                    }
                    let mut cloned = call.clone();
                    if truthy(call.get("arguments")) {
                        let raw = call["arguments"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| json_string(&call["arguments"]));
                        if js_len(&raw) > 500 {
                            cloned["arguments"] = json!(format!(
                                "{}... [Arguments Truncated]",
                                js_slice(&raw, 0, 250)
                            ));
                        }
                    } else if truthy(call.get("function").and_then(|f| f.get("arguments"))) {
                        let argument = &call["function"]["arguments"];
                        let raw = argument
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| json_string(argument));
                        if js_len(&raw) > 500 {
                            cloned["function"]["arguments"] = json!(format!(
                                "{}... [Arguments Truncated]",
                                js_slice(&raw, 0, 250)
                            ));
                        }
                    }
                    next_calls.push(cloned);
                }
                next["tool_calls"] = Value::Array(next_calls);
            }
        }
        stage1.push(next);
    }
    let mut assembled: Vec<Value> = system.iter().cloned().chain(stage1).collect();
    let mut current_tokens = estimate_messages(&assembled);
    let target_ratio = option_f64(options, "targetBudgetRatio", 0.75);
    let mut summary = String::new();
    if current_tokens as f64 > budget * target_ratio
        && (conversation.len() as f64) > preserve_recent + 2.0
    {
        summary = summarize_turn_history(&slice_old(&conversation, preserve_recent));
        assembled = inject_summary(&system, &conversation, &summary, preserve_recent);
        current_tokens = estimate_messages(&assembled);
    }
    let freed_tokens = initial_tokens.saturating_sub(current_tokens);
    let mut result = json!({
        "ok":true,
        "compacted":freed_tokens > 0,
        "freedTokens":freed_tokens,
        "reason":if summary.is_empty() { "Distillation completed" } else { "Multi-pass compaction & turn summarization completed" },
        "result":{"tokensBefore":initial_tokens,"tokensAfter":current_tokens},
        "messages":assembled
    });
    if !summary.is_empty() {
        result["result"]["summary"] = json!(summary);
    }
    result
}

fn assemble(request: &Value) -> Value {
    let params = &request["params"];
    let messages = params["messages"].as_array().cloned().unwrap_or_default();
    if messages.is_empty() {
        return json!({"messages":[],"estimatedTokens":0});
    }
    let budget = params["tokenBudget"].as_f64().unwrap_or(100_000.0);
    let options = params.get("options").unwrap_or(&Value::Null);
    let preserve_recent = option_f64(options, "preserveRecentTurnCount", 6.0);
    let ratio = option_f64(options, "targetBudgetRatio", 0.75);
    let effective_budget = (budget * ratio).floor();
    let system: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"] == "system")
        .cloned()
        .collect();
    let conversation: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"] != "system")
        .cloned()
        .collect();
    let nodes = params["dagNodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let dag = dag_summary(nodes);
    let system_addition = if dag.is_empty() {
        Value::Null
    } else {
        json!(format!("\n\n{dag}\n"))
    };
    let input_tokens = estimate_messages(&messages);
    if (input_tokens as f64) <= effective_budget {
        let distilled = observation_distillation(
            &conversation,
            preserve_recent,
            options.get("distillation").unwrap_or(&Value::Null),
            800,
        );
        let assembled: Vec<Value> = system.iter().cloned().chain(distilled).collect();
        let tokens = estimate_messages(&assembled);
        let mut result = json!({"messages":assembled,"estimatedTokens":tokens,"compactionInfo":{"wasCompacted":false}});
        if !system_addition.is_null() {
            result["systemPromptAddition"] = system_addition;
            result["dagContextSummary"] = json!(dag);
        }
        return result;
    }
    let compact_result = compact(&messages, budget, options);
    let summary = compact_result["result"]["summary"]
        .as_str()
        .unwrap_or_default();
    let final_messages = if !summary.is_empty() {
        inject_summary(&system, &conversation, summary, preserve_recent)
    } else {
        compact_result["messages"]
            .as_array()
            .cloned()
            .unwrap_or(messages)
    };
    let tokens = estimate_messages(&final_messages);
    let mut result = json!({"messages":final_messages,"estimatedTokens":tokens,"compactionInfo":{"wasCompacted":true,"freedTokens":compact_result["freedTokens"].as_u64().unwrap_or(0)}});
    if !system_addition.is_null() {
        result["systemPromptAddition"] = system_addition;
        result["dagContextSummary"] = json!(dag);
    }
    result
}

fn js_args(request: &Value) -> Value {
    request.get("args").cloned().unwrap_or(Value::Null)
}

pub fn dispatch(request: &Value) -> Value {
    let args = js_args(request);
    match request["operation"].as_str().unwrap_or_default() {
        "estimate_messages" => json!(estimate_messages(
            args["messages"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
        )),
        "distill_tool_output" => json!(distill_tool_output(
            args["content"].as_str().unwrap_or_default(),
            args["maxChars"].as_u64().unwrap_or(800) as usize,
            args["preserveErrors"].as_bool().unwrap_or(true)
        )),
        "strip_thinking_blocks" => {
            json!(strip_thinking(args["content"].as_str().unwrap_or_default()))
        }
        "summarize_turn_history" => json!(summarize_turn_history(
            args["messages"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
        )),
        "format_dag_summary" => json!(dag_summary(
            args["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[])
        )),
        "compact" => compact(
            args["messages"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            args["tokenBudget"].as_f64().unwrap_or(100_000.0),
            args.get("options").unwrap_or(&Value::Null),
        ),
        "assemble" => assemble(request),
        _ => Value::Null,
    }
}
