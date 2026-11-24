//! Native implementation of the agent's `web_fetch` tool.
//!
//! Worker requests are restricted to public HTTP(S) destinations and redirects are
//! checked one hop at a time. Normal desktop requests retain access to local pages.

use regex::Regex;
use serde_json::{json, Map, Value};
use std::{net::IpAddr, sync::LazyLock, time::Duration};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_CHARS: usize = 100_000;

static SCRIPT_STYLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<(?:script|style|noscript)\b[^>]*>.*?</(?:script|style|noscript)\s*>")
        .unwrap()
});
static COMMENTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static BREAKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<(?:br|hr)\s*/?>").unwrap());
static CLOSE_BLOCKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)</(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|aside)\s*>",
    )
    .unwrap()
});
static OPEN_BLOCKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|aside)\b[^>]*>").unwrap()
});
static ANCHORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a\s*>"#).unwrap());
static IMAGE_ALT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<img[^>]*alt=["']([^"']*)["'][^>]*>"#).unwrap());
static IMAGES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<img[^>]*>").unwrap());
static LIST_ITEMS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<li\b[^>]*>").unwrap());
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
static NUMERIC_ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&#(?:(\d+)|[xX]([0-9a-fA-F]+));").unwrap());
static SPACE_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]+").unwrap());
static MANY_NEWLINES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n\s*\n\s*\n").unwrap());
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title\s*>").unwrap());

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                if value.is_null() {
                    String::new()
                } else {
                    js_string(value)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
        _ => value.to_string(),
    }
}

fn input_url(request: &Value) -> String {
    if let Some(value) = request.as_str() {
        return value.trim().to_owned();
    }
    let keys = [
        "url",
        "Url",
        "URL",
        "targetUrl",
        "target_url",
        "link",
        "uri",
        "href",
        "endpoint",
    ];
    keys.iter()
        .find_map(|key| request.get(*key).filter(|value| !value.is_null()))
        .map(js_string)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn result_error(output: String, error: impl Into<String>) -> Value {
    json!({"success": false, "output": output, "error": error.into()})
}

fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 100 && (64..=127).contains(&b))
                || a >= 224
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4() {
                return private_ip(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            ip.is_unspecified()
                || ip.is_loopback()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
                || ip.is_multicast()
        }
    }
}

fn private_host_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".lan")
        || host.ends_with(".home.arpa")
        || host.parse::<IpAddr>().is_ok_and(private_ip)
        || host.parse::<u128>().is_ok()
        || host.starts_with("0x")
}

async fn assert_public_url(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Workers cannot fetch addresses on this computer or its local network.".into());
    }
    let host = url.host_str().unwrap_or_default().trim_end_matches('.');
    if private_host_name(host) {
        return Err("Workers cannot fetch addresses on this computer or its local network.".into());
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| format!("Could not find {host}."))?
        .map(|address| address.ip())
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(format!("Could not find {host}."));
    }
    if addresses.into_iter().any(private_ip) {
        return Err(format!(
            "{host} points to an address on a local network, which workers cannot fetch."
        ));
    }
    Ok(())
}

fn fetch_client(public_only: bool) -> Result<reqwest::Client, String> {
    let redirect = if public_only {
        reqwest::redirect::Policy::none()
    } else {
        reqwest::redirect::Policy::limited(20)
    };
    reqwest::Client::builder()
        .redirect(redirect)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())
}

fn page_request(client: &reqwest::Client, url: reqwest::Url) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .header(
            "Sec-Ch-Ua",
            "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
        )
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1")
}

async fn fetch_public(
    client: &reqwest::Client,
    initial: reqwest::Url,
) -> Result<reqwest::Response, String> {
    let mut current = initial;
    for hop in 0..=5 {
        assert_public_url(&current).await?;
        let response = page_request(client, current.clone())
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !(300..400).contains(&response.status().as_u16()) {
            return Ok(response);
        }
        let Some(location) = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
        else {
            return Ok(response);
        };
        if hop == 5 {
            return Err("Too many redirects.".into());
        }
        current = current.join(location).map_err(|error| error.to_string())?;
    }
    Err("Too many redirects.".into())
}

