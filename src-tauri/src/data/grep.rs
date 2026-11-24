//! The agent's `grep` tool, ported from `executeHostGrep` in `main/agent/tools/pi-tools.ts`.
//!
//! Node resolves the arguments (pattern, path, limits) and calls `--ef-grep`; this
//! walks the tree and builds the same output text and `data`. A pattern this regex
//! engine cannot express the way JavaScript does (lookaround, backreferences, a JS
//! only escape) returns `None`, and Node runs its own grep instead.
//!
//! One difference: the JS walker does not await its file reads, so it can report
//! before every file is searched. This one searches each file before moving on.

use regex::{Regex, RegexBuilder};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

const SKIP_DIRS: [&str; 13] = [
    ".git", ".hg", ".svn", ".next", ".turbo", ".cache", "node_modules", "dist", "dist-electron", "out", "build",
    "coverage", "release",
];
const BINARY_EXTS: [&str; 29] = [
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "mp4", "mov", "avi", "mkv", "webm", "mp3", "wav",
    "flac", "zip", "rar", "7z", "gz", "tar", "exe", "dll", "pdb", "woff", "woff2", "ttf", "otf", "pdf",
];
const MAX_SKIPPED: usize = 25;

static ANSI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1B(?:[@-Z\x5C-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)").unwrap());

/// Rewrites JavaScript's ASCII-only `\d \w \b` (and their negations) so this
/// Unicode-aware engine matches the same characters. `None` for escapes whose
/// meaning differs and have no simple rewrite (`\b` or a negated class inside `[...]`).
fn translate(pattern: &str) -> Option<String> {
    let mut out = String::with_capacity(pattern.len() + 16);
    let mut chars = pattern.chars();
    let mut in_class = false;
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                let Some(next) = chars.next() else {
                    out.push('\\');
                    break;
                };
                let rewrite = match (next, in_class) {
                    ('d', false) => "[0-9]",
                    ('D', false) => "[^0-9]",
                    ('w', false) => "[0-9A-Za-z_]",
                    ('W', false) => "[^0-9A-Za-z_]",
                    ('b', false) => r"(?-u:\b)",
                    ('B', false) => r"(?-u:\B)",
                    ('d', true) => "0-9",
                    ('w', true) => "0-9A-Za-z_",
                    ('D' | 'W' | 'b', true) => return None,
                    _ => {
                        out.push('\\');
                        out.push(next);
                        continue;
                    }
                };
                out.push_str(rewrite);
            }
            '[' if !in_class => {
                in_class = true;
                out.push('[');
                // A leading `]` or `^]` is literal in this engine but closes an empty class in JS.
                let rest = chars.as_str();
                if rest.starts_with(']') || rest.starts_with("^]") {
                    return None;
                }
            }
            // A nested `[` is literal in JS but opens a nested class here.
            '[' => out.push_str(r"\["),
            ']' if in_class => {
                in_class = false;
                out.push(']');
            }
            _ => out.push(ch),
        }
    }
    Some(out)
}

/// `None` when a regex was asked for, is valid JavaScript, but cannot be run here.
fn build_matcher(pattern: &str, case_sensitive: bool, regex_requested: bool) -> Option<Regex> {
    let build = |source: &str| RegexBuilder::new(source).case_insensitive(!case_sensitive).build();
    if regex_requested {
        match translate(pattern).map(|source| build(&source)) {
            Some(Ok(matcher)) => return Some(matcher),
            // Could be valid JS this engine rejects; let Node decide.
            _ => return None,
        }
    }
    build(&regex::escape(pattern)).ok()
}

struct Search<'a> {
    root: &'a Path,
    matcher: Regex,
    max_results: usize,
    max_file_bytes: u64,
    matches: Vec<Value>,
    skipped: Vec<String>,
    files_searched: u64,
    limit_reached: bool,
}

