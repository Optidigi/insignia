# M0-011 — existing-provider eligibility and no-charge billing transport

**Outcome:** One integrated provider-adapter/evidence PR establishing what the EXISTING Insignia app can actually do with Shopify App Pricing, Partner API and App Events. If prerequisites permit, complete the bounded $0 transport/count test below. Otherwise deliver executable local adapters and the exact verified prerequisite list; do not manufacture live evidence.

This is G8 development work, not production billing, M1, a new commercial plan decision or a complete gate pass. Owner launch authorization below is required for the described mutations; this document alone is not authorization.

## 1. Start from the reviewed checkpoint

Read AGENTS.md, delivery state/operating model, PR-013R review, v1.2 plan sections 6.6–6.8, and the current M0-010 provider contract/source/tests. Use repository-pinned writing-for-agents for handoffs, research for uncertain provider facts, tdd for adapters, diagnosing-bugs for defects and code-review for fresh Spec and Standards/security reviews. Preserve the R1/R2 regressions.

Verify the owner-authorized normal merge of PR #13 at base `31484d328ec401a30994d073518b11eb67777433` and head `8bda74f1985762923580b5d1d92b56c4a0d7203f`. Resolve actual remote merge SHA; branch from updated main. A changed reviewed head/base returns for review. Keep plan/ledger v1.2 and historical receipts unchanged; record this external review without representing it as a native approval.

Use actual gpt-6-sol/high. At most two non-overlapping restricted writers, separate worktrees, one integration owner and fresh local Spec/security reviews; one operator serializes all authenticated provider actions. Read-only provider discovery can run alongside local adapters. Reuse established tooling; native subagent unavailability permits separate restricted sessions, not another general preflight. Principal controls architecture, scope and final PR/gate verdicts.

## 2. Establish real eligibility before mutations

Known resources: existing app `insignia`, OAuth client `942e6668fd1177524c0fc48b104b0ac3`; shop `insignia-staging.myshopify.com`, Shop GID `gid://shopify/Shop/78935261342`; previously observed installation `gid://shopify/AppInstallation/781307904158`. Reverify identity. Resolve the actual Partner App GID and Partner organization; do not infer them from OAuth client ID or Dashboard resource numbers.

Use the authenticated existing Dashboard/browser and securely available approved credentials for scoped read-only app/store, current subscription, pricing/test-plan/meter and historical-event inspection. An Admin grant does not establish Partner or App Events access. Owner entry of secrets uses the normal secure local channel; never request credentials in chat, copy browser cookies, export sessions, log tokens, or create/rotate organization API clients without separate authorization. Runtime access-token acquisition with already approved credentials is allowed; permanent credential creation is not.

Produce an evidence-backed table: app identity/public-App-Pricing eligibility; app/store organization and actual dev-store status; current contract and effective tariff; test-only plan/meter availability and other consumers; Partner and App Events access; Dashboard visibility; existing stopped-preview/grants baseline. Missing Dashboard access is not proof of missing capability. Continue all independent safe work before batching exact owner-only actions.

**Endpoint evidence:** retrieved App Events docs currently expose `unstable`; the older encoder's `2026-07` support has not been observed. Reconcile primary docs/schema and actual route behavior. The new prototype adapter may explicitly select the documented `unstable` endpoint if that remains the supported route, with evidence and contract tests. Do not rewrite historical 2026-07 fixtures or silently claim stable-version support. No arbitrary endpoint/credential-forwarding fallback.

**Stop the live mutation branch** if distribution must be selected, App Pricing must be enabled/switched, real pricing/listings must change, a new permanent credential is required, an unrelated/pre-existing subscription must be replaced, or the no-charge boundary cannot be established. Report the precise app-level prerequisite and proposed action to the owner/principal. No new app/store or custom/manual billing architecture is authorized.

## 3. Implement the real adapter boundary locally

Add `spikes/m0-011` or a narrow successor module; reuse M0-010 logic rather than duplicating the billing engine. Implement a read-only Partner client and App Events credential/HTTP adapter with injected fetch/credential/time ports, exact app/shop/meter allowlists, request-size/time limits, safe error redaction, retry classification and durable-to-local-run payload identities. Partner GraphQL reads may use POST but must contain allowlisted queries only.

Default to dry-run/off-store. Live event submission requires an explicit run manifest and verified no-charge preconditions; CI can never enable it accidentally. Disable cross-origin redirects for credentialed calls. Keep Admin, Partner and App Events credentials distinct; read only scoped provider data. Preserve original event body/time/key on retries and restart, validate runtime results, and treat 202 as receipt only.

Test transport errors, wrong app/shop, unknown tariff, stale/no-charge observations, unsupported endpoints, redirected URLs, expired credential handling, missing cycle, exhausted attempt budget and ambiguous sends. Historical normalization may only claim coverage actually demonstrated by scoped pagination and observations. A Date field or a day counter is not a timestamp. Trial/scheduled-change regressions remain mandatory.

