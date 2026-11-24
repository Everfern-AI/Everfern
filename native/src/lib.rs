//! Native helpers for the EverFern Electron main process.
//!
//! Each export mirrors an existing TypeScript function so callers do not
//! change; `main/lib/native.ts` loads this module and falls back to the JS
//! implementation when the binary is missing.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi::{Env, Task};
use napi_derive::napi;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

// ── Snapshot diff (main/agent/tools/navis/diff.ts) ─────────────────────────

/// Above this many DP cells (u32 each) the exact LCS table is skipped and a
/// Myers diff (linear memory) is used instead. 8M cells = 32 MB.
const MAX_LCS_CELLS: usize = 8 * 1024 * 1024;

#[napi(object)]
pub struct SnapshotDiff {
  pub text: String,
  pub added: u32,
  pub removed: u32,
  pub changed: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Gutter {
  Same,
  Del,
  Add,
}

fn split_lines(value: &str) -> Vec<&str> {
  if value.is_empty() {
    Vec::new()
  } else {
    value.split('\n').collect()
  }
}

/// Same greedy walk over the same LCS table as the TypeScript version, so the
/// output is identical for every input that fits in `MAX_LCS_CELLS`.
fn lcs_walk<'a>(a: &[&'a str], b: &[&'a str], out: &mut Vec<(Gutter, &'a str)>) {
  // Intern lines so the inner loop compares integers, not strings.
  let mut ids: HashMap<&str, u32> = HashMap::with_capacity(a.len() + b.len());
  let mut intern = |s: &'a str| {
    let next = ids.len() as u32;
    *ids.entry(s).or_insert(next)
  };
  let ai: Vec<u32> = a.iter().map(|s| intern(s)).collect();
  let bi: Vec<u32> = b.iter().map(|s| intern(s)).collect();

  let (n, m) = (ai.len(), bi.len());
  let w = m + 1;
  let mut table = vec![0u32; (n + 1) * w];
  for i in (0..n).rev() {
    for j in (0..m).rev() {
      table[i * w + j] = if ai[i] == bi[j] {
        table[(i + 1) * w + j + 1] + 1
      } else {
        table[(i + 1) * w + j].max(table[i * w + j + 1])
      };
    }
  }

  let (mut i, mut j) = (0, 0);
  while i < n && j < m {
    if ai[i] == bi[j] {
      out.push((Gutter::Same, a[i]));
      i += 1;
      j += 1;
    } else if table[(i + 1) * w + j] >= table[i * w + j + 1] {
      out.push((Gutter::Del, a[i]));
      i += 1;
    } else {
      out.push((Gutter::Add, b[j]));
      j += 1;
    }
  }
  out.extend(a[i..].iter().map(|s| (Gutter::Del, *s)));
  out.extend(b[j..].iter().map(|s| (Gutter::Add, *s)));
}

fn myers_walk<'a>(a: &[&'a str], b: &[&'a str], out: &mut Vec<(Gutter, &'a str)>) {
  use similar::{capture_diff_slices, Algorithm, DiffOp};
  for op in capture_diff_slices(Algorithm::Myers, a, b) {
    match op {
      DiffOp::Equal { old_index, len, .. } => {
        out.extend(a[old_index..old_index + len].iter().map(|s| (Gutter::Same, *s)))
      }
      DiffOp::Delete { old_index, old_len, .. } => {
        out.extend(a[old_index..old_index + old_len].iter().map(|s| (Gutter::Del, *s)))
      }
      DiffOp::Insert { new_index, new_len, .. } => {
        out.extend(b[new_index..new_index + new_len].iter().map(|s| (Gutter::Add, *s)))
      }
      DiffOp::Replace { old_index, old_len, new_index, new_len } => {
        out.extend(a[old_index..old_index + old_len].iter().map(|s| (Gutter::Del, *s)));
        out.extend(b[new_index..new_index + new_len].iter().map(|s| (Gutter::Add, *s)));
      }
    }
  }
}

fn diff_lines<'a>(before: &'a str, after: &'a str) -> Vec<(Gutter, &'a str)> {
  let a = split_lines(before);
  let b = split_lines(after);
  let mut out = Vec::with_capacity(a.len().max(b.len()) + 8);

  // A shared prefix is matched by the greedy walk anyway: trimming it is exact.
  let prefix = a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count();
  out.extend(a[..prefix].iter().map(|s| (Gutter::Same, *s)));
  let (a, b) = (&a[prefix..], &b[prefix..]);

  if (a.len() + 1).saturating_mul(b.len() + 1) <= MAX_LCS_CELLS {
    lcs_walk(a, b, &mut out);
    return out;
  }

  // Too large for an exact table: trim the shared suffix, then use Myers.
  let suffix = a
    .iter()
    .rev()
    .zip(b.iter().rev())
    .take_while(|(x, y)| x == y)
    .count();
  let (am, bm) = (&a[..a.len() - suffix], &b[..b.len() - suffix]);
  if (am.len() + 1).saturating_mul(bm.len() + 1) <= MAX_LCS_CELLS {
    lcs_walk(am, bm, &mut out);
  } else {
    myers_walk(am, bm, &mut out);
  }
  out.extend(a[a.len() - suffix..].iter().map(|s| (Gutter::Same, *s)));
  out
}

