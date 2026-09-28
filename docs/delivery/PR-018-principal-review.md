# PR #18 — principal review

28 September 2026. **Verdict: APPROVED — bounded M0-013 off-store capacity and sequencing checkpoint.**

## Review binding

- Repository / PR: `Optidigi/insignia`, #18.
- Base / effective merge base: `662a78cd27507d8a2f1eaa976f1c644c93edd1be`.
- Approved head: `72f47577ac8563923aff2bd277484c44392eb92c`.
- Head tree: `9c7c372ae6e9c4b1180d710f56a55edda909d03e`.
- CI synthetic merge: `010245e716c221dbe99ffae4da75a5bb522e7138`; verified exact base/head parents and the same tree.
- Native APPROVE was attempted against this head and returned HTTP 403, `Resource not accessible by integration`. It was not posted. This is the external principal verdict; no merge or Shopify operation was performed here.

No merge-blocking defect was found in the inspected changes. Approval accepts the implementation/evidence at its stated experimental scope. It does not accept a universal merchant capacity, a complete G2/G3/G5 pass, production v2 adoption, publication activation, or M1 readiness.

## Accepted result

Both full policy-aware Functions successfully process the retained 32-customized/168-ordinary synthetic input. Transform measures 8,432,228 instructions and 10,992 output bytes; Validation measures 8,585,447 and 17. The 10+190 case also fits the agreed 8.8M-instruction/16,000-output evaluation limits. The 10,000-garment/five-bucket case succeeds without per-garment wire records.

The candidate has executable whole-subset admission before signing and corresponding Function guards. Counts are allocated price buckets, not products or garments. Remainder allocation may create more than one bucket for a variant. A rejected 33- or 64-bucket set is not successful pricing at that size.

The uncapped 64-bucket Transform output remains 21,968 bytes, above the 20,000-byte reference for <=200-line inputs. Two baseline oversized-CartLine-ID cases also retain their `wrong-output` classifications. These historical counterexamples are not candidate failures and must not be rewritten as successful tests.

The conservative Transform output bound at 32 admitted buckets is 11,632 bytes for its declared field grammar/widths. The TypeScript projection byte counts remain a trusted server-side input to an experimental admission helper, not an implemented oracle for Shopify's future projection. They must not be accepted from a buyer. The input estimate becomes stale when the cart or relevant projection changes.

The measurements establish the recorded shapes, not the Cartesian product of all allowed key, amount, policy, quantity and string-width combinations. Stack peak remains unknown. Query costs 20/23 are documented-rule calculations rather than provider-returned numeric measurements. No additional open-ended stack-tooling investigation is required merely to merge this bounded experiment.

## Review observations and follow-ups

The inspected verifier retains canonical complete-set encoding, strict Ed25519 verification, independent context and exact-money comparisons. The new target guards reject before producing partial prices. Validation preserves the separate repair stage and does not authorize checkout from a Transform marker.

The selected 32-bucket profile is suitable for the next controlled development experiment. It is not adopted as the commercial maximum. The live test must obtain actual line IDs, product policy and input sizes; fail-closed rejection on an unexpected live shape is evidence, not permission to relax the grammar silently.

Synthetic catalogue qualification: the mixed-cart generator reuses a product ID across some required and optional projections. Those are useful branch/performance inputs, not a coherent live catalogue model. The next fixture must give each actual Shopify product one consistent policy, and its live counts must be observed rather than synthesized. No repeated local benchmark is required solely to relabel those already-qualified synthetic inputs.

## v1.3 sequencing disposition

The original G1–G8 criterion rows remain present; the amendment assigns feasibility, feature-acceptance and release responsibilities rather than declaring complete passes. Archive verification distinguishes v1.1, v1.2 and the reviewed v1.3 hashes. Whole-quote v2 remains provisional and no M1 authorization follows from this approval.

