use std::{env, fs, path::PathBuf};

/// Builds the script injected into the webview: the renderer bridge with the
/// compiled Electron preload spliced in, so React code keeps using
/// `window.electronAPI` unchanged.
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let bridge_path = root.join("tauri/bridge/renderer-bridge.js");
    let preload_path = root.join("dist-electron/preload/preload.js");
    println!("cargo:rerun-if-changed={}", bridge_path.display());
    println!("cargo:rerun-if-changed={}", preload_path.display());

    let bridge = fs::read_to_string(&bridge_path).expect("tauri/bridge/renderer-bridge.js missing");
    let preload = fs::read_to_string(&preload_path)
        .expect("dist-electron/preload/preload.js missing: run `npm run build:electron-ts` first");
    assert!(bridge.contains("/*__EF_PRELOAD__*/"), "preload marker missing from renderer-bridge.js");
    let out = bridge.replace("/*__EF_PRELOAD__*/", &preload);
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("bridge.js"), out).unwrap();

    tauri_build::build()
}
