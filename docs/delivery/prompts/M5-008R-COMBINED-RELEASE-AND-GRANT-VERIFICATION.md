# M5-008R — combined release and product-grant verification

## Outcome

Restore the minimum development product capability by releasing one Dev Dashboard app version whose only configuration change is required scope:

`empty -> write_products`

Then verify the designated development installation actually has `write_products`.

No product mutation occurs in this slice.

## Baseline

Owner-forwarded authority requires the verified normal merge of PR #36 exactly at:

- base `34c78b56df98cc049adca842653ad6f9ae23b2a8`
- head `9e2d9ebe68d51c2ad346dafdfad78e2cca29dae3`
- tree `976c08996fe61d56cdce86f4f60427fabd66d799`

Reverify actual merge parents/tree and start from that remote `main`.

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, diagnosing-bugs, code-review and handoff skills.

No Shopify CLI deploy. Prior global CLI installation remains untouched and unused.

## 1. Current installation-impact gate

Use the existing authenticated Dev Dashboard session for the exact Insignia app.

Open the app Overview and inspect the **Installs** current-count metric, not the Growth install-event chart.

Select the Installs count to open **Current installs**.

Release is eligible only if all are true:
- Installs current count = exactly `1`;
- Current installs contains exactly one store;
- that sole store is `insignia-rewrite-dev` / the already-verified designated development store;
- no second current install, external merchant store, unknown row, pagination ambiguity or count/list mismatch exists.

If any condition fails, STOP before editing/releasing a version. Do not investigate merchant stores, request access, or infer ownership from event charts.

Record only sanitized public store identity/type facts needed for the decision. No merchant contact details belong in Git.

## 2. Re-establish exact release form prestate

Verify:
- active version remains `insignia-1`, ID `1146748534785`;
- create page explicitly says it is pre-populated from `insignia-1`;
- required scopes are initially empty;
- optional scopes empty;
- `application_url = https://example.com`;
- embedded = true;
- legacy install flow = false;
- redirects empty;
- webhook API = `2026-07`;
- no unexpected changed field is shown.

Shopify's documented Dev Dashboard version-create contract supplies the current active version's extensions to the new version. This is the accepted extension-preservation mechanism for this slice.

Do not use local extension files as the preservation source.

## 3. Combined create+release

Type exactly `write_products` into required scopes. Change nothing else.

Open the native Release confirmation.

Before final submit, re-check:
- scope exactly `write_products`;
- exact app/version-source context;
- no other changed configuration;
- current-install gate from section 1 passed;
- active version still `insignia-1`;
- no unexpected login/consent or extra-scope prompt.

Then click the final native **Release** confirmation exactly once.

This one action is authorized to create and release the new version under Shopify's documented native workflow.

No retry or second new version is authorized.

## 4. Immediate post-release structural verification

Wait for completion and inspect Versions.

Require:
- exactly one new version attributable to this release;
- the new version is Active/Released;
- previous `insignia-1` remains listed as prior/rollback version;
- new version required scope is `write_products`;
- captured public configuration remains otherwise unchanged where displayed.

Where extension details are visible, record them. Where not visible, rely only on the documented create-page inheritance contract; do not invent a manifest.

If wrong scope, wrong app/version, unexpected configuration, or visible extension loss is observed, the old `insignia-1` version may be released once as structural rollback. After rollback, perform one read-only version check and stop.

Do not rollback merely because grant propagation is unknown or delayed.

## 5. One bounded grant verification

Only after the new version passes structural verification:

- use the already-documented protected existing credential route;
- reserve exactly one client-credentials exchange;
- reserve exactly one Admin GraphQL read;
- use API `2026-07`;
- query only exact identity plus currently granted access scopes;
- no mutation document/path;
- bounded deadline/body handling;
- persist no bearer, secret, headers or raw auth body.

The read must verify the same exact app/shop/installation/development-store identity and report the scope handles.

Success criterion: `write_products` is currently granted.

A separate `read_products` handle is not required because Shopify documents that the write scope includes read access.

If `write_products` is absent, response is ambiguous, or identity differs: STOP. No retry, reauthorization, extra scope, app-open consent flow or M5-004 operation is authorized.

## 6. Evidence and return

Return one docs/evidence-only PR with:
- PR #36 merge receipt;
- current Installs count/list evidence;
- version form prestate;
- release confirmation/result;
- post-release version/config evidence;
- bounded auth/read accounting and grant result;
- rollback receipt if used;
- fresh scoped GPT-6.1-sol/high Spec and Standards/security reviews;
- all applicable exact-head automatic CI.

Keep merchant contact data, tokens, raw browser/session data and credential material out of Git.

No M5-004 product fixture or availability case is run yet.

Stop for principal review.

No M5 completion, G6/G7 pass, RELEASE_BOUND/trusted-recovery claim, M6/M7, production activation or launch is authorized.
