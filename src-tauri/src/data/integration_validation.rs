//! Deterministic message, attachment, URL and sanitization rules for bot integrations.

use hmac::{Hmac, Mac};
use regex::Regex;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::Sha256;
use std::sync::LazyLock;
use url::Url;

static SQL_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i-u:\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)",
        r"(?i-u:\b(OR|AND)\s+\d+\s*=\s*\d+)",
        r"(--|/\*|\*/|;)",
        r"(?i-u:\b(SCRIPT|JAVASCRIPT|VBSCRIPT)\b)",
        r"(?i-u:\bEXEC\s*\(",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

static XSS_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)<script[^>]*>.*?</script>",
        r"(?i)<iframe[^>]*>.*?</iframe>",
        r"(?i)<object[^>]*>.*?</object>",
        r"(?i)<embed[^>]*>",
        r"(?i)<link[^>]*>",
        r"(?i)javascript:",
        r"(?i)vbscript:",
        r"(?i)data:text/html",
        r"(?i)on[A-Za-z0-9_]+\s*=",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

static COMMAND_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(\||&|;|`|\$\(|\$\{)",
        r"(?i)(rm\s|del\s|format\s|shutdown\s|reboot\s)",
        r"(?i)(wget\s|curl\s|nc\s|netcat\s)",
        r"(?i)(/bin/|/usr/bin/|cmd\.exe|powershell)",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

static PROFANITY_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)fuck",
        r"(?i)shit",
        r"(?i)damn",
        r"(?i)bitch",
        r"(?i)asshole",
        r"(?i)bastard",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

static SPAM_PHRASES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i-u:\b(buy now|click here|limited time|act now|free money)\b)").unwrap()
});
static URL_SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"https?://").unwrap());
static SPAM_CAPS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[A-Z]{5,}").unwrap());
static SUSPICIOUS_FILENAME: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)\.(exe|bat|cmd|scr|pif|com|vbs|js|jar|app|dmg)$",
        r"(?i)\.[A-Za-z0-9_]+\.(exe|bat|cmd)$",
        r#"[<>:"|?*]"#,
        r"^\.",
        r"\s+$",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});
static SUSPICIOUS_URL: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)bit\.ly|tinyurl|t\.co",
        r"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}",
        r"(?i)[a-z0-9]{20,}\.com",
        r"(?i)\.(tk|ml|ga|cf)$",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

fn js_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{feff}'
}

fn extract_urls(text: &str) -> Vec<&str> {
    let mut urls = Vec::new();
    let mut offset = 0;
    while let Some(matched) = URL_SCHEME.find(&text[offset..]) {
        let start = offset + matched.start();
        let suffix = &text[start..];
        let end = suffix
            .char_indices()
            .find_map(|(index, character)| js_whitespace(character).then_some(index))
            .unwrap_or(suffix.len());
        urls.push(&suffix[..end]);
        offset = start + end;
    }
    urls
}

fn js_slice(value: &str, end: usize) -> String {
    let units: Vec<u16> = value.encode_utf16().collect();
    String::from_utf16_lossy(&units[..units.len().min(end)])
}

fn sanitize_text(value: &str, max_length: usize) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut in_whitespace = false;
    for character in value.chars() {
        let code = character as u32;
        if (0x00..=0x08).contains(&code)
            || (0x0b..=0x0c).contains(&code)
            || (0x0e..=0x1f).contains(&code)
            || code == 0x7f
            || code == 0
        {
            continue;
        }
        if js_whitespace(character) {
            if !in_whitespace {
                normalized.push(' ');
                in_whitespace = true;
            }
        } else {
            normalized.push(character);
            in_whitespace = false;
        }
    }
    js_slice(normalized.trim_matches(js_whitespace), max_length)
}

fn sanitize_filename(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .filter(|character| {
            let code = *character as u32;
            !matches!(
                *character,
                '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            ) && !(0x00..=0x1f).contains(&code)
                && code != 0x7f
        })
        .collect();
    js_slice(cleaned.trim_matches(js_whitespace), 255)
        .trim_matches(js_whitespace)
        .to_string()
}

fn injection_patterns(text: &str) -> Vec<&'static str> {
    let mut patterns = Vec::new();
    if SQL_PATTERNS.iter().any(|pattern| pattern.is_match(text)) {
        patterns.push("SQL injection pattern detected");
    }
    if XSS_PATTERNS.iter().any(|pattern| pattern.is_match(text)) {
        patterns.push("XSS pattern detected");
    }
    if COMMAND_PATTERNS
        .iter()
        .any(|pattern| pattern.is_match(text))
    {
        patterns.push("Command injection pattern detected");
    }
    patterns
}

fn repeated_character_matches(text: &str) -> usize {
    let mut matches = 0;
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
            continue;
        }
        let mut length = 1;
        while chars.peek() == Some(&character) {
            chars.next();
            length += 1;
        }
        if length >= 11 {
            matches += 1;
        }
    }
    matches
}

fn content_filter(text: &str, config: &Value) -> (Vec<&'static str>, &'static str) {
    let mut issues = Vec::new();
    let mut severity = "low";
    if config["enableProfanityFilter"].as_bool().unwrap_or(false)
        && PROFANITY_PATTERNS
            .iter()
            .any(|pattern| pattern.is_match(text))
    {
        issues.push("Profanity detected");
        severity = "medium";
    }
    if config["enableSpamDetection"].as_bool().unwrap_or(false) {
        let spam_score = repeated_character_matches(text)
            + extract_urls(text).len()
            + SPAM_PHRASES.find_iter(text).count()
            + SPAM_CAPS.find_iter(text).count();
        if spam_score > 3 {
            issues.push("Potential spam detected");
            severity = "high";
        }
    }
    (issues, severity)
}

fn urls(text: &str, blocked_domains: &[Value]) -> Value {
    let mut issues = Vec::new();
    let mut severity = "low";
    for url_text in extract_urls(text) {
        match Url::parse(url_text) {
            Ok(url) => {
                let hostname = url.host_str().unwrap_or_default();
                if blocked_domains
                    .iter()
                    .any(|domain| domain.as_str() == Some(hostname))
                {
                    issues.push(format!("Blocked domain detected: {hostname}"));
                    severity = "high";
                }
                if SUSPICIOUS_URL
                    .iter()
                    .any(|pattern| pattern.is_match(url_text))
                {
                    issues.push("Suspicious URL pattern detected".to_string());
                    severity = "medium";
                }
            }
            Err(_) => {
                issues.push("Invalid URL format detected".to_string());
                severity = "low";
            }
        }
    }
    json!({ "safe": issues.is_empty(), "issues": issues, "severity": severity })
}

fn validate_file(file: &Value, config: &Value, rate_limit: &Value) -> Value {
    let name = file["name"].as_str().unwrap_or_default();
    let mime_type = file["mimeType"].as_str().unwrap_or_default();
    let size = file["size"].as_f64().unwrap_or(0.0);
    let max_size = config["maxFileSize"].as_f64().unwrap_or(0.0);
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut risk_level = "low";

    let rate_limit_exceeded = !rate_limit["allowed"].as_bool().unwrap_or(true);
    if rate_limit_exceeded {
        errors.push("File upload rate limit exceeded".to_string());
        risk_level = "high";
    }
    if size > max_size {
        errors.push(format!(
            "File too large: {}/{} bytes",
            file["size"], config["maxFileSize"]
        ));
        risk_level = "medium";
    }
    let allowed_types = config["allowedFileTypes"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let blocked_file_type = !allowed_types
        .iter()
        .any(|allowed| allowed.as_str() == Some(mime_type));
    if blocked_file_type {
        errors.push(format!("File type not allowed: {mime_type}"));
        risk_level = "high";
    }
    let suspicious_filename = SUSPICIOUS_FILENAME
        .iter()
        .any(|pattern| pattern.is_match(name));
    if suspicious_filename {
        warnings.push("Suspicious filename detected");
        risk_level = "medium";
    }
    let valid = errors.is_empty();
    let sanitized = if valid {
        let mut sanitized = file.as_object().cloned().unwrap_or_default();
        sanitized.insert("name".into(), json!(sanitize_filename(name)));
        Some(Value::Object(sanitized))
    } else {
        None
    };
    json!({
        "valid": valid,
        "sanitized": sanitized,
        "errors": errors,
        "warnings": warnings,
        "riskLevel": risk_level,
        "rateLimitExceeded": rate_limit_exceeded,
        "remaining": rate_limit["remaining"].as_u64().unwrap_or(0),
        "blockedFileType": blocked_file_type,
        "suspiciousFilename": suspicious_filename
    })
}

fn scan_text(text: &str, config: &Value) -> Value {
    let injections = injection_patterns(text);
    let (content_issues, content_severity) = content_filter(text, config);
    let blocked_domains = config["blockedDomains"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    json!({
        "textLength": text.encode_utf16().count(),
        "injection": { "detected": !injections.is_empty(), "patterns": injections },
        "content": { "clean": content_issues.is_empty(), "issues": content_issues, "severity": content_severity },
        "urls": urls(text, &blocked_domains),
        "sanitizedText": sanitize_text(text, config["maxMessageLength"].as_u64().unwrap_or(4000) as usize)
    })
}

fn validate_files(files: &[Value], config: &Value, rates: &[Value]) -> Value {
    let file_results: Vec<Value> = files
        .iter()
        .enumerate()
        .map(|(index, file)| validate_file(file, config, rates.get(index).unwrap_or(&Value::Null)))
        .collect();
    Value::Array(file_results)
}

fn scan_message(request: &Value) -> Result<Value, String> {
    let message = request.get("message").ok_or("Missing incoming message")?;
    let text = message["content"]["text"]
        .as_str()
        .ok_or("Missing message text")?;
    let config = request.get("config").ok_or("Missing validation config")?;
    let files = message["content"]["files"]
        .as_array()
        .ok_or("Missing message files")?;
    let rates = request["fileRateLimits"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut result = scan_text(text, config);
    result["files"] = validate_files(files, config, &rates);
    Ok(result)
}

fn scan_files(request: &Value) -> Result<Value, String> {
    let files = request["files"].as_array().ok_or("Missing message files")?;
    let config = request.get("config").ok_or("Missing validation config")?;
    let rates = request["fileRateLimits"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    Ok(validate_files(files, config, &rates))
}

fn node_hex_decode(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let Some(high) = (pair[0] as char).to_digit(16) else {
            break;
        };
        let Some(low) = (pair[1] as char).to_digit(16) else {
            break;
        };
        decoded.push(((high << 4) | low) as u8);
    }
    decoded
}

fn strip_signature_prefix(value: &str) -> &str {
    value
        .split_once('=')
        .filter(|(prefix, _)| !prefix.is_empty())
        .map_or(value, |(_, suffix)| suffix)
}

fn compare_signatures(provided: &str, expected: &str) -> bool {
    if provided.encode_utf16().count() != expected.encode_utf16().count() {
        return false;
    }
    let provided = strip_signature_prefix(provided);
    let expected = strip_signature_prefix(expected);
    if provided.encode_utf16().count() != expected.encode_utf16().count() {
        return false;
    }
    let provided_bytes = node_hex_decode(provided);
    let expected_bytes = node_hex_decode(expected);
    if provided_bytes.len() != expected_bytes.len() {
        return provided == expected;
    }
    let mut difference = 0u8;
    for (left, right) in provided_bytes.iter().zip(expected_bytes.iter()) {
        difference |= left ^ right;
    }
    difference == 0
}

fn validate_webhook_signature(request: &Value) -> Value {
    let algorithm = request["hashAlgorithm"].as_str().unwrap_or_default();
    let secret = request["secretKey"].as_str().unwrap_or_default();
    let payload = request["payload"].as_str().unwrap_or_default();
    let signature = request["signature"].as_str().unwrap_or_default();
    let data = match request["timestamp"].as_str() {
        Some(timestamp) if !timestamp.is_empty() => format!("{timestamp}.{payload}"),
        _ => payload.to_string(),
    };
    let digest = match algorithm.to_ascii_lowercase().as_str() {
        "sha256" => {
            let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
                return json!({ "supported": false });
            };
            mac.update(data.as_bytes());
            mac.finalize()
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        }
        "sha1" => {
            let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(secret.as_bytes()) else {
                return json!({ "supported": false });
            };
            mac.update(data.as_bytes());
            mac.finalize()
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        }
        _ => return json!({ "supported": false }),
    };
    let expected = format!("{algorithm}={digest}");
    json!({ "supported": true, "valid": compare_signatures(signature, &expected) })
}

pub(crate) fn dispatch(request: &Value) -> Result<Value, String> {
    match request["operation"].as_str().unwrap_or_default() {
        "validate_message" => scan_message(request),
        "scan_text" => Ok(scan_text(
            request["text"].as_str().unwrap_or_default(),
            request.get("config").ok_or("Missing validation config")?,
        )),
        "validate_files" => scan_files(request),
        "validate_webhook_signature" => Ok(validate_webhook_signature(request)),
        "sanitize_text" => Ok(json!(sanitize_text(
            request["text"].as_str().unwrap_or_default(),
            request["maxMessageLength"].as_u64().unwrap_or(4000) as usize
        ))),
        operation => Err(format!(
            "Unknown integration validation operation: {operation}"
        )),
    }
}
