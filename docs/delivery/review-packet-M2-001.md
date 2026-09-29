# Principal review packet — M2-001

## Identity and scope

Repository: `Optidigi/insignia`. Slice: [M2-001](prompts/M2-001-CONFIGURATION-IDENTITY-PRICING.md). Base: verified normal PR #20 merge `911818301cc96d98f0b612259d1ba98dec8b9df4`. The final PR URL, head, effective merge base and CI run IDs belong in the PR body after the immutable final head is pushed. Required next action: principal review; no M2 PR merge is delegated.

The branch adds a pure pricing/configuration domain and Zod 4 transport contracts. It changes no v1.3 plan/ledger, archived evidence, experimental Function source, merchant resource or provider setting. It does not adopt v2 or sign buyer authorizations. The [source provenance](M2-001-provenance.md) binds the supplied prompt and external PR-020R verdict; the latter authorized only PR #20's already verified normal merge.

## Executable economics

`priceProposal` validates published rule references, normalizes tenant/product/revision/design groups, totals customized physical quantity `Q` across products, selects all-units tiers from `Q`, resolves explicit currency overrides or a versioned FX snapshot, adds contextual real-variant bases and additive unit economics, applies setup once per group, then allocates aggregate setup across physical units in canonical group/variant/ordinal order. It emits at most two deterministic price buckets per real variant from this setup allocation. Each bucket retains group, product, revision hash, variant, ordinal range, accepted unit price and line index. A negative placement/step adjustment is allowed only if every final real-variant unit price remains nonnegative. Amounts are exact BigInt internally and bounded decimal strings on the wire. No floating-point money or hidden clock/network lookup is used.

| Worked example | Executed assertion |
|---|---|
| A: one design, 10 Small + 15 Large | €35 setup once; 25 at €24.40; €610.00 total. |
| B: two products at complete-order Q=500 | Both tiered rules use the 500 tier; €14,585.00 total. Plain merchandise leaves Q unchanged; removing a customized group reprices the remaining group at the lower tier. |
| C: €1 setup across 3 units | €91.00 total, with one €30.34 unit and two €30.33 units. |
| D/E: distinct designs and logo-later intents | Separate design/intent gets separate setup; an explicitly reused intent aggregates. |
| F: EUR→USD FX plus exact USD override | €3 unit resolves to $3.30; $21 setup override bypasses FX; four $31.05 units total $124.20. |
| G: currency edges | JPY zero exponent and KWD three exponents pass; excess precision and wrong known exponent reject. |
| H: different contextual variant bases | One setup remains; each real variant keeps its own base before allocation. |

The seeded invariant suite runs 200 deterministic quantity partitions/reorders (LCG seed `0x12345678`) against an independent arithmetic total, checking exact conservation, canonical ordering, physical quantity preservation and one setup. Focused tests also cover splitting/recombining variant rows, method multiplicity, zero replacement overrides, signed adjustments, overflow, mixed shops, explicit FX validity, malformed IDs/versions and omitted production options. This is a deterministic generated-case suite, not a statistical property-testing library. No preimplementation red public-seam run was recorded; the material signed-adjustment regression was added during integration.

## Versions and boundaries

Serialized versions introduced: `m2-published-config-v1`, `m2-customization-group-v1`, `m2-design-identity-v1`, `m2-money-v1`, `m2-proposal-economics-v1`, `m2-pricing-v1`, `m2-currency-resolution-v1`, `m2-fx-resolution-v1`, `m2-half-even-v1`. The published config carries a revision content hash; this pure slice checks its shape and matches it to groups, while the later publisher/storage boundary must establish that it actually hashes the immutable published content. The later Shopify adapter must verify real variant ownership and contextual-price applicability. Full ISO exponent sourcing, FX provider/staleness policy, artwork readiness, quote acceptance/hash and signing are likewise later boundaries, not claims made by this PR.

Domain exports are explicit and independent of Zod, Shopify, Astro, Preact, Konva, database, filesystem, network, ambient time/randomness and environment. Contracts use pinned `zod@4.6.5` at JSON boundaries, reject unknown schema versions and malformed lexical inputs, and do not verify untrusted quote economics by themselves. Recompute from trusted published inputs before purchase authorization. The current variant ordering is ASCII stable-ID order; a future Shopify adapter must define its external-ID normalization consistently.

## Checks and review

The integrated development branch passed focused `@insignia/domain` tests (23), `@insignia/contracts` tests (6), both package typechecks, package public-export imports, Biome and `check:boundaries`. The boundary command exercised 12 negative source fixtures and 18 ambient-effect AST/graph tests. The first root `corepack pnpm check` completed through style/build/unit/vector/boundary/secret, archived Cargo isolation, Rust/native/Function replays, browser interactions and historical integrity. It began before the final review fixes; the final-head frozen-checkout run and CI are reported in the PR body. Its Function builds remained unchanged at final Wasm SHA-256 `ef6788a4188f3da809b49c0a54f9b6f7064a399259b5746ce01bae83bd251de1` (Transform) and `e4247608b1e2e6b6225c65ab4eb40ee65b2f7759857cf6a8b5fb078a24b8061f` (Validation), with 8/18 offline replay rows.

Fresh read-only Spec/correctness and Standards/security reviews inspected the integrated branch. Spec found early rejection of a valid signed adjustment, a matching signed-DTO mismatch and omitted production-option selections; these were fixed with focused regressions. Security found unbounded BigInt lexical inputs and malformed FX proposal DTO acceptance; both were bounded and tested. Their final-head dispositions are recorded in the PR body. No authenticated Shopify/provider call, token, secret-file read, preview, deployment, DB provisioning, commerce or billing mutation was performed.

## Principal decision — reserved

Verdict, gate acceptance, final reviewed refs and authorization for any later package remain with the principal. This packet is implementation evidence, not an approval or complete gate pass.
