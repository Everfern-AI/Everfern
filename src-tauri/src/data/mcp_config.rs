use serde_json::{json, Value};
use std::path::Path;

pub(super) fn inactive_mcp_status(path: &Path) -> Value {
    let Some(servers) = disabled_servers(path) else {
        return Value::Null;
    };
    json!(servers
        .into_iter()
        .map(|(name, mut config)| {
            config["name"] = json!(name);
            json!({"config": config, "state": "disabled", "tools": []})
        })
        .collect::<Vec<_>>())
}

fn disabled_servers(path: &Path) -> Option<serde_json::Map<String, Value>> {
    let servers = saved_servers(path)?;
    servers
        .values()
        .all(|config| config["enabled"] == false)
        .then_some(servers)
}

fn saved_servers(path: &Path) -> Option<serde_json::Map<String, Value>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(Default::default())
        }
        Err(_) => return None,
    };
    let saved = serde_json::from_slice(&bytes).ok()?;
    let mut servers = serde_json::Map::new();
    for config in parse_configs(&saved, true)? {
        let (name, config) = split_config(config);
        servers.insert(name, config);
    }
    Some(servers)
}

pub(super) fn set_server_enabled(
    path: &Path,
    name: Option<&str>,
    enabled: bool,
) -> Result<Value, String> {
    let Some(mut servers) = saved_servers(path) else {
        return Ok(Value::Null);
    };
    let Some(name) = name else {
        return Ok(Value::Null);
    };
    let Some(config) = servers.get_mut(name) else {
        return Ok(Value::Null);
    };
    let was_enabled = config["enabled"] != false;
    let changed = was_enabled != enabled;
    if changed {
        config["enabled"] = json!(enabled);
    }
    let needs_runtime =
        enabled || was_enabled || servers.values().any(|config| config["enabled"] != false);
    if changed {
        save_servers(path, servers)?;
    }
    Ok(json!({"success":true,"needsRuntime":needs_runtime,"serverNames":[name],"removedNames":[]}))
}

pub(super) fn inactive_connection_request(
    path: &Path,
    name: Option<&str>,
    may_enable: bool,
) -> Value {
    let Some(servers) = disabled_servers(path) else {
        return Value::Null;
    };
    if may_enable && name.is_some_and(|name| servers.contains_key(name)) {
        return Value::Null;
    }
    json!({"success": true})
}

pub(super) fn import_configs(path: &Path, input: Option<&str>) -> Result<Value, String> {
    let Some(imports) = input
        .and_then(|text| serde_json::from_str(text).ok())
        .and_then(|value| parse_configs(&value, false))
    else {
        return Ok(Value::Null);
    };
    if imports.is_empty() {
        return Ok(Value::Null);
    }
    let Some(mut servers) = saved_servers(path) else {
        return Ok(Value::Null);
    };
    let mut names = Vec::with_capacity(imports.len());
    let mut needs_runtime = false;
    for config in imports {
        let (name, config) = split_config(config);
        needs_runtime |= config["enabled"] != false
            || servers
                .get(&name)
                .is_some_and(|previous| previous["enabled"] != false);
        names.push(name.clone());
        servers.insert(name, config);
    }
    needs_runtime |= servers.values().any(|config| config["enabled"] != false);
    save_servers(path, servers)?;
    Ok(
        json!({"success":true,"data":names.clone(),"needsRuntime":needs_runtime,"serverNames":names,"removedNames":[]}),
    )
}

pub(super) fn remove_server(path: &Path, name: Option<&str>) -> Result<Value, String> {
    let Some(mut servers) = saved_servers(path) else {
        return Ok(Value::Null);
    };
    let removed = name.and_then(|name| servers.shift_remove(name));
    let needs_runtime = removed
        .as_ref()
        .is_some_and(|config| config["enabled"] != false)
        || servers.values().any(|config| config["enabled"] != false);
    if removed.is_some() {
        save_servers(path, servers)?;
    }
    Ok(
        json!({"success":true,"needsRuntime":needs_runtime,"serverNames":[],"removedNames":name.into_iter().collect::<Vec<_>>()}),
    )
}

