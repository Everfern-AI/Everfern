use serde_json::{json, Value};
use std::sync::LazyLock;
use std::{fs, path::Path};

fn telegram_approval_code(message: &str) -> String {
    static COMMAND: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?:^|\s)fern\s+approve\s+([a-z0-9-]+)(?:\s|$)").unwrap()
    });
    static PREFIX: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^fern\s+approve\s+").unwrap());
    let normalized = message.trim().to_lowercase();
    if let Some(captures) = COMMAND.captures(&normalized) {
        return captures[1].to_owned();
    }
    PREFIX
        .replace(normalized.trim_matches('`'), "")
        .trim()
        .to_owned()
}

pub async fn test_connection(request: &Value) -> Value {
    let failed = json!({"success": false});
    let Some(token) = request["token"]
        .as_str()
        .filter(|token| !token.trim().is_empty())
    else {
        return failed;
    };
    let Ok(client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
    else {
        return failed;
    };
    let platform = request["platform"].as_str().unwrap_or_default();
    let request = match platform {
        "telegram"
            if token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte)) =>
        {
            client.get(format!("https://api.telegram.org/bot{token}/getMe"))
        }
        "discord" => {
            let Some(id) = request["applicationId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
            else {
                return failed;
            };
            client
                .get(format!("https://discord.com/api/v10/applications/{id}"))
                .header("Authorization", format!("Bot {token}"))
        }
        _ => return failed,
    };
    let Ok(response) = request.send().await else {
        return failed;
    };
    if !response.status().is_success() {
        return failed;
    }
    let Ok(body) = response.json::<Value>().await else {
        return failed;
    };
    match platform {
        "telegram" if body["ok"] == true && body["result"].is_object() => {
            let mut result = json!({"success": true});
            if let Some(name) = body["result"]["username"].as_str() {
                result["username"] = json!(name);
            }
            result
        }
        "discord" if body["id"].as_str().is_some_and(|id| !id.is_empty()) => {
            match body["name"].as_str().filter(|name| !name.is_empty()) {
                Some(name) => json!({"success": true, "name": name}),
                None => failed,
            }
        }
        _ => failed,
    }
}

fn load(path: &Path) -> Result<Value, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(error.to_string()),
    }
}

pub fn config_for_renderer(directory: &Path) -> Value {
    load_with_defaults(directory).unwrap_or_else(|_| with_defaults(Value::Null))
}

fn load_with_defaults(directory: &Path) -> Result<Value, String> {
    load(&directory.join("integration-config.json")).map(with_defaults)
}

fn with_defaults(saved: Value) -> Value {
    let mut config = json!({
        "telegram": {
            "enabled": false, "botToken": "", "connected": false,
            "requireApproval": true, "approvalCode": "", "approvedUsers": []
        },
        "discord": {
            "enabled": false, "botToken": "", "applicationId": "", "connected": false
        }
    });
    for platform in ["telegram", "discord"] {
        if let Some(fields) = saved[platform].as_object() {
            config[platform]
                .as_object_mut()
                .unwrap()
                .extend(fields.clone());
        }
    }
    config
}

fn merge_update(current: &Value, update: &Value) -> Value {
    let mut merged = with_defaults(current.clone());
    for platform in ["telegram", "discord"] {
        if let Some(fields) = update[platform].as_object() {
            let values = merged[platform].as_object_mut().unwrap();
            for (key, value) in fields {
                if platform == "telegram"
                    && value.is_null()
                    && matches!(
                        key.as_str(),
                        "requireApproval" | "approvalCode" | "approvedUsers"
                    )
                {
                    continue;
                }
                values.insert(key.clone(), value.clone());
            }
        }
    }
    for (key, default) in [
        ("requireApproval", json!(true)),
        ("approvalCode", json!("")),
        ("approvedUsers", json!([])),
    ] {
        if merged["telegram"][key].is_null() {
            merged["telegram"][key] = default;
        }
    }
    merged
}

pub fn dispatch(
    directory: &Path,
    operation: &str,
    config: Option<&Value>,
) -> Result<Value, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("integration-config.lock"))
        .map_err(|error| error.to_string())?;
    lock.lock().map_err(|error| error.to_string())?;
    dispatch_locked(directory, operation, config)
}

