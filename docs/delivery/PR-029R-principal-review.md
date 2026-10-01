# PR #29 principal rereview — CHANGES_REQUESTED

Issued 1 October 2026 by ChatGPT, principal architecture/review role, Insignia Rewrite Project. This is an attributed external verdict, not a native GitHub review.

## Exact binding

| Field | Value |
|---|---|
| Repository / PR | Optidigi/insignia / #29 |
| Base / effective base / current main | `8a84ddeaf277368852d224915abe6d4a93a3d8a4` |
| Reviewed head | `91f46ba0006d9c5d50613dc39e234f33c797f625` |
| Reviewed tree | `b717f3b729a914686510622f97f6ff48da2f691d` |
| Branch | `feat/m5-003-activation-admission` |
| Native state inspected | Open, non-draft, unmerged; native review list empty |

The corrected head is two commits ahead of the previously reviewed `a426719e5350f61ecb5620f6c90ab7a0e365e66b`, without divergence in that comparison. The current GitHub main ref still names the PR #28 merge. The head-associated workflow query returned ten completed successes. The latest local packet reports attempt 1, PostgreSQL105/105, HTTP16/16, worker15/15 and stress100/100 with no retries; these are retained execution results, not principal reruns.

**CHANGES_REQUESTED: one remaining R1 transport-dispatch finding.** Keep the same PR open. The earlier status and observation-origin corrections are accepted at the implementation/evidence scope below. Do not restart them or erase their earlier failures.

## Spec / correctness

### Closed portions

**R1 observation origin — CLOSED.** The complete availability adapter now retains the pre-I/O origin, records receipt separately, and bounds provider versions by receipt. Independent fixed-source controls accept ages0/999/1000ms and reject1001/2000ms for a1000ms budget. The real-PostgreSQL public-seam tests cover delayed fetch/body/post-response credential work. No historical timestamp rewriting or SQL migration was introduced.

**R1 projection/current-state delay — CLOSED at the coordinator-to-port boundary.** The internal admission object retains its origin and establishment time. `PgProductionPublication.advance` checks it after projection reads and after the final current-state read. Expiry and reversed-time controls before that caller guard reject in the principal diagnostic. The local reviewers also independently exercised final SQL/key-read expiry. Their optional permanent final-query regression is not this review's blocker.

**R2 legal UNLISTED — CLOSED at source/local evidence scope.** The normalized state preserves `unlisted` rather than mapping it to ACTIVE. The current adapter's legal/unknown-value controls pass independently. Inspected catalog list/detail tests and PostgreSQL restart/activation/restoration coverage preserve the original UNLISTED status and immutable evidence. This accepts parsing and synthetic restoration, not new live platform qualification.

### R1-T — freshness stops at the port call, before awaited transport preparation (P2; required)

