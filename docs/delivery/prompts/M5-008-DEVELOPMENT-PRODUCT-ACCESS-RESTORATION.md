# M5-008 — development product-access restoration

## Outcome

Safely establish the minimum development access needed to resume the previously blocked M5-004 availability qualification, while preserving the current active extension set.

The only new required access scope in this slice is:

`write_products`

Do not restore the historical nine-handle set in this slice. Shopify documents that a write scope includes its corresponding read capability, and the M5-004 product create/status operations require `write_products`.

This is a development qualification change, not the final production scope catalog.

## Baseline and prerequisites

Owner-forwarded authority requires the verified normal merge of PR #35 exactly at:

- base `9dc728b21d58a1687fae7221e64225373bbbbecb`
- head `39fce0b00b625fe0f5869058ec44093213a4ffc5`
- tree `f4fd4ed878547bb17d96d3b3187c7d125dd4abd1`

Reverify actual merge ordered parents/tree and start from that remote `main`.

Use actual GPT-6.1-sol/high. Read root AGENTS, ledger, operating model, M5-004 through M5-007R4 reports, this principal verdict, and repository-pinned writing-for-agents, diagnosing-bugs, code-review and handoff skills.

No Shopify CLI deploy is authorized. The prior unintended global CLI installation remains untouched and unused.

## 1. Establish exact prestate read-only

Use only the existing authenticated Dev Dashboard session for the exact Insignia app.

Verify:
- active/released version remains `insignia-1`, version ID `1146748534785`;
- current displayed configuration still matches the accepted R4/M5-006 baseline where visible;
- the version-create page is for this exact app and permits a required-scope edit;
- no app/extension deletion or replacement is selected.

Read-only impact check before any release:
- establish from the Dashboard whether the app currently has any installation outside the owner's organization/development environment;
- if any external merchant install is present, or installation impact cannot be bounded sufficiently to owner-controlled development stores, **do not release**. Creating an unreleased version may still proceed if all other preconditions pass.

Do not guess from the absence of rows or banners. Preserve NOT_OBSERVED where the UI does not expose a fact.

## 2. Create one unreleased extension-preserving version

Use the Dev Dashboard **version create page**, not CLI deploy.

Shopify's documented contract for this route is that a version created there contains:
- the configuration on the page; and
- extensions present on the current active app version.

Create exactly one new version from the current active version.

Change only:
- required access scopes: empty -> `write_products`

Keep:
- optional scopes empty;
- `application_url = https://example.com`;
- embedded = true;
- legacy install flow = false;
- redirect URLs empty;
- webhook API = 2026-07;
- all extension content inherited from the active version.

If the page exposes any other changed field, extension removal/addition, unknown required scope, or ambiguous source version, stop before creation.

Do not release yet.

After creation, inspect the new unreleased version and record:
- new version identifier/name;
- unreleased status;
- required scope exactly `write_products`;
- other captured configuration unchanged;
- extension summary/handles/count when visible;
- old active `insignia-1` still active and available as rollback baseline.

If the created version does not match the intended configuration, stop. Do not edit/recreate a second version.

## 3. Conditional release

Release the new version only if all are true:
1. the unreleased version matches the exact intended configuration;
2. the create route is confirmed to have inherited the current active extensions under the documented Dev Dashboard version semantics;
3. no external merchant installation is shown to be affected; installations are bounded to owner-controlled development context;
4. the active version immediately before release is still `insignia-1`;
5. no unexpected login, consent, scope, extension, preview, or app identity issue appears.

Owner forwarding of this brief authorizes the release confirmation only under those conditions and only for this exact development app/version.

If the UI presents merchant-facing consent for an external store or any scope other than `write_products`, stop.

Do not alter or clean any preview.

## 4. Post-release verification

After release, perform only bounded verification:

- verify the new version is active/released;
- verify prior `insignia-1` remains listed as the rollback baseline;
- use one existing-route client-credentials exchange and one fixed Admin GraphQL identity/scope read for the designated development store to verify the exact app/shop/installation and that `write_products` is granted.

The read operator must:
- use the already documented protected credential route;
- reserve one auth exchange and one Admin read before dispatch;
- use API `2026-07`;
- have no mutation document/path;
- persist no bearer/secret/raw auth body;
- use bounded body/deadline handling;
- stop on ambiguity or identity mismatch.

A scratch/local operator may reuse the already-reviewed M5-005 projection and credential-loading code; do not create a second production authentication system. Add no permanent harness unless a real reusable repository seam is needed.

Expected capability: `write_products` is present. Do not require a separate `read_products` handle; the write scope provides read capability.

If release succeeds but scope verification does not establish `write_products`, stop with the exact observation. Do not retry, reauthorize, add scopes or run M5-004.

## 5. Rollback boundary

The old active version `insignia-1` is the app-version rollback baseline.

A single release of that old version is authorized only if the newly released version is observed to contain an unexpected configuration/extension change or wrong app/version identity. Do not use rollback merely because grant verification is delayed/unknown: releasing an old version is not assumed to instantly restore grant state.

Any rollback must be followed by one read-only version check and then stop.

## 6. Evidence and handback

Return one docs/evidence-only PR with:
- actual PR #35 merge receipt;
- prestate and impact evidence;
- created-version and release receipts;
- exact configuration diff;
- extension-preservation evidence and its limits;
- auth/read accounting and post-release scope observation;
- any rollback receipt;
- no credentials/raw session material;
- fresh scoped GPT-6.1-sol/high Spec and Standards/security reviews;
- all applicable final-head CI.

No product fixture or M5-004 availability case is run in this slice.

Stop for principal review.

No M5 completion, G6/G7 pass, RELEASE_BOUND/trusted-recovery claim, M6/M7, production activation or launch is authorized.
