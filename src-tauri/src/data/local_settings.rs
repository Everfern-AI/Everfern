use serde_json::{json, Value};

#[test]
fn model_settings_keep_installed_metadata_and_fit_labels() {
    let model = installed_model(
        &json!({"name":"qwen:7b","size":4294967296u64,"details":{"family":"qwen"}}),
        "ollama",
    )
    .unwrap();
    let model = enrich(model, &json!({"vramGB":8,"ramGB":16}));
    assert_eq!(model["details"]["family"], "qwen");
    assert_eq!(model["quantized_q4_vram_gb"], 4.0);
    assert_eq!(model["predicted_tps"], 67.5);
    assert_eq!(model["smoothRating"], "Ultra Smooth");
    let hardware = json!({"vramGB":0,"ramGB":16});
    let models = recommendations(&hardware);
    assert_eq!(models.len(), 9);
    assert_eq!(models[0]["status"], "cpu_offload");
    assert_eq!(models[0]["smoothRating"], "Moderate (CPU Offload)");
    assert_eq!(models[8]["tags"], json!(["gemma2:9b"]));
}

fn enrich(mut model: Value, hardware: &Value) -> Value {
    let vram = hardware["vramGB"].as_f64().unwrap_or_default();
    let ram = hardware["ramGB"]
        .as_f64()
        .filter(|ram| *ram != 0.0)
        .unwrap_or(16.0);
    let q4 = model["quantized_q4_vram_gb"]
        .as_f64()
        .filter(|size| *size != 0.0)
        .unwrap_or(4.0);
    let min_ram = model["min_ram_gb"].as_f64().unwrap_or(4.0);
    let bandwidth = if vram >= 8.0 {
        360.0
    } else if vram >= 4.0 {
        240.0
    } else {
        45.0
    };
    let (status, badge, tps) = if vram >= q4 {
        ("full_gpu", "Full GPU", bandwidth / q4.max(0.5) * 0.75)
    } else if vram + ram * 0.5 >= q4 && ram >= min_ram {
        ("cpu_offload", "CPU Offload", 35.0 / q4.max(0.5) * 0.65)
    } else {
        ("exceeds_specs", "Cloud Required", 0.0)
    };
    let tps = round(tps, 10.0);
    let rating = if tps >= 30.0 {
        "Ultra Smooth"
    } else if tps >= 20.0 {
        "Smooth & Fast"
    } else if tps >= 10.0 {
        "Good Performance"
    } else if tps > 0.0 {
        "Moderate (CPU Offload)"
    } else {
        "Slow (CPU Offload)"
    };
    model["status"] = json!(status);
    model["badge"] = json!(badge);
    model["predicted_tps"] = json!(tps);
    model["smoothRating"] = json!(rating);
    model["isSmooth"] = json!(tps >= 18.0);
    model["isRunnable"] = json!(status != "exceeds_specs" && vram + ram * 0.5 >= q4);
    model["fits_in_vram"] = json!(vram >= q4);
    model["fits_in_ram"] = json!(ram >= min_ram);
    model
}

fn round(value: f64, scale: f64) -> f64 {
    (value * scale).round() / scale
}

