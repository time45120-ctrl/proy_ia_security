/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ],
  reactStrictMode: true,
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
