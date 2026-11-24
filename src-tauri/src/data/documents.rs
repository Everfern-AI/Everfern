use quick_xml::{events::Event, Reader};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::{
    fs::File,
    io::{BufReader, Read},
};

const OCR_PACKAGES: &[&str] = &[
    "ocrmypdf",
    "pytesseract",
    "pillow",
    "pymupdf",
    "paddleocr",
    "paddlepaddle",
    "openvino",
    "numpy",
    "opencv-python-headless",
];

#[tauri::command]
pub async fn ef_ocr_install_packages(app: tauri::AppHandle) -> Value {
    use tauri::Emitter;
    static INSTALL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = INSTALL.lock().await;
    let progress = |percent, step, detail: &str| {
        let _ = app.emit_to(
            "main",
            "system:ocr-progress",
            json!({
                "percent": percent, "step": step, "detail": detail,
            }),
        );
    };
    let result = async {
        progress(4, "Bootstrap", "Preparing the OCR Python environment...");
        bootstrap_ocr_venv().await?;
        progress(18, "Preparing", "Preparing pip in the OCR environment...");
        prepare_ocr_pip().await?;
        let mut failed = Vec::new();
        let total = OCR_PACKAGES.len();
        for (index, package) in OCR_PACKAGES.iter().enumerate() {
            let percent = |index| 30 + (68 * index + total / 2) / total;
            progress(
                percent(index),
                "Installing",
                &format!("Installing {package} ({} of {total})...", index + 1),
            );
            let status = match install_ocr_package(package).await {
                Ok(()) => "installed",
                Err(error) => {
                    eprintln!("[everfern] {error}");
                    failed.push(*package);
                    "failed"
                }
            };
            progress(
                percent(index + 1),
                "Installing",
                &format!("{package} {status}"),
            );
        }
        if failed.len() == total {
            return Err(format!(
                "OCR dependency install failed: {}",
                failed.join(", ")
            ));
        }
        progress(
            96,
            "Checking Tesseract",
            "Checking system Tesseract OCR engine...",
        );
        #[cfg(windows)]
        if let Err(error) = setup_tesseract(&progress).await {
            eprintln!("[everfern] Tesseract setup failed: {error}");
        }
        progress(100, "Done", "OCR dependencies ready.");
        Ok(if failed.is_empty() {
            "OCR dependencies ready.".to_owned()
        } else {
            format!(
                "OCR dependencies installed ({}/{total}). Skipped: {}",
                total - failed.len(),
                failed.join(", ")
            )
        })
    }
    .await;
    match result {
        Ok(message) => json!({"ok":true,"message":message}),
        Err(message) => json!({"ok":false,"message":message}),
    }
}

#[cfg(windows)]
async fn setup_tesseract(progress: &impl Fn(usize, &'static str, &str)) -> Result<(), String> {
    let home = super::home()?;
    let program_files = |key, default| {
        std::env::var_os(key)
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(default))
            .join("Tesseract-OCR/tesseract.exe")
    };
    if [
        program_files("ProgramFiles", r"C:\Program Files"),
        program_files("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        home.join(".everfern/tesseract/tesseract.exe"),
        home.join("AppData/Local/Programs/Tesseract-OCR/tesseract.exe"),
    ]
    .iter()
    .any(|path| path.is_file())
    {
        return Ok(());
    }
    progress(97, "Tesseract", "Downloading Tesseract OCR installer...");
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get("https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe")
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|error| error.to_string())?;
    let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = temporary.path().join("tesseract-setup.exe");
    let mut file = File::create(&path).map_err(|error| error.to_string())?;
    let mut size = 0;
    use std::io::Write;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        size += chunk.len();
        if size > 256 * 1024 * 1024 {
            return Err("Tesseract installer exceeds the download limit".into());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
    }
    drop(file);
    if size <= 10 * 1024 * 1024 {
        return Err("Tesseract installer download is incomplete".into());
    }
    progress(98, "Tesseract", "Running Tesseract installer...");
    let mut command = tokio::process::Command::new(path);
    command
        .creation_flags(0x0800_0000)
        .kill_on_drop(true)
        .args(["/VERYSILENT", "/NORESTART"]);
    let status = tokio::time::timeout(std::time::Duration::from_secs(300), command.status())
        .await
        .map_err(|_| "Tesseract setup timed out".to_owned())?
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!("Tesseract setup exited with {status}"));
    }
    Ok(())
}

