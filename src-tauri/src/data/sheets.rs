//! The native Sheets app workbook, ported from `main/agent/tools/sheets-store.ts`.
//!
//! One JSON file per worker at `<userData>/worker-sheets/<workerId>.json`. Node's
//! sheet tools keep reading and writing the same file, so `normalize` has to clean
//! data exactly as `normalizeSheetData` does (including JavaScript's `Number()`
//! coercions). Top-level `cells/styles/...` mirror the active tab.

use crate::js;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const DEFAULT_COLUMNS: i64 = 12;
const DEFAULT_ROWS: i64 = 60;
const MAX_COLUMNS: i64 = 100;
const MAX_ROWS: i64 = 2000;
const MAX_CELL_LENGTH: usize = 50000;
const MAX_SHEETS: usize = 20;
const MIRRORED: [&str; 5] = ["cells", "styles", "colWidths", "rowHeights", "merges"];

static CELL_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{1,3}[1-9][0-9]{0,4}$").unwrap());
static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#[0-9a-fA-F]{3,8}$").unwrap());
static MERGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Z]{1,3}[1-9][0-9]{0,4}(:[A-Z]{1,3}[1-9][0-9]{0,4})?$").unwrap()
});
static SAFE_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9-]{1,64}$").unwrap());

/// Worker ids double as file names, so only plain ids are accepted (as in Node).
pub fn safe_id(id: Option<&str>) -> Option<&str> {
    id.filter(|id| SAFE_ID.is_match(id))
}

fn file_for(root: &Path, id: &str) -> PathBuf {
    root.join("worker-sheets").join(format!("{id}.json"))
}

pub fn load(root: &Path, id: &str) -> Value {
    std::fs::read_to_string(file_for(root, id))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .map(|raw| normalize(&raw))
        .unwrap_or_else(|| blank("Sheet1"))
}

pub fn save(root: &Path, id: &str, data: &Value) -> Result<Value, String> {
    let mut safe = normalize(data);
    let active = safe["active"].as_u64().unwrap_or(0) as usize;
    // The AI tools write to the top-level mirror; fold that back into the active tab.
    let tab = safe["sheets"][active].clone();
    let pick = |key: &str| {
        data.get(key).filter(|v| !v.is_null()).unwrap_or(&tab[key]).clone()
    };
    let folded = [
        ("cells", sanitize_cells(&pick("cells"))),
        ("styles", sanitize_styles(&pick("styles"))),
        ("colWidths", sanitize_widths(&pick("colWidths"), 24.0, 600.0)),
        ("rowHeights", sanitize_widths(&pick("rowHeights"), 18.0, 400.0)),
        ("merges", sanitize_merges(&pick("merges"))),
    ];
    for (key, value) in folded {
        safe["sheets"][active][key] = value.clone();
        safe[key] = value;
    }
    let path = file_for(root, id);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string(&safe).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(safe)
}

fn blank(name: &str) -> Value {
    let tab = blank_tab(name);
    let mut out = json!({ "name": name, "columns": DEFAULT_COLUMNS, "rows": DEFAULT_ROWS });
    for key in MIRRORED {
        out[key] = tab[key].clone();
    }
    out["sheets"] = json!([tab]);
    out["active"] = json!(0);
    out
}

fn blank_tab(name: &str) -> Value {
    json!({ "id": new_tab_id(), "name": name, "cells": {}, "styles": {}, "colWidths": {}, "rowHeights": {}, "merges": [] })
}

/// `tab-<ms>-<5 base36 chars>`, the shape Node generates.
fn new_tab_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let mut seed = (now.as_nanos() as u64)
        ^ COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let suffix: String = (0..5)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            char::from_digit((seed % 36) as u32, 36).unwrap()
        })
        .collect();
    format!("tab-{}-{suffix}", now.as_millis())
}

fn clamp_int(value: Option<&Value>, min: i64, max: i64, fallback: i64) -> i64 {
    let n = js::number(value);
    if !n.is_finite() {
        return fallback;
    }
    (n.trunc() as i64).clamp(min, max)
}

/// `s.trim().slice(0, n)`, counting UTF-16 units as JavaScript does.
fn trimmed(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty()).then(|| js::slice(text, max))
}

