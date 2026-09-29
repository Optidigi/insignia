#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
export SHOPIFY_CLI_NO_ANALYTICS=1
shopify="${M0_014_SHOPIFY_CLI:-$repo/spikes/m0-005/node_modules/.bin/shopify}"
cargo="${M0_014_CARGO:-cargo}"

# Preserve the historical source/query comparison only for unchanged
# protocol-facing surfaces. M0-014R deliberately changes CartLine parsing.
for part in transform validation; do
  cmp "spikes/m0-013/rust/$part/schema.graphql" "spikes/m0-014/rust/$part/schema.graphql"
  cmp "spikes/m0-013/rust/$part/Cargo.lock" "spikes/m0-014/rust/$part/Cargo.lock"
done
cmp spikes/m0-013/rust/policy/projection.rs spikes/m0-014/rust/policy/projection.rs

(cd spikes/m0-014 && corepack pnpm check)
(cd spikes/m0-005 && corepack pnpm check:ts)
(cd spikes/m0-013 && corepack pnpm check:ts)
for crate in authorization transform validation; do
  manifest="spikes/m0-014/rust/$crate/Cargo.toml"
  "$cargo" fmt --manifest-path "$manifest" --all -- --check
  "$cargo" clippy --manifest-path "$manifest" --all-targets --locked -- -D warnings
  "$cargo" test --manifest-path "$manifest" --locked
done
python3 -B spikes/m0-014/scripts/check-config.py
for target in transform validation; do
  "$shopify" app function build --path "spikes/m0-014/rust/extensions/$target"
done
info="$("$shopify" app function info --path spikes/m0-014/rust/extensions/transform --json)"
export M0_014_RUNNER="$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(0,"utf8")).functionRunnerPath)' <<< "$info")"
test -x "$M0_014_RUNNER"
# Historical checks remain named and run against their original binaries.
M0_013_RUNNER="$M0_014_RUNNER" node spikes/m0-013/scripts/measure-replay.mjs
node spikes/m0-014/scripts/check-artifact.mjs
node spikes/m0-014/scripts/measure-current.mjs
