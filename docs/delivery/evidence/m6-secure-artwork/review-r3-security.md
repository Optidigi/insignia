# Independent security review — round 3

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-security-r3-44c4104

**Standards/security: no new material P1/P2 findings. All four round-2 P2s are closed locally.**

Verified HEAD `44c4104b60e0c086189fdfcb2388b9212c53420c`, tree `8ae1fdf6ecb3f7157430073c4e72ee814525220a`. Correction-base and cumulative-main trees match the supplied values. Worktree remained clean.

Independent dispositions, preserving original attribution:

- **Security #1 — maintenance failure: closed.** [reconciliation.ts:18](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/worker/src/reconciliation.ts:18) isolates each operation and logging failure. Reproduction now runs artwork cleanup on both passes despite persistent queue-removal errors. Concurrent ticks coalesce; shutdown drains active work.
- **Security #2 — guest quote ownership: closed.** [artwork repository:393](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/artwork.ts:393) enforces owner hash alongside tenant, generation and usability. The server port captures a copied verified scope and denies absent/mismatched authority. Synthetic PostgreSQL reproduced guest-A success and guest-B denial, including expiry and inactive-installation fences. No buyer quote/cart endpoint was added.
- **Spec #1 — observation-clock race: closed.** [accept-quote.ts:371](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/quote/accept-quote.ts:371) checks a finite post-read clock. Advancing-clock acceptance passes; future/stale observations still reject. Acceptance-day and D+2 fences remain.
- **Spec #2 — lost recovery identity: closed.** [artwork-upload.ts:146](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/islands/artwork-upload.ts:146) retains identity after acknowledged PUT. Timeout, ambiguous completion and initial-preview failure can resume the same asset without reallocating or repeating PUT. Pending identity does not emit usable selection.

The historical schema correction is sound: [frozen-schema20-fixture.mjs:12](/home/serveradmin/insignia-m6-secure-artwork-worktree/scripts/m5-runtime/frozen-schema20-fixture.mjs:12) reconstructs exactly 20 migrations from accepted main. Production operator/package files remain byte-identical; the package regression confirms rejection of the current extended checkout. I did not rerun role-changing schema provisioning.

**Independent verification:** 89 focused tests passed, boundary checks passed, plus nine synthetic PostgreSQL fence assertions and additional preview-recovery/scope-capture probes. All owned database fixtures were rolled back; no roles or schema changed.

The cumulative architecture verdict from both earlier review rounds remains valid: exact-byte promotion, immutable manifests/deadlines, private originals, separate raster derivatives and domain/Shopify/renderer/database boundaries remain coherent. Storage, inspector and grants are unchanged from the correction base; their qualification is inherited. SQL privileges provide table/column separation, not row-level isolation.

Readiness limits remain:

- Exact-head CI is pending/unverified here.
- Native R2 presigning, browser size enforcement/CORS and actual proxy forwarding remain **NOT_RUN**. The separate 108-byte MCP probe does not qualify them.
- Signed Content-Length bounds each request; reusable URLs do not establish cumulative transfer/request quotas. Late in-flight PUTs and eventual lifecycle cleanup do not prove exact-deadline erasure.
- Custom-domain CORS, ordinary Docker inspection and native identity remain unqualified; staff artwork delegation is unavailable.
- M5 authentication/G7, privacy/uninstall, verifier and retention obligations remain open.

This review grants no milestone acceptance, deployment, M7 or rollout authority. No source/ref changes, credential/private-configuration reads or browser/MCP/SSH/cloud operations were performed. Review restrictions were followed behaviorally; they are not enforced tool isolation.

Root disposition: security's fresh-lookup closure does not resolve Spec's cached-replay finding. Cached replay remains open pending correction.

