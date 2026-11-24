# Moving the TypeScript backend into Rust, one slice at a time

`main/` holds about 133k lines of TypeScript, not counting tests. Under Tauri it runs as a Node sidecar. This doc covers how that code moves into the Rust shell (`src-tauri/`) gradually, without a rewrite that freezes everything else. For installer and release gates, see [TAURI-MIGRATION.md](TAURI-MIGRATION.md).

## Where things stand (Nov 2026)

| Area | TS lines | State |
|---|---|---|
| `main/agent/tools` | 38k | Node. Computer-use input and screenshots, plus image work, go through Rust (`--ef-input`, `--ef-screenshot`, `--ef-image`). So do `grep` (`--ef-grep`), the `sheets_*` workbook ops (`--ef-sheet-op`) and the coding tools `read`, `ls`, `find` (`--ef-fs-tool`) |
| `main/agent/runner` | 32k | Node |
| `main/integrations` | 21k | Node. Config, validation and connection tests are already in `data/integrations.rs` |
| `main/lib` | 12k | Mixed. Native addons are replaced by `--ef-sqlite` and `--ef-keyhook`. The local embedding fallback (all-MiniLM-L6-v2) runs in Rust (`--ef-embed-local`) |
| `main/ipc` | 7k | About 105 of 240 channels are served by Rust through `renderer-bridge.js` (`RUST_DATA` and others) |
| `main/agent/persistence`, `main/store` | 12k | History, projects, vectors and memory reads and writes are in `data/db.rs`. Node still does the embedding |
| everything else | 11k | Node |

Rust is about 26k lines today.

## The two seams

1. **Renderer IPC** (`tauri/bridge/renderer-bridge.js`). Each channel is either sent to Node over the WebSocket or to a Rust command (`invokeRust('ef_data', …)`). Moving a channel takes three steps:
   - Implement it in `src-tauri/src/data/mod.rs` `dispatch` (or a module it calls).
   - Add it to `RUST_DATA`.
   - Keep the Node handler: Electron still uses it.
2. **Node to Rust calls** (`EF_NATIVE_EXE --ef-*`). This is for work the agent does inside Node: image ops, input, sqlite and the key hook. The wrappers in `main/lib/native-*.ts` check `has*()` and keep the old path for Electron. For agent tools, `runNativeTool(mode, request)` in `main/lib/native-tool.ts` is the one helper to use: it sends JSON on stdin, reads JSON from stdout, and resolves to `null` outside Tauri or on any failure, so the caller falls through to its TS code. A Rust mode can also return `null` on purpose, to hand a case back to Node.

The on-disk format is the contract between the two sides. A ported channel must read and write exactly the files and rows Node does, because Node keeps reading them. When Rust changes something Node caches, the bridge tells Node with a `send` (as `history:index-messages` does).

## Order

Ports go from the leaves inward, so each slice can ship by itself:

1. **Renderer data channels left on Node**, roughly smallest first: `system:open-file` (needs `~` expansion and an "open with" choice), `tool-settings:get-browsers`, `permissions:*`, `terminal:*`. Autostart on macOS and Linux also still goes to Node.
2. **Workers plumbing**: VM file ops (`workers:vm-*`), pty and file watching. `vm.rs` and `ef_worker_store` already cover part of this.
3. **Search and fetch tools**: `web_search.rs` and `web_fetch.rs` exist. Node's tools can call them through `--ef-*` or a local RPC.
4. **Integrations runtime** (Telegram, Discord and so on): long-lived bots, after config (already done).
5. **Agent tools**, one tool at a time, through `runNativeTool`. The Node tool keeps its schema, argument checks, `onUpdate`, `emitEvent` and renderer broadcasts; Rust does the file and data work. Done: `grep`, `sheets_*`, `read`, `ls`, `find`. Next, by how self-contained they are: `write` and `edit` (with `multi_file_edit`, which `file_edit.rs` partly covers; rollback tracking stays in Node), then the worker file tools in `worker-tools.ts`.
6. **Agent runner**: the loop, prompts, context and the provider stream. It comes last because everything above feeds it. `context_engine.rs`, `context_window.rs` and `tool_orchestration.rs` are the start.

## When TS gets deleted

As long as `npm run build` ships Electron, every ported Node handler stays as Electron's path. TS can be deleted per area once one of these is true:
- Electron is retired, or
- the Electron build bundles `everfern.exe` and calls the same `--ef-*` modes.

Until then, a port moves the Tauri path to Rust, and a later, separate change deletes the TS.

## Per-slice checklist

- Rust implementation, plus `cargo test` covering the file and row format.
- The bridge routes the channel, and Node's handler is left in place.
- Anything Node caches gets invalidated.
- `npm run build:electron-ts` passes and `npm run tauri:test` passes.
- The slice is ticked off below.

## Slices done

- [x] Computer-use input and screenshots (`input.rs`, `capture.rs`)
- [x] sharp work in tools (`image_ops.rs`)
- [x] sqlite3 (`sqlite_server.rs`)
- [x] uiohook (`keyhook.rs`)
- [x] Skills channels (`data/skills.rs`)
- [x] Window controls, tray and pickers (`window:*`, `tray:*`, `projects:selectFolder`, `projects:selectFiles`, `projects:openFolder`) routed to the `shell.rs` commands
- [x] Sheets workbook (`data/sheets.rs`), checked against `normalizeSheetData`
- [x] Autostart on Windows (`data/autostart.rs`): the same HKCU Run value Electron writes, and the window starts hidden with `--auto-start`
- [x] `system:get-username`
- [x] Agent tool `grep` (`data/grep.rs`, `--ef-grep`). JavaScript's ASCII `\d \w \b` are kept. Patterns this engine cannot run (lookaround, backreferences, invalid regex) return `null` and Node searches. The Node fallback now awaits each file; before, it could print "0 matches" while matches were still being read.
- [x] Agent sheet tools (`sheets_read/write/append/clear/create/import/export/format/add_sheet`) through `--ef-sheet-op` in `data/sheets.rs`, checked step by step against `sheets-store.ts`
- [x] Coding tools `read`, `ls`, `find` from `@mariozechner/pi-coding-agent` (`data/fs_tools.rs`, `--ef-fs-tool`), checked case by case against the package (48/48). `read` covers text files; images, missing or unreadable files and non-integer `offset`/`limit` are left to the package. `ls` reads the folder in Rust and hands that to the package's own `ls` through its `operations` option, so its `localeCompare` sort is unchanged. `find` no longer needs the `fd` binary the package downloads: it uses `ignore` and `globset`, the crates fd is built on, with fd's settings. One change: a pattern with `/` (`src/**/*.ts`) is matched against the relative path; fd matched only file names, so it found nothing.
- [x] Local embedding fallback (`data/local_embed.rs`, `--ef-embed-local`). When the embedding provider fails, `embeddings.ts` used to load Transformers.js, onnxruntime and MiniLM into Node, about 134 MB that stayed for the whole session. Rust now runs the same quantized ONNX file with `tract-onnx` (pure Rust, no DLL) in a short-lived process, so the memory is freed after each call (peak about 90 MB while it runs). It reuses the Transformers.js cache folder, or downloads the two files once to `~/.everfern/models`. The BERT tokenizer is a copy of tokenizers.js and gives identical token ids on 16/16 test texts. The vectors are not bit-identical: tract and onnxruntime round the int8 matmuls differently, so cosine similarity to the Node vectors is 0.994 to 1.0. If the Rust call fails, Node still loads Transformers.js.
- [x] Shared JavaScript coercions for ports (`src-tauri/src/js.rs`: `Number()`, `String()`, UTF-16 length and slice)
