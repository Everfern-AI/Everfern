//! Native cloud transport. Credentials are attached only to the EverFern API.
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use std::sync::OnceLock;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Serialize)]
pub struct CloudResponse {
    status: u16,
    ok: bool,
    data: Value,
}

fn validate_path(path: &str) -> Result<(), String> {
    let route = path.split('?').next().unwrap_or("");
    if !(route == "/api/cloud-vms" || route.starts_with("/api/cloud-vms/")
        || route.starts_with("/api/cloud-machines/"))
        || path.contains('\\') || path.contains("..") || path.contains('#')
        || path.to_ascii_lowercase().contains("%2e") || path.to_ascii_lowercase().contains("%2f")
    {
        return Err("Invalid cloud API route".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn ef_cloud_request(path: String, method: String, token: String, body: Option<String>) -> Result<CloudResponse, String> {
    validate_path(&path)?;
    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => return Err("Unsupported cloud method".into()),
    };
    if token.is_empty() { return Err("Sign in to EverFern Cloud first".into()); }
    let client = if let Some(client) = CLIENT.get() { client.clone() } else {
        let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(150))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 EverFern/1.3")
        .build().map_err(|e| e.to_string())?;
        let _ = CLIENT.set(client.clone());
        CLIENT.get().cloned().unwrap_or(client)
    };
    let mut request = client.request(method, format!("https://api.everfern.app{path}"))
        .bearer_auth(token).header("Content-Type", "application/json");
    if let Some(body) = body { request = request.body(body); }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let data = response.json::<Value>().await.unwrap_or_else(|_| serde_json::json!({}));
    Ok(CloudResponse { status: status.as_u16(), ok: status.is_success(), data })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_requests_to_cloud_routes() {
        for path in ["https://evil.test", "/api/cloud-vms/../auth", "/api/cloud-vms\\evil", "/api/auth"] {
            assert!(validate_path(path).is_err());
        }
        assert!(validate_path("/api/cloud-vms/vps-contabo/browser-control").is_ok());
        assert!(validate_path("/api/cloud-machines/assign").is_ok());
    }
}
