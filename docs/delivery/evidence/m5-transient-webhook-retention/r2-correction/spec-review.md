**CHANGES_REQUIRED — Spec/correctness**

1. **P2 — [packages/observability/src/index.ts:79](/home/serveradmin/insignia-m5-retention-worktree/packages/observability/src/index.ts:79): uninstall retention alert loses its category.** Current R2 and the [bounded-accounting contract](/home/serveradmin/insignia-m5-retention-worktree/docs/delivery/M5-TRANSIENT-WEBHOOK-RETENTION.md:22) require a fixed, count-only uninstall blocker alert. [Maintenance emits](/home/serveradmin/insignia-m5-retention-worktree/apps/worker/src/handlers.ts:80) `UninstallPayloadRetentionBlocked`, but `safeDetails` omits it from its allowlist and silently drops `errorClass`.

   Concrete counterexample: one processed, overdue uninstall body produces `blockedUninstallIds=[id]`, with no unresolved or other blockers. Its log retains only the generic event and count; an alert matching the required uninstall category never fires.

   Smallest fix: allowlist that fixed category and add a maintenance-to-public-logger regression asserting its bounded count/category and absence of IDs or body data.

The R1 destructive-eligibility and SCRAM corrections are addressed in current source. Timely erasure and generic uninstall authority remain explicitly unresolved; retained historical negatives are not promoted to successful qualification.

Verified clean worktree and exact refs:

- Base/effective merge-base: `7fc8688b2d59c191486771192d4f466cbc226703`
- HEAD: `66b1ab75dd1d2e31c8adf40a903df299f38822d4`
- Tree: `c33b578e0dd08dd457e9c4690e2c8a2f373a4432`

Reviewed complete changed files and interacting contracts through static local reads. No edits, tests/builds, credential reads, network/service access or delegation. Exact-head CI remains unverified here. Actual model/effort metadata is unavailable, so GPT-6.1-sol/high cannot be attested. No isolation, native, deployment, M5/G7 or principal acceptance claim.