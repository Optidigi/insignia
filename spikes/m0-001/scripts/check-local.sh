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
python3 -B -m unittest discover -s tests -v
python3 -B scripts/check-m0-002-evidence.py >/dev/null
python3 -B scripts/verify_evidence_manifest.py evidence/m0-002/manifest.json
python3 -B scripts/check-m0-003-evidence.py >/dev/null
python3 -B scripts/verify_evidence_manifest.py evidence/m0-003/manifest.json
