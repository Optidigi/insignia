# Draft decision proposal — M0-005

**Status: PROPOSED, not adopted.** The principal and owner retain the decision. The approved plan, ledger and M0-004 candidate remain unchanged. This proposal records what a later explicit amendment would need to address.

## Question and local finding

One strict ordinary Ed25519 signature over a canonical complete accepted quote removes repeated signature verification and repeated header/signature transport. The tested shared cart envelope plus compact per-line records passes the M0-005 engineering target of 10 signed buckets with 190 ordinary lines at 6,055,185 Transform and 6,324,982 Validation instructions, with 3,446 Transform output bytes. Those are below 8.8M / 16,000. The 64-bucket Transform output is 21,968 bytes with UUID-length cart-line IDs, above the 20,000-byte reference. The preferred carrier is schema-expressible, but live propagation and Validation price semantics remain unverified. No merchant-facing capacity follows from these results.

**Recommendation: FURTHER_EVIDENCE, with no adoption now.** The local computation result warrants principal review of a distinct whole-quote authorization direction. Its output ceiling, transport facts and required-product policy gap prevent protocol freeze or gate acceptance. A faster maintained per-line verifier is an untested alternative, not disproved by M0-004R.

## Exact locked choices an adoption would amend

- `docs/architecture/decision-ledger.md` **Checkout economics/security** says one token per quote line. Adoption would replace independent per-line signatures and placement with one per-shop ordinary Ed25519 signature over the entire ordered accepted customized set, a shared cart envelope and authenticated compact line records. Offline verification, three shop-local days, bounded complete-offer reuse, exact pre-discount prices, real variants and independent checkout validation would remain.
- `docs/architecture/implementation-plan.md` §§5.1–5.5 specify per-line token bytes, `_insignia_auth`, each-token signature verification, transport roundtrips and key rollout. Adoption would require a new protocol version/domain, carrier/migration rules and explicit dual-version behavior during outstanding offers. The current v1 source/vectors remain historical.
- G2/G3/G5 evidence and G6 enforcement would need a new full-target/live qualification, including the accepted product-facing capacity with headroom. This experiment does not amend gate results.

## Required evidence before such an amendment

1. Resolve the 64-bucket output ceiling without discarding evidence Validation needs or setting an unapproved tiny product cap. Re-measure complete outputs with real cart-line ID shapes and relevant mixed carts.
2. Observe the cart envelope and child member carrier through actual Transform, checkout and order surfaces in an authorized non-production store. Prove Validation sees the intended independently materialized pre-discount child amount across discounts and markets.
3. Establish an independently published required-product policy and fail-closed rollout; absent policy still permits an unsigned required product in the local negative-capability test.
4. Specify installation/key rotation and revocation projections, version coexistence, old-offer expiry and source-bound release artifacts; complete G2/G3/G5/G6 review before reliance.

No second transport shape was evaluated. The preferred shape is expressible in the pinned schemas; the observed 64-bucket output failure is retained rather than presented as passing capacity.
