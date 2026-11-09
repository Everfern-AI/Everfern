# Tauri migration release gates

The Tauri shell now owns cloud HTTP transport (including agent browser-control requests with connection reuse), provider HTTP streaming, worker persistence, Windows DPAPI encryption, local Alpine worker commands, notifications, shortcuts and signed update downloads. Agent orchestration, integrations and most tools still launch through a Node compatibility sidecar. This is an incremental migration, not a completed Rust backend rewrite or a release-ready replacement.

Keep `latest.yml` pointing to the Electron bridge installer (default bridge version 1.4.0). The bridge exports encrypted data, then switches to `tauri-transition.yml` with differential downloads disabled. Generate `tauri-transition.yml` and signed `latest.json` with `scripts/tauri-release-manifests.cjs`; it deliberately never overwrites `latest.yml`. The Tauri version is 2.0.0. Verify these versions exceed all published releases before distribution. Generating metadata alone does not prove installer compatibility.

Before publishing:

- Stage Node, compiled agent, native modules, frontend and sidecar resources with the packaging scripts. Native module loading is checked against the Node ABI. The default resource map stays empty; the generated override supplies staged resources.
- Windows persistence and DPAPI protection are implemented. The sidecar now rejects unsupported encryption instead of writing plaintext. Existing Electron encrypted credentials still require migration; never overwrite their files during recovery. Other operating systems need native keychain implementations.
- The bridge release exports renderer storage and both cloud and Alpine browser clones using the Rust helper. Bundle `everfern.exe` under Electron's `resources/native/` for that release. The real Electron encryption export smoke test passes. Rust recognizes both legacy `desktop` and `EverFern` user data directories. Test the one-time import before changing webview engines; WebView2 does not automatically import Chromium profile storage.
- Signed update checking, download and update UI events are implemented. Set `EVERFERN_UPDATER_PUBLIC_KEY` at Rust compile time; keep the matching signing private key in release secrets. Builds without that key reject update requests.
- Test the installer from an installed previous Electron release, including custom install paths, update invocation flags, shortcuts, uninstall registration, sign-in, worker data and rollback. Matching the application identifier alone does not establish installer compatibility.
- Verify cloud/native app control through the Tauri bridge; Electron webview APIs are currently shimmed.

Move backend responsibilities incrementally: encrypted persistence, cloud VM lifecycle/control, streaming model requests, then agent orchestration and integrations. Preserve the React interface and the existing IPC contract during each move.

Development checks:

```powershell
npm run build:electron-ts
npm run tauri:test
node --test scripts/tauri-release-manifests.test.cjs
node --test scripts/tauri-native-smoke.test.cjs
node_modules/.bin/electron scripts/tauri-migration-smoke.cjs
npm run tauri:dev
```

For packaging, first build the frontend and compatibility backend, then run `npm run tauri:prepare`. It stages a Node runtime, installs production dependencies for the Node ABI into an isolated directory, and removes frontend build dependencies from that runtime. Refresh source changes with `npm run tauri:prepare -- --refresh`. Run `npm run tauri:package` to build signed artifacts, or append `-- --debug` for an installer used only for testing. The scripts read the signing pair from `~/.everfern/keys/tauri-updater.key` and `.key.pub`, or use the explicit signing environment variables. Private keys are outside bundled resources.

Installer hooks preserve the legacy per-user install directory, require the bridge export, and remove the superseded Electron uninstall registry entry only after installation succeeds. Machine-wide legacy installations need separate installer validation.

Do not publish the new feed until these checks pass. macOS and Linux require their own migration artifacts and installation tests.
