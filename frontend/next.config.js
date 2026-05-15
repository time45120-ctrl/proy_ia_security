/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ],
  reactStrictMode: true,
};

module.exports = nextConfig;
