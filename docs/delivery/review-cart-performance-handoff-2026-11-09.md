# Review and cart performance handoff, 9 November 2026

Historical baseline: the [loading and handoff closeout](loading-handoff-closeout-2026-11-09.md) records the later deployed artifacts, native corrections and remaining latency. Observations below retain their original artifact and timing scope.

The Review presentation and verified cart handoff are deployed to rewrite-dev. The iframe is retained. Native quote, Add, cart readback and exact owned-line cleanup passed. **Cold quote and Add latency are not resolved:** one proposal took 6.34 seconds and one acceptance took 2.60 seconds. No network speedup or production readiness is claimed.

The [deployment and measurement receipt](evidence/technical-merchant-completion/native-review-cart-development-2026-11-09.json) owns exact identities, timings and qualification limits. The [earlier handoff](precutover-handoff-2026-11-09.md) retains the wider application history and owner-held production gates. Final production cutover and rollout were excluded.

## Implemented behavior

The existing reducer, runtime and host remain the state owners. Review shows calculating/preparing status while authoritative terms are pending, a distinct unavailable/retry state after preparation failure, and only terms matching the current intent. Edit, Back and ordinary Close remain available during preparation. Actual cart submission retains its blocking and uncertain-write guards; clean Done does not wait for another proposal.

An expired or changed-cart proposal refresh must display its new total before another acceptance gesture. Transport request IDs fence late quote, price and repair messages, including deferred repairs. The existing attempt identity survives an uncertain acceptance response. No speculative authority cache, recurring preparation, longer freshness window, increased provider concurrency or relaxed validation was introduced.

After a matching verified Shopify receipt, the inner and outer modal remain present while native cart navigation is requested. The completed state offers a View cart navigation retry that performs no cart write. Ordinary close retains its existing focus and scroll restoration. Navigation requested is not proof that the destination loaded.

The native dialog still contains a same-origin `srcdoc` iframe mounting Preact. Review reuses that application. Its document/style separation remains useful; neither iframe overhead nor a missing state reducer explains the measured server delay. Same-origin framing is not a strong boundary against untrusted same-origin code. No embedding framework or origin migration was made.

## Deployed source and qualification

PR271 implemented the Review/handoff corrections and bounded successful request timings. It passed all three protected checks at `e260fe0034885d85b903b24c4797834f2c09ce2f` and merged as `1f4595fa270475a503e7ee70db0e01dda3cd8732`. Its pinned local root check passed, including 48 compiler projects; web reported 391 passed/89 skipped and storefront 138 passed/2 skipped. Isolated PostgreSQL 18 reported 345 passed/5 skipped after all 52 migrations. Skips remain unqualified.

PR272 bound the inactive development candidate and corrected a test-only Firefox page-wide network-idle wait. The reproduced wait stalled after the owned frame was ready; the replacement waits for that owner's completed, non-aborted preparation. Assertions and the 20-second deadline are unchanged. Six concurrent Firefox controls and all 14 Chromium/Firefox opening cases passed. The historical CI interleaving was not proved from its untraced timeout.

PR272 passed all three protected checks at `a82f1901e6a148e499940e8e00bba83784ffccfc` and merged normally as `e47b26f480a20ca1942602637e0098dd711c262b`. Runtime tree `8315f93cb8cb50e9f999daf9446c43c59d1c6cf0` matches CI source `3e938760d34ba3230bbd6364ce9483931b82a8db`. Foundation 42647547789 and runtime 42647548089, attempt 1, supplied the artifacts. All 139 manifest entries were verified: 96 archive bytes and 43 immutable-source files. The final 21 theme files, including 12 assets, match the frozen candidate.

Development Active is **1200729554945 / native-review-cart-1f4595f**, independently read in the complete 28-version inventory. All 14 native identities, 13 non-theme configurations and original `9b94149272d1b62c34f44dda3bde209e80b4ae22` Function authority are preserved. All NEVER_RELEASE versions remain inactive. One development release was dispatched and acknowledged.

Qualified immutable web, worker and verifier images are deployed through their existing projects, networks and mounts. Web/worker are healthy; the verifier was replaced exclusively. The original inspector remains active. Database image, schema 52, scoped grants, key 2, protected financial facts and the original one PENDING application were preserved. Owner signing mounts are absent. The receipt distinguishes OCI config identity from the loaded manifest selector.

The fresh release record observed at16:09:51.517 UTC matched web and a quiesced worker-role read. It expired at16:10:19.835 UTC. This is historical correlated reader evidence, not continuing authority or running-worker purchase proof.

## Native observations and measured delay

