use serde_json::{json, Value};
use std::path::Path;

#[test]
fn resolution_preserves_request_and_clears_pending_status() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let request = json!({"id": "req", "conversationId": "chat", "timestamp": "2026-01-01T00:00:00Z", "question": "Continue?"});
    save_request(root, &request).unwrap();
    assert_eq!(pending(root, Some("chat")).unwrap()["request"], request);
    resolve(root, &[json!("chat"), json!("req"), json!(false)]).unwrap();
    assert!(pending(root, Some("chat")).is_none());
    let record: Value =
        serde_json::from_slice(&std::fs::read(root.join("hitl/chat/req.json")).unwrap()).unwrap();
    assert_eq!(record["request"], request);
    assert_eq!(record["status"], "rejected");
    assert_eq!(record["response"]["approved"], false);
    let other =
        json!({"id": "req", "conversationId": "other", "timestamp": "2026-01-01T00:00:00Z"});
    save_request(root, &other).unwrap();
    assert_eq!(get(root, &json!("chat"), &json!("req")).unwrap(), record);
    delete_conversation(root, Some("chat")).unwrap();
    delete_conversation(root, Some("chat")).unwrap();
    assert!(get(root, &json!("chat"), &json!("req")).is_none());
    assert_eq!(pending(root, Some("other")).unwrap()["request"], other);
}

fn record_id(id: Option<&str>) -> Option<&str> {
    id.filter(|id| {
        !id.is_empty() && !id.contains(['/', '\\', ':', '\0']) && !matches!(*id, "." | "..")
    })
}

pub fn pending(directory: &Path, conversation: Option<&str>) -> Option<Value> {
    let record = list(directory, conversation)?.into_iter().next()?;
    (record["status"] == "pending").then_some(record)
}

pub fn list(directory: &Path, conversation: Option<&str>) -> Option<Vec<Value>> {
    let id = record_id(conversation)?;
    let root = super::guard::resolve_within(directory, &["hitl", id]).ok()?;
    let mut records = Vec::new();
    for entry in std::fs::read_dir(root).ok()? {
        let entry = entry.ok()?;
        if !entry.file_name().to_string_lossy().ends_with(".json")
            || !entry.file_type().ok()?.is_file()
        {
            continue;
        }
        let record: Value = serde_json::from_slice(&std::fs::read(entry.path()).ok()?).ok()?;
        let timestamp = record["request"]["timestamp"]
            .as_str()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
        records.push((timestamp, record));
    }
    records.sort_by(|a, b| b.0.cmp(&a.0));
    Some(records.into_iter().map(|(_, record)| record).collect())
}

pub fn resolve(directory: &Path, args: &[Value]) -> Result<Value, String> {
    let conversation =
        record_id(args.first().and_then(Value::as_str)).ok_or("Invalid conversation ID")?;
    let request_id =
        record_id(args.get(1).and_then(Value::as_str)).ok_or("Invalid approval request ID")?;
    let approved = args
        .get(2)
        .and_then(Value::as_bool)
        .ok_or("Expected an approval decision")?;
    let now = chrono::Utc::now();
    let timestamp = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    save_response(
        directory,
        &json!({
            "id": format!("resp-{}", now.timestamp_millis()),
            "requestId": request_id, "conversationId": conversation, "timestamp": timestamp,
            "approved": approved,
            "response": if approved { "[HITL_APPROVED]" } else { "[HITL_REJECTED]" }
        }),
    )
}

fn record_path(
    directory: &Path,
    conversation: &Value,
    request: &Value,
) -> Result<std::path::PathBuf, String> {
    let conversation = record_id(conversation.as_str()).ok_or("Invalid conversation ID")?;
    let request = record_id(request.as_str()).ok_or("Invalid approval request ID")?;
    super::guard::resolve_within(
        directory,
        &["hitl", conversation, &format!("{request}.json")],
    )
}

pub fn get(directory: &Path, conversation: &Value, request: &Value) -> Option<Value> {
    let file = record_path(directory, conversation, request).ok()?;
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

pub fn delete_conversation(directory: &Path, conversation: Option<&str>) -> Result<Value, String> {
    let id = record_id(conversation).ok_or("Invalid conversation ID")?;
    let root = super::guard::resolve_within(directory, &["hitl"])?;
    let path = root.join(id);
    let canonical = match std::fs::canonicalize(&path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(error) => return Err(error.to_string()),
    };
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    if canonical != root.join(id) {
        return Err("Approval directory resolves outside the selected conversation".into());
    }
    std::fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    Ok(Value::Null)
}

pub fn save_request(directory: &Path, request: &Value) -> Result<Value, String> {
    let file = record_path(directory, &request["conversationId"], &request["id"])?;
    let bytes = serde_json::to_vec_pretty(&json!({"request": request, "status": "pending"}))
        .map_err(|error| error.to_string())?;
    crate::store::atomic_write(&file, &bytes)?;
    Ok(Value::Null)
}

pub fn save_response(directory: &Path, response: &Value) -> Result<Value, String> {
    let conversation = &response["conversationId"];
    let request_id = &response["requestId"];
    let file = record_path(directory, conversation, request_id)?;
    let approved = response["approved"]
        .as_bool()
        .ok_or("Expected an approval decision")?;
    let mut record: Value = match std::fs::read(&file) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({
            "request": {"id": request_id, "conversationId": conversation, "timestamp": response["timestamp"],
                "question": "", "details": {"tools": [], "summary": "", "reasoning": ""}, "options": []}
        }),
        Err(error) => return Err(error.to_string()),
    };
    let fields = record.as_object_mut().ok_or("Invalid approval record")?;
    fields.insert("response".into(), response.clone());
    fields.insert(
        "status".into(),
        json!(if approved { "approved" } else { "rejected" }),
    );
    let bytes = serde_json::to_vec_pretty(&record).map_err(|error| error.to_string())?;
    crate::store::atomic_write(&file, &bytes)?;
    Ok(json!({"success": true}))
}