fn entries(value: &Value) -> impl Iterator<Item = (&String, &Value)> {
    value.as_object().into_iter().flatten()
}

fn sanitize_cells(cells: &Value) -> Value {
    let mut out = Map::new();
    for (key, value) in entries(cells) {
        if !CELL_KEY.is_match(key) || !(value.is_string() || value.is_number() || value.is_boolean()) {
            continue;
        }
        let text = js::string(value);
        if text.is_empty() || js::length(&text) > MAX_CELL_LENGTH {
            continue;
        }
        out.insert(key.clone(), Value::String(text));
    }
    Value::Object(out)
}

fn sanitize_style(raw: &Value) -> Option<Value> {
    let s = raw.as_object()?;
    let mut out = Map::new();
    for flag in ["b", "i", "u", "s"] {
        if s.get(flag) == Some(&Value::Bool(true)) {
            out.insert(flag.into(), Value::Bool(true));
        }
    }
    for colour in ["color", "bg"] {
        if let Some(hex) = s.get(colour).and_then(Value::as_str).filter(|v| HEX.is_match(v)) {
            out.insert(colour.into(), json!(hex));
        }
    }
    if let Some(align) = s.get("align").and_then(Value::as_str).filter(|v| ["left", "center", "right"].contains(v)) {
        out.insert("align".into(), json!(align));
    }
    if js::number(s.get("fs")).is_finite() {
        out.insert("fs".into(), json!(clamp_int(s.get("fs"), 6, 48, 12)));
    }
    if let Some(fmt) = s
        .get("fmt")
        .and_then(Value::as_str)
        .filter(|v| ["general", "number", "currency", "percent"].contains(v))
    {
        out.insert("fmt".into(), json!(fmt));
    }
    if js::number(s.get("decimals")).is_finite() {
        out.insert("decimals".into(), json!(clamp_int(s.get("decimals"), 0, 10, 2)));
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

fn sanitize_styles(styles: &Value) -> Value {
    let mut out = Map::new();
    for (key, value) in entries(styles) {
        if CELL_KEY.is_match(key) {
            if let Some(style) = sanitize_style(value) {
                out.insert(key.clone(), style);
            }
        }
    }
    Value::Object(out)
}

fn sanitize_widths(raw: &Value, min: f64, max: f64) -> Value {
    let mut out = Map::new();
    for (key, value) in entries(raw) {
        let idx = js::string_number(key);
        if idx.fract() != 0.0 || !(0.0..=500.0).contains(&idx) {
            continue;
        }
        let n = js::number(Some(value));
        if n.is_finite() {
            // Math.round rounds halves up.
            out.insert(key.clone(), json!((n + 0.5).floor().clamp(min, max) as i64));
        }
    }
    Value::Object(out)
}

fn sanitize_merges(raw: &Value) -> Value {
    let merges = raw.as_array().map_or(&[][..], Vec::as_slice);
    Value::Array(
        merges
            .iter()
            .filter(|m| m.as_str().is_some_and(|m| MERGE.is_match(m)))
            .take(200)
            .cloned()
            .collect(),
    )
}

fn sanitize_tab(raw: &Value, fallback_name: &str) -> Value {
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| SAFE_ID.is_match(id))
        .map_or_else(new_tab_id, str::to_owned);
    let null = Value::Null;
    let field = |key: &str| raw.get(key).unwrap_or(&null);
    json!({
        "id": id,
        "name": trimmed(raw.get("name"), 60).unwrap_or_else(|| fallback_name.to_owned()),
        "cells": sanitize_cells(field("cells")),
        "styles": sanitize_styles(field("styles")),
        "colWidths": sanitize_widths(field("colWidths"), 24.0, 600.0),
        "rowHeights": sanitize_widths(field("rowHeights"), 18.0, 400.0),
        "merges": sanitize_merges(field("merges")),
    })
}

pub fn normalize(raw: &Value) -> Value {
    let name = trimmed(raw.get("name"), 120).unwrap_or_else(|| "Sheet1".into());
    let columns = clamp_int(raw.get("columns"), 1, MAX_COLUMNS, DEFAULT_COLUMNS);
    let rows = clamp_int(raw.get("rows"), 1, MAX_ROWS, DEFAULT_ROWS);

    let sheets: Vec<Value> = match raw.get("sheets").and_then(Value::as_array) {
        Some(tabs) if !tabs.is_empty() => tabs
            .iter()
            .take(MAX_SHEETS)
            .enumerate()
            .map(|(i, tab)| {
                let fallback = if i == 0 { name.clone() } else { format!("Sheet{}", i + 1) };
                sanitize_tab(tab, &fallback)
            })
            .collect(),
        _ => {
            // A v1 file: the whole object is the one tab, named after the workbook.
            let mut flat = raw.as_object().cloned().unwrap_or_default();
            flat.insert("name".into(), json!(name));
            vec![sanitize_tab(&Value::Object(flat), &name)]
        }
    };

    let active = clamp_int(raw.get("active"), 0, sheets.len() as i64 - 1, 0) as usize;
    let mut out = json!({ "name": name, "columns": columns, "rows": rows });
    for key in MIRRORED {
        out[key] = sheets[active][key].clone();
    }
    out["sheets"] = Value::Array(sheets);
    out["active"] = json!(active);
    out
}

// ── Workbook operations for the agent's sheet tools (`--ef-sheet-op`) ──────────
//
// Each mirrors the function of the same name in sheets-store.ts. They edit the
// top-level mirror of the active tab, and `save` folds it back, as in Node.

/// "AB" -> 27; -1 for anything that is not a letter.
fn column_to_index(letters: &str) -> i64 {
    let mut n: i64 = 0;
    for ch in letters.to_ascii_uppercase().chars() {
        if !ch.is_ascii_uppercase() {
            return -1;
        }
        n = n * 26 + (ch as i64 - 64);
    }
    n - 1
}

fn index_to_column(index: i64) -> String {
    let mut n = index.max(0);
    let mut out = Vec::new();
    loop {
        out.push((b'A' + (n % 26) as u8) as char);
        n = n / 26 - 1;
        if n < 0 {
            break;
        }
    }
    out.iter().rev().collect()
}

static REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([A-Za-z]{1,3})([1-9][0-9]{0,4})$").unwrap());

/// "B3" -> (row 2, col 1), zero-based.
fn parse_ref(text: &str) -> Option<(i64, i64)> {
    let caps = REF.captures(text.trim())?;
    let col = column_to_index(&caps[1]);
    let row = caps[2].parse::<i64>().ok()? - 1;
    (col >= 0).then_some((row, col))
}

fn make_ref(row: i64, col: i64) -> String {
    format!("{}{}", index_to_column(col), row + 1)
}

fn object_mut<'a>(data: &'a mut Value, key: &str) -> &'a mut Map<String, Value> {
    if !data[key].is_object() {
        data[key] = json!({});
    }
    data[key].as_object_mut().unwrap()
}

