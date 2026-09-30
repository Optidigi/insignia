#!/usr/bin/env python3
"""Verify frozen receipts plus v1.1/v1.2/v1.3 archives and the v1.4 record.

Each archived version is checked at its fixed merge. Current v1.4 hashes are
explicit constants, never learned from the working files being checked.
"""

from hashlib import sha256
import json
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
MERGE = "eaa386c90786e560d49f8311878c95d26cc3c7b8"
V1_1_MERGE = "0f2c80a316228bd69fdd2ff272e967ff14647b2b"
V1_2_MERGE = "662a78cd27507d8a2f1eaa976f1c644c93edd1be"
V1_3_MERGE = "4209bb16a09cff95d5cbbc1bbcb082e8c1fa8899"
MANIFEST = "spikes/m0-006/evidence/live-artifact-manifest.json"


def original(path):
    return subprocess.check_output(["git", "show", f"{MERGE}:{path}"], cwd=REPO)


def v1_1(path):
    return subprocess.check_output(["git", "show", f"{V1_1_MERGE}:{path}"], cwd=REPO)


def v1_2(path):
    return subprocess.check_output(["git", "show", f"{V1_2_MERGE}:{path}"], cwd=REPO)


def v1_3(path):
    return subprocess.check_output(["git", "show", f"{V1_3_MERGE}:{path}"], cwd=REPO)


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
v1_2_architecture = {
    "docs/architecture/implementation-plan.md": "8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145",
    "docs/architecture/decision-ledger.md": "97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
for path, expected in v1_2_architecture.items():
    assert digest(v1_2(path)) == expected, f"archived v1.2 architecture mismatch: {path}"

v1_3_architecture = {
    "docs/architecture/implementation-plan.md": "b730c0dc274af8180a9aae3290189a8fd61b6b92e06681d345fe5d9aab22c06d",
    "docs/architecture/decision-ledger.md": "d4297182b12978822dae124a040a0d47aafcdb7749f7ad8602f0626e964937e9",
}
for path, expected in v1_3_architecture.items():
    assert digest(v1_3(path)) == expected, f"archived v1.3 architecture mismatch: {path}"

current_architecture = {
    "docs/architecture/implementation-plan.md": "cd59fd361d69adc3f307ee9b88ba1f5509ffeefb68aea90a15f9b88757b4e792",
    "docs/architecture/decision-ledger.md": "3d1e8fe50c948822ba3403facfc142402d4fc6631d8d667a2e3341ff6cdbd802",
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
    "archivedV1_2Ref": V1_2_MERGE,
    "archivedV1_2Sha256": v1_2_architecture,
    "archivedV1_3Ref": V1_3_MERGE,
    "archivedV1_3Sha256": v1_3_architecture,
    "currentArchitectureVersion": "1.4",
    "currentArchitectureSha256": current_architecture,
}, sort_keys=True))