fn installed_model(record: &Value, provider: &str) -> Option<Value> {
    static PARAMS: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"([0-9]+(?:\.[0-9]+)?)[bB]").unwrap());
    static SIZE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"[0-9]+(?:\.[0-9]+)?").unwrap());
    let ollama = provider == "ollama";
    let primary = if ollama {
        &record["name"]
    } else {
        &record["id"]
    };
    let secondary = if ollama {
        &record["model"]
    } else {
        &record["name"]
    };
    let id = record
        .as_str()
        .filter(|_| !ollama)
        .or_else(|| primary.as_str().filter(|id| !id.is_empty()))
        .or_else(|| secondary.as_str())
        .filter(|id| !id.is_empty())?;
    let bytes = record["size"].as_f64().filter(|size| *size != 0.0);
    let params = PARAMS
        .captures(id)
        .and_then(|m| m[1].parse::<f64>().ok())
        .or_else(|| {
            if !ollama {
                return None;
            }
            if let Some(size) = record["details"]["parameter_size"]
                .as_str()
                .filter(|size| !size.is_empty())
            {
                return SIZE.find(size).and_then(|m| m.as_str().parse().ok());
            }
            bytes.map(|size| round(size / 1_073_741_824.0 / 0.65, 10.0).max(1.0))
        })
        .unwrap_or(7.0);
    let size = round(
        bytes.map_or(params * 0.65, |size| size / 1_073_741_824.0),
        100.0,
    );
    let (name, q4, category) = if ollama {
        (id, size.max(params * 0.55), "Installed Local Model")
    } else {
        let name = id
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or(id);
        let category = if provider == "llamacpp" {
            "llama.cpp Loaded Model"
        } else {
            "LM Studio Loaded Model"
        };
        (name, params * 0.58 + 0.5, category)
    };
    let mut model = json!({
        "id":id,"model_id":id,"name":name,"params_b":params,
        "quantized_q4_vram_gb":round(q4,100.0),"raw_fp16_vram_gb":round(params*2.0,100.0),
        "min_ram_gb":params.mul_add(0.0, (params * 1.1).round()).max(4.0),
        "category":category,"tags":[id]
    });
    if ollama {
        model["size_gb"] = json!(size);
        for key in ["details", "modified_at"] {
            if let Some(value) = record.get(key) {
                model[key] = value.clone();
            }
        }
    }
    Some(model)
}

fn recommendations(hardware: &Value) -> Vec<Value> {
    let models = json!([
    { "model_id": "Qwen/Qwen2.5-Coder-7B-Instruct", "name": "Qwen 2.5 Coder 7B", "params_b": 7.6, "raw_fp16_vram_gb": 15.22, "quantized_q4_vram_gb": 5.08, "min_ram_gb": 8, "category": "Flagship Coding Specialist", "tags": ["qwen2.5-coder:7b", "qwen2.5-coder"] },
          { "model_id": "meta-llama/Llama-3.2-3B-Instruct", "name": "Llama 3.2 3B", "params_b": 3.2, "raw_fp16_vram_gb": 6.42, "quantized_q4_vram_gb": 2.22, "min_ram_gb": 6, "category": "Compact / High Speed", "tags": ["llama3.2:3b", "llama3.2"] },
          { "model_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", "name": "DeepSeek R1 7B", "params_b": 7.6, "raw_fp16_vram_gb": 15.22, "quantized_q4_vram_gb": 5.15, "min_ram_gb": 8, "category": "Advanced Reasoning Specialist", "tags": ["deepseek-r1:7b", "deepseek-r1"] },
          { "model_id": "mistralai/Mistral-7B-Instruct-v0.3", "name": "Mistral 7B v0.3", "params_b": 7.2, "raw_fp16_vram_gb": 14.50, "quantized_q4_vram_gb": 4.16, "min_ram_gb": 8, "category": "Fast Instruction & Reasoning", "tags": ["mistral:7b", "mistral"] },
          { "model_id": "Qwen/Qwen2.5-Coder-1.5B-Instruct", "name": "Qwen 2.5 Coder 1.5B", "params_b": 1.5, "raw_fp16_vram_gb": 3.08, "quantized_q4_vram_gb": 1.08, "min_ram_gb": 4, "category": "Ultra-Fast Lightweight Coding", "tags": ["qwen2.5-coder:1.5b"] },
          { "model_id": "meta-llama/Llama-3.2-1B-Instruct", "name": "Llama 3.2 1B", "params_b": 1.2, "raw_fp16_vram_gb": 2.47, "quantized_q4_vram_gb": 0.88, "min_ram_gb": 4, "category": "Ultra-Lightweight Edge", "tags": ["llama3.2:1b"] },
          { "model_id": "Qwen/Qwen2.5-Coder-14B-Instruct", "name": "Qwen 2.5 Coder 14B", "params_b": 14.7, "raw_fp16_vram_gb": 29.40, "quantized_q4_vram_gb": 9.75, "min_ram_gb": 16, "category": "Heavy Coding & Autonomous", "tags": ["qwen2.5-coder:14b"] },
          { "model_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", "name": "DeepSeek R1 14B", "params_b": 14.7, "raw_fp16_vram_gb": 29.40, "quantized_q4_vram_gb": 9.80, "min_ram_gb": 16, "category": "Deep Math & Logic Reasoning", "tags": ["deepseek-r1:14b"] },
          { "model_id": "google/gemma-2-9b-it", "name": "Gemma 2 9B", "params_b": 9.2, "raw_fp16_vram_gb": 18.48, "quantized_q4_vram_gb": 6.12, "min_ram_gb": 12, "category": "High Accuracy General Purpose", "tags": ["gemma2:9b"] }
        ]);
    models
        .as_array()
        .unwrap()
        .iter()
        .cloned()
        .map(|model| enrich(model, hardware))
        .collect()
}

