**CHANGES_REQUIRED — Spec/correctness**

**P2 — Account for indirect production deliveries before Era A.** [M5-026-RESOURCE-PLAN.md:49](/home/serveradmin/insignia-m5-026-worktree/docs/delivery/M5-026-RESOURCE-PLAN.md:49) requires subscription inventory but does not gate the effects of preserved subscriptions. Lines 11, 33 and 55 describe an isolated experiment without production queue/worker involvement.

The originating requirement is: “every anticipated provider mutation, credential, impact, cleanup and stop condition precedes any access request.”

Counterexample: inventory finds a preserved app-wide `APP_UNINSTALLED` subscription targeting production `/api/webhooks/shopify`. Era A’s uninstall can bypass the isolated collector: the current repository persists an unresolved shop’s receipt, and [ingress.ts:64](/home/serveradmin/insignia-m5-026-worktree/packages/application/src/shopify/ingress.ts:64) enqueues it before acknowledgement. Preserved `shop/redact` deliveries may also arrive after the six-hour experiment window. The proposal lacks accounting, authority and cleanup for these indirect effects.

Smallest correction: add a mandatory pre-install destination/effects gate. Stop before Era A unless every preserved subscription’s downstream effects—including delayed compliance deliveries—fit separately approved accounting, retention and cleanup boundaries. Preserve subscriptions; do not infer production-operation authority from the isolated receiver allocation.

Exact binding verified; clean worktree, one commit:

- Base/effective merge base: `1e0cb0279bf5595e59a52972bea621b379114713`
- Head: `0cb6ef4b8dd3f09a5c8c1cb1d1fa123b7bc1494b`
- Tree: `7fe38b9405c85ac60051c1afe0ba4e7f60a41d04`

Static source/Git/evidence inspection only. Log-wrapper and manifest hashes matched retained bytes; failures remain preserved. No checks rerun, edits, delegation, private auth/env/SSH inspection or network/resource operations. Runtime model attestation and natural exact-head CI remain parent verification. No production safety, principal approval or resource authorization is conferred.