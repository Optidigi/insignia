# M5-003R2 — actual HTTP dispatch freshness

## Authority and provenance

The owner authorized the [transport-dispatch correction](prompts/M5-003R2-TRANSPORT-DISPATCH-CLOSURE.md) on existing [PR #29](https://github.com/Optidigi/insignia/pull/29). The imported [PR-029R external verdict](PR-029R-principal-review.md) is **CHANGES_REQUESTED**, not native approval. Before edits GitHub, remote main/head and the clean worktree matched base/effective base `8a84ddeaf277368852d224915abe6d4a93a3d8a4`, head `91f46ba0006d9c5d50613dc39e234f33c797f625`, tree `b717f3b729a914686510622f97f6ff48da2f691d`. No newer work was replaced. Supplied ZIP SHA-256: `c0b9c34c0e837f8039f0df52d2b13220ed22fadba350da8395dbeb1098d3aaad`. All 14 supplied manifest entries pass. The exact [package](evidence/m5-003r2/principal-package/README.md), diagnostic snapshots and earlier correction evidence remain historical; they were not installed as runtime source.

## R1-T reproduction and correction

Permanent tests use real PostgreSQL 18, the public `core.productionActivations.create(...).publications.advance(...)` facade, actual production publication coordinator, actual Shopify publication adapter and actual HTTP transport. Only external synthetic HTTP/credential/clock boundaries and expressly synthetic release premises are injected. Actual fetch mutation invocations are counted; `remote.set` invocation is not the success metric.

On the pinned baseline, a 2000 ms credential delay sent one Shop-config HTTP mutation and advanced the journal despite the 1000 ms admission budget. The corrected implementation sends zero and returns `ADMISSION_PENDING/prepared`, without activation evidence or an effective revision. Initial vertical red/green logs are retained. The principal counterexample already isolated the credential interval; additional speculative bug hypotheses were unnecessary.

A narrow server-only second argument carries the trusted coordinator's freshness predicate through adapter/transport preparation. It is outside the provider JSON and unavailable as public-facade admission authority. After all awaited credential preparation, the transport checks expiry and the predicate synchronously immediately before fetch. The conservative original hold origin remains authoritative; new credential/read receipt cannot renew it. The internal predicate also rejects reversal relative to its last check. Same-mode updates retain the permitted no-hold path.

The existing request deadline now includes publication credential acquisition. A latched expired flag prevents a credential promise that ignores cancellation from initiating a late request. Before-dispatch refusal, credential errors and pre-send timeout are `not_dispatched`, distinct from an already-sent network ambiguity. Inactive/missing/reauthorization errors retain their specific classifications. The coordinator returns truthful pending for known no-send without incrementing ambiguous retry state or fabricating applied readback. Already-sent loss still observes exact CAS state once, never blindly sends a second mutation.

## Adjacent restoration

The real availability adapter reproduced the same gap: credential work expired readiness after the coordinator's check, yet the baseline sent ACTIVE. Correction carries the coordinator's original release/projection/held-state readiness into the actual status-mutation initiation. It does not refresh the origin or substitute a new hold observation for old artifact/projection authority.

Pre-send expiry returns `NOT_DISPATCHED` and preserves `RESTORATION_CLAIMED`, immutable activation evidence and the already committed effective revision. That known no-send does not reset the one-use claim or authorize replay of a previous ambiguous send. Subsequent calls observe only; trusted recovery remains independent. A reversed clock also stops the mutation; a later observation can reject its future snapshot as `invalid_request` without sending.

Acquisition already bounds credential/current-installation waiting. It does not require the later release/publication admission premises, so no fictional authorization requirement was added. Its fixed target, current-installation checks, exact response/readback and non-CAS ambiguity rules remain intact. Pre-send provider-credential unavailability is classified as not dispatched; already-sent failures remain ambiguous. This is an HTTP-initiation guarantee only, not a Shopify lock, atomic product-status CAS, checkout drain or propagation guarantee.

## Regression and preservation

The public-PG matrix covers all four mutation phases at 0/999/1000/1001/2000 ms and reversed time: twelve inclusive-boundary successful HTTP writes; twelve expired/reversed cases send zero additional mutations. A real PostgreSQL final signing-key query advances only the injected clock after its actual response; unchanged rows and the public facade prove final-query expiry remains denied. Inactive/error/late credential controls send zero; late continuation remains unable to dispatch. Six composed restoration boundary cases retain exact claim/evidence behavior. The real HTTP lost-response control counts exactly one CAS mutation and one recovery read. Existing UNLISTED, legacy origin/receipt, generation/key/epoch, immutable evidence, idempotency, no-blind-restore and recovery tests remain.

No SQL schema/migration, persisted evidence version, provider query, architecture/ledger v1.4, M2 money, v2 wire/Function, commercial policy or public scope changed. The [six rebuilt/script/migration bindings](evidence/m5-003r2/retained-query-bindings.json) still match the retained 100001-row query-plan artifact; no new performance run or SLA is claimed.

## Verification and review packet

The [evidence index](evidence/m5-003r2/README.md) records commands, results, sanitized logs and hashes. Required checks include full pinned root, PostgreSQL 18, HTTP/Admin/worker, strict complete changed fixtures, boundaries/secrets, 100/100 no-retry geometry stress and the missing-renderer negative control. Fresh independent full-source Spec/correctness and Standards/security reviewers use explicit `gpt-6.1-sol`/`high` read-only sessions. Their complete reports, observable selected session settings, actual corrected base/head/tree and all final exact-head workflow results are returned in the fixed-head PR packet after committing. Prior reviews and failed outputs remain attributed history, not rewritten clearance.

One integrator/writer uses actual GPT-6.1-sol/high through the T3 Codex runtime and repository-pinned diagnosing-bugs, tdd/tests/mocking, code-review, writing-for-agents and handoff. The public seams were already authorized; no repeated setup/seam interview was needed. Process audit found no active native subagents or old M5-003R review jobs. Historical local process trees and shared PostgreSQL are preserved rather than treated as current-package workers.

## Remaining limits and stop

No owner credential file, Shopify CLI, authenticated Shopify/provider operation, preview, deployment or merchant-resource mutation was used. Nine retained grants, billing fixtures, historical previews, legacy resources and orders remain untouched. Native non-CAS status races, all-channel/in-flight admission, real RELEASE_BOUND and trusted production recovery authority remain unqualified. DEV_PREVIEW_OBSERVED remains live-unqualified; M5 and G6/G7 are incomplete. This correction does not authorize merge, M6/M7, activation, release, launch or another slice. Stop for principal rereview.
