**CHANGES_REQUESTED — two unresolved material findings against the exact candidate.**

Verified base `8a84ddeaf277368852d224915abe6d4a93a3d8a4`, HEAD `f46535ce995f4e3ae05431b4888aa29028dc738f`, tree `e1fa88688a0f12609cf62cd45c1aa39d5bda8e24`. The worktree remained clean. `git diff --check base...HEAD` passed. Captured full diff: 712,278 bytes, SHA-256 `a31290d605c51910771957166879391060709073ddad6c57c538bc94961da7f9`.

1. **P1 — An ambiguous restoration permits another automatic provider mutation.**

   [activation.ts:383](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:383) calls `restore`; a `RESTORATION_PENDING` response leaves the same durable state. The next invocation can call `restore` again. [availability-hold.ts:518](/home/serveradmin/insignia-m5-003-worktree/packages/shopify/src/availability-hold.ts:518) returns that result after an ambiguous write followed by unchanged held-state readback.

   **Invariant:** brief §§7 and 14.6 require crash recovery to avoid blindly replaying restoration. Unchanged readback establishes the currently observed state; it does not establish settlement of an outstanding non-CAS write.

   **Reproducer:** activate under an owned hold; let restoration time out while remaining unresolved; return the unchanged owned snapshot; retry `advance`. An independently executed in-memory probe produced `RESTORATION_PENDING` with one restoration call, then `ACTIVE` with **two** calls. A crash after dispatch but before persistence has the same missing dispatch-history distinction.

   **Correction:** persist restoration dispatch intent before mutation and distinguish undispatched work from an unknown dispatched outcome. After ambiguity or crash, retries must observe or require trusted settlement before authorizing another write. Retain coordinator, PostgreSQL and adapter tests where the first write remains in flight despite unchanged readback. Existing adapter “does not retry” tests inspect only one invocation; the lost-response coordinator tests change remote state immediately.

2. **P1 — Recovering an abandoned mode change blocks subsequent production publication.**

   [production-publication.ts:261](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/repositories/production-publication.ts:261) requires the effective operation’s sequence to equal the latest retained publication sequence. [availability-recovery.ts:133](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/repositories/availability-recovery.ts:133) correctly resolves/abandons the failed request while preserving the previous effective pointer and monotonic sequence.

   **Invariant:** §§7, 8 and 14.7 require completed recovery to permit safe subsequent work while preserving historical activation.

   **Reproducer:** activate required revision at sequence 1; prepare optional revision at sequence 2; crash before acquisition dispatch; resolve it through trusted settled-write recovery with original availability unchanged; prepare a distinct sequence-3 request. Preparation rejects with **“Durable effective publication is not coherent.”** An independently executed synthetic SQL-driver probe reproduced that rejection without connecting to or mutating a database.

   **Correction:** distinguish the latest retained request from the effective operation when intervening requests have been validly resolved/abandoned. Revalidate current installation, effective projection and absence of unresolved work before allocating the next sequence. Preserve the quote-issuance guard, immutable history and monotonic sequence. Add recovery-followed-by-publication tests with an existing effective revision for both mode transitions. The current positive abandonment test starts with no effective revision.

The review covered full current changed source/tests and interacting application publication, keys, artifacts and readiness; database facade, tenant/config/signing/publication/recovery repositories and migrations; Shopify authentication, hold and metafield-CAS adapters; Admin composition, service, editor and shared state; geometry/renderer paths; retained browser regressions; and relevant root boundaries, build scripts and CI. It was a full-source review, not a correction-delta review.

| Brief sections | Disposition |
|---|---|
| 1–2: hold contract/adapter | Binding, snapshots and drift checks inspected; finding 1 remains |
| 3: classifier | First/mode-change hold and same-mode no-hold paths inspected |
| 4: immutable evidence | Evidence/effective activation share a transaction; immutable guards inspected |
| 5: RELEASE_BOUND | Diagnostic/source evidence rejected; production authority remains unwired |
| 6–7: coordinator/recovery | Both findings remain; retained crash matrix misses their cases |
| 8: Admin/recovery reads | Terminal precedence and historical recovery visibility inspected |
| 9: large-history plans | Final artifact supports the required local query-plan claim |
| 10: provider prohibition | No provider/network/credential operations performed |
| 11: tests | Broad retained coverage; required regressions identified above |
| 12: work split | Historical implementation records inspected; this reviewer did not delegate |
| 13: fresh reviews | Spec disposition is changes requested; separate security disposition is outside this report |
| 14: acceptance | Recovery requirements and “no unresolved material issue” condition remain unsatisfied |
| 15–16: scope/handoff | Review boundary preserved; no release, merge or gate adjudication |

Lock-order inspection found no additional material inversion: competing durable mutations serialize through the shop lock. I inspected final freshness checks, public admission closure, absence of controller-accessible lower-level activation, immutable resolution evidence, the one-time marker guard, and migration down/up logic. Initial findings at `09e301f` remain preserved; their corrections were independently inspected.

The final query-plan artifact measures actual Admin `configs.getByProduct` separately from intentionally rejected quote issuance. It contains 100,001 retained operations, including 50,000 newer structurally resolved requests. Pointer, fallback and Admin plans return one row using the intended indexes; fallback has no history sort. Recorded execution times are 0.207, 3.097 and 0.015 ms. All five artifact hashes match local files. Structural audit fixtures are **not validated operator decisions**.

**Independently executed checks:** three application/database/Shopify TypeScript `--noEmit --incremental false` compilations; two focused Admin test files; secret/fixture scan; historical architecture/receipt verification; saved setup-receipt verification; Git checks; both synthetic probes. These completed successfully, with the probes demonstrating the findings.

**Inspected receipts, not rerun:** root checks, PostgreSQL 84/84, HTTP 16/16, worker 15/15, geometry stress 100/100, renderer expected-failure control, and migration rollback/up. All 39 sanitized log hashes match their registers. No PostgreSQL suites, browser/server processes or hosted CI were independently run.

Explicit limitations remain: no real all-channel or in-flight proof; the synthetic status adapter has no native atomic CAS; no production release source or genuine `RELEASE_BOUND` record; no production recovery authority wired; `DEV_PREVIEW_OBSERVED` remains unqualified; and **no M5 milestone or gate pass**. This source review is not principal gate adjudication.

Runtime model/effort launch metadata was not exposed to this interface, so I cannot independently certify actual GPT-6.1-sol/high execution.