pub(super) fn save_config(
    path: &Path,
    config: &Value,
    previous_name: Option<&str>,
) -> Result<Value, String> {
    if !["command", "docker", "url"]
        .iter()
        .any(|key| config[*key].as_str().is_some_and(|value| !value.is_empty()))
    {
        return Ok(Value::Null);
    }
    let Some(mut parsed) = parse_configs(&json!([config]), false) else {
        return Ok(Value::Null);
    };
    let (name, config) = split_config(parsed.pop().expect("one parsed server"));
    let Some(mut servers) = saved_servers(path) else {
        return Ok(Value::Null);
    };
    let previous = previous_name.filter(|previous| *previous != name);
    let previous_was_enabled = previous
        .and_then(|previous| servers.shift_remove(previous))
        .is_some_and(|config| config["enabled"] != false);
    let was_enabled = servers
        .get(&name)
        .is_some_and(|config| config["enabled"] != false);
    let needs_runtime = config["enabled"] != false
        || was_enabled
        || previous_was_enabled
        || servers.values().any(|config| config["enabled"] != false);
    servers.insert(name.clone(), config);
    save_servers(path, servers)?;
    Ok(json!({"success":true,"data":0,"needsRuntime":needs_runtime,
        "serverNames":[name.clone()],"removedNames":previous.into_iter().collect::<Vec<_>>()}))
}

fn split_config(mut config: Value) -> (String, Value) {
    let name = config
        .as_object_mut()
        .unwrap()
        .shift_remove("name")
        .unwrap();
    (name.as_str().unwrap().to_owned(), config)
}

fn save_servers(path: &Path, servers: serde_json::Map<String, Value>) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&json!({"mcpServers": servers}))
        .map_err(|error| error.to_string())?;
    crate::store::atomic_write(path, &bytes)
}

fn parse_configs(saved: &Value, first_wins: bool) -> Option<Vec<Value>> {
    let servers = saved
        .get("mcpServers")
        .or_else(|| saved.get("servers"))
        .unwrap_or(saved);
    let entries: Vec<_> = if let Some(servers) = servers.as_object() {
        let mut entries: Vec<_> = servers
            .iter()
            .map(|(name, record)| (name.as_str(), record))
            .collect();
        // Object.entries enumerates array indices before other keys.
        entries.sort_by_key(|(name, _)| {
            name.parse::<u32>()
                .ok()
                .filter(|index| index.to_string() == *name)
                .unwrap_or(u32::MAX)
        });
        entries
    } else if let Some(servers) = saved.as_array() {
        let Some(entries) = servers
            .iter()
            .map(|record| Some((record["name"].as_str()?, record)))
            .collect::<Option<Vec<_>>>()
        else {
            return None;
        };
        entries
    } else {
        return None;
    };
    let mut configs = Vec::with_capacity(entries.len());
    let mut seen = std::collections::HashSet::new();
    for (name, record) in entries {
        let Some(config) = record.as_object() else {
            return None;
        };
        let name = record["name"]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or(name);
        if name.is_empty()
            || name == "__proto__"
            || name.trim() != name
            || config.iter().any(|(key, value)| match key.as_str() {
                "enabled" | "disabled" => !value.is_boolean(),
                "command" | "docker" | "url" | "serverUrl" | "httpUrl" => !value.is_string(),
                "args" => !value
                    .as_array()
                    .is_some_and(|args| args.iter().all(Value::is_string)),
                "env" | "headers" => !value.is_object(),
                "name" => !value.is_string(),
                _ => true,
            })
        {
            return None;
        }
        let mut config = config.clone();
        let url = ["url", "serverUrl"]
            .into_iter()
            .filter_map(|key| record[key].as_str())
            .find(|value| !value.is_empty())
            .or_else(|| record["httpUrl"].as_str());
        if !url.is_some_and(|value| !value.is_empty())
            && !["command", "docker"]
                .into_iter()
                .any(|key| record[key].as_str().is_some_and(|value| !value.is_empty()))
        {
            return None;
        }
        for key in ["enabled", "disabled", "url", "serverUrl", "httpUrl"] {
            config.shift_remove(key);
        }
        if let Some(url) = url {
            config.insert("url".into(), json!(url));
        }
        if record["enabled"] == false || record["disabled"] == true {
            config.insert("enabled".into(), json!(false));
        }
        config.insert("name".into(), json!(name));
        if !first_wins || seen.insert(name) {
            configs.push(Value::Object(config));
        }
    }
    Some(configs)
}

#[test]
fn mcp_profile_operations_persist_active_and_disabled_servers() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mcp-servers.json");
    let first = r#"{"one":{"command":"first","disabled":true}}"#;
    let second = r#"[{"name":"two","command":"second","enabled":false}]"#;
    let imported = import_configs(&path, Some(first)).unwrap();
    assert_eq!(imported["data"], json!(["one"]));
    assert_eq!(imported["needsRuntime"], false);
    assert_eq!(
        import_configs(&path, Some(second)).unwrap()["data"],
        json!(["two"])
    );
    assert_eq!(inactive_mcp_status(&path).as_array().unwrap().len(), 2);

    let live = r#"{"live":{"command":"server"}}"#;
    let imported = import_configs(&path, Some(live)).unwrap();
    assert_eq!(imported["data"], json!(["live"]));
    assert_eq!(imported["needsRuntime"], true);
    assert!(inactive_mcp_status(&path).is_null());

    let removed = remove_server(&path, Some("live")).unwrap();
    assert_eq!(removed["success"], true);
    assert_eq!(removed["needsRuntime"], false);
    assert_eq!(inactive_mcp_status(&path).as_array().unwrap().len(), 2);

    let renamed = json!({"name":"renamed","enabled":false,"command":"second"});
    let saved = save_config(&path, &renamed, Some("two")).unwrap();
    assert_eq!(saved["success"], true);
    assert_eq!(saved["data"], 0);
    assert_eq!(saved["needsRuntime"], false);
    let status = inactive_mcp_status(&path);
    assert_eq!(status.as_array().unwrap().len(), 2);
    assert!(status
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["config"]["name"] == "renamed"));
}