A built-in private test contract may differ from the production two-tier hybrid shape. Record the actual shape. A narrow test-contract adapter may model explicit zero-price test data separately; do not relax the production entitlement parser or claim this proves the three production plan tariffs.

## 4. Conditional $0 test permission and run

Only after section 2 establishes App Pricing is already available and the test is confined to this designated development installation:

- Prefer the built-in **private $0 test plan**. Configure only that isolated test plan and one run-owned meter, or reuse an existing matching test meter without changing it. The event handle must be verified as a billing meter (prefer `customized_order_paid`), not merely a custom analytics event. Record exact plan/meter IDs before use.
- All recurring prices, every tier's flat and per-unit amount, and any other charge components must be zero for this contract. Confirm no-charge selection before acceptance and re-read the actual effective contract afterward. A temporary trial or an unused allowance is not sufficient protection against future charge. Do not activate a nonzero production plan even if a generic guide says its testing should be free.
- Do not edit a meter or plan already serving another contract. If the built-in test plan cannot be isolated safely, stop that branch and request the exact missing approval; do not publish or invent replacement commercial plans. Test-only fixture terms are not amendments to the 14-day chosen-plan trial product decision. Do not shorten/reset an existing trial to accelerate this test.
- Activate at most **one new zero-price test subscription** if no pre-existing subscription would be replaced. Record actual history and usage baseline before submission. Reuse an existing eligible zero-price test subscription only read-only apart from the specifically bounded test events; do not cancel it at cleanup.
- Create at most **three unique synthetic `value:1` events**, and perform at most **six App Events POST attempts total**, including exact duplicate and transport retries. Suggested sequence: A, exact A replay, B, C. No malformed live events, backdating, rate-limit/load tests, negative/fractional events, test buyer orders or personal/order attributes. Preserve opaque keys and original occurrence timestamps in a crash-safe ignored local run journal before sending. Reserve identities before retry; never reset the counter after restart.
- Synthetic transport events deliberately bypass production order qualification through a separately identified harness. Never relabel a Bogus order as non-test or modify the rule excluding test purchases.
- Confirm an applicable active cycle/no-charge contract immediately before sending. On a missing cycle, pending plan boundary, unexpected price, changed identity or unclear event disposition, stop new submissions and preserve evidence. Do not alter occurrence times to force acceptance.
- Capture sanitized request/body hashes, statuses, safe headers including replay/correlation fields where returned, Dashboard billing logs, and scoped Partner cycle quantity/cost before/after. At a stable cycle, three accepted unique unit events should produce a delta of three, not four, and cost zero. A matching aggregate is still not proof of every event's individual billing.
- Use bounded synchronous observation (up to twelve spaced result-read cycles, respecting API rate limits). If processing remains pending, return that status; do not run an unattended monitor or declare failure/success from time elapsed alone. No permanent-dedup claim follows from one short replay.

No further principal approval is needed between ordinary in-scope tests/fixes or these explicitly authorized zero-price actions once preconditions are met. The owner/principal boundary remains for missing irreversible setup or a changed permission envelope.

## 5. Cleanup and handoff

Cancel only a subscription newly created by this run, using its supported no-charge app-subscription path without uninstalling. Read back whether cancellation is immediate or scheduled. Keep provider event history; do not claim sent events can be erased or emit compensating negatives. Remove/archive only isolated run-owned plan/meter objects when provider references permit; otherwise report residual IDs and zero-price state. Preserve any reused pre-existing test subscription/configuration. Discard temporary tokens without revoking shared credentials.

Keep the stopped M0-009 preview, restored eleven effective Admin grants, released app configuration, product policy, Functions, storefront, payments, inventory and orders #1001–#1006 untouched. No app dev/clean, released deployment, distribution change, scope change, real purchase, fee, host escalation or new store/app.

Return ONE integrated PR containing implementation, contract tests, precise runtime/source binding, sanitized provider evidence or exact prerequisite failures, resource-before/after register, final-head CI and fresh reviewer dispositions. Preserve off-store vs observed boundaries. The evidence matrix must separately classify eligibility, authentication, subscription, transport receipt, dedup, asynchronous billing logs, aggregate count/cost, historical coverage and cleanup. Unknown is not success. Complete useful local work even if live access is blocked.

This package can establish a limited live transport/count observation, not real-price invoices, fourteen elapsed trial days, all plan changes, verified first-paid order ingestion, durable production outbox/fencing, or complete G8. v2 remains provisional and production publication remains pending. No next-PR merge, protocol adoption, M1 or successor package starts automatically.

## Current public references (verify at execution)

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing — test-plan/no-charge rules and current subscription handling.
- https://shopify.dev/docs/api/partner/2026-07/active-subscription — exact current observation and eligibility.
- https://shopify.dev/docs/api/partner/2026-07/historical-events — scoped historical reads.
- https://shopify.dev/docs/api/app-events/latest — authentication, endpoint/version, responses.
- https://shopify.dev/docs/api/app-events/latest/creating-events — idempotency, 202 and asynchronous verification.
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/build-billing-event — meter/event setup.
