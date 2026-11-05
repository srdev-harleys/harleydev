#!/usr/bin/env bash
# Builds the Harley's GRN Flutter app for the browser into public/app/ (served at /app).
# Its API calls go to this site's /odoo/harleys/mobile/..., which next.config.ts forwards to
# GRN_ODOO_URL (default https://harleys.odoo.com), so one build serves any Odoo.
#
# Usage: scripts/build-grn-web.sh [harleys_mobile checkout]   (default ../harleys_mobile)
# It builds whatever that checkout holds: point it at a clean checkout of the commit to ship.
set -euo pipefail
cd "$(dirname "$0")/.."
src="$(cd "${1:-../harleys_mobile}" && pwd)"

(cd "$src" && flutter build web --release --base-href /app/ --no-wasm-dry-run)

rm -rf public/app
cp -r "$src/build/web" public/app
# The engine loads from Google's CDN (gstatic.com), so the local copies (~37 MB) are never fetched.
rm -rf public/app/canvaskit
echo "public/app: $(du -sh public/app | cut -f1), version $(grep -o '"version":"[^"]*"' public/app/version.json)"
