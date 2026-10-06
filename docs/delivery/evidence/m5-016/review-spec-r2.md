Two unresolved material Spec/correctness findings remain:

1. **P1 — GraphQL errors bypass identity-drift fencing.** [operator.mjs:207](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:207) rejects error envelopes before checking returned identity. Memory-only replay: DIRECT returns `errors` plus a wrong `shop.id`; subsequent discovery succeeds, `identityFailed` remains false, and archive dispatch occurs. This violates “Require exact app/client/shop/domain/installation/development identity.” Latch explicit identity/grant contradictions from partial data before handling errors; add this mixed-envelope regression.

2. **P1 — Conflicting duplicate metadata escapes ambiguity classification.** [discovery.mjs:36](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:36) rejects a duplicate before retaining its validated observation. Memory-only reproduction: APP publications returns the target twice with contradictory `supportsFuturePublishing`; APP catalogs independently completes positively. Classification incorrectly becomes `GENERIC_DISCOVERY_CONFIRMED`, with `ambiguity=false`. A5 requires `UNRESOLVED` for “identity/coverage ambiguity.” Preserve and adjudicate contradictory target observations before duplicate rejection; add a complete-positive-counterpart regression.

Verified exact refs:

- Base `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate `8bae02746aafe65777d65d054db6125aa0b8f130`
- Tree `b9acb12dd259e0123321058df9d884bfe58d42bb`

Same-launch host records confirm GPT-6.1-sol/high, read-only sandbox, approval never. Reviewed the requested M5-016 source, changed root/delivery files, governing documents/pinned skills, interacting v1/v2 contracts/adapters, recovery/activation/SQL fences, exports/build, protected-loader source and reused helpers.

Own checks: exact diff/log inspection and `diff --check` passed; binding test **1/1** passed. All **3,241** source/build hashes, **46** historical canonical hashes and **18** log-provenance pairs matched. All **96** compiled package files match the closed historical binding. Production and historical M5-015R paths remain unchanged. Final worktree is clean; fresh canonical run is absent. Prior empty-page, partial-catalog and projection-malformation counterexamples now fail closed.

Uncertainties/limits: broader test results are supplied evidence, not my executions. PostgreSQL18 and exact-source CI completion were not independently verified. No edits, build writes, loopback/network requests, credentials, provider access, child agents or approval occurred.