pub(super) async fn list(params: Option<Value>) -> Value {
    let params = params.unwrap_or_default();
    let provider = params["provider"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("ollama")
        .to_lowercase();
    let default_url = match provider.as_str() {
        "llamacpp" => "http://localhost:8080/v1",
        "lmstudio" => "http://localhost:1234/v1",
        _ => "http://localhost:11434",
    };
    let base = params["baseUrl"]
        .as_str()
        .map(str::trim)
        .filter(|base| !base.is_empty())
        .map(|base| base.strip_suffix('/').unwrap_or(base))
        .unwrap_or(default_url);
    let mut hardware = super::host_hardware(false).await;
    for field in ["cpuSpeed", "driverVersion", "gpuTemp"] {
        if let Some(fields) = hardware.as_object_mut() {
            fields.shift_remove(field);
        }
    }
    let mut error = String::new();
    let mut running = false;
    let mut installed = Vec::new();
    if matches!(provider.as_str(), "ollama" | "lmstudio" | "llamacpp") {
        match super::local_model_response(&json!({"provider":provider,"baseUrl":base})).await {
            Ok(data) => {
                let records = if provider == "ollama" {
                    data["models"].as_array()
                } else {
                    data["data"]
                        .as_array()
                        .or_else(|| data["models"].as_array())
                        .or_else(|| data.as_array())
                };
                running = if provider == "ollama" {
                    records.is_some()
                } else {
                    records.is_some_and(|models| !models.is_empty())
                        || [&data["data"], &data["models"]].into_iter().any(|value| {
                            !value.is_null()
                                && value != false
                                && value != ""
                                && value.as_f64() != Some(0.0)
                        })
                };
                installed.extend(
                    records
                        .into_iter()
                        .flatten()
                        .filter_map(|record| installed_model(record, &provider))
                        .map(|model| enrich(model, &hardware)),
                );
            }
            Err(_) if provider == "ollama" => {
                error = format!("Could not connect to Ollama at {base}. Ensure Ollama is running.");
            }
            Err(_) => {
                let name = if provider == "llamacpp" {
                    "llama.cpp"
                } else {
                    "LM Studio"
                };
                error = format!(
                    "Could not reach {name} at {base}. Start the local server and load a model."
                );
            }
        }
    }
    let recommended = if provider == "llamacpp" {
        Vec::new()
    } else {
        recommendations(&hardware)
    };
    let mut result = json!({"success":running,"running":running,"provider":provider,"baseUrl":base,
        "hardware":hardware,"installedModels":installed,"recommendedModels":recommended});
    if !running {
        result["error"] = json!(error);
    }
    result
}
