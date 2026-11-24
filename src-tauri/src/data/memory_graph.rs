use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

fn lock_graph(directory: &Path) -> Result<std::fs::File, String> {
    let memory = directory.join("memory");
    std::fs::create_dir_all(&memory).map_err(|error| error.to_string())?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(memory.join("memory_graph.lock"))
        .map_err(|error| error.to_string())?;
    file.lock().map_err(|error| error.to_string())?;
    Ok(file)
}

#[test]
fn zip_backup_includes_linked_files_and_merges_only_new_records() {
    use std::io::Read;
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let graph = json!({
        "nodes": [{"id": "existing"}, {"id": "new", "linkedFile": "note.md"}],
        "edges": [{"source": "existing", "target": "new"}]
    });
    save(source.path(), &graph).unwrap();
    std::fs::write(source.path().join("memory/note.md"), "saved note").unwrap();
    let backup = source.path().join("backup.zip");
    export_zip(source.path(), &backup).unwrap();
    let mut archive = zip::ZipArchive::new(std::fs::File::open(&backup).unwrap()).unwrap();
    let mut note = String::new();
    archive
        .by_name("note.md")
        .unwrap()
        .read_to_string(&mut note)
        .unwrap();
    assert_eq!(note, "saved note");
    save(
        target.path(),
        &json!({"nodes": [{"id": "existing", "value": "local"}], "edges": []}),
    )
    .unwrap();
    assert_eq!(
        import_merge(target.path(), &backup).unwrap(),
        json!({"success": true, "addedNodes": 1, "addedEdges": 1})
    );
    assert_eq!(load(target.path())["nodes"][0]["value"], "local");
    assert_eq!(
        import_merge(target.path(), &backup).unwrap()["addedNodes"],
        0
    );
}

pub fn export_zip(directory: &Path, target: &Path) -> Result<(), String> {
    use std::{
        collections::BTreeMap,
        io::{Cursor, Write},
    };
    let graph = load(directory);
    let nodes = graph["nodes"]
        .as_array()
        .ok_or("Invalid memory graph nodes")?;
    let mut entries = BTreeMap::new();
    entries.insert(
        "memory_graph.json".to_owned(),
        serde_json::to_vec_pretty(&graph).map_err(|error| error.to_string())?,
    );
    for node in nodes {
        let Some(link) = node["linkedFile"].as_str().filter(|link| !link.is_empty()) else {
            continue;
        };
        let path = directory.join("memory").join(link);
        if path.exists() {
            let name = path
                .file_name()
                .ok_or("Invalid memory attachment filename")?
                .to_string_lossy();
            let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
            entries.insert(name.into_owned(), bytes);
        }
    }
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        archive
            .start_file(name, options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
    }
    let bytes = archive
        .finish()
        .map_err(|error| error.to_string())?
        .into_inner();
    crate::store::atomic_write(target, &bytes)
}

