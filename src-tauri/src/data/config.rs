//! `load-config` (main/ipc/config-handlers.ts loadConfigSync) and the launch check that
//! decides whether the Node sidecar must start before anything asks for it.
//! `save-config` stays in Node: it also updates the running agent's provider.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

/// JS truthiness of a present value.
fn truthy(v: &Value) -> bool {
    super::db::truthy(Some(v))
}

fn s<'a>(v: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn default_vlm_model(provider: &str) -> &'static str {
    match provider {
        "openrouter" => "qwen/qwen3-vl-235b-a22b-instruct",
        "minimax" => "MiniMax-M3",
        "ollama" | "ollama-cloud" => "qwen3-vl:235b-cloud",
        "openai" => "gpt-5.5",
        "anthropic" => "claude-sonnet-4-6",
        "gemini" => "gemini-3.5-flash",
        "everfern" => "fern-1",
        _ => "qwen3-vl:235b-cloud",
    }
}

/// normalizeVlmConfig: returns None when `config.vlm` is falsy (JS returns the same object).
fn normalize_vlm(config: &Map<String, Value>) -> Option<Map<String, Value>> {
    let mut vlm = match config.get("vlm") {
        Some(Value::Object(m)) => m.clone(),
        Some(v) if truthy(v) => Map::new(), // a non-object truthy value spreads to {}
        _ => return None,
    };
    let cloud = s(&vlm, "engine") == Some("cloud");
    if !matches!(vlm.get("enabled"), Some(Value::Bool(_))) {
        vlm.insert("enabled".into(), json!(cloud));
    }
    if s(&vlm, "model") == Some("qwen3-vl:235b-instruct-cloud") {
        vlm.insert("model".into(), json!("qwen3-vl:235b-cloud"));
    }
    if cloud && !vlm.get("provider").map(truthy).unwrap_or(false) {
        vlm.insert("provider".into(), json!("ollama"));
    }
    let provider = vlm
        .get("provider")
        .map(|p| match p {
            Value::String(t) => t.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    if cloud && s(&vlm, "provider") == Some("ollama") {
        if !vlm.get("model").map(truthy).unwrap_or(false) {
            vlm.insert("model".into(), json!(default_vlm_model(&provider)));
        }
        if !vlm.get("baseUrl").map(truthy).unwrap_or(false) {
            vlm.insert("baseUrl".into(), json!("https://ollama.com"));
        }
    }
    if cloud && !vlm.get("model").map(truthy).unwrap_or(false) {
        vlm.insert("model".into(), json!(default_vlm_model(&provider)));
    }
    if cloud && s(&vlm, "provider") == Some("minimax") {
        let base = vlm.get("baseUrl");
        let stale = match base {
            None => true,
            Some(v) if !truthy(v) => true,
            Some(Value::String(t)) => t.contains("ollama.com"),
            Some(v) => v.to_string().contains("ollama.com"),
        };
        if stale {
            vlm.insert("baseUrl".into(), json!("https://api.minimax.io/v1"));
        }
    }
    Some(vlm)
}

const LOCAL_PROVIDERS: [&str; 3] = ["ollama", "lmstudio", "llamacpp"];

fn points_at_loopback(m: &Map<String, Value>) -> bool {
    s(m, "baseUrl")
        .map(|u| u.contains("localhost") || u.contains("127.0.0.1"))
        .unwrap_or(false)
}

/// The parts of loadConfigSync that change the parsed file, with Object.assign's quirk:
/// when `vlm` is set, normalizeConfig works on a copy, so its top-level deletions are lost.
fn normalize(config: &mut Map<String, Value>) {
    let vlm = normalize_vlm(config);
    let copied = vlm.is_some();
    let mut n = config.clone();
    if let Some(v) = vlm {
        n.insert("vlm".into(), Value::Object(v));
    }

    let remote = |m: &Map<String, Value>| {
        m.get("provider").map(truthy).unwrap_or(false)
            && !s(m, "provider")
                .map(|p| LOCAL_PROVIDERS.contains(&p))
                .unwrap_or(false)
    };
    if remote(&n) && points_at_loopback(&n) {
        n.remove("baseUrl");
    }
    if let Some(Value::Object(v)) = n.get_mut("vlm") {
        if remote(v) && points_at_loopback(v) {
            v.remove("baseUrl");
        }
    }
    if s(&n, "provider") == Some("llamacpp") && n.get("baseUrl").map(truthy).unwrap_or(false) {
        let mut urls = match n.get("baseUrls") {
            Some(Value::Object(m)) => m.clone(),
            _ => Map::new(),
        };
        urls.insert("llamacpp".into(), n["baseUrl"].clone());
        n.insert("baseUrls".into(), Value::Object(urls));
    }

    if copied {
        for (k, v) in n {
            config.insert(k, v);
        }
    } else {
        *config = n;
    }

    if let Some(Value::Object(v)) = config.get_mut("vlm") {
        if s(v, "model")
            .map(|m| m.contains("hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF"))
            .unwrap_or(false)
        {
            v.insert("model".into(), json!("qwen3-vl:2b"));
        }
        if matches!(s(v, "provider"), Some("everfern") | Some("openrouter")) {
            v.remove("baseUrl");
        }
    }
}

/// readIsolatedKeys: every non-empty `keys/*.key`, by file name order.
fn isolated_keys(dir: &Path) -> Map<String, Value> {
    let mut keys = Map::new();
    let Ok(entries) = fs::read_dir(dir.join("keys")) else {
        return keys;
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".key"))
        .collect();
    names.sort();
    for name in names {
        if let Ok(text) = fs::read_to_string(dir.join("keys").join(&name)) {
            let key = text.trim();
            if !key.is_empty() {
                keys.insert(name.trim_end_matches(".key").to_string(), json!(key));
            }
        }
    }
    keys
}

/// hydrateConfigWithIsolatedKeys + hydrateVlmApiKey.
fn hydrate(config: &mut Map<String, Value>, dir: &Path) {
    let keys = isolated_keys(dir);
    config.insert("keys".into(), Value::Object(keys.clone()));
    if let Some(p) = s(config, "provider").map(str::to_string) {
        if let Some(k) = keys.get(&p) {
            config.insert("apiKey".into(), k.clone());
        }
    }

    hydrate_vlm(config, &keys);
}

pub fn hydrate_runtime_vlm(dir: &Path, input: &Value) -> Value {
    let Some(mut config) = input.as_object().cloned() else {
        return Value::Null;
    };
    let _lock = provider_config_lock(dir)
        .ok()
        .and_then(|lock| lock.lock_shared().ok().map(|()| lock));
    let mut keys = isolated_keys(dir);
    if let Some(overrides) = input["keys"].as_object() {
        keys.extend(overrides.clone());
    }
    hydrate_vlm(&mut config, &keys);
    config.remove("vlm").unwrap_or(Value::Null)
}

pub fn prepare_runtime_provider(dir: &Path, input: &Value) -> Value {
    let Some(mut config) = input.as_object().cloned() else {
        return Value::Null;
    };
    let alias = match s(&config, "provider") {
        Some("local") => Some("ollama"),
        Some("google") => Some("gemini"),
        _ => None,
    };
    if let Some(provider) = alias {
        config.insert("provider".into(), json!(provider));
    }
    let remote = |map: &Map<String, Value>| {
        s(map, "provider")
            .is_some_and(|provider| !provider.is_empty() && !LOCAL_PROVIDERS.contains(&provider))
    };
    if remote(&config) && points_at_loopback(&config) {
        config.remove("baseUrl");
    }
    if let Some(Value::Object(vlm)) = config.get_mut("vlm") {
        if s(vlm, "model") == Some("qwen3-vl:235b-instruct-cloud") {
            vlm.insert("model".into(), json!("qwen3-vl:235b-cloud"));
        }
        if s(vlm, "engine") == Some("cloud") {
            if !vlm.get("model").is_some_and(truthy) {
                let model = default_vlm_model(s(vlm, "provider").unwrap_or_default());
                vlm.insert("model".into(), json!(model));
            }
            if s(vlm, "provider") == Some("minimax")
                && (!vlm.get("baseUrl").is_some_and(truthy)
                    || s(vlm, "baseUrl").is_some_and(|url| url.contains("ollama.com")))
            {
                vlm.insert("baseUrl".into(), json!("https://api.minimax.io/v1"));
            }
        }
        if matches!(s(vlm, "provider"), Some("everfern" | "openrouter"))
            || (remote(vlm) && points_at_loopback(vlm))
        {
            vlm.remove("baseUrl");
        }
        if !vlm.get("apiKey").is_some_and(truthy) {
            let hydrated = hydrate_runtime_vlm(dir, &Value::Object(config.clone()));
            config.insert("vlm".into(), hydrated);
        }
    }
    Value::Object(config)
}

pub fn resolve_tool_provider_config(dir: &Path, input: &Value) -> Value {
    let Some(client) = input.as_object() else {
        return Value::Null;
    };
    let _lock = provider_config_lock(dir)
        .ok()
        .and_then(|lock| lock.lock_shared().ok().map(|()| lock));
    let mut config = client.clone();
    if !client.get("vlm").is_some_and(truthy) {
        if let Some(saved) = load_config_unlocked(dir)["config"].as_object() {
            config = saved.clone();
            config.extend(client.clone());
            if let Some(vlm) = saved.get("vlm").filter(|vlm| truthy(vlm)) {
                config.insert("vlm".into(), vlm.clone());
            }
            let mut keys = saved
                .get("keys")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(overrides) = client.get("keys").and_then(Value::as_object) {
                keys.extend(overrides.clone());
            }
            config.insert("keys".into(), Value::Object(keys));
        }
    }
    let mut keys = isolated_keys(dir);
    if let Some(overrides) = config.get("keys").and_then(Value::as_object) {
        keys.extend(overrides.clone());
    }
    hydrate_vlm(&mut config, &keys);
    Value::Object(config)
}

fn hydrate_vlm(config: &mut Map<String, Value>, keys: &Map<String, Value>) {
    let Some(Value::Object(vlm)) = config.get("vlm") else {
        return;
    };
    let Some(provider) = vlm.get("provider").filter(|p| truthy(p)).map(|p| match p {
        Value::String(t) => t.clone(),
        o => o.to_string(),
    }) else {
        return;
    };
    if s(vlm, "apiKey")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
    {
        return;
    }
    let key_of = |name: &str| keys.get(name).and_then(Value::as_str).map(str::to_string);
    let active = s(config, "provider").map(str::to_string);
    let active_key = s(config, "apiKey").map(str::to_string);

    let mut chosen: Option<String> = None;
    if provider == "everfern" {
        let ef = key_of("everfern").filter(|k| !k.is_empty()).or_else(|| {
            if active.as_deref() == Some("everfern") {
                active_key.clone()
            } else {
                None
            }
        });
        let vlm_ef = key_of("vlm-everfern");
        if let Some(ef) = ef.filter(|k| k.starts_with("eyJ")) {
            if vlm_ef.map(|k| !k.starts_with("eyJ")).unwrap_or(true) {
                chosen = Some(ef.trim().to_string());
            }
        }
    }
    if chosen.is_none() {
        let mut aliases = vec![provider.clone()];
        if provider == "ollama" {
            aliases.push("ollama-cloud".into());
        }
        if provider == "ollama-cloud" {
            aliases.push("ollama".into());
        }
        let mut candidates: Vec<Option<String>> = aliases
            .iter()
            .flat_map(|a| [key_of(&format!("vlm-{a}")), key_of(a)])
            .collect();
        if active.as_deref() == Some(provider.as_str())
            && active_key
                .as_deref()
                .map(|k| !k.is_empty())
                .unwrap_or(false)
        {
            candidates.insert(0, active_key);
        }
        chosen = candidates
            .into_iter()
            .flatten()
            .map(|k| k.trim().to_string())
            .find(|k| !k.is_empty());
    }
    if let (Some(key), Some(Value::Object(vlm))) = (chosen, config.get_mut("vlm")) {
        vlm.insert("apiKey".into(), json!(key));
    }
}

/// The `load-config` IPC result.
fn provider_config_lock(dir: &Path) -> Result<fs::File, String> {
    fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("provider-config.lock"))
        .map_err(|error| error.to_string())
}

