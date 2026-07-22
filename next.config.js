/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting runs in CI and during `next build` — it is never silently skipped.
  eslint: { ignoreDuringBuilds: false, dirs: ["app", "components", "lib"] },
  typescript: { ignoreBuildErrors: false },
};

module.exports = nextConfig;