pub fn import_merge(directory: &Path, source: &Path) -> Result<Value, String> {
    let input = std::fs::File::open(source).map_err(|error| error.to_string())?;
    let imported: Value = if source.extension().and_then(|ext| ext.to_str()) == Some("zip") {
        let mut archive = zip::ZipArchive::new(input).map_err(|error| error.to_string())?;
        let entry = archive
            .by_name("memory_graph.json")
            .map_err(|_| "No memory_graph.json found in ZIP")?;
        serde_json::from_reader(std::io::BufReader::new(entry))
    } else {
        serde_json::from_reader(std::io::BufReader::new(input))
    }
    .map_err(|error| error.to_string())?;
    let _lock = lock_graph(directory)?;
    let current = load(directory);
    let nodes = current["nodes"]
        .as_array()
        .ok_or("Invalid memory graph nodes")?;
    let edges = current["edges"]
        .as_array()
        .ok_or("Invalid memory graph edges")?;
    let existing_ids: HashSet<_> = nodes.iter().map(|node| &node["id"]).collect();
    let edge_key = |edge: &Value| {
        format!(
            "{}:{}",
            edge["source"].as_str().unwrap_or("undefined"),
            edge["target"].as_str().unwrap_or("undefined")
        )
    };
    let existing_edges: HashSet<_> = edges.iter().map(edge_key).collect();
    let new_nodes: Vec<_> = imported["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|node| !existing_ids.contains(&node["id"]))
        .collect();
    let new_edges: Vec<_> = imported["edges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|edge| !existing_edges.contains(&edge_key(edge)))
        .collect();
    let merged = json!({
        "nodes": nodes.iter().chain(new_nodes.iter().copied()).collect::<Vec<_>>(),
        "edges": edges.iter().chain(new_edges.iter().copied()).collect::<Vec<_>>()
    });
    write_graph(directory, &merged)?;
    Ok(json!({"success": true, "addedNodes": new_nodes.len(), "addedEdges": new_edges.len()}))
}

pub fn sensitive_preference(directory: &Path, query: &str) -> Value {
    use std::sync::LazyLock;
    static PATTERNS: LazyLock<regex::RegexSet> = LazyLock::new(|| {
        regex::RegexSet::new([
            r"(?-u:\b)(payment method|credit card|billing address|visa ending|mastercard|bank account|pay via)(?-u:\b)",
            r"(?-u:\b)(flight preference|preferred airline|fly with|airline preference|seat preference|frequent flyer)(?-u:\b)",
            r"(?-u:\b)(flight|airline|fly|travel)(?-u:\b)",
            r"(?-u:\b)(prefer|always use|default to|favorite)(?-u:\b)",
        ]).unwrap()
    });
    let matches = PATTERNS.matches(&query.to_lowercase());
    let payment = matches.matched(0);
    let airline = matches.matched(1) || (matches.matched(2) && matches.matched(3));
    if !payment && !airline {
        return Value::Null;
    }
    let graph = load(directory);
    let Some(nodes) = graph["nodes"].as_array() else {
        return Value::Null;
    };
    for node in nodes.iter().filter(|node| node["type"] == "preference") {
        let category = node["category"].as_str().unwrap_or_default().to_lowercase();
        let (category, default_file) = match category.as_str() {
            "payment" | "payments" | "billing" if payment => ("payments", "PAYMENTS.md"),
            "airline" | "airlines" | "travel" if airline => ("airline", "TRAVEL.md"),
            _ => continue,
        };
        let linked_file = node["linkedFile"]
            .as_str()
            .filter(|file| !file.is_empty())
            .unwrap_or(default_file);
        return json!({"nodeId": node["id"], "category": category, "value": node["value"], "linkedFile": linked_file});
    }
    Value::Null
}

#[test]
fn sensitive_preference_keeps_graph_order_and_requires_precise_queries() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    save(
        root,
        &json!({"nodes": [
        {"type":"preference", "id":"air", "category":"Travel", "value":"Aisle"},
        {"type":"preference", "id":"pay", "category":"Billing", "value":"Credit"}
    ], "edges": []}),
    )
    .unwrap();
    assert!(sensitive_preference(root, "Book a flight and pay for it").is_null());
    assert_eq!(
        sensitive_preference(root, "I prefer this flight and credit card")["nodeId"],
        "air"
    );
    assert_eq!(
        sensitive_preference(root, "Credit card")["linkedFile"],
        "PAYMENTS.md"
    );
}

pub fn load(directory: &Path) -> Value {
    std::fs::read(directory.join("memory").join("memory_graph.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| json!({"nodes": [], "edges": []}))
}

pub fn recall(directory: &Path, query: &str, vector: &Value) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(json!({"success": false, "output": "No search query provided."}));
    }
    let vector = vector.as_array().filter(|values| values.len() == 1536);
    let graph = load(directory);
    let mut matches = Vec::new();
    if let Some(vector) = vector {
        for node in graph["nodes"].as_array().into_iter().flatten() {
            let kind = node["type"].as_str().unwrap_or_default();
            if !matches!(kind, "fact" | "preference" | "habit") {
                continue;
            }
            let Some(embedding) = node["metadata"]["embedding"]
                .as_array()
                .filter(|values| values.len() == 1536)
            else {
                continue;
            };
            let score = vector
                .iter()
                .zip(embedding)
                .map(|(a, b)| a.as_f64().unwrap_or(f64::NAN) * b.as_f64().unwrap_or(f64::NAN))
                .sum::<f64>();
            if score >= 0.65 {
                let file = node["linkedFile"]
                    .as_str()
                    .filter(|file| !file.is_empty())
                    .unwrap_or(if kind == "fact" {
                        "PROJECT_STATE.md"
                    } else {
                        "USER_PROFILE.md"
                    });
                let source = if file.to_ascii_uppercase().contains("PROJECT") {
                    "Project State"
                } else {
                    "User Profile"
                };
                let category = node["category"].as_str().unwrap_or_default();
                let value = node["value"].as_str().unwrap_or_default();
                matches.push((format!("[{source}] [{category}] {value}"), score));
            }
        }
    }
    let semantic = !matches.is_empty();
    if semantic {
        matches.sort_by(|a, b| b.1.total_cmp(&a.1));
    } else {
        let lower = query.to_lowercase();
        for (file, label) in [
            ("PROJECT_STATE.md", "Project State"),
            ("USER_PROFILE.md", "User Profile"),
        ] {
            let path = super::guard::resolve_within(directory, &["memory", file])?;
            let content = match std::fs::read(path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            for section in String::from_utf8_lossy(&content).split("\n### ") {
                if section.to_lowercase().contains(&lower) {
                    matches.push((format!("[{label}] {}", section.trim()), 1.0));
                }
            }
        }
    }
    let output = if matches.is_empty() {
        format!("No facts matching query \"{query}\" were found.")
    } else {
        let results = matches
            .into_iter()
            .enumerate()
            .map(|(index, (text, score))| {
                let relevance = if semantic {
                    format!(" (Relevance: {:.1}%)", score * 100.0)
                } else {
                    String::new()
                };
                format!("[Result {}]{relevance}\n{text}", index + 1)
            })
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        format!("Found matches:\n\n{results}")
    };
    Ok(json!({"success": true, "output": output}))
}

pub fn search_memory_bank(directory: &Path, query: &str, limit: i64) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    use std::sync::LazyLock;
    static BLOCKS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\n---\s*\n").unwrap());
    static FIELDS: LazyLock<[regex::Regex; 4]> = LazyLock::new(|| {
        [
            r"(?m)^## (.+)$",
            r"\*\*Content:\*\*\s*(.+)",
            r"\*\*Tags:\*\*\s*(.+)",
            r"\*\*Preference:\*\*\s*(.+)",
        ]
        .map(|pattern| regex::Regex::new(pattern).unwrap())
    });
    let empty =
        |output: &str| json!({"entries": [], "fallback": {"success": true, "output": output}});
    let path = super::guard::resolve_within(directory, &["memory.md"])?;
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty(
                "No memories found. The memory file does not exist yet.",
            ))
        }
        Err(error) => return Err(error.to_string()),
    };
    let text = String::from_utf8_lossy(&bytes);
    let entries: Vec<_> = BLOCKS
        .split(&text)
        .filter_map(|block| {
            let raw = block.trim();
            let capture = |index: usize| {
                FIELDS[index]
                    .captures(raw)
                    .and_then(|captures| captures.get(1))
                    .map(|value| value.as_str().trim())
            };
            let date = capture(0).unwrap_or_default();
            let content = capture(1)?;
            let tags = capture(2).unwrap_or_default();
            let preference = capture(3).unwrap_or_default();
            let id = format!("{:x}", Sha256::digest(format!("{date}::{content}")));
            let mut embedding_text = content.to_owned();
            if !tags.is_empty() {
                embedding_text.push_str(&format!(" Tags: {tags}"));
            }
            if !preference.is_empty() {
                embedding_text.push_str(&format!(" Preference: {preference}"));
            }
            Some(
                json!({"date": date, "content": content, "tags": tags, "preference": preference,
            "raw": raw, "id": id, "embeddingText": embedding_text}),
            )
        })
        .collect();
    if entries.is_empty() {
        return Ok(empty("No memories found in the memory file."));
    }
    let query = query.to_lowercase();
    let words: Vec<_> = query
        .split_whitespace()
        .filter(|word| word.encode_utf16().count() > 2)
        .collect();
    let field = |entry: &Value, key: &str| entry[key].as_str().unwrap_or_default().to_owned();
    let mut ranked: Vec<_> = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let content = field(entry, "content").to_lowercase();
            let tags = field(entry, "tags").to_lowercase();
            let preference = field(entry, "preference").to_lowercase();
            let mut score = if content.contains(&query) { 10.0 } else { 0.0 }
                + if tags.contains(&query) { 8.0 } else { 0.0 };
            for word in &words {
                score += 3.0 * f64::from(content.contains(word))
                    + 2.0 * f64::from(tags.contains(word))
                    + f64::from(preference.contains(word));
            }
            score += index as f64 / entries.len() as f64 * 0.5;
            (score > 0.0).then_some((entry, score))
        })
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let count = if limit < 0 {
        ranked.len().saturating_sub(limit.unsigned_abs() as usize)
    } else {
        limit as usize
    };
    ranked.truncate(count);
    let fallback = if ranked.is_empty() {
        json!({"success": true, "output": "No relevant memories found."})
    } else {
        let output = ranked
            .iter()
            .enumerate()
            .map(|(index, (entry, score))| {
                let date = field(entry, "date");
                let content = field(entry, "content");
                let tags = field(entry, "tags");
                let preference = field(entry, "preference");
                let mut result = format!(
                    "[Result {}] (Relevance: {score:.2})\nDate: {date}\n{content}",
                    index + 1
                );
                if !tags.is_empty() {
                    result.push_str(&format!("\nTags: {tags}"));
                }
                if !preference.is_empty() {
                    result.push_str(&format!("\nPreference: {preference}"));
                }
                result
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let preferred = ranked
            .iter()
            .find(|(entry, _)| !field(entry, "preference").is_empty())
            .map(|(entry, _)| *entry);
        json!({"success": true, "output": output, "data": {
            "hasPreference": preferred.is_some(),
            "preferenceText": preferred.map(|entry| field(entry, "content")).unwrap_or_default(),
            "preferenceType": preferred.map(|entry| field(entry, "preference")).unwrap_or_default(),
            "resultCount": ranked.len()
        }})
    };
    Ok(json!({"entries": entries, "fallback": fallback}))
}

pub fn format_semantic_matches(rows: &Value) -> Value {
    let Some(rows) = rows.as_array().filter(|rows| !rows.is_empty()) else {
        return Value::Null;
    };
    let mut preference = None;
    let mut results = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let metadata = row["metadata"]
            .as_str()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .unwrap_or(Value::Null);
        let content = row["content"].as_str().unwrap_or_default();
        let date = metadata["date"].as_str().unwrap_or_default();
        let tags = metadata["tags"].as_str().unwrap_or_default();
        let category = metadata["preference"].as_str().unwrap_or_default();
        let similarity = 1.0 - row["distance"].as_f64().unwrap_or_default();
        let mut output = format!(
            "[Result {}] (Relevance: {similarity:.4})\nDate: {date}\n{content}",
            index + 1
        );
        if !tags.is_empty() {
            output.push_str(&format!("\nTags: {tags}"));
        }
        if !category.is_empty() {
            output.push_str(&format!("\nPreference: {category}"));
            if preference.is_none() {
                preference = Some((content.to_owned(), category.to_owned()));
            }
        }
        results.push(output);
    }
    let has_preference = preference.is_some();
    let (text, category) = preference.unwrap_or_default();
    json!({"success": true, "output": results.join("\n\n"), "data": {
        "hasPreference": has_preference, "preferenceText": text,
        "preferenceType": category, "resultCount": rows.len()
    }})
}

