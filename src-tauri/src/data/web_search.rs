//! Native web-search tool used by the agent runner.

use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;

#[derive(Clone, Debug)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

const SEARCH_AGENT: &str = "EverFern Desktop/1.0";
const PAGE_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

static ANCHORS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a\s*>"#).unwrap()
});
static GOOGLE_RESULTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h3\b[^>]*>(.*?)</h3\s*>\s*</a\s*>"#)
        .unwrap()
});
static YAHOO_RESULTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<h3\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a\s*>\s*</h3\s*>"#)
        .unwrap()
});
static GOOGLE_SNIPPETS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<(?:div|span)\b[^>]*class=["'](?:[^"']*\s)?s(?:\s[^"']*)?["'][^>]*>(.*?)</(?:div|span)\s*>"#).unwrap()
});
static YAHOO_SNIPPETS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<[^>]+class=["'][^"']*compText[^"']*["'][^>]*>(.*?)</[^>]+>"#).unwrap()
});
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static LITE_SNIPPETS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)class=["']result-snippet["'][^>]*>(.*?)</td>"#).unwrap());
static META: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<meta\b[^>]*?(?:name|property)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>|<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:name|property)=["']([^"']+)["'][^>]*>"#).unwrap()
});
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title\s*>").unwrap());

fn decode_html(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
}

fn clean_html(input: &str) -> String {
    let without_tags = TAGS.replace_all(input, " ");
    SPACES
        .replace_all(&decode_html(&without_tags), " ")
        .trim()
        .to_string()
}

fn is_search_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "google.com"
        || host.ends_with(".google.com")
        || host == "yahoo.com"
        || host.ends_with(".yahoo.com")
        || host == "duckduckgo.com"
        || host.ends_with(".duckduckgo.com")
}

fn result_url(raw: &str, engine: &str) -> Option<String> {
    let base = reqwest::Url::parse(match engine {
        "Google" => "https://www.google.com/",
        "Yahoo" => "https://search.yahoo.com/",
        _ => "https://lite.duckduckgo.com/",
    })
    .ok()?;
    if engine == "Yahoo" {
        if let Some(start) = raw.find("RU=") {
            let target = &raw[start + 3..];
            let target = target.split("/RK").next().unwrap_or(target);
            let target = percent_decode(target);
            if target.starts_with("http://") || target.starts_with("https://") {
                return Some(target);
            }
        }
    }
    let mut url = base.join(&decode_html(raw)).ok()?;
    if engine == "Google" && url.host_str().is_some_and(|host| is_search_host(host)) {
        if let Some(target) = url.query_pairs().find_map(|(key, value)| {
            matches!(key.as_ref(), "q" | "url").then(|| value.into_owned())
        }) {
            url = reqwest::Url::parse(&target).ok()?;
        }
    }
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none_or(is_search_host) {
        return None;
    }
    Some(url.to_string())
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push(((high << 4) | low) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn extract_anchor_results(html: &str, engine: &str, max: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for captures in ANCHORS.captures_iter(html) {
        let Some(href) = captures.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let Some(url) = result_url(href, engine) else {
            continue;
        };
        let title = clean_html(captures.get(2).map(|m| m.as_str()).unwrap_or_default());
        if title.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        results.push(SearchResult {
            title,
            url,
            snippet: String::new(),
        });
        if results.len() >= max {
            break;
        }
    }
    results
}

fn extract_engine_results(html: &str, engine: &str) -> Vec<SearchResult> {
    let (matches, snippets) = if engine == "Google" {
        (
            GOOGLE_RESULTS.captures_iter(html).collect::<Vec<_>>(),
            GOOGLE_SNIPPETS
                .captures_iter(html)
                .filter_map(|capture| capture.get(1).map(|value| clean_html(value.as_str())))
                .collect::<Vec<_>>(),
        )
    } else {
        (
            YAHOO_RESULTS.captures_iter(html).collect::<Vec<_>>(),
            YAHOO_SNIPPETS
                .captures_iter(html)
                .filter_map(|capture| capture.get(1).map(|value| clean_html(value.as_str())))
                .collect::<Vec<_>>(),
        )
    };
    let mut results = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for capture in matches {
        let Some(raw_url) = capture.get(1).map(|value| value.as_str()) else {
            continue;
        };
        let Some(url) = result_url(raw_url, engine) else {
            continue;
        };
        let title = clean_html(
            capture
                .get(2)
                .map(|value| value.as_str())
                .unwrap_or_default(),
        );
        if title.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        let snippet = snippets.get(results.len()).cloned().unwrap_or_default();
        results.push(SearchResult {
            title,
            url,
            snippet,
        });
        if results.len() == 8 {
            break;
        }
    }
    results
}

fn request_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(SEARCH_AGENT)
        .build()
        .map_err(|error| error.to_string())
}

async fn search_via_engine(engine: &str, query: &str) -> Vec<SearchResult> {
    let Ok(client) = request_client(Duration::from_secs(8)) else {
        return Vec::new();
    };
    let mut url = match engine {
        "Google" => match reqwest::Url::parse("https://www.google.com/search") {
            Ok(url) => url,
            Err(_) => return Vec::new(),
        },
        _ => match reqwest::Url::parse("https://search.yahoo.com/search") {
            Ok(url) => url,
            Err(_) => return Vec::new(),
        },
    };
    url.query_pairs_mut()
        .append_pair(if engine == "Google" { "q" } else { "p" }, query);
    let response = match client
        .get(url)
        .header("User-Agent", PAGE_AGENT)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        _ => return Vec::new(),
    };
    let Ok(html) = response.text().await else {
        return Vec::new();
    };
    extract_engine_results(&html, engine)
}