A real upload of the 271-byte synthetic SVG passed inspection. Review displayed Buik / Bedrukken / Standaard, Zwart XS ×1, USD 24.95. One Add reached native Shopify cart and GET readback matched the customized line. One native Remove restored the exact empty baseline. The immediate removal read raced the in-flight request; a subsequent read-only GET confirmed cleanup, with no mutation retry. The owned tab and diagnostic storage marker were removed.

One browser performance-clock sample measured:

- Proposal: 6,336.1 ms; exposed ServerTiming 6,132 ms, correlated to the same server log UUID.
- Acceptance: 2,598.6 ms; exposed ServerTiming 2,430 ms, likewise correlated.
- Add to sampled completed DOM: 4,420 ms; Add to pagehide: 4,729.1 ms.

Proposal preparation completed before the Review gesture in this run. It does not measure cold Review entry. The modal remained visible in busy/completion samples. Sampling was every 50 ms; literal Added/Opening text and uninterrupted painted pixels were not verified. There is no percentile, equivalent before/after speedup or hosted-checkout measurement.

The proposal's main measured server span is release preparation: 4,740 ms within 6,132 ms. Availability already overlaps it. Proposal persistence took 17 ms. Acceptance's 1,420 ms persistence span includes final provider checks; it is not 1,420 ms of database work. Nested/parallel spans are non-additive.

Existing nonsecret reservation metadata brackets the cold verification sequence. Startup and authentication brackets include imports, qualification and local overhead; provider-operation brackets include reservation and validation. They are not individual API timings. Actual-source controls demonstrated that overlapping token acquisition before valid opening, or module details before valid inventory, dispatches extra work on rejected evidence. Those changes were rejected. The cart reads retain distinct preacceptance, premutation and post-Add witnesses; the final update response already supplies the complete final cart witness.

A narrower import prototype saved only about 43 ms locally and was not adopted. Node compilation-cache experiments saved about 84 ms of import time in the read-only public image, but proved only same-UID consumption. UID-matched CI packaging, relocated artifact and read-only image qualification remained unproved. Adding that packaging complexity for a modest import-only saving was rejected under KISS. No cache implementation or new collector timing protocol is retained. These findings do not prove that future safe optimization is impossible.

## Remaining engineering and owner gates

Further cold-quote/Add latency reduction remains engineering work. A next candidate needs an equivalent full-path control and native measurements, while retaining freshness, reservations, closing observations, final checks and unknown-write custody. No missing owner access is established for that research. Do not turn this uncertainty into a claim that performance is complete or into an invented approval requirement.

Native cold-preparation interaction/reuse, continuous-paint behavior, QA009 early host event ordering, busy-copy/leave-resume, running-worker purchase processing and sustained throughput remain scoped evidence gaps. Earlier native/source tests retain their original boundaries. Owner visual acceptance is separate.

The wider production gates remain open: scoped production storage/credentials and key policy; complete off-host DB/object recovery and separate recovery-key custody; installed monitoring and original receiver authentication evidence; commercial/distribution and supported currency qualification; shared-host startup/recovery and verifier restart policy; and genuine VAT settlement. Dispatch and unqualified currencies stay disabled. Consumed checkout/order/payment, sender and alert-drill allocations are not reusable. VAT installation 998524223812/gen1 remains UNRESOLVED_NO_RETRY. The original same-tab cart report is still unattributed; this later successful journey does not establish its historical cause.

## Recovery and concrete handoff

The fresh encrypted development DB checkpoint restored schema 52 and protected facts in an isolated local cluster. Encrypted management configuration hashes were verified without writing their plaintext to disk. The drain initially counted PostgreSQL's internal logical replication launcher as an owner client; read-only metadata reconciled it, and only undispatched capture steps continued. The internal PostgreSQL process was not terminated, and no snapshot was overwritten.

All seven temporary encrypted/configuration copies, totaling 1,334,493 bytes, were disposed before their 18:03:11 UTC deadline. Minimal receipts, permanent runtime/auth/journal/certificate/key custody and compatible immutable artifacts remain. There is no outstanding checkpoint deadline. This is not complete production/off-host recovery or physical-erasure proof.

Current artifact custody is `~/.local/share/insignia/recovery-release-20261109/review-cart-final-42647548089-1/` locally and on the shared host. Existing management custody is `~/.local/share/insignia/runtime/`. Historical closed profiles no longer match the expanded inventory. Preserve current keys, terminal/accepted command authority and financial history; use a compatible schema 52 recovery or fix-forward candidate, never automatic schema rollback or restoration of an old snapshot.

Before any later deployment, re-read actual consumers, complete inventory, grants, keys, pending/ambiguous operations and deadlines; qualify matching immutable artifacts and independent admission. Backend-only changes need no new Shopify version if all theme bytes are proved unchanged. Follow the [cutover preparation procedure](cutover-preparation-2026-11-09.md) only within a separately valid allocation. Do not perform final production cutover or rollout.
