# Independent spec review — round4

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-spec-r4-061fb82

**Spec/correctness: no new P1/P2 findings. The round3 cached-replay P2 is closed locally**, completing the outstanding portion of Security round2 #2.

Verified candidate `061fb82f50ea293adc16a85e76f585e99de21920`, tree `adf6e481a0aad6541d08ca69c637a27d0f469b18`. Correction-base and cumulative-main trees match; worktree remained clean.

- **Cached and transactional replay:** [artwork.ts:359](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:359) copies server-verified scope and derives the binding independently of quote JSON. Missing, malformed or tenant/generation-mismatched scope denies before lookup. [accept-quote.ts:470](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/quote/accept-quote.ts:470) uses the bound digest for both `findCompleted` and transactional `accept`. The durable repository checks digest conflicts before returning either replay. Independent probes confirmed unchanged guest-A replay, guest-B conflict, merchant-versus-guest transactional conflict, and same-authority transactional replay without another commit.

- **Legacy seam and historical offers:** [production composition:75](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/quote-composition.ts:75) requires binding support even for overrides. Optional binding remains a trusted application injection seam; it does not authenticate callers. Explicit legacy ports retain the original digest. An old unbound record conflicts through the scoped M6 port. Authorized replay preserves the complete saved result—including economics, signatures, timestamps and expiry—without restamping or re-signing. Future endpoint composition must supply current verified authority per request.

- **Historical test boundary:** [frozen fixture:12](/home/serveradmin/insignia-m6-secure-artwork-worktree/scripts/m5-runtime/frozen-schema20-fixture.mjs:12) reconstructs exactly 20 migrations from accepted main. Updated DB/worker fixtures assert 20 migrations and absence of `artwork_assets`; ordinary current database qualification remains schema21. Production operator/package guards are unchanged. The package regression passed and still rejects the extended checkout. These controls qualify historical M5 behavior only.

Independent verification: **221 application tests, 2 composition tests, 1 package test passed**, plus source-level probes covering scope copying, denial, both replay paths and legacy compatibility. Real PostgreSQL lifecycle/queue qualification is inherited; I did not rerun provisioning.

The inherited cumulative architecture verdict remains coherent: exact-byte promotion, private originals/separate raster derivatives, immutable history and domain/SDK/renderer boundaries show no interacting regression.

Exact-head CI remains unverified. Native S3/browser/proxy/CORS checks remain NOT_RUN; the separate MCP probe proves none of them. Aggregate transfer limits, exact-deadline erasure, Docker isolation, staff delegation and M5 auth/G7/privacy/uninstall/verifier obligations remain unresolved. No milestone, M7, deployment or rollout approval is granted.

No source/ref writes, credential reads, database operations or external/network actions were performed. Read-only restrictions were followed behaviorally, without enforced tool isolation.

