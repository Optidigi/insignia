#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$spike_dir"
export SHOPIFY_CLI_NO_ANALYTICS=1

python3 -B scripts/check-evidence.py
for crate in extensions/transform extensions/validation; do
  cargo fmt --manifest-path "$crate/Cargo.toml" --all -- --check
  cargo clippy --manifest-path "$crate/Cargo.toml" --all-targets --locked -- -D warnings
  cargo test --manifest-path "$crate/Cargo.toml" --locked
  shopify app function build --path "$spike_dir/$crate"
done
node scripts/replay-preview.mjs > evidence/ci-preview-replay.json
python3 -B - <<'PY'
import json
from pathlib import Path

expected = json.loads(Path('evidence/preview-replay.json').read_text())['rows']
actual = json.loads(Path('evidence/ci-preview-replay.json').read_text())['rows']
stable = ('target', 'caseName', 'signedBuckets', 'ordinaryLines', 'wasmSha256',
          'inputSha256', 'outputSha256', 'operationCount', 'outputBytes')
assert [{k: row[k] for k in stable} for row in actual] == [
    {k: row[k] for k in stable} for row in expected], 'retained preview replay changed'
print(f'Preview bundle replay: {len(actual)} synthetic cases match retained evidence')
PY
if [[ -f ../m0-007/scripts/check-history.py ]]; then
  python3 -B scripts/capture-manifest.py verify-history > evidence/ci-manifest.json
else
  python3 -B scripts/capture-manifest.py verify > evidence/ci-manifest.json
fi
cat evidence/ci-manifest.json
