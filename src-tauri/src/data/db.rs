//! Ports of the SQL parts of main/store/history.ts, main/store/projects/projects.ts
//! and main/store/scheduled-tasks.ts. Opens the same ~/.everfern/sql/memory.sqlite
//! the Node process uses (WAL + busy timeout), so both sides can share it.

use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::path::Path;

type Row = Map<String, Value>;

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = open_uninitialized(path)?;
    ensure_schema(&conn).map_err(|error| error.to_string())?;
    Ok(conn)
}

fn open_uninitialized(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn chat_vector_stats(path: &Path) -> Result<Value, String> {
    let (count, size, initialized) = match std::fs::metadata(path) {
        Ok(metadata) => {
            let conn =
                Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|error| error.to_string())?;
            let count = conn
                .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| {
                    row.get::<_, i64>(0)
                })
                .ok();
            (count.unwrap_or(0), metadata.len(), count.is_some())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (0, 0, false),
        Err(error) => return Err(error.to_string()),
    };
    Ok(
        json!({"messageCount": count, "dimensionCount": null, "storageSize": size,
        "initialized": initialized, "error": null}),
    )
}

fn open_chat_index(path: &Path) -> Result<Connection, String> {
    let conn = open_uninitialized(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL, created_at INTEGER NOT NULL, indexed_at INTEGER);
         CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);",
    )
    .map_err(|error| error.to_string())?;
    Ok(conn)
}

pub fn chat_vector_messages(
    path: &Path,
    id: Option<&Value>,
    delete: bool,
) -> Result<Value, String> {
    let conn = open_chat_index(path)?;
    if delete {
        conn.execute(
            "DELETE FROM chat_messages WHERE chat_id = ?",
            params_from_iter([sql(id)]),
        )
        .map_err(|error| error.to_string())?;
        return Ok(json!({"success": true}));
    }
    let rows = query(
        &conn,
        "SELECT id, chat_id AS chatId, role, content, created_at AS createdAt
         FROM chat_messages WHERE chat_id = ? ORDER BY created_at",
        vec![sql(id)],
    )
    .map_err(|error| error.to_string())?;
    Ok(json!(rows))
}

pub fn index_chat_message(path: &Path, args: &[Value]) -> Result<Value, String> {
    if args
        .get(3)
        .and_then(Value::as_str)
        .is_none_or(|text| text.trim().is_empty())
    {
        return Ok(json!({"success": true}));
    }
    let conn = open_chat_index(path)?;
    let values = (0..5)
        .map(|index| sql(args.get(index)))
        .chain([Sql::Integer(chrono::Utc::now().timestamp_millis())]);
    conn.execute(
        "INSERT OR REPLACE INTO chat_messages (id, chat_id, role, content, created_at, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        params_from_iter(values),
    )
    .map_err(|error| error.to_string())?;
    Ok(json!({"success": true}))
}

#[test]
fn chat_index_ranks_matches_and_deletes_only_the_selected_chat() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("chat.sqlite");
    for args in [
        json!(["older", "one", "user", "Budget and timeline", 10]),
        json!(["newer", "one", "assistant", "Budget", 20]),
        json!(["other", "two", "user", "Budget and timeline", 30]),
    ] {
        index_chat_message(&path, args.as_array().unwrap()).unwrap();
    }
    let matches =
        search_chat_index(&path, &[json!("BUDGET timeline"), json!(2), json!("one")]).unwrap();
    assert_eq!(matches[0]["id"], "older");
    assert_eq!(matches[0]["similarity"], 0.3);
    assert_eq!(matches[1]["id"], "newer");
    assert_eq!(chat_vector_stats(&path).unwrap()["messageCount"], 3);
    chat_vector_messages(&path, Some(&json!("one")), true).unwrap();
    assert_eq!(
        chat_vector_messages(&path, Some(&json!("one")), false).unwrap(),
        json!([])
    );
    assert_eq!(
        chat_vector_messages(&path, Some(&json!("two")), false).unwrap()[0]["id"],
        "other"
    );
}

pub fn search_chat_index(path: &Path, args: &[Value]) -> Result<Value, String> {
    let query_text = args
        .first()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let words: Vec<_> = query_text
        .split_whitespace()
        .filter(|word| word.encode_utf16().count() > 2)
        .collect();
    let top = args.get(1).and_then(Value::as_i64).unwrap_or(10);
    let conn = open_chat_index(path)?;
    let limit = Sql::Integer(top.saturating_mul(3));
    let rows = if let Some(id) = args
        .get(2)
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    {
        query(
            &conn,
            "SELECT id, chat_id AS chatId, role, content, created_at AS createdAt
            FROM chat_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?",
            vec![text(id), limit],
        )
    } else {
        query(
            &conn,
            "SELECT id, chat_id AS chatId, role, content, created_at AS createdAt
            FROM chat_messages ORDER BY created_at DESC LIMIT ?",
            vec![limit],
        )
    }
    .map_err(|error| error.to_string())?;
    let mut scored: Vec<_> = rows
        .into_iter()
        .filter_map(|mut row| {
            let content = row["content"].as_str()?.to_lowercase();
            let matches = words.iter().filter(|word| content.contains(**word)).count();
            if matches == 0 {
                return None;
            }
            row.insert(
                "similarity".into(),
                json!((0..matches).fold(0.0, |score, _| score + 0.15)),
            );
            Some((matches, row))
        })
        .collect();
    scored.sort_by_key(|(matches, _)| std::cmp::Reverse(*matches));
    let take = if top < 0 {
        scored.len().saturating_sub(top.unsigned_abs() as usize)
    } else {
        top as usize
    };
    Ok(Value::Array(
        scored
            .into_iter()
            .take(take)
            .map(|(_, row)| Value::Object(row))
            .collect(),
    ))
}

#[test]
fn database_health_repairs_tables_without_leaving_a_probe_row() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sql").join("memory.sqlite");
    let first = check_health(&path).unwrap();
    assert_eq!(first["success"], true);
    assert_eq!(
        first["repaired"],
        json!([
            "conversations",
            "messages",
            "memory_chunks",
            "semantic_cache",
            "scheduled_tasks",
            "projects",
            "schema_migrations",
            "usage_events",
            "model_pricing_cache"
        ])
    );
    let conn = open(&path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(check_health(&path).unwrap()["repaired"], json!([]));
}

#[cfg(all(test, target_os = "windows", target_arch = "x86_64"))]
#[test]
fn vector_health_loads_the_installed_extension_and_repairs_tables() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("memory.sqlite");
    let app_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let result = check_vectors(&path, app_root).unwrap();
    assert_eq!(result["count"], 0);
    assert_eq!(
        result["repaired"],
        json!([
            "memory_chunks_vec",
            "semantic_cache_vec",
            "chat_messages_vec"
        ])
    );
    assert_eq!(
        check_vectors(&path, app_root).unwrap()["repaired"],
        json!([])
    );
}

fn open_vector_db(path: &Path, app_root: &Path) -> Result<Connection, String> {
    let conn = open(path)?;
    let (os, suffix) = match std::env::consts::OS {
        "windows" => ("windows", "dll"),
        "macos" => ("darwin", "dylib"),
        "linux" => ("linux", "so"),
        _ => return Err("sqlite-vec is unavailable on this platform".into()),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" if os != "windows" => "arm64",
        _ => return Err("sqlite-vec is unavailable on this architecture".into()),
    };
    let extension = app_root
        .join("node_modules")
        .join(format!("sqlite-vec-{os}-{arch}"))
        .join(format!("vec0.{suffix}"));
    // Only the application's installed extension is loaded. The guard disables
    // extension loading before any other statement runs on this connection.
    unsafe {
        let _guard = rusqlite::LoadExtensionGuard::new(&conn).map_err(|error| error.to_string())?;
        conn.load_extension(extension, None::<&str>)
            .map_err(|error| error.to_string())?;
    }
    Ok(conn)
}

pub fn history_vectors(path: &Path, app_root: &Path, limit: i64) -> Result<Value, String> {
    let conn = open_vector_db(path, app_root)?;
    let rows = query(
        &conn,
        "SELECT v.id, length(v.embedding) AS embedding_bytes, m.content, m.role,
                c.title AS conversation_title, m.created_at
         FROM chat_messages_vec v
         JOIN messages m ON v.id = m.id
         JOIN conversations c ON m.conversation_id = c.id
         ORDER BY m.created_at DESC LIMIT ?",
        vec![Sql::Integer(limit)],
    )
    .map_err(|error| error.to_string())?;
    Ok(json!(rows))
}

fn vector_bytes(vector: &Value) -> Result<Vec<u8>, String> {
    let vector = vector
        .as_array()
        .filter(|entries| entries.len() == 1536)
        .ok_or("Expected a 1536-dimensional query vector")?;
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        let number = value.as_f64().ok_or("Invalid query vector")? as f32;
        bytes.extend_from_slice(&number.to_le_bytes());
    }
    Ok(bytes)
}

