#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$spike_dir"
export SHOPIFY_CLI_NO_ANALYTICS=1

corepack pnpm install --frozen-lockfile
export PATH="$spike_dir/node_modules/.bin:$PATH"
corepack pnpm check:ts

for crate in rust/authorization extensions/transform extensions/validation; do
  cargo fmt --manifest-path "$crate/Cargo.toml" --all -- --check
  cargo clippy --manifest-path "$crate/Cargo.toml" --all-targets --locked -- -D warnings
  cargo test --manifest-path "$crate/Cargo.toml" --locked
done

# The CLI local build postprocesses SDK Wasm imports for the pinned Function
# runner. A plain cargo Wasm build is not an executable runner artifact.
shopify app function build --path "$spike_dir/extensions/transform"
shopify app function build --path "$spike_dir/extensions/validation"
node scripts/target-runner.mjs smoke
node scripts/target-runner.mjs bench
