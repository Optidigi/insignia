# M5-003R2 — carry freshness to the HTTP mutation boundary

## Outcome

Close **R1-T** from `PR-029R-principal-review.md` on existing PR#29. One bounded local/off-store correction; return one candidate for principal rereview. R2 and the earlier observation-origin fix are closed and must be preserved.

Baseline: `Optidigi/insignia`, branch `feat/m5-003-activation-admission`, base/effective base `8a84ddeaf277368852d224915abe6d4a93a3d8a4`, head `91f46ba0006d9c5d50613dc39e234f33c797f625`, tree `b717f3b729a914686510622f97f6ff48da2f691d`. Execution starts only when the owner forwards this package's launch text. No merge or successor PR/slice.

Use actual **GPT-6.1-sol/high** for integration and both fresh independent reviewers. One writer is sufficient. Reuse the established toolchain and isolation; no new general preflight or agent framework.

## 1. Resume and pin

Verify remote main, PR state/base/head/tree/effective base and worktree. Preserve legitimate newer work; on a mismatch report the exact delta before applying this fixed-ref brief. Read AGENTS, ledger, current delivery state/operating model, original M5-003 prompt, M5-003R correction/report and both principal verdicts. Import this verdict as an attributed external record, normally `docs/delivery/PR-029R-principal-review.md`; do not rewrite the earlier verdict or claim native approval.

Use the repository-pinned skills: diagnosing-bugs for the reproducer, tdd plus tests/mocking references for the correction, code-review for two independent full-source axes, writing-for-agents for delivery records, and handoff for interruption transfer. Their defaults do not override project authority. The public seams below are preauthorized; no repeated product/seam interview is needed. Grilling applies only if a genuinely new product/architecture decision emerges.

Done: exact source, scope and current authority are established without overwriting newer work.

## 2. Reproduce at the complete effect boundary

The included fixed-source diagnostic is a counterexample, not the permanent test. Reproduce through:

`core.productionActivations.create(...).publications.advance(...)`
→ actual production publication coordinator
→ actual Shopify publication adapter
→ actual HTTP transport
→ injected synthetic fetch.

Use real isolated PostgreSQL18 and the pinned Node24 runtime. Keep the current real availability adapter/synthetic response path. Construct immutable revision, installation/key state and owned hold through the existing fixture/public capabilities. Mock only external HTTP, credentials/clock and the expressly synthetic release premises—not the publication adapter or its `set` method.

Make admission fresh through the final SQL/key read. Expire it specifically during **the publication HTTP transport's pre-send credential/current-installation work**, inside `remote.set`. Observe actual HTTP mutation attempts, not merely calls to `remote.set`. The old source must send in this stale case; corrected source must send zero times. Preserve the immediate success control. This is the missing interval, not another projection-read-only test.

Done: retained public-PG red/green evidence demonstrates the exact missing interval and its real HTTP boundary.

## 3. Carry the precondition to dispatch

Implement the smallest explicit server-only contract that keeps required admission valid through all local pre-send work. Choose the concrete implementation; these invariants govern it:

- Check the trusted operation/scope-bound precondition after every awaited preparation needed for the mutation, synchronously immediately before the underlying HTTP invocation.
- Preserve the conservative original observation time and monotonic/reversed-clock checks. Receipt, credentials or an extra read cannot reset that authority.
- Keep public-facade admission closure: browser/controller/environment values cannot supply an approving predicate or bypass a required hold. Any internal callback/deadline must come from the reviewed coordinator/composition and remain outside the provider JSON.
- Keep tenant/install/key fences and existing compareDigest behavior. A pre-dispatch freshness refusal is definitively **not sent**, not a network ambiguity. Return a truthful pending/denied outcome without automatic mutation retry or fake success. Already-sent ambiguous outcomes retain their existing observation/recovery rules.
- Bound pre-send waiting and prevent any ignored/late asynchronous continuation from dispatching after the caller has definitively refused/cancelled it. Reuse existing deadlines rather than inventing a new job/lease service.
- Ordinary same-mode publication remains no-hold where allowed. Do not make every read or unrelated product depend on this hold.