pub fn semantic_cache(path: &Path, app_root: &Path, request: &Value) -> Result<Value, String> {
    if request["operation"] == "health" {
        let conn = open(path)?;
        conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?;
        return Ok(Value::Null);
    }
    let bytes = vector_bytes(&request["vector"])?;
    let mut conn = open_vector_db(path, app_root)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS semantic_cache (
            id TEXT PRIMARY KEY, prompt_text TEXT NOT NULL, response_json TEXT NOT NULL,
            provider TEXT, model TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE VIRTUAL TABLE IF NOT EXISTS semantic_cache_vec USING vec0(id TEXT PRIMARY KEY, embedding float[1536]);",
    ).map_err(|error| error.to_string())?;
    match request["operation"].as_str() {
        Some("lookup") => {
            let threshold = request["threshold"]
                .as_f64()
                .ok_or("Expected cache distance threshold")?;
            let rows = query(
                &conn,
                "SELECT c.response_json, vec_distance_cosine(v.embedding, ?1) AS distance
                 FROM semantic_cache_vec v JOIN semantic_cache c ON v.id = c.id
                 WHERE vec_distance_cosine(v.embedding, ?1) < ?2 ORDER BY distance ASC LIMIT 1",
                vec![Sql::Blob(bytes), Sql::Real(threshold)],
            )
            .map_err(|error| error.to_string())?;
            Ok(rows
                .into_iter()
                .next()
                .map(Value::Object)
                .unwrap_or(Value::Null))
        }
        Some("save") => {
            use sha2::{Digest, Sha256};
            let prompt = request["prompt"]
                .as_str()
                .ok_or("Expected a cache prompt")?;
            let id = format!("{:x}", Sha256::digest(prompt));
            let response = request.get("response").ok_or("Expected a cache response")?;
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT OR REPLACE INTO semantic_cache (id, prompt_text, response_json, provider, model) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![id, prompt, response.to_string(), request["provider"].as_str(), response["model"].as_str()],
            ).map_err(|error| error.to_string())?;
            tx.execute("DELETE FROM semantic_cache_vec WHERE id = ?", [&id])
                .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO semantic_cache_vec (id, embedding) VALUES (?, ?)",
                rusqlite::params![id, bytes],
            )
            .map_err(|error| error.to_string())?;
            tx.commit().map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("Invalid semantic cache operation".into()),
    }
}

#[cfg(all(test, target_os = "windows", target_arch = "x86_64"))]
#[test]
fn semantic_cache_replaces_responses_and_applies_distance_threshold() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("memory.sqlite");
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut vector = vec![0.0; 1536];
    vector[0] = 1.0;
    let mut other = vec![0.0; 1536];
    other[1] = 1.0;
    let call = |request| semantic_cache(&path, root, &request).unwrap();
    call(json!({"operation": "health"}));
    for content in ["before", "after"] {
        call(
            json!({"operation": "save", "prompt": "example", "provider": "ollama",
            "response": {"model": "test", "content": content}, "vector": vector}),
        );
    }
    let hit = call(json!({"operation": "lookup", "vector": vector, "threshold": 0.04}));
    let response: Value = serde_json::from_str(hit["response_json"].as_str().unwrap()).unwrap();
    assert_eq!(response["content"], "after");
    assert_eq!(
        call(json!({"operation": "lookup", "vector": other, "threshold": 0.04})),
        Value::Null
    );
}

pub fn search_memory_vectors(
    path: &Path,
    app_root: &Path,
    vector: &Value,
    limit: i64,
) -> Result<Value, String> {
    let bytes = vector_bytes(vector)?;
    let conn = open_vector_db(path, app_root)?;
    let rows = query(
        &conn,
        "SELECT mc.id, mc.text_content AS content, mc.metadata,
                vec_distance_cosine(v.embedding, ?) AS distance
         FROM memory_chunks_vec v JOIN memory_chunks mc ON v.id = mc.id
         ORDER BY distance ASC LIMIT ?",
        vec![Sql::Blob(bytes), Sql::Integer(limit)],
    )
    .map_err(|error| error.to_string())?;
    Ok(json!(rows))
}

pub fn memory_vector_ids(path: &Path, app_root: &Path) -> Result<Value, String> {
    let conn = open_vector_db(path, app_root)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_chunks (
            id TEXT PRIMARY KEY, text_content TEXT NOT NULL, metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_vec USING vec0(id TEXT PRIMARY KEY, embedding float[1536]);
         CREATE VIRTUAL TABLE IF NOT EXISTS semantic_cache_vec USING vec0(id TEXT PRIMARY KEY, embedding float[1536]);",
    ).map_err(|error| error.to_string())?;
    let entries =
        query(&conn, "SELECT id FROM memory_chunks", vec![]).map_err(|error| error.to_string())?;
    Ok(json!(entries))
}

pub fn sync_memory_vectors(path: &Path, app_root: &Path, request: &Value) -> Result<Value, String> {
    let mut conn = open_vector_db(path, app_root)?;
    let ids = request["ids"].as_array().ok_or("Expected memory IDs")?;
    let ids: std::collections::HashSet<_> = ids.iter().filter_map(Value::as_str).collect();
    let additions = request["additions"]
        .as_array()
        .ok_or("Expected memory entries")?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let current =
        query(&tx, "SELECT id FROM memory_chunks", vec![]).map_err(|error| error.to_string())?;
    for row in current {
        if let Some(id) = row["id"].as_str().filter(|id| !ids.contains(id)) {
            tx.execute("DELETE FROM memory_chunks_vec WHERE id = ?", [id])
                .map_err(|error| error.to_string())?;
            tx.execute("DELETE FROM memory_chunks WHERE id = ?", [id])
                .map_err(|error| error.to_string())?;
        }
    }
    for addition in additions {
        let id = addition["id"]
            .as_str()
            .filter(|id| ids.contains(id))
            .ok_or("Invalid memory ID")?;
        let content = addition["content"]
            .as_str()
            .ok_or("Invalid memory content")?;
        let metadata = addition["metadata"].to_string();
        let bytes = vector_bytes(&addition["vector"])?;
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO memory_chunks (id, text_content, metadata) VALUES (?, ?, ?)",
                rusqlite::params![id, content, metadata],
            )
            .map_err(|error| error.to_string())?;
        if inserted != 0 {
            tx.execute(
                "INSERT INTO memory_chunks_vec (id, embedding) VALUES (?, ?)",
                rusqlite::params![id, bytes],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(Value::Null)
}

#[cfg(all(test, target_os = "windows", target_arch = "x86_64"))]
#[test]
fn memory_vector_sync_keeps_records_and_vectors_consistent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("memory.sqlite");
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    check_health(&path).unwrap();
    check_vectors(&path, root).unwrap();
    let mut vector = vec![0.0; 1536];
    vector[0] = 1.0;
    let vector = json!(vector);
    let sync = |id: &str, input: &Value| {
        sync_memory_vectors(
            &path,
            root,
            &json!({
                "ids": [id],
                "additions": [{"id": id, "content": "hello", "metadata": {"tags": "notes"}, "vector": input}]
            }),
        )
    };
    sync("first", &vector).unwrap();
    assert!(sync("invalid", &json!([1])).is_err());
    let rows = search_memory_vectors(&path, root, &vector, 5).unwrap();
    assert_eq!(rows[0]["id"], "first");
    assert_eq!(rows[0]["distance"].as_f64(), Some(0.0));
    sync("second", &vector).unwrap();
    let rows = search_memory_vectors(&path, root, &vector, 5).unwrap();
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["id"], "second");
}

pub fn check_vectors(path: &Path, app_root: &Path) -> Result<Value, String> {
    let conn = open_vector_db(path, app_root)?;
    let dimensions = conn
        .query_row(
            "SELECT dimensions FROM vec_info('memory_chunks_vec')",
            [],
            |row| row.get::<_, u32>(0),
        )
        .ok()
        .filter(|dimension| *dimension > 0)
        .unwrap_or(1536);
    let mut repaired = Vec::new();
    for table in [
        "memory_chunks_vec",
        "semantic_cache_vec",
        "chat_messages_vec",
    ] {
        if conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get::<_, i64>(0)).is_err()
            && conn.execute_batch(&format!(
                "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(id TEXT PRIMARY KEY, embedding float[{dimensions}])"
            )).is_ok()
        {
            repaired.push(table);
        }
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chat_messages_vec", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    let details = if repaired.is_empty() {
        format!("Vector store is healthy. Found {count} vectors.")
    } else {
        format!(
            "Vector store healthy. Found {count} vectors. Auto-created: {}",
            repaired.join(", ")
        )
    };
    Ok(json!({"success": true, "count": count, "repaired": repaired, "details": details}))
}

pub fn check_health(path: &Path) -> Result<Value, String> {
    let mut conn = open_uninitialized(path)?;
    let names = [
        "conversations",
        "messages",
        "memory_chunks",
        "semantic_cache",
        "scheduled_tasks",
        "projects",
        "schema_migrations",
        "usage_events",
        "model_pricing_cache",
    ];
    let exists = |conn: &Connection, name: &str| {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
            [name],
            |row| row.get::<_, bool>(0),
        )
    };
    let mut missing = Vec::new();
    for name in names {
        if !exists(&conn, name).map_err(|error| error.to_string())? {
            missing.push(name);
        }
    }
    ensure_schema(&conn).map_err(|error| error.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_chunks (
            id TEXT PRIMARY KEY, text_content TEXT NOT NULL, metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE TABLE IF NOT EXISTS semantic_cache (
            id TEXT PRIMARY KEY, prompt_text TEXT NOT NULL, response_json TEXT NOT NULL,
            provider TEXT, model TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);",
    )
    .map_err(|error| error.to_string())?;
    conn.execute_batch(PRICING_SCHEMA)
        .map_err(|error| error.to_string())?;
    let start = std::time::Instant::now();
    conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    let ms = start.elapsed().as_millis();
    let written = (|| -> rusqlite::Result<()> {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO conversations (id, title, provider) VALUES (?, 'Health Check', 'test')",
            [format!("health-check-{}", uuid_v4())],
        )?;
        tx.rollback()
    })();
    if let Err(error) = written {
        return Ok(
            json!({"success": false, "repaired": missing, "error": "Database write test failed",
            "details": json!({"connectivityMs": ms, "requiredTablesExist": true, "canWrite": false,
                "writeError": error.to_string()}).to_string()}),
        );
    }
    let details = if missing.is_empty() {
        "Database is healthy".to_owned()
    } else {
        format!(
            "Database is healthy. Auto-created tables: {}",
            missing.join(", ")
        )
    };
    Ok(json!({"success": true, "repaired": missing, "details": details}))
}