async fn search_ddg(query: &str) -> Vec<SearchResult> {
    let Ok(client) = request_client(Duration::from_secs(6)) else {
        return Vec::new();
    };
    let mut url = match reqwest::Url::parse("https://api.duckduckgo.com/") {
        Ok(url) => url,
        Err(_) => return Vec::new(),
    };
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("format", "json")
        .append_pair("no_html", "1")
        .append_pair("skip_disambig", "1");
    if let Ok(response) = client.get(url).send().await {
        if response.status().is_success() {
            if let Ok(data) = response.json::<Value>().await {
                let mut results = Vec::new();
                if let (Some(url), Some(snippet)) = (
                    data["AbstractURL"]
                        .as_str()
                        .filter(|value| !value.is_empty()),
                    data["Abstract"].as_str().filter(|value| !value.is_empty()),
                ) {
                    let title = data["Heading"]
                        .as_str()
                        .filter(|value| !value.is_empty())
                        .unwrap_or(query);
                    results.push(SearchResult {
                        title: title.into(),
                        url: url.into(),
                        snippet: snippet.into(),
                    });
                }
                if let Some(topics) = data["RelatedTopics"].as_array() {
                    for topic in topics {
                        let (Some(text), Some(url)) =
                            (topic["Text"].as_str(), topic["FirstURL"].as_str())
                        else {
                            continue;
                        };
                        if text.is_empty() || url.is_empty() || results.len() >= 7 {
                            continue;
                        }
                        let title = text.split(" - ").next().unwrap_or(text);
                        let title = if title.is_empty() {
                            text.chars().take(80).collect::<String>()
                        } else {
                            title.to_owned()
                        };
                        results.push(SearchResult {
                            title,
                            url: url.into(),
                            snippet: text.into(),
                        });
                    }
                }
                if !results.is_empty() {
                    return results;
                }
            }
        }
    }

    let mut url = match reqwest::Url::parse("https://lite.duckduckgo.com/lite/") {
        Ok(url) => url,
        Err(_) => return Vec::new(),
    };
    url.query_pairs_mut().append_pair("q", query);
    let Ok(response) = client
        .get(url)
        .header("User-Agent", SEARCH_AGENT)
        .send()
        .await
    else {
        return Vec::new();
    };
    let Ok(html) = response.text().await else {
        return Vec::new();
    };
    let snippets = LITE_SNIPPETS
        .captures_iter(&html)
        .filter_map(|capture| capture.get(1).map(|value| clean_html(value.as_str())))
        .collect::<Vec<_>>();
    extract_anchor_results(&html, "DuckDuckGo", 6)
        .into_iter()
        .enumerate()
        .map(|(i, mut result)| {
            result.snippet = snippets.get(i).cloned().unwrap_or_default();
            result
        })
        .collect()
}

