//! Ports of main/store/{plans,sites,artifacts}.ts and the file reads in
//! main/ipc/projects.ts. Return shapes match the Electron IPC handlers.

use super::guard::{resolve_within, safe_segment};
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub fn import_attachment(source: &Path, directory: &Path) -> Result<Value, String> {
    use std::io::Read;
    let import = || -> std::io::Result<Value> {
        let name = source
            .file_name()
            .ok_or_else(|| std::io::Error::other("Missing attachment name"))?;
        let name = name.to_string_lossy();
        let mut input = std::fs::File::open(source)?;
        std::fs::create_dir_all(directory)?;
        let timestamp = chrono::Utc::now().timestamp_millis();
        let target = directory.join(format!("{timestamp}-{name}"));
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let copied = std::io::copy(&mut input, &mut output);
        drop(output);
        let size = match copied {
            Ok(size) => size,
            Err(error) => {
                let _ = std::fs::remove_file(&target);
                return Err(error);
            }
        };
        let mime = match ext_lower(source).as_str() {
            ".jpg" | ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            _ => "text/plain",
        };
        let mut response =
            json!({"success": true, "path": target, "name": name, "size": size, "mimeType": mime});
        if mime == "text/plain" {
            let limit = 256 * 1024;
            let mut bytes = Vec::new();
            std::fs::File::open(&target)?
                .take(limit)
                .read_to_end(&mut bytes)?;
            let mut content = String::from_utf8_lossy(&bytes).into_owned();
            if size > limit {
                content.push_str("\n\n... [File preview truncated for memory safety. Full file accessible at path]");
            }
            response["content"] = json!(content);
        } else if size <= 10 * 1024 * 1024 {
            let encoded = base64::engine::general_purpose::STANDARD.encode(std::fs::read(&target)?);
            response["base64"] = json!(format!("data:{mime};base64,{encoded}"));
        }
        if size <= 1024 * 1024 * 1024 {
            std::thread::spawn(move || {
                ensure_attachment_in_vm(target.to_str());
            });
        }
        Ok(response)
    };
    import().map_err(|error| error.to_string())
}
pub fn read_image_data_url(file: Option<&str>) -> Value {
    use std::io::Read;
    const LIMIT: u64 = 32 * 1024 * 1024;
    let failure = |error: &str| json!({"success": false, "error": error});
    let Some(file) = file.filter(|file| !file.is_empty()) else {
        return failure("No image path provided");
    };
    let path = match std::path::absolute(file) {
        Ok(path) => path,
        Err(error) => return failure(&error.to_string()),
    };
    let mime = match ext_lower(&path).as_str() {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".avif" => "image/avif",
        ".ico" => "image/x-icon",
        ".svg" => "image/svg+xml",
        ".tif" | ".tiff" => "image/tiff",
        ".pdf" => "application/pdf",
        _ => return failure("Unsupported image file type"),
    };
    let metadata = match path.metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return failure("File not found")
        }
        Err(error) => return failure(&error.to_string()),
    };
    let too_large = |size| json!({"success": false, "error": "Image is too large to preview inline", "size": size});
    if !metadata.is_file() {
        return failure("Path is not a file");
    }
    if metadata.len() > LIMIT {
        return too_large(metadata.len());
    }
    let mut bytes = Vec::new();
    if let Err(error) =
        std::fs::File::open(&path).and_then(|file| file.take(LIMIT + 1).read_to_end(&mut bytes))
    {
        return failure(&error.to_string());
    }
    let size = bytes.len() as u64;
    if size > LIMIT {
        return too_large(size);
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    json!({
        "success": true, "path": path.to_string_lossy(), "mimeType": mime,
        "size": size, "dataUrl": format!("data:{mime};base64,{encoded}"),
    })
}

