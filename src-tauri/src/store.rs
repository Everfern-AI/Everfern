//! Worker persistence and OS-encrypted cloud browser clones.
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};

static STORE_LOCK: Mutex<()> = Mutex::new(());
static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();

fn exported_root(base: &std::path::Path) -> Option<PathBuf> {
    [base.join("EverFern"), base.join("desktop")].into_iter()
        .filter_map(|path| fs::metadata(path.join("renderer-migration.native")).ok()?.modified().ok().map(|date| (date, path)))
        .max_by_key(|(date, _)| *date).map(|(_, path)| path)
}

pub fn migration_script(app: &AppHandle) -> Result<String, String> {
    let file = root(app)?.join("renderer-migration.native");
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.to_string()),
    };
    if bytes.len() > 40 * 1024 * 1024 || !bytes.starts_with(b"EFDPAPI1") { return Err("Invalid migration snapshot".into()); }
    let values: std::collections::BTreeMap<String, String> = serde_json::from_slice(&protect(&bytes[8..], true)?).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&values).map_err(|e| e.to_string())?;
    Ok(format!("try {{ if (!localStorage.getItem('__ef_electron_migrated_v1')) {{ const snapshot={json}; for (const [key,value] of Object.entries(snapshot)) {{ if (localStorage.getItem(key) === null) localStorage.setItem(key,value); }} localStorage.setItem('__ef_electron_migrated_v1','1'); }} }} catch(e) {{ console.error('Could not restore EverFern migration data'); }}"))
}

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("EF_USER_DATA") { return Ok(path.into()); }
    if let Some(path) = DATA_ROOT.get() { return Ok(path.clone()); }
    let base = app.path().config_dir().map_err(|e| e.to_string())?;
    let bundled = app.path().resource_dir().map(|p| p.join("app/tauri/sidecar/boot.js").is_file()).unwrap_or(false);
    // Older Electron packages used the package name "desktop" for userData.
    // Select the newest successfully exported profile and keep it for this run.
    let selected = exported_root(&base)
        .unwrap_or_else(|| base.join(if cfg!(debug_assertions) && !bundled { "desktop" } else { "EverFern" }));
    let _ = DATA_ROOT.set(selected.clone());
    Ok(DATA_ROOT.get().cloned().unwrap_or(selected))
}

fn recover_statuses(workers: &mut [Value]) -> bool {
    let mut changed = false;
    for worker in workers {
        if worker.get("status").and_then(Value::as_str) == Some("running") {
            worker["status"] = json!("paused");
            changed = true;
        }
    }
    changed
}

pub fn recover_workers(app: &AppHandle) -> Result<(), String> {
    let path = root(app)?.join("workers.json");
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let mut workers: Vec<Value> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if recover_statuses(&mut workers) {
        atomic_write(&path, &serde_json::to_vec_pretty(&workers).map_err(|e| e.to_string())?)?;
    }
    Ok(())
}

fn valid_component(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_scope(scope: &str) -> bool {
    let parts: Vec<_> = scope.split('.').collect();
    match parts.as_slice() {
        [account] => valid_component(account, 64),
        [account, "bb", worker] => valid_component(account, 64) && valid_component(worker, 80),
        [account, "bb", worker, "app", app] => valid_component(account, 64) && valid_component(worker, 80) && valid_component(app, 40),
        _ => false,
    }
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Missing parent directory")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension("pending");
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    // MoveFileEx replaces atomically on Windows, unlike std::fs::rename there.
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))] fs::rename(temp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
pub fn protect(input: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{Security::Cryptography::*, Foundation::LocalFree};
    let source = CRYPT_INTEGER_BLOB { cbData: input.len().try_into().map_err(|_| "Clone too large")?, pbData: input.as_ptr() as *mut u8 };
    let mut result = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if decrypt { CryptUnprotectData(&source, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut result) }
        else { CryptProtectData(&source, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut result) }
    };
    if ok == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    let bytes = unsafe { std::slice::from_raw_parts(result.pbData, result.cbData as usize).to_vec() };
    unsafe { LocalFree(result.pbData as _); }
    Ok(bytes)
}
#[cfg(not(windows))]
pub fn protect(_: &[u8], _: bool) -> Result<Vec<u8>, String> { Err("Native encrypted storage is not configured for this operating system".into()) }

