#!/usr/bin/env python3
"""Verify frozen M0-006 evidence and the archived v1.1 architecture records.

The approved v1.2 decision amendment changes current plan/ledger bytes. Verify
the old version at the fixed PR #10 merge, not by requiring current bytes to
equal historical bytes or regenerating historical receipts.
"""

from hashlib import sha256
import json
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
MERGE = "eaa386c90786e560d49f8311878c95d26cc3c7b8"
V1_1_MERGE = "0f2c80a316228bd69fdd2ff272e967ff14647b2b"
MANIFEST = "spikes/m0-006/evidence/live-artifact-manifest.json"


def original(path):
    return subprocess.check_output(["git", "show", f"{MERGE}:{path}"], cwd=REPO)


def v1_1(path):
    return subprocess.check_output(["git", "show", f"{V1_1_MERGE}:{path}"], cwd=REPO)


def digest(data):
    return sha256(data).hexdigest()


manifest_bytes = (REPO / MANIFEST).read_bytes()
assert manifest_bytes == original(MANIFEST), "historical manifest changed"
manifest = json.loads(manifest_bytes)
for path, expected in manifest["sourceSha256"].items():
    assert digest(original(path)) == expected, f"old source mismatch: {path}"
for path, expected in manifest["retainedReceiptSha256"].items():
    assert digest((REPO / path).read_bytes()) == expected, f"old receipt changed: {path}"

assert digest(v1_1("docs/architecture/implementation-plan.md")) == "c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d"
assert digest(v1_1("docs/architecture/decision-ledger.md")) == "0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb"

current_architecture = {
    "docs/architecture/implementation-plan.md": "8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145",
    "docs/architecture/decision-ledger.md": "97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
for path, expected in current_architecture.items():
    assert digest((REPO / path).read_bytes()) == expected, f"current approved architecture mismatch: {path}"
print(json.dumps({
    "historicalMerge": MERGE,
    "manifestSha256": digest(manifest_bytes),
    "oldSourceCount": len(manifest["sourceSha256"]),
    "unchangedReceiptCount": len(manifest["retainedReceiptSha256"]),
    "archivedArchitectureRef": V1_1_MERGE,
    "archivedArchitectureVerified": True,
    "currentArchitectureVersion": "1.2",
    "currentArchitectureSha256": current_architecture,
}, sort_keys=True))