pub fn ensure_attachment_in_vm(file: Option<&str>) -> Value {
    #[cfg(not(windows))]
    {
        let _ = file;
        json!({"success": true})
    }
    #[cfg(windows)]
    {
        use std::io::ErrorKind;
        use std::sync::Mutex;
        static COPY_LOCK: Mutex<()> = Mutex::new(());
        let Some(source) = file.filter(|path| !path.is_empty()).map(Path::new) else {
            return json!({"success": false, "error": "File not found"});
        };
        let copy = || -> std::io::Result<()> {
            let _guard = COPY_LOCK
                .lock()
                .map_err(|_| std::io::Error::other("Attachment copy lock failed"))?;
            let metadata = source.metadata()?;
            if !metadata.is_file() {
                return Err(std::io::Error::new(
                    ErrorKind::InvalidInput,
                    "Attachment is not a file",
                ));
            }
            let name = source.file_name().ok_or(std::io::Error::new(
                ErrorKind::InvalidInput,
                "Missing attachment name",
            ))?;
            let directory = Path::new(r"\\wsl.localhost\EverFern-Alpine\everfern");
            let target = directory.join(name);
            if target.try_exists()? {
                return Ok(());
            }
            std::fs::create_dir_all(directory)?;
            let mut input = std::fs::File::open(source)?;
            let temporary = directory.join(format!(".attachment-{}.pending", super::db::uuid_v4()));
            let result = (|| {
                let mut output = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)?;
                std::io::copy(&mut input, &mut output)?;
                output.sync_all()?;
                drop(output);
                match std::fs::rename(&temporary, &target) {
                    Ok(()) => Ok(()),
                    Err(_) if target.is_file() => Ok(()),
                    Err(error) => Err(error),
                }
            })();
            let _ = std::fs::remove_file(temporary);
            result
        };
        match copy() {
            Ok(()) => json!({"success": true}),
            Err(error) => json!({"success": false, "error": error.to_string()}),
        }
    }
}

pub fn load_screenshot(root: &Path, file: Option<&str>) -> Value {
    let Some(file) = file else {
        return json!({ "error": "Invalid screenshot path." });
    };
    // The original IPC resolves relative paths from the application's working directory.
    let Ok(path) = std::path::absolute(file) else {
        return json!({ "error": "Invalid screenshot path." });
    };
    let Some(absolute) = path.to_str() else {
        return json!({ "error": "Invalid screenshot path." });
    };
    let Ok(resolved) = resolve_within(root, &[absolute]) else {
        return json!({ "error": "Access denied: path is outside the screenshots directory." });
    };
    if !resolved.is_file() {
        return json!({ "error": "File not found." });
    }
    let bytes = match std::fs::read(resolved) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "error": error.to_string() }),
    };
    let mime = match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("png") => "image/png",
        _ => "image/jpeg",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    json!({ "base64": encoded, "dataUrl": format!("data:{mime};base64,{encoded}") })
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn ext_lower(p: &Path) -> String {
    p.extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn read_text(p: &Path) -> Option<String> {
    std::fs::read(p)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn ok() -> Value {
    json!({ "success": true })
}

fn fail(err: impl ToString) -> Value {
    json!({ "success": false, "error": err.to_string() })
}

fn write_file(dir: &Path, filename: &str, content: &str) -> Result<(), String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(resolve_within(dir, &[filename])?, content).map_err(|e| e.to_string())
}

// ---- plans: ~/.everfern/chat/plan/<chatId>/ ----

pub struct Plans(pub PathBuf);

impl Plans {
    fn dir(&self, chat: Option<&str>) -> Result<PathBuf, String> {
        Ok(self.0.join(safe_segment(chat, "chat id")?))
    }

    pub fn list(&self, chat: Option<&str>) -> Value {
        let Ok(dir) = self.dir(chat) else {
            return json!([]);
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return json!([]);
        };
        let mut out = vec![];
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if std::fs::metadata(e.path())
                .map(|m| m.is_file())
                .unwrap_or(false)
            {
                out.push(Value::String(name));
            }
        }
        Value::Array(out)
    }

    pub fn read(&self, chat: Option<&str>, file: &str) -> Value {
        let Ok(p) = self.dir(chat).and_then(|d| resolve_within(&d, &[file])) else {
            return Value::Null;
        };
        read_text(&p).map(Value::String).unwrap_or(Value::Null)
    }

    pub fn write(&self, chat: Option<&str>, file: &str, content: &str) -> Value {
        match self.dir(chat).and_then(|d| write_file(&d, file, content)) {
            Ok(()) => ok(),
            Err(e) => fail(e),
        }
    }

    pub fn delete(&self, chat: Option<&str>, file: &str) -> Value {
        let r = self
            .dir(chat)
            .and_then(|d| resolve_within(&d, &[file]))
            .and_then(|p| {
                if p.exists() {
                    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
                }
                Ok(())
            });
        json!({ "success": r.is_ok() })
    }
}