pub async fn prepare_ocr_pip() -> Result<(), String> {
    let venv = super::home()?.join(".everfern").join("ocr-venv");
    let python = venv.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    async fn run(python: &std::path::Path, args: &[&str], seconds: u64) -> bool {
        let mut command = tokio::process::Command::new(python);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        command.kill_on_drop(true).args(args);
        matches!(tokio::time::timeout(std::time::Duration::from_secs(seconds), command.output()).await,
            Ok(Ok(output)) if output.status.success())
    }
    let check = ["-m", "pip", "--version"];
    if !run(&python, &check, 15).await {
        run(&python, &["-m", "ensurepip", "--default-pip"], 60).await;
        if !run(&python, &check, 15).await {
            // Keep the existing HTTPS bootstrap source and use a private temporary directory.
            let bootstrap = async {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(60))
                    .build()
                    .ok()?;
                let response = client
                    .get("https://bootstrap.pypa.io/get-pip.py")
                    .send()
                    .await
                    .ok()?
                    .error_for_status()
                    .ok()?;
                let script = response.bytes().await.ok()?;
                let directory = tempfile::tempdir().ok()?;
                let path = directory.path().join("get-pip.py");
                std::fs::write(&path, script).ok()?;
                run(&python, &[path.to_str()?, "--no-warn-script-location"], 120).await;
                Some(())
            };
            bootstrap.await;
            if !run(&python, &check, 15).await {
                return Err("The OCR environment exists, but pip could not be installed (ensurepip and get-pip.py failed). Please reinstall Python with pip enabled from python.org.".into());
            }
        }
    }
    if !run(&python, &["-m", "pip", "install", "--upgrade", "pip"], 120).await {
        eprintln!("[everfern] OCR pip upgrade failed; continuing with the installed version");
    }
    Ok(())
}

pub async fn install_ocr_package(package: &str) -> Result<(), String> {
    if !matches!(
        package,
        "ocrmypdf"
            | "pytesseract"
            | "pillow"
            | "pymupdf"
            | "paddleocr"
            | "paddlepaddle"
            | "openvino"
            | "numpy"
            | "opencv-python-headless"
    ) {
        return Err("Unknown OCR dependency".into());
    }
    let venv = super::home()?.join(".everfern").join("ocr-venv");
    let python = venv.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    let mut command = tokio::process::Command::new(python);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
        .kill_on_drop(true)
        .args(["-m", "pip", "install", "--no-input", package]);
    let result = tokio::time::timeout(std::time::Duration::from_secs(1200), command.output())
        .await
        .map_err(|_| format!("Installing {package} timed out"))?
        .map_err(|error| error.to_string())?;
    if result.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&result.stderr);
    Err(format!(
        "Installing {package} failed ({}): {}",
        result.status,
        stderr.trim()
    ))
}