fn dispatch_locked(
    directory: &Path,
    operation: &str,
    config: Option<&Value>,
) -> Result<Value, String> {
    let path = directory.join("integration-config.json");
    match operation {
        "integration:load-resolved" => load_with_defaults(directory),
        "integration:load" => load(&path),
        "integration:authorize-discord-message" => {
            let request = config.ok_or("Expected a Discord user lookup")?;
            let current = load_with_defaults(directory)?;
            let discord = &current["discord"];
            let permits = |key: &str, id: &Value| {
                discord[key]
                    .as_array()
                    .is_none_or(|ids| ids.is_empty() || ids.contains(id))
            };
            let token_matches = request["token"]
                .as_str()
                .filter(|token| !token.is_empty())
                .is_some_and(|token| discord["botToken"] == token);
            Ok(json!(
                token_matches
                    && (request["direct"] == true
                        || (request["mentioned"] == true
                            && permits("allowedUsers", &request["id"])
                            && (request["guildId"].is_null()
                                || permits("allowedGuilds", &request["guildId"]))))
            ))
        }
        "integration:authorize-telegram-message" => {
            let request = config.ok_or("Expected a Telegram user lookup")?;
            let mut current = load_with_defaults(directory)?;
            let telegram = &current["telegram"];
            if telegram["botToken"] != request["token"] {
                return Ok(json!("denied"));
            }
            if telegram["requireApproval"] == false {
                return Ok(json!("allowed"));
            }
            let Some(id) = request["id"].as_str().filter(|id| !id.is_empty()) else {
                return Ok(json!("denied"));
            };
            let mut users = telegram["approvedUsers"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if users.iter().any(|user| user == id) {
                return Ok(json!("allowed"));
            }
            let saved_code = telegram["approvalCode"].as_str().unwrap_or_default().trim();
            if saved_code.is_empty()
                || request["message"].as_str().is_none_or(|message| {
                    telegram_approval_code(message) != saved_code.to_lowercase()
                })
            {
                return Ok(json!("denied"));
            }
            users.push(json!(id));
            current["telegram"]["approvedUsers"] = json!(users);
            dispatch_locked(directory, "integration:save", Some(&current))?;
            Ok(json!("paired"))
        }
        "integration:commit-test-result" => {
            let request = config.ok_or("Expected a connection test")?;
            let Some(platform @ ("telegram" | "discord")) = request["platform"].as_str() else {
                return Ok(Value::Null);
            };
            let mut current = load_with_defaults(directory)?;
            if current[platform]["botToken"] != request["token"]
                || (platform == "discord"
                    && current[platform]["applicationId"] != request["applicationId"])
            {
                return Ok(Value::Null);
            }
            let connected = request["success"]
                .as_bool()
                .ok_or("Expected a connection test result")?;
            current[platform]["connected"] = json!(connected);
            if platform == "telegram" {
                if let Some(username) = request["username"].as_str().filter(|name| !name.is_empty())
                {
                    current[platform]["botUsername"] = json!(username);
                }
            }
            dispatch_locked(directory, "integration:save", Some(&current))?;
            Ok(current)
        }
        "integration:save-and-check-runtime" => {
            let update = config
                .filter(|value| value.is_object())
                .ok_or("Expected integration update")?;
            let current = config_for_renderer(directory);
            let merged = merge_update(&current, update);
            let configured = |config: &Value| {
                ["telegram", "discord"].iter().any(|platform| {
                    config[*platform]["enabled"] == true
                        && config[*platform]["botToken"]
                            .as_str()
                            .is_some_and(|token| !token.is_empty())
                })
            };
            let needs_runtime = configured(&current) || configured(&merged);
            dispatch_locked(directory, "integration:save", Some(&merged))?;
            Ok(json!(needs_runtime))
        }
        "integration:merge-and-save" => {
            let request = config.ok_or("Expected integration update")?;
            let current = load_with_defaults(directory)?;
            let merged = merge_update(&current, &request["update"]);
            dispatch_locked(directory, "integration:save", Some(&merged))?;
            Ok(merged)
        }
        "integration:save" => {
            let config = config
                .filter(|value| value.is_object())
                .ok_or("Expected integration config")?;
            let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
            crate::store::atomic_write(&path, &bytes)?;
            Ok(Value::Null)
        }
        _ => Err("Unknown integration storage operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_probe_only_updates_unchanged_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = with_defaults(json!({
            "discord": {"connected": true, "botToken": "example"},
            "telegram": {"connected": true, "botToken": "example", "approvedUsers": ["123"]}
        }));
        dispatch(dir.path(), "integration:save", Some(&config)).unwrap();
        let commit = |token| {
            dispatch(
            dir.path(), "integration:commit-test-result",
            Some(&json!({"platform": "discord", "token": token, "applicationId": "", "success": false})),
        ).unwrap()
        };
        assert_eq!(commit("previous-token"), Value::Null);
        assert_eq!(config_for_renderer(dir.path()), config);
        config["discord"]["connected"] = json!(false);
        assert_eq!(commit("example"), config);
        assert_eq!(config_for_renderer(dir.path()), config);
    }

    #[test]
    fn discord_authorization_checks_saved_allowlists_and_token() {
        let dir = tempfile::tempdir().unwrap();
        let config = json!({"discord": {
            "botToken": "current", "allowedUsers": ["alice"], "allowedGuilds": ["team"]
        }});
        dispatch(dir.path(), "integration:save", Some(&config)).unwrap();
        let authorize = |token, id, direct, mentioned, guild_id: Option<&str>| {
            dispatch(dir.path(), "integration:authorize-discord-message",
                Some(&json!({"token": token, "id": id, "direct": direct, "mentioned": mentioned, "guildId": guild_id})))
                .unwrap().as_bool().unwrap()
        };
        assert!(authorize("current", "alice", false, true, Some("team")));
        assert!(!authorize("current", "alice", false, false, Some("team")));
        assert!(!authorize("current", "bob", false, true, Some("team")));
        assert!(!authorize("current", "alice", false, true, Some("other")));
        assert!(authorize("current", "bob", true, false, None));
        assert!(!authorize("stale", "alice", true, false, None));
    }

    #[test]
    fn telegram_approval_checks_current_code_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let config = json!({"telegram":{"botToken":"token","approvalCode":"Current","approvedUsers":["first"]}});
        dispatch(dir.path(), "integration:save", Some(&config)).unwrap();
        let approve = |message| {
            dispatch(
                dir.path(),
                "integration:authorize-telegram-message",
                Some(&json!({"id":"second","token":"token","message":message})),
            )
            .unwrap()
        };
        assert_eq!(approve("old"), "denied");
        assert_eq!(approve("`Fern approve CURRENT`"), "paired");
        assert_eq!(approve("another message"), "allowed");
        assert_eq!(
            config_for_renderer(dir.path())["telegram"]["approvedUsers"],
            json!(["first", "second"])
        );
    }

    #[test]
    fn integration_save_reports_when_bot_runtime_needs_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let save = |update| {
            dispatch(
                dir.path(),
                "integration:save-and-check-runtime",
                Some(&update),
            )
            .unwrap()
        };
        assert_eq!(save(json!({"telegram":{"botToken":"fixture"}})), false);
        assert_eq!(save(json!({"telegram":{"enabled":true}})), true);
        assert_eq!(save(json!({"telegram":{"enabled":false}})), true);
        assert_eq!(save(json!({"telegram":{"approvalCode":"new"}})), false);
        let saved = config_for_renderer(dir.path());
        assert_eq!(saved["telegram"]["botToken"], "fixture");
        assert_eq!(saved["telegram"]["enabled"], false);
        assert_eq!(saved["telegram"]["approvalCode"], "new");
    }

    #[test]
    fn partial_update_preserves_telegram_approvals() {
        let updated = merge_update(
            &json!({"telegram":{"approvedUsers":["123"],"requireApproval":false}}),
            &json!({"telegram":{"approvedUsers":null,"requireApproval":null},"discord":{"enabled":true}}),
        );
        assert_eq!(updated["telegram"]["approvedUsers"], json!(["123"]));
        assert_eq!(updated["telegram"]["requireApproval"], false);
        assert_eq!(updated["discord"]["enabled"], true);
    }

    #[test]
    fn integration_storage_reads_and_updates_the_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("integration-config.json");
        assert_eq!(
            dispatch(dir.path(), "integration:load", None).unwrap(),
            json!({})
        );
        fs::write(
            &path,
            r#"{"telegram":{"approvedUsers":["123"]},"discord":{"enabled":false}}"#,
        )
        .unwrap();
        let mut config = dispatch(dir.path(), "integration:load", None).unwrap();
        config["discord"]["enabled"] = json!(true);
        dispatch(dir.path(), "integration:save", Some(&config)).unwrap();
        assert_eq!(load(&path).unwrap(), config);
        assert_eq!(config["telegram"]["approvedUsers"], json!(["123"]));
        let renderer = config_for_renderer(dir.path());
        assert_eq!(renderer["telegram"]["requireApproval"], true);
        assert_eq!(renderer["telegram"]["approvedUsers"], json!(["123"]));
        assert_eq!(renderer["discord"]["enabled"], true);
    }
}
