//! Deterministic formatting and duplicate suppression for subagent results.

use serde_json::{json, Value};

fn utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

fn js_lowercase_prefix(value: &str, end: usize) -> Vec<u16> {
    let units = utf16(value);
    let units = &units[..units.len().min(end)];
    let mut lowered = Vec::with_capacity(units.len());
    let mut index = 0;
    while index < units.len() {
        let first = units[index];
        let (character, consumed) = if (0xD800..=0xDBFF).contains(&first)
            && units
                .get(index + 1)
                .is_some_and(|second| (0xDC00..=0xDFFF).contains(second))
        {
            let second = units[index + 1];
            let scalar = 0x10000 + (((first as u32 - 0xD800) << 10) | (second as u32 - 0xDC00));
            (char::from_u32(scalar), 2)
        } else if !(0xD800..=0xDFFF).contains(&first) {
            (char::from_u32(first as u32), 1)
        } else {
            (None, 1)
        };
        if let Some(character) = character {
            for lowercase in character.to_lowercase() {
                let mut buffer = [0; 2];
                lowered.extend_from_slice(lowercase.encode_utf16(&mut buffer));
            }
        } else {
            // JavaScript strings can contain an unpaired surrogate after substring.
            lowered.push(first);
        }
        index += consumed;
    }
    lowered
}

