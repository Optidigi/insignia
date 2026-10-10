#!/usr/bin/env bash
# Package the current build only; no image push, host operation, or provider request.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
[[ $# = 1 && "$1" = /* && ! -e "$1" ]] || { echo 'New absolute package destination required' >&2; exit 1; }
[[ "$(node --version)" = v24.21.0 ]] || { echo 'Pinned Node required' >&2; exit 1; }
[[ -f apps/web/dist/server/entry.mjs ]] || { echo 'Build the current web workspace first' >&2; exit 1; }
corepack pnpm --filter @insignia/web deploy --prod --offline --frozen-lockfile --legacy "$1"
corepack pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false
node scripts/m5-024/copy-built-workspaces.mjs "$1"
node scripts/m5-runtime/package-web.mjs "$1"
