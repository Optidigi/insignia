# M5-003 evidence index

All new provider observations here are synthetic. No real Shopify/provider operation, owner credential read or real activation occurred.

## Initial integration receipts (superseded where noted)

- `pr28-premerge.json`, `principal-verification.json`, `pr28-merge.json`: exact approved PR28 inputs, ten successful attempt1 runs, external principal verdict and verified remote merge parents/tree.
- `query-plan.json`: final built public read-seam SQL and PG18.6 EXPLAIN ANALYZE BUFFERS over100,001 history rows foroneconfig plus5,000 current configs. Exact source/output hashes, rows, indexes and machine timings included. `query-plan-initial.json` retains earlier pre-integration measurement; it is not the final binary proof. `query-plan-fixture-red.log` retains incorrect benchmark-fixture ordering, subsequently corrected.
- `activation-example.json`: actual sanitized immutable public readback from real PG plus synthetic release/Function/Shopify transport integration. A synthetic RELEASE_BOUND premise is not release evidence.
- `pg-full.log`: all73 PG tests, including21 new activation tests, with migrations run twice. The first new-suite run collided on a reused synthetic unique ShopID (`pg-activation-first.log`); `pg-activation-green.log` records21 passes after only the fixture identity correction.
- `http-pg-final.log`: all14 real PG/HTTP/server composition tests. Earlier failing build/state/module integration attempts remain in `root-first.log`, `http-pg.log`, `http-pg-green.log`.
- `writer-a-receipts.json`, `hold-red.log`: meaningful behavior failures and writer corrections. Writer prerequisite limitations are explicit; integrated results supersede skipped PG/unbuilt-root claims.
- `digest-red.log` / `digest-green.log`: an evidence-array getter was incorrectly invoked; exact hashing now rejects accessors, sparse arrays and extra array properties without execution.
- `release-red.log` / `release-green.log`: absent production trusted source remains null; dev/mismatched records fail closed.
- `database-api-final.log`:18 compiler negative API probes and4 runtime deep-import rejections, including no activation store, raw commit/session or lower-level publication.activate on the public facade.
- `renderer-control.log`: deliberately missing renderer fails the actual component/canvas readiness test; the normal control command requires this failure.
- `root-integrated-green.log` and `stress-100.log` preserve executed passing root and100-case results. `log-provenance.json` records raw/sanitized hashes; ANSI/trailing whitespace normalization changes no substantive result. The final frozen-root run and review dispositions are added after completion. Final candidate refs/workflow URLs are in the actual PR body, avoiding self-referential committed head claims.

## Crash/recovery and race matrix

| Boundary | Executed test source | Result |
|---|---|---|
| Before hold / persisted intent | application/publication/activation.test.ts; database/test/activation.test.ts | No dispatch before committed intent; unknown dispatch observes, never blindly sends |
| Acquisition response lost | both activation suites + shopify/availability-hold.test.ts | Reobserve owned snapshot; no second acquisition. No durable ownership => operator hold |
| Held before publication | PG and web activation-integration | Fresh hold evidence gates publication; resume publication then independently verify activation |
| Evidence inserted then commit failure | PG activation injected trigger failure | Evidence/effective operation both roll back |
| Concurrent activation | PG activation race | One immutable evidence/effective activation |
| Commit before restoration | PG + web integration | Effective revision committed; RESTORATION_PENDING retained until observed restore |
| Restore response lost / merchant drift | application/PG/hold suites | Observation only; exact owned state required; explicit operator conflict, immutable evidence retained |
| Reinstall / epoch / supersession / revocation | application and PG locked races | Current tenant/key/op locks fence; no restore after authority changes; old hold remains visible in recovery read model |
| Remote projection drift before activation or restoration | application + PG | Fail closed; no restore to availability over drift |
| Function presence/build/release stale or missing; preview/source evidence | application/readiness/release suites | Production blocked; trusted synthetic premises accepted only in tests |
| Merchant-local day crosses key interval during reads | application activation | Final clock/day readiness rechecked |
| Same-mode vs first/mode-change | application + PG | Same-mode acquires no hold; first and both transitions require owned hold |

The status adapter is a candidate without native atomic version CAS. Pre-read/write races and in-flight cart/checkout propagation remain unproved. Operator-held unknown ownership is deliberately not resolved by another automatic mutation. No real release-source implementation is wired; production requires independently trusted RELEASE_BOUND evidence.

## Local-review corrections

Initial independent full-source reviews of `09e301fb3274f5d0f7f77c27a14deef3ae7ef293` are preserved in `spec-initial-review.md` and `security-initial-review.md`, with actual read-only model/effort contexts. They requested changes, not a clean disposition.

- Admission closure: public facade removes the injectable admission callback and returns only bound methods. Normal API checks now run 19 compiler and four runtime negatives; real-PG tests reject first-publication and both mode-change spoofing without dispatch. `admission-writer-receipts.json` distinguishes its skipped PG tests from integrated executed evidence.
- `final-day-red/green.log`, `restoration-expiry-red/green.log`: reproduced final-await expiration; retained complete inputs are synchronously revalidated after the last await. Production keeps the real clock.
- `conflict-ui-red/green.log`: terminal publication state outranks an earlier activation-held state.
- `recovery-red.log`, `recovery-expanded-pg.log`: a scoped trusted settled-write decision plus exact original-state readback closes the operation through immutable `m5-availability-resolution-v1`. `recovery-example.json` is actual sanitized PG readback with synthetic authority, not a live operator decision. Lost restoration, unsent acquire, reinstall, supersession and concurrent recovery are covered. Recovery makes no availability mutation.
- `postgres-corrections.log`: the new index marker first collided with terminal immutability. The final guard permits only an audited one-time marker; existing terminal fields still use the original immutable transition guard. `postgres-stabilized.log` runs **84/84** tests with fresh migrations twice.
- `http-stabilized.log`: **16/16** PG-backed HTTP/composition tests. `worker-pg-stabilized.log`: **15/15**, no skipped PG refresh/queue cases.
- `root-corrections.log` preserves a formatting failure. `root-stabilized.log` is complete pinned-root PASS with Rust/Wasm replays, browser suites, opacity/secrets and historical hashes intact.
- `query-plan-final-corrected.log` preserves the initial incorrect assertion that the quote-issuance seam should succeed after 50k newer resolved requests. Its existing sequence guard intentionally returns null. The final artifact measures the required Admin seam separately, retaining that rejection.

