//! The Skills page's channels (`skills:*`), ported from `main/lib/skills-sync.ts`.
//!
//! Layout on disk, shared with Node, which still reads it to build agent prompts:
//!   ~/.everfern/custom_skills/<name>/SKILL.md   skills the user wrote
//!   ~/.everfern/skills/                         built-in skills, with custom ones merged in
//!   ~/.everfern/skills/.sync-version            hash Node uses to skip re-copying built-ins

use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub struct Skills {
    /// ~/.everfern
    pub root: PathBuf,
    /// The bundled built-in skills, when known: used when ~/.everfern/skills is empty
    /// and to restore a built-in after a custom skill of the same name is deleted.
    pub builtin: Option<PathBuf>,
}

static FRONTMATTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^---\s*\n([\s\S]*?)\n---\s*\n").unwrap());
// list-custom anchors keys at line starts; the loader behind list-all doesn't.
static CUSTOM_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^name:\s*["']?([^"'\n]+)["']?"#).unwrap());
static CUSTOM_DESCRIPTION: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    [
        Regex::new(r#"(?m)^description:\s*"([^"]*)""#).unwrap(),
        Regex::new(r"(?m)^description:\s*'([^']*)'").unwrap(),
        Regex::new(r"(?m)^description:\s*([^\n]+)").unwrap(),
    ]
});
static LOADER_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)(?:^|##\s*)name:\s*["']?([^"'\n]+)["']?"#).unwrap());
static LOADER_DESCRIPTION: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    [
        Regex::new(r#"description:\s*"([^"]*)""#).unwrap(),
        Regex::new(r"description:\s*'([^']*)'").unwrap(),
        Regex::new(r"description:\s*([^\n]+)").unwrap(),
    ]
});
const IGNORE_DIRS: [&str; 13] = [
    "node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".vscode", ".idea",
    "__pycache__", "venv", ".env", "target",
];

fn capture(re: &Regex, text: &str) -> Option<String> {
    re.captures(text).map(|c| c[1].trim().to_string())
}

fn first_capture(res: &[Regex], text: &str) -> Option<String> {
    res.iter().find_map(|re| capture(re, text))
}

/// Entries of `dir` sorted by name (missing folder: none).
fn entries(dir: &Path) -> Vec<std::fs::DirEntry> {
    let mut list: Vec<_> = std::fs::read_dir(dir)
        .map(|it| it.flatten().collect())
        .unwrap_or_default();
    list.sort_by_key(|e| e.file_name());
    list
}

fn is_dir(entry: &std::fs::DirEntry) -> bool {
    entry.file_type().is_ok_and(|t| t.is_dir())
}

/// Like `name.replace(/[^a-zA-Z0-9-_]/g, '_')`: JS replaces per UTF-16 unit,
/// so a character outside the BMP becomes two underscores.
fn sanitize(name: &str) -> String {
    name.chars()
        .flat_map(|c| {
            let keep = c.is_ascii_alphanumeric() || c == '-' || c == '_';
            let n = if keep { 1 } else { c.len_utf16() };
            std::iter::repeat_n(if keep { c } else { '_' }, n)
        })
        .collect()
}

/// A folder name the user picked from the list: one path segment, nothing that climbs out.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.contains('\0')
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

impl Skills {
    pub fn custom_dir(&self) -> PathBuf {
        self.root.join("custom_skills")
    }

    fn skills_dir(&self) -> PathBuf {
        self.root.join("skills")
    }

    pub fn list_custom(&self) -> Value {
        let mut out = Vec::new();
        for entry in entries(&self.custom_dir()).into_iter().filter(is_dir) {
            let dir = entry.path();
            let Ok(text) = std::fs::read_to_string(dir.join("SKILL.md")) else {
                continue;
            };
            let Some(front) = capture(&FRONTMATTER, &text) else {
                continue;
            };
            let name = capture(&CUSTOM_NAME, &front)
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
            out.push(json!({
                "name": name,
                "path": dir.to_string_lossy(),
                "description": first_capture(&*CUSTOM_DESCRIPTION, &front).unwrap_or_default(),
            }));
        }
        Value::Array(out)
    }

    /// Every skill the agent can see, as `loadSkillsAsync` finds them.
    pub fn list_all(&self) -> Value {
        let installed = self.skills_dir();
        let has_skills = entries(&installed)
            .iter()
            .any(|e| e.file_name() != ".sync-version");
        let dir = if has_skills {
            Some(installed)
        } else {
            self.builtin.clone().filter(|d| !entries(d).is_empty())
        };
        let mut out = Vec::new();
        if let Some(dir) = dir {
            collect_skills(&dir, &mut out);
        }
        Value::Array(out)
    }