/// The tables this module touches, as main/lib/db.ts creates them, plus its
/// missing-column upgrades. Node runs the same statements; all are idempotent.
fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      content_before BLOB,
      content_after BLOB,
      operation TEXT NOT NULL CHECK(operation IN ('create', 'modify', 'delete')),
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_snapshots_task
      ON file_snapshots(task_id);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_step
      ON file_snapshots(task_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_path
      ON file_snapshots(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_timestamp
      ON file_snapshots(timestamp);
         CREATE TABLE IF NOT EXISTS command_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      command TEXT NOT NULL,
      output TEXT,
      exit_code INTEGER,
      rollback_command TEXT,
      reversible BOOLEAN DEFAULT 0,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_command_history_task
      ON command_history(task_id);
    CREATE INDEX IF NOT EXISTS idx_command_history_step
      ON command_history(task_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_command_history_timestamp
      ON command_history(timestamp);
         CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_cost_usd REAL NOT NULL DEFAULT 0,
        output_cost_usd REAL NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        context_window INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_conversation_id ON usage_events(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model);
      CREATE INDEX IF NOT EXISTS idx_usage_events_provider ON usage_events(provider);
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
         CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, title TEXT, provider TEXT, model TEXT, project_id TEXT,
            is_pinned INTEGER DEFAULT 0, is_bookmarked INTEGER DEFAULT 0, is_unread INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, thought TEXT,
            reasoning_content TEXT, tool_calls TEXT, mission_timeline TEXT, has_timeline BOOLEAN DEFAULT 0,
            order_index INTEGER DEFAULT 0, thinking_duration INTEGER, stopped BOOLEAN DEFAULT 0, attachments TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
         CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY, name TEXT, description TEXT NOT NULL, cron TEXT NOT NULL, pattern TEXT,
            prompt TEXT NOT NULL, project_id TEXT, starts_at DATETIME, last_run DATETIME, next_run DATETIME,
            ends_at DATETIME, enabled BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT, path TEXT NOT NULL,
            is_pinned INTEGER DEFAULT 0, is_bookmarked INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
         CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
         CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);",
    )?;
    let upgrades: [(&str, &[(&str, &str)]); 3] = [
        (
            "conversations",
            &[
                ("project_id", "TEXT"),
                ("provider", "TEXT"),
                ("model", "TEXT"),
                ("is_pinned", "INTEGER DEFAULT 0"),
                ("is_bookmarked", "INTEGER DEFAULT 0"),
                ("is_unread", "INTEGER DEFAULT 0"),
            ],
        ),
        (
            "messages",
            &[
                ("thought", "TEXT"),
                ("reasoning_content", "TEXT"),
                ("tool_calls", "TEXT"),
                ("mission_timeline", "TEXT"),
                ("has_timeline", "BOOLEAN DEFAULT 0"),
                ("order_index", "INTEGER DEFAULT 0"),
                ("thinking_duration", "INTEGER"),
                ("stopped", "BOOLEAN DEFAULT 0"),
                ("attachments", "TEXT"),
            ],
        ),
        (
            "projects",
            &[
                ("instructions", "TEXT"),
                ("path", "TEXT"),
                ("is_pinned", "INTEGER DEFAULT 0"),
                ("is_bookmarked", "INTEGER DEFAULT 0"),
            ],
        ),
    ];
    for (table, cols) in upgrades {
        let have: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        for (name, ty) in cols {
            if !have.iter().any(|h| h == name) {
                // Node may add the same column concurrently; a duplicate is harmless.
                let _ = conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {ty}"));
            }
        }
    }
    Ok(())
}

// ---- helpers that mirror JS semantics ----

pub(super) fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS `v === 1` for a value read from SQLite.
fn is_one(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64) == Some(1.0)
}

/// `a ?? b`: only null/undefined fall through.
fn nullish(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

fn sql(v: Option<&Value>) -> Sql {
    match v {
        None | Some(Value::Null) => Sql::Null,
        Some(Value::Bool(b)) => Sql::Integer(*b as i64),
        Some(Value::Number(n)) => n
            .as_i64()
            .map(Sql::Integer)
            .unwrap_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0))),
        Some(Value::String(s)) => Sql::Text(s.clone()),
        Some(other) => Sql::Text(other.to_string()),
    }
}

/// `x || null`.
fn or_null(v: Option<&Value>) -> Sql {
    if truthy(v) {
        sql(v)
    } else {
        Sql::Null
    }
}

fn text(s: impl Into<String>) -> Sql {
    Sql::Text(s.into())
}

#[test]
fn analytics_summary_aggregates_existing_usage_rows() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    let empty = analytics_summary(&conn);
    assert_eq!(empty["totalRequests"], 0);
    assert_eq!(empty["avgCostPerRequest"].as_f64(), Some(0.0));
    assert_eq!(empty["topModels"], json!([]));
    conn.execute_batch(
        "INSERT INTO usage_events
         (id, model, provider, prompt_tokens, completion_tokens, total_tokens, total_cost_usd, created_at)
         VALUES ('a', 'model', 'provider', 10, 5, 15, 0.25, datetime('now'));",
    ).unwrap();
    let event = json!([
        "b",
        null,
        "model",
        "provider",
        20,
        10,
        30,
        0.5,
        0.25,
        0.75,
        150000,
        chrono::Utc::now().to_rfc3339()
    ]);
    let row = event.as_array().unwrap();
    insert_usage(&conn, row).unwrap();
    insert_usage(&conn, row).unwrap();
    let summary = analytics_summary(&conn);
    assert_eq!(summary["totalTokens"], 45);
    assert_eq!(summary["avgCostPerRequest"], 0.5);
    assert_eq!(summary["topModels"][0]["requests"], 2);
    assert_eq!(summary["topProviders"][0]["tokens"], 45);
    assert_eq!(summary["dailyUsage"][0]["requests"], 2);
    assert_eq!(summary["monthlyUsage"][0]["requests"], 2);
    assert_eq!(summary["hourlyUsage"][0]["requests"], 2);
}

pub fn rollback_changes(conn: &Connection, args: &[Value]) -> Result<Value, String> {
    let filters = || vec![sql(args.first()), sql(args.get(1))];
    let files = query(
        conn,
        "SELECT file_path AS path, operation, timestamp FROM file_snapshots
         WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp DESC",
        filters(),
    )
    .map_err(|error| error.to_string())?;
    let commands = query(
        conn,
        "SELECT command, reversible, timestamp FROM command_history
         WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp DESC",
        filters(),
    )
    .map_err(|error| error.to_string())?;
    Ok(json!({"files": files, "commands": commands}))
}

pub fn snapshot_content(conn: &Connection, id: Option<&Value>) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Read;

    let rows = query(
        conn,
        "SELECT content_before, content_after FROM file_snapshots WHERE id = ?",
        vec![sql(id)],
    )
    .map_err(|error| error.to_string())?;
    let Some(row) = rows.first() else {
        return Ok(Value::Null);
    };
    let decode = |key: &str| -> Result<String, String> {
        let encoded = row[key].as_str().unwrap_or_default();
        if encoded.is_empty() {
            return Ok(String::new());
        }
        let compressed = STANDARD
            .decode(encoded)
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        flate2::read::MultiGzDecoder::new(compressed.as_slice())
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };
    Ok(
        json!({"contentBefore": decode("content_before")?, "contentAfter": decode("content_after")?}),
    )
}

pub fn restore_snapshot(conn: &Connection, id: &Value) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Read;

    let rows = query(
        conn,
        "SELECT file_path, operation, content_before FROM file_snapshots WHERE id = ?",
        vec![sql(Some(id))],
    )
    .map_err(|error| error.to_string())?;
    let Some(row) = rows.first() else {
        return Ok(
            json!({"filePath": "", "success": false, "operation": "modify",
            "error": format!("Snapshot {} not found", id.as_str().unwrap_or_default())}),
        );
    };
    let path = row["file_path"].as_str().ok_or("Missing snapshot path")?;
    let operation = row["operation"].as_str().unwrap_or_default();
    let outcome = match operation {
        "create" => {
            std::fs::remove_file(path).map_err(|error| format!("Failed to delete file: {error}"))
        }
        "modify" | "delete" => (|| {
            let compressed = STANDARD
                .decode(row["content_before"].as_str().unwrap_or_default())
                .map_err(|error| error.to_string())?;
            let mut bytes = Vec::new();
            flate2::read::MultiGzDecoder::new(compressed.as_slice())
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            std::fs::write(path, bytes).map_err(|error| error.to_string())
        })()
        .map_err(|error| format!("Failed to restore file: {error}")),
        _ => {
            return Ok(
                json!({"filePath": path, "success": false, "operation": "modify",
            "error": format!("Unknown operation type: {operation}")}),
            )
        }
    };
    Ok(match outcome {
        Ok(()) => json!({"filePath": path, "success": true, "operation": operation}),
        Err(error) => {
            json!({"filePath": path, "success": false, "operation": operation, "error": error})
        }
    })
}

pub fn restore_turn_files(conn: &Connection, args: &[Value]) -> Result<Value, String> {
    let snapshots = query(
        conn,
        "SELECT id, file_path FROM file_snapshots
        WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp DESC",
        vec![sql(args.first()), sql(args.get(1))],
    )
    .map_err(|error| error.to_string())?;
    let mut restored = Vec::new();
    let mut errors = Vec::new();
    for snapshot in snapshots {
        let path = snapshot["file_path"].as_str().unwrap_or_default();
        match restore_snapshot(conn, &snapshot["id"]) {
            Ok(result) if result["success"] == true => restored.push(path.to_owned()),
            Ok(result) => {
                let error = result["error"].as_str().unwrap_or("Unknown error");
                errors.push(format!("File restoration failed for {path}: {error}"));
            }
            Err(error) => errors.push(format!("File restoration failed for {path}: {error}")),
        }
    }
    Ok(json!({"filesRestored": restored, "errors": errors}))
}

pub fn rollback_file_only_turn(conn: &Connection, args: &[Value]) -> Result<Value, String> {
    let has_commands: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM command_history WHERE task_id = ? AND timestamp >= ?)",
            params_from_iter([sql(args.first()), sql(args.get(1))]),
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if has_commands {
        return Ok(Value::Null);
    }
    let mut result = restore_turn_files(conn, args)?;
    let failed = result["errors"]
        .as_array()
        .is_some_and(|errors| !errors.is_empty());
    let restored = result["filesRestored"]
        .as_array()
        .is_some_and(|files| !files.is_empty());
    result["success"] = json!(!failed);
    result["partialRollback"] = json!(failed && restored);
    result["commandsReversed"] = json!([]);
    result["stepsRolledBack"] = json!([]);
    Ok(result)
}