fn used_bounds(data: &Value) -> (i64, i64) {
    entries(&data["cells"])
        .filter_map(|(key, _)| parse_ref(key))
        .fold((-1, -1), |(r, c), (row, col)| (r.max(row), c.max(col)))
}

/// Inclusive, zero-based: (start_row, start_col, end_row, end_col).
fn parse_range(range: Option<&str>, data: &Value) -> (i64, i64, i64, i64) {
    let text = range.unwrap_or("").trim();
    if !text.is_empty() {
        let mut parts = text.split(':');
        let start = parts.next().and_then(parse_ref);
        let end_raw = parts.next().filter(|end| !end.is_empty());
        if let Some(start) = start {
            if let Some(end) = end_raw.map_or(Some(start), parse_ref) {
                return (start.0.min(end.0), start.1.min(end.1), start.0.max(end.0), start.1.max(end.1));
            }
        }
    }
    match used_bounds(data) {
        (max_row, max_col) if max_row >= 0 && max_col >= 0 => (0, 0, max_row, max_col),
        _ => (0, 0, 0, 0),
    }
}

fn read_range(data: &Value, range: Option<&str>) -> Value {
    let (r0, c0, r1, c1) = parse_range(range, data);
    let rows: Vec<Value> = (r0..=r1)
        .map(|r| (c0..=c1).map(|c| data["cells"].get(make_ref(r, c)).cloned().unwrap_or_else(|| json!(""))).collect())
        .collect();
    json!({ "start": make_ref(r0, c0), "rows": rows })
}

