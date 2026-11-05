import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

// Odoos the GRN web app (public/app, built by scripts/build-grn-web.sh) talks to: production at
// /odoo, and each config.json environment with a "grn" key at /odoo/<key> (the app's picker reads
// the same list), so a changed Odoo.sh test URL is updated in config.json only.
const production = (process.env.GRN_ODOO_URL || 'https://harleys.odoo.com').replace(/\/+$/, '');
const environments: { grn?: string; url: string }[] =
  JSON.parse(readFileSync(join(process.cwd(), 'public/config.json'), 'utf8')).brand.environments;

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
      { source: '/odoo/harleys/mobile/:path*', destination: `${production}/harleys/mobile/:path*` },
      ...environments
        .filter((env) => env.grn)
        .map((env) => ({
          source: `/odoo/${env.grn}/harleys/mobile/:path*`,
          destination: `${new URL(env.url).origin}/harleys/mobile/:path*`,
        })),
    ];
  },
};

export default nextConfig;