The final check in [production-publication.ts](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/packages/database/src/repositories/production-publication.ts#L699-L710) immediately precedes `this.remote.set(...)`. However, `remote.set` is not the actual HTTP send. The real [publication adapter and HTTP transport](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/packages/shopify/src/publication-admin.ts#L355-L443) await `config.credentials.acquire(...)` before calling `fetchImpl`. The admission predicate/deadline is not carried into that transport. Therefore a fresh call can become stale before the application initiates the mutation request.

This is not a demand for an impossible atomic guarantee over Shopify processing or propagation. It is a controllable local await **before HTTP initiation**. The real Admin composition's online-grant credential source itself awaits an active-installation database read; prebound credential material does not make every surrounding check synchronous. See [production.ts](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/apps/web/src/server/admin/production.ts), `publication(actor)` and its credential source. The activation factory's comment permits prebound credentials/online grants and forbids reentering the locking refresh path; the diagnostic does not perform such a refresh.

Independent fixed-source results using the actual corrected admission callback, the complete actual availability adapter and the complete actual publication adapter/HTTP transport:

| Delay inside publication credential acquisition | Fresh at caller check | Age at synthetic HTTP mutation | Mutation sends | Transport result |
|---:|---|---:|---:|---|
| 0ms | yes | 0ms | 1 | applied |
| 999ms | yes | 999ms | 1 | applied |
| 1000ms | yes | 1000ms | 1 | applied |
| 1001ms | yes | 1001ms | **1** | applied |
| 2000ms | yes | 2000ms | **1** | applied |
| clock reverses1ms | yes | -1ms | **1** | applied |

The1000ms budget was unchanged. All four publication mutation shapes were exercised: Shop config, pending registration, policy and ready registration. Twelve stale/reversed sends were observed across those four shapes. Conversely, putting the same delay before the caller check correctly prevents dispatch. The distinction isolates the missing transport-level check rather than blaming the already-fixed observation origin.

The default characterization command returns0 after recording the observations and checking positive controls. The contract assertion returns1 because stale/reversed HTTP sends still occur. Three complete source snapshots were matched to their exact Git blob hashes before execution. `evidence/results.json` records them and every case.

**Execution limit:** the principal used Node22.16.0, complete unchanged Shopify modules with injected synthetic HTTP/credentials/clock, and the exact admission callback with a synthetic store. The caller's final guard/call ordering was replicated in the harness; the complete PostgreSQL coordinator transaction was not executed. This is a transport-level reproduction plus static call-chain verification, not a claim of full public-PG execution or live exploitation. The committed correction regression must exercise the full production public facade plus real adapters under pinned Node24/PostgreSQL18.

Required outcome: retain trusted admission validity through transport preparation and check it after all awaited credential/pre-send work, immediately before the actual HTTP mutation invocation. An expired/reversed decision must cause zero HTTP mutation sends and a truthfully classified not-dispatched outcome. It must not be converted into an ambiguous write or refreshed by arrival time. Preserve CAS, installation fencing and recovery semantics.

## Standards / security

R1-T is the same correctness finding viewed as an authority-lifetime boundary, not an additional blocker. The narrow module boundary must carry the precondition the effect depends on; an inner async method cannot silently outlive that precondition.

No stylistic rewrite is requested. The optional EOF-log hygiene and final-query test recommendation do not block this candidate independently. Keep historical evidence intact. Do not introduce a generic lease/event/permission framework to fix one bounded call chain.

## Scope and evidence assessment

This rereview inspected the two-commit correction inventory; the correction brief/report and both latest full-source local reports; complete current production publication coordinator and activation factory; complete availability and publication HTTP adapters; interacting Admin credential composition, activation restoration path, catalog tests and new public PostgreSQL regressions; current refs and workflow conclusions. The pinned code-review, writing-for-agents and handoff skills informed the review and delivery documents. Prior project records remain controlling; the correction did not amend the v1.4 plan/ledger.

I did not run independent principal subagents, clone/build the whole repository, execute the pinned full suite, rerun PostgreSQL/browser/stress/100k benchmarks, validate every retained log hash, or independently retrieve every workflow's attempt metadata. A container clone failed DNS; connector reads and hash-verified reconstruction supplied the executable snapshots. No repository, GitHub review, Shopify, credential or provider mutation was performed.

The local full-source no-finding reports remain their attributed conclusions. Their check of the final SQL interval does not cover the later transport credential interval reproduced here. Their earlier green checks are not rewritten as failed executions; they simply lacked this case.

## Next action and preserved boundaries

Execute the accompanying **M5-003R2 transport-dispatch correction on PR #29** only after the owner forwards its launch. Return for principal rereview. No merge or successor slice is approved.

Live all-channel/in-flight admission, non-CAS product-status races, actual RELEASE_BOUND provenance, trusted operator-recovery source and remaining G7 stay open. No M5/G6/G7 completion, M6/M7, deployment or launch follows. The adjacent restoration path has the same nested pre-send-I/O shape; the correction brief requires a bounded trace/test of that path rather than treating a port invocation as proof of actual send freshness. Its specific end-to-end failing result has not been independently executed in this rereview.

## References

- [Current PR](https://github.com/Optidigi/insignia/pull/29) and [latest local packet](https://github.com/Optidigi/insignia/pull/29#issuecomment-5938170286).
- [Correction report](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/docs/delivery/M5-003R-REPORT.md) and [execution register](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/docs/delivery/evidence/m5-003r/dispatch-verification.json).
- [Publication admission producer](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/packages/database/src/repositories/production-activation.ts).
- [Inspected public-PG tests](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/packages/database/test/activation.test.ts).
- [Restoration decision/call](https://github.com/Optidigi/insignia/blob/91f46ba0006d9c5d50613dc39e234f33c797f625/packages/application/src/publication/activation.ts) and the complete availability adapter snapshot included here.
- Shopify's current [ProductStatus](https://shopify.dev/docs/api/admin-graphql/2026-01/enums/ProductStatus) and [unlisted guide](https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products) confirm the legal status distinction; this external check does not prove live restoration.
