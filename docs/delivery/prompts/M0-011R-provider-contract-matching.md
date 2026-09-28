# M0-011R — correct provider contract matching on PR #14

## Outcome and authority

Close PR-014 R1/R2 with one small local correction on the EXISTING PR #14. No new live experiment, architecture decision or successor PR.

Read the attached PR-014 principal review, repository AGENTS/operating model, the original M0-011 prompt, M0-010R parser contract and M0-011 source/tests. Use the pinned diagnosing-bugs/TDD/code-review skills; writing-for-agents governs the handoff. Preserve settled business semantics.

Review binding: base/effective merge base `88dca8ebb4aad6baa24922508335e14038abbc98`; reviewed head `15c4281a5d08fa509a03ac9bba47d9b5dd59889c`. Verify current refs and preserve legitimate newer work. Update the existing branch normally; do not merge or force-push.

## 1. Reproduce through the actual public client path

Use the pinned Node 24 runtime and injected synthetic fetch/credentials. Run `PartnerClient.readLiveEnvelope → AppEventsClient.send`, not just a helper. The supplied reproduction can run against a checkout; its no-argument mode is explicitly an excerpt test, not the full client. All responses, keys and observations must remain synthetic.

Add failing regression cases for:
- Same authorized cycle returned as `.000Z`, seconds-only `Z`, and equivalent RFC3339 offsets.
- The exact permitted flat and meter items in either order.
- Equivalent representation on the second/final Partner read as well as the first.

Completion: the current code's false rejections are recorded, alongside the working canonical control. Test mode never uses a real credential or network route.

## 2. Correct semantic matching without broadening the tariff

R1: compare validated canonical cycle instants. Reuse existing normalization where appropriate; retain raw response data as evidence. A one-millisecond different start/end, invalid date, missing cycle, stale observation, active trial or scheduled transition still rejects. Do not modify the manifest to fit an unexpected cycle or add time tolerance.

R2: match exactly one expected flat-plan handle/type and exactly one meter handle/type. Preserve two-item cardinality, unique matching, active flags, currency agreement, all-zero recurring and tier charges, and zero observed usage cost. Wrong handles, duplicate/missing/extra items and nonzero or malformed prices still reject. Do not sort or ignore tariff-tier ordering.

A narrow internal change is preferred over a parallel provider model. M0-010's production hybrid parser and historical fixtures remain intact unless a direct integration correction is necessary and justified in the diff. These findings do not authorize relaxing the guard to support a differently shaped private plan without actual evidence.

Completion: equivalent representations follow the same safe decision; economically or temporally different contracts do not. Synthetic successful cases reach exactly the expected captured POST and keep body/key/time unchanged.

## 3. Integrate, review and return

Retain both fresh no-charge reads, token checks, fixed destinations, manual-redirect refusal, body/time limits, dry-run default, exact event replay and current journal safeguards. Include negative cases for changed price/cycle at the FINAL read, wrong app/shop, invalid/missing dates, duplicate identities, extra items and preserved attempt accounting.

Run frozen installs, strict TypeScript, both complete local suites, history check and applicable CI. Fresh Spec and Standards/security reviews inspect the integrated correction and resolve ordinary findings locally. Use actual gpt-6-sol/high, one writer by default (at most two non-overlapping restricted workers only if useful), one integration owner. No new orchestration/preflight project.

Preserve the original failed evidence; append the correction and its actual commands/results. Update the existing PR packet/state with the new head and applicable final-head CI. State the principal reproduction's limits accurately rather than treating it as a live test.

## Permission boundary

This correction is LOCAL-ONLY. No Shopify Admin/Partner/App Events calls, token acquisition, Dashboard mutations, plan/meter/subscription setup, event POSTs, preview commands, grants changes, credentials, production deployment or host escalation. Public docs/schema research and ordinary scoped dependencies/CI are permitted.

Keep v1.2 plan/ledger, earlier source/evidence, stopped preview/grants and orders #1001–#1006 unchanged. App eligibility, credentials, isolated no-charge contract and package-wide accounting remain live-use prerequisites, not excuses to invent results. Do not build a global billing-accounting system in this correction.

Return updated PR #14 and stop for principal review. No merge, G8 pass, M1, v2 adoption or next package starts automatically.
