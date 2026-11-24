//! Native storage operations for resumable agent graph checkpoints.

use base64::Engine;
use flate2::write::GzEncoder;
use flate2::Compression;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

fn database_path(scope: &str) -> Result<PathBuf, String> {
    let file = match scope {
        "chat" | "" => "memory.sqlite",
        "worker" => "workers.sqlite",
        _ => return Err("Invalid agent database scope".into()),
    };
    Ok(crate::data::home()?
        .join(".everfern")
        .join("sql")
        .join(file))
}

fn open(scope: &str) -> Result<Connection, String> {
    let path = database_path(scope)?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(30))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
        )
        .map_err(|error| error.to_string())?;
    ensure_schema(&connection)?;
    Ok(connection)
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_checkpoints (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            state_json TEXT NOT NULL,
            state_hash TEXT NOT NULL,
            delta_only BOOLEAN DEFAULT 0,
            previous_checkpoint_id TEXT,
            compressed BOOLEAN DEFAULT 0,
            FOREIGN KEY (previous_checkpoint_id) REFERENCES agent_checkpoints(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_task_id ON agent_checkpoints(task_id);
        CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_step ON agent_checkpoints(task_id, step_number);
        CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_timestamp ON agent_checkpoints(timestamp);"
    ).map_err(|error| error.to_string())
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let previous: Option<String> = row.get("previous_checkpoint_id")?;
    Ok(json!({
        "id": row.get::<_, String>("id")?,
        "task_id": row.get::<_, String>("task_id")?,
        "step_number": row.get::<_, i64>("step_number")?,
        "timestamp": row.get::<_, i64>("timestamp")?,
        "state_json": row.get::<_, String>("state_json")?,
        "state_hash": row.get::<_, String>("state_hash")?,
        "delta_only": row.get::<_, bool>("delta_only")?,
        "previous_checkpoint_id": previous,
        "compressed": row.get::<_, bool>("compressed")?,
    }))
}

fn read_optional(
    connection: &Connection,
    query: &str,
    values: impl rusqlite::Params,
) -> Result<Value, String> {
    let row = connection
        .query_row(query, values, read_row)
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(row.unwrap_or(Value::Null))
}