Read the G6 phrase **before M1 reliance** as prohibiting reliance on an unproved activation mechanism, not as requiring implementation of the production publisher before generic workspace construction. The controlling principal sequencing direction places the implementable activation/consistency contract before publication depends on it; durable fencing belongs in M3 and readiness/activation implementation in M4/M5. The next implementation PR may make that sentence explicit, alongside the evidence work, with the necessary explicit history-hash update. Do not change this already-reviewed head for that clarification or create a paperwork-only PR.

The bounded next experiment can establish a correctly staged test fixture; it cannot certify that database, catalogue availability and both Function projections are atomically synchronized. Production required-product enablement remains blocked by its unproved readiness/enforcement criteria. The supported Online Store scope is not expanded into POS/headless or a catalogue-wide outage policy.

## Verification performed

Inspected: the changed-file inventory; admission helper/tests; Rust capacity module; relevant complete Transform/Validation paths; copied verifier/parser; measurement generator, acceptance/build scripts, report and CI job; architecture/ledger/operating-model/AGENTS/history-check patches; imported readiness matrix and the principal's original supplied direction. Generated schemas and every copied source file were not independently compared byte-for-byte.

The actual M0-013 CI log confirms Node 24.21.0, Rust 1.98.1, pnpm 12.6.0; 10 retained and 9 admission TS tests; 13 verifier, 18 Transform and 21 Validation Rust tests; both local CLI schema/build checks; 88 candidate executions; eight same-input comparisons and 152 retained replays. The seven head-associated workflows are successful: 36474207061, 36474206966, 36474207098, 36474207199, 36474207224, 36474207334, 36474207638.

The principal downloaded CI artifact 10993075828. Its ZIP SHA-256 is `2257e3b87c9bcfc3dd0c42ca2c41da163bfd62eb90b2e3bdfc41982486b6c71e`, matching GitHub. Independent offline checks verified ZIP integrity, 152 row/input/expected/actual/binary bindings, the recorded eight comparison bindings, and exact arithmetic/signatures/output semantics for 58 accepted signed cases plus eight ordinary controls. The two baseline expected-output disagreements were explicitly retained. The candidate matrix SHA-256 is `191f8851790adb7f34f2476bd94fa3dd7c946faeb41eb7901239fbd4887dc7e8`.

CI candidate executables:
- Transform: `cebca846a17013a42dc590c18069ef5d9f0432452eb702d29bc46bbc1985590b` (179,380 bytes).
- Validation: `93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd` (180,858 bytes).

The principal did not execute Wasm, rebuild TS/Rust, remeasure instruction/memory/stack use, independently refetch every source hash, or operate Shopify. Source/query/schema/runner bytes are not included in the downloaded CI ZIP. Local and CI executables differ; each measurement belongs to its own artifact. A future CLI optimization step must not be allowed to substitute an unmeasured binary under an older hash.

Current architecture hashes recorded by CI:
- Plan v1.3: `66cf63bfdf1ede13c6cb7549e346565e44ff1a1f4ca0938efa6feb01d652bed0`.
- Ledger v1.3: `d4297182b12978822dae124a040a0d47aafcdb7749f7ad8602f0626e964937e9`.

## Next action

After the owner authorizes the exact normal merge, execute the attached M0-014 bounded Public-app checkout proof. Use the retained app/store, candidate wire and independent enforcement; no billing actions or another general readiness report. Return one integrated PR. The subsequent principal review decides the remaining foundation prerequisites; it does not automatically start M1.

## Sources

- PR and source: https://github.com/Optidigi/insignia/pull/18
- Fixed review packet: https://github.com/Optidigi/insignia/blob/72f47577ac8563923aff2bd277484c44392eb92c/docs/delivery/review-packet-M0-013.md
- Measurements: https://github.com/Optidigi/insignia/blob/72f47577ac8563923aff2bd277484c44392eb92c/spikes/m0-013/evidence/measurements/README.md
- CI: https://github.com/Optidigi/insignia/actions/runs/36474207061
- Shopify Function limits/configuration (2026-07 request resolves to latest, displaying 2026-07 at review): https://shopify.dev/docs/api/functions/2026-07
