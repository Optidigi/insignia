**CHANGES_REQUIRED — Standards/security**

**[P2] Induced production webhook effects are missing from the resource boundary.** [M5-026-RESOURCE-PLAN.md:11](/home/serveradmin/insignia-m5-026-worktree/docs/delivery/M5-026-RESOURCE-PLAN.md:11) excludes production web/worker/database resources while preserving existing app-wide subscriptions and scheduling four uninstall eras.

Counterexample: a preserved app-wide uninstall/privacy subscription targets the canonical ingress. Era A can then create production inbox records and queue jobs even without a local tenant: [shopify-webhooks.ts:250](/home/serveradmin/insignia-m5-026-worktree/packages/database/src/repositories/shopify-webhooks.ts:250) persists unresolved receipts, and the HTTP route enqueues them. A separate capability receiver and avoiding `/api/admin` do not prevent these provider-generated effects. Subscription inventory alone does not authorize them.

This misses the originating spec’s requirement to enumerate every anticipated impact before requesting access, and AGENTS’ production authorization boundary.

**Smallest correction:** add a gate before Era A that inventories all preserved subscription destinations and determines their induced effects. Require proof that excluded production services remain unaffected, or separately scoped owner authorization, accounting and retention for those effects; otherwise STOP. Preserve compliance subscriptions. Include delayed privacy deliveries beyond the six-hour window.

Verified clean worktree, one commit, exact binding:

- Base/effective merge base: `1e0cb0279bf5595e59a52972bea621b379114713`
- Head: `0cb6ef4b8dd3f09a5c8c1cb1d1fa123b7bc1494b`
- Tree: `7fe38b9405c85ac60051c1afe0ba4e7f60a41d04`

Static inspection only; evidence wrapper/raw-log/source/document hashes matched. No edits, checks rerun, live operations, delegation or private auth/env/SSH inspection. Runtime model/effort metadata and natural exact-head CI remain parent-verification responsibilities.

The M5-025 blocker and RED invariant remain. This verdict confers no principal approval, production safety PASS or resource authority.