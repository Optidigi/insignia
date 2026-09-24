# Principal review — Insignia PR #2

Principal: ChatGPT, Insignia Rewrite Project. Issued 24 September 2026.

## Verdict and exact binding

**APPROVED — PF-002 documentation and readiness-evidence checkpoint.** No merge-blocking defect was found in the inspected six-file change set. This verdict is bound to:

| Field | Value |
|---|---|
| Repository / ID | `Optidigi/insignia` / `1386102402` |
| PR | `https://github.com/Optidigi/insignia/pull/2` |
| Base | `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb` |
| Head | `dda65d4f0570123035dd09ec3c9f9922d6df4ebf` |
| Effective merge base | `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb` |

Merge remains a maintainer action unless the user delegates this exact merge. PR #1's earlier delegated merge authority does not cover PR #2. Preserve the approved head; changed refs require refreshed review. No principal merge or Shopify mutation was performed.

## Accepted findings

**Restricted execution:** Accept the recorded fresh read-only and bounded-writer routes. They perform actual file/skill reads, positive writes where allowed, and policy-denied writes against host-writable canaries. Accept the same-launch client config/thread/read-event evidence for `gpt-6-sol` with `high` effort. This is client configuration evidence, not private provider attestation. Continue using explicit proven launch flags; the project-local config is not proven loaded. Native subagents remain optional and disabled. Shell isolation is not proof of connector authorization or secret isolation.

**Rust host and Wasm:** Accept the dependency-free native test, executed build script and loaded procedural macro, together with the generic Wasm compile, using the explicitly selected local Zig linker. A system-default `cc` is not independently required when the selected linker route works. Carry the required environment into subsequent builds, record it reproducibly, and test the real Shopify SDK next. Zig is a local host-build tool, not an additional application language or a required production dependency.

**Shopify identity:** Accept the CLI's existing app/client-ID observation and the owner's comparison at the named Dashboard resource, at their respective evidence scopes. The app is not installed and has empty requested scopes. Neither is a bootstrap defect. They become explicitly authorized development setup in M0-001, not another preflight checklist.

**Distribution qualification:** NOT satisfied. Keep distribution `UNVERIFIED`; do not relabel it public, custom or unselected. The PF-002 requirement to observe distribution has not passed. The principal carries this uncertainty into G1's non-Plus/public-app qualification, rather than withholding local build and designated development-store exploratory work. This is a delivery prerequisite refinement, not a change to the locked public-app requirement. No full G1 PASS or production non-Plus compatibility claim may be based on this development store alone.

## Review performed and limits

Inspected live PR metadata, the fixed-ref comparison, the six-file inventory, AGENTS changes, the attributed PR #1 record, the full PF-002 prompt, readiness evidence (including smoke sources and the complete app-server probe driver), current state, and tooling delta. The comparison is five commits ahead of the stated base. No architecture, application source or migration change appears in that comparison.

Independently computed hashes of the supplied plan and ledger, matched them to the handoff ZIP bytes, and matched the Git blob IDs returned by GitHub at the reviewed head:

| File | SHA-256 | Git blob |
|---|---|---|
| implementation-plan.md | `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` | `d3d7d9c155cdcdcc3b88aeaaa77eebb10d8a767d` |
| decision-ledger.md | `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb` | `3544e054bb52c11713b2bc1c96cdf6d7a2264936` |

The repository plan and decision ledger are unchanged. `PR-002-verification.json` records the local comparison and review metadata. Server commands, sandbox behavior and Shopify account observations are reported execution evidence, not commands independently rerun on the server by the principal. The principal read and evaluated the probe code; it was not re-executed here. Container network retrieval failed, so GitHub connector reads supplied repository content.

GitHub returned zero check runs and no legacy commit statuses for the reviewed head. That is disclosed absence of CI, not a passing suite. It is acceptable for this evidence-only PR; a lean offline CI job belongs in M0-001's executable harness. A local review with no findings is supporting evidence, not a substitute for this review.

## Non-blocking follow-through in M0-001

Carry explicit runtime/linker settings into a reproducible launcher instead of assuming the project's config layer or `/usr/bin/cc` works. Keep historical PF-002 probes historical: hardcoded file-line assertions and scratch paths are evidence for this checkpoint, not a permanent generic CI framework. Resolve the archival PR #1 verification-file reference by identifying the supplied external review package or linking its provenance; do not fabricate a missing file or block development over it.

The next slice may add the minimal Function/app-development harness and synthetic fixture tests only. The full product workspace, quote engine, Ed25519 protocol, independent production Validation Function, admin, database, artwork and billing remain later work. This prevents a small feasibility experiment from becoming an unreviewed application scaffold.

## Native GitHub submission

The principal attempted an APPROVE review anchored to this exact head. GitHub returned HTTP 403, `Resource not accessible by integration`; the review was not posted. No fallback comment was attempted. This document is the attributed external project verdict, not a native GitHub approval. The response is recorded in `PR-002-verification.json`. Do not submit an approving review as the PR author or bypass protections.

## Next authorization

No PF-003 is required. The companion `M0-001-same-variant-dev-lifecycle.md` is the next principal-issued bounded slice. Repository work starts after PR #2's authorized merge. Staging mutations require the user's explicit acceptance of that prompt's named-resource permission envelope. The companion launch message supplies that consent when sent by the user. Successful development-store tests produce G1 evidence, not full gate acceptance. G2–G8 remain NOT_RUN and outside this slice.

## Evidence and platform references

- Reviewed PR: `https://github.com/Optidigi/insignia/pull/2`
- Readiness evidence: `https://github.com/Optidigi/insignia/blob/dda65d4f0570123035dd09ec3c9f9922d6df4ebf/docs/delivery/evidence/pf002-readiness.md`
- Current state: `https://github.com/Optidigi/insignia/blob/dda65d4f0570123035dd09ec3c9f9922d6df4ebf/docs/delivery/state.md`
- Shopify dev-store Function testing: `https://shopify.dev/docs/apps/build/functions/test-debug-functions`
- Distribution selection and irreversibility: `https://shopify.dev/docs/apps/launch/distribution/select-distribution-method`
- Cart Transform and development-store operation privileges: `https://shopify.dev/docs/api/functions/2026-07/cart-transform`
- Extension-only template restriction: `https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app`

These platform sources were checked for the next slice. They are not evidence that this app is public-distribution, installed, or capable of passing G1.
