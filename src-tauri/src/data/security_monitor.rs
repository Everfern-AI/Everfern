//! Security event persistence and deterministic alert policy for integrations.

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn security_log_directory() -> Result<PathBuf, String> {
    Ok(crate::data::home()?
        .join(".everfern")
        .join("security-logs"))
}

fn append_event(event: &Value) -> Result<(), String> {
    let directory = security_log_directory()?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let timestamp = event["timestamp"].as_str().unwrap_or_default();
    let date = timestamp.get(0..10).filter(|value| value.len() == 10).unwrap_or("unknown");
    let path = directory.join(format!("security-{date}.log"));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, event).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

fn timestamp_ms(event: &Value) -> Option<i64> {
    DateTime::parse_from_rfc3339(event["timestamp"].as_str()?)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn critical(event: &Value) -> bool {
    event["severity"] == "critical"
        || matches!(
            event["type"].as_str(),
            Some(
                "injection_attack_detected"
                    | "data_breach_attempt"
                    | "system_compromise_detected"
                    | "privilege_escalation_attempt"
            )
        )
}

fn auto_block(events: &[Value], event: &Value, config: &Value, now: i64) -> bool {
    let Some(user_id) = event["userId"].as_str() else {
        return false;
    };
    let window = config["autoBlockThresholds"]["timeWindowMinutes"]
        .as_i64()
        .unwrap_or(0)
        .saturating_mul(60_000);
    let cutoff = now.saturating_sub(window);
    let mut auth_failures = 0usize;
    let mut injections = 0usize;
    for recent in events {
        if recent["userId"].as_str() != Some(user_id)
            || timestamp_ms(recent).is_none_or(|timestamp| timestamp < cutoff)
        {
            continue;
        }
        match recent["type"].as_str() {
            Some("authentication_failure") => auth_failures += 1,
            Some("injection_attack_detected") => injections += 1,
            _ => {}
        }
    }
    auth_failures
        >= config["autoBlockThresholds"]["failedAuthAttempts"]
            .as_u64()
            .unwrap_or(0) as usize
        || injections
            >= config["autoBlockThresholds"]["injectionAttempts"]
                .as_u64()
                .unwrap_or(0) as usize
}

fn notification_key(event: &Value) -> String {
    format!(
        "{}_{}",
        event["type"].as_str().unwrap_or_default(),
        event["severity"].as_str().unwrap_or_default()
    )
}

fn process_event(request: &Value) -> Result<Value, String> {
    let event = request.get("event").ok_or("Missing security event")?;
    append_event(event)?;
    let events = request["events"].as_array().cloned().unwrap_or_default();
    let config = &request["alertConfig"];
    let now = request["now"].as_i64().unwrap_or_else(|| Utc::now().timestamp_millis());
    let is_critical = critical(event);
    let should_auto_block = auto_block(&events, event, config, now);

    Ok(json!({
        "critical": is_critical,
        "shouldAutoBlock": should_auto_block
    }))
}

fn should_notify(request: &Value) -> Value {
    let event = &request["event"];
    let config = &request["alertConfig"];
    let now = request["now"].as_i64().unwrap_or_else(|| Utc::now().timestamp_millis());
    let levels = ["low", "medium", "high", "critical"];
    let severity = event["severity"].as_str().unwrap_or_default();
    let minimum = config["minNotificationSeverity"].as_str().unwrap_or_default();
    let severity_index = levels.iter().position(|level| *level == severity);
    let minimum_index = levels.iter().position(|level| *level == minimum);
    let mut counts = request["notificationCounts"].as_object().cloned().unwrap_or_default();
    let mut should_notify = false;
    if severity_index.zip(minimum_index).is_some_and(|(severity, minimum)| severity >= minimum) {
        let key = notification_key(event);
        let hour_ago = now.saturating_sub(60 * 60 * 1000);
        let mut notifications: Vec<i64> = counts[&key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .filter(|timestamp| *timestamp > hour_ago)
            .collect();
        let max_per_hour = config["notificationRateLimit"]["maxPerHour"]
            .as_u64()
            .unwrap_or(0) as usize;
        if notifications.len() < max_per_hour {
            notifications.push(now);
            counts.insert(key, json!(notifications));
            should_notify = true;
        }
    }

    json!({
        "shouldNotifyAdmins": should_notify,
        "notificationCounts": Value::Object(counts)
    })
}

fn validation_event(request: &Value) -> Value {
    let validation = &request["validationResult"];
    let severity = match validation["riskLevel"].as_str().unwrap_or_default() {
        "low" => "low",
        "medium" => "medium",
        "high" => "high",
        "critical" => "critical",
        _ => "medium",
    };
    let errors = validation["errors"].as_array().cloned().unwrap_or_default();
    let warnings = validation["warnings"].as_array().cloned().unwrap_or_default();
    let has_error = |needle: &str| {
        errors
            .iter()
            .any(|error| error.as_str().is_some_and(|error| error.contains(needle)))
    };
    let event_type = if has_error("injection") {
        "injection_attack_detected"
    } else if has_error("rate limit") {
        "rate_limit_exceeded"
    } else if has_error("file") {
        "file_upload_blocked"
    } else if warnings.iter().any(|warning| {
        warning
            .as_str()
            .is_some_and(|warning| warning.contains("URL"))
    }) {
        "malicious_url_detected"
    } else {
        "suspicious_activity"
    };
    json!({ "severity": severity, "type": event_type })
}

fn metrics(request: &Value) -> Value {
    let start = request["startMs"].as_i64().unwrap_or(i64::MIN);
    let end = request["endMs"].as_i64().unwrap_or(i64::MAX);
    let events: Vec<Value> = request["events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|event| timestamp_ms(event).is_some_and(|time| time >= start && time <= end))
        .cloned()
        .collect();
    let mut by_severity = json!({ "low": 0, "medium": 0, "high": 0, "critical": 0 });
    let mut by_type = Map::new();
    let mut by_platform = Map::new();
    let mut failed_auth = 0usize;
    let mut blocked_attacks = 0usize;
    let mut rate_limit_violations = 0usize;
    for event in &events {
        if let Some(severity) = event["severity"].as_str() {
            if let Some(count) = by_severity[severity].as_u64() {
                by_severity[severity] = json!(count + 1);
            }
        }
        if let Some(event_type) = event["type"].as_str() {
            let count = by_type[event_type].as_u64().unwrap_or(0);
            by_type.insert(event_type.to_string(), json!(count + 1));
            match event_type {
                "authentication_failure" => failed_auth += 1,
                "injection_attack_detected" | "malicious_url_detected" => blocked_attacks += 1,
                "rate_limit_exceeded" => rate_limit_violations += 1,
                _ => {}
            }
        }
        if let Some(platform) = event["platform"].as_str() {
            let count = by_platform[platform].as_u64().unwrap_or(0);
            by_platform.insert(platform.to_string(), json!(count + 1));
        }
    }
    json!({
        "totalEvents": events.len(),
        "eventsBySeverity": by_severity,
        "eventsByType": by_type,
        "eventsByPlatform": by_platform,
        "failedAuthAttempts": failed_auth,
        "blockedAttacks": blocked_attacks,
        "rateLimitViolations": rate_limit_violations,
        "timePeriod": { "start": request["start"], "end": request["end"] }
    })
}

fn system_health(request: &Value) -> Value {
    let metrics = &request["metrics"];
    let critical_alerts = request["criticalAlerts"].as_array().map_or(0, Vec::len);
    let mut issues = Vec::new();
    let mut status = "healthy";
    if critical_alerts > 0 {
        status = "critical";
        issues.push(format!("{critical_alerts} unresolved critical alerts"));
    }
    let mut check = |count: usize, threshold: usize, message: String| {
        if count > threshold {
            if status == "healthy" {
                status = "warning";
            }
            issues.push(message);
        }
    };
    check(
        metrics["failedAuthAttempts"].as_u64().unwrap_or(0) as usize,
        50,
        format!(
            "High number of failed authentication attempts: {}",
            metrics["failedAuthAttempts"].as_u64().unwrap_or(0)
        ),
    );
    check(
        metrics["blockedAttacks"].as_u64().unwrap_or(0) as usize,
        10,
        format!(
            "Multiple attack attempts blocked: {}",
            metrics["blockedAttacks"].as_u64().unwrap_or(0)
        ),
    );
    check(
        metrics["rateLimitViolations"].as_u64().unwrap_or(0) as usize,
        20,
        format!(
            "High rate limit violations: {}",
            metrics["rateLimitViolations"].as_u64().unwrap_or(0)
        ),
    );
    if issues.is_empty() {
        issues.push("All systems operating normally".to_string());
    }
    json!({ "status": status, "issues": issues })
}

pub(crate) fn dispatch(request: &Value) -> Result<Value, String> {
    match request["operation"].as_str().unwrap_or_default() {
        "process_event" => process_event(request),
        "should_notify" => Ok(should_notify(request)),
        "append_event" => {
            append_event(request.get("event").ok_or("Missing security event")?)?;
            Ok(json!({ "stored": true }))
        }
        "validation_event" => Ok(validation_event(request)),
        "metrics" => Ok(metrics(request)),
        "system_health" => Ok(system_health(request)),
        operation => Err(format!("Unknown security monitor operation: {operation}")),
    }
}
