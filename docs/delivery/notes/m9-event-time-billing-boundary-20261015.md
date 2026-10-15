# M9 event-time billing boundary — 15 October 2026

Scope: read-only primary-document research for the first pure qualification slice; no authenticated API calls, provider sends, plan edits or version migration.

The [owner commercial decision](../authority/commercial-single-plan-2026-10-10.md) binds one all-feature plan: USD49.99 per30-day cycle,100 included qualifying paid customized orders, USD0.10 thereafter,14-day trial waiving both fees. Provider/display handles and native configuration remain unqualified; do not substitute the old synthetic three-plan catalogue.

## Current primary documentation

- [Partner historical events2026-07](https://shopify.dev/docs/api/partner/2026-07/historical-events) documents cursor pagination, maximum250/page, app `subjectId` plus `shopId` scope, explicit `occurredAtMin`/`occurredAtMax`, and maximum365-day query range. Omitted bounds use30-day defaults. Manage apps permission is required. A page is not proof of complete history.
- [SubscriptionStatus2026-07](https://shopify.dev/docs/api/partner/2026-07/objects/SubscriptionStatus) exposes event time, type, state, shop, subject and plan; `cancelEffectiveOn` is a Date, not a timestamp. [Plan2026-07](https://shopify.dev/docs/api/partner/2026-07/objects/Plan) supplies plan handle, billing period and integer trial-day fields.
- [Active subscription2026-07](https://shopify.dev/docs/api/partner/2026-07/active-subscription) is explicitly current state: current cycle, current items, trial end and future pending update. During trial the cycle is null; afterward trial end becomes null. Public-app eligibility and Manage apps access are required; null means no current active contract.

Engineering inference: these fields alone do not establish every exact historical trial/cycle boundary. Do not turn a date-only cancellation into an invented instant, reconstruct a prior trial from today's null trial end, or assign an old first-paid fact to today's cycle. Complete scoped history, an installation baseline and authoritative exact intervals still need a production normalizer; that native normalizer is not implemented. Missing/ambiguous coverage stays `PENDING_HISTORY`.

## Transport observation and dated evidence

The exact [App Events2026-07 creation-document URL](https://shopify.dev/docs/api/app-events/2026-07/creating-events) returned `Internal Error` through the research browser today. This is a document-fetch failure, not evidence that the API is unavailable. Exact2026-07 authenticated transport/access and current eligibility were not requalified.

Freshly served [latest overview](https://shopify.dev/docs/api/app-events/latest) and [latest creation reference](https://shopify.dev/docs/api/app-events/latest/creating-events) both currently distinguish24-hour generic-event deduplication from permanent billing-event deduplication. They currently agree; their examples now use2026-10. This updates an earlier inconsistent documentation observation, without changing Insignia's pinned2026-07 transport. A billing event is selected by a configured meter handle;202 receipt alone does not prove successful billing processing. Native requalification remains necessary before a permitted send.

The [27September M0-010 matrix](../../../spikes/m0-010/provider-contract.md) is dated documentation/parser work, not current access evidence. The [28September M0-012 record](../evidence/m0-012-real-contract.md) separately proves three synthetic unit events on the exact app/store's effective-zero development contract, with four POSTs including an immediate same-key replay and observed quantity3/cost0. Its recurring price and usage tier were effective zero, with unexplained `active:false` fields retained. It does not prove the owner-approved paid plan is configured now, historical trial/allowance qualification, lifetime deduplication or commercial invoice math. No fresh paid-plan observation was made here.

## Smallest useful implementation

1. Qualify an immutable first-paid purchase fact at its original event time. Explicit test orders are excluded; unknown test status, missing contract evidence, conflicting/overlapping intervals or uncertain boundaries hold without dispatch.
2. An authoritative trial interval containing that instant yields `WAIVED_TRIAL`, permanently non-dispatchable. An exact supported paid-plan/cycle interval yields one unit per qualifying order, irrespective of garment quantity/groups; refunds do not reverse it. Keep the original first-paid instant. Included orders still count as units against the provider's configured zero-cost first100 band; do not subtract the allowance again locally.
3. Keep this slice pure: no transport, credentials, fabricated provider handles or inferred current/history authority. Test boundary instants, delayed facts, test/unknown exclusion, trial waiver and exactly-one-unit economics.
4. Next connect the durable once-per-order ledger/outbox, then qualify historical normalization, existing API access and exact provider contract/meter agreement. Transport receipt, asynchronous billing processing and aggregate reconciliation remain distinct. New sends or pricing/resource changes require their actual scoped grants; this note grants none.

The documentation availability/precision limits do not block the pure qualifier. They constrain what evidence may satisfy it and what later native qualification can claim; no support inquiry or product replan is needed.