#[tauri::command]
pub fn ef_worker_store(app: AppHandle, operation: String, worker: Option<Value>, id: Option<String>) -> Result<Value, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "Worker store lock failed")?;
    let path = root(&app)?.join("workers.json");
    let mut workers: Vec<Value> = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read worker store: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    match operation.as_str() {
        "list" => return Ok(json!(workers)),
        "save" => {
            let worker = worker.ok_or("Missing worker")?;
            let key = worker.get("id").and_then(Value::as_str).ok_or("Missing worker id")?;
            if !valid_component(key, 64) { return Err("Invalid worker id".into()); }
            if let Some(index) = workers.iter().position(|w| w.get("id").and_then(Value::as_str) == Some(key)) { workers[index] = worker; }
            else { workers.push(worker); }
        }
        "delete" => {
            let id = id.ok_or("Missing worker id")?;
            if !valid_component(&id, 64) { return Err("Invalid worker id".into()); }
            workers.retain(|w| w.get("id").and_then(Value::as_str) != Some(&id));
        }
        _ => return Err("Unknown worker operation".into()),
    }
    atomic_write(&path, &serde_json::to_vec_pretty(&workers).map_err(|e| e.to_string())?)?;
    Ok(json!({"success": true}))
}

#[tauri::command]
pub fn ef_browser_state(app: AppHandle, scope: String, value: Option<Value>) -> Result<Value, String> {
    if !valid_scope(&scope) { return Err("Invalid browser scope".into()); }
    let _guard = STORE_LOCK.lock().map_err(|_| "Browser store lock failed")?;
    // Keep Electron clones intact; native clones have an explicit format header.
    let path = root(&app)?.join("cloud-browser").join(format!("{scope}.native"));
    if let Some(value) = value {
        let id = value.get("id").and_then(Value::as_str).ok_or("Missing clone id")?;
        let data = value.get("data").and_then(Value::as_str).ok_or("Missing clone data")?;
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) || data.len() > 30 * 1024 * 1024 { return Err("Invalid browser clone".into()); }
        let raw = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        let mut bytes = b"EFDPAPI1".to_vec();
        bytes.extend(protect(&raw, false)?);
        atomic_write(&path, &bytes)?;
        return Ok(json!({"success": true}));
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(e) => return Err(e.to_string()),
    };
    if !bytes.starts_with(b"EFDPAPI1") { return Err("Unknown browser clone format".into()); }
    serde_json::from_slice(&protect(&bytes[8..], true)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_saved_data_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("workers.json");
        atomic_write(&file, b"old").unwrap();
        atomic_write(&file, b"new").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        assert!(!file.with_extension("pending").exists());
    }
    #[test]
    fn finds_legacy_desktop_profile_and_prefers_latest_export() {
        let directory = tempfile::tempdir().unwrap();
        assert!(exported_root(directory.path()).is_none());
        let legacy = directory.path().join("desktop");
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join("renderer-migration.native"), b"test").unwrap();
        assert_eq!(exported_root(directory.path()), Some(legacy));
        let modern = directory.path().join("EverFern");
        fs::create_dir(&modern).unwrap();
        let file = fs::File::create(modern.join("renderer-migration.native")).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))).unwrap();
        assert_eq!(exported_root(directory.path()), Some(modern));
    }
    #[test]
    fn interrupted_runs_resume_as_paused() {
        let mut workers = vec![json!({"id": "one", "status": "running"}), json!({"id": "two", "status": "idle"})];
        assert!(recover_statuses(&mut workers));
        assert_eq!(workers[0]["status"], "paused");
        assert_eq!(workers[1]["status"], "idle");
        assert!(!recover_statuses(&mut workers));
    }
    #[test]
    fn rejects_scope_traversal() {
        for value in ["../secret", "a.bb../x", "", "a/b", "a.bb.worker.app..."] { assert!(!valid_scope(value)); }
        assert!(valid_scope("account.bb.worker-1.app.chrome"));
    }
    #[test]
    #[cfg(windows)]
    fn encryption_roundtrip() {
        let raw = b"private browser cookies";
        let encrypted = protect(raw, false).unwrap();
        assert_ne!(encrypted, raw);
        assert_eq!(protect(&encrypted, true).unwrap(), raw);
        assert!(protect(b"corrupt data", true).is_err());
    }
}