/// JavaScript's `\s` class.
fn js_is_space(c: char) -> bool {
  matches!(
    c,
    '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}'
      | '\u{2000}'..='\u{200A}'
      | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
  )
}

/// `text.replace(/^(\s*)- /, '$1')`
fn strip_bullet(text: &str, out: &mut String) {
  let ws_end = text
    .char_indices()
    .find(|(_, c)| !js_is_space(*c))
    .map(|(i, _)| i)
    .unwrap_or(text.len());
  if text[ws_end..].starts_with("- ") {
    out.push_str(&text[..ws_end]);
    out.push_str(&text[ws_end + 2..]);
  } else {
    out.push_str(text);
  }
}

fn collapse(tagged: &[(Gutter, &str)], radius: usize) -> String {
  let len = tagged.len();
  let mut keep = vec![false; len];
  for (i, (g, _)) in tagged.iter().enumerate() {
    if *g == Gutter::Same {
      continue;
    }
    let lo = i.saturating_sub(radius);
    let hi = (i + radius).min(len - 1);
    keep[lo..=hi].iter_mut().for_each(|k| *k = true);
  }

  // Mirrors the JS: push pieces, then join with newlines.
  let mut out = String::new();
  let mut first_piece = true;
  let mut push = |out: &mut String| {
    if !first_piece {
      out.push('\n');
    }
    first_piece = false;
  };
  let mut prev: Option<usize> = None;
  for i in 0..len {
    if !keep[i] {
      continue;
    }
    let gap = match prev {
      None => i > 0,
      Some(p) => i - p > 1,
    };
    if gap {
      push(&mut out);
      out.push('…');
    }
    let (g, text) = tagged[i];
    push(&mut out);
    out.push(match g {
      Gutter::Same => ' ',
      Gutter::Del => '-',
      Gutter::Add => '+',
    });
    out.push(' ');
    strip_bullet(text, &mut out);
    prev = Some(i);
  }
  if matches!(prev, Some(p) if p < len - 1) {
    push(&mut out);
    out.push('…');
  }
  out
}

/// Line-level diff between two rendered page snapshots. Same contract as
/// `diffSnapshots` in navis/diff.ts.
#[napi]
pub fn diff_snapshots(before: String, after: String, context_radius: Option<u32>) -> SnapshotDiff {
  if before == after {
    return SnapshotDiff { text: String::new(), added: 0, removed: 0, changed: false };
  }
  let tagged = diff_lines(&before, &after);
  let added = tagged.iter().filter(|(g, _)| *g == Gutter::Add).count() as u32;
  let removed = tagged.iter().filter(|(g, _)| *g == Gutter::Del).count() as u32;
  let body = collapse(&tagged, context_radius.unwrap_or(3) as usize);
  SnapshotDiff {
    text: format!("{body}\n{added} added, {removed} removed"),
    added,
    removed,
    changed: true,
  }
}

// ── Project file listing (main/ipc/projects.ts `projects:listFiles`) ───────

/// Symlink loops would otherwise recurse forever.
const MAX_DEPTH: usize = 64;

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<String>) {
  let Ok(entries) = fs::read_dir(dir) else { return };
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    let rel_path = if rel.is_empty() {
      name.clone()
    } else {
      let mut s = String::with_capacity(rel.len() + 1 + name.len());
      s.push_str(rel);
      s.push(MAIN_SEPARATOR);
      s.push_str(&name);
      s
    };
    // `DirEntry::file_type` is free on Windows (comes from FindNextFile);
    // only symlinks need a real stat, to follow them like `fs.statSync`.
    let is_dir = match entry.file_type() {
      Ok(ft) if ft.is_symlink() => match fs::metadata(entry.path()) {
        Ok(m) => m.is_dir(),
        Err(_) => continue,
      },
      Ok(ft) => ft.is_dir(),
      Err(_) => continue,
    };
    if is_dir {
      if !name.starts_with('.') && name != "node_modules" && depth < MAX_DEPTH {
        walk(&entry.path(), &rel_path, depth + 1, out);
      }
    } else {
      out.push(rel_path);
    }
  }
}

pub struct ListFilesTask {
  root: PathBuf,
}

impl Task for ListFilesTask {
  type Output = Vec<String>;
  type JsValue = Vec<String>;

  fn compute(&mut self) -> Result<Self::Output> {
    let mut files = Vec::new();
    walk(&self.root, "", 0, &mut files);
    // Match JS `Array.prototype.sort()` (UTF-16 code unit order).
    files.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(files)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

/// Recursively list files under `root` (relative paths, sorted), skipping
/// dot-directories and node_modules. Runs on the libuv thread pool so the
/// Electron main thread never blocks on a large tree.
#[napi(ts_return_type = "Promise<string[]>")]
pub fn list_project_files(root: String) -> AsyncTask<ListFilesTask> {
  AsyncTask::new(ListFilesTask { root: PathBuf::from(root) })
}
