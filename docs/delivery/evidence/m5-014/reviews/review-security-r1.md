Standards/security review: **two P2 verification findings at the fixed candidate**.

Base: `55060c5a48617a27858d10fb0db639c7e9efe148`
Head: `e75c300ca65e4c9580c9db196a396801e7101cad`

Both refs resolved; the three-dot diff was nonempty. Commits examined: `65c950a`, `e75c300`.

1. **P2 — Recovery fixture cannot reach mismatched-authority validation.** In [activation.test.ts:562](/home/serveradmin/insignia-m5-014-worktree/packages/database/test/activation.test.ts:562), `simulateExternalOriginalState()` retains the configured intent introduced by `drift()`. Consequently, the assertion at line1445 receives “Original v2 availability not observed” before the authority callback is reached. Restore the original intent/digest in the fixture and retain the mismatched-authority assertion. I reproduced this premise through in-memory candidate-source transpilation; supplied PostgreSQL failure logs corroborate it.

2. **P2 — PostgreSQL web integration still supplies the v1 adapter.** [activation-integration.test.mjs:108](/home/serveradmin/insignia-m5-014-worktree/apps/web/test/admin/activation-integration.test.mjs:108) selects `createShopifyAvailabilityHoldPort`. Its snapshot lacks the v2 discriminator required by [activation.ts:416](/home/serveradmin/insignia-m5-014-worktree/packages/application/src/publication/activation.ts:416), so the expected `WAITING_HOLD` result cannot occur when PostgreSQL enables this test. Use the v2 factory and complete synthetic publication responses.

Both violate the required regression qualification in AGENTS.md and operating-model §7. These are concrete test defects, not smell heuristics. **No additional concrete material production-security finding identified.**

I examined full v1/v2 availability adapters and ports, activation, production publication admission, recovery, persistence repositories, original/new SQL constraints and triggers, transport/deadlines, interacting tests and CI. Own commands included the requested diff/log, `git diff --check`, application/Shopify/database `typecheck` scripts, synthetic in-memory reproductions, and canonical-file hashing; these passed. All39 canonical hashes matched; historical evidence paths were unchanged.

Full regression, PostgreSQL18 integration and final CI were not executed by me. Inspected logs report100/100 stress success and expected renderer-control rejection; those remain supplied evidence.

The orchestrator advanced HEAD externally to `9f50fdd` during review, correcting finding1 outside this fixed candidate. I made no writes or child agents. This report grants no principal or native approval.