#[test]
fn rollback_preview_detects_changes_since_snapshot() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Write;
    let conn = Connection::open_in_memory().unwrap();
    ensure_schema(&conn).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("example.txt");
    std::fs::write(&file, "expected").unwrap();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(b"expected").unwrap();
    let snapshot = gzip.finish().unwrap();
    let encoded = STANDARD.encode(&snapshot);
    conn.execute(
        "INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
         VALUES ('s', 'task', 1, ?, ?, ?, 'modify', 10)",
        rusqlite::params![file.to_str().unwrap(), encoded, encoded],
    ).unwrap();
    let args = [json!("task"), json!(10)];
    assert_eq!(
        snapshot_content(&conn, Some(&json!("s"))).unwrap(),
        json!({"contentBefore": "expected", "contentAfter": "expected"})
    );
    assert_eq!(
        snapshot_content(&conn, Some(&json!("missing"))).unwrap(),
        Value::Null
    );
    let preview = rollback_preview(&conn, &args);
    assert_eq!(preview["riskLevel"], "low");
    assert_eq!(preview["totalSizeBytes"], snapshot.len());
    assert!(preview["files"][0].get("warning").is_none());
    std::fs::write(&file, "edited").unwrap();
    let preview = rollback_preview(&conn, &args);
    assert_eq!(preview["riskLevel"], "medium");
    assert!(preview["files"][0]["warning"]
        .as_str()
        .unwrap()
        .contains("modified since snapshot"));
    assert_eq!(
        rollback_preview(&conn, &[json!("task"), json!(11)])["totalFilesToRestore"],
        0
    );
    let restored = restore_snapshot(&conn, &json!("s")).unwrap();
    assert_eq!(restored["success"], true);
    assert_eq!(restored["operation"], "modify");
    assert_eq!(std::fs::read(&file).unwrap(), b"expected");
    assert_eq!(
        restore_snapshot(&conn, &json!("missing")).unwrap()["success"],
        false
    );

    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(b"intermediate").unwrap();
    let later = STANDARD.encode(gzip.finish().unwrap());
    conn.execute(
        "INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, operation, timestamp)
         VALUES ('later', 'task', 2, ?, ?, 'modify', 20),
                ('missing-file', 'task', 3, ?, NULL, 'create', 30)",
        rusqlite::params![file.to_str().unwrap(), later, dir.path().join("missing.txt").to_str().unwrap()],
    ).unwrap();
    conn.execute_batch(
        "INSERT INTO command_history (id, task_id, step_number, command, timestamp)
         VALUES ('command', 'task', 1, 'example', 10);",
    )
    .unwrap();
    std::fs::write(&file, "current").unwrap();
    assert_eq!(rollback_file_only_turn(&conn, &args).unwrap(), Value::Null);
    assert_eq!(std::fs::read(&file).unwrap(), b"current");
    conn.execute_batch("DELETE FROM command_history").unwrap();
    let batch = rollback_file_only_turn(&conn, &args).unwrap();
    assert_eq!(batch["success"], false);
    assert_eq!(batch["partialRollback"], true);
    assert_eq!(batch["commandsReversed"], json!([]));
    assert_eq!(batch["errors"].as_array().unwrap().len(), 1);
    assert_eq!(batch["filesRestored"].as_array().unwrap().len(), 2);
    assert_eq!(std::fs::read(&file).unwrap(), b"expected");
}

pub fn rollback_preview(conn: &Connection, args: &[Value]) -> Value {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Read;

    let filters = || vec![sql(args.first()), sql(args.get(1))];
    let snapshots = query(
        conn,
        "SELECT file_path, operation, content_before, content_after FROM file_snapshots
         WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp ASC",
        filters(),
    )
    .unwrap_or_default();
    let records = query(
        conn,
        "SELECT command, reversible, rollback_command FROM command_history
         WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp ASC",
        filters(),
    )
    .unwrap_or_default();
    let linked = conn
        .query_row(
            "SELECT COUNT(DISTINCT fs.id) FROM file_snapshots fs
         JOIN command_file_links cfl ON fs.id = cfl.snapshot_id
         JOIN command_history ch ON ch.id = cfl.command_id
         WHERE ch.task_id = ? AND ch.timestamp >= ?",
            params_from_iter(filters()),
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or_default();
    let mut total_size = 0;
    let mut missing_created = false;
    let mut warned = false;
    let files: Vec<_> = snapshots.iter().map(|row| {
        let path = Path::new(row["file_path"].as_str().unwrap_or_default());
        let operation = row["operation"].as_str().unwrap_or_default();
        let before = row["content_before"].as_str().unwrap_or_default();
        let size = STANDARD.decode(before).map(|bytes| bytes.len()).unwrap_or(before.len());
        total_size += size;
        let metadata = std::fs::metadata(path).ok();
        let warning = match operation {
            "delete" if metadata.is_some() => Some("File has been re-created since deletion — restoring may overwrite current content"),
            "create" if metadata.is_none() => {
                missing_created = true;
                Some("File was already deleted or never created")
            }
            "modify" => match std::fs::read(path) {
                Err(_) => Some("File no longer exists — snapshot content will be restored as new file"),
                Ok(current) => {
                    let after = row["content_after"].as_str().unwrap_or_default();
                    STANDARD.decode(after).ok().and_then(|compressed| {
                        let mut expected = Vec::new();
                        flate2::read::MultiGzDecoder::new(compressed.as_slice())
                            .take(current.len() as u64 + 1).read_to_end(&mut expected).ok()?;
                        (current != expected).then_some("File was modified since snapshot — restoring may cause data loss")
                    })
                }
            },
            _ => None,
        };
        let mut item = json!({"filePath": row["file_path"], "operation": operation,
            "contentSizeBytes": size, "willRestore": true});
        if let Some(warning) = warning {
            warned = true;
            item["warning"] = json!(warning);
        }
        if let Some(time) = metadata.and_then(|file| file.modified().ok()) {
            let time: chrono::DateTime<chrono::Utc> = time.into();
            item["lastModified"] = json!(time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        }
        item
    }).collect();
    let mut irreversible = false;
    let commands: Vec<_> = records.iter().map(|row| {
        let reversible = row["reversible"] == 1 || row["reversible"] == true;
        irreversible |= !reversible;
        let mut item = json!({"command": row["command"], "reversible": reversible, "linkedSnapshots": linked});
        if let Some(command) = row["rollback_command"].as_str().filter(|command| !command.is_empty()) {
            item["rollbackCommand"] = json!(command);
        }
        item
    }).collect();
    let risk = if irreversible || missing_created || files.len() > 50 {
        "high"
    } else if warned {
        "medium"
    } else {
        "low"
    };
    json!({"stepNumber": 0, "totalFilesToRestore": files.len(), "files": files, "commands": commands,
        "totalSizeBytes": total_size, "hasIrreversibleCommands": irreversible,
        "hasUnrestorableFiles": missing_created, "riskLevel": risk})
}

pub fn analytics_summary(conn: &Connection) -> Value {
    fn read(conn: &Connection) -> rusqlite::Result<Value> {
        let totals = query(
            conn,
            r#"SELECT
        COALESCE(SUM(total_cost_usd), 0) as totalCost,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
        COUNT(*) as totalRequests
      FROM usage_events
        "#,
            vec![],
        )?;
        let top_models = query(
            conn,
            r#"SELECT model, provider,
             COUNT(*) as requests,
             SUM(total_tokens) as tokens,
             SUM(total_cost_usd) as cost
      FROM usage_events
      GROUP BY model
      ORDER BY cost DESC
      LIMIT 10
        "#,
            vec![],
        )?;
        let top_providers = query(
            conn,
            r#"SELECT provider,
             COUNT(*) as requests,
             SUM(total_tokens) as tokens,
             SUM(total_cost_usd) as cost
      FROM usage_events
      GROUP BY provider
      ORDER BY cost DESC
        "#,
            vec![],
        )?;
        let daily_usage = query(
            conn,
            r#"SELECT
        DATE(created_at) as date,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        COUNT(*) as requests
      FROM usage_events
      WHERE created_at >= DATE('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
        "#,
            vec![],
        )?;
        let monthly_usage = query(
            conn,
            r#"SELECT
        strftime('%Y-%m', created_at) as month,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        COUNT(*) as requests
      FROM usage_events
      WHERE created_at >= DATE('now', '-365 days')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month ASC
        "#,
            vec![],
        )?;
        let hourly_usage = query(
            conn,
            r#"SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        SUM(total_tokens) as tokens,
        COUNT(*) as requests
      FROM usage_events
      GROUP BY strftime('%H', created_at)
      ORDER BY hour ASC
        "#,
            vec![],
        )?;
        let mut totals = Value::Object(totals.into_iter().next().unwrap_or_default());
        let requests = totals["totalRequests"].as_u64().unwrap_or(0);
        totals["avgCostPerRequest"] = json!(if requests == 0 {
            0.0
        } else {
            totals["totalCost"].as_f64().unwrap_or(0.0) / requests as f64
        });
        totals["topModels"] = json!(top_models);
        totals["topProviders"] = json!(top_providers);
        totals["dailyUsage"] = json!(daily_usage);
        totals["monthlyUsage"] = json!(monthly_usage);
        totals["hourlyUsage"] = json!(hourly_usage);
        Ok(totals)
    }

    read(conn).unwrap_or_else(|_| empty_analytics_summary())
}

pub fn insert_usage(conn: &Connection, row: &[Value]) -> Result<Value, String> {
    if row.len() != 12 {
        return Err("Expected a complete usage event".into());
    }
    let values = row
        .iter()
        .map(|value| match value {
            Value::Null => Ok(Sql::Null),
            Value::String(text) => Ok(Sql::Text(text.clone())),
            Value::Number(number) => number
                .as_i64()
                .map(Sql::Integer)
                .or_else(|| number.as_f64().map(Sql::Real))
                .ok_or("Invalid usage number"),
            _ => Err("Invalid usage value"),
        })
        .collect::<Result<Vec<_>, _>>()?;
    conn.execute(
        "INSERT OR IGNORE INTO usage_events
         (id, conversation_id, model, provider, prompt_tokens, completion_tokens, total_tokens,
          input_cost_usd, output_cost_usd, total_cost_usd, context_window, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params_from_iter(values),
    )
    .map_err(|error| error.to_string())?;
    Ok(Value::Null)
}

pub(super) fn cached_pricing(conn: &Connection) -> rusqlite::Result<Vec<(String, Value)>> {
    query(
        conn,
        "SELECT model_id, provider, COALESCE(NULLIF(display_name, ''), model_id) AS displayName,
        input_cost_per_1m AS inputCostPer1M, output_cost_per_1m AS outputCostPer1M,
        COALESCE(NULLIF(context_window, 0), 150000) AS contextWindow
        FROM model_pricing_cache",
        vec![],
    )
    .map(|rows| {
        rows.into_iter()
            .filter_map(|mut row| {
                let id = row.remove("model_id")?.as_str()?.to_owned();
                Some((id, Value::Object(row)))
            })
            .collect()
    })
}

const PRICING_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS model_pricing_cache (
            model_id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT,
            input_cost_per_1m REAL NOT NULL DEFAULT 0, output_cost_per_1m REAL NOT NULL DEFAULT 0,
            context_window INTEGER DEFAULT 150000, last_fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );";

pub(super) fn save_pricing(
    path: &Path,
    entries: &[(String, Value)],
    fetched_at: &str,
) -> Result<(), String> {
    fn persist(
        conn: &mut Connection,
        entries: &[(String, Value)],
        fetched_at: &str,
    ) -> rusqlite::Result<()> {
        conn.execute_batch(PRICING_SCHEMA)?;
        let tx = conn.transaction()?;
        {
            let mut insert = tx.prepare(
                "INSERT OR REPLACE INTO model_pricing_cache
                 (model_id, provider, display_name, input_cost_per_1m, output_cost_per_1m, context_window, last_fetched_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )?;
            for (id, entry) in entries {
                insert.execute(rusqlite::params![
                    id,
                    entry["provider"].as_str(),
                    entry["displayName"].as_str(),
                    entry["inputCostPer1M"].as_f64().unwrap_or_default(),
                    entry["outputCostPer1M"].as_f64().unwrap_or_default(),
                    entry["contextWindow"].as_i64(),
                    fetched_at
                ])?;
            }
        }
        tx.commit()
    }
    persist(&mut open(path)?, entries, fetched_at).map_err(|error| error.to_string())
}

pub fn empty_analytics_summary() -> Value {
    json!({
        "totalCost": 0, "totalTokens": 0, "totalPromptTokens": 0,
        "totalCompletionTokens": 0, "totalRequests": 0, "avgCostPerRequest": 0,
        "topModels": [], "topProviders": [], "dailyUsage": [], "monthlyUsage": [], "hourlyUsage": []
    })
}

fn query(conn: &Connection, statement: &str, params: Vec<Sql>) -> rusqlite::Result<Vec<Row>> {
    let mut stmt = conn.prepare(statement)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params))?;
    let mut out = vec![];
    while let Some(row) = rows.next()? {
        let mut map = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i)? {
                ValueRef::Null | ValueRef::Blob(_) => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            };
            map.insert(name.clone(), v);
        }
        out.push(map);
    }
    Ok(out)
}

fn exec(conn: &Connection, statement: &str, params: Vec<Sql>) -> rusqlite::Result<usize> {
    conn.execute(statement, params_from_iter(params))
}

fn get<'a>(row: &'a Row, k: &str) -> Value {
    row.get(k).cloned().unwrap_or(Value::Null)
}