async fn fetch_with_curl(url: &str) -> Option<String> {
    let binary = if cfg!(windows) { "curl.exe" } else { "curl" };
    let output = tokio::process::Command::new(binary)
        .args([
            "-sSL",
            "-A",
            USER_AGENT,
            "--max-time",
            "20",
            "--max-filesize",
            "10485760",
            url,
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn decode_entities(value: &str) -> String {
    let named = value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'");
    let mut units = Vec::new();
    let mut cursor = 0;
    for captures in NUMERIC_ENTITY.captures_iter(&named) {
        let whole = captures.get(0).unwrap();
        units.extend(named[cursor..whole.start()].encode_utf16());
        let code = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u128>().ok())
            .or_else(|| {
                captures
                    .get(2)
                    .and_then(|value| u128::from_str_radix(value.as_str(), 16).ok())
            });
        if let Some(code) = code {
            // String.fromCharCode, used by the original tool, converts each reference
            // to one UTF-16 code unit. Collecting units also joins explicit surrogate
            // pairs while decoding the final text.
            units.push(code as u16);
        } else {
            units.extend(whole.as_str().encode_utf16());
        }
        cursor = whole.end();
    }
    units.extend(named[cursor..].encode_utf16());
    String::from_utf16_lossy(&units)
}

fn html_to_text(html: &str) -> String {
    let mut text = SCRIPT_STYLE.replace_all(html, "").into_owned();
    text = COMMENTS.replace_all(&text, "").into_owned();
    text = BREAKS.replace_all(&text, "\n").into_owned();
    text = CLOSE_BLOCKS.replace_all(&text, "\n").into_owned();
    text = OPEN_BLOCKS.replace_all(&text, "\n").into_owned();
    text = ANCHORS.replace_all(&text, "$2 ($1)").into_owned();
    text = IMAGE_ALT.replace_all(&text, "[$1]").into_owned();
    text = IMAGES.replace_all(&text, "[image]").into_owned();
    text = LIST_ITEMS.replace_all(&text, "- ").into_owned();
    text = TAGS.replace_all(&text, "").into_owned();
    text = decode_entities(&text);
    text = SPACE_RUN.replace_all(&text, " ").into_owned();
    text = MANY_NEWLINES.replace_all(&text, "\n\n").into_owned();
    text.split('\n')
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_owned()
}

fn decode_basic(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn extract_title(html: &str) -> Option<String> {
    TITLE
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| decode_basic(value.as_str()).trim().to_owned())
}

fn meta_value(html: &str, property: &str) -> Option<String> {
    let property = regex::escape(property);
    let first = Regex::new(&format!(
        r#"(?is)<meta[^>]*?(?:name|property)=["']{property}["'][^>]*?content=["'](.*?)["']"#
    ))
    .ok()?;
    let second = Regex::new(&format!(
        r#"(?is)<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']{property}["']"#
    ))
    .ok()?;
    first
        .captures(html)
        .or_else(|| second.captures(html))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
}

fn extract_metadata(html: &str) -> Map<String, Value> {
    let mut metadata = Map::new();
    if let Some(value) =
        meta_value(html, "description").or_else(|| meta_value(html, "og:description"))
    {
        metadata.insert(
            "description".into(),
            json!(value.replace("&amp;", "&").trim()),
        );
    }
    if let Some(value) = meta_value(html, "author") {
        metadata.insert("author".into(), json!(value.replace("&amp;", "&").trim()));
    }
    if let Some(value) = meta_value(html, "keywords") {
        metadata.insert("keywords".into(), json!(value.replace("&amp;", "&").trim()));
    }
    metadata
}

fn js_length(value: &str) -> usize {
    value.encode_utf16().count()
}

fn truncate_js(value: &str, limit: usize) -> (String, bool) {
    let mut out = String::new();
    let mut units = 0;
    for character in value.chars() {
        let size = character.len_utf16();
        if units + size > limit {
            return (out, true);
        }
        units += size;
        out.push(character);
    }
    (out, false)
}

fn failure_status(url: &str, status: reqwest::StatusCode) -> Value {
    let reason = status.canonical_reason().unwrap_or("");
    result_error(
        format!(
            "Error: HTTP {} {} when fetching {url}",
            status.as_u16(),
            reason
        ),
        format!("http_{}", status.as_u16()),
    )
}

pub async fn execute(request: &Value) -> Value {
    let any_args = request.get("args").unwrap_or(request);
    let mut raw_url = input_url(any_args);
    raw_url = raw_url
        .trim_matches(|character| matches!(character, '"' | '\'' | '`' | '<' | '>' | '[' | ']'))
        .trim()
        .to_owned();
    if raw_url.is_empty() {
        return result_error(
            "Error: URL parameter is missing. Provide a valid URL like https://example.com".into(),
            "missing_url",
        );
    }
    let normalized = if raw_url
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("http://"))
        || raw_url
            .get(..8)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
    {
        raw_url.clone()
    } else {
        format!("https://{raw_url}")
    };
    let url = match reqwest::Url::parse(&normalized) {
        Ok(url) => url,
        Err(_) => {
            return result_error(
                format!(
                "Error: Invalid URL \"{raw_url}\". Provide a valid URL like https://example.com"
            ),
                "invalid_url",
            )
        }
    };
    let public_only = request["__publicOnly"] == true || any_args["__publicOnly"] == true;
    if public_only {
        if let Err(error) = assert_public_url(&url).await {
            return result_error(format!("Error: {error}"), "blocked_private_address");
        }
    }

    let client = match fetch_client(public_only) {
        Ok(client) => client,
        Err(error) => return result_error(format!("Error fetching {normalized}: {error}"), error),
    };
    let fetched = if public_only {
        fetch_public(&client, url.clone()).await
    } else {
        page_request(&client, url.clone())
            .send()
            .await
            .map_err(|error| error.to_string())
    };

    let (html, content_type) = match fetched {
        Ok(response) if !response.status().is_success() && public_only => {
            return failure_status(&normalized, response.status())
        }
        Ok(response) if !response.status().is_success() => {
            match fetch_with_curl(&normalized).await {
                Some(text) => (text, "text/html".to_owned()),
                None => return failure_status(&normalized, response.status()),
            }
        }
        Ok(response) => {
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_owned();
            match response.text().await {
                Ok(text) => (text, content_type),
                Err(error) => {
                    if !public_only {
                        if let Some(text) = fetch_with_curl(&normalized).await {
                            (text, "text/html".into())
                        } else if error.is_timeout() {
                            return result_error(
                                format!(
                                    "Error: Request to {normalized} timed out after 20 seconds."
                                ),
                                "timeout",
                            );
                        } else {
                            return result_error(
                                format!("Error fetching {normalized}: {error}"),
                                error.to_string(),
                            );
                        }
                    } else if error.is_timeout() {
                        return result_error(
                            format!("Error: Request to {normalized} timed out after 20 seconds."),
                            "timeout",
                        );
                    } else {
                        return result_error(
                            format!("Error fetching {normalized}: {error}"),
                            error.to_string(),
                        );
                    }
                }
            }
        }
        Err(error) => {
            if !public_only {
                if let Some(text) = fetch_with_curl(&normalized).await {
                    (text, "text/html".into())
                } else if error.to_ascii_lowercase().contains("timed out")
                    || error.to_ascii_lowercase().contains("timeout")
                {
                    return result_error(
                        format!("Error: Request to {normalized} timed out after 20 seconds."),
                        "timeout",
                    );
                } else {
                    return result_error(format!("Error fetching {normalized}: {error}"), error);
                }
            } else if error.to_ascii_lowercase().contains("timed out")
                || error.to_ascii_lowercase().contains("timeout")
            {
                return result_error(
                    format!("Error: Request to {normalized} timed out after 20 seconds."),
                    "timeout",
                );
            } else {
                return result_error(format!("Error fetching {normalized}: {error}"), error);
            }
        }
    };

    let title = extract_title(&html);
    let metadata = extract_metadata(&html);
    let trimmed = html.trim();
    let is_json = content_type.contains("application/json")
        || ((trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']')));
    let text = if is_json {
        serde_json::from_str::<Value>(&html)
            .ok()
            .and_then(|value| serde_json::to_string_pretty(&value).ok())
            .unwrap_or(html)
    } else {
        html_to_text(&html)
    };
    let (text, truncated) = truncate_js(&text, MAX_CHARS);
    let content_length = js_length(&text);
    let mut output = Vec::new();
    if let Some(title) = &title {
        output.push(format!("# {title}"));
    }
    if !metadata.is_empty() {
        output.push(
            metadata
                .iter()
                .map(|(key, value)| format!("**{key}**: {}", value.as_str().unwrap_or_default()))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    output.push(format!("**URL**: {normalized}"));
    output.push(format!("**Content-Type**: {content_type}"));
    output.push(String::new());
    output.push(text);
    if truncated {
        output.push("\n\n[Content truncated — page exceeded 100k characters]".into());
    }
    let mut data = json!({
        "url": normalized, "metadata": metadata,
        "contentLength": content_length, "truncated": truncated, "contentType": content_type
    });
    if let Some(title) = &title {
        data["title"] = json!(title);
    }
    json!({
        "success": true,
        "output": output.join("\n"),
        "data": data
    })
}