#[test]
fn memory_bank_prepares_index_inputs_and_reports_preference_matches() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let fallback = search_memory_bank(dir.path(), "layout", 5).unwrap();
    assert_eq!(fallback["entries"], json!([]));
    assert_eq!(
        fallback["fallback"]["output"],
        "No memories found. The memory file does not exist yet."
    );
    std::fs::write(dir.path().join("memory.md"),
        "# EverFern Memory Bank\n\n## Today\n**Content:** Compact layout\n**Tags:** reports\n**Preference:** formatting\n---\n",
    ).unwrap();
    let result = search_memory_bank(dir.path(), "LAYOUT", 5).unwrap();
    let entry = &result["entries"][0];
    assert_eq!(
        entry["id"],
        format!("{:x}", Sha256::digest(b"Today::Compact layout"))
    );
    assert_eq!(
        entry["embeddingText"],
        "Compact layout Tags: reports Preference: formatting"
    );
    assert_eq!(
        result["fallback"]["data"],
        json!({
            "hasPreference": true, "preferenceText": "Compact layout",
            "preferenceType": "formatting", "resultCount": 1
        })
    );
}

#[test]
fn recall_preserves_semantic_threshold_and_keyword_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut vector = vec![0.0; 1536];
    vector[0] = 1.0;
    let mut below_threshold = vector.clone();
    below_threshold[0] = 0.5;
    save(root, &json!({"nodes": [
        {"type": "fact", "category": "status", "value": "low score", "metadata": {"embedding": below_threshold}},
        {"type": "fact", "category": "status", "value": "semantic result", "metadata": {"embedding": vector}}
    ], "edges": []})).unwrap();
    std::fs::write(
        root.join("memory/PROJECT_STATE.md"),
        "# State\n### Budget\n- keyword result",
    )
    .unwrap();
    let semantic = recall(root, "budget", &json!(vector)).unwrap();
    let output = semantic["output"].as_str().unwrap();
    assert!(output.contains("(Relevance: 100.0%)"));
    assert!(output.contains("semantic result"));
    assert!(!output.contains("low score") && !output.contains("keyword result"));
    let keyword = recall(root, "BUDGET", &Value::Null).unwrap();
    let output = keyword["output"].as_str().unwrap();
    assert!(output.contains("[Project State] Budget\n- keyword result"));
    assert!(!output.contains("Relevance"));
}

