#!/usr/bin/env bash
# Credentials-free root candidate check. Never invokes Shopify CLI.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
for target in transform validation; do
  bash scripts/m1-functions/build-wasm.sh "$target"
done

tools_dir="$repo/.m1-artifacts/tools"
runner="${M1_FUNCTION_RUNNER:-$tools_dir/function-runner-9.2.2}"
expected_runner='728bedbcf86f57680051208f9056642c9dfb07766a21891624bf18f372e4c29b'
if [[ ! -f "$runner" ]]; then
  mkdir -p "$tools_dir"
  compressed="$tools_dir/function-runner-9.2.2.gz"
  curl -fLsS 'https://github.com/Shopify/function-runner/releases/download/v9.2.2/function-runner-x86_64-linux-v9.2.2.gz' -o "$compressed"
  printf '%s  %s\n' 'd091bae3f6d17e4e92e3e6c4450ff1b80bd14dea02295608157e0297183236b4' "$compressed" | sha256sum -c -
  gzip -dc "$compressed" > "$runner"
  chmod 0755 "$runner"
  rm "$compressed"
fi
printf '%s  %s\n' "$expected_runner" "$runner" | sha256sum -c -
mkdir -p "$repo/.m1-artifacts"
M1_FUNCTION_RUNNER="$runner" python3 -B scripts/m1-functions/replay.py > "$repo/.m1-artifacts/replay.json"
python3 -B - <<'PY'
import json
from pathlib import Path
result = json.loads(Path('.m1-artifacts/replay.json').read_text())
for target, evidence in result.items():
    print(target, len(evidence['cases']), evidence['rawWasmSha256'], evidence['finalWasmSha256'])
PY
