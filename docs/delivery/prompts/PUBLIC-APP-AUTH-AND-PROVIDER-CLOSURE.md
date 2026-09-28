# Insignia — new public-app authentication and provider-contract continuation

Issued: 28 September 2026. One integrated outcome; no new architecture, general preflight or recreation of resources.

## Authority and context

Start only after the owner sends the accompanying launch message. PR #15 has external principal approval at base `8294705b5caad98ae2537ba3cbba7a458ecb3e62`, head `f134a0dfc34460b78c48f1c88fd65e74c3b7fde4`. Verify and perform only its specifically authorized normal merge, then branch from the actual remote main. Preserve legitimate newer work. No next-PR merge is delegated.

Read AGENTS, current delivery state and operating model, PR-015 review, the original setup prompt, and relevant M0-009 auth/M0-010–011 provider contracts. Use installed writing-for-agents, research, implement and code-review skills as relevant. The principal retains architectural direction, acceptance changes and final review. Option A/v1.2 and the provisional whole-quote v2 position stay unchanged.

Operate on these already-created resources only:
- App `429028933633`, client `1443cf6d03d39edae7c101a943c5c684`.
- Optidigi Partner `4697030`, Dev organization `200969036`.
- `insignia-rewrite-dev.myshopify.com`, shop `gid://shopify/Shop/105501393179`.
- Last observed installation `gid://shopify/AppInstallation/1054356963611`; verify current identity rather than silently rebinding a replacement.
- New named config `spikes/m0-009/shopify.app.insignia-public.toml`.

The existing stopped preview is a known starting condition. Earlier apps/stores, legacy installations and orders #1001–#1006 are read-only/outside mutation scope. Credentials exist in an untracked user-only new-app server file. Reuse only that approved source; never print, copy into artifacts, or export a session.

## 1. Finish actual embedded authentication

Reuse the standalone Astro/Preact/Polaris harness and the current new client build. After applicable local checks/review, establish one temporary controlled HTTPS preview for this exact app/store, with existing product read/write grants only. Preserve installed resources; inspect any unexpected scope or installation change before proceeding. Do not release the `example.com` placeholder or introduce a permanent host.

Capture a real App Bridge staff ID token exchange, verified current installation/tenant, protected page navigation and one server-validated local-only synthetic save. Record sanitized timestamps/statuses and a correlation identifier; correlate the browser action with the authenticated server outcome. Raw bearer tokens, client secrets, cookies and personal staff data do not belong in receipts. No private request-body interception is mandatory.

If the existing automated browser is unavailable, a supported human-assisted session is an acceptable route for this narrow live observation: request the exact open/click action, correlate the server-authenticated outcome and label it human-assisted. Never claim that as automated end-to-end coverage. No cookie export, alternative hidden session extraction, security-policy weakening or host rebuild. If neither route works, retain the specific access limitation and finish independent authorized work.

Add useful executable local coverage for the changed launcher/bootstrap and new-app mode. Preserve no-token/wrong-tenant/wrong-audience/expired-token rejection. Distinguish synthetic served-output tests from a real public-bootstrap integration and browser execution. Fix ordinary in-scope launch/auth/evidence defects locally; no full configuration editor or full G7 implementation is required here. Carry earlier save-timeout, cache-revocation and broader browser obligations accurately rather than declaring them fixed.

Done: actual new-app staff-authentication/local-save evidence, or a precise access/failure report backed by completed local checks. Installation alone is insufficient.

## 2. Resolve the App Events token-response discrepancy without sending events

First use the already retained observation, exact endpoint/request construction, guarded parser and current official contract. Token acquisition returned HTTP 200 with only access_token/token_type, while the existing adapter expects scope/expires_in. Do not turn a provider response-shape difference into a new credential requirement by assumption.

At most TWO additional token-acquisition HTTP requests are allowed for this new app if needed to distinguish request/wrapper issues from the raw provider response. Use existing secret, exact official HTTPS origin, bounded response/timeout, no redirects and no raw token in outputs. Retain only method/origin/path, sanitized JSON key names/types, status, safe correlation metadata and explicit provenance. Token strings must not be sent to external decoder services. Do not create new keys or change scopes.

Separate: (a) token returned by the trusted first-party TLS exchange, (b) lifetime/permissions explicitly observed or documented, (c) the adapter's policy, and (d) actual resource-server acceptance. Generic OAuth makes expiry metadata recommended and scope conditional; this is a reason to examine the provider-specific contract, not permission to invent absent values. Decoded JWT claims are not an independent signature verification or authorization of arbitrary incoming tokens. Conversely, verification of an incoming hostile token is not the same problem as receipt from a trusted issuance endpoint.

Produce a narrowly scoped candidate parser/result model and synthetic regressions if needed. Preserve incomplete metadata explicitly and propose a justified lease/caching/refresh policy for review. Keep the existing live-send rejection for insufficient evidence until principal adjudication; no event POST is permitted by this package. No guessed JWKS/introspection endpoint or cryptographic implementation. If evidence cannot settle the provider discrepancy, return a sanitized minimal reproduction/support question with the independently completed auth work, not an endless series of token requests.

Done: request/response provenance and a tested, explicit disposition or a precise remaining provider question. HTTP 200 alone is not a billing result.

## 3. Use owner-prepared access when available

Owner handles Optidigi App Store registration/payment and creation of a dedicated Partner client. Do not perform either paid/legal action or organization permission grant. Neither prerequisite blocks sections 1–2 or local tests. Do not ask the owner to repeat known app/store IDs or place the already-present new-app secret again.

When the owner supplies a dedicated Partner client through a protected local mechanism, read only this app/shop's current subscription and relevant history through the pinned API. Manage apps is organization-wide despite a read-only execution brief. Verify app/shop binding in responses. A legitimate null subscription is not an error and is not historical proof of inactivity. Reuse pure existing parsers/queries, with a separate exact-new-target adapter/configuration; do not simply remove the old spike's target guard or rewrite frozen historical fixtures.

After the owner independently completes App Store registration, verify the actual new-app Partner page and inspect App Pricing. The owner launch permits selecting the already-planned Shopify App Pricing method for this genuinely new unconfigured app only, provided it entails no further charge, contract migration or public submission. Inspect built-in private test-plan/meter availability; create or edit no plans/meters and select no subscription. Record remaining availability honestly.

Done: actual scoped read/configuration evidence where prepared, otherwise one consolidated remaining owner-action list. Event counts stay 0 unique/0 POST.

## 4. Integrate and hand back

Use the established actual gpt-6-sol/high route, at most two non-overlapping writers, one integrator, fresh Spec/security reviews and one remote operator. Delegate auth/local coverage and provider-contract work independently; serialize all shared browser/API actions. No general tooling project.

Run pinned local tests, old/new client builds, appropriate synthetic smokes and historical integrity checks. Keep raw historical observations unchanged and add an attributed principal review pointer. Continue operational designation using the new app/store; make historical target rows clearly historical. Do not amend v1.2 product/architecture decisions.

Return one coherent implementation/evidence PR, actual base/head/merge-base and final-head CI, local-review dispositions, source/build binding and exact remaining assumptions. Stop temporary processes and record stopped-preview/initial-version state; do not clean/reinstall in a loop. No release, listing submission, merchant product/Function/theme/order/payment/inventory action, billing event, test order, v2 adoption, full gate pass, M1 or subsequent package is authorized. Return to principal review; local reviewers do not replace it.
