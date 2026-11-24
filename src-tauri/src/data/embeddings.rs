use serde_json::{json, Value};
use std::path::Path;

#[test]
fn embedding_config_preserves_legacy_precedence_and_key_aliases() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_config(dir.path(), Some(" fallback ")),
        json!({"provider": "openai", "apiKey": "fallback"})
    );
    std::fs::create_dir(dir.path().join("keys")).unwrap();
    std::fs::write(dir.path().join("keys/google.key"), " test-alias ").unwrap();
    let mut config = json!({
        "provider": "openai", "embeddingProvider": "gemini",
        "embeddingBaseUrl": "https://example.test/legacy", "embeddingModel": "legacy-model",
        "embedding": {"baseUrl": " https://example.test/new ", "model": " current-model "}
    });
    let path = dir.path().join("config.json");
    std::fs::write(&path, config.to_string()).unwrap();
    assert_eq!(
        resolve_config(dir.path(), Some("fallback")),
        json!({
            "provider": "gemini", "apiKey": "test-alias",
            "baseUrl": "https://example.test/new", "model": "current-model"
        })
    );
    config["embedding"]["provider"] = json!("everfern");
    config["keys"]["everfern"] = json!(" saved-key ");
    std::fs::write(path, config.to_string()).unwrap();
    let result = resolve_config(dir.path(), Some("fallback"));
    assert_eq!(result["provider"], "everfern");
    assert_eq!(result["apiKey"], "saved-key");
    assert_eq!(result["baseUrl"], "https://api.everfern.app/api");
}

