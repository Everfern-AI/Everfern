use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use std::sync::Mutex;
use sha2::{Digest, Sha256};

static READY: Mutex<Option<(tauri_plugin_updater::Update, std::path::PathBuf, Vec<u8>)>> = Mutex::new(None);

fn verified_bytes(path: &std::path::Path, hash: &[u8]) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if &Sha256::digest(&bytes)[..] != hash { return Err("The cached update changed; download it again".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn ef_update(app: AppHandle, install: bool) -> Result<Value, String> {
    if install {
        let cached = READY.lock().map_err(|_| "Update lock failed")?.take();
        let (update, path, hash) = cached.ok_or("Check for updates and download the update first")?;
        let bytes = verified_bytes(&path, &hash)?;
        update.install(bytes).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(path);
        app.restart();
    }
    let key = option_env!("EVERFERN_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
        .ok_or("This build has no updater verification key configured")?;
    let updater = app.updater_builder().pubkey(key)
        .endpoints(vec!["https://github.com/Everfern-AI/Everfern/releases/latest/download/latest.json".parse().map_err(|_| "Invalid update endpoint")?])
        .map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(json!({"hasUpdate": false}));
    };
    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();
    {
        let _ = app.emit("update-available", json!({"version": version}));
        let mut downloaded: u64 = 0;
        let progress_app = app.clone();
        let bytes = update.download(move |chunk, total| {
            downloaded += chunk as u64;
            let percent = total.filter(|total| *total > 0).map(|total| downloaded as f64 * 100.0 / total as f64).unwrap_or(0.0);
            let _ = progress_app.emit("download-progress", json!({"percent": percent}));
        }, || {}).await.map_err(|e| e.to_string())?;
        let path = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates/pending-update.bin");
        std::fs::create_dir_all(path.parent().ok_or("Missing update cache directory")?).map_err(|e| e.to_string())?;
        let hash = Sha256::digest(&bytes).to_vec();
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        drop(bytes);
        *READY.lock().map_err(|_| "Update lock failed")? = Some((update, path, hash));
        let _ = app.emit("update-downloaded", json!({"version": version}));
    }
    Ok(json!({"hasUpdate": true, "latestVersion": version, "notes": notes}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_an_installer_modified_after_signature_verification() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("update.bin");
        std::fs::write(&path, b"verified installer").unwrap();
        let hash = Sha256::digest(b"verified installer");
        assert_eq!(verified_bytes(&path, &hash).unwrap(), b"verified installer");
        std::fs::write(&path, b"modified installer").unwrap();
        assert!(verified_bytes(&path, &hash).is_err());
    }
}
