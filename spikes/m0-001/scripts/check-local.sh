#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
function_dir="$spike_dir/extensions/m0-001-same-variant"

cd "$function_dir"
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --locked --release --target wasm32-unknown-unknown

cd "$spike_dir"
corepack pnpm test
