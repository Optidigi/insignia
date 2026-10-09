**CHANGES_REQUIRED**

1. **P2 — Standards/evidence preservation:** [writer-host-document.md:32](/home/serveradmin/insignia-m5-inventory-artifact-worktree/docs/delivery/evidence/m5-host-inventory/writer-host-document.md:32) rewrites the archived writer snapshot to describe PR63’s new ceiling. [local-checks.json:141](/home/serveradmin/insignia-m5-inventory-artifact-worktree/docs/delivery/evidence/m5-host-inventory/local-checks.json:141) explicitly identifies it as the original historical document and binds SHA `7c698b5f…`. Concrete counterexample: the original snapshot at `57afc7a6d14e8abdf09220d6da145de4f1a89430` says 64 MiB and matches that recorded hash; HEAD instead describes 70,310,306 bytes and hashes to `9e0ee0d4…`. This violates [operating-model.md:19](/home/serveradmin/insignia-m5-inventory-artifact-worktree/docs/delivery/operating-model.md:19) and contradicts the new [manifest.json:44](/home/serveradmin/insignia-m5-inventory-artifact-worktree/docs/delivery/evidence/m5-inventory-artifact-size/manifest.json:44) claim that historical evidence was not rewritten. **Smallest fix:** revert this PR’s snapshot edit; keep the correction in the active operator document and new evidence. Earlier snapshot drift already exists at base and is not attributed to PR63.

No additional actionable implementation correctness/security findings. The package-only ceiling matches the historical receipt; SHA/path/type/stability checks, streaming bounds, deadlines, loader binding, metadata caps, fixed commands and consumed reservations remain intact. New evidence appropriately leaves native failure cause UNKNOWN and M5/G7 blocked.

Verified clean worktree:

- HEAD: `861748fdb66687266708aed5d464676a1cf867d0`
- Tree: `2665f85ebb1a7ebb37de35796122cdfdf9d381fd`
- Base/effective merge-base: `1b1b206828ce17bd0e3158d0dbc787ed0d0e7903`

Reviewed complete changed implementation/tests/evidence and interacting host, phase, Admin collector/CLI, loader, allocation and prior controls.

Limits: static local source/Git/public-evidence inspection under enforced read-only filesystem/approval-never. No edits, tests/build/code execution, services/DB/SSH/network/provider/browser, credentials/env/.ssh/private-file reads or delegation. Recorded tests were inspected, not rerun; actual archive/private native evidence and current CI were not revalidated. Actual model/effort provenance cannot be independently attested here. No credential/network isolation or milestone acceptance is claimed.