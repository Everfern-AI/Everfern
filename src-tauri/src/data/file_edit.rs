//! Text matching and replacement rules used by the agent's surgical edit tool.

use serde_json::{json, Value};

fn js_slice_150(text: &str) -> String {
    String::from_utf16_lossy(&text.encode_utf16().take(150).collect::<Vec<_>>())
}

fn replace_first(source: &str, needle: &str, replacement: &str) -> String {
    let Some(index) = source.find(needle) else {
        return source.to_string();
    };
    let mut result = String::with_capacity(source.len() - needle.len() + replacement.len());
    result.push_str(&source[..index]);
    result.push_str(replacement);
    result.push_str(&source[index + needle.len()..]);
    result
}

fn js_trim(value: &str) -> &str {
    value.trim_matches(|character: char| {
        matches!(
            character,
            '\u{0009}'
                | '\u{000A}'
                | '\u{000B}'
                | '\u{000C}'
                | '\u{000D}'
                | '\u{0020}'
                | '\u{00A0}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        )
    })
}

fn failure(content: &str, old: &str) -> Value {
    json!({
        "success": false,
        "updatedContent": content,
        "error": format!("Could not find target content in file:\n{}...", js_slice_150(old)),
    })
}

pub fn smart_replace(content: &str, old: &str, new: &str) -> Value {
    if old.is_empty() {
        return json!({
            "success": false,
            "updatedContent": content,
            "error": "Empty oldString provided. To create a new file or overwrite full content, use the write tool instead.",
        });
    }

    if content.contains(old) {
        return json!({ "success": true, "updatedContent": replace_first(content, old, new) });
    }

    let crlf = content.contains("\r\n");
    let normalized_content = content.replace("\r\n", "\n");
    let normalized_old = old.replace("\r\n", "\n");
    let normalized_new = new.replace("\r\n", "\n");
    if normalized_content.contains(&normalized_old) {
        let replaced = replace_first(&normalized_content, &normalized_old, &normalized_new);
        let updated = if crlf {
            replaced.replace('\n', "\r\n")
        } else {
            replaced
        };
        return json!({ "success": true, "updatedContent": updated });
    }

    let file_lines = normalized_content.split('\n').collect::<Vec<_>>();
    let old_lines = normalized_old.split('\n').collect::<Vec<_>>();
    if !old_lines.is_empty() {
        let first = js_trim(old_lines[0]);
        let last = js_trim(old_lines[old_lines.len() - 1]);
        if old_lines.len() <= file_lines.len() {
            for start in 0..=file_lines.len() - old_lines.len() {
                if js_trim(file_lines[start]) != first
                    || js_trim(file_lines[start + old_lines.len() - 1]) != last
                {
                    continue;
                }
                if file_lines[start..start + old_lines.len()]
                    .iter()
                    .zip(&old_lines)
                    .all(|(actual, expected)| js_trim(actual) == js_trim(expected))
                {
                    let mut updated_lines = file_lines
                        .iter()
                        .map(|line| (*line).to_string())
                        .collect::<Vec<_>>();
                    let new_lines = normalized_new
                        .split('\n')
                        .map(str::to_string)
                        .collect::<Vec<_>>();
                    updated_lines.splice(start..start + old_lines.len(), new_lines);
                    let separator = if crlf { "\r\n" } else { "\n" };
                    return json!({ "success": true, "updatedContent": updated_lines.join(separator) });
                }
            }
        }
    }

    let trimmed_old = js_trim(old);
    if trimmed_old.encode_utf16().count() > 5 {
        let lines = normalized_content.split('\n').collect::<Vec<_>>();
        let matches = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| js_trim(line) == trimmed_old)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if matches.len() == 1 {
            let index = matches[0];
            let replacement = js_trim(new);
            let replaced = replace_first(lines[index], trimmed_old, replacement);
            let mut lines = lines
                .iter()
                .map(|line| (*line).to_string())
                .collect::<Vec<_>>();
            lines[index] = replaced;
            let separator = if crlf { "\r\n" } else { "\n" };
            return json!({ "success": true, "updatedContent": lines.join(separator) });
        }
    }

    failure(content, old)
}

pub fn dispatch(request: &Value) -> Result<Value, String> {
    let content = request["content"].as_str().ok_or("Expected file content")?;
    if request["operation"] == "batch" {
        let edits = request["edits"].as_array().ok_or("Expected edit chunks")?;
        let mut updated = content.to_string();
        let mut results = Vec::with_capacity(edits.len());
        for edit in edits {
            let old = edit["oldString"].as_str().unwrap_or_default();
            let new = edit["newString"].as_str().unwrap_or_default();
            let result = smart_replace(&updated, old, new);
            if result["success"] == true {
                updated = result["updatedContent"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
            }
            results.push(result);
        }
        Ok(json!({ "updatedContent": updated, "results": results }))
    } else {
        let old = request["oldString"].as_str().unwrap_or_default();
        let new = request["newString"].as_str().unwrap_or_default();
        Ok(smart_replace(content, old, new))
    }
}
