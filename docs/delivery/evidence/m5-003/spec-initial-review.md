**Spec/correctness disposition: changes requested. Three unresolved material findings.** This is a local review, not principal approval or gate adjudication.

Reviewed base `8a84ddeaf277368852d224915abe6d4a93a3d8a4` through HEAD `09e301fb3274f5d0f7f77c27a14deef3ae7ef293`, tree `a0ab43f9204f6261f382f813fd5d0c53621be481`. Final worktree status is clean. An initial untracked boundary probe disappeared during review; I made no changes.

1. **P1 — Public publication admission can bypass durable hold ownership.**
   [durable-core.ts:66](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/durable-core.ts:66), [production-publication.ts:561](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/repositories/production-publication.ts:561).

   Brief §3 requires an all-channel admission hold for first publication and mode changes. The public factory still accepts `admission.established()` supplied by its caller, and the publisher trusts its boolean before remote mutations.

   **Source reproducer:** create the public publisher with `admission: { established: async () => true }`, prepare a required→optional publication without an activation-state hold, then advance it. Policy and registration can reach remote-ready while the product remains available. Retained tests already exercise this public callback. The coordinator still protects effective activation, but publication admission is bypassable.

   **Correction:** remove caller-controlled admission from the public facade, or make every production publisher independently verify the durable owned hold. Keep synthetic admission premises internal to tests. Add a public-facade test proving mode-change publication cannot dispatch without that hold.

2. **P1 — Operator recovery cannot ever be completed.**
   [activation.ts:281](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:281), [activation.ts:345](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:345), [activation migration:84](/home/serveradmin/insignia-m5-003-worktree/packages/database/migrations/20260930000900_m5_activation.sql:84), [production-publication.ts:318](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/repositories/production-publication.ts:318).

   Brief §14.7 requires restoration conflicts to be explicit **and recoverable**. `OPERATOR_HOLD` immediately returns without observation, its SQL transition is terminal, and unresolved hold records block every subsequent publication. No exposed recovery-completion operation exists.

   **Executed synthetic reproducer:** activate, successfully restore remotely but lose the response, then retry. The provider is available; the durable state becomes `OPERATOR_HOLD` and remains there. The same permanent block follows an acquisition-intent crash before dispatch. Manual provider restoration cannot close the durable record.

   **Correction:** provide a scoped, audited operator recovery-completion path that validates the permitted current state, preserves historical activation evidence, and releases the publication block without blindly replaying mutations. Test completion after lost responses and across supersession/reinstall.

3. **P2 — Admin masks terminal publication failures with stale activation state.**
   [activation-state.ts:13](/home/serveradmin/insignia-m5-003-worktree/apps/web/src/server/admin/activation-state.ts:13).

   Brief §8 requires truthful repair states. Activation-kind handling precedes publication-phase handling. A publisher CAS conflict changes progress to `conflict` while activation state can remain `HELD`.

   **Executed reproducer:** project `{ phase: 'conflict', activationKind: 'HELD', effectiveOperationId: null }`. It returns `HELD_ACTIVATION_PENDING`. The corresponding terminal `operator-hold` phase is also masked.

   **Correction:** give terminal publication failures precedence and project an explicit conflict/operator state. Add tests for both terminal phases combined with retained activation states.

There is also a **required evidence correction for §9**: [large-history.mjs:148](/home/serveradmin/insignia-m5-003-worktree/scripts/m5-003/large-history.mjs:148) captures `acceptedQuotes.getEffective`; Admin reads through [merchant-config.ts:233](/home/serveradmin/insignia-m5-003-worktree/apps/web/src/server/merchant-config.ts:233). The captured pointer/fallback/effective plans are bounded, but the requested actual Admin effective-read plan remains uncaptured. Capture that seam; this is not evidence of a demonstrated performance regression.

Scope covered full changed executable source/tests, interacting publication/key/artifact/readiness code, database facade and relevant repositories/migrations, Shopify authentication/hold/CAS adapters, Admin composition/service/editor/state, geometry/renderer paths, and relevant root boundary/build/CI checks. Historical authority and sanitized evidence were inspected; the approved base’s ordered parents/tree match, and architecture, Functions, fixtures and spike paths remain unchanged.

| Brief sections | Disposition |
|---|---|
| 1–2: hold contract/adapter | Implemented locally; provider qualification remains open |
| 3: admission classifier | Classifier correct; public bypass in finding 1 |
| 4–5: immutable evidence/release trust | No additional material source finding |
| 6–7: coordinator/crash recovery | Atomic commit and conservative retries present; recovery completion missing |
| 8: Admin repair state | Finding 3 |
| 9: history plans | Bounded captured plans; actual Admin seam missing |
| 10: no provider work | Observed review restriction |
| 11: tests | Broad retained coverage; bypass/recovery-completion/terminal-state gaps |
| 12: work split | Preserved local role records inspected |
| 13–14: reviews/acceptance | Unresolved findings prevent a clean Spec disposition |
| 15: exclusions | Preserved |
| 16: handoff | Requires corrections and final candidate-bound review/CI evidence |

Lock-order inspection found no additional material inversion: competing durable mutations serialize through the shop lock. Evidence insertion, progress activation and the effective pointer commit share one transaction. Retained tests cover rollback, concurrent attempts, epoch/reinstall/supersession races, drift and no blind mutation retries; they do not demonstrate completed operator recovery.

**Executed independently:** read-only Git/source/hash inspections; two Node tests passed with zero skips; in-memory synthetic probes confirmed same-mode idempotency with zero acquisitions and findings 2–3. No PostgreSQL, browser or provider execution occurred.

**Inspected logs only:** root suite success, PostgreSQL 73/73, HTTP composition 14/14, geometry stress 100/100 without retries, and boundary/control receipts. Sanitized log hashes and query-artifact bindings were checked. These are inspected receipts, not independently rerun results or verified final-head hosted CI.

Explicit limitations remain: no real all-channel or in-flight proof; the synthetic status adapter has no native atomic CAS; no production release-source implementation or `RELEASE_BOUND` record; `DEV_PREVIEW_OBSERVED` remains unqualified. Injected synthetic release premises establish no released evidence. No M5 completion or gate pass is asserted.
