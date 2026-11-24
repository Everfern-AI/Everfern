//! Local embedding fallback (all-MiniLM-L6-v2), the Rust twin of the Transformers.js
//! pipeline in `main/lib/embeddings.ts`. Running it in a short-lived `--ef-embed-local`
//! process means the ONNX runtime and model weights (~130 MB) are freed when the call
//! ends instead of staying resident in the Node process.
//!
//! It runs the same quantized ONNX file Transformers.js uses and copies its BERT
//! tokenizer, mean pooling and L2 normalization, so vectors match to float noise.

use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tract_onnx::prelude::*;
use unicode_normalization::UnicodeNormalization;

const MODEL_ID: &str = "Xenova/all-MiniLM-L6-v2";
const MODEL_FILE: &str = "onnx/model_quantized.onnx";
const TOKENIZER_FILE: &str = "tokenizer.json";
/// `model_max_length` from tokenizer_config.json; Transformers.js truncates to it.
const MAX_TOKENS: usize = 512;
const MAX_CHARS_PER_WORD: usize = 100;
/// _is_control's Cc/Cf/Co/Cs. A Rust `char` is never a surrogate, so Cs is left out.
const CONTROL_CHARS: &str = r"^[\p{Cc}\p{Cf}\p{Co}]$";

/// Request: `{texts: string[], modelDir?: string}` -> `{vectors: number[][]}` (384-d).
pub fn execute(request: &Value) -> Result<Value, String> {
    let texts: Vec<&str> = request["texts"]
        .as_array()
        .ok_or("texts must be an array")?
        .iter()
        .map(|t| t.as_str().ok_or("texts must be strings"))
        .collect::<Result<_, _>>()?;
    let dir = model_dir(request["modelDir"].as_str())?;
    let tokenizer = Tokenizer::load(&dir.join(TOKENIZER_FILE))?;
    if request["tokensOnly"] == true {
        // Diagnostics: the token ids, to tell tokenizer drift from numeric drift.
        let ids: Vec<Vec<i64>> = texts.iter().map(|t| tokenizer.encode(t)).collect();
        return Ok(json!({ "ids": ids }));
    }
    let model = load_model(&dir.join(MODEL_FILE))?;
    let mut vectors = Vec::with_capacity(texts.len());
    for text in texts {
        vectors.push(embed(&model, &tokenizer.encode(text))?);
    }
    Ok(json!({ "vectors": vectors }))
}

/// Uses the folder Node already has (the Transformers.js cache) when it holds both
/// files; otherwise `~/.everfern/models/<id>`, downloading from Hugging Face once.
fn model_dir(preferred: Option<&str>) -> Result<PathBuf, String> {
    let complete = |d: &Path| d.join(MODEL_FILE).is_file() && d.join(TOKENIZER_FILE).is_file();
    if let Some(dir) = preferred.map(PathBuf::from).filter(|d| complete(d)) {
        return Ok(dir);
    }
    let dir = super::home()?.join(".everfern").join("models").join(MODEL_ID);
    if !complete(&dir) {
        tauri::async_runtime::block_on(download(&dir))?;
    }
    Ok(dir)
}

