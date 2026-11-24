use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub async fn cached_catalog() -> Option<Value> {
    static CACHE: tokio::sync::Mutex<Option<(Instant, Value)>> =
        tokio::sync::Mutex::const_new(None);
    let mut cache = CACHE.lock().await;
    let fresh = cache
        .as_ref()
        .is_some_and(|(updated, _)| updated.elapsed() < Duration::from_secs(900));
    if !fresh {
        if let Some(catalog) = fetch_catalog().await {
            *cache = Some((Instant::now(), catalog));
        }
    }
    cache.as_ref().map(|(_, catalog)| catalog.clone())
}

pub async fn fetch_catalog() -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let base = std::env::var("EVERFERN_API_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| "https://api.everfern.app".into());
    let endpoint = format!(
        "{}/public/openrouter/model-capabilities",
        base.trim_end_matches('/')
    );
    if let Some(payload) = fetch(&client, &endpoint).await {
        return Some(json!({
            "reasoning": ids(&payload["reasoning_model_ids"], false),
            "imageGeneration": ids(&payload["image_model_ids"], false),
        }));
    }
    let image_client = client.clone();
    let images = tauri::async_runtime::spawn(async move {
        fetch(&image_client, "https://openrouter.ai/api/v1/images/models").await
    });
    let reasoning = fetch(
        &client,
        "https://openrouter.ai/api/v1/models?supported_parameters=reasoning",
    )
    .await;
    let images = images.await.ok().flatten();
    Some(json!({
        "reasoning": ids(&reasoning?["data"], true),
        "imageGeneration": ids(&images?["data"], true),
    }))
}

async fn fetch(client: &reqwest::Client, endpoint: &str) -> Option<Value> {
    let url = reqwest::Url::parse(endpoint).ok()?;
    crate::http::validate_url(&url).ok()?;
    client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()
}

fn ids(entries: &Value, objects: bool) -> Vec<String> {
    entries
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = if objects {
                entry["id"].as_str()
            } else {
                entry.as_str()
            };
            id.filter(|id| !id.is_empty()).map(str::to_lowercase)
        })
        .collect()
}
