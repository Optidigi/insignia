# M5-003 — local activation/admission machinery

## Authority and merge

The owner authorized only the normal merge of PR #28 and this off-store implementation PR. The external principal approval is [PR-028R3](PR-028R3-principal-review.md); it is not a native GitHub approval. Ten exact-head workflows were successful on attempt 1 immediately before the merge.

Normal merge: `8a84ddeaf277368852d224915abe6d4a93a3d8a4`. Ordered parents: `28e69864ebb9796504861a541363880cc86a82f8`, `b2963fd68296935999ad548921e3117443eb9cc3`. Tree: `3b97621164f0b58609154bbd7a12aaa7d1ca5a85`. The new branch starts at that verified remote main. [Premerge checks](evidence/m5-003/pr28-premerge.json) and [remote merge](evidence/m5-003/pr28-merge.json) preserve the actual records. Final candidate refs, CI and fresh review dispositions belong in the PR body after the final commit.

## Implementation

- A normalized product-wide availability port separates application states from Shopify status enums. The Shopify adapter changes only product ID/status, retains status/version/visibility snapshots and uses bounded synthetic HTTP tests. It checks current installation/credential scope before and after dispatch, exact readback and owned state before restoration.
- First publication, reinstall and required/optional mode changes require owned hold evidence. A same-mode revision does not acquire an unnecessary hold. The public publication facade cannot accept a caller-supplied admission callback or expose its internal class/database capabilities.
- The coordinator persists acquisition intent before dispatch; evidence and effective activation commit atomically under tenant/install/config/key/operation locks. Restoration follows that commit. Ambiguity or merchant drift never authorizes blind replay or a stock/refund-style compensation.
- Immutable versioned evidence binds revision/hash, operation/sequence, installation, authorization generation/epoch, selected numeric key, projection digests, Function/release observations and hold/admission evidence. No credentials or private keys enter those records.
- A server-only trusted release-source port binds active app version and artifact identity. No source is wired by default. Browser values, unsigned environment JSON, SOURCE_ONLY and DEV_PREVIEW_OBSERVED cannot satisfy production readiness. Synthetic release fixtures are test premises, not deployed evidence.
- Admin states distinguish waiting for release/hold, held activation pending, committed activation awaiting restoration, and restoration conflict/operator hold. Terminal publication conflict/operator states take precedence over an earlier held state. No browser/controller gains a lower-level M3 activation method.
- A final synchronous decision check uses one timestamp after the last awaited read, revalidating the complete release/Function, projection, hold and merchant-local day inputs before activation or restoration.
- Observation-only operator recovery can close an explicit hold without another provider mutation. It requires an independent, scoped trusted decision that outstanding writes are settled, plus two fresh original-state observations. Status or elapsed time alone is insufficient. The immutable resolution preserves activation history, newer work and reinstall identity. No production operator authority is wired.

## Query plans

`scripts/m5-003/large-history.mjs` captures SQL from the actual built public read seams, then runs PostgreSQL 18 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. One config has 100,001 revision/publication rows: 50,000 prior-generation and 50,001 current-generation operations. The selected effective operation precedes 50,000 newer resolved requests; another 5,000 current configs prevent a single-row pointer/config table from hiding index behavior. Retained rows are synthetic structural history; this is not 100k independently validated pricing revisions.

Acceptance checks require pointer PK/index lookup, the partial current-generation descending visible-operation index without a full history scan/sort, and the indexed `configs.getByProduct` effective-config read actually used by Admin. The resolution marker is one-time and backed by immutable resolved evidence; all original terminal-operation fields remain protected. The fixture’s quote-issuance sequence guard deliberately returns null. That rejection is separate from the Admin display and is not weakened or represented as successful pricing. Actual plans, rows, buffers and timings are in [query-plan.json](evidence/m5-003/query-plan.json), bound to script and built module hashes. One machine's timing is not an SLA.

## Qualifications and remaining obligations

Shopify documents DRAFT as unavailable to customers across sales channels/apps: [ProductStatus 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductStatus). This does not establish drainage of in-flight carts/checkouts or universal propagation. [`productUpdate`](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productUpdate) has no atomic product-version CAS precondition; a merchant/provider change after the final pre-read can race the status write. Exact observation detects observed drift, not every concurrent change. The adapter remains a candidate requiring principal/live qualification before real activation.

Lost acquisition with no durable held snapshot cannot attribute an arbitrary DRAFT state to this package. It conservatively retains operator conflict. A lost restoration response may likewise require independently reviewed operator recovery rather than another automatic write. A settled-write assertion is an external trusted premise, not something this code establishes by observing status. Historical activation evidence is never rewritten to disguise restoration failure.

There is no production release-source implementation or RELEASE_BOUND deployment record in this package. DEV_PREVIEW_OBSERVED remains live-unqualified. No real ProductConfig was activated. The nine dev-store grants are retained historical state, not a repair target. No authenticated Shopify/provider request, Shopify CLI, owner credential read, preview, deployment, scope repair or commerce/billing operation occurred.

Architecture/ledger v1.4, v2 bytes, historical Functions/evidence and orders #1001–#1006 remain unchanged. Full live G7, released Function identity, all-channel/in-flight qualification and supported rollout remain open. M5 and G6/G7 are not declared complete. No M6/M7, merge of this PR or launch is authorized.

## Verification and review

Final commands/results, red/green receipts, crash/race matrix and actual model/session controls are recorded in the accompanying evidence index and final PR body. Local execution: complete retained root suite PASS; PostgreSQL18.6 **89/89**; database/HTTP/server composition **16/16**; real-PG worker **15/15**; geometry publication stress **100/100** (25 per combination, no retry); missing-renderer expected-failure control PASS; public database API **19** compiler and **4** runtime negative probes PASS. The first full-source local reviews requested corrections to public admission, recoverability, terminal Admin state, final freshness and the actual Admin query-plan target. Their findings and preserved red/green evidence are included. Fresh full-source GPT-6.1-sol/high rereview dispositions are bound to the candidate in the final PR body. These results do not constitute a principal gate verdict.


## Second full-source review closure

Spec rereview at `f46535ce995f4e3ae05431b4888aa29028dc738f` reproduced two additional recovery defects; Standards/security found no material issue at that candidate. Both reports and selected actual model/high contexts remain preserved. All ten workflows passed attempt1 at that earlier head; they are not claimed as final corrected-head CI.

1. Restoration now commits `RESTORATION_CLAIMED` before dispatch and grants only that invocation a one-use capability. Unchanged held-state readback cannot establish settlement or authorize another write. Later invocations observe only and remain restoration-pending or conflict; an independently settled original-state operator recovery can close the record. Crash after claim before dispatch, ambiguous response/throw with an unchanged held snapshot, and a genuinely still-in-flight synthetic HTTP request are tested. Concurrent callers may acquire a new claim only for an **undispatched** restoration intent, never a claimed one.
2. A new publication can follow an audited resolved/abandoned request tail while retaining the older effective operation and monotonic sequence. Every intervening current-installation operation must be closed by immutable resolution; exact effective remote anchors and the locked sequence are revalidated. Unknown/unresolved history or changed anchors still fails closed. Both required→optional and optional→required rescue paths retain hold admission. The quote-issuance sequence guard remains unchanged and returns null until a new coherent activation.

Final local execution: application171, Shopify203, PostgreSQL89, HTTP16 and worker15; the complete retained root suite passes. Source/test compiler checks also pass. Fresh full-source rereview and final-head CI remain the handoff requirements; the actual final dispositions/refs are in the PR body.
