# EverFern Navis Extension

Install this extension when you want Navis to control your normal browser profile without CDP.

## Build

```powershell
npm run build
```

Outputs:

- `dist/chrome` for Chrome, Edge, Brave, Vivaldi, and Chromium browsers.
- `dist/firefox` for Firefox and Firefox-based browsers.

## Install

Chrome/Chromium:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/extension-navis/dist/chrome`.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `apps/extension-navis/dist/firefox/manifest.json`.

Keep EverFern Desktop running. The extension connects to `ws://127.0.0.1:4001`.
