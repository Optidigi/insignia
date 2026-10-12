# Independent security review — round4

T3 task: node:delegated-task:command%3Amcp%3A4401786b-22ba-44c0-b2a7-f99cf55028ef%3Adelegate-task%3Ainsignia-m6-security-r4-061fb82

**Standards/security: no new material P1/P2 findings. The outstanding cached-replay P2 is closed locally.**

Verified HEAD `061fb82f50ea293adc16a85e76f585e99de21920`, tree `adf6e481a0aad6541d08ca69c637a27d0f469b18`. Both supplied base trees match. Worktree remained clean.

Preserving attribution: **Spec round3’s cached-replay finding**, which kept **Security round2 #2 partially open**, is now corrected. My independent reproduction against `44c4104` returned guest A’s cached authorization to guest B and absent scope without artwork reads. Against the candidate, B conflicts and absent scope fails before lookup.

The [artwork port](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/artwork/artwork.ts:359) copies trusted scope and derives the binding from tenant, generation and guest owner hash or authorized merchant authority. [acceptQuote](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/application/src/quote/accept-quote.ts:470) incorporates it into the digest supplied to both replay paths. The durable repository rejects mismatched digests at [cached retrieval](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/accepted-quote.ts:292) and [transactional replay](/home/serveradmin/insignia-m6-secure-artwork-worktree/packages/database/src/repositories/accepted-quote.ts:389), with tenant/authorization fences and serialization intact. Forced cache-miss probes confirmed another authority conflicts transactionally, while the original authority receives the unchanged result without another commit or signature.

The **legacy seam is acceptable within the reviewed scope**. Standalone trusted application ports may omit the optional binding and retain historical digest behavior. [Production composition](/home/serveradmin/insignia-m6-secure-artwork-worktree/apps/web/src/server/quote-composition.ts:75) requires it for overrides too; its default unscoped port denies before lookup. This is a trusted server composition contract, not runtime proof of permission provenance. No guest endpoint bypassing it was found. An old unbound result conflicts under M6 binding rather than acquiring retrospective guest ownership. Historical economics, offer bytes, timestamps and expiry remain unchanged.

The **historical lifecycle fixture correction is sound**. The [fixture](/home/serveradmin/insignia-m6-secure-artwork-worktree/scripts/m5-runtime/frozen-schema20-fixture.mjs:12) copies exact schema20 inputs from accepted PR97 main; affected tests assert 20 migrations and no artwork table. Ordinary current database qualification still uses schema21. Production operator/package guards are byte-identical to accepted main, and package regression still rejects the extended checkout. These tests qualify historical M5 controls; they do **not** establish M6 or native erasure.

Independent verification: **37 focused tests passed**, plus in-memory probes for copied scope, malformed/mismatched authority, cached and transactional replay, and historical-unbound separation. Recorded round3 log digests all matched. PostgreSQL lifecycle, queue-process and isolation evidence is inherited; I did not rerun those operations.

The inherited cumulative architecture verdict remains coherent: exact-byte immutable promotion, private originals, separate raster derivatives, tenant/generation fences, frozen economics and domain/SDK/renderer boundaries show no correction-induced drift.

Limits remain explicit: exact-head CI is unverified; native S3 presigning/browser enforcement, proxy forwarding and custom-domain CORS remain NOT_RUN. The 108-byte MCP probe is separate. Per-request length binding proves no aggregate transfer budget; reusable/late PUTs and eventual cleanup prove no exact-deadline erasure. Docker inspection, staff delegation, M5 auth/G7/privacy/uninstall/verifier and real retention obligations remain open.

No source/ref changes, credential/private-configuration reads, browser/MCP/SSH/cloud or external-network operations were performed. Restrictions were followed behaviorally, not enforced by tool isolation. This grants no milestone acceptance, deployment, M7 or rollout approval.

