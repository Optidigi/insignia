# Independent spec review — round 3

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-spec-r3-44c4104

**Spec/correctness: one P2 remains open; no new P1 found.** HEAD `44c4104b60e0c086189fdfcb2388b9212c53420c` and tree `8ae1fdf6ecb3f7157430073c4e72ee814525220a` match. Parent/base trees also match. Worktree was clean at start and finish.

**P2 — Completed-quote replay bypasses current artwork ownership.** [accept-quote.ts:480](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/quote/accept-quote.ts:480) returns a cached authorization before consulting the newly scoped artwork port. The [durable lookup:280](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/accepted-quote.ts:280) checks tenant, generation, idempotency key, digest and signing identity, but carries no guest ownership authority.

Reproduction using the existing application fixture and real artwork usability port: accept guest A’s artwork, then replay the identical request/key under guest B. B’s direct artwork check returns `unavailable`, but acceptance returns A’s cached authorization with **zero artwork reads**. Absent artwork scope also receives the cached result. This requires the same request/key, not merely the asset UUID; no live endpoint exploit was demonstrated. It violates plan §1.3 and leaves **Security round2 #2 partially open**. Bind cached retrieval—including transactional replay—to server-verified owner/design authority while preserving historical offers.

Four round2 dispositions:

- **Spec #1, observation clock: closed locally.** Post-read finite-clock validation retains future/stale-five-minute rejection, acceptance-day checks and complete D+2 coverage. Advancing-clock probe passed **50/50**.
- **Spec #2, initial upload recovery: closed locally.** Acknowledged PUT identity survives timeout/initial preview failure; resume uses status, idempotent completion and preview without reallocating or reuploading. Independent outage probe recorded one admission/PUT; pending artwork stays unselected.
- **Security #1, maintenance composition: closed locally.** Independent catches preserve artwork cleanup after repeated queue failures; logger failures, coalescing and shutdown draining are covered.
- **Security #2, quote ownership: partially corrected; remains open through cached replay above.** Fresh database/application checks enforce guest ownership and deny absent/mismatched scope.

**56 focused tests passed.** Historical schema20 package qualification passed; production operator/package sources remain unchanged. No database, browser, credential/private-configuration, MCP, cloud or external-network operations were performed.

Inherited cumulative architecture verdict from round2 remains coherent: exact-byte immutable promotion, private originals/separate raster derivatives, domain/SDK/renderer boundaries and frozen economics show no material drift.

Readiness limits remain: exact-head CI pending/unverified; native S3 presigning/browser enforcement, actual proxy forwarding and custom-domain CORS unqualified; MCP’s 108-byte probe is separate. Length signing proves no cumulative transfer/request quota, and late PUT/eventual lifecycle timing proves no exact-deadline erasure. Docker inspection and staff artwork delegation remain unavailable/unqualified. M5 auth/G7/privacy/uninstall/verifier and retention obligations remain open. No milestone acceptance, deployment, rollout or M7 approval is granted.

Root disposition: security's fresh-lookup closure does not resolve Spec's cached-replay finding. Cached replay remains open pending correction.