pub fn delete_node(directory: &Path, id: &str) -> Result<Value, String> {
    let _lock = lock_graph(directory)?;
    let mut graph = load(directory);
    let nodes = graph["nodes"]
        .as_array()
        .ok_or("Invalid memory graph nodes")?;
    if !nodes.iter().any(|node| node["id"] == id) {
        return Ok(json!({"success": true}));
    }
    let edges = graph["edges"]
        .as_array()
        .ok_or("Invalid memory graph edges")?;
    let edges: Vec<_> = edges
        .iter()
        .filter(|edge| edge["source"] != id && edge["target"] != id)
        .cloned()
        .collect();
    let linked: HashSet<_> = edges
        .iter()
        .flat_map(|edge| [edge["source"].as_str(), edge["target"].as_str()])
        .flatten()
        .collect();
    let nodes: Vec<_> = nodes
        .iter()
        .filter(|node| {
            node["id"] != id
                && (node["type"] != "file"
                    || node["id"].as_str().is_some_and(|id| linked.contains(id)))
        })
        .cloned()
        .collect();
    graph["nodes"] = json!(nodes);
    graph["edges"] = json!(edges);
    write_graph(directory, &graph)?;
    Ok(json!({"success": true}))
}

pub fn save(directory: &Path, graph: &Value) -> Result<(), String> {
    let _lock = lock_graph(directory)?;
    write_graph(directory, graph)
}

