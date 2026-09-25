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

# Shopify CLI postprocesses the SDK Wasm import ABI. Measure this artifact,
# rather than a direct Cargo Wasm build that the local Function runner cannot use.
shopify app function build --path "$spike_dir/extensions/transform"
shopify app function build --path "$spike_dir/extensions/validation"
if [[ -n "${M0_005_CAPTURE_DIR:-}" ]]; then
  mkdir -p "$M0_005_CAPTURE_DIR"
  for mode in smoke bench; do
    M0_005_CASE_EXPORT="$M0_005_CAPTURE_DIR/cases-$mode.jsonl" \
      node scripts/target-runner.mjs "$mode" >"$M0_005_CAPTURE_DIR/$mode.json"
  done
else
  node scripts/target-runner.mjs smoke
  node scripts/target-runner.mjs bench
fi
