//! One SQLite database for the Node side, in place of the `sqlite3` addon.
//!
//!   everfern --ef-sqlite <path | :memory:>
//!
//! Reads one JSON request per line on stdin and answers each with one JSON line on
//! stdout, in order. The first line written is the answer to opening the file (id 0).
//!
//!   {"id":1,"op":"run","sql":"...","params":[...]}  -> {"id":1,"lastID":n,"changes":n}
//!   {"id":2,"op":"get", ...}                          -> {"id":2,"row":{...}|null}
//!   {"id":3,"op":"all", ...}                          -> {"id":3,"rows":[...]}
//!   {"id":4,"op":"exec","sql":"...;..."}              -> {"id":4}
//!   {"id":5,"op":"loadExtension","path":"..."}        -> {"id":5}
//!   {"id":6,"op":"close"}                             -> {"id":6}, then exit
//! Failures answer {"id":n,"error":"SQLITE_X: message","code":"SQLITE_X"}.
//! Blobs travel both ways as {"$b":"<base64>"}. The process exits when stdin closes.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{Connection, Statement};
use serde_json::{json, Map, Value};
use std::io::{BufRead, Write};

pub fn serve(path: &str) -> ! {
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut reply = |value: Value| {
        // Node is gone if stdout is closed; nothing left to do.
        if writeln!(out, "{value}").and_then(|_| out.flush()).is_err() {
            std::process::exit(0);
        }
    };

    let conn = match open(path) {
        Ok(conn) => conn,
        Err(error) => {
            reply(error_reply(0, &error));
            std::process::exit(1);
        }
    };
    reply(json!({"id": 0}));

    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                reply(
                    json!({"id": null, "error": format!("SQLITE_MISUSE: bad request: {error}"), "code": "SQLITE_MISUSE"}),
                );
                continue;
            }
        };
        let id = request["id"].clone();
        let closing = request["op"] == "close";
        let mut answer = match handle(&conn, &request) {
            Ok(Value::Object(fields)) => Value::Object(fields),
            Ok(_) => json!({}),
            Err(error) => error_reply_value(&error),
        };
        answer["id"] = id;
        reply(answer);
        if closing {
            break;
        }
    }
    drop(conn);
    std::process::exit(0);
}

fn open(path: &str) -> Result<Connection, rusqlite::Error> {
    let conn = if path == ":memory:" || path.is_empty() {
        Connection::open_in_memory()?
    } else {
        Connection::open(path)?
    };
    // node-sqlite3 opens every database with a 1 s busy timeout; callers raise it with a PRAGMA.
    conn.busy_timeout(std::time::Duration::from_millis(1000))?;
    Ok(conn)
}

fn handle(conn: &Connection, request: &Value) -> Result<Value, rusqlite::Error> {
    let sql = request["sql"].as_str().unwrap_or("");
    match request["op"].as_str().unwrap_or("") {
        "exec" => {
            conn.execute_batch(sql)?;
            Ok(json!({}))
        }
        "run" => {
            let mut statement = conn.prepare(sql)?;
            bind(&mut statement, &request["params"])?;
            let mut rows = statement.raw_query();
            while rows.next()?.is_some() {}
            Ok(json!({"lastID": conn.last_insert_rowid(), "changes": conn.changes()}))
        }
        "get" => {
            let mut rows = select(conn, sql, &request["params"], Some(1))?;
            Ok(json!({"row": rows.pop().unwrap_or(Value::Null)}))
        }
        "all" => Ok(json!({"rows": select(conn, sql, &request["params"], None)?})),
        "loadExtension" => {
            let path = request["path"].as_str().unwrap_or("");
            // Extension loading is switched on only for this call.
            unsafe {
                let _guard = rusqlite::LoadExtensionGuard::new(conn)?;
                conn.load_extension(path, None::<&str>)?;
            }
            Ok(json!({}))
        }
        "close" => Ok(json!({})),
        other => Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_MISUSE),
            Some(format!("unknown op {other:?}")),
        )),
    }
}

fn select(
    conn: &Connection,
    sql: &str,
    params: &Value,
    limit: Option<usize>,
) -> Result<Vec<Value>, rusqlite::Error> {
    let mut statement = conn.prepare(sql)?;
    bind(&mut statement, params)?;
    let names: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(String::from)
        .collect();
    let mut rows = statement.raw_query();
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            object.insert(name.clone(), to_json(row.get_ref(index)?));
        }
        out.push(Value::Object(object));
        if limit.is_some_and(|limit| out.len() >= limit) {
            break;
        }
    }
    Ok(out)
}