fn write_graph(directory: &Path, graph: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(graph).map_err(|error| error.to_string())?;
    crate::store::atomic_write(&directory.join("memory").join("memory_graph.json"), &bytes)?;
    Ok(())
}

pub fn upsert(directory: &Path, input: &Value) -> Result<(), String> {
    let field = |key: &str| {
        input[key]
            .as_str()
            .ok_or_else(|| format!("Missing memory {key}"))
    };
    let kind = field("type")?;
    let category = field("category")?;
    let value = field("value")?;
    let linked_file = field("linkedFile")?;
    if linked_file.is_empty()
        || linked_file.contains(['/', '\\', ':', '\0'])
        || matches!(linked_file, "." | "..")
    {
        return Err("Invalid memory filename".into());
    }
    let markdown = super::guard::resolve_within(directory, &["memory", linked_file])?;
    let now = field("timestamp")?;
    let _lock = lock_graph(directory)?;
    let mut graph = load(directory);
    let nodes = graph["nodes"]
        .as_array_mut()
        .ok_or("Invalid memory graph nodes")?;
    let category_key = category.to_lowercase();
    let mut metadata = input["metadata"].as_object().cloned().unwrap_or_default();
    metadata.insert("lastUpdated".into(), json!(now));
    if let Some(node) = nodes.iter_mut().find(|node| {
        node["type"] == kind
            && node["category"]
                .as_str()
                .is_some_and(|name| name.to_lowercase() == category_key)
    }) {
        let old_embedding = node["metadata"].get("embedding").cloned();
        let mut merged = node["metadata"].as_object().cloned().unwrap_or_default();
        merged.extend(metadata);
        if let Some(embedding) = input.get("embedding").or(old_embedding.as_ref()) {
            merged.insert("embedding".into(), embedding.clone());
        } else {
            merged.remove("embedding");
        }
        node["metadata"] = Value::Object(merged);
        node["value"] = json!(value);
    } else {
        let id = field("id")?;
        let file_id = format!("file_{}", linked_file.to_lowercase());
        if let Some(embedding) = input.get("embedding") {
            metadata.insert("embedding".into(), embedding.clone());
        } else {
            metadata.remove("embedding");
        }
        metadata.insert("created".into(), json!(now));
        nodes.push(json!({"id": id, "type": kind, "category": category,
            "name": format!("{category} {kind}"), "value": value, "linkedFile": linked_file, "metadata": metadata}));
        if !nodes.iter().any(|node| node["id"] == file_id) {
            nodes.push(json!({"id": file_id, "type": "file", "category": "file",
                "name": linked_file, "value": directory.join("memory").join(linked_file)}));
        }
        graph["edges"]
            .as_array_mut()
            .ok_or("Invalid memory graph edges")?
            .push(json!({"source": id, "target": file_id, "type": "linked_to"}));
    }
    write_graph(directory, &graph)?;
    append_memory_entry(&markdown, linked_file, category, value)
}

