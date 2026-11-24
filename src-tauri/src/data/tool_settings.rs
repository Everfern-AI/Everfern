use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

pub fn list_synthesized(directory: &Path) -> Result<Value, String> {
    let directory = super::guard::resolve_within(directory, &["dynamic-tools"])?;
    let files = match std::fs::read_dir(&directory) {
        Ok(files) => files,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!([])),
        Err(error) => return Err(error.to_string()),
    };
    let mut files: Vec<_> = files.filter_map(Result::ok).collect();
    files.sort_by_key(|file| file.file_name());
    let entries: Vec<_> = files
        .into_iter()
        .filter_map(|file| {
            let path = file.path();
            if !file.file_name().to_string_lossy().ends_with(".json")
                || !file.file_type().ok()?.is_file()
            {
                return None;
            }
            let bytes = std::fs::read(path).ok()?;
            let record: Value = serde_json::from_slice(&bytes).ok()?;
            if record.is_null() {
                return None;
            }
            let mut entry = json!({"status": "approved"});
            for key in ["name", "description", "parameters", "code"] {
                if let Some(value) = record.get(key) {
                    entry[key] = value.clone();
                }
            }
            Some(entry)
        })
        .collect();
    Ok(json!(entries))
}

pub fn delete_synthesized(directory: &Path, name: Option<&str>) -> Result<(), String> {
    let [active, pending] = synthesized_paths(directory, name)?;
    let _lock = lock_synthesized_store(directory)?;
    for path in [active, pending] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn lock_synthesized_store(directory: &Path) -> Result<std::fs::File, String> {
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("dynamic-tools.lock"))
        .map_err(|error| error.to_string())?;
    file.lock().map_err(|error| error.to_string())?;
    Ok(file)
}

fn synthesized_paths(
    directory: &Path,
    name: Option<&str>,
) -> Result<[std::path::PathBuf; 2], String> {
    let name = name
        .filter(|name| !name.is_empty() && !name.contains(['/', '\\', ':', '\0']))
        .ok_or("Invalid synthesized tool name")?;
    let filename = format!("{name}.json");
    let root = directory.join("dynamic-tools");
    let paths = [root.join(&filename), root.join("pending").join(&filename)];
    super::guard::resolve_within(directory, &["dynamic-tools", &filename])?;
    super::guard::resolve_within(directory, &["dynamic-tools", "pending", &filename])?;
    Ok(paths)
}

pub fn approve_synthesized(directory: &Path, name: Option<&str>) -> Result<Value, String> {
    let [active, pending] = synthesized_paths(directory, name)?;
    let _lock = lock_synthesized_store(directory)?;
    let bytes = std::fs::read(&pending).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("Pending tool not found: {}", name.unwrap_or_default())
        } else {
            error.to_string()
        }
    })?;
    let record = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    std::fs::rename(pending, active).map_err(|error| error.to_string())?;
    Ok(record)
}

pub fn save_pending_synthesized(directory: &Path, record: &Value) -> Result<(), String> {
    let [_, pending] = synthesized_paths(directory, record["name"].as_str())?;
    let _lock = lock_synthesized_store(directory)?;
    let bytes = serde_json::to_vec_pretty(record).map_err(|error| error.to_string())?;
    crate::store::atomic_write(&pending, &bytes)
}

#[test]
fn synthesized_tool_store_lists_approved_and_deletes_both_records() {
    let dir = tempfile::tempdir().unwrap();
    let tools = dir.path().join("dynamic-tools");
    let pending = tools.join("pending");
    let proposal = json!({"name": "example", "description": "An example"});
    save_pending_synthesized(dir.path(), &proposal).unwrap();
    assert_eq!(list_synthesized(dir.path()).unwrap(), json!([]));
    assert_eq!(
        approve_synthesized(dir.path(), Some("example")).unwrap(),
        proposal
    );
    assert!(!pending.join("example.json").exists());
    save_pending_synthesized(dir.path(), &proposal).unwrap();
    std::fs::write(tools.join("malformed.json"), "{").unwrap();
    assert_eq!(
        list_synthesized(dir.path()).unwrap(),
        json!([
            {"name": "example", "description": "An example", "status": "approved"}
        ])
    );
    assert_eq!(
        approve_synthesized(dir.path(), Some("example")).unwrap(),
        proposal
    );
    save_pending_synthesized(dir.path(), &proposal).unwrap();
    assert!(delete_synthesized(dir.path(), Some("invalid/name")).is_err());
    delete_synthesized(dir.path(), Some("example")).unwrap();
    delete_synthesized(dir.path(), Some("example")).unwrap();
    assert!(!pending.join("example.json").exists());
    assert_eq!(list_synthesized(dir.path()).unwrap(), json!([]));
}

fn defaults() -> Value {
    serde_json::from_str(include_str!("tool-settings.json")).expect("valid tool settings defaults")
}

fn load(path: &Path) -> Result<Value, String> {
    let mut settings = defaults();
    let input = match std::fs::read(path) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(settings),
        Err(error) => return Err(error.to_string()),
    };
    if let Ok(Value::Object(saved)) = serde_json::from_slice(&input) {
        let sections = settings.as_object_mut().expect("settings object");
        for (name, value) in saved {
            match sections.get_mut(&name).and_then(Value::as_object_mut) {
                Some(section) => {
                    if let Value::Object(fields) = value {
                        section.extend(fields);
                    }
                }
                None => {
                    sections.insert(name, value);
                }
            }
        }
    }
    settings["navis"]["useIsolatedBrowser"] = json!(false);
    settings["navis"]["useChromeProfile"] = json!(true);
    settings["navis"]["automationMode"] = json!("extension-first");
    Ok(settings)
}

pub fn dispatch(channel: &str, config: Option<&Value>) -> Result<Value, String> {
    let _guard = SETTINGS_LOCK.lock().map_err(|error| error.to_string())?;
    let path = super::home()?.join(".everfern").join("tool-settings.json");
    match channel {
        "tool-settings:get" => load(&path),
        "tool-settings:set" => {
            let config = config
                .filter(|value| value.is_object())
                .ok_or("Expected tool settings object")?;
            save(&path, config)?;
            Ok(json!({"success": true}))
        }
        "tool-settings:reset" => {
            save(&path, &defaults())?;
            Ok(json!({"success": true}))
        }
        _ => Err("Unknown tool settings operation".into()),
    }
}

fn save(path: &Path, config: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    crate::store::atomic_write(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_existing_settings_with_defaults_and_preserves_custom_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tool-settings.json");
        assert_eq!(load(&path).unwrap(), defaults());
        save(
            &path,
            &json!({
                "webSearch": {"mode": "api", "custom": true},
                "navis": {"maxSteps": 31, "automationMode": "playwright"},
                "futureSection": {"enabled": true}
            }),
        )
        .unwrap();
        let actual = load(&path).unwrap();
        assert_eq!(actual["webSearch"]["mode"], "api");
        assert_eq!(actual["webSearch"]["provider"], "exa");
        assert_eq!(actual["webSearch"]["custom"], true);
        assert_eq!(actual["navis"]["maxSteps"], 31);
        assert_eq!(actual["navis"]["automationMode"], "extension-first");
        assert_eq!(actual["futureSection"]["enabled"], true);
        std::fs::write(&path, "{").unwrap();
        assert_eq!(load(&path).unwrap(), defaults());
    }
}
