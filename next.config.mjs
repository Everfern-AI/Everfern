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
  webpack: (config, { dev }) => {
    // NR-BUN-03: conservative vendor chunk splitting (webpack build only)
    if (!dev && config.optimization && config.optimization.splitChunks) {
      config.optimization.splitChunks.cacheGroups = {
        ...config.optimization.splitChunks.cacheGroups,
        reactVendor: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
          name: 'react-vendor',
          chunks: 'all',
          priority: 20,
          reuseExistingChunk: true,
        },
        motion: {
          test: /[\\/]node_modules[\\/](framer-motion|motion)[\\/]/,
          name: 'motion',
          chunks: 'all',
          priority: 15,
          reuseExistingChunk: true,
        },
        markdown: {
          test: /[\\/]node_modules[\\/](react-markdown|remark.*|micromark.*|unified|mdast.*|hast.*|rehype.*|unified-.*|vfile.*|markdown.*|ansi-to-react)[\\/]/,
          name: 'markdown',
          chunks: 'all',
          priority: 10,
          reuseExistingChunk: true,
        },
      };
    }
    return config;
  },
};

export default nextConfig;
