# PR #38 — external principal rereview

**Verdict: APPROVED for normal merge at the corrected final head.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #38
- Branch: `feat/m5-008s-optional-product-grant`
- Base / effective merge base: `d3adffdd7ea6c538016ac3569d1f17e81259aa89`
- Approved head: `8dbe18ccc7f5c465384d7f34df92822b85c743a7`
- Approved tree: `a88f092e62f9fabceb0c35e8a468383897ad9b9c`
- GitHub state at rereview: open, non-draft, unmerged, mergeable
- Native GitHub reviews: none
- Current `main` at rereview: exact base above

This external approval supersedes the prior CHANGES_REQUESTED verdict only for the corrected head/tree above.

## Accepted M5-008S outcome

The previously accepted Shopify evidence remains unchanged:
- active app version `insignia-2`, version `1152880803841`;
- required scopes empty;
- optional scopes exactly `write_products`;
- exact designated development store approved the product optional scope once;
- one protected client-credentials exchange succeeded;
- one fixed Admin API 2026-07 identity/scopes read succeeded;
- exact app, client, shop, installation and partner-development identity matched;
- current granted scopes include `read_products` and `write_products`;
- no product mutation or M5-004 replay occurred.

There is no requirement to roll back this structurally correct version/grant.

## CI correction disposition

The prior exact head failed Foundation because one unchanged synthetic post-dispatch timeout test used a 15 ms wall-clock deadline that raced preparation-time expiry.

The corrected final head changes exactly one executable source line:
`scripts/m5-005/diagnostic.test.mjs`
- post-dispatch test `deadlineMs: 15` -> `1000`.

The preceding preparation-expiry test remains 15 ms. The delayed fetch, UNKNOWN assertions, lock assertion and late-response no-rewrite assertion remain unchanged.

Production `scripts/m5-005/diagnostic.mjs` remains blob:
`98903ae9226fe3ace6c77141b4936401178cc068`

Corrected test blob:
`5aacc470f96a37da129faf53bf93f261c31658f6`

Local evidence records:
- named corrected test: 20/20 consecutive pass, no retry wrapper;
- full requested operator/stress/renderer chain: exit 0;
- publication geometry stress: 100/100, no retries;
- root/style check: pass after using the retained process-local linker;
- all 18 previously accepted M5-008S records unchanged.

Natural exact-head CI returned **10/10 SUCCESS, all attempt 1**. Foundation's build/check, M5 publication stress, source binding and artifact steps all succeeded.

Fresh final-head GPT-6.1-sol/high Spec/correctness and Standards/security reviews report no actionable findings.

## Disposition

PR #38 is eligible for owner-authorized normal merge at the exact approved refs.

Approval does not itself authorize product mutations. Those belong to the separately owner-forwarded M5-009 brief.
