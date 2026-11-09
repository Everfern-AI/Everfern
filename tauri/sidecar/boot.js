/**
 * Entry point of the Node sidecar that the Tauri shell starts.
 *
 *   node tauri/sidecar/boot.js
 *
 * It makes `require('electron')` return our shim, starts the WebSocket that
 * the webview talks to, then loads the unchanged compiled main process.
 * The shell reads one line from stdout:  EF_SIDECAR_READY <port> <token>
 */
'use strict';

const Module = require('module');
const path = require('path');

const appRoot = process.env.EF_APP_PATH || path.resolve(__dirname, '..', '..');
process.env.EF_APP_PATH = appRoot;
process.chdir(appRoot);

const rawWrite = process.stdout.write.bind(process.stdout);
process.__efControlWrite = (line) => rawWrite(line);

// Packaged builds keep extra resources next to the app, like Electron did.
if (!process.resourcesPath) process.resourcesPath = process.env.EF_RESOURCES_PATH || path.join(appRoot, 'resources');
process.versions.electron = process.versions.electron || '0.0.0-tauri';
process.type = 'browser';
process.env.EVERFERN_SHELL = 'tauri';

const shimPath = require.resolve('./electron-shim.js');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron' || request === 'electron/main' || request === 'electron/common') return shimPath;
  return originalResolve.call(this, request, parent, isMain, options);
};

const shim = require(shimPath);
globalThis.__efNativeCloudRequest = (route, token, body) => shim.__ef.nativeCloudRequest(route, token, body);
shim.__ef.startServer();

// If the shell goes away, so do we.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();

process.on('uncaughtException', (e) => process.stderr.write(`[sidecar] uncaught: ${(e && e.stack) || e}\n`));
process.on('unhandledRejection', (e) => process.stderr.write(`[sidecar] unhandled rejection: ${(e && e.stack) || e}\n`));

// Let the listening callback notify Rust before the large compatibility backend
// loads synchronously. Otherwise the window waits for every tool dependency.
setImmediate(() => require(path.join(appRoot, 'dist-electron', 'main', 'main.js')));
