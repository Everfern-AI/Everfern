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
delete runtimePackage.devDependencies;
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(runtimePackage, null, 2));
const runtimeLock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8'));
runtimeLock.packages[''].dependencies = runtimePackage.dependencies;
delete runtimeLock.packages[''].devDependencies;
fs.writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify(runtimeLock, null, 2));
execFileSync(process.execPath, [npm, 'prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit' });
const resources = {};
for (const [source, target] of [
  [app, 'app/'], [node, 'node/'],
  [path.join(root, 'main/skills'), 'skills/'],
  [path.join(root, 'main/agent/prompts'), 'prompts/'],
  [path.join(root, 'public'), 'public/'],
]) resources[source] = target;
const extension = path.resolve(root, '../extension-navis');
if (fs.existsSync(extension)) resources[extension] = 'extension-navis/';
const publicFile = path.join(os.homedir(), '.everfern/keys/tauri-updater.key.pub');
const publicKey = process.env.EVERFERN_UPDATER_PUBLIC_KEY || (fs.existsSync(publicFile) ? fs.readFileSync(publicFile, 'utf8').trim() : '');
const config = { bundle: { resources, ...(publicKey ? { createUpdaterArtifacts: true } : {}) } };
if (publicKey) config.plugins = { updater: { pubkey: publicKey } };
fs.writeFileSync(path.join(staging, 'tauri.release.json'), JSON.stringify(config, null, 2));
console.log('Runtime staged. Build with the generated tauri/staging/tauri.release.json configuration override.');
