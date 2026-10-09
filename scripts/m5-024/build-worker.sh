#!/usr/bin/env bash
# Offline packaging only. Destination must be new; no image push or host operation.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
[[ $# = 1 && "$1" = /* && ! -e "$1" ]] || { echo 'New absolute package destination required' >&2; exit 1; }
[[ "$(node --version)" = v24.21.0 ]] || { echo 'Pinned Node required' >&2; exit 1; }
corepack pnpm build
corepack pnpm --filter @insignia/worker deploy --offline --prod --legacy "$1"
corepack pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false
node scripts/m5-024/copy-built-workspaces.mjs "$1"
node docs/delivery/evidence/m5-023/operators/worker-inventory.mjs --collect "$1/dist/main.js" > "$1/worker-inventory.json"
