Two unresolved material Standards/security findings remain.

1. **P1 — GraphQL errors bypass the identity-drift fence.** [operator.mjs:207](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:207) rejects `errors` before examining returned identity data. Counterexample: APP catalogs returns errors alongside `data.shop.id="gid://shopify/Shop/9"`; direct inclusion and APP publications are otherwise complete/positive. My memory-only replay returned `GENERIC_DISCOVERY_CONFIRMED`, dispatched archive once, and finished `PHASE_A_SETTLED`. This violates the brief’s exact-identity cleanup fence and A5 identity-ambiguity rule. Inspect and permanently latch contradictory identity evidence before handling the provider error; preserve ordinary denial-only behavior. Add a partial-data/error regression requiring zero archival dispatch.

2. **P1 — Duplicate rejection hides observed metadata drift.** [discovery.mjs:36](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:36) rejects a duplicate before retaining its contradictory metadata; classification examines only retained nodes. Counterexample: complete positive APP publications plus two records for the target AppCatalog, first ACTIVE and then ARCHIVED. My replay recorded `duplicate_discovery_id` but still returned `GENERIC_DISCOVERY_CONFIRMED`, potentially permitting Phase B. This violates A5’s coverage-ambiguity rule and [schema-notes.md](/home/serveradmin/insignia-m5-016-worktree/docs/delivery/evidence/m5-016/schema-notes.md:9): metadata disagreement fails qualification. Detect/latch contradictions before duplicate rejection and require `UNRESOLVED`; add regressions for both surfaces.

Verified exact refs:

- Base: `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate: `8bae02746aafe65777d65d054db6125aa0b8f130`
- Tree: `b9acb12dd259e0123321058df9d884bfe58d42bb`

Same-launch host metadata confirms GPT-6.1-sol/high, read-only, approval never. Reviewed complete M5-016 source, governing documents/pinned skills, changed root/delivery artifacts, interacting production contracts/adapters/recovery/activation/version/SQL fences/exports/build, protected-loader source and reused helpers.

Own checks: exact diff/log and `diff --check`; binding test **1/1**; five memory-only probes confirmed the three original corrections and reproduced both findings above. Initial memory harness failed EBADF; corrected replay succeeded. All **3,241 binding hashes**, **96 compiled baseline hashes**, **46 historical canonical hashes**, and **18 log provenance pairs** matched. Protected production/historical paths remain unchanged; final worktree clean; fresh canonical run absent.

Limits: full-suite results are supplied evidence. Available CI receipt targets the previous candidate; exact-source PostgreSQL18/CI completion remains unverified. No edits, build writes, canonical initialization, credentials, network/provider/browser access, child agents or approval occurred.