This is a local HTTP-initiation contract. Do not claim it locks Shopify, removes native non-CAS races, drains checkout or proves propagation. Network/server latency after a correctly initiated request remains a distinct in-flight risk.

Trace the adjacent activation-restoration call into the real availability adapter: the coordinator checks readiness before `restore`, while that adapter performs additional read/credential work before its status mutation. Add a bounded synthetic adapter-composed test for expiration during that local preparation; correct the same lost-precondition defect if reproduced. Preserve the one-use restoration claim, immutable activation evidence and independently trusted recovery; a confirmed no-send is not permission to replay an earlier ambiguous send. Acquisition should be checked for the same cause only where its actual contract requires that authority. Record observed results; do not invent a failing outcome or a stronger requirement.

Done: every affected guarded mutation in this bounded chain checks its required freshness at actual HTTP initiation; no capability escapes and no late-send/ambiguity regression is introduced.

## 4. Regression matrix

Require public/adaptor-composed tests for:

| Case | Required result |
|---|---|
| Pre-send delay0/999/1000ms, budget1000ms | Intended mutation succeeds at the inclusive boundary |
| Pre-send delay1001/2000ms | Zero HTTP mutation attempts; pending/denied result; no effective activation/evidence fabricated |
| Clock reverses after caller's final check | Zero mutation attempts |
| Four publication write phases | Same expiry protection for Shop config, pending anchor, policy, ready anchor |
| Expiry during final SQL/key read | Existing protection remains; retain a permanent public regression while touching this seam |
| Credential inactive/error or late completion after cancellation | No unauthorized/delayed mutation; accurate classification |
| Same-mode permitted path | No unnecessary availability hold or public admission bypass |
| Already-sent timeout/lost response | Preserve CAS/readback/idempotency and no blind non-CAS restore replay |
| UNLISTED and historical snapshots | Preserve distinct status, exact restoration, additive receipt and historical origin behavior |
| Real restoration adapter preparation | Test relevant readiness expiry before HTTP send; preserve claim/evidence/recovery semantics |

Assertions must observe independent expected behavior. The included snapshots remain historical evidence and must not be edited to manufacture a green diagnostic.

## 5. Bound the change and verify

Expected paths: narrow application/Shopify mutation-port contracts, publication/activation composition, real HTTP adapters and public integration tests. Root exports/lockfiles/CI and any necessary current unmerged migration belong to the integrator. No previous migration, M2 pricing, v2 wire/Function, commercial policy, public scope or v1.4 decision changes are authorized. Prefer no schema change; explain any unavoidable persistence/version impact and return a material locked-decision conflict rather than silently amending it.

Run the existing complete pinned root suite; full real-PostgreSQL suite; relevant HTTP/Admin/worker cases with required tests unskipped;100/100 no-retry geometry stress; renderer negative control; boundaries, secrets, type/fixture checks. Rerun large-history measurements only if their actual query/schema/read seams change; otherwise bind unchanged evidence. Preserve every red result and existing valid green result. No blind CI reruns or timeout inflation.

Fresh independent read-only Spec/correctness and Standards/security reviewers must inspect the **full integrated PR**, including the real coordinator→adapter→transport chain, not just the last diff or an in-memory fake `remote.set`. They must distinguish actual execution from inspected receipts. Correct ordinary material findings within this scope and obtain fresh rereview, then run all applicable workflows on the final exact head.

## 6. Return and stop

Keep the same PR. Record the new exact base/head/tree, R1-T closure, public-PG red/green, actual HTTP dispatch counts, before/after-send classifications, restoration trace outcome, contract/persistence impact, complete final-head CI and both full-source reports/model provenance. Keep the state update short and preserve historical review records.

Stop for principal rereview. No merge, M5 completion, G6/G7 pass, M6/M7, live activation or next slice. No Shopify CLI/provider calls, owner credential reads, previews, deployment, product/metafield/commerce/billing mutations, grant repair or shared-host changes. Public docs/GitHub reads, normal dependency retrieval, isolated local tests and updates to this existing PR are permitted when the owner launches the correction. Retain shared infrastructure and historical resources.