impl Search<'_> {
    fn skip(&mut self, path: &Path, reason: &str) {
        if self.skipped.len() < MAX_SKIPPED {
            self.skipped.push(format!("{} ({reason})", path.display()));
        }
    }

    fn search_file(&mut self, file: &Path) {
        let ext = file.extension().map(|e| e.to_string_lossy().to_lowercase());
        if ext.is_some_and(|ext| BINARY_EXTS.contains(&ext.as_str())) {
            return self.skip(file, "binary extension");
        }
        match std::fs::metadata(file) {
            Ok(meta) if !meta.is_file() => return self.skip(file, "not a file"),
            Ok(meta) if meta.len() > self.max_file_bytes => {
                return self.skip(file, &format!("larger than {} bytes", self.max_file_bytes))
            }
            Ok(_) => {}
            Err(error) => return self.skip(file, &error.to_string()),
        }
        let bytes = match std::fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) => return self.skip(file, &error.to_string()),
        };
        let content = String::from_utf8_lossy(&bytes);
        if content.contains('\0') {
            return self.skip(file, "binary content");
        }
        self.files_searched += 1;
        let relative = file
            .strip_prefix(self.root)
            .ok()
            .filter(|rel| !rel.as_os_str().is_empty())
            .map(|rel| rel.display().to_string())
            .unwrap_or_else(|| file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        for (index, line) in content.split('\n').enumerate() {
            let line = line.strip_suffix('\r').unwrap_or(line);
            if !self.matcher.is_match(line) {
                continue;
            }
            self.matches.push(json!({
                "path": file.display().to_string(),
                "relativePath": relative,
                "line": index + 1,
                "text": line.trim_end(),
            }));
            if self.matches.len() >= self.max_results {
                self.limit_reached = true;
                return;
            }
        }
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// `--ef-grep`. The request holds the already-resolved arguments:
/// `{pattern, searchPath, timeoutMs, maxResults, maxFileBytes, caseSensitive, regex}`.
/// Returns a `ToolResult`, or `None` to have Node run its own grep.
pub fn execute(request: &Value) -> Option<Value> {
    let pattern = request["pattern"].as_str()?;
    let search_path = PathBuf::from(request["searchPath"].as_str()?);
    let timeout_ms = request["timeoutMs"].as_u64().unwrap_or(60_000);
    let max_results = request["maxResults"].as_u64().unwrap_or(200).clamp(1, 1000) as usize;
    let max_file_bytes = request["maxFileBytes"].as_u64().unwrap_or(1_500_000);
    let case_sensitive = request["caseSensitive"].as_bool().unwrap_or(false);
    let regex_requested = request["regex"].as_bool().unwrap_or(true);
    let matcher = build_matcher(pattern, case_sensitive, regex_requested)?;

    let started = Instant::now();
    let deadline = started + Duration::from_millis(timeout_ms);
    let display = search_path.display().to_string();

    let root_meta = match std::fs::metadata(&search_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(json!({
                "success": false,
                "output": format!("Error: grep path does not exist\nPath: {display}"),
                "error": "path_not_found",
            }))
        }
        Err(error) => {
            return Some(json!({
                "success": false,
                "output": format!("Error: cannot access grep path\nPath: {display}\n{error}"),
                "error": "path_access_failed",
            }))
        }
    };

    let mut search = Search {
        root: &search_path,
        matcher,
        max_results,
        max_file_bytes,
        matches: Vec::new(),
        skipped: Vec::new(),
        files_searched: 0,
        limit_reached: false,
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if root_meta.is_file() {
        search.search_file(&search_path);
    } else {
        dirs.push(search_path.clone());
    }

    let mut dirs_scanned = 0u64;
    let mut timed_out = false;
    'walk: while !search.limit_reached {
        let Some(dir) = dirs.pop() else { break };
        if Instant::now() > deadline {
            timed_out = true;
            break;
        }
        dirs_scanned += 1;
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) => {
                search.skip(&dir, &error.to_string());
                continue;
            }
        };
        for entry in entries.flatten() {
            if Instant::now() > deadline {
                timed_out = true;
                break 'walk;
            }
            if search.limit_reached {
                break;
            }
            let full = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                search.skip(&full, "symbolic link");
            } else if kind.is_dir() {
                if SKIP_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()) {
                    search.skip(&full, "ignored directory");
                } else {
                    dirs.push(full);
                }
            } else if kind.is_file() {
                search.search_file(&full);
            }
        }
    }

    let Search { matches, skipped, files_searched, limit_reached, .. } = search;
    let elapsed = started.elapsed().as_millis();
    let mut lines = vec![
        if matches.is_empty() {
            "No results: grep found 0 matches.".to_owned()
        } else {
            format!("Found {}.", plural(matches.len(), "match", "matches"))
        },
        format!("Pattern: {pattern}"),
        format!("Path: {display}"),
        format!("Files searched: {files_searched}"),
        format!("Directories scanned: {dirs_scanned}"),
        format!("Elapsed: {elapsed}ms"),
    ];
    if timed_out {
        lines.push(format!("Timed out after {timeout_ms}ms; results may be partial."));
    }
    if limit_reached {
        lines.push(format!("Result limit reached ({max_results}); narrow the search or raise maxResults."));
    }
    if !skipped.is_empty() {
        lines.push(format!("Skipped {}:", plural(skipped.len(), "unreadable/ignored entry", "unreadable/ignored entries")));
        lines.extend(skipped.iter().map(|item| format!("- {item}")));
    }
    if !matches.is_empty() {
        lines.push(String::new());
        lines.extend(matches.iter().map(|m| {
            format!("{}:{}: {}", m["relativePath"].as_str().unwrap_or(""), m["line"], m["text"].as_str().unwrap_or(""))
        }));
    }

    Some(json!({
        "success": true,
        "output": ANSI.replace_all(&lines.join("\n"), "").into_owned(),
        "data": {
            "path": display,
            "pattern": pattern,
            "matches": matches,
            "filesSearched": files_searched,
            "dirsScanned": dirs_scanned,
            "skipped": skipped,
            "timedOut": timed_out,
            "limitReached": limit_reached,
            "timeoutMs": timeout_ms,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_javascript_ascii_classes() {
        assert_eq!(translate(r"\d+\w").unwrap(), "[0-9]+[0-9A-Za-z_]");
        assert_eq!(translate(r"[\d.]\b").unwrap(), r"[0-9.](?-u:\b)");
        assert_eq!(translate(r"a\.b").unwrap(), r"a\.b");
        assert_eq!(translate(r"[\W]"), None);
        assert_eq!(translate(r"[]a]"), None);
        assert!(build_matcher(r"(?=x)", false, true).is_none(), "lookahead goes back to Node");
        assert!(build_matcher(r"(?=x)", false, false).unwrap().is_match("a(?=x)"), "literal search");
        assert!(!build_matcher(r"\d", true, true).unwrap().is_match("\u{0663}"), "Arabic digit is not \\d in JS");
        assert!(build_matcher("HELLO", false, true).unwrap().is_match("hello"));
    }

    #[test]
    fn walks_skips_and_reports_like_node() {
        let root = std::env::temp_dir().join(format!("ef-grep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("src").join("a.ts"), "const x = 1;\r\nTODO: fix   \nnothing\n").unwrap();
        std::fs::write(root.join("b.txt"), "todo later").unwrap();
        std::fs::write(root.join("logo.png"), "TODO").unwrap();
        std::fs::write(root.join("bin.dat"), "TODO\0").unwrap();
        std::fs::write(root.join("node_modules").join("c.js"), "TODO").unwrap();

        let request = |extra: Value| {
            let mut r = json!({ "pattern": "todo", "searchPath": root.to_str().unwrap() });
            for (k, v) in extra.as_object().unwrap() {
                r[k] = v.clone();
            }
            execute(&r).unwrap()
        };
        let result = request(json!({}));
        let data = &result["data"];
        assert_eq!(result["success"], true);
        assert_eq!(data["matches"].as_array().unwrap().len(), 2);
        assert_eq!(data["filesSearched"], 2);
        assert_eq!(data["dirsScanned"], 2);
        assert_eq!(data["skipped"].as_array().unwrap().len(), 3);
        let output = result["output"].as_str().unwrap();
        assert!(output.starts_with("Found 2 matches.\nPattern: todo\n"));
        let a_line = format!("{}:2: TODO: fix", Path::new("src").join("a.ts").display());
        assert!(output.contains(&a_line), "{output}");
        assert!(output.contains("b.txt:1: todo later"));
        assert!(output.contains("Skipped 3 unreadable/ignored entries:"));

        let limited = request(json!({ "caseSensitive": true, "pattern": "TODO", "maxResults": 1 }));
        assert_eq!(limited["data"]["limitReached"], true);
        assert!(limited["output"].as_str().unwrap().starts_with("Found 1 match.\n"));

        let file = execute(&json!({ "pattern": "x =", "searchPath": root.join("src").join("a.ts").to_str().unwrap() })).unwrap();
        assert_eq!(file["data"]["matches"][0]["relativePath"], "a.ts");

        let missing = execute(&json!({ "pattern": "x", "searchPath": root.join("nope").to_str().unwrap() })).unwrap();
        assert_eq!(missing["error"], "path_not_found");
        let _ = std::fs::remove_dir_all(root);
    }
}
