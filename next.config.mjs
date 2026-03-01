/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@modelcontextprotocol/sdk', 'better-sqlite3'],
  },
};

export default nextConfig;