#[test]
fn memory_update_preserves_embedding_and_appends_markdown() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let mut memory = json!({
        "id": "first", "type": "fact", "category": "Status", "value": "Initial",
        "linkedFile": "PROJECT_STATE.md", "timestamp": "2026-01-01T00:00:00.000Z",
        "metadata": {"source": "user"}, "embedding": [0.25]
    });
    upsert(root, &memory).unwrap();
    memory.as_object_mut().unwrap().remove("embedding");
    memory["category"] = json!("status");
    memory["value"] = json!("Updated");
    upsert(root, &memory).unwrap();
    let graph = load(root);
    assert_eq!(graph["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(graph["edges"].as_array().unwrap().len(), 1);
    assert_eq!(graph["nodes"][0]["value"], "Updated");
    assert_eq!(graph["nodes"][0]["metadata"]["embedding"], json!([0.25]));
    let notes = std::fs::read_to_string(root.join("memory/PROJECT_STATE.md")).unwrap();
    assert_eq!(notes.matches("# Project State & Facts").count(), 1);
    assert!(notes.contains("- Initial\n") && notes.contains("- Updated\n"));
}

fn append_memory_entry(
    path: &Path,
    filename: &str,
    category: &str,
    value: &str,
) -> Result<(), String> {
    use std::io::Write;
    let stem = filename.split('.').next().unwrap_or_default();
    let title = match filename.to_ascii_uppercase().as_str() {
        "PAYMENTS.MD" => "Payment Preferences & Billing".to_owned(),
        "TRAVEL.MD" => "Travel & Airline Preferences".to_owned(),
        "USER_PROFILE.MD" => "User Profile & App Preferences".to_owned(),
        "PROJECT_STATE.MD" => "Project State & Facts".to_owned(),
        _ => format!("{stem} Details"),
    };
    let timestamp = super::db::iso_now();
    let entry = format!("\n### [{category}] ({timestamp})\n- {value}\n");
    let mut file = match std::fs::OpenOptions::new()
        .append(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            write!(
                file,
                "# {title}\n\nThis file persists your {} details.\n\n",
                stem.to_lowercase()
            )
            .map_err(|error| error.to_string())?;
            file
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::OpenOptions::new()
                .append(true)
                .open(path)
                .map_err(|error| error.to_string())?
        }
        Err(error) => return Err(error.to_string()),
    };
    file.write_all(entry.as_bytes())
        .map_err(|error| error.to_string())
}

#[test]
fn deletion_prunes_only_removed_nodes_and_unlinked_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let graph = json!({
        "nodes": [
            {"id": "remove", "type": "fact"}, {"id": "keep", "type": "habit"},
            {"id": "orphan", "type": "file"}, {"id": "linked", "type": "file"}
        ],
        "edges": [
            {"source": "remove", "target": "orphan"}, {"source": "keep", "target": "linked"}
        ]
    });
    save(root, &graph).unwrap();
    delete_node(root, "unknown").unwrap();
    assert_eq!(load(root), graph);
    delete_node(root, "remove").unwrap();
    assert_eq!(
        load(root),
        json!({"nodes": [graph["nodes"][1], graph["nodes"][3]], "edges": [graph["edges"][1]]})
    );
}

pub fn save_direct(directory: &Path, content: &str, tags: &str) -> Value {
    match append_direct(directory, content, tags) {
        Ok(value) => value,
        Err(error) => {
            json!({"success": false, "output": format!("Failed to save memory: {error}")})
        }
    }
}

