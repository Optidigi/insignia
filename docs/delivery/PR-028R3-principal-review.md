# PR #28 principal rereview — APPROVED FOR MERGE AT IMPLEMENTED/PARTIAL-LIVE SCOPE

## Binding

- Repository: `Optidigi/insignia`
- PR: `#28`
- Base/effective merge base: `28e69864ebb9796504861a541363880cc86a82f8`
- Approved head: `b2963fd68296935999ad548921e3117443eb9cc3`
- Approved tree: `3b97621164f0b58609154bbd7a12aaa7d1ca5a85`
- Synthetic merge: `3c55ea168c27da586ce15f52ab1c7c41820b3686`
- Synthetic merge parents: exact base + approved head
- Synthetic merge tree: exact approved tree

The native GitHub APPROVE attempt returned HTTP 403 and was not posted.
This file is the external principal verdict.

## R2 blockers closed

### Deterministic entitlement time

Production composition now accepts a narrow entitlement/provider clock.

The default remains real current time.

Identity token and online grant expiry continue to use real time.

The fixed test fixture is now evaluated deterministically at:
- immediately before cycle end: allowed;
- exactly at cycle end: denied;
- after cycle end: denied.

No production expiry rule was weakened.

### Numeric geometry input race

The reproduced `centerX` rollback/corruption path is closed.

The editor now separates:
- raw in-progress numeric spelling;
- validated authoritative geometry.

Valid numeric values commit immediately to typed owner state.
Incomplete/invalid text remains presentation-only until it becomes valid or
blurs.

External owner changes clear stale raw input.

The final regression covers:
- `0.5 -> 0.6`;
- owner rerender while the number input remains focused;
- direct Konva projection;
- save/reload;
- sequential keyboard typing;
- exact `0.605`;
- rejection/restoration of invalid `1.2`.

The final publication-preservation stress is 100/100 with zero retries,
25 iterations for each dirty/ambiguous × success/failure combination.

## Verification

All ten exact-final-head workflows succeeded on attempt 1:

- `36848305379`
- `36848305547`
- `36848305387`
- `36848305278`
- `36848305356`
- `36848305472`
- `36848305453`
- `36848305227`
- `36848305503`
- `36848305395`

Foundation now runs the 100-case no-retry M5 stress as an explicit CI step.

Local evidence:
- full root gate: PASS;
- PostgreSQL 18.6 core: 52/52;
- HTTP/composition suite: 11/11;
- M5 publication stress: 100/100;
- actual-renderer missing-module negative control: PASS as expected.

Fresh full-source GPT-6.1-sol/high Spec/correctness and Standards/security
reviews found no unresolved material source issue.

## Grant-state disposition retained

The designated dev store currently has nine grants matching the M5-002 dev
configuration.

No repair is required or authorized.

`app dev clean` restores the active app version; exact access-grant rollback is
not treated as part of its contract.

This is a dev-store state observation, not a production scope decision.

## Function-attestation disposition retained

The source-side artifact-attestation design is accepted:
- SOURCE_ONLY
- DEV_PREVIEW_OBSERVED
- RELEASE_BOUND

Production readiness requires RELEASE_BOUND.

The development preview did not expose usable provider Function IDs/query
identity through the typed diagnostic read. Do not chase those IDs through
extra preview/resource mutations.

DEV_PREVIEW_OBSERVED therefore remains live-unqualified.

## Milestone disposition

PR #28 is approved for merge.

M5 is **not complete**.

M5-002 is accepted as:
- artifact-attestation implementation;
- corrected embedded hydration/product-read proof;
- partial live G7 evidence;
- stabilized local Admin/visualizer/runtime evidence.

Still open for M5:
- full live save/reload/CAS/exact-replay qualification;
- cold direct deep-link/full reload;
- actual iframe Polaris/Konva introspection;
- mobile and third-party-cookie-blocked browser evidence;
- RELEASE_BOUND deployed Function evidence;
- Option A availability/admission/activation boundary;
- large-history query-plan benchmark.

No complete G7 or G6 gate is accepted.

M5-003 is separately authorized by the accompanying local/off-store brief.