async fn api_search(query: &str, config: &Value) -> Result<Vec<SearchResult>, String> {
    let provider = config["provider"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("exa");
    let key = if provider == "firecrawl" {
        config["firecrawlApiKey"]
            .as_str()
            .or_else(|| config["apiKey"].as_str())
    } else {
        config["exaApiKey"]
            .as_str()
            .or_else(|| config["apiKey"].as_str())
    }
    .unwrap_or_default()
    .trim();
    if key.is_empty() {
        return Err(if provider == "firecrawl" {
            "Firecrawl API key is required"
        } else {
            "Exa API key is required"
        }
        .into());
    }
    let client = request_client(Duration::from_secs(30))?;
    if provider == "firecrawl" {
        let response = client
            .post("https://api.firecrawl.dev/v1/search")
            .bearer_auth(key)
            .json(&json!({"query": query, "limit": 8}))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Firecrawl API error: {} {}",
                response.status().as_u16(),
                response.status().canonical_reason().unwrap_or("")
            ));
        }
        let body: Value = response.json().await.map_err(|error| error.to_string())?;
        return Ok(body["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let url = item["url"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        item["metadata"]["sourceURL"]
                            .as_str()
                            .filter(|value| !value.is_empty())
                    })?;
                let title = item["title"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        item["metadata"]["title"]
                            .as_str()
                            .filter(|value| !value.is_empty())
                    })
                    .unwrap_or(query);
                let snippet = item["description"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .or_else(|| item["markdown"].as_str().filter(|value| !value.is_empty()))
                    .or_else(|| item["snippet"].as_str().filter(|value| !value.is_empty()))
                    .unwrap_or_default();
                Some(SearchResult {
                    title: title.to_owned(),
                    url: url.to_owned(),
                    snippet: snippet.to_owned(),
                })
            })
            .collect());
    }

    let response = client
        .post("https://api.exa.ai/search")
        .header("x-api-key", key)
        .json(&json!({"query": query, "numResults": 5, "useAutoprompt": true}))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Exa API error: {} {}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or("")
        ));
    }
    let body: Value = response.json().await.map_err(|error| error.to_string())?;
    Ok(body["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let url = item["url"].as_str().filter(|value| !value.is_empty())?;
            Some(SearchResult {
                title: item["title"].as_str().unwrap_or_default().to_owned(),
                url: url.to_owned(),
                snippet: item["text"].as_str().unwrap_or_default().to_owned(),
            })
        })
        .collect())
}

async fn search(query: &str) -> Vec<SearchResult> {
    let google = search_via_engine("Google", query).await;
    if !google.is_empty() {
        return google;
    }
    let yahoo = search_via_engine("Yahoo", query).await;
    if !yahoo.is_empty() {
        return yahoo;
    }
    search_ddg(query).await
}