// ---- sites: ~/.everfern/sites/<site>/ ----

pub struct Sites(pub PathBuf);

impl Sites {
    pub fn list(&self) -> Value {
        self.list_for_chat(None)
    }

    pub fn list_for_chat(&self, filter: Option<&str>) -> Value {
        let filter = filter.filter(|chat| !chat.is_empty());
        if let Some(chat) = filter {
            if safe_segment(Some(chat), "site name").is_err() {
                return json!([]);
            }
        }
        let mut out: Vec<(f64, Value)> = vec![];
        let Ok(entries) = std::fs::read_dir(&self.0) else {
            return json!([]);
        };
        for dir in entries.flatten() {
            if !std::fs::metadata(dir.path())
                .map(|m| m.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let chat = dir.file_name().to_string_lossy().into_owned();
            if filter.is_some_and(|filter| filter != chat) {
                continue;
            }
            let Ok(directory) = resolve_within(&self.0, &[&chat]) else {
                continue;
            };
            let Ok(files) = std::fs::read_dir(directory) else {
                continue;
            };
            for f in files.flatten() {
                let name = f.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".html") {
                    continue;
                }
                let Ok(path) = resolve_within(&self.0, &[&chat, &name]) else {
                    continue;
                };
                let Ok(meta) = std::fs::metadata(&path) else {
                    continue;
                };
                let ms = mtime_ms(&meta);
                out.push((ms, json!({ "id": name, "chatId": chat, "name": name, "lastEdited": ms, "size": meta.len(), "path": path.to_string_lossy() })));
            }
        }
        out.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Value::Array(out.into_iter().map(|(_, v)| v).collect())
    }

    pub fn read(&self, site: Option<&str>, file: &str) -> Value {
        let Ok(p) =
            safe_segment(site, "site name").and_then(|s| resolve_within(&self.0, &[s, file]))
        else {
            return Value::Null;
        };
        read_text(&p).map(Value::String).unwrap_or(Value::Null)
    }

    pub fn write(&self, site: Option<&str>, file: &str, content: &str) -> Value {
        match safe_segment(site, "site name")
            .and_then(|s| resolve_within(&self.0, &[s]))
            .and_then(|d| write_file(&d, file, content))
        {
            Ok(()) => ok(),
            Err(e) => fail(e),
        }
    }

    /// Removes a whole site folder; only direct children of the sites root.
    pub fn delete(&self, site: Option<&str>) -> Value {
        self.delete_entry(site, None)
    }

    pub fn delete_entry(&self, site: Option<&str>, file: Option<&str>) -> Value {
        let r = (|| -> Result<bool, String> {
            let site = safe_segment(site, "site name")?;
            let directory = resolve_within(&self.0, &[site])?;
            let p = match file.filter(|file| !file.is_empty()) {
                Some(file) => resolve_within(&directory, &[file])?,
                None => directory,
            };
            let Ok(meta) = std::fs::metadata(&p) else {
                return Ok(true);
            };
            if meta.is_dir() {
                let parent = p.parent().ok_or("no parent")?;
                if std::fs::canonicalize(parent).ok() != std::fs::canonicalize(&self.0).ok() {
                    return Ok(false);
                }
                std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(&p).map_err(|e| e.to_string())?;
            }
            Ok(true)
        })();
        json!({ "success": r.unwrap_or(false) })
    }
}

// ---- artifacts: ~/.everfern/artifacts/<chatId>/ and <project>/.everfern/artifacts ----

const ARTIFACT_EXTS: &[&str] = &[
    ".html", ".htm", ".txt", ".md", ".json", ".pdf", ".xlsx", ".xls", ".csv", ".png", ".jpg",
    ".jpeg", ".pptx", ".ppt",
];
const TEXT_EXTS: &[&str] = &[".html", ".htm", ".txt", ".md", ".json", ".csv"];

pub struct Artifacts(pub PathBuf);

fn project_artifacts(project: &str) -> PathBuf {
    Path::new(project).join(".everfern").join("artifacts")
}