#[test]
fn direct_memory_save_preserves_tags_and_preference_classification() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(save_direct(dir.path(), "  ", "")["success"], false);
    assert!(!dir.path().join("memory.md").exists());
    let saved = save_direct(dir.path(), " I prefer a compact layout ", "reports");
    assert_eq!(saved["success"], true);
    assert!(saved["output"]
        .as_str()
        .unwrap()
        .ends_with("[Tagged as formatting preference]"));
    assert_eq!(
        save_direct(dir.path(), "The meeting ended", "")["success"],
        true
    );
    let text = std::fs::read_to_string(dir.path().join("memory.md")).unwrap();
    assert_eq!(text.matches("# EverFern Memory Bank").count(), 1);
    assert!(text.contains("**Tags:** reports\n**Preference:** formatting\n"));
    assert!(text.contains("**Content:** The meeting ended\n---"));
}

fn append_direct(directory: &Path, content: &str, tags: &str) -> Result<Value, String> {
    use std::io::Write;
    let content = content.trim();
    if content.is_empty() {
        return Ok(json!({"success": false, "output": "No content provided."}));
    }
    static STRONG: std::sync::LazyLock<regex::RegexSet> = std::sync::LazyLock::new(|| {
        regex::RegexSet::new([
            r#"\bprefer(s|red|ence)?\b"#,
            r#"\bchoose(s|chose|choice)?\b"#,
            r#"\bselect(s|ed|ion)?\b"#,
            r#"\blike(s|d)?\s+(to|using|when)\b"#,
            r#"\bwant(s|ed)?\s+(to|me to)\b"#,
            r#"\balways\s+(use|do|want|prefer)"#,
            r#"\busually\s+(use|do|want|prefer)"#,
            r#"\btypically\s+(use|do|want|prefer)"#,
            r#"\bdefault\s+(to|is|should be)"#,
            r#"\bfavorite\b"#,
            r#"\bgo-to\b"#,
        ])
        .unwrap()
    });
    static WEAK: std::sync::LazyLock<regex::RegexSet> = std::sync::LazyLock::new(|| {
        regex::RegexSet::new([
            r#"\bshould\s+(always|use|do)\b"#,
            r#"\bdon't\s+(like|want|use)\b"#,
            r#"\bavoid\b"#,
            r#"\bnever\s+(use|do|want)\b"#,
        ])
        .unwrap()
    });
    static TYPES: std::sync::LazyLock<regex::RegexSet> = std::sync::LazyLock::new(|| {
        regex::RegexSet::new([
            r#"\b(format|style|layout|design|theme|color)\b"#,
            r#"\b(report|output|display|show|view)\b"#,
            r#"\b(workflow|process|approach|method|way)\b"#,
            r#"\b(tool|library|framework|language|tech)\b"#,
            r#"\b(communication|notify|alert|message)\b"#,
        ])
        .unwrap()
    });
    let lower = content.to_lowercase();
    let preference = STRONG.is_match(&lower) || WEAK.matches(&lower).into_iter().count() >= 2;
    let labels = [
        "formatting",
        "output",
        "workflow",
        "technology",
        "communication",
    ];
    let kind = TYPES
        .matches(&lower)
        .into_iter()
        .next()
        .map_or("general", |index| labels[index]);
    let date = chrono::Local::now().format("%a %b %d %Y %-I:%M:%S %p");
    let mut entry = format!("## {date}\n**Content:** {content}\n");
    if !tags.is_empty() {
        entry.push_str(&format!("**Tags:** {tags}\n"));
    }
    if preference {
        entry.push_str(&format!("**Preference:** {kind}\n"));
    }
    entry.push_str("---\n");
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let path = super::guard::resolve_within(directory, &["memory.md"])?;
    let mut file = match std::fs::OpenOptions::new()
        .append(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => {
            entry.insert_str(0, "# EverFern Memory Bank\n\n");
            file
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::OpenOptions::new()
                .append(true)
                .open(path)
                .map_err(|error| error.to_string())?
        }
        Err(error) => return Err(error.to_string()),
    };
    file.write_all(entry.as_bytes())
        .map_err(|error| error.to_string())?;
    let preview: String = content.chars().take(50).collect();
    let suffix = if preference {
        format!(" [Tagged as {kind} preference]")
    } else {
        String::new()
    };
    Ok(json!({"success": true, "output": format!("Saved memory chunk: \"{preview}...\"{suffix}")}))
}