pub fn save_config(dir: &Path, input: &Value) -> Result<(), String> {
    let mut config = input
        .as_object()
        .cloned()
        .ok_or("Expected provider configuration")?;
    normalize(&mut config);
    let key_path = |config: &Map<String, Value>, prefix: &str| -> Result<Option<_>, String> {
        let Some(key) = config
            .get("apiKey")
            .and_then(Value::as_str)
            .filter(|key| !key.is_empty())
        else {
            return Ok(None);
        };
        let Some(provider) = config
            .get("provider")
            .and_then(Value::as_str)
            .filter(|provider| !provider.is_empty())
        else {
            return Ok(None);
        };
        if !provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err("Invalid provider name".into());
        }
        Ok(Some((
            dir.join("keys").join(format!("{prefix}{provider}.key")),
            key.trim().to_owned(),
        )))
    };
    let primary = key_path(&config, "")?;
    let vision = config
        .get("vlm")
        .and_then(Value::as_object)
        .map(|vlm| key_path(vlm, "vlm-"))
        .transpose()?
        .flatten();
    config.remove("apiKey");
    if let Some(vlm) = config.get_mut("vlm").and_then(Value::as_object_mut) {
        vlm.remove("apiKey");
    }
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let lock = provider_config_lock(dir)?;
    lock.lock().map_err(|error| error.to_string())?;
    for (path, key) in [primary, vision].into_iter().flatten() {
        crate::store::atomic_write(&path, key.as_bytes())?;
    }
    let bytes = serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?;
    crate::store::atomic_write(&dir.join("config.json"), &bytes)
}