A trusted recovery authority implementation remains unwired. `RESOLVED` preserves the old request rather than reviving it; a current effective activation may become `RESTORED` only with its original immutable evidence retained. Replays return the same resolution; another command key, drift, mismatched authority, unreviewed in-flight writes or a historical-record edit is rejected.

| Additional boundary | Result |
|---|---|
| Final awaited day/projection read expires release inputs | No activation/restore dispatch after final synchronous revalidation |
| Lost restore response followed by independently settled original-state observation | Audited resolution; no second provider mutation; original activation evidence unchanged |
| Unsent/ambiguous acquisition with trusted settled-write decision | Old request resolved/abandoned, never reactivated; distinct new request possible |
| Reinstall/supersession during old hold | Current scope independently checked; newer config/operation/effective pointers preserved |
| Concurrent operator recovery | One immutable resolution, exact replay, no mutation |
| Resolution marker/history mutation | Marker requires immutable resolved evidence; timestamp cannot be erased/replaced; terminal historical fields remain immutable |

Final `stress-stabilized.log` executes **100/100** (25 per success/failure × dirty/ambiguous combination), zero retries/skips. `renderer-stabilized.log` preserves the normal expected-failure control. `query-plan-stabilized.log` preserves cancellation of a slow bulk FK fixture insertion; statistics are now analyzed before dependent bulk rows to avoid an empty-table cached FK lookup plan. No database trigger/constraint or security policy was disabled.

`query-plan-indexed.log` and final `query-plan.json` pass all three required read plans: pointer PK, visible-operation partial index without history sort, and Admin product-config unique index; each returns one row. Structural recovery rows are synthetic SQL-cardinality fixtures, not application-validated operator decisions. `migration-rollback-up.log` rehearses down/up successfully on the package-owned disposable database after preserving the plan/evidence readbacks.

## Second full-source review and dispatch/history corrections

`spec-r2-review.md` retains two P1 findings against `f46535c…`; `security-r2-review.md` reports no material security issue at that earlier head. `pr29-initial-ci.json` records ten successful attempt1 workflows on that candidate, not on the subsequent corrected source.

- `restore-dispatch-red.log`: unchanged held readback allowed repeated restoration. Durable one-use `RESTORATION_CLAIMED` precedes dispatch. Later callers cannot reconstruct that capability; pending/throw/in-flight outcomes remain observation-only. Native success is committed once; original-state recovery requires independently trusted settlement.
- `resolved-mode-red.log`: both mode-change recoveries with an older effective revision were permanently blocked. Only a fully audited abandoned tail now permits another request; effective anchors, installation, locked monotonic sequence and hold admission remain mandatory. Quote issuance retains its original guard.
- `restore-dispatch-first-green.log`, `postgres-closure.log`, `postgres-closure-green.log` retain intermediate expectation/race failures. The final correction preserves same-command prepare replay before rejecting changed sequences, and concurrent callers resume only an undispatched intent—not an ambiguous write.
- `postgres-review-closure.log`: **89/89**; `http-review-closure.log`: **16/16**; `worker-review-closure.log`: **15/15**; `closure-fixture-typecheck.log`: strict compilation of complete activation fixture modules passes. `root-review-closure.log`: complete retained root PASS.

A claimed restoration may have been dispatched, may still be in flight, or may have crashed before dispatch. The name records a durable claim, not a fabricated provider outcome. No timeout/status observation grants a second mutation. No production release/recovery authority is wired.

`stress-review-closure.log` repeats the required **100/100**,25 per combination,no retries/skips on corrected source. `renderer-review-closure.log` is the expected negative control. Final `query-plan.json`/`query-plan-review-closure.log` remain index-bounded, additionally bind the exact applied new migration, and preserve the rejected quote-readiness result. `migration-closure-down-up.log` passes the final disposable rehearsal. Final reviewed candidate/CI refs belong in the PR body.


## Third review correction receipts

`spec-r3-review.md` and `security-r3-review.md` preserve the outstanding-write and two-clock findings against `1e2765f…`. `r3-red-receipts.json`, `clock-midnight-red.log` and `unsettled-original-red.log` bind reproduced failures to that exact old source with the new regressions. Corrected full application174 and Shopify204 tests are in their corresponding green logs. `r3-closure-root.log`, `r3-closure-pg.log` (90), `r3-closure-http.log` (16), `r3-closure-worker.log` (15), fixture/build and renderer logs preserve actual completed commands. The whole-package status stays local/off-store; no outstanding write is inferred settled from status, timeout or zero usage.

`r3-closure-stress.log` completes100/100 with zero retries/skips; `r3-closure-query.log` captures the final artifact-bound pointer/fallback/Admin index proof. Existing schema down/up proof is unaffected by these application/adapter-only changes.