#[test]
fn inactive_mcp_status_lists_disabled_servers_in_registry_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mcp-servers.json");
    assert_eq!(inactive_mcp_status(&path), json!([]));
    std::fs::write(
        &path,
        r#"{"mcpServers":{
        "z":{"enabled":false,"command":"local","args":["one"]},
        "a":{"enabled":false,"docker":"example"},
        "2":{"enabled":false,"url":"https://example.com"}
    }}"#,
    )
    .unwrap();
    let status = inactive_mcp_status(&path);
    assert_eq!(status[0]["config"]["name"], "2");
    assert_eq!(
        status[1],
        json!({
            "config":{"name":"z","enabled":false,"command":"local","args":["one"]},
            "state":"disabled","tools":[]
        })
    );
    assert_eq!(status[2]["config"]["name"], "a");

    std::fs::write(
        &path,
        r#"{"servers":{"legacy":{"disabled":true,"serverUrl":"https://example.com"}}}"#,
    )
    .unwrap();
    assert_eq!(
        inactive_mcp_status(&path),
        json!([{
            "config":{"name":"legacy","enabled":false,"url":"https://example.com"},
            "state":"disabled","tools":[]
        }])
    );

    std::fs::write(&path, r#"{"mcpServers":{"live":{"command":"local"}}}"#).unwrap();
    assert!(inactive_mcp_status(&path).is_null());
    assert_eq!(
        set_server_enabled(&path, Some("missing"), false).unwrap()["success"],
        true
    );
    assert_eq!(
        set_server_enabled(&path, Some("live"), false).unwrap()["success"],
        true
    );
    assert_eq!(inactive_mcp_status(&path)[0]["state"], "disabled");
    let mixed =
        r#"{"mcpServers":{"live":{"command":"local"},"off":{"command":"other","enabled":false}}}"#;
    std::fs::write(&path, mixed).unwrap();
    assert_eq!(remove_server(&path, Some("off")).unwrap()["success"], true);
    assert!(inactive_mcp_status(&path).is_null());
    std::fs::write(&path, mixed).unwrap();
    assert_eq!(remove_server(&path, Some("live")).unwrap()["success"], true);
    assert_eq!(inactive_mcp_status(&path)[0]["config"]["name"], "off");
    std::fs::write(&path, mixed).unwrap();
    let replacement = json!({"name":"replacement","command":"local","enabled":false});
    assert_eq!(
        save_config(&path, &replacement, Some("off")).unwrap()["success"],
        true
    );
    assert!(inactive_mcp_status(&path).is_null());
    std::fs::write(&path, mixed).unwrap();
    assert_eq!(
        save_config(&path, &replacement, Some("live")).unwrap()["data"],
        0
    );
    let status = inactive_mcp_status(&path);
    assert_eq!(status[0]["config"]["name"], "off");
    assert_eq!(status[1]["config"], replacement);
    std::fs::write(&path, mixed).unwrap();
    let unrelated = r#"{"other":{"command":"new","enabled":false}}"#;
    assert_eq!(
        import_configs(&path, Some(unrelated)).unwrap()["success"],
        true
    );
    std::fs::write(&path, mixed).unwrap();
    let disable_live = r#"{"live":{"command":"new","enabled":false}}"#;
    assert_eq!(
        import_configs(&path, Some(disable_live)).unwrap()["data"],
        json!(["live"])
    );
    let status = inactive_mcp_status(&path);
    assert_eq!(status[0]["config"]["command"], "new");
    assert_eq!(status[1]["config"]["name"], "off");

    std::fs::write(
        &path,
        r#"[
        {"name":"z","disabled":true,"command":"first"},
        {"name":"a","disabled":true,"command":"second"},
        {"name":"z","disabled":true,"command":"ignored"}
    ]"#,
    )
    .unwrap();
    let status = inactive_mcp_status(&path);
    assert_eq!(status.as_array().unwrap().len(), 2);
    assert_eq!(status[0]["config"]["command"], "first");
    assert_eq!(status[1]["config"]["name"], "a");
}
