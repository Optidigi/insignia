# Principal review — Insignia PR #6

Date: 25 September 2026. Principal: ChatGPT, Insignia Rewrite Project.

## Verdict and exact binding

**APPROVED — observed development-store lifecycle checkpoint.**

- Repository: `Optidigi/insignia`, repository ID `1386102402`.
- PR: `https://github.com/Optidigi/insignia/pull/6`.
- Base/effective merge base: `a9398ebf8d069f3556c0b359be1372d94d45f82e`.
- Reviewed head: `16444b19823d044b1e5f4cf3a547ae465a3be3d0`.
- Principal native APPROVE submission returned HTTP 403, `Resource not accessible by integration`; it was not posted. This is an attributed external verdict, not a fabricated native review.

No merge-blocking repository defect was found in the inspected change. The maintainer may merge this reviewed change; author merge authority requires explicit owner delegation. Keep the head unchanged until that merge. No merge, staging operation or deployment was performed by this review.

## Outcome accepted

Accept `PASS_OBSERVED_PROCEDURE` for the recorded C/R/B actions only, on this Basic development store, with the limitations below. This is a real increment of G1 evidence, not a full G1 pass.

| Case | Accepted observation |
|---|---|
| C / #1002 | A plain duplicate-variant control purchased four Small units for USD 80. Native partial fulfillment contained one target unit, not its bystander. The recorded native refund/stock checks return it to its pre-order stock baseline. |
| R / #1003 | The six-unit mixed purchase was USD 170. Fulfillment `6512343908510` contains one marked Small line `16954830782622`. Fulfillment `6512345579678` contains the remaining marked Small two, Medium two and plain Small one. |
| R refunds | Refund `1017067667614` is USD 30, one marked Small, `RETURN`. Refund `1017068486814` is USD 140: plain Small one/USD 20, marked Small two/USD 60, Medium two/USD 60, all `NO_RESTOCK`. |
| B / #1004 | Direct cancellation readback records `cancelledAt=2026-09-25T13:11:42Z`, reason `OTHER`, REFUNDED and USD 90. Receipt assertions reconcile the release of its three unfulfilled commitments without shipment. |
| Budget and cleanup | Three new orders / thirteen units. The retained cleanup response has no transforms, the fixture ARCHIVED and unchanged installation scopes. Final Small available/committed/on-hand is 5/2/7; Medium is 8/2/10. This matches R's three Small and two Medium units not returned to stock, not an unexplained inventory loss. |

Protected order #1001 and its fulfillment remain protected history; the before/after equality assertions pass in CI. Its cause remains **UNDETERMINED**. Neither Shopify, lineExpand nor the prior operator is assigned as the cause by this review.

## Immediate-R evidence gap — adjudicated

The immediate native projection and retrospective original-event extract retain the target value `1`, the sole selected target marker, zero/deselected bystanders, the correct order/location and `1 item selected`. A distinct pre-submit API read supplies order/FulfillmentOrderLineItem context. The resulting native fulfillment and inventory receipts identify the actual line/quantity outcome.

They do **not** retain the target's raw limits/validity/shadow properties at the last instant. The earlier detailed form and regenerated guard output must not be represented as those missing observations. This is a disclosed evidence/procedure-recording shortfall, not a reason to assert a fully audited guard execution.

**Disposition:** sufficient for the narrow observed-outcome conclusion; no new staging run solely to collect the omitted raw properties. Preserve the gap and original provenance. Future planned native acceptance tests should save their complete relevant projection immediately before action; this does not introduce a request-body interception prerequisite or a universal DOM schema.

## Runtime configuration deviation

`runtime-execution.json` records the active host as `gpt-6-sol` / `medium`, despite the required sol-6-high profile. High-effort reviewer launches do not establish a high-effort orchestrator. This is a workflow nonconformance, not provider-private attestation uncertainty.

