# M0-009 — embedded Astro authentication and admin vertical slice

**One integrated G7 work package.** Execute only after the owner forwards the launch instruction and PR #11's approved normal merge is verified. Return an executable embedded-app proof, its tests and live evidence in one PR. Do not start M1 or production configuration publishing.

## Outcome and context

Prove that the selected Astro Node SSR + Preact islands + Polaris Web Components architecture can authenticate a merchant in Shopify Admin, navigate and reload safely, render protected content, and perform an authorized **local synthetic mutation**. This is the first G7 implementation, not another policy-proof package.

Read root AGENTS, current delivery state, operating model, the accepted v1.2 decision ledger, PR-011 review, and plan §§6.1, 7, 14.2/G7 and the relevant milestone boundaries. The current Option A decision is closed. Publication activation, durable fencing, Markets and v2 production adoption remain separate unresolved work; do not implement or re-decide them here.

Use actual `gpt-6-sol` / high. Up to two restricted writers with disjoint worktrees/path ownership, one integrator, fresh Spec and Standards/security reviews. One operator owns the existing authenticated browser, CLI development session and staging access. Existing restricted sequential sessions are an acceptable fallback. Use the pinned writing-for-agents, research, tdd, diagnosing-bugs and code-review skills on the relevant tasks; reuse existing GitHub, Shopify developer/schema MCP and browser capabilities. No new general tooling setup or orchestrator framework.

## 1. Establish the secure contract, then build it

Under `spikes/m0-009/`, create the smallest runnable Astro 7 standalone Node SSR app. Pin compatible released dependencies using current primary documentation and existing Node/pnpm conventions. Use `@astrojs/node`, `@astrojs/preact`, direct Polaris Web Components and Shopify App Bridge. Keep `@shopify/shopify-api` and the Node adapter server-only in a local Shopify adapter module; do not import the React Router application package or introduce React/Polaris React. Reuse established scripts and CI conventions; a small isolated spike is sufficient, not the production workspace/package scaffold.

Implement two routable admin pages and one Preact editor island. A synthetic draft label or similarly narrow local state is enough. It must have meaningful server validation and an authorized POST, not just a client counter. In-memory/local scratch storage is permitted and its lack of production durability is explicit. Do not wire the M0-008 publisher to live Shopify writes.

Before implementing navigation, describe the selected document-authentication path in a short contract:
- Initial GET without verified identity returns only an unprivileged bootstrap, safe redirect or unauthorized response. No private fixture/merchant data is rendered from `shop`, `host`, URL IDs or cookies alone.
- Prefer the current supported custom-framework App Bridge/token-exchange flow. A public shell followed by authenticated server-rendered content is a permitted baseline; secure documented ID-token document bootstrap is also permissible. Do not assert ordinary anchor/form requests automatically carry an App Bridge bearer token.
- Once identity is verified, Astro renders protected data on the server. Preserve file-based routes and explicit endpoints; a minimal authenticated navigation helper is permitted, a general SPA router is not the default.
- Reload, deep link and browser back/forward must re-establish identity safely without exposing stale cross-user data. If a full-page SSR approach fails, report the precise boundary and test a narrow authenticated-shell/fragment alternative within the same package. A framework replacement requires principal review.

Completion: cold launch, navigation, reload and synthetic save have an end-to-end implementation, with trust boundaries documented rather than assumed.

## 2. Identity, tenant and permission enforcement

Use current Shopify ID/session-token verification and token exchange with the existing app. Shopify ID tokens are not Insignia cart tokens; their JWT format does not violate the cart no-JWT decision.

Validate the expected algorithm/signature, audience, issuer/destination/shop consistency, expiration and not-before through maintained SDK primitives and explicit claim/tenant checks. Resolve the shop from verified claims and bind it to the existing installation. Reject mismatch between verified shop and route/body selection. Malformed or wrong-shop tokens must not trigger token exchange to an attacker-supplied URL. Honor actual token lifetime; do not cache ID tokens as long-lived identity.

