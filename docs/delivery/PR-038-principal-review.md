# PR #38 — external principal review

**Verdict: CHANGES_REQUESTED at the exact current head.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #38
- Base / effective merge base: `d3adffdd7ea6c538016ac3569d1f17e81259aa89`
- Reviewed head: `a1f0472116616bd583265f550b894df581630b32`
- Reviewed tree: `6fab7c8e2db71d99b5e65e96a944ec37f9ac9398`
- Head parent: `d3adffdd7ea6c538016ac3569d1f17e81259aa89`
- GitHub state: open, non-draft, unmerged, mergeable
- Native GitHub reviews: none
- Final-head workflows: 9 success / 1 failure, all attempt 1

## M5-008S evidence disposition

The development-access outcome is accepted.

Observed and retained:
- active `insignia-2`, version `1152880803841`;
- required scopes empty;
- optional scopes exactly `write_products`;
- one designated `insignia-rewrite-dev` optional-scope approval;
- one protected client-credentials exchange, HTTP 200;
- one fixed Admin 2026-07 identity/scopes read, HTTP 200;
- exact app/shop/installation/development identity;
- granted scopes include `read_products` and `write_products`;
- no product mutation or M5-004 replay.

There is no principal basis to roll back the structurally correct version or revoke the authorized dev-store grant merely because CI is red.

## CI blocker

Foundation run `37048061147` failed at the exact head. The workspace build/check step passed. The following workflow step executes `test:m5-operator && test:m5-stress && test:m5-renderer-control`; `test:m5-operator` failed in unchanged `scripts/m5-005/diagnostic.test.mjs` test `ignored abort and late HTTP completion remain UNKNOWN with no later request or evidence rewrite` because `x.sent.length` was 0 instead of 1.

The production diagnostic and this test are byte-identical between PR #38 base and head:
- diagnostic test blob: `b0148d263257ce9e5d49adb87eb151cb46831ebb`
- diagnostic implementation blob: `98903ae9226fe3ace6c77141b4936401178cc068`

The test uses real-clock `deadlineMs: 15`. The implementation starts that deadline before persisted reservation and preparation, and explicitly refuses dispatch when preparation consumes the deadline. Zero mocked sends is therefore valid under scheduler/filesystem latency.

The preceding test already covers the intended pre-dispatch expiry case. The failing test intends the opposite branch: dispatch occurs, response ignores abort, deadline expires after dispatch, event remains UNKNOWN, and late completion cannot rewrite evidence.

The 15 ms preparation budget races those two scenarios. This is a test-contract defect, not evidence of a production diagnostic regression.

## Required correction

Do not rerun the old failed workflow hoping for attempt-2 green.

Make one narrow test-only correction on the existing PR branch. Do not change production `diagnostic.mjs`, provider code, application code, architecture, Shopify state, or M5-008S evidence.

No merge approval is issued until the corrected head is rereviewed with fresh exact-head green CI.