Accept the inspected artifacts and Shopify outcomes on their evidence; do not rerun completed orders simply because of that setting. Before new substantive implementation, use the actual supported high-effort host setting or the already verified CLI route as orchestrator. Record effective same-launch client settings; a medium-effort shell/relay must not silently remain the implementation decision-maker. Native delegation may remain unavailable, with separate restricted sessions used instead. No new general preflight or global security/configuration change is required.

## Verification performed and limits

Reviewed live PR metadata; the 102-path inventory; fixed-ref comparison and merge base; guard/adaptation and tests; resumed receipt checkers and their CI wiring; scope/operating-model delta; key native fulfillment, refund, cancellation, cleanup and provenance records. Read the actual job log for run `36147378618`, job `108111798307`.

CI passed formatting/clippy, two native Rust tests, release Wasm build, eleven Wasm fixtures, fifteen Python tests, the receipt-checker path and the 44/16/88-file manifests. Its synthetic merge checkout `90eb39ca7997de69650ab1a02d6637251aeca8ac` has tree `3ea598ba513817fb3b573087e52256e58e75b69d`, identical to the reviewed head's tree. Thus the final provenance extracts are covered by final-head CI despite not rerunning the entire local build after their addition.

Independently checked local copies of the plan/ledger against the supplied handoff ZIP and their published Git blob IDs. They remain unchanged. Independently reconciled selected money/quantity arithmetic from inspected receipt fields. See `PR-006-verification.json`.

Limits: this review used the GitHub connector; direct Git access from the review container failed DNS resolution. I did not execute Shopify operations, rerun the complete suite on the user's server, inspect every raw receipt or visually review every PNG, or independently download/hash all 88 receipt files. The full-manifest result is verified CI evidence, not a principal-local rerun. Successful checks are not a claim of universal platform behavior.

## Gate disposition and next scope

- G1: **IN_PROGRESS**; recorded C/R/B observed procedure accepted. Ordinary public-app/non-Plus qualification, untested capacity/color/context cases and shipping-scope integration remain unresolved where required by the plan. Historical failure retained.
- G2/G3/G5: not passed; the companion M0-004 authorizes local portions only after owner-approved predecessor handling and runtime correction.
- G4/G6/G7/G8 and M1: no new execution authorization here. The necessary local validation-target harness in M0-004 is part of resource/codec proof, not G6 live enforcement acceptance.
- No protocol freeze, production approval, distribution selection or staging mutation follows from this review.

The next package is one local TypeScript/Rust authorization and exact-money proof. It preserves the existing lifecycle harness and receipts and does not consume more test orders. It is permitted to progress independently of unresolved public-app qualification; it cannot use that qualification as satisfied or move into the full application.

## Primary evidence pointers

All repository paths refer to reviewed head `16444b19823d044b1e5f4cf3a547ae465a3be3d0`:

- `spikes/m0-001/evidence/m0-003r/README.md`
- `spikes/m0-001/evidence/m0-003r/candidate-R-immediate-pre-submit.json`
- `spikes/m0-001/evidence/m0-003r/candidate-R-immediate-tool-event.json`
- `spikes/m0-001/evidence/m0-003r/fulfillment-C-after-partial.json`
- `spikes/m0-001/evidence/m0-003r/fulfillment-R-after-partial.json`
- `spikes/m0-001/evidence/m0-003r/fulfillment-R-after-remainder.json`
- `spikes/m0-001/evidence/m0-003r/order-R-refunds.json`
- `spikes/m0-001/evidence/m0-003r/order-B-cancellation-readback.json`
- `spikes/m0-001/evidence/m0-003r/post-cleanup.json`
- `spikes/m0-001/evidence/m0-003r/runtime-execution.json`
- `spikes/m0-001/scripts/check-m0-003r-outcome.py`
- `spikes/m0-001/scripts/guard_native_selection.py`
- CI: `https://github.com/Optidigi/insignia/actions/runs/36147378618`