fn levenshtein(first: &[u16], second: &[u16]) -> usize {
    let mut previous: Vec<usize> = (0..=first.len()).collect();
    let mut current = vec![0; first.len() + 1];
    for (row, right) in second.iter().enumerate() {
        current[0] = row + 1;
        for (column, left) in first.iter().enumerate() {
            let substitution = previous[column] + if left != right { 1 } else { 0 };
            current[column + 1] = substitution
                .min(current[column] + 1)
                .min(previous[column + 1] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[first.len()]
}

fn similar(first: &[u16], second: &[u16]) -> bool {
    let (longer, shorter) = if first.len() > second.len() {
        (first, second)
    } else {
        (second, first)
    };
    if longer.is_empty() {
        return true;
    }
    let score = (longer.len() - levenshtein(longer, shorter)) as f64 / longer.len() as f64;
    score > 0.8
}

fn completed(result: &Value) -> bool {
    result["status"] == "completed"
        && result["result"]
            .as_str()
            .is_some_and(|content| !content.is_empty())
}

fn summary(results: &[Value], deduplicate: bool) -> String {
    let completed_results: Vec<&Value> =
        results.iter().filter(|result| completed(result)).collect();
    let failed_results: Vec<&Value> = results
        .iter()
        .filter(|result| result["status"] == "failed")
        .collect();
    let timed_out_results: Vec<&Value> = results
        .iter()
        .filter(|result| result["status"] == "timeout")
        .collect();

    if completed_results.is_empty() {
        let mut output = String::from("## Research Summary\n\nNo successful research results were obtained from subagents.\n\n");
        if !failed_results.is_empty() {
            output.push_str(&format!(
                "### Failed Subagents ({})\n",
                failed_results.len()
            ));
            for result in failed_results {
                let error = result["error"]
                    .as_str()
                    .filter(|error| !error.is_empty())
                    .unwrap_or("Unknown error");
                output.push_str(&format!(
                    "- **{}**: {error}\n",
                    result["subagentId"].as_str().unwrap_or("")
                ));
            }
            output.push('\n');
        }
        if !timed_out_results.is_empty() {
            output.push_str(&format!(
                "### Timed Out Subagents ({})\n",
                timed_out_results.len()
            ));
            for result in timed_out_results {
                output.push_str(&format!(
                    "- **{}**: Execution exceeded timeout limit\n",
                    result["subagentId"].as_str().unwrap_or("")
                ));
            }
            output.push('\n');
        }
        return output;
    }

    let mut unique_results: Vec<&Value> = Vec::new();
    let mut seen: Vec<Vec<u16>> = Vec::new();
    for result in &completed_results {
        let content = result["result"].as_str().unwrap_or_default();
        let hash = js_lowercase_prefix(content, 200);
        if !deduplicate || !seen.iter().any(|prior| similar(&hash, prior)) {
            if deduplicate {
                seen.push(hash);
            }
            unique_results.push(*result);
        }
    }

    let mut output = String::from("## Comprehensive Research Summary\n\n");
    output.push_str(&format!(
        "Based on parallel research conducted by {} subagent(s):\n\n",
        completed_results.len()
    ));
    for (index, result) in unique_results.iter().enumerate() {
        let duration = result["duration"].as_f64().unwrap_or(0.0) / 1000.0;
        let length = result["resultLength"].as_u64().unwrap_or(0);
        output.push_str(&format!("### Research Result {}\n", index + 1));
        output.push_str(&format!(
            "**Source**: {}\n",
            result["subagentId"].as_str().unwrap_or("")
        ));
        output.push_str(&format!("**Duration**: {duration:.2}s\n"));
        output.push_str(&format!("**Content Length**: {length} characters\n\n"));
        output.push_str(result["result"].as_str().unwrap_or_default());
        output.push_str("\n\n");
    }

    if !failed_results.is_empty() || !timed_out_results.is_empty() {
        output.push_str("---\n\n### Execution Summary\n");
        output.push_str(&format!(
            "- **Successful**: {}/{}\n",
            completed_results.len(),
            results.len()
        ));
        if !failed_results.is_empty() {
            output.push_str(&format!("- **Failed**: {}\n", failed_results.len()));
            for result in failed_results {
                let error = result["error"]
                    .as_str()
                    .filter(|error| !error.is_empty())
                    .unwrap_or("Unknown error");
                output.push_str(&format!(
                    "  - {}: {error}\n",
                    result["subagentId"].as_str().unwrap_or("")
                ));
            }
        }
        if !timed_out_results.is_empty() {
            output.push_str(&format!("- **Timed Out**: {}\n", timed_out_results.len()));
            for result in timed_out_results {
                output.push_str(&format!(
                    "  - {}: Exceeded timeout limit\n",
                    result["subagentId"].as_str().unwrap_or("")
                ));
            }
        }
    }
    output
}

pub(crate) fn dispatch(request: &Value) -> Result<Value, String> {
    match request["operation"].as_str().unwrap_or_default() {
        "summary" => {
            let results = request["results"]
                .as_array()
                .ok_or("Missing subagent results")?;
            Ok(json!(summary(
                results,
                request["deduplicate"].as_bool().unwrap_or(true)
            )))
        }
        "partial_failure" => {
            let result = &request["aggregationResult"];
            let completed = result["completedSubagents"].as_f64().unwrap_or(0.0);
            let total = result["totalSubagents"].as_f64().unwrap_or(0.0);
            let success_rate = if total == 0.0 {
                f64::NAN
            } else {
                completed / total
            };
            if success_rate >= 0.5 {
                Ok(result["summary"].clone())
            } else if request["fallbackTask"]
                .as_str()
                .is_some_and(|task| !task.is_empty())
            {
                Ok(json!(format!(
                    "\n## Research Partial Failure\n\nThe parallel research encountered issues:\n- Completed: {}/{}\n- Failed: {}\n- Timed Out: {}\n\n### Available Results\n{}\n\n### Recommendation\nConsider using single-agent research mode or adjusting the research parameters.\n",
                    result["completedSubagents"].as_u64().unwrap_or(0),
                    result["totalSubagents"].as_u64().unwrap_or(0),
                    result["failedSubagents"].as_u64().unwrap_or(0),
                    result["timedOutSubagents"].as_u64().unwrap_or(0),
                    result["summary"].as_str().unwrap_or_default()
                )))
            } else {
                Ok(result["summary"].clone())
            }
        }
        operation => Err(format!(
            "Unknown subagent aggregation operation: {operation}"
        )),
    }
}
