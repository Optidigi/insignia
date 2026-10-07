Three unresolved material Spec/correctness findings remain:

1. **P1 — Falsy malformed discovery data bypasses validation.** [discovery.mjs:73](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/discovery.mjs:73) tests partial data by truthiness. Memory-only replays with complete positive APP publications plus catalogs returning `false`, `0`, or `""` alongside errors produced `GENERIC_DISCOVERY_CONFIRMED`, `ambiguity=false`. This violates “Provider errors/malformed shapes must never silently qualify intent.” Detect reported-field presence independently of truthiness, validate its shape, and add regressions for both surfaces.

2. **P1 — Malformed error envelopes are treated as ordinary provider failures.** [operator.mjs:215](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/operator.mjs:215) accepts malformed `errors`, while discovery excludes `provider_error` from structural ambiguity. Catalog responses containing `errors:{}` or `errors:[]`, paired with complete positive publications, reproduced generic qualification. This violates the same malformed-shape rule and A5’s “identity/coverage ambiguity” fence. Require a nonempty, well-shaped error array; retain malformed-envelope failure as structural ambiguity while preserving qualified denial behavior.

3. **P2 — Freshness can expire between admission and dispatch.** [guard.mjs:64](/home/serveradmin/insignia-m5-016-worktree/scripts/m5-016/guard.mjs:64) dispatches after additional gate/accounting work without rechecking freshness. A memory replay admitted cleanup at 29,950 ms, consumed 100 ms in `assertCurrent`, then archived at **30,050 ms** and settled. This violates “identity and ownership fresh <=30s.” Revalidate freshness immediately before private transport dispatch, accounting for the already-reserved archival slot; add this boundary regression.

Verified exact refs:

- Base `d0efd626222047a2047573f678b019cd7b1802a9`
- Candidate `a736cf018e4442980f7f899ea376c1d35db543c5`
- Tree `8b8decff4eb9339b55d7fe268c79210350f1d355`

Same-launch host metadata confirms GPT-6.1-sol/high, read-only sandbox, approval never. Reviewed complete M5-016 source, governing documents/pinned skills, interacting v1/v2 contracts/adapters, recovery/activation/version/SQL fences, exports/build, protected-loader source and reused helpers; inspected changed root/delivery evidence.

Own checks: exact diff/log and `diff --check`; binding test **1/1**; filesystem-memory operator suite **45/45**, after correcting an initial harness-loading failure; independent counterexamples above. All **3,262 binding hashes**, **96 compiled baseline hashes**, **46 canonical hashes**, and **30 provenance pairs** matched. Production/historical paths remain unchanged; final worktree clean; fresh canonical run absent.

Limits: broader suites/PostgreSQL are supplied evidence. The supplied current-head CI receipt records **9/10 successful**, one running; completion was not independently verified. No edits, build writes, credentials, canonical initialization, network/provider/browser access, child agents or approval occurred.