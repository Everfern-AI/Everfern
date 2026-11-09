# Moving EverFern Desktop from Electron to Tauri

## Is it possible?

Yes, but not as a straight rewrite. The main process is about 193k lines of
TypeScript with 200 IPC handlers. It leans on native Node modules
(`@jitsi/robotjs`, `uiohook-napi`, `better-sqlite3`, `sqlite-vec`, `sharp`,
`canvas`). Porting all of that to Rust would take months. The practical
shape is:

```
Tauri shell (Rust, ~5 MB)         Node sidecar (existing main/ code)
 - windows, tray, shortcuts  <->   - agent runner, tools, Alpine VM
 - updater, deep links             - sqlite, OCR, voice, integrations
 - system WebView renders the      - talks to the shell over a local
   existing Next static export       WebSocket (same channel names as IPC)
```

* `out/` (the Next static export) loads unchanged in the Tauri webview.
* `preload/preload.ts` becomes a small `window.electronAPI` shim. It sends the
  same channel names over a WebSocket to the sidecar, so React code does not
  change.
* `main/` keeps running in Node as a sidecar. Only the Electron-specific parts
  move to Rust: windows, tray, notifications, shortcuts, dialogs, shell open,
  updater, protocol handler and screen capture.

## What it saves (honest numbers)

| | Electron today | Tauri + Node sidecar |
|---|---|---|
| Installer | ~150-200 MB | ~45-60 MB (Node runtime plus native modules dominate) |
| Idle RAM | ~350-500 MB (browser plus renderer plus GPU plus Node) | ~200-300 MB (WebView2 plus Node) |
| Startup | Chromium boot | Faster window, sidecar starts in parallel |

On Windows, WebView2 is also Chromium, but it is shared with the OS and is not
bundled. Most of the saving is disk and roughly 100-200 MB of RAM. The agent,
the Alpine VM and model calls cost the same either way.

## Hard parts

1. **`session.*` (293 uses)**: per-worker browser profiles, cookies and proxy
   rules. Tauri webviews expose much less of this. Worker browsing should move
   to Chromium inside the Alpine VM (which is being set up now), and that is
   better isolation anyway.
2. **Overlays** (`computer-overlay.ts`, `voice-overlay.ts`): transparent,
   click-through, always-on-top windows. Tauri supports these (`transparent`,
   `set_ignore_cursor_events`), but they need a rewrite.
3. **`desktopCapturer`**: replace with the `xcap` or `scap` crates on the Rust
   side.
4. **Native modules** stay in the Node sidecar, so they are built per
   platform exactly as today.

## Auto-updating existing Electron users to Tauri

Existing installs use `electron-updater` against the GitHub releases of
`Everfern-AI/Everfern` with `appId` `com.everfern.desktop`.

1. **Ship Tauri with the same identity.** Use identifier
   `com.everfern.desktop`, the same product name and the same install folder
   (NSIS per-user `%LOCALAPPDATA%\Programs\EverFern`). Then the Tauri
   installer replaces the Electron files in place, and Start menu and taskbar
   pins keep working.
2. **One last Electron release (the bridge, e.g. v2.x-final)** goes out
   through `electron-updater` as usual. On start it:
   * downloads the Tauri NSIS installer from the GitHub release named in
     `latest-tauri.json`, and checks its signature and sha256;
   * migrates data: `~/.everfern/` is already shared. Copy anything under
     Electron `userData` that is still needed (window state, local storage
     export) into Tauri's app data dir;
   * runs the installer silently (`/S`), then quits. The installer removes the
     old Electron uninstall entry.
3. **From then on, the Tauri updater** (`tauri-plugin-updater`, signed with
   a Tauri key) reads a `latest.json` from the same GitHub releases.
4. Keep the bridge release available for about 3 months, so users who were
   offline still cross over.

## Phases

1. Scaffold `src-tauri/` and load `out/` in the webview. Bundle Node plus
   `main/` as a sidecar (`externalBin`) and add the WebSocket IPC shim.
   Exit test: chat works end to end.
2. Port tray, notifications, shortcuts, dialogs, deep links and the window
   chrome.
3. Port the overlays and screen capture. Move worker browsing into the Alpine
   VM.
4. Add signing, the updater, the bridge release and a migration test from a
   real Electron install. Then release.

## Status

* **Phase 1 (done):** Node sidecar, WebSocket IPC shim, tray, single instance. Chat works end to end.
* **Phase 2 (deep links done):** `tauri-plugin-deep-link` registers `everfern-app://`. A clicked link reaches
  the running window through single-instance (Windows/Linux) or `on_open_url` (macOS), and the renderer
  bridge emits it on `acp:protocol-link`, the same channel Electron uses. Links that arrive before the app
  listens are queued. Notifications, dialogs, shortcuts and the frameless window were ported in phase 1.
* **Phase 3 (VM desktop done):** `system:startVMDesktop` / `system:stopVMDesktop` start the Alpine VM's
  XFCE desktop (noVNC on 127.0.0.1) and Settings > Machine > "Open desktop" shows it in an app window.
  Cloud VMs (Daytona) open the same way through `GET /api/cloud-vms/<id>/desktop`.
* **Phase 4 (to do, needs the owner):** signing and updater, below.

## Phase 4 checklist (run these yourself; the keys must stay private)

1. Create the updater key once and keep the private half out of git:
   `npx tauri signer generate -w ~/.tauri/everfern.key`
2. Put the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, with
   `"endpoints": ["https://github.com/Everfern-AI/Everfern/releases/latest/download/latest.json"]`,
   then add `tauri-plugin-updater = "2"` and `.plugin(tauri_plugin_updater::Builder::new().build())`.
   Do not add the plugin before the pubkey exists, or the app fails to start.
3. In GitHub Actions secrets set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
   and for Windows code signing the certificate (`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`).
4. Build with `npx tauri build`; upload the NSIS installer, its `.sig` and `latest.json` to the release.
5. Ship the Electron bridge release described above, then test the migration on a real Electron install.
6. Regenerate icons (including `.icns`) with `npx tauri icon public/images/logos/<square logo>.png`.