/// `new Date().toISOString()`.
pub fn iso_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let ms = d.as_millis() as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + (month <= 2) as i64;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

fn random_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    );
    h.finish()
}

/// `crypto.randomUUID()` shape (version 4, RFC 4122 variant).
pub fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    b[..8].copy_from_slice(&random_u64().to_le_bytes());
    b[8..].copy_from_slice(&random_u64().to_le_bytes());
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn base36(mut n: u64, len: usize) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = Vec::with_capacity(len);
    for _ in 0..len {
        s.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    String::from_utf8(s).unwrap_or_default()
}

// ---- history ----

const SUMMARY_SQL: &str = "SELECT c.*, p.name as projectName, COUNT(m.id) as messageCount
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN messages m ON c.id = m.conversation_id";
const SUMMARY_ORDER: &str =
    "GROUP BY c.id ORDER BY (c.is_pinned = 1 OR c.is_bookmarked = 1) DESC, c.updated_at DESC";

fn summary(row: &Row) -> Value {
    json!({
        "id": get(row, "id"), "title": get(row, "title"), "provider": get(row, "provider"), "model": get(row, "model"),
        "projectId": get(row, "project_id"), "projectName": get(row, "projectName"),
        "isPinned": is_one(row.get("is_pinned")),
        "isBookmarked": is_one(row.get("is_bookmarked")) || is_one(row.get("is_pinned")),
        "isUnread": is_one(row.get("is_unread")),
        "messageCount": get(row, "messageCount"),
        "createdAt": get(row, "created_at"), "updatedAt": get(row, "updated_at"),
    })
}

pub fn history_list(conn: &Connection) -> Result<Value, String> {
    let rows = query(conn, &format!("{SUMMARY_SQL} {SUMMARY_ORDER}"), vec![])
        .map_err(|e| e.to_string())?;
    Ok(Value::Array(rows.iter().map(summary).collect()))
}

pub fn history_list_by_project(conn: &Connection, project: &Value) -> Result<Value, String> {
    let p = sql(Some(project));
    let rows = query(
        conn,
        &format!("{SUMMARY_SQL} WHERE c.project_id = ? OR c.project_id = (SELECT id FROM projects WHERE id = ? OR name = ? OR path = ?) {SUMMARY_ORDER}"),
        vec![p.clone(), p.clone(), p.clone(), p],
    )
    .map_err(|e| e.to_string())?;
    Ok(Value::Array(rows.iter().map(summary).collect()))
}

/// Defensive JSON column parse: a corrupt field becomes undefined, never an error.
fn parse_field(v: Option<&Value>) -> Option<Value> {
    match v {
        Some(Value::String(s)) => serde_json::from_str(s).ok(),
        Some(Value::Null) | None => None,
        Some(other) => serde_json::from_str(&other.to_string()).ok(),
    }
}