fn grow(data: &mut Value, key: &str, at_least: i64) {
    let current = data[key].as_i64().unwrap_or(0);
    data[key] = json!(current.max(at_least));
}

fn write_range(data: &mut Value, start: &str, values: &[Value]) -> Value {
    let (origin_row, origin_col) = parse_ref(start).unwrap_or((0, 0));
    let mut written = 0;
    for (r, row) in values.iter().enumerate() {
        let Some(row) = row.as_array() else { continue };
        for (c, value) in row.iter().enumerate() {
            let (r, c) = (r as i64, c as i64);
            let key = make_ref(origin_row + r, origin_col + c);
            let text = if value.is_null() { String::new() } else { js::string(value) };
            if text.is_empty() {
                object_mut(data, "cells").shift_remove(&key);
            } else if js::length(&text) <= MAX_CELL_LENGTH {
                object_mut(data, "cells").insert(key, Value::String(text));
                written += 1;
            }
            grow(data, "rows", origin_row + r + 1);
            grow(data, "columns", origin_col + c + 1);
        }
    }
    json!({ "written": written, "start": make_ref(origin_row, origin_col) })
}

fn append_rows(data: &mut Value, values: &[Value]) -> Value {
    let (max_row, _) = used_bounds(data);
    write_range(data, &make_ref(max_row + 1, 0), values)
}

fn clear_range(data: &mut Value, range: Option<&str>) -> i64 {
    let (r0, c0, r1, c1) = parse_range(range, data);
    let cells = object_mut(data, "cells");
    let mut cleared = 0;
    for r in r0..=r1 {
        for c in c0..=c1 {
            if cells.shift_remove(&make_ref(r, c)).is_some() {
                cleared += 1;
            }
        }
    }
    cleared
}

fn apply_format(data: &mut Value, range: Option<&str>, patch: &Value) -> i64 {
    let (r0, c0, r1, c1) = parse_range(range, data);
    let styles = object_mut(data, "styles");
    let mut changed = 0;
    for r in r0..=r1 {
        for c in c0..=c1 {
            let key = make_ref(r, c);
            let mut merged = styles.get(&key).and_then(Value::as_object).cloned().unwrap_or_default();
            for (k, v) in entries(patch) {
                merged.insert(k.clone(), v.clone());
            }
            match sanitize_style(&Value::Object(merged)) {
                Some(next) => {
                    styles.insert(key, next);
                    changed += 1;
                }
                None => {
                    styles.shift_remove(&key);
                }
            }
        }
    }
    changed
}

fn add_sheet(data: &mut Value, name: Option<&str>) {
    let count = data["sheets"].as_array().map_or(0, Vec::len);
    if count >= MAX_SHEETS {
        return;
    }
    let name = name.map(|n| js::slice(n.trim(), 60)).filter(|n| !n.is_empty());
    let tab = blank_tab(&name.unwrap_or_else(|| format!("Sheet{}", count + 1)));
    for key in MIRRORED {
        data[key] = tab[key].clone();
    }
    if let Some(sheets) = data["sheets"].as_array_mut() {
        sheets.push(tab);
    }
    data["active"] = json!(count);
}