pub async fn bootstrap_ocr_venv() -> Result<(), String> {
    let directory = super::home()?.join(".everfern").join("ocr-venv");
    let python = directory.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    if python.is_file() {
        return Ok(());
    }
    let candidates: &[(&str, &[&str])] = if cfg!(windows) {
        &[("py", &["-3"]), ("python", &[])]
    } else {
        &[("python3", &[]), ("python", &[])]
    };
    for (program, args) in candidates {
        let mut probe = tokio::process::Command::new(program);
        #[cfg(windows)]
        probe.creation_flags(0x0800_0000);
        probe
            .kill_on_drop(true)
            .args(*args)
            .args(["-c", "import sys;print(sys.executable)"]);
        let Ok(Ok(output)) =
            tokio::time::timeout(std::time::Duration::from_secs(15), probe.output()).await
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let Some(executable) = stdout.trim().lines().next() else {
            continue;
        };
        let mut create = tokio::process::Command::new(executable);
        #[cfg(windows)]
        create.creation_flags(0x0800_0000);
        create
            .kill_on_drop(true)
            .args(["-m", "venv"])
            .arg(&directory);
        let output = tokio::time::timeout(std::time::Duration::from_secs(120), create.output())
            .await
            .map_err(|_| "OCR environment creation timed out".to_string())?
            .map_err(|error| error.to_string())?;
        return if output.status.success() && python.is_file() {
            Ok(())
        } else {
            Err(format!(
                "Failed to create OCR venv: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        };
    }
    Err("No Python found to bootstrap the OCR environment. Install Python 3.9+ first (getpython.org).".into())
}

#[tauri::command]
pub async fn ef_ocr_pdf(params: Option<Value>) -> Result<Value, String> {
    let params = params.unwrap_or_default();
    let Some(path) = params["pdfPath"].as_str().filter(|path| !path.is_empty()) else {
        return Ok(
            json!({"status":"error","text":"","engine":"paddleocr","backend":"auto","error":"No PDF path provided."}),
        );
    };
    let engine = match params["engine"].as_str() {
        Some(engine @ ("tesseract" | "paddleocr" | "paddleocr-vl" | "vision-send")) => engine,
        _ => "ocrmypdf",
    };
    let backend = if params["backend"] == "openvino" {
        "openvino"
    } else {
        "auto"
    };
    let failure = |status, error: &str| json!({"status":status,"text":"","engine":engine,"backend":backend,"error":error});
    let venv = super::home()?.join(".everfern").join("ocr-venv");
    if !ocr_ready(&venv) {
        return Ok(if params["installIfMissing"] == true {
            Value::Null
        } else {
            failure("skipped", "OCR environment not installed.")
        });
    }
    if !std::path::Path::new(path).exists() {
        return Ok(failure("error", "PDF not found."));
    }
    let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
    let mut command = ocr_command(&venv, temporary.path())?;
    command.arg(path).arg(engine).arg(backend);
    let output =
        match tokio::time::timeout(std::time::Duration::from_secs(300), command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => return Ok(failure("error", &error.to_string())),
            Err(_) => return Ok(failure("error", "OCR timed out.")),
        };
    Ok(ocr_result(&output.stdout, &output.stderr, engine, backend))
}

fn ocr_result(stdout: &[u8], stderr: &[u8], engine: &str, backend: &str) -> Value {
    let stdout = String::from_utf8_lossy(stdout);
    let result =
        |status, text| json!({"status":status,"text":text,"engine":engine,"backend":backend});
    let failure = |error: &str| {
        let mut value = result("error", "");
        value["error"] = json!(error);
        value
    };
    let Some(marker) = stdout
        .lines()
        .rev()
        .find(|line| line.starts_with("[EVERFERN_OCR"))
    else {
        let stderr = String::from_utf8_lossy(stderr);
        let detail = if !stderr.is_empty() {
            stderr.as_ref()
        } else {
            stdout.as_ref()
        }
        .trim();
        let tail: String = detail
            .chars()
            .rev()
            .take(1000)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return failure(if tail.is_empty() {
            "OCR produced no result."
        } else {
            &tail
        });
    };
    if let Some(error) = marker.strip_prefix("[EVERFERN_OCR_ERROR") {
        return failure(error.strip_prefix(']').unwrap_or(error).trim());
    }
    if marker.starts_with("[EVERFERN_OCR_NO_TEXT") {
        return result("no_text", "");
    }
    static HEADER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^\[EVERFERN_OCR\|[^|]+\|[^|]+\|\d+\]\s?").unwrap());
    let payload = HEADER.replace(marker, "");
    let text = payload.trim();
    json!({"status":if text.is_empty() {"no_text"} else {"ok"},"text":text,"engine":engine,"backend":backend})
}

#[cfg(test)]
#[test]
fn ocr_result_handles_runner_markers() {
    let parse = |stdout: &str, stderr: &str| {
        ocr_result(stdout.as_bytes(), stderr.as_bytes(), "paddleocr", "auto")
    };
    assert_eq!(
        parse(
            "model startup\r\n[EVERFERN_OCR|paddleocr|auto|1]  Hello world\r\n",
            ""
        ),
        json!({"status":"ok","text":"Hello world","engine":"paddleocr","backend":"auto"})
    );
    assert_eq!(
        parse("[EVERFERN_OCR_NO_TEXT|paddleocr|auto|1]\n", "")["status"],
        "no_text"
    );
    assert_eq!(
        parse("[EVERFERN_OCR_ERROR] Failed [page 1]\n", "")["error"],
        "Failed [page 1]"
    );
    assert_eq!(
        parse("", "dependency missing")["error"],
        "dependency missing"
    );
}

fn ocr_command(
    venv: &std::path::Path,
    directory: &std::path::Path,
) -> Result<tokio::process::Command, String> {
    let script = directory.join("ocr_pdf.py");
    std::fs::write(&script, include_str!("../../../main/ocr/ocr_pdf.py"))
        .map_err(|error| error.to_string())?;
    let python = venv.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    let mut command = tokio::process::Command::new(python);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command.kill_on_drop(true).arg(script);
    Ok(command)
}

#[tauri::command]
pub async fn ef_pdf_pages(params: Option<Value>) -> Result<Value, String> {
    let params = params.unwrap_or_default();
    let failure = |error: String| {
        json!({
            "ok": false, "pages": [], "totalPages": 0, "rendered": 0, "error": error
        })
    };
    let Some(path) = params["pdfPath"].as_str().filter(|path| !path.is_empty()) else {
        return Ok(failure("No PDF path provided.".into()));
    };
    let venv = super::home()?.join(".everfern").join("ocr-venv");
    if !ocr_ready(&venv) {
        return Ok(if params["installIfMissing"] == true {
            Value::Null
        } else {
            failure("OCR environment not installed.".into())
        });
    }
    let max_pages = params["maxPages"]
        .as_i64()
        .filter(|count| *count != 0)
        .unwrap_or(30);
    Ok(render_pdf_pages(&venv, path, max_pages)
        .await
        .unwrap_or_else(failure))
}

async fn render_pdf_pages(
    venv: &std::path::Path,
    path: &str,
    max_pages: i64,
) -> Result<Value, String> {
    use base64::Engine;
    if !std::path::Path::new(path).exists() {
        return Err("PDF not found.".into());
    }
    let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
    let mut command = ocr_command(venv, temporary.path())?;
    command
        .arg("render")
        .arg(path)
        .arg(temporary.path())
        .arg(max_pages.to_string());
    let output = tokio::time::timeout(std::time::Duration::from_secs(180), command.output())
        .await
        .map_err(|_| "PDF rendering timed out.".to_string())?
        .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let marker = stdout
        .lines()
        .rev()
        .find(|line| line.starts_with("[EVERFERN_RENDER"));
    let counts = match marker {
        Some(marker) if marker.contains("ERROR") => return Err(marker.into()),
        Some(marker) => marker
            .trim_end_matches(']')
            .split('|')
            .skip(1)
            .collect::<Vec<_>>(),
        None => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if !stderr.is_empty() {
                stderr.as_ref()
            } else {
                stdout.as_ref()
            }
            .trim();
            let tail: String = detail
                .chars()
                .rev()
                .take(800)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            return Err(if tail.is_empty() {
                "Render produced no result.".into()
            } else {
                tail
            });
        }
    };
    let count = |index| {
        counts
            .get(index)
            .and_then(|value: &&str| value.parse::<u64>().ok())
            .unwrap_or(0)
    };
    let mut files = std::fs::read_dir(temporary.path())
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    files.sort_by_key(|file| file.file_name());
    let mut pages = Vec::new();
    for file in files
        .into_iter()
        .filter(|file| file.path().extension().is_some_and(|ext| ext == "png"))
    {
        let bytes = std::fs::read(file.path())
            .map_err(|error| format!("Failed reading rendered pages: {error}"))?;
        let (width, height) = if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG") {
            (
                u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
                u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
            )
        } else {
            (0, 0)
        };
        let base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        pages.push(json!({"name": file.file_name().to_string_lossy(), "base64": format!("data:image/png;base64,{base64}"), "width": width, "height": height}));
    }
    Ok(json!({"ok": true, "pages": pages, "totalPages": count(0), "rendered": count(1)}))
}

pub fn ocr_ready(venv: &std::path::Path) -> bool {
    let python = if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    };
    if !venv.join(python).exists() {
        return false;
    }
    let has_packages = |path| {
        std::fs::read_dir(path)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                ["paddleocr", "fitz", "ocrmypdf", "pil", "paddle"]
                    .iter()
                    .any(|prefix| name.starts_with(prefix))
            })
    };
    if cfg!(windows) {
        has_packages(venv.join("Lib/site-packages"))
    } else {
        std::fs::read_dir(venv.join("lib"))
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| has_packages(entry.path().join("site-packages")))
    }
}