Distinguish identity from permission. A valid ID token authenticates the staff user; it does not grant every app action. Use online/user-associated authorization where Shopify staff permissions matter, plus an explicit use-case permission check for the local synthetic edit. An offline merchant access token must not become a staff-permission bypass. Test owner/allowed/denied users and two distinct tenants with synthetic identities; do not claim live multi-user verification from synthetic tests.

Keep API tokens and client secrets server-side. Use existing locally authorized credential access or a secure owner-local environment variable; never ask for a secret in chat, export a browser session or commit credentials. If required secret access is unavailable, finish the local implementation/tests and report that one missing input. Do not substitute a CLI token or client-credentials grant for proof of embedded staff authentication.

Use separate synthetic/offline and live modes. Synthetic mode uses test keys and fake exchanges only, binds to loopback, and must not be enabled by an HTTP parameter or header. Live mode uses actual token verification; there is no test-auth bypass in the tunneled app.

Token handling must include bounded reauthentication, one retry for an expired ID token where appropriate, and prevention of concurrent exchange/refresh storms. Unit-test the relevant concurrency and failure behavior. Exercise a real exchange in staging. Use per-user/tenant caching and the token class appropriate for interactive staff work. If an offline token is actually used, follow the plan's expiring-token and refresh rules, but do not build a production credential database or imply an unobserved refresh event occurred. Token persistence/recovery remains an explicit later adapter obligation.

## 3. Server/UI security and behavior

Private SSR/fragments/API responses are non-cacheable/shared-cache-safe. Check cross-tenant cache isolation and stale data after identity changes. No mutation on GET. The synthetic POST requires verified identity, permission, validated input and the chosen CSRF/cross-origin defenses. Preserve same-origin request constraints and constrain CORS; an iframe URL or Referer is not authentication. Test direct cross-origin form submission, absent/expired token, wrong audience/destination, malformed body and denied user. Errors must not log tokens or returned merchant data.

Configure appropriate Shopify frame-ancestor/content-security policy from a safe tenant/configuration boundary. Keep framework origin checks or an explicitly justified equivalent. Do not disable security globally to make iframe embedding work. No private state, session token, access token or client secret may land in static assets, HTML before authentication, inline island props before authentication, browser storage, URLs generated by our code or committed evidence. If Shopify supplies a short-lived ID token in a launch URL, verify it through the supported flow and redact/scrub it; do not echo, retain or spread it through links.

Load one currently supported stable Polaris Web Components bundle and matching types; record the actual CDN channel/version observed. App Bridge and Polaris versioning are distinct. Avoid introducing a prerelease UI dependency solely because a current guide previews it. Exercise a form field, validation error, primary button, loading/disabled state, feedback and keyboard focus in the Preact island. Record actual property/event handling and hydration behavior; do not solve a mismatch by adding React compatibility machinery automatically.

Build the standalone Node output and run it in production mode, not only Astro's development server. Verify the Shopify Node adapter loads there and server-only imports/secrets are absent from client chunks. Start/stop the built process reproducibly. A development tunnel alone is not production-bundle proof.

## 4. Execute the local and live test matrix

Local tests must run without merchant credentials in CI. Use Vitest/Playwright or existing compatible project tools. Retain actual commands and compact results at the source head; one matrix is enough, not many redundant receipt files.

| Area | Required check / honest evidence boundary |
|---|---|
| Bootstrap | Unauthenticated launch/direct requests leak no protected content; real staging App Bridge identity reaches the backend. |
| Navigation | Cold Admin launch, second page, deep link, reload, back/forward and successful synthetic save. |
| Expiry/concurrency | Old/invalid ID token rejects, fresh identity recovers, concurrent requests do not create an unbounded exchange loop. Real expiry can be tested by normal waiting/re-auth; do not change a server clock or forge a live Shopify token. |
| Authorization | Synthetic two-tenant and allowed/denied-user tests; real current staff session read. Use an existing alternate authorized staff session only if available. Do not create users or change roles. |
| CSRF/cache | Unauthorized POST and cross-tenant response/cache tests fail safely; invalid input has no local state change. |
| UI | Preact/Polaris events, keyboard focus, error/loading state, repeated navigation and no hydration errors. |
| Restricted browser | Third-party-cookie-blocked and narrow viewport tests; distinguish real Shopify iframe tests from local Playwright simulations. Lack of a mobile device or second staff login does not block completing independent work, but is not a passed case. |
| Built output | Local production-mode Node SSR, protected request handling and client-bundle inspection pass. |
| Cleanup | Stop owned preview/tunnel, restore temporary dev app URL/redirect overrides as supported, remove ephemeral credentials/synthetic state; existing commerce resources unchanged. |