/// Binds an array (positional) or an object (`$name`, `:name`, `@name` keys) of parameters.
fn bind(statement: &mut Statement, params: &Value) -> Result<(), rusqlite::Error> {
    match params {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                if index >= statement.parameter_count() {
                    break; // node-sqlite3 ignores extra parameters too.
                }
                statement.raw_bind_parameter(index + 1, to_sql(value))?;
            }
        }
        Value::Object(named) => {
            for (key, value) in named {
                let index = match key.chars().next() {
                    Some('$' | ':' | '@') => statement.parameter_index(key)?,
                    _ => ["$", ":", "@"].iter().find_map(|p| {
                        statement
                            .parameter_index(&format!("{p}{key}"))
                            .ok()
                            .flatten()
                    }),
                };
                if let Some(index) = index {
                    statement.raw_bind_parameter(index, to_sql(value))?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn to_sql(value: &Value) -> Sql {
    match value {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(Sql::Integer)
            .unwrap_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => Sql::Text(s.clone()),
        Value::Object(o) if o.len() == 1 && o.contains_key("$b") => Sql::Blob(
            o["$b"]
                .as_str()
                .and_then(|b| B64.decode(b).ok())
                .unwrap_or_default(),
        ),
        other => Sql::Text(other.to_string()),
    }
}

fn to_json(value: ValueRef) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => json!({"$b": B64.encode(b)}),
    }
}

/// node-sqlite3 style: `code` is the SQLITE_* name and the message starts with it.
fn error_reply_value(error: &rusqlite::Error) -> Value {
    let code = match error {
        rusqlite::Error::SqliteFailure(e, _) => code_name(e.extended_code & 0xff),
        _ => "SQLITE_ERROR",
    };
    let message = match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) => message.clone(),
        rusqlite::Error::SqliteFailure(e, None) => e.to_string(),
        other => other.to_string(),
    };
    json!({"error": format!("{code}: {message}"), "code": code})
}

fn error_reply(id: u64, error: &rusqlite::Error) -> Value {
    let mut value = error_reply_value(error);
    value["id"] = json!(id);
    value
}

fn code_name(primary: i32) -> &'static str {
    use rusqlite::ffi::*;
    match primary {
        SQLITE_PERM => "SQLITE_PERM",
        SQLITE_ABORT => "SQLITE_ABORT",
        SQLITE_BUSY => "SQLITE_BUSY",
        SQLITE_LOCKED => "SQLITE_LOCKED",
        SQLITE_NOMEM => "SQLITE_NOMEM",
        SQLITE_READONLY => "SQLITE_READONLY",
        SQLITE_INTERRUPT => "SQLITE_INTERRUPT",
        SQLITE_IOERR => "SQLITE_IOERR",
        SQLITE_CORRUPT => "SQLITE_CORRUPT",
        SQLITE_FULL => "SQLITE_FULL",
        SQLITE_CANTOPEN => "SQLITE_CANTOPEN",
        SQLITE_SCHEMA => "SQLITE_SCHEMA",
        SQLITE_TOOBIG => "SQLITE_TOOBIG",
        SQLITE_CONSTRAINT => "SQLITE_CONSTRAINT",
        SQLITE_MISMATCH => "SQLITE_MISMATCH",
        SQLITE_MISUSE => "SQLITE_MISUSE",
        SQLITE_RANGE => "SQLITE_RANGE",
        SQLITE_NOTADB => "SQLITE_NOTADB",
        _ => "SQLITE_ERROR",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(conn: &Connection, request: Value) -> Value {
        handle(conn, &request).unwrap_or_else(|e| error_reply_value(&e))
    }

    #[test]
    fn run_get_all_round_trip() {
        let conn = open(":memory:").unwrap();
        call(
            &conn,
            json!({"op": "exec", "sql": "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, data BLOB, score REAL)"}),
        );
        let ran = call(
            &conn,
            json!({"op": "run", "sql": "INSERT INTO t (name, data, score) VALUES (?, ?, ?)",
            "params": ["a", {"$b": B64.encode([1u8, 2, 3])}, 1.5]}),
        );
        assert_eq!(ran, json!({"lastID": 1, "changes": 1}));
        call(
            &conn,
            json!({"op": "run", "sql": "INSERT INTO t (name) VALUES ($name)", "params": {"$name": "b"}}),
        );
        let row = call(
            &conn,
            json!({"op": "get", "sql": "SELECT * FROM t WHERE id = ?", "params": [1]}),
        );
        assert_eq!(
            row["row"],
            json!({"id": 1, "name": "a", "data": {"$b": "AQID"}, "score": 1.5})
        );
        let rows = call(
            &conn,
            json!({"op": "all", "sql": "SELECT name FROM t ORDER BY id"}),
        );
        assert_eq!(rows["rows"], json!([{"name": "a"}, {"name": "b"}]));
        let none = call(
            &conn,
            json!({"op": "get", "sql": "SELECT * FROM t WHERE id = 99"}),
        );
        assert_eq!(none["row"], Value::Null);
    }

    #[test]
    fn errors_carry_sqlite_codes() {
        let conn = open(":memory:").unwrap();
        call(
            &conn,
            json!({"op": "exec", "sql": "CREATE TABLE t (id TEXT PRIMARY KEY)"}),
        );
        call(
            &conn,
            json!({"op": "run", "sql": "INSERT INTO t VALUES ('x')"}),
        );
        let dup = call(
            &conn,
            json!({"op": "run", "sql": "INSERT INTO t VALUES ('x')"}),
        );
        assert_eq!(dup["code"], "SQLITE_CONSTRAINT");
        assert!(dup["error"]
            .as_str()
            .unwrap()
            .starts_with("SQLITE_CONSTRAINT: UNIQUE"));
        let bad = call(&conn, json!({"op": "all", "sql": "SELECT * FROM missing"}));
        assert_eq!(bad["code"], "SQLITE_ERROR");
    }

    #[test]
    fn run_accepts_pragmas_that_return_rows() {
        let conn = open(":memory:").unwrap();
        let ran = call(
            &conn,
            json!({"op": "run", "sql": "PRAGMA journal_mode = WAL"}),
        );
        assert!(ran.get("error").is_none(), "{ran}");
    }
}
