//! Port of main/lib/path-guard.ts: keeps renderer-supplied names and paths
//! inside their sandbox folder, both lexically and through symlinks.

use std::path::{Component, Path, PathBuf};

/// Lexical `path.resolve`: absolute segments replace the base, `.`/`..` collapse.
fn resolve_lexical(root: &Path, segments: &[&str]) -> PathBuf {
    let mut out = std::path::absolute(root).unwrap_or_else(|_| root.to_path_buf());
    for seg in segments {
        let seg = Path::new(seg);
        let joined = if seg.is_absolute() || seg.has_root() {
            std::path::absolute(seg).unwrap_or_else(|_| seg.to_path_buf())
        } else {
            out.join(seg)
        };
        out = joined;
    }
    let mut clean = PathBuf::new();
    for comp in out.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // Never climb above the drive or root.
                if !matches!(
                    clean.components().next_back(),
                    Some(Component::RootDir | Component::Prefix(_)) | None
                ) {
                    clean.pop();
                }
            }
            other => clean.push(other.as_os_str()),
        }
    }
    clean
}

fn normalized_root(root: &Path) -> PathBuf {
    resolve_lexical(root, &[])
}

/// Resolves `segments` under `root`; errors when the result would escape it.
pub fn resolve_within(root: &Path, segments: &[&str]) -> Result<PathBuf, String> {
    let root = normalized_root(root);
    let resolved = resolve_lexical(&root, segments);
    if !resolved.starts_with(&root) {
        return Err(format!("Path escapes sandbox root: {}", segments.join("/")));
    }
    match std::fs::canonicalize(&resolved) {
        Ok(real) => {
            let real_root = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
            if !real.starts_with(&real_root) {
                return Err(format!(
                    "Path escapes sandbox root via symlink: {}",
                    segments.join("/")
                ));
            }
            Ok(real)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::symlink_metadata(&resolved) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    Err("Path escapes sandbox root via dangling symlink".into())
                }
                _ => {
                    if let Ok(real_root) = std::fs::canonicalize(&root) {
                        for ancestor in resolved
                            .ancestors()
                            .skip(1)
                            .take_while(|path| *path != root)
                        {
                            match std::fs::canonicalize(ancestor) {
                                Ok(real) if real.starts_with(&real_root) => break,
                                Ok(_) => return Err("Path escapes sandbox root via symlink".into()),
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                                    continue
                                }
                                Err(error) => return Err(error.to_string()),
                            }
                        }
                    }
                    Ok(resolved)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// One safe path segment: 1-120 chars of [A-Za-z0-9._-] with no "..".
pub fn safe_segment<'a>(segment: Option<&'a str>, label: &str) -> Result<&'a str, String> {
    match segment {
        Some(s)
            if !s.is_empty()
                && s.chars().count() <= 120
                && !s.contains("..")
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) =>
        {
            Ok(s)
        }
        other => Err(format!(
            "Unsafe {label}: {}",
            other
                .unwrap_or("undefined")
                .chars()
                .take(40)
                .collect::<String>()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_paths_inside_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(resolve_within(root, &["a.md"]).is_ok());
        assert!(resolve_within(root, &["sub/../a.md"]).is_ok());
        assert!(resolve_within(root, &["../a.md"]).is_err());
        assert!(resolve_within(root, &["sub/../../a.md"]).is_err());
        assert!(resolve_within(root, &["C:\\Windows\\win.ini"]).is_err());
        assert!(resolve_within(root, &["/etc/passwd"]).is_err());
        assert!(resolve_within(root, &[]).is_ok());
    }

    #[test]
    fn rejects_unsafe_segments() {
        assert!(safe_segment(Some("chat-1_a.b"), "chat id").is_ok());
        for bad in ["", "..", "a/b", "a\\b", "a..b", "a b", "c:"] {
            assert!(safe_segment(Some(bad), "chat id").is_err(), "{bad}");
        }
        assert!(safe_segment(None, "chat id").is_err());
        assert!(safe_segment(Some(&"a".repeat(121)), "chat id").is_err());
    }
}