pub fn history_load(conn: &Connection, id: &Value) -> Result<Value, String> {
    let conv = query(conn, "SELECT c.*, p.name as projectName FROM conversations c LEFT JOIN projects p ON c.project_id = p.id WHERE c.id = ?", vec![sql(Some(id))]).map_err(|e| e.to_string())?;
    let Some(c) = conv.first() else {
        return Ok(json!({ "error": "Not found" }));
    };
    let rows = query(
        conn,
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY order_index ASC, created_at ASC",
        vec![sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    let messages: Vec<Value> = rows
        .iter()
        .map(|r| {
            let mut m = Map::new();
            m.insert("id".into(), get(r, "id"));
            m.insert("role".into(), get(r, "role"));
            m.insert("content".into(), get(r, "content"));
            m.insert("thought".into(), get(r, "thought"));
            let reasoning = if truthy(r.get("reasoning_content")) {
                get(r, "reasoning_content")
            } else {
                get(r, "thought")
            };
            m.insert("reasoning_content".into(), reasoning);
            if let Some(mut calls) = parse_field(r.get("tool_calls")) {
                if let Value::Array(list) = &mut calls {
                    let key =
                        |v: &Value| v.get("orderIndex").and_then(Value::as_f64).unwrap_or(0.0);
                    list.sort_by(|a, b| {
                        key(a)
                            .partial_cmp(&key(b))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });
                }
                m.insert("toolCalls".into(), calls);
            }
            if let Some(t) = parse_field(r.get("mission_timeline")) {
                m.insert("missionTimeline".into(), t);
            }
            m.insert("hasTimeline".into(), json!(truthy(r.get("has_timeline"))));
            m.insert(
                "orderIndex".into(),
                if nullish(r.get("order_index")) {
                    json!(0)
                } else {
                    get(r, "order_index")
                },
            );
            if !nullish(r.get("thinking_duration")) {
                m.insert("thinkingDuration".into(), get(r, "thinking_duration"));
            }
            m.insert("stopped".into(), json!(is_one(r.get("stopped"))));
            if let Some(a) = parse_field(r.get("attachments")) {
                m.insert("attachments".into(), a);
            }
            m.insert("createdAt".into(), get(r, "created_at"));
            Value::Object(m)
        })
        .collect();
    let mut out = summary(c);
    let obj = out.as_object_mut().unwrap();
    obj.remove("messageCount");
    obj.insert("messages".into(), Value::Array(messages));
    Ok(out)
}

/// history:save. Returns the result plus the user/assistant messages that the
/// Node process should embed for vector search (it owns the embedding model).
pub fn history_save(conn: &Connection, conv: &Value) -> (Value, Vec<Value>) {
    let mut index = vec![];
    let result = (|| -> Result<(), String> {
        let c = conv
            .as_object()
            .ok_or("Cannot read properties of undefined (reading 'id')")?;
        let msgs = c
            .get("messages")
            .and_then(Value::as_array)
            .ok_or("Cannot read properties of undefined (reading 'length')")?;
        // The renderer channel omits isFullSave; absence means a full snapshot.
        let full = match c.get("isFullSave") {
            None => true,
            Some(v) => v == &Value::Bool(true),
        };
        let now = iso_now();
        let pinned = if truthy(c.get("isPinned")) || truthy(c.get("isBookmarked")) {
            Sql::Integer(1)
        } else {
            Sql::Null
        };
        let unread = match c.get("isUnread") {
            None => Sql::Null,
            v => Sql::Integer(truthy(v) as i64),
        };
        let id = sql(c.get("id"));
        let created = if truthy(c.get("createdAt")) {
            sql(c.get("createdAt"))
        } else {
            text(&now)
        };
        let updated = if truthy(c.get("updatedAt")) {
            sql(c.get("updatedAt"))
        } else {
            text(&now)
        };

        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let body = || -> rusqlite::Result<()> {
            exec(
                conn,
                "INSERT INTO conversations (id, title, provider, model, project_id, is_pinned, is_bookmarked, is_unread, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0), COALESCE((SELECT created_at FROM conversations WHERE id = ?), ?), ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = COALESCE(excluded.title, conversations.title),
                   provider = COALESCE(excluded.provider, conversations.provider),
                   model = COALESCE(excluded.model, conversations.model),
                   project_id = COALESCE(excluded.project_id, conversations.project_id),
                   is_pinned = COALESCE(?, conversations.is_pinned),
                   is_bookmarked = COALESCE(?, conversations.is_bookmarked),
                   is_unread = COALESCE(?, conversations.is_unread),
                   updated_at = excluded.updated_at",
                vec![
                    id.clone(), sql(c.get("title")), sql(c.get("provider")), sql(c.get("model")), or_null(c.get("projectId")),
                    pinned.clone(), pinned.clone(), unread.clone(), id.clone(), created, updated, pinned.clone(), pinned, unread,
                ],
            )?;
            let mut saved: Vec<String> = vec![];
            for (i, m) in msgs.iter().enumerate() {
                let msg_id = match m.get("id") {
                    Some(v) if truthy(Some(v)) => v
                        .as_str()
                        .map(String::from)
                        .unwrap_or_else(|| v.to_string()),
                    _ => format!(
                        "msg-{}-{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis(),
                        base36(random_u64(), 7)
                    ),
                };
                saved.push(msg_id.clone());
                let content = match m.get("content") {
                    None => Sql::Null,
                    Some(Value::String(s)) => text(s.clone()),
                    Some(other) => text(other.to_string()),
                };
                let tool_calls = match m.get("toolCalls") {
                    Some(Value::Array(list)) => {
                        let stamped: Vec<Value> = list
                            .iter()
                            .enumerate()
                            .map(|(j, tc)| {
                                let mut tc = tc.clone();
                                if let Some(o) = tc.as_object_mut() {
                                    if nullish(o.get("orderIndex")) {
                                        o.insert("orderIndex".into(), json!(j));
                                    }
                                }
                                tc
                            })
                            .collect();
                        text(Value::Array(stamped).to_string())
                    }
                    v if truthy(v) => text(v.unwrap().to_string()),
                    _ => Sql::Null,
                };
                let as_json = |k: &str| {
                    if truthy(m.get(k)) {
                        text(m.get(k).unwrap().to_string())
                    } else {
                        Sql::Null
                    }
                };
                let order = if nullish(m.get("orderIndex")) {
                    Sql::Integer(i as i64)
                } else {
                    sql(m.get("orderIndex"))
                };
                let msg_created = if truthy(m.get("createdAt")) {
                    sql(m.get("createdAt"))
                } else {
                    text(iso_now())
                };
                exec(
                    conn,
                    "INSERT OR REPLACE INTO messages
                     (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline, has_timeline, order_index, thinking_duration, stopped, attachments, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))",
                    vec![
                        text(msg_id.clone()), id.clone(), sql(m.get("role")), content.clone(), or_null(m.get("thought")), or_null(m.get("reasoning_content")),
                        tool_calls, as_json("missionTimeline"), Sql::Integer(truthy(m.get("hasTimeline")) as i64), order, sql(m.get("thinkingDuration")),
                        Sql::Integer(truthy(m.get("stopped")) as i64), as_json("attachments"), text(msg_id.clone()), msg_created,
                    ],
                )?;
                if matches!(
                    m.get("role").and_then(Value::as_str),
                    Some("user" | "assistant")
                ) {
                    let content = match content {
                        Sql::Text(t) => Value::String(t),
                        _ => Value::Null,
                    };
                    index.push(json!({ "id": msg_id, "content": content }));
                }
            }
            if full {
                // Drop messages that are no longer part of the snapshot.
                let existing = query(
                    conn,
                    "SELECT id FROM messages WHERE conversation_id = ?",
                    vec![id.clone()],
                )?;
                for row in existing {
                    if let Some(old) = row.get("id").and_then(Value::as_str) {
                        if !saved.iter().any(|s| s == old) {
                            exec(
                                conn,
                                "DELETE FROM messages WHERE conversation_id = ? AND id = ?",
                                vec![id.clone(), text(old)],
                            )?;
                        }
                    }
                }
            }
            Ok(())
        };
        match body() {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e.to_string())
            }
        }
    })();
    match result {
        Ok(()) => (json!({ "success": true }), index),
        Err(e) => (json!({ "success": false, "error": e }), vec![]),
    }
}