async fn download(dir: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    for file in [TOKENIZER_FILE, MODEL_FILE] {
        let target = dir.join(file);
        if target.is_file() {
            continue;
        }
        let url = format!("https://huggingface.co/{MODEL_ID}/resolve/main/{file}");
        let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Model download failed ({}) for {file}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
        // Write beside the target, then rename, so a cut-off download is never used.
        let partial = target.with_extension("part");
        std::fs::write(&partial, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

type Model = Arc<TypedRunnableModel>;

fn load_model(path: &Path) -> Result<Model, String> {
    tract_onnx::onnx()
        .model_for_path(path)
        .and_then(|m| m.into_optimized())
        .and_then(|m| m.into_runnable())
        .map_err(|e| format!("Could not load {}: {e}", path.display()))
}

fn embed(model: &Model, ids: &[i64]) -> Result<Vec<f32>, String> {
    let n = ids.len();
    let tensor = |values: Vec<i64>| -> Result<TValue, String> {
        Ok(tract_ndarray::Array2::from_shape_vec((1, n), values)
            .map_err(|e| e.to_string())?
            .into_tensor()
            .into())
    };
    // Feed inputs by name: the exported graph orders them input_ids, attention_mask,
    // token_type_ids, but nothing guarantees that.
    let mut inputs = TVec::new();
    for outlet in model.model().input_outlets().map_err(|e| e.to_string())? {
        let name = &model.model().node(outlet.node).name;
        inputs.push(match name.as_str() {
            "input_ids" => tensor(ids.to_vec())?,
            "attention_mask" => tensor(vec![1; n])?,
            "token_type_ids" => tensor(vec![0; n])?,
            other => return Err(format!("Unexpected model input {other}")),
        });
    }
    let outputs = model.run(inputs).map_err(|e| e.to_string())?;
    let hidden = outputs[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
    let shape = hidden.shape();
    if shape.len() != 3 || shape[1] != n {
        return Err(format!("Unexpected model output shape {shape:?}"));
    }
    // mean_pooling (sums in f64 like JS numbers, stored as f32), then normalize(2, -1).
    let dim = shape[2];
    let mut pooled: Vec<f32> = (0..dim)
        .map(|k| ((0..n).map(|j| hidden[[0, j, k]] as f64).sum::<f64>() / n as f64) as f32)
        .collect();
    let norm = pooled.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>().sqrt();
    if norm > 0.0 {
        for v in &mut pooled {
            *v = ((*v as f64) / norm) as f32;
        }
    }
    Ok(pooled)
}

/// Transformers.js's BertNormalizer + BertPreTokenizer + WordPiece, as configured by
/// the model's tokenizer.json (clean_text, chinese chars, lowercase + strip accents).
struct Tokenizer {
    vocab: HashMap<String, i64>,
    unk: i64,
    cls: i64,
    sep: i64,
    control: Regex,
    words: Regex,
}

impl Tokenizer {
    fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let config: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let vocab: HashMap<String, i64> = config["model"]["vocab"]
            .as_object()
            .ok_or("tokenizer.json has no vocab")?
            .iter()
            .filter_map(|(k, v)| v.as_i64().map(|id| (k.clone(), id)))
            .collect();
        let id = |t: &str| vocab.get(t).copied().ok_or(format!("vocab lacks {t}"));
        let (unk, cls, sep) = (id("[UNK]")?, id("[CLS]")?, id("[SEP]")?);
        // PUNCTUATION_REGEX from tokenizers.js.
        let punct = r"\p{P}\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E";
        Ok(Self {
            vocab,
            unk,
            cls,
            sep,
            control: Regex::new(CONTROL_CHARS).unwrap(),
            words: Regex::new(&format!(r"[^\s{punct}]+|[{punct}]")).unwrap(),
        })
    }

    fn normalize(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut buf = [0u8; 4];
        for c in text.chars() {
            // _clean_text: drop NUL, U+FFFD and control chars (but not \t \n \r).
            if c == '\0' || c == '\u{FFFD}' {
                continue;
            }
            if !matches!(c, '\t' | '\n' | '\r') && self.control.is_match(c.encode_utf8(&mut buf)) {
                continue;
            }
            if c.is_whitespace() {
                out.push(' ');
            } else if is_chinese_char(c) {
                out.push(' ');
                out.push(c);
                out.push(' ');
            } else {
                out.push(c);
            }
        }
        // lowercase, then stripAccents: NFD and drop U+0300..U+036F only.
        out.to_lowercase()
            .nfd()
            .filter(|c| !('\u{300}'..='\u{36F}').contains(c))
            .collect()
    }

    fn encode(&self, text: &str) -> Vec<i64> {
        let normalized = self.normalize(text);
        let mut ids = vec![self.cls];
        for word in self.words.find_iter(normalized.trim()) {
            self.word_piece(word.as_str(), &mut ids);
        }
        ids.push(self.sep);
        ids.truncate(MAX_TOKENS);
        ids
    }

    fn word_piece(&self, word: &str, ids: &mut Vec<i64>) {
        let chars: Vec<char> = word.chars().collect();
        if chars.len() > MAX_CHARS_PER_WORD {
            ids.push(self.unk);
            return;
        }
        let mut pieces = Vec::new();
        let mut start = 0;
        while start < chars.len() {
            let mut end = chars.len();
            let mut found = None;
            while start < end {
                let mut piece: String = chars[start..end].iter().collect();
                if start > 0 {
                    piece.insert_str(0, "##");
                }
                if let Some(id) = self.vocab.get(&piece) {
                    found = Some(*id);
                    break;
                }
                end -= 1;
            }
            match found {
                Some(id) => pieces.push(id),
                None => {
                    ids.push(self.unk);
                    return;
                }
            }
            start = end;
        }
        ids.extend(pieces);
    }
}

/// tokenizers.js reads one UTF-16 unit at a time, so only BMP CJK ranges ever match.
fn is_chinese_char(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokenizer() -> Tokenizer {
        let mut vocab = HashMap::new();
        for (i, t) in ["[UNK]", "[CLS]", "[SEP]", "hello", "world", "un", "##aff", "##able", ",", "cafe", "中"]
            .iter()
            .enumerate()
        {
            vocab.insert(t.to_string(), i as i64);
        }
        let punct = r"\p{P}\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E";
        Tokenizer {
            vocab,
            unk: 0,
            cls: 1,
            sep: 2,
            control: Regex::new(CONTROL_CHARS).unwrap(),
            words: Regex::new(&format!(r"[^\s{punct}]+|[{punct}]")).unwrap(),
        }
    }

    #[test]
    fn bert_tokenizer_matches_transformers_js_rules() {
        let t = tokenizer();
        assert_eq!(t.encode("Hello, World"), vec![1, 3, 8, 4, 2]);
        assert_eq!(t.encode("unaffable"), vec![1, 5, 6, 7, 2]);
        assert_eq!(t.encode("  Café\u{200B}\tzzz "), vec![1, 9, 0, 2]);
        assert_eq!(t.encode("中x"), vec![1, 10, 0, 2]);
        assert_eq!(t.encode(&"hello ".repeat(600)).len(), MAX_TOKENS);
    }
}