Capture enough nonsecret evidence to associate the real app/shop, executed path, verified response and built source with the observed behavior. Do not publish raw authorization headers, full token exchange payloads, browser HAR/session dumps or personal staff details. Private request interception is not a prerequisite. If it is unavailable, use narrow server assertions, browser observations and sanitized outcome receipts, clearly labeled. Mocked App Bridge must not stand in for the live happy path.

## 5. Staging permissions and boundaries

The owner-forwarded launch authorizes development access to **the existing `insignia` app and `insignia-staging.myshopify.com` only**. Resolve their actual IDs and existing scopes from previously retained configuration and a minimal live read; do not ask for designations again.

Allowed: local code/dependencies and tests; official scripts/documentation/schema reads; existing credential use via the secure local route; a web-only development preview/tunnel; temporary dev app URL and auth-redirect settings necessary for that preview; managed reauthorization only without expanding or reducing the existing approved scopes; actual ID-token exchange; minimal read-only Admin queries for shop/app identity and granted permissions; local synthetic edits; cleanup of this package's own dev session. The owner can complete ordinary login/consent in the existing browser without sharing credentials. Do not create or rotate app credentials.

Snapshot the limited app-preview/config state before changing it and restore only package-owned dev overrides. Do not run the historical Functions' preview project to launch this web proof. Keep existing Transform/Validation state unchanged; if a CLI path would release an app version, change a distribution choice, alter scopes or mutate unrelated extensions, stop that action and complete safe local work.

No product/config-policy publication, buyer checkout, test order, payment/discount/inventory change, order/history mutation, new app/store, staff/role creation, billing event, production release, global theme modification, host privilege escalation or credential/session export. Orders #1001–#1006 stay read-only and are not queried unnecessarily. Database/R2/billing setup are not prerequisites for this narrow synthetic editor.

## 6. Review, handoff and architectural direction

Complete internal task decomposition, implementation, tests and local review corrections without extra principal handoffs between ordinary steps. The integrator owns contract, lockfile and CI changes. Independent UI and auth work may proceed after the small request/identity interface is agreed. Reviewers see the specification and final diff, not just the orchestrator's success narrative.

Return one PR with the two-page executable, secure synthetic edit, pinned dependency/production build evidence, local test matrix, actual staging observations and failure limits. Record a recommended reusable auth/navigation shape plus remaining G7 work. Keep v1.2 plan/ledger and historical policy/protocol evidence unchanged; update only operational pointers and results. The gate owner is the principal. No full G7 pass, production authentication implementation, protocol adoption or M1 readiness may be self-declared.

The M0-008 journal/admission/activation ports stay pending for production. This package deliberately advances an independent planned gate; it does not implement or excuse an unsafe publisher. If Astro has a fundamental demonstrated incompatibility, return a minimal reproducer and supported alternatives for principal decision instead of silently choosing a different framework.

## Primary reference pointers

Verify the current pages/SDK sources at implementation time. They provide interfaces, not proof that our integration passes:
- https://shopify.dev/docs/apps/build/authentication-authorization — custom-framework flow selection.
- https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens — token purpose, lifetime and validation.
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens — online/offline distinction and refresh.
- https://docs.astro.build/en/guides/integrations-guide/node/ — standalone Node output.
- https://docs.astro.build/en/guides/integrations-guide/preact/ — SSR/hydration integration.
- https://community.shopify.dev/t/the-polaris-cdn-is-adopting-semantic-versioning/37332 — Shopify-authored channel guidance; confirm current stable channel and compatible types.
- https://shopify.dev/docs/apps/build/app-home/polaris2 — current App Home loading/compatibility guidance, including release-candidate status where applicable; this is not automatic authorization to adopt a prerelease.
