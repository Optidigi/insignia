#!/usr/bin/env python3
"""Verify the frozen M0-006 evidence against its merged source revision.

M0-007 changes the adapter; the old manifest must continue to describe its old
source and receipts rather than being regenerated with new hashes.
"""

from hashlib import sha256
import json
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
MERGE = "eaa386c90786e560d49f8311878c95d26cc3c7b8"
MANIFEST = "spikes/m0-006/evidence/live-artifact-manifest.json"


def original(path):
    return subprocess.check_output(["git", "show", f"{MERGE}:{path}"], cwd=REPO)


def digest(data):
    return sha256(data).hexdigest()


manifest_bytes = (REPO / MANIFEST).read_bytes()
assert manifest_bytes == original(MANIFEST), "historical manifest changed"
manifest = json.loads(manifest_bytes)
for path, expected in manifest["sourceSha256"].items():
    assert digest(original(path)) == expected, f"old source mismatch: {path}"
for path, expected in manifest["retainedReceiptSha256"].items():
    assert digest((REPO / path).read_bytes()) == expected, f"old receipt changed: {path}"

plan = REPO / "docs/architecture/implementation-plan.md"
ledger = REPO / "docs/architecture/decision-ledger.md"
assert digest(plan.read_bytes()) == "c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d"
assert digest(ledger.read_bytes()) == "0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb"
print(json.dumps({
    "historicalMerge": MERGE,
    "manifestSha256": digest(manifest_bytes),
    "oldSourceCount": len(manifest["sourceSha256"]),
    "unchangedReceiptCount": len(manifest["retainedReceiptSha256"]),
    "planAndLedgerUnchanged": True,
}, sort_keys=True))
