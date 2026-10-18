#!/usr/bin/env python3
"""Verify frozen receipts, architecture archives and the owner-amended delivery record.

Each archived version is checked at its fixed merge. Current owner amendments plus M5-017 hashes are
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

pre_pragmatic_architecture = {
    "docs/architecture/implementation-plan.md": "490d7de1ff5eb338c17fea8441e8724e2b1f9345263a110eb661fba005ea976f",
    "docs/architecture/decision-ledger.md": "52fd7e0f1d61c4bbf6ed4d0434cc44083715e58127c8cf0a0e8f98b5b724de88",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
# Owner delivery-conventions amendment preserves the exact prior technical/commercial record.
PRE_PRAGMATIC_BASE = "b45d99a739f2e98fb01685944a37bab5d07413ef"
for path, expected in pre_pragmatic_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_PRAGMATIC_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-pragmatic architecture mismatch: {path}"

pre_simple_delivery_architecture = {
    "docs/architecture/implementation-plan.md": "114b27925753aa3321a5d8b9329abf2bca3d3e666a5a3f680413b6d57e1f56cd",
    "docs/architecture/decision-ledger.md": "9c322ad61f75a1fb9e852d383049445bba6a01641706f5c6307f275d1188461c",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
# Preserve the exact previously approved record at the PR96 checkpoint.
PRE_SIMPLE_DELIVERY_BASE = "8775caa3ba878109807e0ca3a7cf175d7246a102"
for path, expected in pre_simple_delivery_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_SIMPLE_DELIVERY_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-simple-delivery architecture mismatch: {path}"

pre_m8_purchase_proof_architecture = {
    "docs/architecture/implementation-plan.md": "43782125b80a5d0307b4ad00f5c7908829de6ce7eebaf94bdd9a9f82b133aed7",
    "docs/architecture/decision-ledger.md": "95d19f784aba249a82040e08349196b453c38eacf1682bffc9ca5a9ab3cc95ba",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
# The owner-delegated M8 evidence decision retains the exact earlier architecture.
PRE_M8_PURCHASE_PROOF_BASE = "9059c270923ecb5c10bf6bf64deb23e6da8b4849"
for path, expected in pre_m8_purchase_proof_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_M8_PURCHASE_PROOF_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-M8-purchase-proof architecture mismatch: {path}"

# Preserve the exact governance/architecture before autonomous delivery; retain every older check.
PRE_AUTONOMOUS_DELIVERY_BASE = "6d81bf7551dfa94caf77f88aa75130ab9da62103"
pre_autonomous_delivery_architecture = {
    "docs/architecture/implementation-plan.md": "c0e4b8c41d4da5828eba152a8059f3a3e27722cb104c441daa3bdfe70cef22b6",
    "docs/architecture/decision-ledger.md": "d3db631464f7166599872277c3f5f0d88859230040742ce59f6e50429f5df568",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
for path, expected in pre_autonomous_delivery_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_AUTONOMOUS_DELIVERY_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-autonomous-delivery architecture mismatch: {path}"
AUTONOMOUS_DELIVERY_OWNER_AUTHORITY = "docs/delivery/authority/autonomous-delivery-2026-10-13.md"
# The later Insignia-only operational clarification appends to the current record;
# preserve the original owner direction at the verified PR113 integration.
PRE_INSIGNIA_ONLY_CLARIFICATION_BASE = "a1e0cee2f4f93a207e08aeee5577e8328a49e0c2"
archived_owner_authority = subprocess.check_output(
    ["git", "show", f"{PRE_INSIGNIA_ONLY_CLARIFICATION_BASE}:{AUTONOMOUS_DELIVERY_OWNER_AUTHORITY}"], cwd=REPO
)
assert digest(archived_owner_authority) == "cb90231944c8476d695dcf8e8e656a3c58f2022e26ff4949f8f8de9e4ae431bf", "original autonomous delivery owner authority mismatch"
AUTONOMOUS_DELIVERY_OWNER_AUTHORITY_SHA256 = "5476ba61efe9d9aecc12fe3d63aa8d6ce5267ce38d0f43772a5182ea694f6e58"
assert digest((REPO / AUTONOMOUS_DELIVERY_OWNER_AUTHORITY).read_bytes()) == AUTONOMOUS_DELIVERY_OWNER_AUTHORITY_SHA256, "autonomous delivery owner authority mismatch"

# Preserve the complete pre-Lean architecture and all earlier dated checks.
PRE_LEAN_BASE = "0c3672e2f38a7c6421f9b4791a3830c2db5aaaf8"
pre_lean_architecture = {
    "docs/architecture/implementation-plan.md": "7eece50a8030a089e95e2a533a418e75c25d0024364e7a645268bb5c25bf27eb",
    "docs/architecture/decision-ledger.md": "536576973a57d721a8af6155b709b368421ba08c98dbae70f391f21ad49589cc",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209",
}
for path, expected in pre_lean_architecture.items():
    archived = subprocess.check_output(["git", "show", f"{PRE_LEAN_BASE}:{path}"], cwd=REPO)
    assert digest(archived) == expected, f"pre-Lean architecture mismatch: {path}"
LEAN_OWNER_AUTHORITY = "docs/delivery/authority/lean-v1-2026-10-15.md"
LEAN_OWNER_AUTHORITY_SHA256 = "f3b4ccc9514a55af046e8de9f57f2b29707fb572bc45130ad0e0390ae64d31de"
assert digest((REPO / LEAN_OWNER_AUTHORITY).read_bytes()) == LEAN_OWNER_AUTHORITY_SHA256, "Lean owner authority mismatch"
# Preserve the pre-exception ledger while binding the exact17October owner grant.
PRE_INSPECTOR_EXCEPTION_BASE = "26a62386aef0ef454cea48f69b64caf526c4b72e"
archived_ledger = subprocess.check_output(["git", "show", f"{PRE_INSPECTOR_EXCEPTION_BASE}:docs/architecture/decision-ledger.md"], cwd=REPO)
assert digest(archived_ledger) == "9e2dc910417c942b8aa3ca5e6428f084ed065063ecef7aed76d1179f6d6d41b9", "pre-inspector-exception ledger mismatch"
BOUNDED_QUALIFICATION_AUTHORITY = "docs/delivery/evidence/lean-v1/bounded-native-qualification-owner-grant-2026-10-17.json"
assert digest((REPO / BOUNDED_QUALIFICATION_AUTHORITY).read_bytes()) == "5919b0b53f06abbed6ab30c6a99feb442215ecc091ac52cdea07334dca0f3e41", "bounded qualification owner authority mismatch"
# Preserve the plan before the18October owner-authorized unattended lifecycle
# and seven-day isolated-backup clarification; dated records remain exact.
PRE_TECHNICAL_COMPLETION_BASE = "ab2a71356d816a79dc859a472a64458f2dc020e5"
archived_plan = subprocess.check_output(
    ["git", "show", f"{PRE_TECHNICAL_COMPLETION_BASE}:docs/architecture/implementation-plan.md"], cwd=REPO
)
assert digest(archived_plan) == "82ca1b0be57048d2ddcb3e33236a3ceb36702d6fda9af907b9df20c5cc9a4054", "pre-technical-completion plan mismatch"
TECHNICAL_COMPLETION_AUTHORITY = "docs/delivery/authority/technical-merchant-completion-2026-10-18.json"
assert digest((REPO / TECHNICAL_COMPLETION_AUTHORITY).read_bytes()) == "59ec251dd86af559aac07ab07dcf5a3c4cc3c838729644d0977547d4982aee2a", "technical completion owner authority mismatch"
# Current documents include only those explicit amendments.
current_architecture = {
    "docs/architecture/implementation-plan.md": "9200937b9b39d5ed7915c8aeea9eb899689470b500b3e7229541c584fbc1371e",
    "docs/architecture/decision-ledger.md": "dbc2391a4384538ac4d6f9eadc3eda2fd47ed85b169f4ce8a0cb0cc724af9933",
    "docs/architecture/OPTION-A-APPROVED.md": "321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209"
}
M8_PURCHASE_PROOF_OWNER_AUTHORITY = "docs/delivery/authority/m8-purchase-proof-ownership-2026-10-13.md"
M8_PURCHASE_PROOF_OWNER_AUTHORITY_SHA256 = "b2b1a4f888473ae553d0d23dbf0a6affac9b83b43ad48d38325ceca58ed3fad9"
assert digest((REPO / M8_PURCHASE_PROOF_OWNER_AUTHORITY).read_bytes()) == M8_PURCHASE_PROOF_OWNER_AUTHORITY_SHA256, "M8 purchase-proof owner authority mismatch"

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

PRAGMATIC_OWNER_AUTHORITY = "docs/delivery/authority/pragmatic-delivery-2026-10-11.md"
PRAGMATIC_OWNER_AUTHORITY_SHA256 = "8698d41d0327a7f9a9577dc97fe4d9ab01029093659390ebab803e4cb74b4529"
assert digest((REPO / PRAGMATIC_OWNER_AUTHORITY).read_bytes()) == PRAGMATIC_OWNER_AUTHORITY_SHA256, "pragmatic owner authority mismatch"

SIMPLE_DELIVERY_OWNER_AUTHORITY = "docs/delivery/authority/simple-delivery-2026-10-12.md"
SIMPLE_DELIVERY_OWNER_AUTHORITY_SHA256 = "1f451c6da2fb1a1cf6feb43d8bee839c893a326c5b30fe4265e4cd85c65e053d"
SIMPLE_DELIVERY_PACKAGE_PLAN = "docs/delivery/history/simple-delivery-2026-10-12/REVISED-PLAN.md"
SIMPLE_DELIVERY_PACKAGE_PLAN_SHA256 = "6277c4b7b3bcf29d63082caf0e70629611a1d2f77d51dfeece3b1c765c4906ed"
assert digest((REPO / SIMPLE_DELIVERY_OWNER_AUTHORITY).read_bytes()) == SIMPLE_DELIVERY_OWNER_AUTHORITY_SHA256, "simple-delivery owner authority mismatch"
assert digest((REPO / SIMPLE_DELIVERY_PACKAGE_PLAN).read_bytes()) == SIMPLE_DELIVERY_PACKAGE_PLAN_SHA256, "supplied owner package plan mismatch"

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
    "prePragmaticRef": PRE_PRAGMATIC_BASE,
    "prePragmaticSha256": pre_pragmatic_architecture,
    "pragmaticOwnerAuthority": PRAGMATIC_OWNER_AUTHORITY,
    "pragmaticOwnerAuthoritySha256": PRAGMATIC_OWNER_AUTHORITY_SHA256,
    "preSimpleDeliveryRef": PRE_SIMPLE_DELIVERY_BASE,
    "preSimpleDeliverySha256": pre_simple_delivery_architecture,
    "simpleDeliveryOwnerAuthority": SIMPLE_DELIVERY_OWNER_AUTHORITY,
    "simpleDeliveryOwnerAuthoritySha256": SIMPLE_DELIVERY_OWNER_AUTHORITY_SHA256,
    "simpleDeliveryPackagePlanSha256": SIMPLE_DELIVERY_PACKAGE_PLAN_SHA256,
    "preM8PurchaseProofRef": PRE_M8_PURCHASE_PROOF_BASE,
    "preM8PurchaseProofSha256": pre_m8_purchase_proof_architecture,
    "m8PurchaseProofOwnerAuthority": M8_PURCHASE_PROOF_OWNER_AUTHORITY,
    "m8PurchaseProofOwnerAuthoritySha256": M8_PURCHASE_PROOF_OWNER_AUTHORITY_SHA256,
    "currentArchitectureVersion": "1.7 Lean V1 with first-version direction and scoped host exception (17 October 2026)",
    "preLeanRef": PRE_LEAN_BASE,
    "preLeanSha256": pre_lean_architecture,
    "leanOwnerAuthoritySha256": LEAN_OWNER_AUTHORITY_SHA256,
    "currentArchitectureSha256": current_architecture,
    "preAutonomousDeliveryRef": PRE_AUTONOMOUS_DELIVERY_BASE,
    "preAutonomousDeliverySha256": pre_autonomous_delivery_architecture,
    "autonomousDeliveryOwnerAuthoritySha256": AUTONOMOUS_DELIVERY_OWNER_AUTHORITY_SHA256,
}, sort_keys=True))