/// JS `str.slice(0, 500).trim()`: 500 UTF-16 units, then whitespace trim.
fn snippet(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().take(500).collect();
    String::from_utf16_lossy(&units).trim().to_string()
}

fn scan_dir(dir: &Path, chat: &str, out: &mut Vec<(f64, Value)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let path = dir.join(&name);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || name.starts_with('.') {
            continue;
        }
        let ext = ext_lower(&path);
        if !ARTIFACT_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let snip = if TEXT_EXTS.contains(&ext.as_str()) {
            match read_text(&path) {
                Some(t) => snippet(&t),
                None => continue,
            }
        } else {
            format!("[Binary File] Size: {:.2} KB", meta.len() as f64 / 1024.0)
        };
        let ms = mtime_ms(&meta);
        out.push((ms, json!({ "id": name, "chatId": chat, "name": name, "lastEdited": ms, "snippet": snip, "size": meta.len() })));
    }
}

impl Artifacts {
    pub fn touch(&self, chat: Option<&str>, file: &str, project: Option<&str>) -> Value {
        let result = self.file(chat, file, project).and_then(|path| {
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .map_err(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        "Artifact file not found".to_owned()
                    } else {
                        error.to_string()
                    }
                })?;
            let now = std::time::SystemTime::now();
            file.set_times(
                std::fs::FileTimes::new()
                    .set_accessed(now)
                    .set_modified(now),
            )
            .map_err(|error| error.to_string())
        });
        match result {
            Ok(()) => ok(),
            Err(error) => fail(error),
        }
    }

    fn file(
        &self,
        chat: Option<&str>,
        file: &str,
        project: Option<&str>,
    ) -> Result<PathBuf, String> {
        match project {
            Some(p) if !p.is_empty() && chat == Some("project") => {
                resolve_within(&project_artifacts(p), &[file])
            }
            _ => resolve_within(&self.0, &[safe_segment(chat, "chat id")?, file]),
        }
    }

    pub fn list(&self, chat: Option<&str>, project: Option<&str>) -> Value {
        let mut out = vec![];
        if self.0.exists() {
            let dirs: Vec<String> = match chat.filter(|c| !c.is_empty()) {
                // An unsafe chat id skips the global scan but still scans the project.
                Some(c) => safe_segment(Some(c), "chat id")
                    .map(|c| vec![c.to_string()])
                    .unwrap_or_default(),
                None => std::fs::read_dir(&self.0)
                    .map(|rd| {
                        rd.flatten()
                            .filter(|e| {
                                std::fs::metadata(e.path())
                                    .map(|m| m.is_dir())
                                    .unwrap_or(false)
                            })
                            .map(|e| e.file_name().to_string_lossy().into_owned())
                            .collect()
                    })
                    .unwrap_or_default(),
            };
            for d in dirs {
                scan_dir(&self.0.join(&d), &d, &mut out);
            }
        }
        if let Some(p) = project.filter(|p| !p.is_empty()) {
            scan_dir(&project_artifacts(p), "project", &mut out);
        }
        out.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Value::Array(out.into_iter().map(|(_, v)| v).collect())
    }

    pub fn read(&self, chat: Option<&str>, file: &str, project: Option<&str>) -> Value {
        let Ok(p) = self.file(chat, file, project) else {
            return Value::Null;
        };
        if ext_lower(&p) == ".pdf" {
            return std::fs::read(&p)
                .map(|b| {
                    Value::String(format!(
                        "data:application/pdf;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(b)
                    ))
                })
                .unwrap_or(Value::Null);
        }
        read_text(&p).map(Value::String).unwrap_or(Value::Null)
    }

    pub fn write(
        &self,
        chat: Option<&str>,
        file: &str,
        content: &str,
        project: Option<&str>,
    ) -> Value {
        let dir = match project.filter(|p| !p.is_empty()) {
            Some(p) => resolve_within(&project_artifacts(p), &[]),
            None => safe_segment(chat, "chat id").and_then(|c| resolve_within(&self.0, &[c])),
        };
        match dir.and_then(|dir| {
            let path = resolve_within(&dir, &[file])?;
            crate::store::atomic_write(&path, content.as_bytes())
        }) {
            Ok(()) => ok(),
            Err(e) => fail(e),
        }
    }

    pub fn delete(&self, chat: Option<&str>, file: &str, project: Option<&str>) -> Value {
        let r = self.file(chat, file, project).and_then(|p| {
            if p.exists() {
                std::fs::remove_file(&p).map_err(|e| e.to_string())?;
            }
            Ok(())
        });
        json!({ "success": r.is_ok() })
    }
}

