**One unresolved material Standards/security finding: P2 — readiness can expire before activation or restoration.**

At [activation.ts:441](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:441), the final awaited `currentDay()` runs after release, Function, projection and hold freshness checks. Evidence is then committed without revalidating those observations. The restoration path has the same gap: [activation.ts:326](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:326) validates release readiness before subsequent awaited reads, then restores availability without checking it again.

The invariant is that activation and restoration require current, unexpired release authority and observations within the configured freshness budget.

I independently reproduced both cases using the current activation source transpiled entirely in memory, existing built key helpers, synthetic ports and a synthetic clock:

- **Activation:** release expires at `12:00:00.500`; observations are timestamped `12:00:00`; maximum age is 1,000 ms. The second `currentDay()` advances time by 2,000 ms and returns a valid day. Result: evidence committed at `12:00:02`, returning `ACTIVE`.
- **Restoration:** start from `activated / RESTORATION_PENDING` with an owned hold. A projection read advances time by 2,000 ms and returns a fresh matching projection. Result: one restoration dispatch and `ACTIVE`, despite expired release evidence and a 2,000 ms old Function observation.

**Necessary correction:** retain the complete validated readiness inputs and synchronously revalidate their expiry/freshness against one current timestamp after the final awaited precondition, immediately before commit or restoration dispatch. Add regression coverage for both delayed paths; failure must preserve the hold and prevent the relevant action. These injected `RELEASE_BOUND` premises are test inputs, never real released evidence.

Review basis:

- Base: `8a84ddeaf277368852d224915abe6d4a93a3d8a4`
- HEAD: `09e301fb3274f5d0f7f77c27a14deef3ae7ef293`
- Tree: `a0ab43f9204f6261f382f813fd5d0c53621be481`
- Final worktree: clean. An initial transient untracked boundary probe disappeared during review; this reviewer made no edits.
- PR #28’s approved ordered parents and tree are preserved.

I read the required authority documents, full new/changed source and tests, and interacting application publication/key/artifact/readiness logic; database facade, config/tenant/signing/publication repositories and migrations; Shopify authentication, hold and CAS adapters; web composition/service/editor/shared state; geometry/visualizer paths; and relevant boundary, CI and build tests.

Beyond the finding above, **no other unresolved material finding** emerged in tenant/product/generation fencing, immutable evidence and transaction boundaries, public-facade opacity, provider identity/readback/drift/deadline/body controls, error/secret containment, recovery, canonical metadata or release provenance. Browser and environment diagnostics do not gain release authority. No optional stylistic fixes are requested.

Commands independently executed, all exit 0:

- Git identity/status/diff checks, including `git diff --check`.
- Two focused admin activation-state/release tests: 2 passed.
- Secret/fixture provenance check.
- Historical architecture/receipt preservation check.
- Sanitized log hash verification: 18 logs matched.
- Both in-memory reproducers described above.

Separately, I inspected the supplied PostgreSQL, HTTP, root verification, stress, query-plan and retained failure logs. Their reported passes—including 73 database tests, 14 HTTP tests and 100 browser stress cases—are **inspected receipts, not independent reruns**.

Explicit limitations remain: no real all-channel or in-flight proof; the synthetic status adapter has no native atomic CAS; no production release source or production `RELEASE_BOUND` record exists; `DEV_PREVIEW_OBSERVED` remains unqualified; and **no M5 or gate pass is established**. This review does not adjudicate principal approval. No delegation, network/provider/browser operations, credential reads or database mutations were performed.