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

## Releasing v2 (Electron users move to Tauri)

Everything goes into one GitHub release (tag `v2.0.0`), created as a draft. Electron clients and the Tauri updater only see it once it is published.

| Feed | Read by | Points to |
| --- | --- | --- |
| `latest.yml` | Electron 1.x on Windows | Electron bridge `EverFern.Setup.1.4.0.exe` (exports DPAPI data first) |
| `tauri-transition.yml` | The 1.4.0 bridge | Tauri NSIS installer 2.0.0 |
| `latest-mac.yml` | Electron 1.x on macOS | Tauri `.app` zipped per arch |
| `latest-linux.yml` | Electron 1.x AppImage | Tauri AppImage |
| `latest.json` | Tauri 2.x | Signed Tauri updater payloads for every platform |

1. Windows, locally: `npm run build:next`, `npm run build:electron-ts`, `npm run tauri:prepare`, `npm run tauri:package`, then `node scripts/build-electron-bridge.cjs 1.4.0`. Generate `tauri-transition.yml` and the Windows `latest.json` with `scripts/tauri-release-manifests.cjs`.
2. Linux and macOS: pushing a `v2.*` tag runs `.github/workflows/tauri-release.yml`. Each job uploads its bundles plus `feed-<platform>.json`. Set the `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has one) repository secret first; without it the jobs still build installers but not the signed updater payloads.
3. Download the `feed-*.json` files beside the Windows `latest.json` and run `node scripts/merge-release-feeds.cjs v2.0.0 <dir>`. Upload `latest.json`, `latest-mac.yml` and `latest-linux.yml`, then delete the `feed-*.json` assets.
4. The Electron workflows (`release.yml`, `build-linux.yml`, `build-macos.yml`) no longer run on push; they would overwrite these feeds.

The macOS and Linux framework switch keeps the same data folder (`EverFern` under the OS config dir) and `~/.everfern`, but the renderer `localStorage` export is Windows-only (DPAPI). The 1.x macOS builds are ad-hoc signed, so Squirrel.Mac may refuse the update; those users install the dmg by hand.
