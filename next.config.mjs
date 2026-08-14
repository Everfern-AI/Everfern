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
  // Do NOT set turbopack.root — defaults to app directory, not monorepo root
};

export default nextConfig;
