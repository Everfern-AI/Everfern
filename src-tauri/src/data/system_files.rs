//! Native implementation of the agent's shared-root filesystem organizer tool.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

#[derive(Clone)]
struct Entry {
    path: String,
    kind: &'static str,
    size: Option<u64>,
}

fn absolute_normalized(path: &Path) -> Result<PathBuf, String> {
    let absolute = std::path::absolute(path).map_err(|error| error.to_string())?;
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    Ok(normalized)
}

fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = absolute_normalized(&root.join(relative))?;
    if !candidate.starts_with(root) {
        return Err(format!(
            "Path is outside the shared root folder: {relative}"
        ));
    }
    Ok(candidate)
}

fn list_dir_recursive(root: &Path, max_entries: usize) -> Vec<Entry> {
    fn walk(root: &Path, dir: &Path, max_entries: usize, results: &mut Vec<Entry>) {
        if results.len() >= max_entries {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
        for entry in entries
            .iter()
            .filter(|entry| !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        {
            if results.len() >= max_entries {
                return;
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            let size = std::fs::metadata(&path).ok().map(|metadata| metadata.len());
            results.push(Entry {
                path: relative,
                kind: "file",
                size,
            });
        }
        for entry in entries
            .iter()
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        {
            if results.len() >= max_entries {
                return;
            }
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            results.push(Entry {
                path: relative,
                kind: "dir",
                size: None,
            });
            walk(root, &path, max_entries, results);
        }
    }
    let mut results = Vec::new();
    walk(root, root, max_entries, &mut results);
    results
}

fn extension(path: &str) -> String {
    path.rsplit('.').next().unwrap_or("no-ext").to_lowercase()
}

fn list_result(root: &Path, rel: &str, max_entries: usize) -> Result<Value, String> {
    let dir = resolve_under_root(root, rel)?;
    let metadata = std::fs::metadata(&dir).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("path must be a directory for list".into());
    }

    let entries = list_dir_recursive(&dir, max_entries);
    let dirs = entries
        .iter()
        .filter(|entry| entry.kind == "dir")
        .collect::<Vec<_>>();
    let files = entries
        .iter()
        .filter(|entry| entry.kind == "file")
        .collect::<Vec<_>>();
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    let mut group_index = HashMap::<String, usize>::new();
    for file in &files {
        let ext = extension(&file.path);
        let index = *group_index.entry(ext.clone()).or_insert_with(|| {
            groups.push((ext.clone(), Vec::new()));
            groups.len() - 1
        });
        groups[index].1.push(file.path.clone());
    }
    groups.sort_by(|a, b| b.1.len().cmp(&a.1.len()));

    let mut summary = format!(
        "📂 {} entries ({} folders, {} files) under {}.\n\n",
        entries.len(),
        dirs.len(),
        files.len(),
        if rel == "." { "root" } else { rel }
    );
    summary.push_str("**Files by type:**\n");
    for (ext, paths) in groups {
        if paths.len() <= 8 {
            summary.push_str(&format!(
                "- .{ext} ({}): {}\n",
                paths.len(),
                paths.join(", ")
            ));
        } else {
            summary.push_str(&format!(
                "- .{ext} ({}): {} ... and {} more\n",
                paths.len(),
                paths[..5].join(", "),
                paths.len() - 5
            ));
        }
    }
    if !dirs.is_empty() && dirs.len() <= 20 {
        summary.push_str(&format!(
            "\n**Folders:** {}\n",
            dirs.iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    } else if dirs.len() > 20 {
        summary.push_str(&format!(
            "\n**Folders ({}):** {} ... and {} more\n",
            dirs.len(),
            dirs[..10]
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>()
                .join(", "),
            dirs.len() - 10
        ));
    }

    let categories: [(&str, &str, &[&str], &str); 6] = [
        (
            "Font",
            "🔤",
            &["ttf", "otf", "woff", "woff2", "fon"],
            "Fonts",
        ),
        (
            "Image",
            "🖼️",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff",
            ],
            "Images",
        ),
        (
            "Video",
            "🎬",
            &["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv"],
            "Videos",
        ),
        (
            "Audio",
            "🎵",
            &["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a"],
            "Audio",
        ),
        (
            "Archive",
            "📦",
            &["zip", "rar", "7z", "tar", "gz", "bz2"],
            "Archives",
        ),
        (
            "Document",
            "📝",
            &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
            "Documents",
        ),
    ];
    for (name, icon, extensions, folder) in categories {
        let matches = files
            .iter()
            .filter(|file| extensions.contains(&extension(&file.path).as_str()))
            .collect::<Vec<_>>();
        if matches.is_empty() {
            continue;
        }
        let paths = if matches.len() <= 15 {
            matches
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>()
        } else {
            matches[..10]
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>()
        };
        let suffix = if matches.len() > 15 {
            format!(" ... and {} more", matches.len() - 10)
        } else {
            String::new()
        };
        summary.push_str(&format!(
            "\n{icon} **{name} files ({}):** {}{suffix}\n",
            matches.len(),
            paths.join(", ")
        ));
        summary.push_str(&format!(
            "→ Organize into \"{folder}\" folder with mkdirp + move.\n"
        ));
    }

    let values = entries
        .iter()
        .map(|entry| {
            let mut value = json!({"path": entry.path, "type": entry.kind});
            if let Some(size) = entry.size {
                value["size"] = json!(size);
            }
            value
        })
        .collect::<Vec<_>>();
    Ok(
        json!({"success": true, "output": summary.trim(), "data": {"root": root, "path": rel, "entries": values}}),
    )
}

fn execute_inner(request: &Value) -> Result<Value, String> {
    let action = request["action"].as_str().unwrap_or_default();
    let root_text = request["root"].as_str().unwrap_or_default().trim();
    if root_text.is_empty() {
        return Err("root is required".into());
    }
    let root = absolute_normalized(Path::new(root_text))?;
    let root_stat = std::fs::metadata(&root).map_err(|error| error.to_string())?;
    if !root_stat.is_dir() {
        return Err("root must be a directory".into());
    }

    match action {
        "list" => {
            let rel = request["path"]
                .as_str()
                .filter(|path| !path.trim().is_empty())
                .map(str::trim)
                .unwrap_or(".");
            let max_entries = request["maxEntries"]
                .as_f64()
                .filter(|value| value.is_finite())
                .map(|value| value.floor().max(1.0).min(usize::MAX as f64) as usize)
                .unwrap_or(500);
            list_result(&root, rel, max_entries)
        }
        "mkdirp" => {
            let rel = request["path"].as_str().unwrap_or_default().trim();
            if rel.is_empty() {
                return Err("path is required for mkdirp".into());
            }
            let target = resolve_under_root(&root, rel)?;
            std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
            Ok(
                json!({"success": true, "output": format!("Created directory: {rel}"), "data": {"root": root, "path": rel}}),
            )
        }
        "move" | "rename" => {
            let from = request["from"]
                .as_str()
                .or_else(|| request["path"].as_str())
                .unwrap_or_default()
                .trim();
            let to = request["to"].as_str().unwrap_or_default().trim();
            if from.is_empty() {
                return Err(format!("from (or path) is required for {action}"));
            }
            if to.is_empty() {
                return Err(format!("to is required for {action}"));
            }
            let source = resolve_under_root(&root, from)?;
            let destination = resolve_under_root(&root, to)?;
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::rename(source, destination).map_err(|error| error.to_string())?;
            Ok(
                json!({"success": true, "output": format!("Moved {from} → {to}"), "data": {"root": root, "from": from, "to": to}}),
            )
        }
        "delete" => {
            let rel = request["path"].as_str().unwrap_or_default().trim();
            if rel.is_empty() {
                return Err("path is required for delete".into());
            }
            let target = resolve_under_root(&root, rel)?;
            let recursive = request["recursive"] == true;
            let metadata = std::fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() || metadata.is_file() {
                std::fs::remove_file(target).map_err(|error| error.to_string())?;
            } else if recursive {
                std::fs::remove_dir_all(target).map_err(|error| error.to_string())?;
            } else {
                std::fs::remove_dir(target).map_err(|error| error.to_string())?;
            }
            Ok(
                json!({"success": true, "output": format!("Deleted {rel}"), "data": {"root": root, "path": rel, "recursive": recursive}}),
            )
        }
        _ => Ok(
            json!({"success": false, "output": format!("Unsupported action: {action}"), "error": "unsupported_action"}),
        ),
    }
}

pub fn execute(request: &Value) -> Value {
    match execute_inner(request) {
        Ok(result) => result,
        Err(message) => {
            json!({"success": false, "output": format!("system_files error: {message}"), "error": message})
        }
    }
}
