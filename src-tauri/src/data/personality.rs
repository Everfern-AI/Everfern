use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;

const DOCUMENTS: [(&str, &str, &str); 2] = [
    (
        "soul",
        "SOUL.md",
        include_str!(concat!(env!("OUT_DIR"), "/default-soul.md")),
    ),
    (
        "agents",
        "agents.md",
        include_str!(concat!(env!("OUT_DIR"), "/default-agents.md")),
    ),
];

pub fn initialize(directory: &Path) -> Result<(), String> {
    let root = directory.join("prompts");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    for (_, name, default) in DOCUMENTS {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(name))
        {
            Ok(mut file) => file
                .write_all(default.as_bytes())
                .map_err(|error| error.to_string())?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub fn load(directory: &Path, workspace: Option<&str>) -> Value {
    let mut result = json!({});
    for (key, name, default) in DOCUMENTS {
        let path = workspace
            .filter(|path| !path.is_empty())
            .map(|path| Path::new(path).join(name));
        let path = path
            .filter(|path| path.exists())
            .unwrap_or_else(|| directory.join("prompts").join(name));
        let content = std::fs::read(path)
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_else(|| default.to_owned());
        result[key] = json!(content);
    }
    result
}

pub fn save(directory: &Path, config: &Value) -> Result<(), String> {
    let global = directory.join("prompts");
    let root = config["workspaceRoot"]
        .as_str()
        .filter(|path| !path.is_empty())
        .map(Path::new)
        .unwrap_or(&global);
    if root == global {
        std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    }
    for (key, name, _) in DOCUMENTS {
        if let Some(content) = config.get(key) {
            let content = content
                .as_str()
                .ok_or_else(|| format!("Expected text for {key}"))?;
            std::fs::write(root.join(name), content).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[test]
fn personality_initialization_preserves_custom_text_and_workspace_overrides() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let scope = workspace.path().to_str().unwrap();
    save(data.path(), &json!({"soul": "Global customization"})).unwrap();
    initialize(data.path()).unwrap();
    let global = load(data.path(), None);
    assert_eq!(global["soul"], "Global customization");
    assert!(!global["agents"].as_str().unwrap().is_empty());

    save(data.path(), &json!({"workspaceRoot": scope, "soul": ""})).unwrap();
    assert_eq!(
        load(data.path(), Some(scope)),
        json!({"soul": "", "agents": global["agents"]})
    );
    assert_eq!(load(data.path(), None), global);
}