    pub fn save_custom(&self, data: &Value) -> Value {
        let result = (|| {
            let name = data["name"].as_str().ok_or("Skill name is required")?;
            let text = |key: &str| match &data[key] {
                Value::String(s) => s.clone(),
                Value::Null => "undefined".into(),
                other => other.to_string(),
            };
            let dir = self.custom_dir().join(sanitize(name));
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let body = format!(
                "---\nname: {name}\ndescription: \"{}\"\n---\n\n{}\n",
                text("description"),
                text("content")
            );
            std::fs::write(dir.join("SKILL.md"), body).map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        match result {
            Ok(()) => {
                self.merge_custom();
                json!({"success": true})
            }
            Err(error) => json!({"success": false, "error": error}),
        }
    }

    pub fn delete_custom(&self, name: Option<&str>) -> Value {
        let Some(name) = name.filter(|n| plain_name(n)) else {
            return json!({"success": false, "error": "Skill not found"});
        };
        let dir = self.custom_dir().join(name);
        if !dir.exists() {
            return json!({"success": false, "error": "Skill not found"});
        }
        if let Err(error) = std::fs::remove_dir_all(&dir) {
            return json!({"success": false, "error": error.to_string()});
        }
        // Take its merged copy out of the runtime folder too (Node's handler left it there),
        // putting back a built-in skill it may have covered.
        let merged = self.skills_dir().join(name);
        let _ = std::fs::remove_dir_all(&merged);
        let builtin = self.builtin.as_ref().map(|d| d.join(name));
        match builtin.filter(|d| d.is_dir()) {
            Some(original) => {
                let _ = copy_dir(&original, &merged);
            }
            // Can't restore it here: make Node re-copy the built-ins on its next start.
            None => {
                let _ = std::fs::remove_file(self.skills_dir().join(".sync-version"));
            }
        }
        self.merge_custom();
        json!({"success": true})
    }

    /// Copies custom skills over the runtime skills folder, as `mergeCustomSkills` does.
    pub fn merge_custom(&self) {
        let skills = self.skills_dir();
        if std::fs::create_dir_all(&skills).is_err() {
            return;
        }
        for entry in entries(&self.custom_dir()) {
            let target = skills.join(entry.file_name());
            if is_dir(&entry) {
                let _ = std::fs::create_dir_all(&target);
                for file in entries(&entry.path()).into_iter().filter(|e| !is_dir(e)) {
                    let _ = std::fs::copy(file.path(), target.join(file.file_name()));
                }
            } else {
                let _ = std::fs::copy(entry.path(), target);
            }
        }
    }
}

fn collect_skills(dir: &Path, out: &mut Vec<Value>) {
    for entry in entries(dir) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if is_dir(&entry) {
            if !IGNORE_DIRS.contains(&name.as_str()) {
                collect_skills(&path, out);
            }
            continue;
        }
        if !(name == "SKILL.md" || (name.ends_with(".md") && name.contains("SKILL"))) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(front) = capture(&FRONTMATTER, &text) else {
            continue;
        };
        let skill = capture(&LOADER_NAME, &front).filter(|n| !n.is_empty());
        let description =
            first_capture(&*LOADER_DESCRIPTION, &front).filter(|d| !d.is_empty());
        if let (Some(skill), Some(description)) = (skill, description) {
            out.push(json!({
                "name": skill,
                "description": description,
                "path": path.to_string_lossy().replace('\\', "/"),
            }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ef-skills-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_writes_nodes_format_and_merges_into_runtime_folder() {
        let root = temp("save");
        let skills = Skills { root: root.clone(), builtin: None };
        let out = skills.save_custom(&json!({"name": "My Skill!", "description": "Does it", "content": "Body"}));
        assert_eq!(out, json!({"success": true}));
        let written = std::fs::read_to_string(root.join("custom_skills/My_Skill_/SKILL.md")).unwrap();
        assert_eq!(written, "---\nname: My Skill!\ndescription: \"Does it\"\n---\n\nBody\n");
        assert!(root.join("skills/My_Skill_/SKILL.md").is_file());

        let listed = skills.list_custom();
        assert_eq!(listed[0]["name"], "My Skill!");
        assert_eq!(listed[0]["description"], "Does it");

        let all = skills.list_all();
        assert_eq!(all[0]["name"], "My Skill!");
        assert!(all[0]["path"].as_str().unwrap().ends_with("skills/My_Skill_/SKILL.md"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_restores_a_covered_builtin_and_refuses_paths() {
        let root = temp("delete");
        let builtin = temp("builtin");
        std::fs::create_dir_all(builtin.join("pdf")).unwrap();
        std::fs::write(builtin.join("pdf/SKILL.md"), "---\nname: pdf\ndescription: built in\n---\n").unwrap();
        let skills = Skills { root: root.clone(), builtin: Some(builtin.clone()) };
        skills.save_custom(&json!({"name": "pdf", "description": "mine", "content": ""}));
        assert!(std::fs::read_to_string(root.join("skills/pdf/SKILL.md")).unwrap().contains("mine"));

        assert_eq!(skills.delete_custom(Some("../skills"))["success"], false);
        assert!(root.join("skills").is_dir());
        assert_eq!(skills.delete_custom(Some("pdf"))["success"], true);
        assert!(!root.join("custom_skills/pdf").exists());
        assert!(std::fs::read_to_string(root.join("skills/pdf/SKILL.md")).unwrap().contains("built in"));
        assert_eq!(skills.delete_custom(Some("pdf"))["error"], "Skill not found");
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(builtin);
    }

    #[test]
    fn list_all_falls_back_to_builtins_and_skips_ignored_folders() {
        let root = temp("all");
        let builtin = temp("all-builtin");
        std::fs::create_dir_all(root.join("skills")).unwrap();
        std::fs::write(root.join("skills/.sync-version"), "x").unwrap();
        std::fs::create_dir_all(builtin.join("docx/node_modules/x")).unwrap();
        std::fs::write(builtin.join("docx/SKILL.md"), "---\r\nname: \"docx\"\r\ndescription: 'Word files'\r\n---\r\nbody").unwrap();
        std::fs::write(builtin.join("docx/node_modules/x/SKILL.md"), "---\nname: x\ndescription: y\n---\n").unwrap();
        std::fs::write(builtin.join("nodesc.md"), "---\nname: z\n---\n").unwrap();
        let skills = Skills { root: root.clone(), builtin: Some(builtin.clone()) };
        let all = skills.list_all();
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["name"], "docx");
        assert_eq!(all[0]["description"], "Word files");
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(builtin);
    }

    #[test]
    fn sanitize_matches_js_utf16_replacement() {
        assert_eq!(sanitize("a b-c_d"), "a_b-c_d");
        assert_eq!(sanitize("x\u{1F600}"), "x__");
    }
}
