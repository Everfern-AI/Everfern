//! Streaming provider transport used by the compatibility agent over stdin/stdout.
use serde::Deserialize;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{collections::BTreeMap, io::Write, time::Duration};

#[derive(Deserialize)]
pub struct Request {
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    #[serde(rename = "bodyBase64")]
    body_base64: Option<String>,
}

fn validate_url(url: &reqwest::Url) -> Result<(), String> {
    // Provider endpoints are explicitly configured by the user; LAN and custom
    // HTTP model servers must remain usable alongside public HTTPS providers.
    if !matches!(url.scheme(), "https" | "http") || !url.username().is_empty() || url.password().is_some() {
        return Err("Invalid provider HTTP URL".into());
    }
    Ok(())
}

pub async fn relay(request: Request) -> Result<(), String> {
    let url = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    validate_url(&url)?;
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(30)).timeout(Duration::from_secs(600))
        .build().map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (name, value) in request.headers {
        if matches!(name.to_ascii_lowercase().as_str(), "host" | "connection" | "content-length" | "transfer-encoding" | "accept-encoding") { continue; }
        builder = builder.header(name, value);
    }
    builder = builder.header("Accept-Encoding", "identity");
    if let Some(body) = request.body_base64 {
        builder = builder.body(STANDARD.decode(body).map_err(|_| "Invalid binary request body")?);
    } else if let Some(body) = request.body { builder = builder.body(body); }
    let mut response = builder.send().await.map_err(|e| e.to_string())?;
    let headers: BTreeMap<_, _> = response.headers().iter().filter_map(|(name, value)| {
        value.to_str().ok().map(|value| (name.as_str().to_owned(), value.to_owned()))
    }).collect();
    let mut out = std::io::stdout();
    serde_json::to_writer(&mut out, &serde_json::json!({"status": response.status().as_u16(), "headers": headers})).map_err(|e| e.to_string())?;
    out.write_all(b"\n").and_then(|_| out.flush()).map_err(|e| e.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        out.write_all(&chunk).and_then(|_| out.flush()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allows_secure_providers_and_loopback_models() {
        for url in ["https://api.openai.com/v1/chat/completions", "http://127.0.0.1:11434/api/chat", "http://192.168.1.2:11434/api/chat"] { assert!(validate_url(&url.parse().unwrap()).is_ok()); }
        for url in ["ftp://example.com/", "https://secret@example.com/", "file:///etc/passwd"] { assert!(validate_url(&url.parse().unwrap()).is_err()); }
    }
}