pub fn resolve_config(directory: &Path, environment_key: Option<&str>) -> Value {
    let saved = std::fs::read(directory.join("config.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let mut result = json!({"provider": "openai"});
    let sanitize = |value: &str| {
        value
            .trim()
            .chars()
            .filter(char::is_ascii)
            .collect::<String>()
    };
    let nonempty = |value: &Value| {
        value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let mut key = environment_key.map(str::to_owned);
    if let Some(saved) = saved {
        let provider = [
            &saved["embedding"]["provider"],
            &saved["embeddingProvider"],
            &saved["provider"],
        ]
        .into_iter()
        .find_map(nonempty)
        .unwrap_or_else(|| "openai".into());
        let model = [&saved["embedding"]["model"], &saved["embeddingModel"]]
            .into_iter()
            .find_map(nonempty);
        let base = if provider == "everfern" {
            Some("https://api.everfern.app/api".to_owned())
        } else {
            [
                &saved["embedding"]["baseUrl"],
                &saved["embeddingBaseUrl"],
                &saved["baseUrl"],
            ]
            .into_iter()
            .find_map(nonempty)
            .or_else(|| {
                let catalog: Value =
                    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/providers.json")))
                        .ok()?;
                let entry = catalog["providers"]
                    .as_array()?
                    .iter()
                    .find(|entry| entry["type"] == provider)?;
                nonempty(&entry["baseUrl"])
            })
        };
        let alias = match provider.as_str() {
            "gemini" => Some("google"),
            "google" => Some("gemini"),
            _ => None,
        };
        if let Some(saved_key) = nonempty(&saved["keys"][&provider])
            .or_else(|| alias.and_then(|alias| nonempty(&saved["keys"][alias])))
        {
            key = Some(saved_key);
        } else if provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            let read_key = |name: &str| {
                std::fs::read_to_string(directory.join("keys").join(format!("{name}.key"))).ok()
            };
            if let Some(raw) = read_key(&provider).or_else(|| alias.and_then(read_key)) {
                static KEY_PATTERN: std::sync::LazyLock<regex::Regex> =
                    std::sync::LazyLock::new(|| {
                        regex::Regex::new(r"nvapi-[A-Za-z0-9_-]+|sk-[A-Za-z0-9T\-]+").unwrap()
                    });
                key = Some(
                    KEY_PATTERN
                        .find(raw.trim())
                        .map_or(raw.trim(), |matched| matched.as_str())
                        .to_owned(),
                );
            }
        }
        let provider = sanitize(&provider);
        if !provider.is_empty() {
            result["provider"] = json!(provider);
        }
        for (field, value) in [("baseUrl", base), ("model", model)] {
            if let Some(value) = value
                .map(|value| sanitize(&value))
                .filter(|value| !value.is_empty())
            {
                result[field] = json!(value);
            }
        }
    }
    if let Some(key) = key
        .map(|value| sanitize(&value))
        .filter(|value| !value.is_empty())
    {
        result["apiKey"] = json!(key);
    }
    result
}

pub async fn embed_query(request: &Value) -> Result<Value, String> {
    let text = request["text"].as_str().ok_or("Expected embedding input")?;
    let vectors = embed(&request["config"], &[text]).await?;
    vectors
        .into_iter()
        .next()
        .ok_or("Embedding response has no vector".into())
}

pub async fn embed_documents(request: &Value) -> Result<Value, String> {
    let texts = request["texts"]
        .as_array()
        .ok_or("Expected embedding inputs")?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()
        .ok_or("Expected embedding text")?;
    if texts.is_empty() {
        return Ok(json!([]));
    }
    let config = &request["config"];
    if config["provider"] == "gemini" {
        let mut vectors = Vec::with_capacity(texts.len());
        for text in texts {
            vectors.extend(embed(config, &[text]).await?);
        }
        return Ok(Value::Array(vectors));
    }
    Ok(Value::Array(embed(config, &texts).await?))
}

async fn embed(config: &Value, texts: &[&str]) -> Result<Vec<Value>, String> {
    let text = texts[0];
    let provider = config["provider"].as_str().unwrap_or("openai");
    let model = |default| {
        config["model"]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or(default)
    };
    let base = |default| {
        config["baseUrl"]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or(default)
            .trim_end_matches('/')
    };
    let key = config["apiKey"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("dummy");
    let (url, body) = match provider {
        "ollama" | "lmstudio" => (
            format!("{}/api/embed", base("http://localhost:11434")),
            json!({"model": model("nomic-embed-text"), "input": texts}),
        ),
        "gemini" => {
            let model = model("gemini-embedding-001").trim_start_matches("models/");
            let mut url =
                reqwest::Url::parse("https://generativelanguage.googleapis.com/v1beta/models")
                    .unwrap();
            url.path_segments_mut()
                .map_err(|_| "Invalid Gemini endpoint")?
                .push(&format!("{model}:embedContent"));
            (
                url.to_string(),
                json!({"model": format!("models/{model}"), "content": {"parts": [{"text": text}]}}),
            )
        }
        "nvidia" => (
            format!("{}/embeddings", base("https://integrate.api.nvidia.com/v1")),
            json!({"model": model("nvidia/nv-embedqa-e5-v5"), "input": texts, "input_type": "query", "encoding_format": "float"}),
        ),
        "everfern" | "minimax" => {
            let (default, endpoint) = if provider == "everfern" {
                ("https://api.everfern.app/api", "/embedding/vectors")
            } else {
                ("https://api.minimax.io/v1", "/embeddings")
            };
            let base = base(default);
            let url = if base.ends_with(endpoint) {
                base.to_owned()
            } else {
                format!("{base}{endpoint}")
            };
            let body = if provider == "everfern" {
                json!({"input": text, "model": model("openai/text-embedding-3-small")})
            } else {
                json!({"texts": texts, "model": model("embo-01"), "type": "db"})
            };
            (url, body)
        }
        _ => {
            let default = if provider == "openrouter" {
                "https://openrouter.ai/api/v1"
            } else {
                "https://api.openai.com/v1"
            };
            (
                format!("{}/embeddings", base(default)),
                json!({"model": model("text-embedding-3-small"), "input": texts, "encoding_format": "float"}),
            )
        }
    };
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid embedding endpoint")?;
    crate::http::validate_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.post(url).json(&body);
    request = match provider {
        "ollama" | "lmstudio" => request,
        "gemini" => request.header(
            "x-goog-api-key",
            config["apiKey"].as_str().unwrap_or_default(),
        ),
        _ => request.bearer_auth(key),
    };
    let response = request
        .send()
        .await
        .map_err(|error| error.without_url().to_string())?;
    if !response.status().is_success() {
        return Err(format!("Embedding provider returned {}", response.status()));
    }
    let data: Value = response
        .json()
        .await
        .map_err(|error| error.without_url().to_string())?;
    let vectors = match provider {
        "ollama" | "lmstudio" => data["embeddings"]
            .as_array()
            .ok_or("Missing embeddings")?
            .iter()
            .collect(),
        "gemini" => vec![&data["embedding"]["values"]],
        "minimax"
            if data["base_resp"]["status_code"]
                .as_i64()
                .is_some_and(|status| status != 0) =>
        {
            return Err("MiniMax embedding request failed".into())
        }
        "minimax" => data["vectors"]
            .as_array()
            .ok_or("Missing embeddings")?
            .iter()
            .collect(),
        "everfern" => {
            let first = &data["data"][0]["embedding"];
            vec![
                if first.is_null() {
                    &data["embedding"]
                } else {
                    first
                };
                texts.len()
            ]
        }
        _ => {
            let mut entries: Vec<_> = data["data"]
                .as_array()
                .ok_or("Missing embeddings")?
                .iter()
                .collect();
            entries.sort_by_key(|entry| entry["index"].as_u64().unwrap_or_default());
            entries
                .into_iter()
                .map(|entry| &entry["embedding"])
                .collect()
        }
    };
    if vectors.len() != texts.len() {
        return Err("Embedding response count does not match request".into());
    }
    vectors.into_iter().map(normalize).collect()
}

fn normalize(vector: &Value) -> Result<Value, String> {
    let entries = vector
        .as_array()
        .filter(|entries| !entries.is_empty())
        .ok_or("Embedding response has no vector")?;
    let mut values = entries
        .iter()
        .take(1536)
        .map(Value::as_f64)
        .collect::<Option<Vec<_>>>()
        .ok_or("Invalid embedding vector")?;
    if entries.len() != 1536 {
        values.resize(1536, 0.0);
        let norm = values.iter().map(|value| value * value).sum::<f64>().sqrt();
        if norm > 0.0 {
            for value in &mut values {
                *value /= norm;
            }
        }
    }
    Ok(json!(values))
}

#[test]
fn normalization_matches_existing_embedding_dimensions() {
    let padded = normalize(&json!([3, 4])).unwrap();
    let values = padded.as_array().unwrap();
    assert_eq!(values.len(), 1536);
    assert_eq!(values[0].as_f64(), Some(0.6));
    assert_eq!(values[1].as_f64(), Some(0.8));
    assert!(values[2..].iter().all(|value| value.as_f64() == Some(0.0)));

    let complete = json!(vec![2.0; 1536]);
    assert_eq!(normalize(&complete).unwrap(), complete);
    let mut oversized = vec![0.0; 1537];
    oversized[0] = 2.0;
    oversized[1536] = 10.0;
    assert_eq!(normalize(&json!(oversized)).unwrap()[0].as_f64(), Some(1.0));
    assert!(normalize(&json!(["invalid"])).is_err());
}

#[test]
fn batch_embeddings_preserve_input_order() {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => panic!("Could not accept embedding request: {error}"),
            }
        };
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.starts_with("POST /v1/embeddings "));
        let mut length = 0;
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["input"], json!(["first", "second"]));
        let response = r#"{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}"#;
        write!(
            reader.get_mut(),
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
            response.len()
        )
        .unwrap();
    });
    let request = json!({"config": {"provider": "openai", "baseUrl": format!("http://{addr}/v1")},
        "texts": ["first", "second"]});
    let result = tauri::async_runtime::block_on(embed_documents(&request));
    server.join().unwrap();
    let result = result.unwrap();
    assert_eq!(result[0][0].as_f64(), Some(1.0));
    assert_eq!(result[1][1].as_f64(), Some(1.0));
}
