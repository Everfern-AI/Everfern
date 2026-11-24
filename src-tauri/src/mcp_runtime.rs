//! Persistent MCP client runtime used by the TypeScript agent adapter.
//!
//! The sidecar remains responsible for agent scheduling and presentation, but
//! stdio and Streamable HTTP MCP sessions live here so server processes and
//! connections use the native runtime. The line protocol is private to the
//! bundled sidecar and keeps the protocol state out of command line arguments.

use std::collections::HashMap;
use std::io::{BufRead, Write};

use http::{HeaderName, HeaderValue};
use rmcp::model::{CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation};
use rmcp::service::RunningService;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};
use serde_json::{json, Value};

type Client = RunningService<RoleClient, ClientConfig>;

#[derive(Default)]
struct McpRuntime {
    servers: HashMap<String, Client>,
}

impl McpRuntime {
    async fn connect(&mut self, config: &Value) -> Result<Value, String> {
        let name = config["name"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_string();
        if name.is_empty() {
            return Err("Server name is required".into());
        }
        if let Some(mut previous) = self.servers.remove(&name) {
            let _ = previous.close().await;
        }

        let client_config = ClientConfig::new(
            ClientCapabilities::default(),
            Implementation::new("everfern", "1.0.0"),
        );
        let client = if let Some(url) = config["url"].as_str() {
            let mut headers = HashMap::new();
            if let Some(values) = config["headers"].as_object() {
                for (key, value) in values {
                    let key = HeaderName::from_bytes(key.as_bytes())
                        .map_err(|error| format!("Invalid MCP header name: {error}"))?;
                    let value = value.as_str().unwrap_or_default();
                    let value = HeaderValue::from_str(value)
                        .map_err(|error| format!("Invalid MCP header value: {error}"))?;
                    headers.insert(key, value);
                }
            }
            let transport = StreamableHttpClientTransport::from_config(
                StreamableHttpClientTransportConfig::with_uri(url).custom_headers(headers),
            );
            tokio::time::timeout(
                std::time::Duration::from_secs(20),
                client_config.serve(transport),
            )
            .await
            .map_err(|_| "MCP handshake timed out after 20s".to_string())?
            .map_err(|error| error.to_string())?
        } else {
            let (command, args) = command_for_config(config)?;
            let mut process = tokio::process::Command::new(&command);
            process.args(args);
            if let Some(env) = config["env"].as_object() {
                for (key, value) in env {
                    if let Some(value) = value.as_str() {
                        process.env(key, value);
                    }
                }
            }
            let transport = TokioChildProcess::new(process)
                .map_err(|error| format!("Could not start MCP server: {error}"))?;
            tokio::time::timeout(
                std::time::Duration::from_secs(20),
                client_config.serve(transport),
            )
            .await
            .map_err(|_| "MCP handshake timed out after 20s".to_string())?
            .map_err(|error| error.to_string())?
        };

        let tools =
            tokio::time::timeout(std::time::Duration::from_secs(20), client.list_all_tools())
                .await
                .map_err(|_| "tools/list timed out after 20s".to_string())?
                .map_err(|error| error.to_string())?;

        let mut visible = Vec::with_capacity(tools.len().min(500));
        for tool in tools.into_iter().take(500) {
            let schema = serde_json::to_value(tool.input_schema.as_ref())
                .unwrap_or_else(|_| json!({"type":"object","properties":{}}));
            visible.push(json!({
                "name": tool.name,
                "description": tool.description.unwrap_or_default(),
                "inputSchema": schema,
            }));
        }
        self.servers.insert(name, client);
        Ok(Value::Array(visible))
    }

    async fn call(&self, request: &Value) -> Result<Value, String> {
        let server_name = request["server"]
            .as_str()
            .ok_or("Missing MCP server name")?;
        let tool_name = request["tool"].as_str().ok_or("Missing MCP tool name")?;
        let client = self
            .servers
            .get(server_name)
            .ok_or_else(|| format!("MCP server \"{server_name}\" is not connected"))?;
        let arguments = request["arguments"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let params = CallToolRequestParams::new(tool_name.to_string()).with_arguments(arguments);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            client.peer().call_tool(params),
        )
        .await
        .map_err(|_| format!("MCP tool {tool_name} timed out after 120s"))?
        .map_err(|error| error.to_string())?;
        let content = serde_json::to_value(result.content).map_err(|error| error.to_string())?;
        Ok(json!({
            "content": content,
            "structuredContent": result.structured_content,
            "isError": result.is_error.unwrap_or(false),
        }))
    }

    async fn disconnect(&mut self, name: &str) {
        if let Some(mut client) = self.servers.remove(name) {
            let _ = client.close().await;
        }
    }

    async fn disconnect_all(&mut self) {
        for (_, mut client) in self.servers.drain() {
            let _ = client.close().await;
        }
    }
}

fn command_for_config(config: &Value) -> Result<(String, Vec<String>), String> {
    if let Some(docker) = config["docker"].as_str().filter(|value| !value.is_empty()) {
        let parts = split_command(docker);
        let Some(image) = parts.first() else {
            return Err("Docker server configuration is empty".into());
        };
        let env_flags = config["env"].as_object().into_iter().flat_map(|values| {
            values
                .keys()
                .flat_map(|key| ["-e".to_string(), key.clone()])
                .collect::<Vec<_>>()
        });
        let args = std::iter::once("run".to_string())
            .chain(["--rm".to_string(), "-i".to_string()])
            .chain(env_flags)
            // Match the existing sidecar's Docker argument order for saved configs.
            .chain(parts.iter().skip(1).cloned())
            .chain(std::iter::once(image.clone()))
            .collect();
        return Ok(("docker".into(), args));
    }

    let command_line = config["command"].as_str().unwrap_or_default();
    let mut parts = split_command(command_line);
    let Some(command) = (!parts.is_empty()).then(|| parts.remove(0)) else {
        return Err("Server has no command, docker image or URL".into());
    };
    let mut args = parts;
    if let Some(configured) = config["args"].as_array() {
        args.extend(
            configured
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string),
        );
    }
    Ok((command, args))
}

