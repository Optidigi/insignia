# M0-010 — off-store hybrid billing, entitlements and usage delivery

**One integrated local G8 work package.** Start after the owner forwards the launch and the exact approved PR #12 merge is verified. Return a runnable contract/adapter proof, tests and evidence in one PR. No live charges, pricing setup or staging mutation.

## Outcome

Implement and test the complete local path:

`verified subscription/history snapshot → entitlement decision → first-full-payment usage qualification → immutable local usage fact/outbox → fake App Events delivery → explicit reconciliation disposition`.

This must demonstrate the approved commercial semantics, identify actual provider contracts and surface any material incompatibility. It is not a production database, general billing framework, migration or full G8 pass. Pure/local success must remain labeled local; do not present stub acceptance as Shopify acceptance.

Read root AGENTS, delivery state, operating model, v1.2 ledger, PR-012 review, and plan §§6.6–6.8, the billing/job records and G8 register. Use relevant pinned research, tdd, diagnosing-bugs, writing-for-agents, code-review and handoff skills. Discover commands from the existing repository. Do not reopen settled pricing/product decisions or start another tooling preflight.

Actual orchestrator is `gpt-6-sol` with `high`. At most two restricted writers with non-overlapping paths/worktrees, one integration owner and fresh Spec and Standards/security reviews. One worker may own provider contract research/adapters and the other usage/entitlement behavior after agreeing the small interface. Retain review findings and their dispositions; finish ordinary in-scope corrections locally.

## 1. Confirm provider contracts before adapters

Use current primary documentation, pinned schemas/source where available and corroborating first-hand reports. Reconcile evidence, rather than treating an example or SDK helper as an unquestionable contract. Record the API version and exact documented request/response/status fields used.

The plan already selects monthly **Shopify App Pricing**, Partner API subscription/history reads, and App Events usage. Verify that path rather than silently substituting legacy Admin billing or `APP_SUBSCRIPTIONS_UPDATE` webhooks. Check:

- Current subscription, trial and effective/pending plan changes; cycle boundaries and usage meter identifiers.
- Which provider state establishes an active entitlement; redirect parameters are only prompts to verify.
- Combined subscription/usage, included allowances, graduated zero-cost band and any provider trial behavior that differs from Insignia's complete usage waiver.
- App Events authentication class, immutable occurrence timestamp, idempotency scope/window, 202 semantics, error/retry rules and observable billing reconciliation.
- True no-charge test prerequisites for a later live G8 package. Documentation that no-charge testing exists is not authority to subscribe now.

Keep browser ID tokens, Admin online/offline tokens, Partner API credentials and App Events credentials distinct. Do not export or create credentials. Do not assume the existing eleven staging Admin scopes supply Partner API access.

Use approved public examples and synthetic payloads for executable contract fixtures. If documentation does not establish a fact, make the capability unknown and the unsafe path refuse/pending; never fill it with a guessed success response. A material provider mismatch returns evidence and a proposed decision, not a second adopted billing architecture.

Completion: one short provider-capability matrix with sources, normalized contract fields, exact adapter fixtures, unsupported/unknown observations and prerequisites for live proof.

## 2. Commercial invariants

Use three **synthetic, explicitly noncommercial** plan fixtures, with different feature sets and included allowances. Exact production names, prices, handles, allowance values and feature assignments are not chosen here. The test catalogue may use artificial feature identifiers; it must not become the merchant offer.

- One usage unit per distinct non-test Shopify order containing a verified Insignia customization when it first becomes fully paid. Physical quantity and customization-group count do not multiply usage. Ordinary/test/unpaid orders do not count. A second real order using a reusable offer is distinct usage.
- Refund, cancellation and restock after qualification do not reverse usage. Duplicate/out-of-order events do not create additional facts. This package consumes a normalized verified purchase/payment fact; it does not build the entire webhook/purchase verifier.
- Determine trial/contract status from the authoritative first-full-payment occurrence time and provider history, not worker time or a later plan redirect. An insufficient historical snapshot becomes reconciliation-required, not guessed billing.
- The chosen-plan trial is 14 days from provider-confirmed activation. Trial-qualified usage is locally `WAIVED_TRIAL` and is never emitted retrospectively. Delayed processing after trial does not change that qualification. Do not create a fresh trial on local reinstall or plan change.
- Send value `1` for every qualifying non-trial, billable order, including orders within the allowance. The provider's zero-cost graduated band owns the included-usage allowance. Do not subtract the allowance again locally or charge the whole cycle retroactively at an all-units rate. Garment customization quantity tiers are a separate domain.
- Without verified active entitlement, issue no new commercial quotes, acceptances or renewals. Historical purchase access remains subject to retention. Already issued valid offers remain governed by their existing validity/security conditions; no billing-driven epoch bump or early revocation.
- An already-promised order completed without a billable active contract is retained as unbillable, not charged after reactivation. Unknown history is not the same as proven absence of a contract.
- On downgrade, affected new quote/configuration actions stop while configurations covered by the new plan continue. Preserve accepted terms, historical order access and required-customization semantics. UI hiding is not enforcement.

Do not invent treatment for ambiguous provider transition/proration cases. Model verified effective timestamps, preserve uncertainty and name any truly unresolved commercial decision.

## 3. Local implementation

Under `spikes/m0-010/`, implement a small strict-TypeScript use-case module, normalized subscription/history port, usage-fact store/outbox port and App Events transport. Use fake transport plus restartable in-memory snapshots; no PostgreSQL installation is needed. Define production durability/transaction and scheduling obligations without pretending the fake supplies them.

