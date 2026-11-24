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
    assert!(
        bridge.contains("/*__EF_PRELOAD__*/"),
        "preload marker missing from renderer-bridge.js"
    );
    let out = bridge.replace("/*__EF_PRELOAD__*/", &preload);
    let output = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(output.join("bridge.js"), out).unwrap();
    let personality_path = root.join("main/agent/personality-manager.ts");
    println!("cargo:rerun-if-changed={}", personality_path.display());
    let personality = fs::read_to_string(personality_path).expect("personality defaults missing");
    for (name, filename) in [
        ("DEFAULT_SOUL", "default-soul.md"),
        ("DEFAULT_AGENTS", "default-agents.md"),
    ] {
        let (_, body) = personality
            .split_once(&format!("const {name} = `"))
            .expect("personality template missing");
        let (template, _) = body
            .split_once("`;")
            .expect("personality template terminator missing");
        fs::write(output.join(filename), template.replace("\r\n", "\n")).unwrap();
    }
    let providers = root.join("dist-electron/main/lib/providers.js");
    println!("cargo:rerun-if-changed={}", providers.display());
    let catalog = std::process::Command::new("node")
        .current_dir(&root)
        .args(["-e", r#"
            const { PROVIDER_REGISTRY, getModelsForProvider, formatModelName, getAllModelsFlat, CLOUD_MODEL_MAP, DEFAULT_CHAT_MODELS } = require('./dist-electron/main/lib/providers.js');
            const providers = Object.values(PROVIDER_REGISTRY);
            const models = Object.fromEntries(providers.map(({ type, name }) => [
                type, getModelsForProvider(type).map(id => ({
                    id, name: formatModelName(id), provider: name, providerType: type,
                })),
            ]));
            process.stdout.write(JSON.stringify({ providers, models, agentModels: getAllModelsFlat(), cloudModelMap: CLOUD_MODEL_MAP, defaultChatModels: DEFAULT_CHAT_MODELS }));
        "#])
        .output().expect("Node is required to generate the provider catalog at build time");
    assert!(
        catalog.status.success(),
        "Could not generate provider catalog: {}",
        String::from_utf8_lossy(&catalog.stderr)
    );
    fs::write(output.join("providers.json"), catalog.stdout).unwrap();

    tauri_build::build()
}
