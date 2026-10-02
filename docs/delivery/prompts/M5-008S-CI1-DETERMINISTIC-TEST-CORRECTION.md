# M5-008S-CI1 — deterministic post-dispatch timeout test correction

## Goal

Remove the real-clock race from the one M5-005 synthetic test exposed by PR #38 CI, without changing production behavior or remote state.

Work on the existing PR #38 branch. Preserve all M5-008S evidence unchanged.

Use actual GPT-6.1-sol/high and read repository-pinned `diagnosing-bugs`, `tdd`, `code-review`, `writing-for-agents`, and `handoff`.

## 1. Pin current evidence

Before editing verify:
- PR #38 base remains `d3adffdd7ea6c538016ac3569d1f17e81259aa89`;
- current head remains `a1f0472116616bd583265f550b894df581630b32`;
- test blob remains `b0148d263257ce9e5d49adb87eb151cb46831ebb`;
- implementation blob remains `98903ae9226fe3ace6c77141b4936401178cc068`;
- failed Foundation run `37048061147` remains preserved as red evidence;
- worktree is clean.

Do not rerun Shopify, inspect credentials, alter `insignia-2`, revoke `write_products`, or reopen historical registers.

## 2. Correct only the intended test scenario

File: `scripts/m5-005/diagnostic.test.mjs`

Test: `ignored abort and late HTTP completion remain UNKNOWN with no later request or evidence rewrite`

Its purpose is post-dispatch timeout, not preparation-time expiry.

Make the smallest correction:
- change only this test's `deadlineMs` from `15` to `1000`;
- keep its delayed `fetchImpl`, assertions and late-response checks intact;
- add at most one short comment explaining that the wide preparation budget separates this post-dispatch scenario from the preceding pre-dispatch-expiry test.

Do not change the preceding `expired credential preparation...` test; its 15 ms deadline intentionally exercises NOT_SENT.

Do not change `scripts/m5-005/diagnostic.mjs`.

If inspection shows the one-line timing correction cannot preserve the intended scenario, stop instead of broadening the patch.

## 3. Prove the test is no longer timing-fragile

Run the corrected named test 20 consecutive times with no retry-on-failure wrapper. All 20 must pass.

Then run exactly:

`corepack pnpm test:m5-operator && corepack pnpm test:m5-stress && corepack pnpm test:m5-renderer-control`

All three commands must execute and pass. This closes coverage skipped by the original red workflow.

Run normal root/style checks applicable to the changed test file.

## 4. Final candidate

Commit only the narrow test correction plus minimal delivery evidence needed to explain it.

The final PR #38 diff may contain the existing M5-008S docs/evidence plus this one test-only correction. No production-source behavior changes are authorized.

Launch two fresh restricted actual GPT-6.1-sol/high reviewers at the final head:
- Spec/correctness: verify the test deterministically exercises the post-dispatch timeout branch and M5-008S documentary evidence remains unchanged.
- Standards/security: verify no production semantics, permission boundary, secret handling or remote evidence changed.

Require all applicable exact-head workflows to run naturally for the new commit.

Acceptance condition:
- 10/10 exact-head workflows SUCCESS;
- new-head runs attempt 1;
- no rerun of the old failing head is substitute evidence.

Return the same PR #38 for principal rereview and stop.

## Boundaries

No merge. No Shopify/provider/browser/credential operation. No M5-004 product mutation or availability qualification. No scope/grant change. No preview cleanup. No M6/M7, activation, RELEASE_BOUND, gate or launch claim.
