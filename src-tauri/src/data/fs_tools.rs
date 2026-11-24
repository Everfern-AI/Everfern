//! The coding agent's `read`, `ls` and `find` tools (`--ef-fs-tool`), ported from
//! `@mariozechner/pi-coding-agent`. Node resolves the path and keeps the package's
//! version as the fallback: a `null` reply means "run the Node tool", used for every
//! case this port does not reproduce exactly (images, unreadable files, odd arguments).
//!
//! Replies are the package's own tool result shape, `{ content, details }`, or
//! `{ error }` for the errors the package throws.

use std::fs;
use std::path::{Path, PathBuf};

use globset::GlobBuilder;
use ignore::WalkBuilder;
use serde_json::{json, Map, Value};

const DEFAULT_MAX_LINES: usize = 2000;
const DEFAULT_MAX_BYTES: usize = 50 * 1024;
const MAX_SAFE_INTEGER: usize = 9_007_199_254_740_991;
const FIND_DEFAULT_LIMIT: f64 = 1000.0;

pub fn execute(request: &Value) -> Option<Value> {
    match request.get("tool")?.as_str()? {
        "read" => read(request),
        "ls" => ls(request),
        "find" => find(request),
        _ => None,
    }
}

fn text_result(text: String, details: Option<Value>) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "details": details })
}

fn error(message: String) -> Value {
    json!({ "error": message })
}

/// `formatSize` from the package's truncate.js (`toFixed(1)` rounds ties up).
fn format_size(bytes: usize) -> String {
    let tenths = |unit: usize| (bytes * 20 + unit) / (unit * 2);
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        let n = tenths(1024);
        format!("{}.{}KB", n / 10, n % 10)
    } else {
        let n = tenths(1024 * 1024);
        format!("{}.{}MB", n / 10, n % 10)
    }
}

struct Truncation {
    content: String,
    truncated: bool,
    truncated_by: Option<&'static str>,
    output_lines: usize,
    first_line_exceeds_limit: bool,
    details: Value,
}

/// `truncateHead`: keep whole lines from the top until a line or byte limit is hit.
fn truncate_head(content: &str, max_lines: usize, max_bytes: usize) -> Truncation {
    let total_bytes = content.len();
    let lines: Vec<&str> = content.split('\n').collect();
    let total_lines = lines.len();
    let build = |content: String, truncated, by: Option<&'static str>, output_lines, first_line_exceeds_limit| {
        let output_bytes = content.len();
        let details = json!({
            "content": content,
            "truncated": truncated,
            "truncatedBy": by,
            "totalLines": total_lines,
            "totalBytes": total_bytes,
            "outputLines": output_lines,
            "outputBytes": output_bytes,
            "lastLinePartial": false,
            "firstLineExceedsLimit": first_line_exceeds_limit,
            "maxLines": max_lines,
            "maxBytes": max_bytes,
        });
        Truncation { content, truncated, truncated_by: by, output_lines, first_line_exceeds_limit, details }
    };
    if total_lines <= max_lines && total_bytes <= max_bytes {
        return build(content.to_string(), false, None, total_lines, false);
    }
    if lines[0].len() > max_bytes {
        return build(String::new(), true, Some("bytes"), 0, true);
    }
    let mut kept = Vec::new();
    let mut bytes = 0;
    let mut by = "lines";
    for (i, line) in lines.iter().enumerate().take(max_lines) {
        let line_bytes = line.len() + usize::from(i > 0);
        if bytes + line_bytes > max_bytes {
            by = "bytes";
            break;
        }
        kept.push(*line);
        bytes += line_bytes;
    }
    if kept.len() >= max_lines && bytes <= max_bytes {
        by = "lines";
    }
    let count = kept.len();
    build(kept.join("\n"), true, Some(by), count, false)
}

/// A JavaScript number argument that this port takes as is; anything else
/// (strings, fractions, null where it matters) goes to Node.
fn whole_number(value: Option<&Value>) -> Option<Option<f64>> {
    match value {
        None => Some(None),
        Some(Value::Number(n)) => n.as_f64().filter(|f| f.fract() == 0.0).map(Some),
        _ => None,
    }
}