fn insert_checkpoint(connection: &Connection, row: &Value) -> Result<(), String> {
    connection.execute(
        "INSERT INTO agent_checkpoints
            (id, task_id, step_number, timestamp, state_json, state_hash, delta_only, previous_checkpoint_id, compressed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            row["id"].as_str().ok_or("Missing checkpoint ID")?,
            row["taskId"].as_str().or_else(|| row["task_id"].as_str()).ok_or("Missing checkpoint task ID")?,
            row["stepNumber"].as_i64().or_else(|| row["step_number"].as_i64()).unwrap_or(0),
            row["timestamp"].as_i64().unwrap_or(0),
            row["stateJson"].as_str().or_else(|| row["state_json"].as_str()).ok_or("Missing checkpoint state")?,
            row["stateHash"].as_str().or_else(|| row["state_hash"].as_str()).ok_or("Missing checkpoint hash")?,
            row["deltaOnly"].as_bool().or_else(|| row["delta_only"].as_bool()).unwrap_or(false),
            row["previousCheckpointId"].as_str().or_else(|| row["previous_checkpoint_id"].as_str()),
            row["compressed"].as_bool().unwrap_or(false),
        ],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn compress_checkpoint(connection: &Connection, id: &str) -> Result<Value, String> {
    let state: Option<(String, bool)> = connection
        .query_row(
            "SELECT state_json, compressed FROM agent_checkpoints WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((state_json, true)) = state.as_ref() else {
        let Some((state_json, false)) = state else {
            return Ok(Value::Null);
        };
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(state_json.as_bytes())
            .map_err(|error| error.to_string())?;
        let compressed = base64::engine::general_purpose::STANDARD
            .encode(encoder.finish().map_err(|error| error.to_string())?);
        connection
            .execute(
                "UPDATE agent_checkpoints SET state_json=?1, compressed=1 WHERE id=?2",
                params![compressed, id],
            )
            .map_err(|error| error.to_string())?;
        return Ok(json!(compressed));
    };
    Ok(json!(state_json))
}

pub fn dispatch(request: &Value) -> Result<Value, String> {
    let scope = request["scope"].as_str().unwrap_or("chat");
    let connection = open(scope)?;
    match request["operation"].as_str().unwrap_or_default() {
        "ensure" => Ok(Value::Bool(true)),
        "insert" => {
            insert_checkpoint(&connection, &request["checkpoint"])?;
            Ok(Value::Bool(true))
        }
        "batch-insert" => {
            let rows = request["checkpoints"].as_array().ok_or("Expected checkpoint rows")?;
            let transaction = connection.unchecked_transaction().map_err(|error| error.to_string())?;
            for row in rows { insert_checkpoint(&transaction, row)?; }
            transaction.commit().map_err(|error| error.to_string())?;
            Ok(Value::Bool(true))
        }
        "get" => read_optional(&connection, "SELECT * FROM agent_checkpoints WHERE id=?1", [request["id"].as_str().ok_or("Missing checkpoint ID")?]),
        "latest" => read_optional(
            &connection,
            "SELECT * FROM agent_checkpoints WHERE task_id=?1 ORDER BY step_number DESC, timestamp DESC LIMIT 1",
            [request["taskId"].as_str().ok_or("Missing task ID")?],
        ),
        "at-step" => read_optional(
            &connection,
            "SELECT * FROM agent_checkpoints WHERE task_id=?1 AND step_number=?2 ORDER BY timestamp DESC LIMIT 1",
            params![request["taskId"].as_str().ok_or("Missing task ID")?, request["stepNumber"].as_i64().ok_or("Missing step number")?],
        ),
        "list" => {
            let mut statement = connection.prepare(
                "SELECT * FROM agent_checkpoints WHERE task_id=?1 ORDER BY step_number DESC, timestamp DESC LIMIT ?2"
            ).map_err(|error| error.to_string())?;
            let rows = statement.query_map(
                params![request["taskId"].as_str().ok_or("Missing task ID")?, request["limit"].as_i64().unwrap_or(50)],
                read_row,
            ).map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map(Value::Array).map_err(|error| error.to_string())
        }
        "prune" => {
            let task_id = request["taskId"].as_str().ok_or("Missing task ID")?;
            let keep = request["keepCount"].as_i64().unwrap_or(100);
            let transaction = connection.unchecked_transaction().map_err(|error| error.to_string())?;
            let ids = {
                let mut statement = transaction.prepare(
                    "SELECT id FROM agent_checkpoints WHERE task_id=?1 ORDER BY step_number DESC, timestamp DESC LIMIT -1 OFFSET ?2"
                ).map_err(|error| error.to_string())?;
                let rows = statement.query_map(params![task_id, keep], |row| row.get::<_, String>(0))
                    .map_err(|error| error.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?
            };
            for id in &ids {
                transaction.execute("DELETE FROM agent_checkpoints WHERE id=?1", [id]).map_err(|error| error.to_string())?;
            }
            transaction.commit().map_err(|error| error.to_string())?;
            Ok(json!(ids.len()))
        }
        "size" => {
            let size = connection.query_row(
                "SELECT COALESCE(SUM(LENGTH(state_json)), 0) FROM agent_checkpoints WHERE task_id=?1",
                [request["taskId"].as_str().ok_or("Missing task ID")?],
                |row| row.get::<_, i64>(0),
            ).map_err(|error| error.to_string())?;
            Ok(json!(size))
        }
        "uncompressed" => {
            let mut statement = connection.prepare(
                "SELECT * FROM agent_checkpoints WHERE task_id=?1 AND compressed=0 ORDER BY timestamp ASC"
            ).map_err(|error| error.to_string())?;
            let rows = statement.query_map([request["taskId"].as_str().ok_or("Missing task ID")?], read_row)
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map(Value::Array).map_err(|error| error.to_string())
        }
        "compress" => compress_checkpoint(&connection, request["id"].as_str().ok_or("Missing checkpoint ID")?),
        _ => Err("Unknown agent checkpoint operation".into()),
    }
}
