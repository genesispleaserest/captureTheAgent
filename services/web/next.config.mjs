/** @type {import('next').NextConfig} */
const API_BASE = process.env.NEXT_PUBLIC_REFEREE_URL ?? 'http://localhost:8080';

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_BASE}/:path*`,
      },
      // Proxy magic link path through the web domain so emails can use the web origin
      {
        source: '/magic/:path*',
        destination: `${API_BASE}/magic/:path*`,
      },
    ];
  },
};

export default nextConfig;