/// Files the package reads as images (file-type sniffing for jpeg, png, gif, webp).
fn looks_like_image(head: &[u8]) -> bool {
    head.starts_with(&[0xFF, 0xD8, 0xFF])
        || head.starts_with(b"\x89PNG\r\n\x1a\n")
        || head.starts_with(b"GIF8")
        || (head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP")
}

fn read(request: &Value) -> Option<Value> {
    let absolute = Path::new(request.get("absolutePath")?.as_str()?);
    let shown_path = request.get("path").map(crate::js::string).unwrap_or_default();
    let offset = match request.get("offset") {
        Some(Value::Null) => None,
        other => whole_number(other)?,
    };
    let limit = whole_number(request.get("limit"))?;
    if limit.is_some_and(|l| l < 0.0) {
        return None;
    }
    let buffer = fs::read(absolute).ok()?;
    if looks_like_image(&buffer) {
        return None;
    }
    let text = String::from_utf8_lossy(&buffer);
    let all_lines: Vec<&str> = text.split('\n').collect();
    let total = all_lines.len();

    // `offset ? Math.max(0, offset - 1) : 0`
    let start = match offset {
        Some(o) if o != 0.0 => (o - 1.0).max(0.0) as usize,
        _ => 0,
    };
    let start_display = start + 1;
    if start >= total {
        let shown = crate::js::number_string(offset.unwrap_or(0.0));
        return Some(error(format!("Offset {shown} is beyond end of file ({total} lines total)")));
    }
    let mut user_limited = None;
    let selected = match limit {
        Some(l) => {
            let end = start.saturating_add(l as usize).min(total);
            user_limited = Some(end - start);
            all_lines[start..end].join("\n")
        }
        None => all_lines[start..].join("\n"),
    };

    let t = truncate_head(&selected, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
    let (text, details) = if t.first_line_exceeds_limit {
        let size = format_size(all_lines[start].len());
        (
            format!(
                "[Line {start_display} is {size}, exceeds {} limit. Use bash: sed -n '{start_display}p' {shown_path} | head -c {DEFAULT_MAX_BYTES}]",
                format_size(DEFAULT_MAX_BYTES)
            ),
            Some(json!({ "truncation": t.details })),
        )
    } else if t.truncated {
        let end_display = start_display + t.output_lines - 1;
        let next = end_display + 1;
        let reason = if t.truncated_by == Some("lines") {
            String::new()
        } else {
            format!(" ({} limit)", format_size(DEFAULT_MAX_BYTES))
        };
        (
            format!("{}\n\n[Showing lines {start_display}-{end_display} of {total}{reason}. Use offset={next} to continue.]", t.content),
            Some(json!({ "truncation": t.details })),
        )
    } else if let Some(n) = user_limited.filter(|n| start + n < total) {
        let remaining = total - (start + n);
        (format!("{}\n\n[{remaining} more lines in file. Use offset={} to continue.]", t.content, start + n + 1), None)
    } else {
        (t.content, None)
    };
    Some(text_result(text, details))
}

/// What the package's `ls` asks of the file system, in one go. Node feeds this to
/// the package's own `ls` through its `operations` option, so its sorting (which
/// is `localeCompare`) and output stay exactly the same.
fn ls(request: &Value) -> Option<Value> {
    let dir = Path::new(request.get("dirPath")?.as_str()?);
    let Ok(meta) = fs::metadata(dir) else {
        return Some(json!({ "exists": dir.exists(), "isDir": false, "entries": [] }));
    };
    if !meta.is_dir() {
        return Some(json!({ "exists": true, "isDir": false, "entries": [] }));
    }
    // Node words read errors itself (`Cannot read directory: EACCES ...`).
    let entries = fs::read_dir(dir).ok()?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.ok()?;
        let name = entry.file_name().into_string().ok()?;
        // `statSync` follows links; an entry it cannot stat is skipped.
        let is_dir = fs::metadata(entry.path()).ok().map(|m| m.is_dir());
        out.push(json!({ "name": name, "dir": is_dir }));
    }
    Some(json!({ "exists": true, "isDir": true, "entries": out }))
}

/// fd's global ignore file (`<config dir>/fd/ignore`).
fn fd_global_ignore() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }?;
    Some(base.join("fd").join("ignore")).filter(|p| p.is_file())
}

/// The `.gitignore` files the package hands fd: the root one, then every nested one
/// outside `node_modules` and `.git` (glob `**` does not enter linked folders).
fn gitignore_files(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name();
            if kind.is_dir() {
                if name != "node_modules" && name != ".git" {
                    stack.push(entry.path());
                }
            } else if name == ".gitignore" && kind.is_file() {
                found.push(entry.path());
            }
        }
    }
    found.sort();
    found
}

