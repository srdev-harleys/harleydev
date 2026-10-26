import type { NextConfig } from 'next';

// The launcher and docs are plain static files under public/, served as they were before
// Next.js; these rewrites only give the HTML pages their clean URLs.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/updates', destination: '/updates.html' },
    ];
  },
};

export default nextConfig;