fn parse_delimited(text: &str) -> Vec<Vec<String>> {
    let first_line = text.split('\n').next().unwrap_or("");
    let tabs = first_line.matches('\t').count();
    let commas = first_line.matches(',').count();
    let delimiter = if tabs > commas { '\t' } else { ',' };

    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quoted {
            if ch != '"' {
                field.push(ch);
            } else if chars.peek() == Some(&'"') {
                field.push('"');
                chars.next();
            } else {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' => {}
            c if c == delimiter => row.push(std::mem::take(&mut field)),
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    while rows.last().is_some_and(|r| r.iter().all(String::is_empty)) {
        rows.pop();
    }
    rows
}

fn import_delimited(data: &mut Value, text: &str) -> Value {
    let rows = parse_delimited(text);
    data["cells"] = json!({});
    data["styles"] = json!({});
    data["merges"] = json!([]);
    let values: Vec<Value> = rows.iter().map(|r| json!(r)).collect();
    let written = if rows.is_empty() { json!(0) } else { write_range(data, "A1", &values)["written"].clone() };
    let widest = rows.iter().map(Vec::len).max().unwrap_or(0) as i64;
    data["rows"] = json!(DEFAULT_ROWS.max(rows.len() as i64));
    data["columns"] = json!(DEFAULT_COLUMNS.max(widest));
    json!({ "written": written, "rows": rows.len(), "columns": data["columns"] })
}

fn sheet_to_csv(data: &Value) -> String {
    let (max_row, max_col) = used_bounds(data);
    if max_row < 0 || max_col < 0 {
        return String::new();
    }
    let field = |r, c| {
        let value = data["cells"].get(make_ref(r, c)).and_then(Value::as_str).unwrap_or("");
        if value.contains(['"', ',', '\n', '\r']) {
            format!("\"{}\"", value.replace('"', "\"\""))
        } else {
            value.to_owned()
        }
    };
    (0..=max_row)
        .map(|r| (0..=max_col).map(|c| field(r, c)).collect::<Vec<_>>().join(","))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `--ef-sheet-op`: `{root, workerId, op, args}`. Returns `{result}`, plus `saved`
/// (the normalized workbook) for ops that write. The Node tool keeps argument
/// checks, the renderer broadcast and the wording of its output.
pub fn op(request: &Value) -> Result<Value, String> {
    let root = Path::new(request["root"].as_str().ok_or("root is required")?);
    let id = safe_id(request["workerId"].as_str()).ok_or("invalid workerId")?;
    let args = &request["args"];
    let text = |key: &str| args[key].as_str();
    let values = || args["values"].as_array().map_or(&[][..], Vec::as_slice);
    let mut data = load(root, id);
    let result = match request["op"].as_str().unwrap_or("") {
        "read" => {
            let mut out = read_range(&data, text("range"));
            out["name"] = data["name"].clone();
            out["columns"] = data["columns"].clone();
            out["rowsAvailable"] = data["rows"].clone();
            return Ok(json!({ "result": out }));
        }
        "export" => return Ok(json!({ "result": { "name": data["name"], "csv": sheet_to_csv(&data) } })),
        "write" => write_range(&mut data, text("start").unwrap_or("A1"), values()),
        "append" => append_rows(&mut data, values()),
        "clear" => json!({ "cleared": clear_range(&mut data, text("range")) }),
        "format" => json!({ "changed": apply_format(&mut data, text("range"), &args["patch"]) }),
        "import" => import_delimited(&mut data, text("text").unwrap_or("")),
        "add_sheet" => {
            add_sheet(&mut data, text("name"));
            Value::Null
        }
        "create" => {
            data = blank(text("name").unwrap_or("Sheet1"));
            Value::Null
        }
        other => return Err(format!("unknown sheet op: {other}")),
    };
    let saved = save(root, id, &data)?;
    Ok(json!({ "result": result, "saved": saved }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sheet_ops_match_the_store() {
        let root = std::env::temp_dir().join(format!("ef-sheet-ops-{}", std::process::id()));
        let run = |op: &str, args: Value| {
            super::op(&json!({ "root": root.to_str().unwrap(), "workerId": "w2", "op": op, "args": args })).unwrap()
        };
        run("create", json!({ "name": "Leads" }));
        let wrote = run("write", json!({ "start": "b2", "values": [["a", 1, null], "skip", [true, "x,\"y\""]] }));
        assert_eq!(wrote["result"], json!({ "written": 4, "start": "B2" }));
        assert_eq!(wrote["saved"]["cells"], json!({ "B2": "a", "C2": "1", "B4": "true", "C4": "x,\"y\"" }));
        assert_eq!(run("append", json!({ "values": [["z"]] }))["result"]["start"], "A5");
        let read = run("read", json!({ "range": "C4:B2" }));
        assert_eq!(read["result"]["start"], "B2");
        assert_eq!(read["result"]["rows"], json!([["a", "1"], ["", ""], ["true", "x,\"y\""]]));
        assert_eq!(run("export", json!({}))["result"]["csv"], ",,\n,a,1\n,,\n,true,\"x,\"\"y\"\"\"\nz,,");
        let formatted = run("format", json!({ "range": "B2:C2", "patch": { "b": true, "fs": 99 } }));
        assert_eq!(formatted["result"]["changed"], 2);
        assert_eq!(formatted["saved"]["styles"]["C2"], json!({ "b": true, "fs": 48 }));
        assert_eq!(run("clear", json!({ "range": "B2:C9" }))["result"]["cleared"], 4);
        let imported = run("import", json!({ "text": "a\tb\tc\r\n\"q\"\"t\"\t2\n\n\t\n" }));
        assert_eq!(imported["result"], json!({ "written": 5, "rows": 2, "columns": 12 }));
        assert_eq!(imported["saved"]["cells"], json!({ "A1": "a", "B1": "b", "C1": "c", "A2": "q\"t", "B2": "2" }));
        let added = run("add_sheet", json!({ "name": "  Two  " }));
        assert_eq!(added["saved"]["active"], 1);
        assert_eq!(added["saved"]["sheets"][1]["name"], "Two");
        assert_eq!(added["saved"]["sheets"][0]["cells"]["A2"], "q\"t");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleans_cells_styles_and_sizes_like_node() {
        let out = normalize(&json!({
            "name": "  Budget  ", "columns": "7.9", "rows": 99999, "active": 5,
            "cells": { "A1": "x", "a1": "lower", "B2": 3, "C3": true, "D4": "", "E5": null, "F6": 1.5 },
            "styles": { "A1": { "b": true, "i": 1, "color": "#fff", "bg": "red", "align": "center", "fs": "100", "decimals": null }, "B1": { "b": false } },
            "colWidths": { "0": 10.5, "1": 700, "x": 50, "501": 50, "2": "80" },
            "merges": ["A1:B2", "bad", 3],
        }));
        assert_eq!(out["name"], "Budget");
        assert_eq!(out["columns"], 7);
        assert_eq!(out["rows"], 2000);
        assert_eq!(out["active"], 0);
        assert_eq!(out["cells"], json!({ "A1": "x", "B2": "3", "C3": "true", "F6": "1.5" }));
        assert_eq!(out["styles"], json!({ "A1": { "b": true, "color": "#fff", "align": "center", "fs": 48, "decimals": 0 } }));
        assert_eq!(out["colWidths"], json!({ "0": 24, "1": 600, "2": 80 }));
        assert_eq!(out["merges"], json!(["A1:B2"]));
        assert_eq!(out["sheets"][0]["name"], "Budget");
        assert!(out["sheets"][0]["id"].as_str().unwrap().starts_with("tab-"));
    }

    #[test]
    fn keeps_tabs_and_mirrors_the_active_one() {
        let out = normalize(&json!({
            "sheets": [
                { "id": "t1", "name": "One", "cells": { "A1": "1" } },
                { "id": "bad id!", "cells": { "A1": "2" } },
            ],
            "active": 1,
        }));
        assert_eq!(out["sheets"][0]["id"], "t1");
        assert_eq!(out["sheets"][1]["name"], "Sheet2");
        assert_ne!(out["sheets"][1]["id"], "bad id!");
        assert_eq!(out["cells"], json!({ "A1": "2" }));
    }

    #[test]
    fn save_folds_top_level_edits_into_the_active_tab_and_load_reads_them() {
        let root = std::env::temp_dir().join(format!("ef-sheets-{}", std::process::id()));
        let saved = save(&root, "w1", &json!({
            "sheets": [{ "id": "t1", "cells": { "A1": "old" } }],
            "cells": { "A1": "new", "B1": "2" },
        }))
        .unwrap();
        assert_eq!(saved["sheets"][0]["cells"], json!({ "A1": "new", "B1": "2" }));
        assert_eq!(load(&root, "w1"), saved);
        assert_eq!(load(&root, "missing")["sheets"][0]["name"], "Sheet1");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert_eq!(safe_id(Some("../x")), None);
        assert_eq!(safe_id(Some("w-1")), Some("w-1"));
    }
}

