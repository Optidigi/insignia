# M9 delivery outcomes — 15 October 2026

Bounded primary-source research against main `cb6436c673ef6270db63e9f00c77a0005c286b65` (tree `d66758ed2984dc3bbe85b2e92354259700b550cb`). No authenticated provider query, event/token acquisition, settings change or contact occurred. Billing dispatch remains disabled; the approved commercial binding/meter is unqualified. This note proposes local delivery semantics, not dispatch authority.

## Documentation and version limits

The pinned transport remains `POST https://api.shopify.com/app/2026-07/events`. Both exact [2026-07 overview](https://shopify.dev/docs/api/app-events/2026-07) and [creation reference](https://shopify.dev/docs/api/app-events/2026-07/creating-events), including their `.md` alternatives, failed with `Internal Error` in the research browser today. This is a document-fetch limitation. The served `latest` references explicitly select **2026-10**; none of the findings below silently updates the pinned API or proves its current native behavior.

The [current creation reference](https://shopify.dev/docs/api/app-events/latest/creating-events) documents one event with shop, meter handle, occurrence timestamp, idempotency key and attributes. Billing requires a configured matching meter. Generic keys have24-hour deduplication; billing keys have permanent deduplication. Occurrences over five minutes ahead are invalid; billing timestamps outside the current cycle fail validation. **Engineering inference:** preserve one permanent opaque key and the exact original serialized body for each order, including first-paid time and unit1. Never change key, meter, shop, time or value to make an old event acceptable. Permanent billing deduplication cannot be assumed when an unqualified handle might be treated as a custom event.

The [current API overview](https://shopify.dev/docs/api/app-events/latest) distinguishes receipt from asynchronous billing. Its replay response has `Idempotent-Replay: true`;409 means the same key is still processing. It documents400 invalid request,401 invalid token,403 invalid/uninstalled shop,429 throttling and5xx internal errors. It lists creation, not a per-event status-query endpoint. These are current documentation facts, not newly observed2026-07 responses.

The [usage configuration guide](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges) places billing errors in Dashboard App Billing Event logs, including `PERIOD_CLOSED`, missing/non-metered subscriptions, invalid accounts/values and idempotency errors. Pre-uninstall usage has24 hours for submission after uninstall; afterward the billing period closes. **Inference:** exact original entitlement and remaining submission window need separate proof. A current installation/active flag cannot authorize an old occurrence. An unexplained idempotency error cannot establish successful billing or justify a new key.

## Smallest supportable transitions

These are proposed application states; names need not become separate tables or a receipt subsystem. They require a durable attempt marker before possible network dispatch and retain the immutable event identity separately.

| Evidence available | Permitted local conclusion and next step |
| --- | --- |
| Dispatch disabled, missing qualified contract/window/access, or invalid local input | `NOT_SENT` only if no attempt could have reached the event endpoint; retain the reason and intent. |
| Auth acquisition/validation failed before the event dispatch boundary | `NOT_SENT`; auth failure is not an event-delivery attempt. |
| Durable dispatch intent exists; process died, response was lost, event POST timed out, response was malformed/oversize, redirect occurred, or5xx lacks definitive settlement | `UNKNOWN`; stop this delivery and reconcile. No automatic retry, key reset or journal reset. |
| Definite matching400/401/403/429 response from the exact endpoint | `REJECTED` for that attempt; retain bounded status/reason. This is neither billing success nor permission to retry.429 may become a later same-body attempt only under an explicit non-ambiguous retry policy and valid remaining window. |
|409 for the same key | `UNKNOWN`/processing; prior processing remains unresolved. Current docs suggest a delay, but the active owner rule still forbids retrying an unresolved mutation. |
|202 with valid receipt body, including a replay header when present | `RECEIVED`, with replay recorded separately. Do not infer billing acceptance, invoice payment, another unit or successful original processing. |
| Correlated authoritative Dashboard billing outcome | Record `PROCESSED` or `BILLING_REJECTED` as separate evidence. Preserve the original receipt and attempt history. |
| Exact closed-window or immutable-invalid-event evidence before any possible send | Terminal local hold/rejection: do not send or restamp. If an earlier attempt is unresolved, closure does **not** convert `UNKNOWN` into `NOT_SENT` or prove no bill occurred. |

The separation of202 receipt from billing processing and the absence of failure webhooks are explicit in [About App Events](https://shopify.dev/docs/apps/build/app-events#billing-errors). The conservative unknown/no-retry handling above is Insignia's owner constraint and an engineering choice; Shopify documentation does not promise every failed network request had no effect. Explicitly rejected attempts remain distinguishable from events never sent.

## Reconciliation and existing evidence

The [Partner2026-07 active-subscription API](https://shopify.dev/docs/api/partner/2026-07/active-subscription) supplies current cycle/usage information, requires Manage apps access, and supports public apps. Aggregate quantity/cost is useful reconciliation evidence; equality cannot identify which individual event was accepted. No supported per-event billing-result API was found in the inspected App Events reference; Dashboard remains the documented billing-error surface. Shopify Analytics preview/standard-event queries are not a billing-result substitute.

Existing [M0-012](../../../spikes/m0-012/README.md) stores exact bytes/key/time before acquisition, journals `MAY_HAVE_SENT`, separates202 from billing observations, and used Dashboard references plus Partner aggregates. Its September zero-price development observations and immediate replay remain dated evidence, not a current commercial or lifetime-deduplication proof. Its `TIMEOUT` result can arise during either token acquisition or event POST; a production classifier must use persisted dispatch phase, not that result label alone. The [M0-010 fake retry policy](../../../spikes/m0-010/provider-contract.md) is historical prototype behavior and does not authorize automatic retries of unknown outcomes now.

## Next useful local slice and native limits

The smallest useful next implementation is a pure classifier over normalized attempt evidence: `NOT_DISPATCHED` → `PENDING`; exact202 → `TRANSPORT_ACCEPTED`; other HTTP outcomes or `UNKNOWN` → `RECONCILIATION_REQUIRED`, with bounded reasons retaining distinctions above. No expanded terminal-state schema or protocol-dependent transport is needed yet. In particular409 holds as processing, and202 never means billed. Test those boundaries and use this classifier in the next actual durable attempt transition; avoid shipping an unused helper as delivery completion. Original key/body/time remain the permanent intent/composition's responsibility. Window/authorization checks precede dispatch and never clear unresolved history. Later durable transitions must survive crash/restart and concurrency before any sender is connected; this research does not implement them.

Native qualification must still establish the exact app's2026-07 access/response shapes, actual approved policy/meter, current processing/replay/error correlation and eligible original entitlement/window. A permitted zero-cost development test may prove transport/counting but cannot prove real-price invoice math. No new plan/version/scope, event send, reversal, reinstall or billing activation is authorized by this research. Known missing commercial/native evidence stays unknown rather than blocking the pure local work.
