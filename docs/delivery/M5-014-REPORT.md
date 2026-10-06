# M5-014 — local availability hold v2 implementation

Status: implementation candidate; full regression, fresh reviews and natural final-head CI are pending. Principal review is required; this slice authorizes no live qualification or successor merge.

## Authority and baseline

The [authorized brief](prompts/M5-014-AVAILABILITY-HOLD-V2.md) follows the [external PR43 approval](PR-043-principal-review.md). The supplied ZIP SHA256 is `ddfc57b842a30904d8f45bcf5acc313748663bcccd8c67aef6324be4c469ba3a`; all five manifest entries matched. Before the normal merge, live base/head/tree, all ten unique reviewed-head attempt1 workflows and the external principal approval matched. [Actual merge receipt](evidence/m5-014/pr43-merge-receipt.json): `55060c5a48617a27858d10fb0db639c7e9efe148`, ordered parents `9d896e824ebf3beb5e560ce89e9873799869f6c5`, `4ab249b764a58a08fb6599a2200d5214458da252`, tree `3bff5ab4b8a9beee4d772e9a2e00869783cea3f5`. No reviewed-head edit, squash/rebase, native approval fabrication or protection bypass.

## Contracts and behavior

The new `m5-product-availability-snapshot-v2` stores exact scope/product/status, provider updatedAt, complete configured intent, separate effective visibility, observation timestamps and canonical digests. `m5-availability-hold-v2` retains exact before/held snapshots plus mutation acknowledgement and restoration audit receipts. New activation writes `m5-activation-evidence-v2` with decisionVersion2, including SAME_MODE no-hold decisions. Unresolved persisted v1 holds remain operator-held; they cannot be adopted automatically, including after a lost acquire response.

The new Shopify factory defaults to v2 snapshots and dispatches explicitly versioned v1 recovery to the unchanged original adapter. Static documents enumerate every shop Publication and query its includedProducts using only `id:<exact numeric product ID>`. Included connections must be complete and zero-or-one exact product. Publication IDs must be unique across complete forward pages. Engineering admission guards are100 pages/5000 items,50 Publications per page,250 complete effective nodes and128KiB per response; these are safety bounds, not merchant capacity. One high-level deadline covers all pages and the entire acquire/restore sequence. Calls are serial, redirects fail, no request retries occur, and an unsettled timed-out transport quarantines the adapter.

Configured intent retains included IDs and publication autoPublish/supportsFuturePublishing settings plus observed scheduled/staged dates. It never uses publication_ids or V2 emptiness as authority. Effective visibility retains currently-published IDs and explicit online-store publishedAt/URL presence, with original dates and URL as audit evidence. Effective/staged IDs outside the complete configured set fail closed. Held-safe DRAFT has unchanged configured intent and no effective publication or online-store visibility.

Acquire persists intent before one status-only DRAFT write. Complete exact ACK/readback settlement uses status, intent and effective semantics. ACTIVE→DRAFT may lose effective publication membership while configured intent persists. ACK and later read provider timestamps are both retained; the one-second M5-011 difference alone is accepted for v2 without tolerance or CAS. The same timestamp cannot conceal intent/effective drift. Observation may advance metadata without replacing the immutable held snapshot. Restoration requires original status, unchanged complete intent, original effective IDs/online-store booleans, and no contradictory ACK. Publication dates may change. Lost acquire ACK remains unattributable; lost restore ACK remains pending even if a later read matches. Durable single-use acquisition/restoration claims and adapter attempt reservations prevent replay.

Trusted v2 recovery binds the full exact reviewed snapshot, including diagnostic/observation metadata. Its second complete read must match semantic state, and final closure compares original semantics after the permitted current-installation fence. The receipt keeps both the reviewed and final observations. Trusted operator settlement of outstanding writes remains mandatory.

## Compatibility and migration

Original availability.ts and Shopify availability-hold.ts are unchanged. Historical v1 providerVersion/visibilityDigest and trusted recovery retain their exact meanings; neither snapshots nor v1 JSONB are upgraded from current provider state. The migration extends explicit version predicates, keeps existing state/identity/immutability fences, and adds one-time immutable v2 audit receipts. It contains no data rewrite. Downgrade refuses v2 records rather than interpreting them as v1. PostgreSQL workflow down/up rehearsal therefore runs in a separate empty disposable database, preserving all qualification records in the integration database.

The M5-012/M5-013 closed-source binding tests now assert their existing production_build_changed rejection when the new v2 export changes the complete Shopify build. The frozen guards/operators and canonical records are unchanged. They cannot qualify/reopen a live historical run using v2 code.

No money, grouping, token, entitlement, retention or merchant API behavior changes are introduced. No production activation has occurred. Synthetic readiness premises in tests are not RELEASE_BOUND acceptance.

## Research and limits

Evidence comes from the supplied principal brief and repository M5-010–M5-013 raw observations/adjudications. [M5-011](M5-011-REPORT.md) preserves the historical timestamp/membership conflict; [M5-012](M5-012-REPORT.md) establishes includedProducts configured intent separately from the diagnostic association predicate; [M5-013](M5-013-REPORT.md) permanently closes the prior fixture. This implementation does not reinterpret those v1 executions. No online documentation/schema, Shopify/browser/credential/CLI/provider probe was performed.

Scheduled/future publishing remains unqualified. Observed schedules are retained and rejected; included Publications advertising supportsFuturePublishing are conservatively rejected even when their current legacy view has no schedule. Empty supplemental views cannot prove schedule absence. Synthetic tests do not qualify scheduling, merchant capacity, propagation, checkout drainage, availability race exclusion or live adapter behavior. Multi-query observation is not atomic/native CAS and cannot exclude every unobserved external change.

## Verification and delivery

Actual parent runtime is GPT-6.1-sol/high. Pinned TDD/tests-mocking, diagnosing-bugs, code-review, writing-for-agents and handoff were read and used. The brief already authorizes adapter, activation/recovery and JSON persistence acceptance seams; no additional seam permission was needed. Behavioral red/green logs are retained in the neutral handoff and copied into the PR evidence before completion. Initial failures and setup/build failures are kept as failures, never counted as passes.

Local PostgreSQL18 is unavailable; its integration coverage must come from the actual PostgreSQL18 workflows. Remaining verification results, two fresh full-source review reports, runtime attestations and exact final PR refs/CI will be supplied in the review packet. All39 prior canonical files are tracked by the [immutable baseline](evidence/m5-014/prior-canonical-baseline.json). No historical register or closed fixture is touched.