async fn enrich_one(client: reqwest::Client, mut result: SearchResult) -> SearchResult {
    let Ok(response) = client
        .get(&result.url)
        .header("User-Agent", PAGE_AGENT)
        .send()
        .await
    else {
        return result;
    };
    if !response.status().is_success() {
        return result;
    }
    let Ok(html) = response.text().await else {
        return result;
    };
    let mut title = None;
    let mut description = None;
    for capture in META.captures_iter(&html) {
        let first_name = capture
            .get(1)
            .map(|m| m.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let first_content = capture.get(2).map(|m| m.as_str()).unwrap_or_default();
        let second_content = capture.get(3).map(|m| m.as_str()).unwrap_or_default();
        let second_name = capture
            .get(4)
            .map(|m| m.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let (name, content) = if !first_name.is_empty() {
            (first_name, first_content)
        } else {
            (second_name, second_content)
        };
        match name.as_str() {
            "og:title" if !first_content.is_empty() => title = Some(first_content.to_owned()),
            "og:description" if !first_content.is_empty() => {
                description = Some(first_content.to_owned())
            }
            "description" if description.is_none() && !first_content.is_empty() => {
                description = Some(first_content.to_owned())
            }
            "og:title" if !content.is_empty() => title = Some(content.to_owned()),
            "og:description" if !content.is_empty() => description = Some(content.to_owned()),
            "description" if description.is_none() && !content.is_empty() => {
                description = Some(content.to_owned())
            }
            _ => {}
        }
    }
    if title.is_none() {
        title = TITLE
            .captures(&html)
            .and_then(|capture| capture.get(1).map(|m| clean_html(m.as_str())));
    }
    if let Some(title) = title
        .map(|value| clean_html(&value))
        .filter(|value| !value.is_empty())
    {
        result.title = title;
    }
    if let Some(description) = description
        .map(|value| clean_html(&value))
        .filter(|value| !value.is_empty())
    {
        result.snippet = description;
    }
    result
}

fn valid_query(query: &str) -> Result<(), Value> {
    let fail =
        |output: String, code: &str| json!({"success": false, "output": output, "error": code});
    if query.is_empty() {
        return Err(fail("❌ INVALID QUERY: Search requires a non-empty query string. Provide specific search terms (e.g., \"best discord bots\", \"React hooks guide\").".into(), "empty_query"));
    }
    if query.chars().count() < 2 {
        return Err(fail(
            "❌ INVALID QUERY: Search query too short. Use at least 2 characters.".into(),
            "query_too_short",
        ));
    }
    if query.chars().count() > 500 {
        return Err(fail(
            "❌ INVALID QUERY: Search query too long (max 500 chars). Break into simpler searches."
                .into(),
            "query_too_long",
        ));
    }
    let lower = query.to_ascii_lowercase();
    let placeholder = ["loading", "undefined", "null"].contains(&lower.trim());
    let no_words = !query
        .chars()
        .any(|ch| ch.is_alphanumeric() || ch.is_whitespace() || "- .".contains(ch));
    if placeholder || no_words {
        return Err(fail(format!("❌ INVALID QUERY: \"{query}\" looks like a placeholder or invalid input. Provide actual search terms."), "invalid_query_format"));
    }
    Ok(())
}

/// Executes the native portion of web search. `mode: "scrape"` selects the
/// Google/Yahoo/DuckDuckGo chain used as the local-browser fallback.
pub async fn execute(request: &Value) -> Result<Value, Value> {
    let query = request["query"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_owned();
    valid_query(&query)?;
    let config = request.get("config").unwrap_or(request);
    let mut results = if config["mode"] == "api" {
        match api_search(&query, config).await {
            Ok(results) => results,
            Err(error) => {
                return Err(
                    json!({"success": false, "output": format!("Search failed: {error}"), "error": error}),
                )
            }
        }
    } else {
        search(&query).await
    };
    if results.is_empty() {
        return Ok(json!({
            "success": true,
            "output": format!("No results found for \"{query}\". Try rephrasing with different keywords or use navis to open relevant browser pages directly."),
            "data": {"query": query, "results": []}
        }));
    }
    let total = results.len();
    results.truncate(8);
    for result in &mut results {
        if result.snippet.chars().count() > 300 {
            result.snippet = format!(
                "{}...",
                result.snippet.chars().take(300).collect::<String>().trim()
            );
        }
    }
    let client = request_client(Duration::from_secs(3)).map_err(|error| json!({"success": false, "output": format!("Search failed: {error}"), "error": error}))?;
    let mut jobs = tokio::task::JoinSet::new();
    for result in results {
        jobs.spawn(enrich_one(client.clone(), result));
    }
    let mut enriched = Vec::new();
    while let Some(result) = jobs.join_next().await {
        if let Ok(result) = result {
            enriched.push(result);
        }
    }
    let formatted = enriched
        .iter()
        .enumerate()
        .map(|(index, result)| {
            format!(
                "{}. **{}**\n   {}\n   {}",
                index + 1,
                result.title,
                result.url,
                result.snippet
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let data_results = enriched.iter().map(|result| json!({
        "title": result.title, "url": result.url, "snippet": result.snippet, "description": result.snippet
    })).collect::<Vec<_>>();
    Ok(json!({
        "success": true,
        "output": format!("Found {total} result(s) for \"{query}\" (showing top {}):\n\n{formatted}", enriched.len()),
        "data": {"query": query, "results": data_results, "totalCount": total}
    }))
}
