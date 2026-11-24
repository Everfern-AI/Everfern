use serde::de::{MapAccess, Visitor};
use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Deserialize)]
struct PricingCache {
    ts: i64,
    #[serde(deserialize_with = "ordered_entries")]
    cache: Vec<(String, Value)>,
}

struct OrderedEntries(Vec<(String, Value)>);

impl serde::Serialize for OrderedEntries {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (id, entry) in &self.0 {
            map.serialize_entry(id, entry)?;
        }
        map.end()
    }
}

pub async fn refresh(directory: &Path) -> Option<()> {
    static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = REFRESH.lock().await;
    if is_fresh(directory) {
        return Some(());
    }
    let client = reqwest::Client::builder()
        .user_agent("EverFern/1.0")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let payload: Value = client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    let entries = payload["data"].as_array()?.iter().filter_map(|model| {
        let id = model["id"].as_str().filter(|id| !id.is_empty())?;
        let rate = |key: &str| model["pricing"][key].as_str()
            .and_then(|value| value.parse::<f64>().ok()).unwrap_or_default() * 1_000_000.0;
        Some((id.to_string(), json!({
            "displayName": model["name"].as_str().filter(|name| !name.is_empty()).unwrap_or(id),
            "provider": id.split('/').next().filter(|part| !part.is_empty()).unwrap_or("unknown"),
            "contextWindow": model["context_length"].as_u64().filter(|count| *count != 0).unwrap_or(150000),
            "inputCostPer1M": rate("prompt"), "outputCostPer1M": rate("completion")
        })))
    }).collect::<Vec<_>>();
    if entries.is_empty() {
        return None;
    }
    #[derive(serde::Serialize)]
    struct SavedCache {
        ts: i64,
        cache: OrderedEntries,
    }
    let now = chrono::Utc::now();
    let cache = SavedCache {
        ts: now.timestamp_millis(),
        cache: OrderedEntries(entries),
    };
    let bytes = serde_json::to_vec(&cache).ok()?;
    let file_saved =
        crate::store::atomic_write(&directory.join("pricing-cache.json"), &bytes).is_ok();
    let path = directory.join("sql").join("memory.sqlite");
    let db_saved = tauri::async_runtime::spawn_blocking(move || {
        super::db::save_pricing(&path, &cache.cache.0, &now.to_rfc3339()).is_ok()
    })
    .await
    .unwrap_or(false);
    (file_saved || db_saved).then_some(())
}

fn ordered_entries<'de, D: Deserializer<'de>>(
    decoder: D,
) -> Result<Vec<(String, Value)>, D::Error> {
    struct Entries;
    impl<'de> Visitor<'de> for Entries {
        type Value = Vec<(String, Value)>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a pricing cache object")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut entries = Vec::new();
            while let Some(entry) = map.next_entry()? {
                entries.push(entry);
            }
            Ok(entries)
        }
    }
    decoder.deserialize_map(Entries)
}

fn load_cache(directory: &Path) -> Option<PricingCache> {
    let bytes = std::fs::read(directory.join("pricing-cache.json")).ok()?;
    let cache: PricingCache = serde_json::from_slice(&bytes).ok()?;
    (cache.ts > 0 && !cache.cache.is_empty()).then_some(cache)
}

fn load_entries(directory: &Path) -> Option<Vec<(String, Value)>> {
    if let Some(cache) = load_cache(directory) {
        return Some(cache.cache);
    }
    let path = directory.join("sql").join("memory.sqlite");
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let entries = super::db::cached_pricing(&conn).ok()?;
    (!entries.is_empty()).then_some(entries)
}

pub fn is_fresh(directory: &Path) -> bool {
    let now = chrono::Utc::now().timestamp_millis();
    load_cache(directory).is_some_and(|cache| now.saturating_sub(cache.ts) <= 6 * 60 * 60 * 1000)
}

pub fn cached_model_info(directory: &Path, id: &str) -> Option<Value> {
    let entries = load_entries(directory)?;
    let lower = id.to_lowercase();
    let entry = entries.iter().find(|(key, _)| key == id).or_else(|| {
        entries.iter().find(|(key, _)| {
            let key = key.to_lowercase();
            key.contains(&lower) || lower.contains(key.rsplit('/').next().unwrap_or_default())
        })
    });
    Some(match entry {
        Some((_, entry)) => json!({
            "contextWindow": entry["contextWindow"], "inputCostPer1M": entry["inputCostPer1M"],
            "outputCostPer1M": entry["outputCostPer1M"]
        }),
        None => default_model_info(),
    })
}

pub fn default_model_info() -> Value {
    json!({"contextWindow": 150000, "inputCostPer1M": 0, "outputCostPer1M": 0})
}

pub fn cached_list(directory: &Path) -> Option<Value> {
    let entries = load_entries(directory)?;
    Some(Value::Array(entries.into_iter().map(|(id, entry)| {
        json!({
            "modelId": id, "provider": entry["provider"], "displayName": entry["displayName"],
            "contextWindow": entry["contextWindow"], "inputCostPer1M": entry["inputCostPer1M"],
            "outputCostPer1M": entry["outputCostPer1M"]
        })
    }).collect()))
}

#[test]
fn pricing_reads_legacy_sqlite_and_preserves_json_match_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sql").join("memory.sqlite");
    let entry = json!({
        "provider": "vendor", "displayName": "Legacy model",
        "contextWindow": 32000, "inputCostPer1M": 2, "outputCostPer1M": 4
    });
    super::db::save_pricing(&path, &[("vendor/legacy".to_owned(), entry)], "2026-01-01").unwrap();
    assert_eq!(
        cached_list(dir.path()).unwrap()[0]["modelId"],
        "vendor/legacy"
    );
    assert_eq!(
        cached_model_info(dir.path(), "legacy").unwrap()["contextWindow"],
        32000
    );

    std::fs::write(
        dir.path().join("pricing-cache.json"),
        r#"{
        "ts": 1, "cache": {
            "z/model-first": {"contextWindow": 64000},
            "a/model-second": {"contextWindow": 128000}
        }
    }"#,
    )
    .unwrap();
    assert_eq!(
        cached_list(dir.path()).unwrap()[0]["modelId"],
        "z/model-first"
    );
    assert_eq!(
        cached_model_info(dir.path(), "model").unwrap()["contextWindow"],
        64000
    );
    assert_eq!(
        cached_model_info(dir.path(), "a/model-second").unwrap()["contextWindow"],
        128000
    );
    assert!(!is_fresh(dir.path()));
}
