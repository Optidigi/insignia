# Insignia — principal readiness and sequencing direction

Issued 28 September 2026. This is a principal delivery decision and next-package brief, not a new gate pass or permission to begin M1. The owner launch is required before local execution or tracked amendments.

## Verified checkpoint and review scope

GitHub confirms PR #17 is merged. Remote main is `662a78cd27507d8a2f1eaa976f1c644c93edd1be`; its parents are `e77e4e42f8858662889f9814eeb7d0c4ed3713ab` and the approved head `811a45d4efff0dabe77df6fc573475acaab510e8`. The resulting tree is `ffad6eb2dd81447e201e79e807363ffbd8f4f79b`, matching the reviewed head. No additional merge or native review is needed for PR #17.

The principal inspected the current plan's gate register and milestone dependencies, decision ledger, retained M0-007 resource analysis and prior PR #17 handoff. The server-local `M0-READINESS-REPORT.md` was not available in this chat's files/runtime. This adjudication uses the owner's substantive report summary plus those repository sources; it does not certify every row of the unavailable report. Import that actual report, with its provenance, into the next implementation PR rather than reconstructing it from the summary.

## Decision: correct sequencing, preserve requirements

The reported M1 NO-GO is consistent with v1.2's current execution boundary. However, requiring every full G1–G8 lifecycle result before M1 mixes feasibility with production integration. M9 itself implements paid-order usage delivery, trial/allowance handling and subscription lifecycle behavior included in G8. Richer throwaway mocks are not a good substitute for testing those features in the production implementation.

Approve a narrow v1.3 **sequencing amendment**, to be incorporated and reviewed in M0-013. It changes when a criterion is due, not the product's promised behavior or the evidence standard. Keep the eight original gates; introduce no replacement numbered gates or automatic PASS statuses.

1. M0 establishes the feasibility and bounded contracts needed by the next dependent milestone. A principal-accepted feasibility basis is not a complete gate pass.
2. Production-integration criteria are implemented and tested in their owning milestones. Every outstanding original criterion gets an explicit owner milestone and blocking point. A changed deadline is visible in the amendment, not silently called deferred.
3. Full G1–G8 acceptance for the shipping scope, security/privacy/recovery requirements and release-environment qualification remain prerequisites to merchant rollout. No known unsafe feature becomes usable merely because workspace or database work is authorized.
4. M1 and later milestones still require explicit principal authorization. This direction does not start any of them.

### Dependency assignments

| Area | Evidence required before relying on the boundary | Where remaining implementation is completed |
| --- | --- | --- |
| G2/G3/G5 protocol, allocation and resource basis | Full-path local measurements, an explicit candidate admission profile, canonical cross-language/exact-money agreement; principal adoption before a production wire contract is frozen | M0-013 develops the local evidence; M2/M4 integrate and regress the adopted contract. Live preservation is part of the subsequent public-app proof and checkout qualification. |
| G1 and core G6 price/materialization protection | A bounded proof using the designated Public app/Basic development context, exact prices/real variants and independent rejection of wrong economics; explicit limits on what development context proves | Public-app proof precedes the next M1 readiness decision. Remaining supported-context/native-operation and actual merchant qualification must be met before accepting/shipping the dependent checkout/purchase path in M7/M8 and release qualification. |
| G4 Markets, taxes, discounts and accelerated entry | Representative context behavior and explicit supported-path contract before M4 normalization is frozen; contradictory platform evidence remains a blocker | Complete the supported matrix with the storefront in M7. Release-environment checks remain due before rollout; no currency or purchase-path promise is silently removed. |
| G6 Option A publication, fencing and recovery | An implementable, reviewed activation/consistency contract before publication depends on it | M3 implements durable journal/installation fencing; M4/M5 implement and test readiness/activation. Required-product publication is not enabled or accepted with a fake activation port. Scope remains supported Online Store paths, not a new all-channel product. |
| G7 embedded administration | Existing accepted real authentication/navigation/save feasibility can support a foundation decision; no public merchant data may bypass authentication | Resolve cache/revocation, bounded save recovery and browser/staff/session tests before the dependent M5 admin functionality is accepted. Final supported browser coverage remains a release requirement. |
| G8 merchant billing | Accepted real provider access, current effective-zero contract and metering/replay observation establish only that tested route | Provider trial/allowance/plan/cancellation contracts must be established before M4 entitlement rules are accepted. M3 supplies durable records; M8 supplies paid facts; M9 completes integrated qualification/delivery/reconciliation and full billing acceptance. Release-specific real commercial terms are verified before paid rollout. |

M9 entry should depend on accepted provider feasibility/contracts and M4/M8 inputs, not on already having passed the full integrated lifecycle that M9 builds. M9 exit requires the relevant integrated G8 criteria; release-specific checks are due in M10/M11 before merchant rollout. Apply the same entry-versus-exit distinction wherever the original criterion actually requires the feature under construction.

The imminent path is **M0-013 local protocol/capacity outcome → principal review → separately authorized bounded Public-app checkout proof → explicit M1 readiness decision**. This is a dependency path, not a promise that two PRs will make every gate pass. A material failure still reopens its specific boundary. G7/G8 work may be separately authorized in parallel, but is not included in M0-013.

## Capacity direction

Do not restart the original per-line signature experiment. The policy-aware M0-007 source already records ten customized plus 190 ordinary lines at 7,985,066 Transform / 8,265,472 Validation instructions, with input sizes 87,686 / 99,132 bytes and output 3,246 / 17 bytes. Those are recorded local measurements, not new principal measurements. Numeric query costs 20/30 and 23/30 are documented-rule calculations, not provider-returned numbers. Stack peak and wider accepted capacity remain unestablished.

Use the latest policy-aware, live-normalized whole-quote candidate as the baseline. Ten customized buckets remains an engineering evaluation case, not an adopted merchant maximum. The historical 64-bucket output failure must stay visible; a safe measured smaller envelope is not proof that 64 buckets work, and 64 was not a locked minimum product requirement.

M0-013 should determine an honest candidate envelope and executable admission/rejection behavior, not turn the inherited ten-bucket guard into a product decision. Whole-quote v2 remains provisional until separately adopted; the sequencing amendment does not adopt it.

## Unchanged conditions

Option A, exact pre-discount pricing, real-variant materialization, cart-wide acceptance, commercial trial/usage semantics, retention and the greenfield/no-import scope are unchanged. Full production protocol/capacity adoption, ordinary merchant rollout and host implementation remain unapproved. Preserve the private draft plan, subscription `gid://shopify/AppSubscription/38085427483`, meter, M0-012 run register, stopped previews, legacy resources and orders #1001–#1006. No more billing requests are needed for the accepted basic metering result.

## Source anchors

- Current plan sections 14–16 and ledger at `662a78cd27507d8a2f1eaa976f1c644c93edd1be`: `docs/architecture/implementation-plan.md`, `docs/architecture/decision-ledger.md`.
- Current capacity evidence: `spikes/m0-007/resource-analysis.md` at that ref.
- GitHub merge: https://github.com/Optidigi/insignia/pull/17
- Current Function reference: https://shopify.dev/docs/api/functions/2026-07#limitations (retrieval redirected to latest, displayed 2026-07).
- Availability/operation qualifications: https://shopify.dev/docs/api/functions/2026-07/cart-transform