pub fn load_config(dir: &Path) -> Value {
    // Legacy profiles may be read-only. They remain readable even if a lock cannot be created.
    let _lock = provider_config_lock(dir)
        .ok()
        .and_then(|lock| lock.lock_shared().ok().map(|()| lock));
    load_config_unlocked(dir)
}

fn load_config_unlocked(dir: &Path) -> Value {
    let path = dir.join("config.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return json!({ "success": true, "config": null });
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(mut config)) => {
            normalize(&mut config);
            hydrate(&mut config, dir);
            json!({ "success": true, "config": config })
        }
        // JSON.parse of a non-object followed by property access: Node returns the value or null.
        Ok(Value::Null) | Err(_) => json!({ "success": true, "config": null }),
        Ok(other) => json!({ "success": true, "config": other }),
    }
}

/// Why the sidecar has to start at launch, or None when it can wait until something needs it.
/// Enabled chat bots need their Node services at launch.
pub fn node_needed_at_launch(everfern: &Path) -> Option<&'static str> {
    if let Ok(text) = fs::read_to_string(everfern.join("integration-config.json")) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            let bot = |name: &str| {
                v.get(name)
                    .map(|b| {
                        b.get("enabled").map(truthy).unwrap_or(false)
                            && b.get("botToken").map(truthy).unwrap_or(false)
                    })
                    .unwrap_or(false)
            };
            if bot("discord") || bot("telegram") {
                return Some("a chat bot is enabled");
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_provider_preserves_aliases_vision_defaults_and_key_precedence() {
        let profile = tempfile::tempdir().unwrap();
        let dir = profile.path();
        save_config(
            dir,
            &json!({
                "provider": "minimax", "apiKey": "saved-primary",
                "vlm": {"provider": "minimax", "apiKey": "saved-vision"}
            }),
        )
        .unwrap();
        let prepared = prepare_runtime_provider(
            dir,
            &json!({
                "provider": "google", "baseUrl": "http://localhost:1234/v1", "model": "active-model",
                "vlm": {"provider":"minimax", "engine":"cloud", "baseUrl":"https://ollama.com"},
                "keys": {"vlm-minimax": "runtime-vision"}
            }),
        );
        assert_eq!(prepared["provider"], "gemini");
        assert_eq!(prepared["model"], "active-model");
        assert!(prepared.get("baseUrl").is_none());
        assert_eq!(prepared["vlm"]["model"], "MiniMax-M3");
        assert_eq!(prepared["vlm"]["baseUrl"], "https://api.minimax.io/v1");
        assert_eq!(prepared["vlm"]["apiKey"], "runtime-vision");
        let local = prepare_runtime_provider(
            dir,
            &json!({
                "provider":"local", "baseUrl":"http://localhost:11434",
                "vlm":{"provider":"ollama","model":"qwen3-vl:235b-instruct-cloud","apiKey":"explicit"}
            }),
        );
        assert_eq!(local["provider"], "ollama");
        assert_eq!(local["baseUrl"], "http://localhost:11434");
        assert_eq!(local["vlm"]["model"], "qwen3-vl:235b-cloud");
        assert_eq!(local["vlm"]["apiKey"], "explicit");
    }

    #[test]
    fn tool_provider_config_preserves_runtime_overrides_and_resolves_vision_keys() {
        let profile = tempfile::tempdir().unwrap();
        let dir = profile.path();
        save_config(
            dir,
            &json!({
                "provider": "openai", "model": "saved-model", "apiKey": "saved-key",
                "vlm": {"provider": "ollama", "apiKey": "saved-vision-key"}
            }),
        )
        .unwrap();
        let merged = resolve_tool_provider_config(
            dir,
            &json!({
                "model": "runtime-model", "keys": {"openai": "runtime-key"}
            }),
        );
        assert_eq!(merged["provider"], "openai");
        assert_eq!(merged["model"], "runtime-model");
        assert_eq!(merged["keys"]["openai"], "runtime-key");
        assert_eq!(merged["vlm"]["apiKey"], "saved-vision-key");

        let explicit = resolve_tool_provider_config(
            dir,
            &json!({
                "vlm": {"provider": "ollama-cloud"},
                "keys": {"vlm-ollama": "runtime-vision-key"}
            }),
        );
        assert_eq!(explicit["vlm"]["apiKey"], "runtime-vision-key");
        assert!(explicit.get("model").is_none());
    }

    #[test]
    fn saved_provider_config_keeps_secrets_in_separate_files() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        let input = json!({
            "provider": "openai", "apiKey": " primary-key ",
            "vlm": {"provider": "gemini", "apiKey": " vision-key ", "engine": "cloud"}
        });
        save_config(dir, &input).unwrap();
        let stored = fs::read_to_string(dir.join("config.json")).unwrap();
        let disk: Value = serde_json::from_str(&stored).unwrap();
        assert!(disk.get("apiKey").is_none());
        assert!(disk["vlm"].get("apiKey").is_none());
        assert_eq!(
            fs::read_to_string(dir.join("keys/openai.key")).unwrap(),
            "primary-key"
        );
        assert_eq!(
            fs::read_to_string(dir.join("keys/vlm-gemini.key")).unwrap(),
            "vision-key"
        );
        assert!(save_config(
            dir,
            &json!({
                "provider": "openai", "apiKey": "replacement",
                "vlm": {"provider": "../invalid", "apiKey": "rejected"}
            })
        )
        .is_err());
        assert_eq!(fs::read_to_string(dir.join("config.json")).unwrap(), stored);
        assert_eq!(
            fs::read_to_string(dir.join("keys/openai.key")).unwrap(),
            "primary-key"
        );
    }

    #[test]
    fn load_config_normalizes_and_hydrates_keys() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_config(dir.path())["config"], Value::Null);
        fs::create_dir(dir.path().join("keys")).unwrap();
        fs::write(dir.path().join("keys").join("openai.key"), "  sk-test  \n").unwrap();
        fs::write(
            dir.path().join("keys").join("vlm-ollama-cloud.key"),
            "oc-test",
        )
        .unwrap();
        fs::write(
            dir.path().join("config.json"),
            r#"{"provider":"openai","baseUrl":"http://localhost:1234","vlm":{"engine":"cloud","provider":"ollama"}}"#,
        )
        .unwrap();
        let c = &load_config(dir.path())["config"];
        assert_eq!(c["apiKey"], "sk-test");
        assert_eq!(c["keys"]["openai"], "sk-test");
        // vlm is set, so Object.assign keeps the top-level loopback baseUrl (as Node does).
        assert_eq!(c["baseUrl"], "http://localhost:1234");
        assert_eq!(c["vlm"]["enabled"], true);
        assert_eq!(c["vlm"]["model"], "qwen3-vl:235b-cloud");
        assert_eq!(c["vlm"]["baseUrl"], "https://ollama.com");
        assert_eq!(c["vlm"]["apiKey"], "oc-test");

        // Without vlm the same object is normalized, so the loopback baseUrl is dropped.
        fs::write(
            dir.path().join("config.json"),
            r#"{"provider":"openai","baseUrl":"http://127.0.0.1:1"}"#,
        )
        .unwrap();
        assert!(load_config(dir.path())["config"].get("baseUrl").is_none());
    }

    #[test]
    fn launch_check_finds_background_work() {
        let ef = tempfile::tempdir().unwrap();
        assert_eq!(node_needed_at_launch(ef.path()), None);
        fs::write(
            ef.path().join("integration-config.json"),
            r#"{"discord":{"enabled":true,"botToken":""}}"#,
        )
        .unwrap();
        assert_eq!(node_needed_at_launch(ef.path()), None);
        fs::write(
            ef.path().join("integration-config.json"),
            r#"{"telegram":{"enabled":true,"botToken":"t"}}"#,
        )
        .unwrap();
        assert!(node_needed_at_launch(ef.path()).is_some());
    }
}
