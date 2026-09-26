# M0-005 — whole-quote authorization feasibility

**Principal-issued proposal, 25 September 2026. Execution starts only with the owner's explicit launch authorization.** One local implementation/evidence work package. No merchant/staging access or mutation; public documentation and schema reads are permitted.

## Outcome and explicit exception

Determine whether authenticating the complete accepted customized quote once per Function invocation, and factoring repeated transport data, can satisfy the measured resource limits without weakening the existing purchase invariants. Deliver executable TS/Rust prototypes, both complete local Function targets, adversarial tests, measured limits and a recommendation in ONE PR. A negative result is valid.

This package explicitly permits experimenting with a change to the locked independent-signature-per-line/token-placement assumption. It does NOT adopt that change. Ordinary Ed25519, per-shop public-key verification, cart-wide acceptance, real variants, exact prices, bounded reuse and independent checkout verification remain. The architecture plan and decision ledger stay unchanged. Record a draft proposal and exact affected decisions; no production protocol freeze or gate pass.

## Start

1. Read the attached PR-007R review. Verify PR #7 still has base/effective merge base `4591d102bb7368681622221253dbd4c997df1ad4`, approved head `f1bf2484a8805138bef4b95cfa0b90e60f8da7f3` and applicable green CI. Merge only with the owner's exact-PR permission; preserve the approved head. If already merged at the approved inputs, verify the remote result rather than merging twice. Branch from the actual merged remote main. Do not guess the merge SHA or bypass changed refs/protections.
2. Read AGENTS, ledger, operating model, delivery state, relevant plan sections on pricing/authorization/Shopify trust, and `spikes/m0-004/contract.md` plus the corrected capacity evidence. Store this review/prompt under the existing delivery conventions. The old prompt remains historical, not a competing active authorization.
3. Use actual `gpt-6-sol` / high. At most two non-overlapping restricted writers in separate worktrees, one integrator, fresh Spec and Standards/security reviews. Separate restricted CLI sessions are valid when native delegation is unavailable. Reuse verified tooling; no new preflight. Use the pinned writing-for-agents, tdd, diagnosing-bugs and code-review skills, and source-based research when needed. Their defaults do not authorize new scope or reopen the product interview.

## 1. State the candidate before splitting implementation

The integrator writes a compact candidate contract and task dependency map. Choose one design, not a generic strategy framework:

`domain separator || versioned common header || member count || canonical ordered member records`

Sign those exact bytes with ordinary Ed25519. Preserve canonical unsigned integer widths and strict lexical money handling. The common header must bind key ID, installation generation, authorization epoch, quote/set identity, country/market/currency/exponent, expiry and totals. Each member must bind its quote-global index, real variant ID, quantity and authorized allocated unit price. State how its index maps to the authoritative historical quote/design; mutable artwork or client-supplied descriptions are not purchase authority. Framing must be unambiguous and bounded before allocation or crypto.

Every record is authenticated by the full-message signature. The change is NOT batch verification, aggregated signatures, verifying only the first old token, a transform-written success flag, a database lookup at checkout, or trusting a copied signature independently on another message. Use the maintained primitive and strict admission/verification profile; do not write curve arithmetic or introduce Ed25519ph, HMAC, Merkle proofs or a new algorithm.

Give the experiment distinct magic/version/domain and attribute names. Old per-line tokens must not be accepted under the new format or silently upgraded. Keep old vectors, source and evidence immutable. Two signatures from different schemes remain separate test subjects, not two production pricing architectures.

**Preferred transport hypothesis:** a single shared envelope in a cart attribute and compact per-line records. Both committed Function schemas expose cart attribute lookup, but actual propagation through Transform/checkout/order is unverified. Map every input/output field to the pinned schemas and validate synthetic query/fixtures. State where the envelope and member records will be read before and after expansion. Treat every carrier as attacker-controlled until verification. Never call synthetic preservation a live Shopify observation.

Measure the complete JSON output including real-length IDs, attribute names/values, prices and structural overhead. Do not claim transport savings by simply deleting evidence that Validation would need. If the preferred shape is schema-inexpressible, document the exact problem and allow at most ONE bounded alternative shared-envelope carrier, with its new obligations. Do not start a browser/session or obtain credentials to resolve it.

## 2. Implement and test the complete local path

Workstream A owns TS canonical encoding, signing and independent golden fixtures; workstream B owns Rust parsing, whole-set verification and the two target adapters. Integrator owns the shared contract, fixture expectations, locks, CI and state. Work sequentially until common bytes are agreed; then parallelize non-overlapping work.

Use `spikes/m0-005/` for the isolated candidate. Reuse existing exact-money allocation logic through explicit imports or a clearly identified reference without changing M0-004 behavior. Minimal pinned local dependencies/builds are permitted. No apps/, production services, database, artwork, admin UI or live publication machinery.

For each Function independently:

- Obtain key registry, installation generation, epoch, current shop-local date and current market/currency context independently from the signature claims. Decode header and all candidate members with size/count/range bounds.
- Require exactly one complete accepted set. Resolve every physical member, reject missing/extra/duplicate indices or ambiguous representation, and order canonical bytes by authenticated index rather than cart enumeration order. Check quantities, sums, identities, selling-plan restrictions and context before expensive work; such checks alone never authorize purchase.
- Authenticate the complete reconstructed message once. Emit no successful partial transformation or validation result before authentication succeeds. A mutation to any member must invalidate the whole accepted set.
- The Transform sets each real variant's allocated price using the current same-variant/one-child/relative-one mechanism. The Validation independently compares observed merchandise economics, not a signature claim or transform-written flag as its price source.
- Keep current E-2..E validity and complete-offer bounded reuse. A new acceptance/renewal has a distinct set identity. All-markers-removed optional merchandise versus required-product enforcement retains the existing product policy, not a new universal catalog restriction.

Tests must cover canonical positive TS/Rust/Python vectors; fifteen raw-header high-bit mutations; unknown version/flags/length/padding/tail bits; key/weak-key/S+L profile; unknown/revoked key, generation and epoch changes; quote/header/member mixing; any changed variant/quantity/unit price/currency/country/market; integer overflow; date boundaries; missing/duplicate/header-without-members/members-without-header; cart reordering; last-member tampering; selling plans; exact allocation conservation; and ordinary coexistence. Identical member bytes reused in another genuinely signed equivalent message are not a forgery; assess the authenticated full statement, not unobservable provenance of copied bytes.

A known required unsigned line must reject. Retain the separately named negative capability for missing required-product policy, paired with ordinary and known-required controls. The candidate does not solve a policy fact absent from Function inputs; do not relabel it secure or deployable. Keep the unproven live pre-discount price mapping explicit.

## 3. Compare full targets, not only a signature microbenchmark

Use the corrected M0-004 head as the baseline. Preserve prior 16 smoke/42 benchmark results. Provide an equivalent case map where the changed wire format requires different fixtures; differences in byte sizes are part of the experiment, not grounds to drop hard cases.

Measure both complete CLI-built targets: binary bytes, instruction count, input/output bytes, memory, runner errors, and any available stack/query-cost data. Unknown values stay unknown. Record cold build source/locks/toolchain/CLI/runner hashes, the exact artifact executed and result files. Use a clean build and avoid repeated postprocessing of an already-measured artifact. One controlled local repeat is sufficient; record CI's own artifact hashes and distinguish behavior agreement from binary identity. No general build-system investigation.

Include 0/200 ordinary; 1/199, 3/197, 4/196, 10/190, 32/168 and 64/136 signed/ordinary carts; isolated 10/32/64; the 500-unit tier example; 10,000 physical units across five 2,000-unit buckets; exact EUR91 allocation; early/late malformed or tampered members; duplicate/missing members; and over-capacity inputs. Retain independently observed inputs/expected outputs as synthetic fixtures, including the missing-policy gap. Do not add fake cart lines to enlarge Shopify's dynamic limits.

**Engineering evaluation target, not a promised product cap:** aim to authenticate and fully materialize 10 signed buckets coexisting with 190 ordinary lines with at least 20% headroom under the 11M instruction and 20,000-byte output references (8.8M / 16,000). Report 32/64-bucket stress results separately and map where each independent limit binds. A 64-bucket failure is not erased by a 10-bucket success. No merchant-facing maximum is selected in this package.

Evaluate at most TWO candidate transport shapes under the same full-set-signature design. Fix normal correctness defects locally, but do not launch another open-ended cryptographic/library tuning campaign. If the candidate remains insufficient or relies on an unavailable field, return that exact result with alternatives. The prior findings do not rule out every faster maintained per-line verifier; acknowledge that alternative without pretending it was tested here.

## 4. Acceptance packet and stop

Return one PR containing the prototype, contract/draft decision proposal, tests, source-bound local/CI metrics, ordinary and adversarial outcomes, reviewer findings/dispositions, and a concise comparison with M0-004. Distinguish signature computation, transport size, exact economics, enforcement policy, and live availability. Passing local checks must not imply live cart/checkout transport or public-app qualification.

Recommend adopt/reject/further-evidence for the candidate, with precisely what adoption would change in the ledger and which live tests would be required. The principal adjudicates that recommendation. Mark only scoped local progress; G2/G3/G5 remain IN_PROGRESS and G1/G4/G6/G7/G8/M1 are not accepted or authorized by implication. Stop for principal review. Do not merge the new PR.

## Permission envelope

The explicit owner launch permits the exact PR #7 normal merge and this local prototype exception only. Permitted: scoped repo changes/new spike, maintained pinned local dependencies, public docs/source/schema research, synthetic/public test keys, restricted delegation, local tests and off-store CI. Existing measured source and evidence, the architecture plan and decision ledger remain unchanged; append the adjudication in operational records.

No merchant credentials/connectors, authenticated merchant API calls, Shopify resource mutations, new orders, dev previews, Function activation, distribution selection, payment/stock changes, signing-key publication, production deployment, tiny product cap, alternative fee pricing, global security changes or automatic next package. Orders #1001–#1004 and all staging settings remain untouched.

## Primary references

- Existing approved plan, M0-004 contract and M0-004R capacity evidence at the reviewed source head.
- Shopify Function API limits: https://shopify.dev/docs/api/functions/latest#limitations (consulted 25 September 2026; 2026-07 currently latest).
- RFC 8032 ordinary Ed25519 message signing/verification: https://datatracker.ietf.org/doc/html/rfc8032 .
- Dalek strict verification/admission: https://docs.rs/ed25519-dalek/2.2.0/ed25519_dalek/struct.VerifyingKey.html .