pub fn history_delete(conn: &Connection, id: &Value) -> Result<Value, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    // Node never enables foreign_keys, so ON DELETE CASCADE does not fire there;
    // remove the messages explicitly instead of leaving orphans.
    exec(
        &tx,
        "DELETE FROM messages WHERE conversation_id = ?",
        vec![sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    exec(
        &tx,
        "DELETE FROM conversations WHERE id = ?",
        vec![sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub fn history_toggle_pin(conn: &Connection, id: &Value) -> Result<Value, String> {
    let rows = query(
        conn,
        "UPDATE conversations
        SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END,
            is_bookmarked = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END,
            updated_at = ? WHERE id = ? RETURNING is_pinned",
        vec![text(iso_now()), sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    let Some(r) = rows.first() else {
        return Ok(
            json!({ "success": false, "isPinned": false, "error": "Conversation not found" }),
        );
    };
    Ok(json!({ "success": true, "isPinned": is_one(r.get("is_pinned")) }))
}

pub fn history_toggle_unread(conn: &Connection, id: &Value) -> Result<Value, String> {
    let rows = query(
        conn,
        "UPDATE conversations
        SET is_unread = CASE WHEN is_unread = 1 THEN 0 ELSE 1 END,
            updated_at = ? WHERE id = ? RETURNING is_unread",
        vec![text(iso_now()), sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    let Some(r) = rows.first() else {
        return Ok(
            json!({ "success": false, "isUnread": false, "error": "Conversation not found" }),
        );
    };
    Ok(json!({ "success": true, "isUnread": is_one(r.get("is_unread")) }))
}

pub fn history_update_title(conn: &Connection, id: &Value, title: &Value) -> Result<Value, String> {
    let title = title.as_str().ok_or("title.trim is not a function")?.trim();
    exec(
        conn,
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        vec![text(title), text(iso_now()), sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

pub fn history_set_project(
    conn: &Connection,
    id: &Value,
    project: &Value,
) -> Result<Value, String> {
    exec(
        conn,
        "UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?",
        vec![or_null(Some(project)), text(iso_now()), sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

// ---- projects ----

fn project(row: &Row) -> Value {
    json!({
        "id": get(row, "id"), "name": get(row, "name"), "instructions": get(row, "instructions"), "path": get(row, "path"),
        "isPinned": is_one(row.get("is_pinned")),
        "isBookmarked": is_one(row.get("is_bookmarked")) || is_one(row.get("is_pinned")),
        "createdAt": get(row, "created_at"), "updatedAt": get(row, "updated_at"),
    })
}

pub fn projects_list(conn: &Connection) -> Result<Value, String> {
    let rows = query(conn, "SELECT * FROM projects ORDER BY (is_pinned = 1 OR is_bookmarked = 1) DESC, updated_at DESC", vec![]).map_err(|e| e.to_string())?;
    Ok(Value::Array(rows.iter().map(project).collect()))
}

fn trim_slashes_lower(s: &str) -> String {
    s.trim_end_matches(['\\', '/']).to_lowercase()
}

/// By id, then exact path, then a case-insensitive path without trailing slashes.
pub(super) fn project_get(conn: &Connection, id_or_path: &Value) -> Result<Option<Value>, String> {
    let Some(key) = id_or_path.as_str().filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    for statement in [
        "SELECT * FROM projects WHERE id = ?",
        "SELECT * FROM projects WHERE path = ?",
    ] {
        if let Some(r) = query(conn, statement, vec![text(key)])
            .map_err(|e| e.to_string())?
            .first()
        {
            return Ok(Some(project(r)));
        }
    }
    let wanted = trim_slashes_lower(key);
    let all = projects_list(conn)?;
    Ok(all
        .as_array()
        .into_iter()
        .flatten()
        .find(|p| {
            p["id"] == key
                || p["path"]
                    .as_str()
                    .map(|s| trim_slashes_lower(s) == wanted)
                    .unwrap_or(false)
        })
        .cloned())
}

pub fn projects_create(conn: &Connection, data: &Value) -> Value {
    let r = (|| -> Result<Value, String> {
        let mut p = data.as_object().cloned().unwrap_or_default();
        let id = uuid_v4();
        let now = iso_now();
        p.insert("id".into(), json!(id));
        p.insert("isPinned".into(), json!(false));
        p.insert("isBookmarked".into(), json!(false));
        p.insert("createdAt".into(), json!(now));
        p.insert("updatedAt".into(), json!(now));
        let dir = p
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .ok_or("Missing project directory")?;
        let dir = Path::new(dir);
        let transaction =
            rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Deferred)
                .map_err(|error| error.to_string())?;
        exec(
            &transaction,
            "INSERT INTO projects (id, name, instructions, path, is_pinned, is_bookmarked, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            vec![text(&id), sql(p.get("name")), or_null(p.get("instructions")), sql(p.get("path")), text(&now), text(&now)],
        )
        .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        if let Some(files) = p.get("files").and_then(Value::as_array) {
            for f in files.iter().filter_map(Value::as_str) {
                if let Some(name) = Path::new(f).file_name() {
                    if let Err(e) = std::fs::copy(f, dir.join(name)) {
                        eprintln!("[everfern] could not copy {f}: {e}");
                    }
                }
            }
        }
        Ok(Value::Object(p))
    })();
    match r {
        Ok(p) => json!({ "success": true, "project": p }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub fn projects_update(conn: &Connection, id: &Value, updates: &Value) -> Result<Value, String> {
    let Some(existing) = project_get(conn, id)? else {
        return Ok(json!({ "success": false, "error": "Project not found" }));
    };
    let pick = |k: &str| {
        updates
            .get(k)
            .cloned()
            .unwrap_or_else(|| existing[k].clone())
    };
    let flag = |k: &str| {
        Sql::Integer(match updates.get(k) {
            Some(v) => truthy(Some(v)),
            None => existing[k].as_bool().unwrap_or(false),
        } as i64)
    };
    exec(
        conn,
        "UPDATE projects SET name = ?, instructions = ?, path = ?, is_pinned = ?, is_bookmarked = ?, updated_at = ? WHERE id = ?",
        vec![sql(Some(&pick("name"))), sql(Some(&pick("instructions"))), sql(Some(&pick("path"))), flag("isPinned"), flag("isBookmarked"), text(iso_now()), sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    let mut out = json!({ "success": true });
    if let Some(p) = project_get(conn, id)? {
        out["project"] = p;
    }
    Ok(out)
}

pub fn projects_toggle_bookmark(conn: &Connection, id: &Value) -> Result<Value, String> {
    let transaction =
        rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
    let Some(p) = project_get(&transaction, id)? else {
        return Ok(
            json!({ "success": false, "isBookmarked": false, "error": "Project not found" }),
        );
    };
    let next = !p["isBookmarked"].as_bool().unwrap_or(false);
    exec(
        &transaction,
        "UPDATE projects SET is_bookmarked = ?, is_pinned = ?, updated_at = ? WHERE id = ?",
        vec![
            Sql::Integer(next as i64),
            Sql::Integer(next as i64),
            text(iso_now()),
            sql(p.get("id")),
        ],
    )
    .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(json!({ "success": true, "isBookmarked": next }))
}

pub fn projects_delete(conn: &Connection, id: &Value) -> Result<Value, String> {
    exec(
        conn,
        "DELETE FROM projects WHERE id = ?",
        vec![sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

// ---- scheduled tasks ----

fn task(row: &Row) -> Value {
    let pick = |a: &str, b: &str| {
        if truthy(row.get(a)) {
            get(row, a)
        } else {
            get(row, b)
        }
    };
    json!({
        "id": get(row, "id"), "name": get(row, "name"), "description": get(row, "description"), "cron": get(row, "cron"),
        "pattern": pick("pattern", "cron"), "prompt": get(row, "prompt"), "projectId": get(row, "project_id"),
        "startsAt": pick("starts_at", "created_at"), "lastRun": get(row, "last_run"), "nextRun": get(row, "next_run"),
        "endsAt": get(row, "ends_at"), "enabled": truthy(row.get("enabled")),
        "createdAt": get(row, "created_at"), "updatedAt": get(row, "updated_at"),
    })
}

pub fn tasks_list(conn: &Connection, project: Option<&Value>) -> Result<Value, String> {
    let rows = if truthy(project) {
        query(
            conn,
            "SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC",
            vec![sql(project)],
        )
    } else {
        query(
            conn,
            "SELECT * FROM scheduled_tasks ORDER BY created_at DESC",
            vec![],
        )
    }
    .map_err(|e| e.to_string())?;
    Ok(Value::Array(rows.iter().map(task).collect()))
}

pub fn enabled_tasks(conn: &Connection) -> Result<Vec<Value>, String> {
    let rows = query(
        conn,
        "SELECT * FROM scheduled_tasks WHERE enabled <> 0 ORDER BY created_at DESC",
        vec![],
    )
    .map_err(|error| error.to_string())?;
    Ok(rows.iter().map(task).collect())
}

pub fn tasks_get(conn: &Connection, id: &Value) -> Result<Value, String> {
    let rows = query(
        conn,
        "SELECT * FROM scheduled_tasks WHERE id = ?",
        vec![sql(Some(id))],
    )
    .map_err(|e| e.to_string())?;
    Ok(rows.first().map(task).unwrap_or(Value::Null))
}

pub fn tasks_delete(conn: &Connection, id: &Value) -> Value {
    match exec(
        conn,
        "DELETE FROM scheduled_tasks WHERE id = ?",
        vec![sql(Some(id))],
    ) {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

pub fn tasks_save(conn: &Connection, task: &Value) -> Result<Value, String> {
    if !task.is_object() {
        return Err("Expected a scheduled task object".into());
    }
    let transaction =
        rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
    let id = task["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(uuid_v4);
    let id_value = json!(id);
    let existing = tasks_get(&transaction, &id_value)?;
    let now = chrono::Local::now();
    let timestamp = json!(now
        .to_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let field = |name: &str, default: Value| {
        task.get(name)
            .filter(|value| truthy(Some(value)))
            .or_else(|| existing.get(name).filter(|value| truthy(Some(value))))
            .cloned()
            .unwrap_or(default)
    };
    let cron = field("cron", json!(""));
    let starts_at = field("startsAt", timestamp.clone());
    let enabled = if existing.is_null() {
        task["enabled"] != false
    } else {
        task.get("enabled").map_or_else(
            || truthy(existing.get("enabled")),
            |value| truthy(Some(value)),
        )
    };
    let values = [
        field("name", Value::Null),
        field("description", json!("")),
        cron.clone(),
        field("pattern", cron.clone()),
        field("prompt", json!("")),
        field("projectId", Value::Null),
        starts_at.clone(),
        json!(enabled),
        field("endsAt", Value::Null),
        timestamp.clone(),
    ];
    let mut parameters: Vec<_> = values.iter().map(|value| sql(Some(value))).collect();
    parameters.push(sql(Some(&id_value)));
    if existing.is_null() {
        let next_run = super::schedule::first_run(
            cron.as_str().ok_or("Invalid schedule")?,
            starts_at.as_str().ok_or("Invalid start date")?,
            now,
        )?;
        parameters.push(Sql::Text(next_run));
        parameters.push(sql(Some(&timestamp)));
        exec(&transaction,
            "INSERT INTO scheduled_tasks (name, description, cron, pattern, prompt, project_id, starts_at, enabled, ends_at, updated_at, id, next_run, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", parameters)
    } else {
        exec(&transaction,
            "UPDATE scheduled_tasks SET name=?, description=?, cron=?, pattern=?, prompt=?, project_id=?, starts_at=?, enabled=?, ends_at=?, updated_at=? WHERE id=?",
            parameters)
    }.map_err(|error| error.to_string())?;
    let saved = tasks_get(&transaction, &id_value)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(saved)
}

pub fn tasks_update_run_times(
    conn: &Connection,
    id: &str,
    last_run: &str,
    next_run: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE scheduled_tasks SET last_run = ?, next_run = ?, updated_at = ? WHERE id = ?",
        rusqlite::params![last_run, next_run, iso_now(), id],
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub fn prepare_scheduled_run(
    conn: &Connection,
    id: &str,
    now: chrono::DateTime<chrono::Local>,
    revision: &Value,
) -> Result<Option<Value>, String> {
    let transaction =
        rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
    let task = tasks_get(&transaction, &json!(id))?;
    if task.is_null()
        || &task["updatedAt"] != revision
        || super::schedule::task_decisions(std::slice::from_ref(&task), now)[0] != "run"
    {
        return Ok(None);
    }
    let last_run = now
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let next_run = super::schedule::next_run(
        task["cron"].as_str().ok_or("Missing schedule")?,
        task["startsAt"].as_str(),
        Some(&last_run),
        now,
    )?;
    tasks_update_run_times(&transaction, id, &last_run, &next_run)?;
    let conversation_id = create_scheduled_conversation(&transaction, &task, now)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(Some(json!({
        "conversationId": conversation_id,
        "task": task,
    })))
}

pub fn create_scheduled_conversation(
    conn: &Connection,
    task: &Value,
    now: chrono::DateTime<chrono::Local>,
) -> Result<String, String> {
    let id = task["id"].as_str().ok_or("Missing scheduled task ID")?;
    let timestamp = now
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let conversation_id = format!("scheduled-{id}-{}", now.timestamp_millis());
    let label = task["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .or_else(|| task["description"].as_str())
        .unwrap_or("undefined");
    let title = format!("Scheduled: {label}");
    conn.execute(
        "INSERT INTO conversations (id, title, provider, project_id, created_at, updated_at)
         VALUES (?, ?, 'ollama', ?, ?, ?)",
        rusqlite::params![
            conversation_id,
            title,
            task["projectId"].as_str(),
            timestamp,
            timestamp,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(conversation_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("sql").join("memory.sqlite")).unwrap();
        (dir, conn)
    }

    #[test]
    fn iso_and_uuid_have_the_js_shapes() {
        let t = iso_now();
        assert_eq!(t.len(), 24);
        assert!(t.ends_with('Z') && &t[10..11] == "T");
        let u = uuid_v4();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
        assert_ne!(uuid_v4(), uuid_v4());
    }

    #[test]
    fn history_save_load_round_trip() {
        let (_d, conn) = db();
        let conv = json!({
            "id": "c1", "title": "Hello", "provider": "anthropic", "createdAt": "2026-01-01T00:00:00.000Z",
            "messages": [
                { "id": "m1", "role": "user", "content": "hi" },
                { "id": "m2", "role": "assistant", "content": "yo", "thought": "think",
                  "toolCalls": [{ "name": "b", "orderIndex": 5 }, { "name": "a" }], "stopped": true, "thinkingDuration": 3 }
            ]
        });
        let (res, index) = history_save(&conn, &conv);
        assert_eq!(res, json!({ "success": true }));
        assert_eq!(index.len(), 2);
        let loaded = history_load(&conn, &json!("c1")).unwrap();
        assert_eq!(loaded["title"], "Hello");
        assert_eq!(loaded["createdAt"], "2026-01-01T00:00:00.000Z");
        assert_eq!(loaded["isUnread"], false);
        let m2 = &loaded["messages"][1];
        assert_eq!(m2["reasoning_content"], "think");
        assert_eq!(m2["toolCalls"][0]["name"], "a");
        assert_eq!(
            m2["toolCalls"][0]["orderIndex"], 1,
            "missing orderIndex is stamped with its position"
        );
        assert_eq!(m2["stopped"], true);
        assert_eq!(m2["thinkingDuration"], 3);
        assert_eq!(m2["orderIndex"], 1);
        assert!(loaded["messages"][0].get("toolCalls").is_none());
        assert!(loaded["messages"][0].get("thinkingDuration").is_none());

        // A full save without m1 drops it; a partial save keeps what is there.
        history_save(
            &conn,
            &json!({ "id": "c1", "messages": [{ "id": "m2", "role": "assistant", "content": "yo" }] }),
        );
        assert_eq!(
            history_load(&conn, &json!("c1")).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        history_save(
            &conn,
            &json!({ "id": "c1", "isFullSave": false, "messages": [{ "id": "m3", "role": "user", "content": "x" }] }),
        );
        let list = history_list(&conn).unwrap();
        assert_eq!(list[0]["messageCount"], 2);
        assert_eq!(list[0]["title"], "Hello", "COALESCE keeps the old title");

        assert_eq!(
            history_toggle_pin(&conn, &json!("c1")).unwrap(),
            json!({ "success": true, "isPinned": true })
        );
        assert_eq!(history_list(&conn).unwrap()[0]["isBookmarked"], true);
        assert_eq!(
            history_toggle_unread(&conn, &json!("c1")).unwrap()["isUnread"],
            true
        );
        assert_eq!(
            history_toggle_pin(&conn, &json!("nope")).unwrap()["error"],
            "Conversation not found"
        );
        history_update_title(&conn, &json!("c1"), &json!("  New  ")).unwrap();
        assert_eq!(history_load(&conn, &json!("c1")).unwrap()["title"], "New");
        assert_eq!(
            history_load(&conn, &json!("missing")).unwrap(),
            json!({ "error": "Not found" })
        );

        history_delete(&conn, &json!("c1")).unwrap();
        assert_eq!(history_list(&conn).unwrap(), json!([]));
        assert!(query(&conn, "SELECT id FROM messages", vec![])
            .unwrap()
            .is_empty());
        assert_eq!(
            history_save(&conn, &json!({ "id": "x" })).0["success"],
            false
        );
    }

    #[test]
    fn project_create_rolls_back_when_directory_is_blocked() {
        let (directory, conn) = db();
        let path = directory.path().join("project");
        std::fs::write(&path, b"existing file").unwrap();
        let request = json!({"name": "Example", "path": path});
        assert_eq!(projects_create(&conn, &request)["success"], false);
        assert_eq!(projects_list(&conn).unwrap(), json!([]));
        assert_eq!(std::fs::read(&path).unwrap(), b"existing file");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(projects_create(&conn, &request)["success"], true);
        assert!(path.is_dir());
        assert_eq!(projects_list(&conn).unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn projects_and_history_by_project() {
        let (dir, conn) = db();
        let path = dir.path().join("proj");
        let created = projects_create(
            &conn,
            &json!({ "name": "P", "path": path.to_str().unwrap() }),
        );
        assert_eq!(created["success"], true);
        assert!(path.is_dir());
        let id = created["project"]["id"].clone();
        history_save(
            &conn,
            &json!({ "id": "c1", "projectId": id, "messages": [] }),
        );
        history_save(&conn, &json!({ "id": "c2", "messages": [] }));
        assert_eq!(
            history_list_by_project(&conn, &json!("P"))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            history_list(&conn)
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == "c1")
                .unwrap()["projectName"],
            "P"
        );

        let upd = projects_update(&conn, &id, &json!({ "name": "Q" })).unwrap();
        assert_eq!(upd["project"]["name"], "Q");
        assert_eq!(upd["project"]["instructions"], Value::Null);
        let by_path = format!("{}\\", path.to_str().unwrap().to_uppercase());
        assert!(project_get(&conn, &json!(by_path)).unwrap().is_some());
        assert_eq!(
            projects_toggle_bookmark(&conn, &id).unwrap()["isBookmarked"],
            true
        );
        assert_eq!(projects_list(&conn).unwrap()[0]["isPinned"], true);
        projects_delete(&conn, &id).unwrap();
        assert_eq!(projects_list(&conn).unwrap(), json!([]));
        assert_eq!(
            projects_update(&conn, &id, &json!({})).unwrap()["error"],
            "Project not found"
        );
    }

    #[test]
    fn scheduled_tasks_read_and_delete() {
        let (_d, conn) = db();
        exec(&conn, "INSERT INTO scheduled_tasks (id, description, cron, prompt, project_id, enabled, created_at, updated_at) VALUES ('t1', 'd', '0 9 * * *', 'p', 'P1', 1, 'a', 'b')", vec![]).unwrap();
        let t = tasks_get(&conn, &json!("t1")).unwrap();
        assert_eq!(t["pattern"], "0 9 * * *");
        assert_eq!(t["startsAt"], "a");
        assert_eq!(t["enabled"], true);
        assert_eq!(
            tasks_list(&conn, Some(&json!("P1")))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(tasks_list(&conn, Some(&json!("P2"))).unwrap(), json!([]));
        assert_eq!(
            tasks_delete(&conn, &json!("t1")),
            json!({ "success": true })
        );
        assert_eq!(tasks_get(&conn, &json!("t1")).unwrap(), Value::Null);
    }

    #[test]
    fn scheduled_run_claim_rolls_back_and_rejects_stale_dispatches() {
        let (_dir, conn) = db();
        let task = tasks_save(
            &conn,
            &json!({
                "id": "due", "name": "Reminder", "cron": "every 5 minutes", "enabled": true,
                "startsAt": "2020-01-01T12:00:00Z", "prompt": "Check status"
            }),
        )
        .unwrap();
        let now = chrono::Local::now();
        let next = (now.with_timezone(&chrono::Utc) + chrono::Duration::minutes(5))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let revision = &task["updatedAt"];
        assert!(prepare_scheduled_run(&conn, "due", now, &json!("stale"))
            .unwrap()
            .is_none());
        conn.execute_batch(
            "CREATE TRIGGER reject_conversation BEFORE INSERT ON conversations
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        )
        .unwrap();
        assert!(prepare_scheduled_run(&conn, "due", now, revision).is_err());
        assert_eq!(tasks_get(&conn, &json!("due")).unwrap(), task);
        conn.execute_batch("DROP TRIGGER reject_conversation")
            .unwrap();
        let conversation = prepare_scheduled_run(&conn, "due", now, revision)
            .unwrap()
            .unwrap();
        assert!(prepare_scheduled_run(&conn, "due", now, revision)
            .unwrap()
            .is_none());
        assert_eq!(tasks_get(&conn, &json!("due")).unwrap()["nextRun"], next);
        let provider: String = conn
            .query_row(
                "SELECT provider FROM conversations WHERE id = ?",
                [conversation["conversationId"].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(provider, "ollama");
        assert_eq!(conversation["task"]["prompt"], "Check status");
        let claimed = tasks_get(&conn, &json!("due")).unwrap();
        let retry = create_scheduled_conversation(
            &conn,
            &conversation["task"],
            now + chrono::Duration::seconds(10),
        )
        .unwrap();
        assert_ne!(retry, conversation["conversationId"].as_str().unwrap());
        assert_eq!(tasks_get(&conn, &json!("due")).unwrap(), claimed);
    }

    #[test]
    fn scheduled_task_save_preserves_existing_run_times_on_partial_updates() {
        let (_dir, conn) = db();
        let saved = tasks_save(
            &conn,
            &json!({
                "id": "t1", "name": "Reminder", "cron": "every 5 minutes",
                "startsAt": "2099-01-01T12:00:00Z", "prompt": "Check status"
            }),
        )
        .unwrap();
        assert_eq!(saved["nextRun"], "2099-01-01T12:05:00.000Z");
        assert_eq!(saved["pattern"], "every 5 minutes");
        let updated = tasks_save(&conn, &json!({"id": "t1", "enabled": false})).unwrap();
        assert_eq!(updated["enabled"], false);
        for field in ["createdAt", "startsAt", "nextRun", "prompt", "name"] {
            assert_eq!(updated[field], saved[field]);
        }
    }
}
pub fn interrupted_state(connection: &Connection, conversation_id: Option<&str>) -> Value {
    let Some(id) = conversation_id.filter(|id| !id.is_empty()) else {
        return json!({"interrupted": false});
    };
    let data = connection.query_row(
        "SELECT interrupt_data_json FROM hitl_state WHERE conversation_id = ? AND is_interrupted = 1",
        [id],
        |row| row.get::<_, String>(0),
    );
    match data
        .ok()
        .and_then(|data| serde_json::from_str::<Value>(&data).ok())
    {
        Some(data)
            if !data.is_null() && data != false && data != "" && data.as_f64() != Some(0.0) =>
        {
            json!({"interrupted": true, "interruptData": data})
        }
        _ => json!({"interrupted": false}),
    }
}

#[cfg(test)]
#[test]
fn interrupted_state_reads_only_active_checkpoints() {
    let connection = Connection::open_in_memory().unwrap();
    assert_eq!(
        interrupted_state(&connection, Some("active")),
        json!({"interrupted": false})
    );
    connection.execute_batch(
        r#"CREATE TABLE hitl_state (conversation_id TEXT, is_interrupted INTEGER, interrupt_data_json TEXT);
        INSERT INTO hitl_state VALUES ('active', 1, '{"reason":"approval"}'),
                                      ('resumed', 0, '{}'), ('damaged', 1, '{');"#,
    ).unwrap();
    assert_eq!(
        interrupted_state(&connection, Some("active")),
        json!({"interrupted": true, "interruptData": {"reason": "approval"}})
    );
    for id in ["resumed", "damaged", "missing"] {
        assert_eq!(
            interrupted_state(&connection, Some(id)),
            json!({"interrupted": false})
        );
    }
}
