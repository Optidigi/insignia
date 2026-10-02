# M5-008S — optional-scope declaration and exact dev-store grant

## Outcome

Establish `write_products` only on the exact designated development store without changing grants or prompting unknown other installations.

The app-version change in this slice is:

- required scopes: remain empty
- optional scopes: empty -> `write_products`

This is a temporary development qualification configuration, not the final production scope catalog.

No product mutation occurs in this slice.

## Baseline

Owner-forwarded authority requires the verified normal merge of PR #37 exactly at:

- base `adecff04a3ff5b5d72665cbb404265477d6eb748`
- head `77d01a5cfe828c723f37d7ab45e245d01e44d5bd`
- tree `f11ba18504ccf44c29c0319aa3f1afc8ed91103e`

Verify the actual normal merge's ordered parents/tree and start from that remote `main`.

Use actual GPT-6.1-sol/high. Read AGENTS, ledger, operating model, M5-004 through M5-008R reports, the PR #37 principal verdict, and pinned writing-for-agents, diagnosing-bugs, code-review and handoff skills.

No Shopify CLI deploy. The prior unintended global CLI installation remains untouched and unused.

## 1. Exact app-version prestate

Use the existing authenticated Dev Dashboard session for the exact Insignia app.

Verify:
- active version remains `insignia-1`, version ID `1146748534785`;
- create page is explicitly pre-populated from `insignia-1`;
- required scopes initially empty;
- optional scopes initially empty;
- `application_url = https://example.com`;
- embedded = true;
- legacy install flow = false;
- redirects empty;
- webhook API = `2026-07`;
- no unexpected changed public field.

Do not require or search for a current Installs card/list in this slice.

Shopify's documented Dev Dashboard version-create contract is the extension-preservation mechanism: the new version carries the configuration on that page plus the extensions in the current active version.

## 2. Release one optional-scope version

Change only:

- optional scopes: empty -> `write_products`

Keep required scopes empty.

Do not type `write_products` into the required-scopes field.

Change nothing else.

Open the native Release confirmation. Before final submit, verify the visible form still matches the exact intended configuration and source version.

One final native Release confirmation is authorized to create+release this version.

No retry or second new version is authorized.

After release, verify:
- exactly one new version attributable to this action;
- the new version is Active/Released;
- prior `insignia-1` remains listed as previous/rollback baseline;
- required scopes remain empty;
- optional scopes are exactly `write_products`;
- other visible configuration remains unchanged.

If an observed structural mismatch exists, the old `insignia-1` version may be released once as structural rollback, followed by one read-only version check and STOP.

Do not rollback merely because the later optional grant is unknown or fails.

## 3. Request optional scope only on designated development store

Only after the optional-scope version is structurally verified:

Use the existing authenticated Shopify Admin session for the exact designated store `insignia-rewrite-dev`.

Navigate once to Shopify's documented optional-scope request URL, populated with:
- store name: `insignia-rewrite-dev`
- exact app client ID already established in project evidence
- requested optional scope: `write_products`

URL shape:

`https://admin.shopify.com/store/insignia-rewrite-dev/oauth/install?client_id=<FIXED_CLIENT_ID>&optional_scopes=write_products`

This request is authorized only for that exact development store and scope.

If Shopify shows a permission grant screen:
- verify the store/app context is exact;
- verify the only newly requested scope is product write access / `write_products`;
- approve once.

No other store, scope, reinstall, app-selection, account switch, or consent path is authorized.

A redirect to the configured app URL after approval is incidental; do not treat that destination as evidence of app correctness.

If the UI asks for any additional permission, another store, another app, or a login/account switch, STOP without approval.

## 4. Verify the exact grant once

After a successful optional-scope approval, perform:

- exactly one existing-route client-credentials exchange for the designated development store;
- exactly one fixed GraphQL Admin read for exact app/shop/installation identity and current access scopes.

Use API `2026-07`.

The operator must:
- use the already documented protected credential route;
- reserve both operations before dispatch;
- persist no bearer/secret/raw auth body;
- use bounded body/deadline handling;
- contain no mutation document/path;
- stop on identity mismatch or ambiguity.

Success criterion:
- exact known app/shop/installation/development-store identity; and
- current granted scopes include `write_products`.

A separate `read_products` handle is not required because `write_products` includes product read access.

If `write_products` is absent, approval outcome is ambiguous, or identity differs: STOP. No retry, reauthorization, additional scope, required-scope conversion, or M5-004 operation is authorized.

## 5. Evidence and handback

Return one docs/evidence-only PR with:
- PR #37 merge receipt;
- exact version prestate;
- released optional-scope version receipt;
- structural before/after configuration evidence;
- exact dev-store optional grant observation;
- auth/read accounting and current grant result;
- rollback receipt if used;
- fresh scoped GPT-6.1-sol/high Spec and Standards/security reviews;
- all applicable exact-head automatic CI.

Do not retain merchant/person contact data, tokens, raw auth/session material, or browser storage.

No M5-004 product fixture or availability case runs in this slice.

Stop for principal review.

No M5 completion, G6/G7 pass, RELEASE_BOUND/trusted-recovery claim, M6/M7, production activation, or launch is authorized.
