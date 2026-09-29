# PR #20 — principal review

29 September 2026. **CHANGES_REQUESTED.** Continue the existing PR with the two local corrections below; do not merge or start M2. The prior M1 entry decision remains in force.

## Review binding

- Repository: Optidigi/insignia; PR #20; target main; open, not draft, unmerged at review.
- Base/effective merge base reported in the PR: `a467afcce5f0324a13fd3bfe647d3543eae159a4`.
- Reviewed head: `87a6f7557774a31ca6813ad865f028bb79b3af2e`.
- Head tree: `d660f9a52d3b00102d24fcb6b198f0aced972a11`.
- CI synthetic merge: `af31c7fca14cdd5d1fab700e66261f69d107e6b1`; its fetched parents are the exact base/head and its tree equals the fetched head tree.
- Native REQUEST_CHANGES submission anchored to that head returned HTTP 403, Resource not accessible by integration. It was not posted. This document and the project-chat verdict are the external principal disposition.

This is a targeted changes-requested review of the foundation boundaries, runtime evidence and CI provenance, not an assertion that every line of all 100 changed files has passed a comprehensive audit. No repository source, Shopify resource or user-server secret was changed by this review.

## R1 — domain purity needs a global-API check

**Medium; required before merge.** Files: `.dependency-cruiser.cjs`, `scripts/boundaries/check.mjs`, `biome.json`, `packages/domain/tsconfig.json`.

The M1 prompt explicitly requires an executable domain boundary excluding implicit clocks, randomness and network effects. Current rules inspect module dependency edges, while Biome has no scoped global/API restriction. The domain compiler retains default environment libraries and automatic ambient-type discovery. No-import uses of `Date.now()`, zero-argument `new Date()`, `Math.random()`, `globalThis.Date.now()`, `fetch()` and `globalThis.crypto.randomUUID()` escape the intended dependency-edge prohibition.

The current money primitive is not alleged to use those APIs. This finding concerns the promised guard, before the pricing domain grows. It is not a newly discovered money or checkout vulnerability.

I reconstructed the exact money source and tsconfig, verified their Git blobs, appended six separate never-invoked probe functions, and compiled each successfully. Independent tools were Node 22.16.0 and TypeScript 5.8.3, not project pins 24.21.0/5.9.3. I did not run dependency-cruiser, Biome or the full root suite with these injections; the dependency-edge conclusion follows from the inspected rules and no-import probes. Installation of the pinned dependency-cruiser in the review container failed on registry DNS resolution, so no substitute version is represented as the pinned tool.

Required closure: scoped syntax-aware lint/AST enforcement for ambient effects, appropriate compiler ambient-type isolation, and normal-command negative regressions. Preserve deterministic Math/BigInt and explicit-input operations. Scope restrictions to production domain sources; legitimate worker/UI/test clocks need not be banned globally. Representative plain/globalThis and direct-helper cases must fail for the intended rule. Do not claim a malicious-code sandbox or unrestricted alias/dataflow proof.

## R2 — Polaris interaction can pass without Polaris

**Medium; required before merge.** Files: `apps/web/src/pages/local-test/interaction.astro`, `apps/web/test/runtime.test.mjs`.

The test clicks `s-button` and checks a Preact counter, but never checks component registration/upgrade or successful component initialization. The page deliberately styles an unupgraded tag as a clickable fallback. Preact attaches the click handler to that tag independently of whether the Polaris implementation is present. Thus a broken or blocked library can satisfy the current success criterion.

The packet discloses the fallback, which is good provenance, but an unupgraded tag is not the real Preact/Polaris interaction required by the M1 brief. This does not invalidate the previously accepted embedded-Admin observations.

The URL `polaris-1.1.js` is a documented valid version pin. There is no finding that its spelling is wrong, that the CDN is currently failing, or that a version upgrade is needed. I did not run a fresh browser or a blocked-CDN reproduction here. The missing assertion and fallback path are established by source inspection.

Required closure: an explicit, bounded real-component readiness/upgrade assertion, a meaningful interaction with the upgraded button, and a blocked/missing-library negative control proving that the real-component assertion cannot pass through fallback markup. A separate Preact-only shell test is fine, but is labelled separately. Use the existing public-library/local-browser route without authenticated Shopify access, merchant credentials or an App Bridge authentication experiment. Keep the current supported pin unless actual evidence requires a compatible correction.

## Positive findings and retained limits

The inspected source retains minimal non-commerce runtimes and no production signer. The worker reports `durableReady:false`. The dependency tests do cover real Node imports and transitive re-exports. The unresolved register preserves the owners/blocking points for live capacity, stack, protocol adoption, publication, admin and billing acceptance. No architecture reset or additional M0 experiment is requested.

All eight head-associated workflows succeeded. I read the actual foundation job log: frozen install; Biome; runtime builds; two domain tests, two worker tests, one cross-language vector; seven negative source fixtures and two rejected browser bundles; secret scans; 20 archived Cargo workspace checks; 57 Rust tests; two current-source Wasm builds; 8 Transform/18 Validation runner cases; two browser tests; historical checks; artifact manifest/upload.

The downloaded CI ZIP matches its provider digest. Fourteen files present in the archive match the 24-entry manifest by size and SHA-256, including both raw/final Wasm pairs. The remaining ten manifest entries are source/query/schema/lock files not supplied in the archive; this review does not claim independent verification of those ten bytes. Replay/Wasm hash bindings match. No Wasm was executed or remeasured in the review container.

The archive is build evidence, not a complete runnable deployment bundle. Local/CI Wasm hashes differ and remain separate evidence. No capacity, stack, protocol or gate acceptance is added.

## Execution direction

Complete `M1-001R-BOUNDARY-AND-UI-CHECKS.md` in existing PR #20. Two bounded local changes; no successor PR, merge, M2, Shopify operation or renewed live-test allowance. Fresh Spec/security review, clean frozen root check and final-head CI return for principal re-review. Preserve v1.3 and historical records.

## Source pointers

All repository paths above were read at the reviewed head. Additional reviewed records: `docs/delivery/review-packet-M1-001.md`, `docs/delivery/M1-001-dependency-map.md`, `docs/delivery/M1-UNRESOLVED-ACCEPTANCE.md`, `package.json`, and `.github/workflows/m1-foundation.yml`.

Primary external references consulted:
- https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- https://nodejs.org/docs/latest/api/globals.html
- https://shopify.dev/docs/api/app-home/latest/web-components/versioning
- https://shopify.dev/changelog/polaris-cdn-1-1-is-now-stable

Independent records: `verification/compiler-results.json`, `verification/artifact-results.json`; scope and limits: `PR-020-verification.json`.
