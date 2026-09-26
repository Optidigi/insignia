#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
export SHOPIFY_CLI_NO_ANALYTICS=1

python3 -B spikes/m0-007/scripts/check-history.py
python3 -B spikes/m0-006/scripts/check-evidence.py
node --test spikes/m0-007/tests/native-discount-observation.test.mjs
crate=spikes/m0-007/policy-model
cargo fmt --manifest-path "$crate/Cargo.toml" --all -- --check
cargo clippy --manifest-path "$crate/Cargo.toml" --all-targets -- -D warnings
cargo test --manifest-path "$crate/Cargo.toml"
for crate in spikes/m0-006/extensions/transform spikes/m0-006/extensions/validation; do
  cargo fmt --manifest-path "$crate/Cargo.toml" --all -- --check
  cargo clippy --manifest-path "$crate/Cargo.toml" --all-targets --locked -- -D warnings
  cargo test --manifest-path "$crate/Cargo.toml" --locked
done
shopify app build --path spikes/m0-006 --skip-dependencies-installation
node spikes/m0-007/scripts/replay-candidate.mjs > spikes/m0-007/evidence/ci-candidate-replay.json
python3 -B spikes/m0-007/scripts/check-replay.py
node spikes/m0-007/scripts/replay-live.mjs > spikes/m0-007/evidence/ci-live-replay.json
python3 -B spikes/m0-007/scripts/check-live-replay.py
python3 -B spikes/m0-007/scripts/capture-ci-manifest.py > spikes/m0-007/evidence/ci-manifest.json
