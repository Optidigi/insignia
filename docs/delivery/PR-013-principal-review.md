# PR #13 — principal review

**Verdict: CHANGES_REQUESTED.** Review date: 28 September 2026.

| Binding | Value |
|---|---|
| Repository | Optidigi/insignia |
| PR | https://github.com/Optidigi/insignia/pull/13 |
| Base / effective merge base | `31484d328ec401a30994d073518b11eb67777433` |
| Reviewed head | `fc6159664a829962983a33cdfe5c415645aee29e` |
| CI synthetic merge | `640a72759d3eed2920dad0f3ce0c13e5e02a07c3` |
| Head and synthetic-merge tree | `c268f7f3cf9f4736d657e3d00964b38ac7a78a53` |

The native REQUEST_CHANGES attempt returned HTTP 403 and was not posted. This is the external principal verdict, not a native GitHub review. No merge, repository-content edit or Shopify mutation was performed by the principal.

## Required findings

### R1 — preserve known cancellation boundaries in current entitlement (high)

Location: `spikes/m0-010/src/partner.ts:166–175`, flowing into `BillingProof.decideNewAction` in `src/index.ts`.

`currentHistory` bounds the current interval only when `pendingPlanHandles.length > 0`. It retains `cancelAtEndOfCycle` in the parsed observation but does not use it when deriving the interval. A current observation immediately before a scheduled cancellation therefore becomes an unbounded active interval.

Reproduced synthetic case:

- Provider read at `2026-06-14T23:59:00.000Z`.
- `cancelAtEndOfCycle: true`; current cycle ends `2026-06-15T00:00:00.000Z`; no pending plan update.
- Parser returns ACTIVE and normalizer emits `until: null`.
- The entitlement decision returns ALLOW before, exactly at and one minute after the cancellation boundary. Only expiry of the five-minute snapshot allowance stops reuse.
- With the known boundary explicitly supplied in the interval, the same entitlement logic returns PENDING_VERIFY after the boundary.

This is not an unavoidable discovery delay for an unknown cancellation: the provider observation already carries the scheduled boundary. New quote/acceptance/renewal permission must not outlive it merely because the snapshot remains young.

Required correction: preserve the exact known validity ceiling; at/after it, obtain fresh authoritative state or refuse/pending. Do not invent either cancellation completion or replacement subscription from an old observation. Add parser → normalizer → public-use-case regressions immediately before/at/after the boundary. Check the same boundary discipline for pending plan changes and trial end without changing the approved commercial semantics or revoking existing accepted buyer offers.

Primary support: Shopify ActiveSubscription defines `cancelAtEndOfCycle` as cancellation at the cycle end and exposes the current cycle separately.
https://shopify.dev/docs/api/partner/latest/objects/ActiveSubscription

### R2 — validate flat tier amounts before asserting a zero-cost band (medium)

Location: `spikes/m0-010/src/partner.ts:118–131,154–161`.

The query requests `PriceTier.amount`, but the parser never validates or preserves that component. Setting either tier's flat amount to `"1.00"`, `"-1.00"`, `"not-a-decimal"`, null or omitting it still returns ACTIVE and `zeroCostBandUpTo: 2`. Shopify defines `amount` as a flat amount for the tier, distinct from `amountPerUnit`.

This contradicts the parser's supported zero-cost allowance plus per-unit overage representation. A nonzero flat charge cannot be silently dropped while calling the first band free. Missing/malformed required price components must not become a recognized supported tariff either.

Required correction: validate both flat amounts as exact decimal values and require zero for this scoped two-band tariff. Return an explicit unsupported/invalid result for nonzero flat fees or malformed/missing fields. Alternatively preserve all economics and prove an intentionally supported representation, but expanding the product tariff model is unnecessary for this correction. Keep legitimate fractional per-unit values such as `"0.005"` accepted. Full live plan/catalogue price agreement remains a later integration prerequisite.

Primary support:
https://shopify.dev/docs/api/partner/latest/objects/PriceTier

## Spec and standards disposition

The commercial path is well separated: first-paid order qualification, immutable occurrence/key, local fact/outbox, transport-only receipt and aggregate-only reconciliation. Trial and inactive classifications are not retroactively charged; refunds do not reverse usage. Those design choices remain appropriate.

R1 and R2 are implementation defects against the current scoped contract, not unresolved owner decisions or reasons to reopen the billing architecture. The existing tests mainly supply already-normalized contract intervals or normal zero-flat-fee fixtures; add adversarial cases across the provider-to-application seam rather than testing only isolated helpers.

No additional scope expansion is requested. Preserve the distinction between real provider facts, synthetic plan values, test execution and unrun live scenarios. The `VerifiedPurchase` and complete historical reconstruction seams, durable database transactions, real no-charge eligibility and provider outcome visibility remain disclosed later obligations.

## Verification

- Read current PR metadata and all changed filenames; inspected all five production TypeScript modules and provider/application/pipeline tests relevant to the findings, the original M0-010 prompt, review packet and provider contract.
- Read the actual billing CI job log: pinned Node 24.21.0 / pnpm 12.6.0, frozen install, strict TypeScript, 31 passing tests, architecture/history check.
- Verified all three applicable workflows are successful at the reviewed head. Verified synthetic merge parents and exact head-tree equality through GitHub.
- Reconstructed `partner.ts` and `time.ts` from connector-returned contents and matched their Git blob identities exactly before executing them. The reproduction includes disclosed extracted entitlement method bodies, not the entire `index.ts` module.
- Independently executed the targeted reproducer under Node 22.16.0. It verifies R1, twelve tariff cases for R2 and a positive fractional-unit-rate control. No network/provider action is performed.
- No workflow artifact is retained for the billing run; none was downloaded. Direct raw-source download from the principal runtime failed DNS resolution, so source inspection used the GitHub connector.

Limits: the principal did not run the full suite on pinned Node 24, reconstruct every source/test file, inspect the live Dashboard or send events. The reproduction script optionally imports the full repository modules so the local agent can rerun it on the pinned runtime. Green CI establishes the existing tests ran; it does not refute uncovered cases.

The plan/ledger are absent from the changed-file inventory and CI reports unchanged v1.2 hashes. The principal did not independently rehash every historical record in this review.

## Required next action

Keep PR #13 open. Complete `M0-010R-billing-contract-corrections.md` on its existing branch with failing regressions first, fixes, final-head checks and fresh local Spec/security reviews. Return the same PR for principal review. No merge, no new milestone, no live contract/meter/event, no preview-cleanup loop and no G8 pass are authorized.