Keep local business uniqueness stable across deliveries and app reinstalls as the plan requires: `(shop, externalOrder, eventKind)`. Keep opaque provider idempotency keys stable on every retry. Store actual first-paid occurrence time immutably. Do not send raw order/customer identifiers or personal data in event attributes; usage `value: 1` is sufficient. Use synthetic IDs and keys for tests.

A local atomic operation must model qualification plus outbox insertion so crashes cannot count twice or lose the delivery intent. A delayed timeout may have been received: retry the same event/key/time, never mint a new charge to make a request succeed. Make this a tested port contract, not an exactly-once claim about a remote API.

Separate at least business qualification, transport acceptance, reconciliation-needed and verified aggregate/operator observations. HTTP 202 alone must never set `BILLED`. A redirect, browser plan handle or unsigned webhook-like fixture alone must never grant an entitlement. Normalize provider read errors, stale snapshots and auth/rate-limit failures without exposing secrets.

For a permanent billing validation failure or a period outside the accepted provider submission window, preserve the original event and escalate/pending according to the verified contract. Do not shift its timestamp into a later billing period. Negative/fractional API support is not permission to reverse Insignia usage on buyer refunds.

If the provider only exposes a class of failures in its Dashboard, state that operational dependency explicitly. Do not fabricate a failure webhook or per-event reconciliation endpoint. Aggregate agreement must not be labeled proof of each individual event.

## 4. Executable acceptance matrix

Cover the full pipeline through the public use-case seams, not just private helpers:

| Case | Required assertion |
|---|---|
| 500 customized garments / several groups / one paid order | One usage fact and at most one stable delivery identity. |
| Second order with identical design/offer | Second fact, no reuse suppression across distinct orders. |
| Plain, unpaid and Shopify test orders | No billable usage. Synthetic G8 qualification fixtures can model non-test orders without contacting Shopify. |
| First full payment and duplicate/out-of-order notifications | One immutable occurrence fact; partial payment alone does not qualify. |
| Trial boundary and delayed processing | Provider-derived interval; trial order remains waived after expiry; later real order is independently evaluated. |
| Included-allowance boundary | All qualifying units emitted; zero-cost band applied once by fake provider tariff, with test-only amounts. |
| Upgrade/downgrade/frozen/cancelled/reinstated status | Verified effective entitlement, no reliance on redirect, no retrospective trial/unbillable charging. |
| Unknown/missing/stale subscription history | Pending/reconciliation or denial of new commercial actions, no invented charge or reset. |
| Worker crash/restart and concurrent qualification | No duplicate fact/outbox; same event identity on replay. |
| Timeout after provider receipt; 202; 409/429/5xx; auth or terminal validation failure | Verified error contract, bounded retry, 202 stays transport-only, immutable key/time. |
| Refund/cancellation after usage | No usage reversal or compensating billing event. |
| Merchant billing change versus buyer offers | No quote mutation or billing-triggered authorization revocation; historical access independent of active selling entitlement. |
| Cross-shop/installation and malicious plan inputs | No tenant leakage or entitlement from unverified client data; preserve generation boundaries without recharging historical orders. |

Use deterministic clocks and actual checked integer money where mock tariffs are needed. Add one command for clean frozen install/typecheck/tests and a scoped off-store CI job. Preserve v1.2 architecture bytes, previous proofs and regression checks. Keep changes restricted to the new spike, its workflow and operational review/state documents; do not fold G7 editor changes into the billing PR.

Completion: one reproducible end-to-end local commercial scenario, the full relevant negative matrix, current provider contract fixtures and fresh local reviews. No fixed test-count target or generated evidence volume goal.

## 5. Access and preview boundary

This package is off-store: **no merchant-authenticated API calls, no App Events submissions, no billing-plan/contract/meter changes and no preview commands**. Public documentation/schema access, project-local dependencies and local/CI execution are permitted. Existing authenticated Dashboard/browser access may be used only to read the existing app's pricing-method/test-availability settings when already available, without creating an API client, credential, listing, plan or subscription. Sanitized observations are optional evidence; unavailable access does not block local work.

Leave the stopped M0-009 preview, its existing scope grant, released configuration and orders #1001–#1006 unchanged. No `app dev`, `app dev clean`, uninstall, scope cycling or release. Record the current cleanup residue in delivery state without reopening it as a billing prerequisite. No host escalation, broad plugin installation, database/R2 setup or browser-session export.

The next live billing test must receive a separate principal-issued, owner-authorized envelope after actual no-charge eligibility, correct app/store ownership, required credentials and test settings are identified. A no-charge provider claim does not waive that boundary.

## 6. Handoff

Return ONE integrated PR with fixed refs, exact final-head CI, implementation, sources, contract fixtures, test results and review dispositions. Keep provider-verified facts, fake behavior, owner decisions and untested live capabilities distinct. Provide a bounded proposed live G8 test envelope and any genuinely necessary owner actions, but do not execute them.

Record PR #12's external principal approval and verified merge, G7's remaining browser/cache/save-recovery work and the temporary stopped-preview residue. Option A remains approved, v2 provisional and production publication pending. No full G8 pass, protocol adoption, product cap, M1, released configuration or next-PR merge follows automatically. Principal review and owner merge authority remain unchanged.

## Primary pointers — verify at execution time

- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/combined-subscription-and-usage
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials
- https://shopify.dev/docs/api/app-events/latest
- https://shopify.dev/docs/apps/build/app-events
- https://shopify.dev/changelog/app-pricing-more-plans-no-charge-plan-testing-and-negative-and-fractional-app-events

Follow the current App Pricing page to its Partner API schema and history references rather than guessing query URLs. API behavior and access are evidence questions; the approved commercial model is not reopened by routine implementation choices.
