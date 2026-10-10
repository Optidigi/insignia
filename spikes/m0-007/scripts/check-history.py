#!/usr/bin/env python3
"""Verify frozen receipts, architecture archives and the owner-amended v1.6 record.

Each archived version is checked at its fixed merge. Current v1.6 commercial governance plus M5-017 hashes are
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

pre_m5_017_architecture = {
    "docs/architecture/implementation-plan.md": "cd59fd361d69adc3f307ee9b88ba1f5509ffeefb68aea90a15f9b88757b4e792",
    "docs/architecture/decision-ledger.md": "3d1e8fe50c948822ba3403facfc142402d4fc6631d8d667a2e3341ff6cdbd802",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}

# The principal-authorized M5-017 addition preserves the prior approved document binding.
M5_017_BASE = "4bba14fb4415815557ffa5f1e600427a62128489"
for path, expected in pre_m5_017_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{M5_017_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-M5-017 architecture mismatch: {path}"

pre_autonomy_architecture = {
    "docs/architecture/implementation-plan.md": "c4425cf88b3ef4131f114d54ba367d8a285b340a2e3c1a2182b9172d313d0822",
    "docs/architecture/decision-ledger.md": "ed8390b3337ce179c5afc810f08cd012ed8ab55ba3ae4a8a67e08fd144ec8f96",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
# Owner-authorized delivery amendment retains the complete prior technical record.
PRE_AUTONOMY_BASE = "7bfba46e79ff2f9208d13f5712918f357b5836b4"
for path, expected in pre_autonomy_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_AUTONOMY_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-autonomy architecture mismatch: {path}"

pre_commercial_architecture = {
    "docs/architecture/implementation-plan.md": "3abb753e608907122f81f37143d131ce61244b74a7c4a3396cc1cc6c44bbf38f",
    "docs/architecture/decision-ledger.md": "c453be74606f1b122c27b8b43169f61c6ca6f9f04e9858f112070bd3a33dc4c2",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
# Manual owner commercial amendment retains the prior delivery and technical record.
PRE_COMMERCIAL_BASE = "b5594f4b92216194a1c580dffa1e7f06f93a4ad4"
for path, expected in pre_commercial_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_COMMERCIAL_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-commercial architecture mismatch: {path}"

current_architecture = {
    "docs/architecture/implementation-plan.md": "490d7de1ff5eb338c17fea8441e8724e2b1f9345263a110eb661fba005ea976f",
    "docs/architecture/decision-ledger.md": "52fd7e0f1d61c4bbf6ed4d0434cc44083715e58127c8cf0a0e8f98b5b724de88",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
OWNER_AUTHORITY = "docs/delivery/authority/milestone-autonomy-2026-10-09.md"
OWNER_AUTHORITY_SHA256 = "710cda826d77a712a89c791cc5d71144c215b2c7eebe6ce9f689638ba405a327"
assert digest((REPO / OWNER_AUTHORITY).read_bytes()) == OWNER_AUTHORITY_SHA256, "owner authority mismatch"

COMMERCIAL_OWNER_AUTHORITY = "docs/delivery/authority/commercial-single-plan-2026-10-10.md"
COMMERCIAL_OWNER_AUTHORITY_SHA256 = "72f9bb4840502e2973f7a22538f02e664ce4969eb7598a380fb2fdb0b9dab4b0"
COMMERCIAL_OWNER_ATTESTATION = "docs/delivery/evidence/m5-commercial-owner-decision/owner-terms.json"
COMMERCIAL_OWNER_ATTESTATION_SHA256 = "6422ff127526a8492047e5f67c3ec798dabddb985e0711349fa38cbc7f763c36"
# Dated manual owner decisions, not provider receipts or native/configuration approval.
assert digest((REPO / COMMERCIAL_OWNER_AUTHORITY).read_bytes()) == COMMERCIAL_OWNER_AUTHORITY_SHA256, "commercial owner authority mismatch"
assert digest((REPO / COMMERCIAL_OWNER_ATTESTATION).read_bytes()) == COMMERCIAL_OWNER_ATTESTATION_SHA256, "commercial owner attestation mismatch"

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
    "preM5_017Ref": M5_017_BASE,
    "preM5_017Sha256": pre_m5_017_architecture,
    "preAutonomyRef": PRE_AUTONOMY_BASE,
    "preAutonomySha256": pre_autonomy_architecture,
    "ownerAuthority": OWNER_AUTHORITY,
    "ownerAuthoritySha256": OWNER_AUTHORITY_SHA256,
    "preCommercialRef": PRE_COMMERCIAL_BASE,
    "preCommercialSha256": pre_commercial_architecture,
    "commercialOwnerAuthority": COMMERCIAL_OWNER_AUTHORITY,
    "commercialOwnerAuthoritySha256": COMMERCIAL_OWNER_AUTHORITY_SHA256,
    "commercialOwnerAttestation": COMMERCIAL_OWNER_ATTESTATION,
    "commercialOwnerAttestationSha256": COMMERCIAL_OWNER_ATTESTATION_SHA256,
    "currentArchitectureVersion": "1.6 owner commercial amendment + delivery amendment + M5-017",
    "currentArchitectureSha256": current_architecture,
}, sort_keys=True))
