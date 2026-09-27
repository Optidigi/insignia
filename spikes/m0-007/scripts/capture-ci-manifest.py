#!/usr/bin/env python3
"""Bind CI result/inputs to current source and rebuilt Wasm without rewriting live evidence."""
import hashlib
import json
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[3]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
paths = [
    *sorted((repo / "spikes/m0-007/fixtures").glob("*.json")),
    *sorted((repo / "spikes/m0-007/policy-model/src").glob("*.rs")),
    *sorted((repo / "spikes/m0-006/extensions/transform/src").glob("*.rs")),
    *sorted((repo / "spikes/m0-006/extensions/validation/src").glob("*.rs")),
    repo / "spikes/m0-006/extensions/transform/src/cart_transform_run.graphql",
    repo / "spikes/m0-006/extensions/validation/src/cart_validations_generate_run.graphql",
    repo / "spikes/m0-007/evidence/ci-candidate-replay.json",
    repo / "spikes/m0-007/evidence/live-replay.json",
    repo / "spikes/m0-007/evidence/ci-live-replay.json",
    repo / "spikes/m0-007/evidence/live-preview-transform.wasm",
    repo / "spikes/m0-007/evidence/live-preview-validation.wasm",
    *sorted((repo / "spikes/m0-007/evidence").glob("*-checkout-transform.json")),
    *sorted((repo / "spikes/m0-007/evidence").glob("*-checkout-validation.json")),
    repo / "spikes/m0-007/evidence/cart-repair-optional-transform.json",
    repo / "spikes/m0-007/evidence/cart-repair-optional-validation.json",
    repo / "spikes/m0-007/scripts/replay-live.mjs",
    repo / "spikes/m0-006/extensions/transform/target/wasm32-unknown-unknown/release/m0-006-cart-transform.wasm",
    repo / "spikes/m0-006/extensions/validation/target/wasm32-unknown-unknown/release/m0-006-cart-validation.wasm",
]
print(json.dumps({
    "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
    "provenance": "off-store CI/local rebuild; distinct from later dev preview and Shopify remote execution",
    "sha256": {str(path.relative_to(repo)): sha(path) for path in paths},
}, indent=2, sort_keys=True))
