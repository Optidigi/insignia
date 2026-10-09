**CHANGES_REQUIRED — Standards/security**

1. **P2 — [.github/PULL_REQUEST_TEMPLATE.md:36](/home/serveradmin/insignia-milestone-autonomy-worktree/.github/PULL_REQUEST_TEMPLATE.md:36): active template reinstates the superseded per-PR gate.** Lines 32–36 require a principal verdict and human merge authorization before merging or continuing. This violates the [owner authority, §§11–23](/home/serveradmin/insignia-milestone-autonomy-worktree/docs/delivery/authority/milestone-autonomy-2026-10-09.md:11), the adoption requirement to reconcile active templates, and pinned `writing-for-agents` guidance on one authoritative workflow. **Counterexample:** a new M5 collector PR populated from GitHub’s default template instructs the orchestrator to stop for external principal review. **Smallest correction:** replace that section with independent local review/exact-head qualification and delegated normal merge/continuation; reserve principal acceptance for completed milestones and preserve repository-enforced approvals.

Verified clean status and exact refs:

- Base/effective merge-base: `7bfba46e79ff2f9208d13f5712918f357b5836b4`
- Head: `d6c74a2d605606c0ada497fefa9996808854d7d4`
- Tree: `6032a5782c7fb145c901d13a193d486d043c7a4c`

All 59 copied blobs match Git and exported bytes. The baseline plan is complete at 131485 bytes; the archived state is byte-exact. PR58’s ordered parents/tree, original review hashes and retained CI receipts agree locally. M5 entry is PR26, `f8fff36…`, rather than PR58.

The complete guard correction retains historical assertions/hashes and binds the governance amendment and owner authority. Original failed CI and supplied RED/GREEN controls remain distinct. No additional actionable Fowler finding emerged.

Loaded authority permits the orchestrator to authorize, implement, independently review and normally merge M5 collector and admission/bootstrap/worker/privacy corrections after qualification. Missing native access, host resources, commercial eligibility and installation/deployment effects require explicit owner allocation. The routine principal checkpoint is **completed M5, before M6**. RED uninstall and native/privacy/readiness/merchant-flow blockers remain open.

Static local review only: no edits, tests/builds, services, credential reads, network operations or delegation. Final-head CI and live remote state were not qualified here; actual model/effort requires launcher attestation. No credential/network isolation claimed. This verdict is independent local governance qualification, **not principal approval or M5 PASS**.