/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  allowedDevOrigins: [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ],
  reactStrictMode: true,
  images: {
    // Hostinger's managed Next.js runtime is returning 503 from /_next/image.
    // Serve local assets directly from /public so they remain CDN-cacheable.
    unoptimized: true,
  },
};

module.exports = nextConfig;
