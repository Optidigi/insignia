# Principal re-review — PR #13 / M0-010R

Date: 28 September 2026. **Verdict: APPROVED — corrected off-store billing checkpoint.**

Repository: Optidigi/insignia. Base/effective merge base: `31484d328ec401a30994d073518b11eb67777433`. Approved head: `8bda74f1985762923580b5d1d92b56c4a0d7203f`. This supersedes CHANGES_REQUESTED at `fc6159664a829962983a33cdfe5c415645aee29e`. Approval is bound to these inputs; changed code or merge base needs review.

A native APPROVE submission for this head returned HTTP 403, Resource not accessible by integration. Nothing was posted. This record is the attributed external principal verdict, not a GitHub review. The principal made no file/repository/staging mutation and did not merge.

## Findings closed

**R1 CLOSED.** `currentHistory` bounds current authority by the active trial end, or by the known cycle end for a scheduled cancellation/pending plan change. A five-minute freshness allowance cannot extend that authority. Public parser-to-application regressions return ALLOW before and PENDING_VERIFY at/after the boundary. Empty pending-update items reject as UNKNOWN_CONTRACT. Reverification is not automatic proof of cancellation, replacement or historical trial state. Existing buyer authorizations are not revoked by this change.

**R2 CLOSED.** Both `PriceTier.amount` values must be exact decimal zero for this supported two-band zero-allowance/per-unit-overage representation. Nonzero, missing, null and malformed flat amounts reject. Valid fractional per-unit `0.005` remains supported. This does not establish agreement with a real merchant plan catalogue or all provider tariff forms.

**Standards/security:** No new merge-blocking defect found in the inspected correction and its integration with the previously reviewed proof. **Spec:** Both requested corrections and the reviewer-found empty-pending edge are implemented with public-seam regressions. Qualification, trial waiver, permanent event identity and transport-only 202 semantics remain unchanged.

## Verification and limits

Inspected the old-to-new comparison, full corrected parser/normalizer, added application tests and correction review packet. The change since the old head consists of one commit and 14 files; production behavior changes are confined to `partner.ts` with test and documentation/evidence updates.

Read the actual billing CI job log (job 108729373546, run 36357971726): frozen installation, strict TypeScript and all 34 tests pass on Node 24.21.0/pnpm 12.6.0. Also verified the successful head-associated embedded and publication workflows, 36357971708 and 36357971684. Their logs were not independently re-read in this re-review.

CI synthetic merge `0cc91dba0506b7bd1749e3d8a76d4270c22cb80c` has the exact base/head parents. It and the approved head share source tree `9f296daaa4521415af820a8815237ea31ee74a9d`.

Independently reconstructed the parser/time source using the earlier retained source and inspected edits, and verified exact Git blobs before execution: parser `654f3ce9b673bd05ff2a56408aa2c5ed7e2cd6f2`, time `2b04172376778de7193738eb986f2843988146ef`. On Node 22.16.0, ran the complete parser/normalizer with an explicitly disclosed unchanged entitlement-method excerpt. Four transition combinations pass immediately before/at/after the millisecond boundary; ordinary renewal remains allowed; empty pending items reject; all 18 flat-amount cases match expected outcomes. See `verification/results.json` and source verification. This is not a claim to run the complete checkout's 34-test suite or pinned Node 24 locally. The script accepts a checkout root for that route.

The plan/ledger are absent from the correction diff; CI still verifies their v1.2 hashes and historical records. The principal did not independently rehash every historical receipt, rebuild the complete checkout, operate Shopify, or authenticate to Partner/App Events. Repeated G8 simulations do not establish provider eligibility, actual plan terms, durable database behavior or successful billing.

## Platform qualification for the next package

Current Shopify primary reference confirms the scheduled-cancellation and tier-flat-amount meanings supporting R1/R2. Shopify also documents a private $0 App Pricing test plan and no-charge testing on eligible development stores. Actual existing-app eligibility, Partner ownership, credentials and meter configuration remain unverified here.

A documentation discrepancy must remain explicit: the currently retrieved App Events reference and version selector show `unstable`, while the local encoder uses `2026-07`. The versioned documentation URL could not be retrieved through this web tool. This is not an observed API rejection and does not invalidate a local encoder test; it means a live adapter must establish its endpoint/version rather than inherit an unverified support claim. Preserve the old evidence and label an unstable prototype dependency accurately.

## Disposition

M0-010/M0-010R is complete at its off-store scope. G8 remains IN_PROGRESS, not PASS. No product pricing values, production protocol, new merchant capacity, v2 adoption, M1 or release is approved. The stopped M0-009 preview remains the accepted temporary holding state.

The owner may authorize a normal merge of this exact PR and the separately scoped M0-011 provider experiment. That package must establish actual no-charge eligibility before any billing mutation; a missing distribution/pricing/credential prerequisite is a concrete owner action, not permission to silently change it.

## Sources

- Corrected source: https://github.com/Optidigi/insignia/blob/8bda74f1985762923580b5d1d92b56c4a0d7203f/spikes/m0-010/src/partner.ts
- Public-seam tests: https://github.com/Optidigi/insignia/blob/8bda74f1985762923580b5d1d92b56c4a0d7203f/spikes/m0-010/test/application.test.ts
- CI: https://github.com/Optidigi/insignia/actions/runs/36357971726
- https://shopify.dev/docs/api/partner/latest/objects/ActiveSubscription
- https://shopify.dev/docs/api/partner/latest/objects/PriceTier
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/api/app-events/latest
- https://shopify.dev/docs/api/app-events/latest/creating-events