// ---- project files (main/ipc/projects.ts) ----

pub fn list_project_files(project: Option<&str>) -> Value {
    fn walk(dir: &Path, rel: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let name = e.file_name();
            let full = dir.join(&name);
            let rel_path = rel.join(&name);
            let Ok(meta) = std::fs::metadata(&full) else {
                continue;
            };
            if meta.is_dir() {
                let n = name.to_string_lossy();
                if !n.starts_with('.') && n != "node_modules" {
                    walk(&full, &rel_path, out);
                }
            } else {
                out.push(rel_path.to_string_lossy().into_owned());
            }
        }
    }
    let mut files = vec![];
    if let Some(p) = project.filter(|p| !p.is_empty()) {
        walk(Path::new(p), Path::new(""), &mut files);
    }
    files.sort();
    json!({ "files": files })
}

fn project_file(project: &str, file: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(project).map_err(|e| e.to_string())?;
    resolve_within(&root, &[file])
}

pub fn read_project_file(project: Option<&str>, file: Option<&str>) -> Value {
    match (project, file) {
        (Some(p), Some(f)) => project_file(p, f)
            .ok()
            .and_then(|p| read_text(&p))
            .map(Value::String)
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn mime_from_ext(ext: &str) -> &'static str {
    match ext.trim_start_matches('.') {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

pub fn read_project_file_data_url(project: Option<&str>, file: Option<&str>) -> Value {
    const MAX: u64 = 32 * 1024 * 1024;
    let Some(project) = project else {
        return fail("The \"path\" argument must be of type string");
    };
    let root = match std::fs::canonicalize(project) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    let Ok(full) = resolve_within(&root, &[file.unwrap_or("")]) else {
        return fail("Invalid file path");
    };
    let meta = match std::fs::metadata(&full) {
        Ok(m) => m,
        Err(e) => return fail(e),
    };
    if !meta.is_file() {
        return fail("Path is not a file");
    }
    if meta.len() > MAX {
        return json!({ "success": false, "error": "File is too large to preview inline", "size": meta.len() });
    }
    let mime = mime_from_ext(&ext_lower(&full));
    match std::fs::read(&full) {
        Ok(b) => json!({
            "success": true,
            "mimeType": mime,
            "size": meta.len(),
            "dataUrl": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(b)),
        }),
        Err(e) => fail(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_response_preserves_encoding_and_rejects_outside_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("screenshots");
        std::fs::create_dir(&root).unwrap();
        let screenshot = root.join("capture.PNG");
        let outside = temp.path().join("private.png");
        std::fs::write(&screenshot, [1, 2, 3]).unwrap();
        std::fs::write(&outside, [4, 5, 6]).unwrap();
        assert_eq!(
            load_screenshot(&root, screenshot.to_str()),
            json!({"base64": "AQID", "dataUrl": "data:image/png;base64,AQID"})
        );
        assert_eq!(
            load_screenshot(&root, outside.to_str())["error"],
            "Access denied: path is outside the screenshots directory."
        );
        assert_eq!(
            load_screenshot(&root, root.join("missing.png").to_str())["error"],
            "File not found."
        );
    }

    #[test]
    fn plans_round_trip_and_stay_in_their_folder() {
        let dir = tempfile::tempdir().unwrap();
        let plans = Plans(dir.path().to_path_buf());
        assert_eq!(
            plans.write(Some("c1"), "plan.md", "# Plan")["success"],
            true
        );
        assert_eq!(plans.read(Some("c1"), "plan.md"), "# Plan");
        assert_eq!(plans.list(Some("c1")), json!(["plan.md"]));
        assert_eq!(plans.write(Some("c1"), "../../x.md", "x")["success"], false);
        assert_eq!(plans.write(Some("../c1"), "x.md", "x")["success"], false);
        assert_eq!(plans.read(Some("c1"), "missing.md"), Value::Null);
        assert_eq!(plans.delete(Some("c1"), "plan.md")["success"], true);
        assert_eq!(plans.list(Some("c1")), json!([]));
    }

    #[test]
    fn sites_list_html_and_delete_only_direct_children() {
        let dir = tempfile::tempdir().unwrap();
        let sites = Sites(dir.path().to_path_buf());
        assert_eq!(
            sites.write(Some("s1"), "index.html", "<p>hi</p>")["success"],
            true
        );
        sites.write(Some("s1"), "app.js", "1");
        let list = sites.list();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["chatId"], "s1");
        assert_eq!(
            sites.write(Some("s2"), "index.html", "second")["success"],
            true
        );
        let filtered = sites.list_for_chat(Some("s1"));
        assert_eq!(filtered.as_array().unwrap().len(), 1);
        assert_eq!(filtered[0]["chatId"], "s1");
        assert_eq!(
            sites.delete_entry(Some("s1"), Some("../s2/index.html"))["success"],
            false
        );
        assert_eq!(
            sites.delete_entry(Some("s1"), Some("app.js"))["success"],
            true
        );
        assert!(sites.read(Some("s1"), "app.js").is_null());
        assert_eq!(sites.read(Some("s1"), "index.html"), "<p>hi</p>");
        assert_eq!(sites.read(Some("s1"), "../../etc"), Value::Null);
        assert_eq!(sites.delete(Some("..")), json!({ "success": false }));
        assert_eq!(sites.delete(Some("s1")), json!({ "success": true }));
        assert!(!dir.path().join("s1").exists());
    }

    #[test]
    fn artifacts_cover_chat_and_project_folders() {
        let home = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let p = project.path().to_str().unwrap();
        let arts = Artifacts(home.path().to_path_buf());
        assert_eq!(
            arts.write(Some("c1"), "a.md", &"x".repeat(600), None)["success"],
            true
        );
        assert_eq!(
            arts.write(Some("c1"), "skip.exe", "x", None)["success"],
            true
        );
        assert_eq!(
            arts.write(Some("project"), "b.txt", "  hello  ", Some(p))["success"],
            true
        );
        let list = arts.list(None, Some(p));
        let items = list.as_array().unwrap();
        assert_eq!(items.len(), 2);
        let a = items.iter().find(|i| i["id"] == "a.md").unwrap();
        assert_eq!(a["snippet"].as_str().unwrap().len(), 500);
        let b = items.iter().find(|i| i["id"] == "b.txt").unwrap();
        assert_eq!(b["chatId"], "project");
        assert_eq!(b["snippet"], "hello");
        assert_eq!(arts.read(Some("project"), "b.txt", Some(p)), "  hello  ");
        assert_eq!(
            arts.read(Some("c1"), "../c1/a.md", None)
                .as_str()
                .map(|s| s.len()),
            Some(600)
        );
        assert_eq!(arts.read(Some("c1"), "../../../x", None), Value::Null);
        assert_eq!(
            arts.delete(Some("project"), "b.txt", Some(p))["success"],
            true
        );
        std::fs::write(home.path().join("c1").join("r.pdf"), b"%PDF").unwrap();
        assert_eq!(
            arts.read(Some("c1"), "r.pdf", None),
            "data:application/pdf;base64,JVBERg=="
        );
    }

    #[test]
    fn project_files_walk_and_read() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("src/a.ts"), "a").unwrap();
        std::fs::write(root.join("node_modules/x/i.js"), "x").unwrap();
        std::fs::write(root.join(".git/HEAD"), "x").unwrap();
        std::fs::write(root.join("b.png"), [1u8, 2, 3]).unwrap();
        let p = root.to_str();
        let files = list_project_files(p);
        let expected = vec![
            "b.png".to_string(),
            Path::new("src").join("a.ts").to_string_lossy().into_owned(),
        ];
        assert_eq!(files, json!({ "files": expected }));
        assert_eq!(read_project_file(p, Some("src/a.ts")), "a");
        assert_eq!(read_project_file(p, Some("../outside")), Value::Null);
        let d = read_project_file_data_url(p, Some("b.png"));
        assert_eq!(d["mimeType"], "image/png");
        assert_eq!(d["dataUrl"], "data:image/png;base64,AQID");
        assert_eq!(
            read_project_file_data_url(p, Some("../x"))["error"],
            "Invalid file path"
        );
    }
}
