# PR #44 — external principal rereview

**Verdict: APPROVED for normal merge at the corrected final head.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #44
- Base / effective merge base: `55060c5a48617a27858d10fb0db639c7e9efe148`
- Approved head: `02e45926529fed9659e1c3dca81dec5f5ebe3174`
- Approved tree: `8c906e854b9cadcb8e9eda2740a0098067a71ad0`
- State at rereview: open, non-draft, unmerged, mergeable
- Current main at rereview: exact base above
- Native GitHub reviews: none
- Final-head workflows: 10/10 SUCCESS, all attempt 1

This approval supersedes the prior CHANGES_REQUESTED verdict only for the exact corrected head/tree above.

## Correction accepted

The previous blocker is closed.

`supportsFuturePublishing` remains:
- validated;
- retained in `configuredIntent.publicationSettings`;
- part of `intentDigest`;
- therefore drift-sensitive.

It no longer makes an unscheduled product ineligible merely because its Publication supports scheduling.

Actual product scheduling remains fail-closed:
- `configuredIntent.scheduled.length > 0` is unqualified;
- schedules appearing while held conflict;
- schedule pagination drift conflicts.

The corrected production predicate is now:
valid v2 snapshot + no actual observed scheduled product record.

## Regression evidence

The correction is one commit on top of the rejected head.

The focused public-port regression proves:
- included Online-Store-shaped Publication;
- `autoPublish=true`;
- `supportsFuturePublishing=true`;
- no actual schedule;
- ACTIVE before;
- DRAFT acknowledgement at T;
- DRAFT readback at T+1 second;
- configured intent unchanged;
- effective publication/online-store visibility removed;
- result HELD.

Additional regressions prove:
- capability changes still conflict through `intentDigest`;
- scheduled records block whether capability is true or false;
- schedules appearing while held conflict;
- unscheduled future-capable restoration succeeds when semantic status/intent/effective membership returns despite changed diagnostic timestamps;
- missing/extra effective membership still conflicts.

Historical v1 files and all closed canonical records are preserved. M5-011's v1 conflict is not waived.

## Final qualification

- focused Shopify availability: 170 passing;
- application recovery: 20 passing;
- full root regression: application 180, Shopify 267, web 40 with 8 local PG-dependent skips, storefront 1;
- publication stress: 100/100, no retries;
- renderer negative control: expected rejection;
- PostgreSQL 18.6 CI: 161 database tests plus runtime, 100k-plan and disposable migration rehearsal;
- two fresh GPT-6.1-sol/high full-source reviews: zero material findings;
- natural exact-head workflows: 10/10 success, all attempt 1.

No live Shopify/provider/browser/credential operation occurred.

## Disposition

PR #44 is eligible for owner-authorized normal merge at the exact approved refs.

Approval does not itself claim live v2 adapter qualification, production activation, RELEASE_BOUND, G7 or M5 completion. Those remain separate evidence steps.
