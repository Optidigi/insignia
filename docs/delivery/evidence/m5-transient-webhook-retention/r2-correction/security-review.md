**CHANGES_REQUIRED — security axis**

1. **P2 — [packages/observability/src/index.ts:86](/home/serveradmin/insignia-m5-retention-worktree/packages/observability/src/index.ts:86): required uninstall-retention alert category is discarded.** Maintenance emits `UninstallPayloadRetentionBlocked`, but `safeDetails()` omits it from the allowlist. For an overdue **processed** uninstall-labelled mixed-body receipt, `blockedUninstallIds` is populated while `unresolvedExpiredIds` is empty. The public event therefore retains only a generic rejection/count; monitoring by the required blocker category misses it. This violates the bounded categorized-alert contract in [M5-TRANSIENT-WEBHOOK-RETENTION.md:22](/home/serveradmin/insignia-m5-retention-worktree/docs/delivery/M5-TRANSIENT-WEBHOOK-RETENTION.md:22). **Smallest fix:** allowlist this exact class and add a regression through the real observability logger asserting category/count survive while identifiers and payload remain absent.

R1’s destructive-erasure counterexample is addressed by deferring raw-body erasure. The SCRAM fixture correction is present. Timely erasure, generic uninstall generation safety, native/deployment qualification, and exact-head CI remain unresolved or pending as documented.

Verified clean worktree and actual refs:

- Base/effective merge base: `7fc8688b2d59c191486771192d4f466cbc226703`
- HEAD: `66b1ab75dd1d2e31c8adf40a903df299f38822d4`
- Tree: `c33b578e0dd08dd457e9c4690e2c8a2f373a4432`

Complete changed files and interacting security contracts were reviewed statically. No edits, tests/builds, credential reads, network/service access, or delegation occurred; no credential/network-isolation claim is made. Recorded evidence was inspected, not rerun. Actual runtime model/effort metadata was unavailable, so requested GPT‑6.1‑sol/high provenance cannot be independently attested.