fn find(request: &Value) -> Option<Value> {
    let root = Path::new(request.get("searchPath")?.as_str()?);
    let pattern = request.get("pattern")?.as_str()?;
    let limit = match whole_number(request.get("limit"))? {
        None => FIND_DEFAULT_LIMIT,
        Some(l) if l >= 1.0 => l,
        Some(_) => return None,
    } as usize;
    // fd reports a missing or non-folder path itself.
    if !root.is_dir() {
        return None;
    }

    // fd matches the file name. A pattern with `/` would match nothing there (fd
    // only checks `\` on Windows), so it is matched against the relative path.
    let full_path = pattern.contains('/');
    let matcher = GlobBuilder::new(pattern)
        .literal_separator(full_path)
        .case_insensitive(!pattern.chars().any(char::is_uppercase))
        .build()
        .ok()?
        .compile_matcher();

    let mut walk = WalkBuilder::new(root);
    walk.hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(true)
        .follow_links(false)
        .add_custom_ignore_filename(".fdignore")
        .sort_by_file_name(|a, b| a.cmp(b));
    if let Some(global) = fd_global_ignore() {
        let _ = walk.add_ignore(global);
    }
    for file in gitignore_files(root) {
        let _ = walk.add_ignore(file);
    }

    let mut results = Vec::new();
    for entry in walk.build() {
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else { continue };
        let relative: Vec<String> =
            relative.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        let relative = relative.join("/");
        let subject = if full_path { relative.as_str() } else { relative.rsplit('/').next().unwrap_or("") };
        if !matcher.is_match(subject) {
            continue;
        }
        let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
        results.push(if is_dir { format!("{relative}/") } else { relative });
        if results.len() >= limit {
            break;
        }
    }

    if results.is_empty() {
        return Some(text_result("No files found matching pattern".into(), None));
    }
    let t = truncate_head(&results.join("\n"), MAX_SAFE_INTEGER, DEFAULT_MAX_BYTES);
    let mut text = t.content.clone();
    let mut details = Map::new();
    let mut notices = Vec::new();
    if results.len() >= limit {
        notices.push(format!("{limit} results limit reached. Use limit={} for more, or refine pattern", limit * 2));
        details.insert("resultLimitReached".into(), json!(limit));
    }
    if t.truncated {
        notices.push(format!("{} limit reached", format_size(DEFAULT_MAX_BYTES)));
        details.insert("truncation".into(), t.details);
    }
    if !notices.is_empty() {
        text.push_str(&format!("\n\n[{}]", notices.join(". ")));
    }
    Some(text_result(text, (!details.is_empty()).then(|| Value::Object(details))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_round_like_to_fixed() {
        assert_eq!(format_size(1000), "1000B");
        assert_eq!(format_size(1280), "1.3KB"); // 1.25 exactly: toFixed rounds up
        assert_eq!(format_size(50 * 1024), "50.0KB");
        assert_eq!(format_size(3 * 1024 * 1024 / 2), "1.5MB");
    }

    #[test]
    fn read_pages_and_truncates() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "one\ntwo\nthree\nfour").unwrap();
        let req = |extra: Value| {
            let mut r = json!({ "tool": "read", "absolutePath": file.to_str().unwrap(), "path": "a.txt" });
            r.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            execute(&r).unwrap()
        };
        assert_eq!(req(json!({}))["content"][0]["text"], "one\ntwo\nthree\nfour");
        assert_eq!(
            req(json!({ "offset": 2, "limit": 1 }))["content"][0]["text"],
            "two\n\n[2 more lines in file. Use offset=3 to continue.]"
        );
        assert_eq!(req(json!({ "offset": 9 }))["error"], "Offset 9 is beyond end of file (4 lines total)");
        assert!(execute(&json!({ "tool": "read", "absolutePath": file.to_str().unwrap(), "limit": "2" })).is_none());
    }

    #[test]
    fn find_uses_name_globs_and_gitignores() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src/deep")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        for f in ["src/a.ts", "src/deep/B.TS", "build/o.ts", "x.log"] {
            fs::write(root.join(f), "").unwrap();
        }
        fs::write(root.join(".gitignore"), "build\n*.log\n").unwrap();
        let run = |pattern: &str| {
            let r = execute(&json!({ "tool": "find", "pattern": pattern, "searchPath": root.to_str().unwrap() })).unwrap();
            r["content"][0]["text"].as_str().unwrap().to_string()
        };
        assert_eq!(run("*.ts"), "src/a.ts\nsrc/deep/B.TS");
        assert_eq!(run("*.TS"), "src/deep/B.TS");
        assert_eq!(run("deep"), "src/deep/");
        assert_eq!(run("src/**/*.ts"), "src/a.ts\nsrc/deep/B.TS");
        assert_eq!(run("*.log"), "No files found matching pattern");
    }
}
