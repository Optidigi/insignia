#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
export SHOPIFY_CLI_NO_ANALYTICS=1
export PATH="$repo/spikes/m0-005/node_modules/.bin:$PATH"

test "$(sha256sum docs/delivery/M0-READINESS-REPORT.md | cut -d' ' -f1)" = \
  a30ef1e57c371f0b6afdd0f51ed1778a23c90b6b709d8245869062dbdbd01c03
python3 -B spikes/m0-007/scripts/check-history.py
python3 -B spikes/m0-006/scripts/check-evidence.py
(cd spikes/m0-005 && corepack pnpm check:ts)
(cd spikes/m0-013 && corepack pnpm check:ts)
bash spikes/m0-013/scripts/measure-local.sh
