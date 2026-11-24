// Stage the compatibility backend with Node-ABI native modules, never Electron-ABI modules.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const staging = path.join(root, 'tauri', 'staging');
const app = path.join(staging, 'app');
const node = path.join(staging, 'node');
if (!fs.existsSync(path.join(root, 'dist-electron/main/main.js'))) throw new Error('Build the TypeScript compatibility backend first');
if (!fs.existsSync(path.join(root, 'out/index.html'))) throw new Error('Build the frontend first');
fs.mkdirSync(app, { recursive: true });
fs.mkdirSync(node, { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'dist-electron', 'tauri/sidecar']) {
  fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true });
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run tauri:prepare');
if (process.argv.includes('--refresh')) {
  if (!fs.existsSync(path.join(app, 'node_modules'))) throw new Error('Stage dependencies before refreshing');
} else execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: app, stdio: 'inherit', env: { ...process.env, npm_config_runtime: 'node', npm_config_target: process.versions.node },
});
fs.copyFileSync(process.execPath, path.join(node, process.platform === 'win32' ? 'node.exe' : 'node'));
// The exported frontend already contains its browser code. Keep UI build tools
// and icon source trees out of the compatibility runtime.
const runtimePackage = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
for (const name of ['@assistant-ui/react', '@assistant-ui/react-markdown', '@base-ui/react', '@heroicons/react', '@livekit/components-react', '@openuidev/react-lang', '@phosphor-icons/react', 'ansi-to-react', 'framer-motion', 'lottie-react', 'lucide-react', 'next', 'radix-ui', 'shadcn', 'tailwind-merge', 'tw-animate-css', 'tw-shimmer']) delete runtimePackage.dependencies[name];
// The Rust shell does these natively (src-tauri/src/sqlite_server.rs, input.rs, keyhook.rs),
// so their Node addons aren't shipped. sharp stays: @xenova/transformers needs it.
delete runtimePackage.dependencies.sqlite3;
if (process.platform === 'win32') for (const name of ['@jitsi/robotjs', 'uiohook-napi']) delete runtimePackage.dependencies[name];
delete runtimePackage.devDependencies;
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(runtimePackage, null, 2));
const runtimeLock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8'));
runtimeLock.packages[''].dependencies = runtimePackage.dependencies;
delete runtimeLock.packages[''].devDependencies;
fs.writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify(runtimeLock, null, 2));
execFileSync(process.execPath, [npm, 'prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit' });
// Drop native prebuilds for other platforms (prebuilds/android-x64, onnxruntime bin/napi-v3/linux/arm64, ...).
// They are dead weight, and linuxdeploy aborts when ldd cannot read a foreign binary.
const OSES = new Set(['aix', 'android', 'darwin', 'freebsd', 'ios', 'linux', 'linuxmusl', 'netbsd', 'openbsd', 'sunos', 'win32']);
const ARCHES = new Set(['arm', 'arm64', 'armhf', 'armv7', 'ia32', 'loong64', 'mips64el', 'ppc64', 'riscv64', 's390x', 'universal', 'x64', 'x86']);
const keepArch = (arch) => arch === process.arch || arch === 'universal' || (process.platform === 'darwin' && arch.includes(process.arch));
let pruned = 0;
const prune = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    const [os_, ...rest] = entry.name.split(/[-_]/);
    const arch = rest.join('-');
    const parent = path.basename(dir);
    let foreign = false;
    if (OSES.has(os_) && rest.length && [...ARCHES].some((a) => arch === a || arch.startsWith(a + '-') || arch.includes('+'))) {
      foreign = os_ !== process.platform || !keepArch(arch);
    } else if (/^napi-v\d+$/.test(parent) && OSES.has(entry.name)) {
      foreign = entry.name !== process.platform;
    } else if (OSES.has(parent) && ARCHES.has(entry.name) && /^napi-v\d+$/.test(path.basename(path.dirname(dir)))) {
      foreign = !keepArch(entry.name);
    }
    if (foreign) { fs.rmSync(full, { recursive: true, force: true }); pruned++; } else prune(full);
  }
};
prune(path.join(app, 'node_modules'));
console.log(`Removed ${pruned} foreign-platform prebuild folders`);
const resources = {};
for (const [source, target] of [
  [app, 'app/'], [node, 'node/'],
  [path.join(root, 'main/skills'), 'skills/'],
  [path.join(root, 'main/agent/prompts'), 'prompts/'],
  [path.join(root, 'public'), 'public/'],
]) resources[source] = target;
const extension = path.resolve(root, '../extension-navis');
if (fs.existsSync(extension)) resources[extension] = 'extension-navis/';
// Updater public key: env, then the local key pair, then the copy committed for CI.
const publicFile = [path.join(os.homedir(), '.everfern/keys/tauri-updater.key.pub'), path.join(root, 'src-tauri/updater.pub')].find((f) => fs.existsSync(f));
const publicKey = process.env.EVERFERN_UPDATER_PUBLIC_KEY || (publicFile ? fs.readFileSync(publicFile, 'utf8').trim() : '');
// Without the private key (EVERFERN_ALLOW_UNSIGNED=1) the app still embeds the public key,
// so it accepts later signed updates; only this build's updater payloads are skipped.
const signUpdates = Boolean(publicKey) && process.env.EVERFERN_ALLOW_UNSIGNED !== '1';
const config = { bundle: { resources, ...(publicKey ? { createUpdaterArtifacts: signUpdates } : {}) } };
if (publicKey) config.plugins = { updater: { pubkey: publicKey } };
fs.writeFileSync(path.join(staging, 'tauri.release.json'), JSON.stringify(config, null, 2));
console.log('Runtime staged. Build with the generated tauri/staging/tauri.release.json configuration override.');
