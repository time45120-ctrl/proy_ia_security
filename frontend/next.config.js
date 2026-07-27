/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
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
  experimental: {
    // Hostinger Web Apps has a strict process quota. Prevent Next.js from
    // deriving the much larger CPU count exposed by the build container.
    cpus: 1,
  },
  async redirects() {
    return [
      {
        source: "/sync",
        destination: "/desarrollo/sync",
        permanent: true,
      },
      {
        source: "/dashboard",
        destination: "/desarrollo/dashboard",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