pub fn parse_xlsx(path: Option<&str>) -> Value {
    let result = (|| -> Result<String, String> {
        let path = path
            .filter(|path| !path.is_empty())
            .ok_or("File not found")?;
        let file = File::open(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "File not found".into()
            } else {
                error.to_string()
            }
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        let mut strings = String::new();
        match archive.by_name("xl/sharedStrings.xml") {
            Ok(mut entry) => {
                entry
                    .read_to_string(&mut strings)
                    .map_err(|error| error.to_string())?;
            }
            Err(zip::result::ZipError::FileNotFound) => {}
            Err(error) => return Err(error.to_string()),
        };
        let mut sheet = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .map_err(|_| "Invalid spreadsheet: missing xl/worksheets/sheet1.xml")?
            .read_to_string(&mut sheet)
            .map_err(|error| error.to_string())?;
        Ok(sheet_csv(&sheet, &strings))
    })();
    match result {
        Ok(csv) => json!({"success": true, "csv": csv}),
        Err(error) => json!({"success": false, "error": error}),
    }
}

fn sheet_csv(sheet: &str, strings: &str) -> String {
    static ROW: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<row\b[^>]*>(.*?)</row>").unwrap());
    static CELL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<c\b([^>]*?)(?:/>|>(.*?)</c>)").unwrap());
    static REFERENCE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"\br="([A-Z]{1,3})[0-9]+""#).unwrap());
    static SHARED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\bt="s""#).unwrap());
    static VALUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<v>(.*?)</v>").unwrap());
    static ITEM: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<si\b[^>]*>(.*?)</si>").unwrap());
    static TEXT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<t\b[^>]*>(.*?)</t>").unwrap());
    let shared: Vec<String> = ITEM
        .captures_iter(strings)
        .map(|item| {
            TEXT.captures_iter(&item[1])
                .map(|text| {
                    quick_xml::escape::unescape(&text[1])
                        .unwrap_or_else(|_| text[1].into())
                        .into_owned()
                })
                .collect()
        })
        .collect();
    ROW.captures_iter(sheet)
        .map(|row| {
            let mut cells = Vec::new();
            for cell in CELL.captures_iter(&row[1]) {
                let Some(reference) = REFERENCE.captures(&cell[1]) else {
                    continue;
                };
                let column = reference[1].bytes().fold(0, |value, letter| {
                    value * 26 + usize::from(letter - b'A' + 1)
                }) - 1;
                let raw = cell
                    .get(2)
                    .and_then(|xml| VALUE.captures(xml.as_str()))
                    .and_then(|value| value.get(1))
                    .map_or("", |value| value.as_str());
                let value = if SHARED.is_match(&cell[1]) {
                    raw.trim()
                        .parse::<usize>()
                        .ok()
                        .and_then(|index| shared.get(index))
                        .map_or("", String::as_str)
                } else {
                    raw
                };
                if column >= cells.len() {
                    cells.resize(column + 1, String::new());
                }
                cells[column] = if value.contains([',', '\n', '"']) {
                    format!("\"{}\"", value.replace('"', "\"\""))
                } else {
                    value.to_owned()
                };
            }
            cells.join(",")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
#[test]
fn sheet_csv_preserves_sparse_columns_and_quotes_shared_strings() {
    let strings = r#"<sst><si><r><t>A, </t></r><r><t>&quot;B&quot;</t></r></si></sst>"#;
    let sheet = r#"<worksheet><row><c r="B1" t="s"><v>0</v></c><c r="C1"/><c r="D1"><v>42</v></c></row></worksheet>"#;
    assert_eq!(sheet_csv(sheet, strings), ",\"A, \"\"B\"\"\",,42");
}

pub fn parse_pptx(path: Option<&str>) -> Value {
    let Some(path) = path.filter(|path| !path.is_empty()) else {
        return json!({"success": false, "error": "File not found"});
    };
    let result = (|| -> Result<Vec<Value>, String> {
        let file = File::open(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "File not found".into()
            } else {
                error.to_string()
            }
        })?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        if !archive
            .file_names()
            .flatten()
            .any(|name| name.starts_with("ppt/slides/"))
        {
            return Err("Invalid presentation file: missing ppt/slides directory".into());
        }
        let mut names: Vec<_> = archive
            .file_names()
            .flatten()
            .filter_map(|name| {
                let file = name.strip_prefix("ppt/slides/")?;
                if file.contains('/') || !file.starts_with("slide") || !file.ends_with(".xml") {
                    return None;
                }
                let number = file
                    .chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>();
                Some((number.parse::<u64>().unwrap_or(0), name.into_owned()))
            })
            .collect();
        names.sort();
        names
            .into_iter()
            .map(|(_, name)| {
                let mut entry = archive.by_name(&name).map_err(|error| error.to_string())?;
                let mut xml = String::new();
                entry
                    .read_to_string(&mut xml)
                    .map_err(|error| error.to_string())?;
                Ok(extract_slide(&xml))
            })
            .collect()
    })();
    match result {
        Ok(slides) => json!({"success": true, "slides": slides}),
        Err(error) => json!({"success": false, "error": error}),
    }
}

fn extract_slide(xml: &str) -> Value {
    static SHAPE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<p:sp>(.*?)</p:sp>").unwrap());
    static PARAGRAPH: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?s)<a:p>(.*?)</a:p>").unwrap());
    static TEXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<a:t>([^<]*)</a:t>").unwrap());
    static TYPE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"<p:ph[^>]*?type="([^"]+)""#).unwrap());
    static NAME: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"<p:cNvPr[^>]*?name="([^"]+)""#).unwrap());
    let shapes: Vec<_> = SHAPE
        .captures_iter(xml)
        .filter_map(|shape| {
            let shape = &shape[1];
            let attribute = |pattern: &Regex| {
                pattern
                    .captures(shape)
                    .map(|matches| matches[1].to_ascii_lowercase())
                    .unwrap_or_default()
            };
            let kind = attribute(&TYPE);
            let name = attribute(&NAME);
            let role = if matches!(kind.as_str(), "title" | "ctrtitle") || name.contains("title") {
                "title"
            } else if kind == "subtitle" || name.contains("subtitle") {
                "subtitle"
            } else if matches!(kind.as_str(), "body" | "obj")
                || name.contains("placeholder")
                || name.contains("content")
            {
                "body"
            } else {
                "unknown"
            };
            let paragraphs: Vec<_> = PARAGRAPH
                .captures_iter(shape)
                .filter_map(|paragraph| {
                    let encoded: String = TEXT
                        .captures_iter(&paragraph[1])
                        .map(|text| text[1].to_owned())
                        .collect();
                    let text = quick_xml::escape::unescape(&encoded)
                        .unwrap_or_else(|_| encoded.as_str().into());
                    let text = text.trim();
                    (!text.is_empty()).then(|| text.to_owned())
                })
                .collect();
            (!paragraphs.is_empty()).then_some((role, paragraphs))
        })
        .collect();
    let title = shapes.iter().position(|(role, _)| *role == "title");
    let subtitle = shapes.iter().position(|(role, _)| *role == "subtitle");
    let body = |index: Option<usize>| {
        index
            .map(|index| shapes[index].1.join(" "))
            .unwrap_or_default()
    };
    let mut points = Vec::new();
    for (index, (role, paragraphs)) in shapes.iter().enumerate() {
        if Some(index) != title && Some(index) != subtitle && *role == "body" {
            points.extend(paragraphs.iter());
        }
    }
    for (index, (role, paragraphs)) in shapes.iter().enumerate() {
        if title.is_none() && index > 0
            || title.is_some() && Some(index) != title && Some(index) != subtitle && *role != "body"
        {
            points.extend(paragraphs.iter());
        }
    }
    json!({"title": body(title.or_else(|| (!shapes.is_empty()).then_some(0))), "subtitle": body(subtitle), "points": points})
}

pub fn parse_docx(path: Option<&str>) -> Value {
    let Some(path) = path.filter(|path| !path.is_empty()) else {
        return json!({"success": false, "error": "File not found"});
    };
    let result = (|| -> Result<String, String> {
        let file = File::open(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "File not found".into()
            } else {
                error.to_string()
            }
        })?;
        let mut zip = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        let entry = zip
            .by_name("word/document.xml")
            .map_err(|_| "Invalid document file: missing word/document.xml")?;
        extract_text(BufReader::new(entry))
    })();
    match result {
        Ok(text) => json!({"success": true, "text": text}),
        Err(error) => json!({"success": false, "error": error}),
    }
}

fn extract_text(xml: impl Read) -> Result<String, String> {
    let mut reader = Reader::from_reader(BufReader::new(xml));
    let mut buffer = Vec::new();
    let mut paragraphs = Vec::new();
    let mut paragraph = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| error.to_string())?
        {
            Event::Start(tag) if tag.name().as_ref() == "w:p" => in_paragraph = true,
            Event::Start(tag) if tag.name().as_ref() == "w:t" => in_text = in_paragraph,
            Event::End(tag) if tag.name().as_ref() == "w:t" => in_text = false,
            Event::End(tag) if tag.name().as_ref() == "w:p" => {
                if !paragraph.trim().is_empty() {
                    paragraphs.push(paragraph.trim().to_owned());
                }
                paragraph.clear();
                in_paragraph = false;
            }
            Event::Text(text) if in_text => {
                paragraph.push_str(text.as_ref());
            }
            Event::GeneralRef(reference) if in_text => {
                let reference = reference.as_ref();
                let escaped = format!("&{reference};");
                paragraph.push_str(
                    &quick_xml::escape::unescape(&escaped).map_err(|error| error.to_string())?,
                );
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(paragraphs.join("\n\n"))
}

#[cfg(test)]
#[test]
fn docx_text_joins_runs_and_decodes_entities() {
    let xml = br#"<w:document><w:p><w:r><w:t> Hello &amp; </w:t></w:r><w:r><w:t>&#x1F333; </w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p></w:document>"#;
    assert_eq!(extract_text(xml.as_slice()).unwrap(), "Hello & 🌳\n\nNext");
}