fn split_command(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut active = false;
    for ch in line.chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => token.push(c),
            (None, '"' | '\'') => {
                quote = Some(ch);
                active = true;
            }
            (None, c) if c.is_whitespace() => {
                if active {
                    out.push(std::mem::take(&mut token));
                    active = false;
                }
            }
            (None, c) => {
                token.push(c);
                active = true;
            }
        }
    }
    if active {
        out.push(token);
    }
    out
}

fn response(runtime: &mut McpRuntime, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let operation = request["op"].as_str().unwrap_or_default().to_string();
    let result = tauri::async_runtime::block_on(async {
        match operation.as_str() {
            "connect" => runtime.connect(&request["config"]).await,
            "call" => runtime.call(&request).await,
            "disconnect" => {
                if let Some(name) = request["server"].as_str() {
                    runtime.disconnect(name).await;
                }
                Ok(Value::Null)
            }
            "disconnectAll" => {
                runtime.disconnect_all().await;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown MCP daemon operation: {operation}")),
        }
    });
    match result {
        Ok(value) => json!({"id": id, "ok": true, "result": value}),
        Err(error) => {
            json!({"id": id, "ok": false, "error": error.lines().next().unwrap_or("MCP operation failed").chars().take(300).collect::<String>()})
        }
    }
}

pub fn run_daemon() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    let mut runtime = McpRuntime::default();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let result = match serde_json::from_str::<Value>(&line) {
            Ok(request) => response(&mut runtime, request),
            Err(error) => {
                json!({"id": null, "ok": false, "error": format!("Invalid MCP daemon request: {error}")})
            }
        };
        if serde_json::to_writer(&mut output, &result).is_err()
            || writeln!(output).is_err()
            || output.flush().is_err()
        {
            break;
        }
    }
    tauri::async_runtime::block_on(runtime.disconnect_all());
}
