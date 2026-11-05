import type { NextConfig } from 'next';

// Odoo the GRN web app (public/app, built by scripts/build-grn-web.sh) talks to.
const grnOdoo = (process.env.GRN_ODOO_URL || 'https://harleys.odoo.com').replace(/\/+$/, '');

// The launcher and docs are plain static files under public/, served as they were before
// Next.js; these rewrites only give the HTML pages their clean URLs.
const nextConfig: NextConfig = {
  // /app/ must stay /app/: it is the web app's scope, so an installed shortcut opens without a URL bar.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/updates', destination: '/updates.html' },
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/', destination: '/app/index.html' },
      // The app's API only, on this site's own origin: no CORS, and Odoo needs no change.
      { source: '/odoo/harleys/mobile/:path*', destination: `${grnOdoo}/harleys/mobile/:path*` },
    ];
  },
};

export default nextConfig;
