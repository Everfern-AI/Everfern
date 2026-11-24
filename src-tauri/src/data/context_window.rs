//! Context-window sizing, usage checks, token estimates, and compact-history selection.

use serde_json::{json, Value};

fn model_window(model: &str) -> u64 {
    let exact = [
        ("gpt-4o", 128_000),
        ("gpt-4o-mini", 128_000),
        ("gpt-4-turbo", 128_000),
        ("gpt-4", 8_192),
        ("o1-preview", 128_000),
        ("o1-mini", 128_000),
        ("o3-mini", 128_000),
        ("o1", 200_000),
        ("o3", 200_000),
        ("deepseek-v4-flash", 64_000),
        ("deepseek-v4-pro", 128_000),
        ("deepseek-coder", 16_000),
        ("gemini-1.5-pro", 1_000_000),
        ("gemini-1.5-flash", 1_000_000),
        ("gemini-2.0-flash", 1_000_000),
        ("gemini-2.5-pro", 1_000_000),
        ("llama-3.1-70b", 128_000),
        ("llama-3.1-8b", 128_000),
        ("fern-1", 128_000),
        ("fern-2", 200_000),
        ("everfern-pro", 200_000),
        ("everfern-lite", 128_000),
    ];
    if let Some((_, window)) = exact.iter().find(|(name, _)| *name == model) {
        return *window;
    }
    let lower = model.to_lowercase();
    if lower.contains("gemini") {
        return 1_000_000;
    }
    if lower.contains("claude") {
        return 200_000;
    }
    if lower.contains("deepseek") {
        return if lower.contains("flash") {
            64_000
        } else {
            128_000
        };
    }
    if ["gpt-4", "gpt-3.5", "o1", "o3", "llama-3.1"]
        .iter()
        .any(|name| lower.contains(name))
    {
        return 128_000;
    }
    if lower.starts_with("fern") || lower.starts_with("everfern") {
        return 128_000;
    }
    exact
        .iter()
        .find(|(name, _)| lower.contains(name))
        .map(|(_, window)| *window)
        .unwrap_or(128_000)
}

fn estimate_text(text: &str) -> u64 {
    (text.encode_utf16().count() as u64 + 3) / 4
}

fn estimate_messages(messages: &Value) -> Option<u64> {
    let messages = messages.as_array()?;
    let mut total = 0u64;
    for message in messages {
        total += 4;
        let Some(content) = message.get("content") else {
            continue;
        };
        match content {
            Value::String(text) => total = total.saturating_add(estimate_text(text)),
            Value::Array(blocks) => {
                for block in blocks {
                    if let Some(text) = block.get("text") {
                        let Some(text) = text.as_str() else {
                            return None;
                        };
                        total = total.saturating_add(estimate_text(text));
                    }
                }
            }
            _ => {}
        }
    }
    Some(total)
}

fn usage(request: &Value) -> Option<Value> {
    let max = request["config"]["modelContextWindow"]
        .as_f64()
        .unwrap_or(128_000.0);
    let margin = request["config"]["safetyMargin"].as_f64().unwrap_or(0.10);
    let used = request["tokens"].as_f64()?;
    let effective_max = (max * (1.0 - margin)).floor();
    let percentage = used / effective_max;
    let available = 0.0f64.max(effective_max - used);
    if !percentage.is_finite() || !available.is_finite() {
        return None;
    }
    Some(json!({ "used": used, "max": max, "percentage": percentage, "available": available }))
}

fn status(request: &Value) -> Option<Value> {
    let current = usage(request)?;
    let percentage = current["percentage"].as_f64()?;
    let warning = request["config"]["warningThreshold"]
        .as_f64()
        .unwrap_or(0.75);
    let hard = request["config"]["hardBlockThreshold"]
        .as_f64()
        .unwrap_or(0.90);
    let level = if percentage >= hard {
        "critical"
    } else if percentage >= warning {
        "warning"
    } else {
        "ok"
    };
    let message = if level == "critical" {
        format!(
            "Context window critically low ({}%). Compaction required.",
            (percentage * 100.0).round()
        )
    } else if level == "warning" {
        format!(
            "Context window running low ({}%). Consider compacting soon.",
            (percentage * 100.0).round()
        )
    } else {
        String::new()
    };
    Some(
        json!({ "allowed": level != "critical", "level": level, "usage": current, "message": message }),
    )
}

fn compact_history(history: &Value) -> Option<Value> {
    let history = history.as_array()?;
    if history.len() < 15 {
        return Some(Value::Array(history.clone()));
    }
    let start = history.len() - 10;
    let mut indexes: Vec<usize> = history
        .iter()
        .enumerate()
        .filter_map(|(index, message)| (message["role"] == "system").then_some(index))
        .collect();
    indexes.extend((start..history.len()).filter(|index| history[*index]["role"] != "system"));
    Some(Value::Array(
        indexes
            .into_iter()
            .map(|index| history[index].clone())
            .collect(),
    ))
}

pub fn dispatch(request: &Value) -> Value {
    match request["operation"].as_str().unwrap_or_default() {
        "model_window" => json!(model_window(request["model"].as_str().unwrap_or_default())),
        "estimate_text" => request["text"]
            .as_str()
            .map(|text| json!(estimate_text(text)))
            .unwrap_or(Value::Null),
        "estimate_messages" => estimate_messages(&request["messages"])
            .map(|tokens| json!(tokens))
            .unwrap_or(Value::Null),
        "usage" => usage(request).unwrap_or(Value::Null),
        "warning_level" => status(request)
            .map(|value| value["level"].clone())
            .unwrap_or(Value::Null),
        "status" => status(request).unwrap_or(Value::Null),
        "check" => {
            let Some(tokens) = estimate_messages(&request["messages"]) else {
                return Value::Null;
            };
            let Some(mut result) =
                status(&json!({ "config": request["config"], "tokens": tokens }))
            else {
                return Value::Null;
            };
            result["estimatedTokens"] = json!(tokens);
            result
        }
        "compact_history" => compact_history(&request["history"]).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}
