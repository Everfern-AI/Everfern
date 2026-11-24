//! Runtime boundary checks for tools exposed to autonomous worker agents.

use serde_json::{json, Value};
use std::net::IpAddr;

const SAFE_TOOLS: &[&str] = &[
    "navis",
    "open_app",
    "switch_app",
    "list_apps",
    "close_app",
    "worker_bash",
    "worker_exec",
    "worker_read_file",
    "worker_write_file",
    "worker_list_files",
    "worker_upload_files",
    "present_files",
    "sheets_read",
    "sheets_write",
    "sheets_append",
    "sheets_clear",
    "sheets_create",
    "sheets_import",
    "sheets_export",
    "sheets_format",
    "sheets_add_sheet",
    "worker_click",
    "worker_type",
    "worker_describe",
    "files_action",
    "terminal_run",
    "create_plan",
    "update_plan_step",
    "execution_plan",
    "todo_write",
    "web_search",
    "web_fetch",
    "ask_user",
    "ask_user_question",
    "memory_search",
    "recall_fact",
    "task_complete",
    "spawn_agent",
    "spawn_swarm",
    "analyze_image",
    "skill",
];

fn private_ip(address: IpAddr) -> bool {
    match address {
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
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return private_ip(IpAddr::V4(mapped));
            }
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
        }
    }
}

fn private_url(raw: &Value) -> bool {
    let raw = match raw {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        value => value.to_string(),
    };
    let Ok(url) = reqwest::Url::parse(&raw) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return true;
    }
    let Some(host) = url.host_str() else {
        return true;
    };
    let normalized_host = host.to_ascii_lowercase();
    let host = normalized_host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.');
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".lan")
        || host.ends_with(".home.arpa")
    {
        return true;
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        return private_ip(address);
    }
    let bare_number = host.parse::<u128>().is_ok()
        || host
            .strip_prefix("0x")
            .is_some_and(|value| !value.is_empty() && u128::from_str_radix(value, 16).is_ok());
    bare_number
}

fn unattended(conversation_id: &str) -> bool {
    let Some(rest) = conversation_id.strip_prefix("worker-") else {
        return false;
    };
    let Some((middle, timestamp)) = rest.rsplit_once("-auto-") else {
        return false;
    };
    !middle.is_empty()
        && !timestamp.is_empty()
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
}

pub fn decide(request: &Value) -> Value {
    let tool = request["toolName"].as_str().unwrap_or_default();
    let conversation_id = request["conversationId"].as_str().unwrap_or_default();
    if !conversation_id.starts_with("worker-") {
        return json!({"decision":"allow"});
    }
    if !SAFE_TOOLS.contains(&tool) {
        return json!({"decision":"unsafe"});
    }
    if matches!(tool, "ask_user" | "ask_user_question") && unattended(conversation_id) {
        return json!({"decision":"unattended_ask"});
    }
    if tool == "web_fetch" && private_url(&request["url"]) {
        return json!({"decision":"private_fetch"});
    }
    json!({"decision":"allow"})
}
