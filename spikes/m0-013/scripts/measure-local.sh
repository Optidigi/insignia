#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
export SHOPIFY_CLI_NO_ANALYTICS=1
export RUSTUP_TOOLCHAIN=1.98.1
cargo="${M0_013_CARGO:-cargo}"
shopify="${M0_013_SHOPIFY_CLI:-$repo/spikes/m0-005/node_modules/.bin/shopify}"
for target in transform validation; do
  "$shopify" app function build --path "spikes/m0-013/rust/extensions/$target"
  "$shopify" app function info --path "spikes/m0-013/rust/extensions/$target" --json > /dev/null
done
info="$("$shopify" app function info --path spikes/m0-013/rust/extensions/transform --json)"
export M0_013_RUNNER="$(node -e 'const fs=require("node:fs");console.log(JSON.parse(fs.readFileSync(0,"utf8")).functionRunnerPath)' <<< "$info")"
trampoline="$(dirname "$M0_013_RUNNER")/shopify-function-trampoline-2.0.1"
export M0_013_SHOPIFY_CLI="$shopify"
export M0_013_TRAMPOLINE="$trampoline"
test -x "$M0_013_RUNNER"
test -x "$trampoline"
for crate in authorization transform validation; do
  manifest="spikes/m0-013/rust/$crate/Cargo.toml"
  "$cargo" fmt --manifest-path "$manifest" --all -- --check
  "$cargo" clippy --manifest-path "$manifest" --all-targets --locked -- -D warnings
  "$cargo" test --manifest-path "$manifest" --locked
done
for target in transform validation; do
  manifest="spikes/m0-013/rust/$target/Cargo.toml"
  "$cargo" clean --manifest-path "$manifest" --target wasm32-unknown-unknown --release
  "$cargo" build --manifest-path "$manifest" --target wasm32-unknown-unknown --release --locked
  wasm="spikes/m0-013/rust/$target/target/wasm32-unknown-unknown/release/m0-013-cart-$target.wasm"
  mkdir -p spikes/m0-013/evidence/measurements/candidate
  cp "$wasm" "spikes/m0-013/evidence/measurements/candidate/$target.raw.wasm"
  "$trampoline" -i "$wasm" -o "$wasm"
done
M0_013_RUN_ID=candidate M0_013_MAX_BUCKETS=32 node spikes/m0-013/scripts/measure-full.mjs
node spikes/m0-013/scripts/measure-compare.mjs
node spikes/m0-013/scripts/measure-replay.mjs
