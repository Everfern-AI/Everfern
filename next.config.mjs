import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure SWC WebAssembly bindings are located automatically on platforms without native prebuilt binaries
const wasmNodejsPath = path.join(__dirname, 'node_modules', '@next', 'swc-wasm-nodejs');
if (fs.existsSync(path.join(wasmNodejsPath, 'wasm.js'))) {
  process.env.NEXT_TEST_WASM_DIR = wasmNodejsPath;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: "out",
  trailingSlash: true,
  assetPrefix: '/',
  images: {
    unoptimized: true,
  },
  transpilePackages: ["tw-animate-css", "tw-shimmer"],
};

export default nextConfig;
