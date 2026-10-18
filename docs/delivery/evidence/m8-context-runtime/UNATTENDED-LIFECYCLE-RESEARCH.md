# Unattended uninstall and shop erasure — 18 October 2026

Research only. Requested outcome: ordinary uninstall and subsequent shop erasure run without owner intervention while old deliveries cannot revoke or erase a new installation. No implementation, credentials, authenticated native calls, subscription changes, scopes, app versions or resources were exercised. This is a supporting agent's investigation; independent correctness/security review and real runtime qualification remain required. The inspected research skill supplied the primary-source/single-note workflow; this bounded supporting assignment did not recursively delegate.

## Finding

A supported prospective route exists: create an `APP_UNINSTALLED` **shop-specific HTTPS subscription with a private, random, generation-specific destination**, preserve its immutable provider-confirmed registration binding, and treat that destination capability plus raw-body HMAC as authority for that exact installation generation. This is an engineering security design built on supported Shopify primitives, not a Shopify guarantee that its HMAC signs the destination or generation. It changes the previous experiment's purpose from evidence capture to an explicitly reviewed bearer-capability authority. Neither generic HMAC nor an API authentication failure becomes uninstall authority.

The pinned 2026-07 [`webhookSubscriptionCreate`](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/webhookSubscriptionCreate) includes a concrete HTTP `APP_UNINSTALLED` example. [`WebhookSubscriptionInput.uri`](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/WebhookSubscriptionInput) accepts HTTPS destinations. No new delivery provider is necessary. Confirm this exact operation against already-granted installation permissions; this note does not authorize expanding scopes or executing it.

This removes the need to prove universal current absence. The evidence proves **generation g was uninstalled**; a transaction may revoke g only, or identify a now-newer generation and leave it intact. Delivery latency does not transform g into the latest generation.

## What the platform actually supplies

1. [`WebhookSubscription`](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/WebhookSubscription) exposes globally unique subscription ID, topic, URI, configuration and timestamps; its query returns subscriptions for the current app/shop. Read back the exact created subscription independently and compare topic/URI, never trust a webhook's optional name or routing headers as the registration record. App-configured subscriptions are outside this query's coverage.
2. The pinned [`appUninstall`](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/appUninstall) contract describes removal of the installation and automatic cleanup of webhook subscriptions/admin links. A retained old local callback binding must nevertheless survive delayed/retried deliveries; never recycle its URL for a new generation.
3. Mandatory compliance subscriptions remain app-configured. Shopify's [subscription-management documentation](https://shopify.dev/docs/apps/build/webhooks/subscribe) states that compliance topics cannot be registered through the Admin API. Do not propose a per-generation dynamic `SHOP_REDACT` subscription.
4. The pinned [2026-07 webhook reference](https://shopify.dev/docs/api/webhooks/2026-07?reference=toml#shop-redact) describes `shop/redact` as sent no earlier than 48 hours after uninstall and not emitted if the app has been reinstalled. Its payload contains shop ID/domain, not installation generation. This description was verified in the official page's serialized topic-description data because the plain rendered-text extractor omitted it. The separate [privacy guide](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) documents the 48-hour schedule and shop payload. Suppression at event creation does not prevent a previously queued delivery arriving after reinstall; local generation fences remain necessary.
5. [Delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) authenticates the raw request body. Inspected pinned SDK 15.0.0 `lib/utils/hmac-validator.ts` and `lib/webhooks/validate.ts` separately verify the body and then read topic/domain/time/IDs from headers. There is no signed installation identifier in the ordinary Shop uninstall payload. Use the complete exact raw bytes and existing verifier; URL secrecy is additional authority, not an HMAC extension.
6. [Troubleshooting documentation](https://shopify.dev/docs/apps/build/webhooks/troubleshoot) describes bounded retries and eventual subscription removal after persistent failure. Webhook delivery is not a guarantee of eventual execution. Subscription monitoring, failed-delivery alarms and durable retryable internal processing remain necessary; missed delivery never authorizes speculative revocation.

## Smallest safe implementation

The following is a proposed contract, not an implemented or native-qualified result.

### Registration and admission

- At verified installation/bootstrap, allocate a cryptographically random 256-bit capability for one immutable tuple `(app client ID, provider shop ID/domain, tenant, local generation, external AppInstallation ID, purpose APP_UNINSTALLED)`. Use a dedicated path under the existing approved HTTPS origin, never query-string metadata or a browser-selected generation.
- Persist an encrypted recoverable destination and a separate lookup digest before dispatch. Persist the exact intended mutation and one-attempt operation identity. The callback route must exist before creation and durably retain early arrivals while registration is pending. Never log the destination, use it as a metric label, place it in a public receipt, or expose it to merchant/browser responses. Suppress request-path/access/error/trace capture at Traefik, application and provider-operation diagnostics. Provider access capable of reading subscriptions is security-sensitive.
- Read current trusted installation identity before dispatch; create precisely the generation's `APP_UNINSTALLED` subscription, then independently read back its ID/topic/URI and revalidate installation identity. Freeze the mapping; do not rewrite an old binding after reinstall. Missing/mismatched/duplicate registration is not READY. Source implementation can prepare this now; real create/readback needs actual scoped execution authority.
- Gate protected new installation behavior on this lifecycle registration becoming armed. No merchant data should be admitted into a new generation whose lifecycle registration has never qualified. Periodically requalify the registered destination while authenticated access is available, and alarm on drift; do not infer uninstall from drift.
- Unknown create acknowledgement requires read-only settlement against the exact private destination, not another create. An uninstall can race creation/readback and revoke access. Preserve the durable early callback and attempted registration. A verified callback proves possession of the specific prepared destination, but **does not provide the missing subscription ID/readback by itself**. Do not silently call it provider-confirmed registration. The implementation must explicitly choose and independently review whether a durably dispatched exact-topic creation plus a correlated HMAC-valid capability delivery is sufficient settlement for this race, or retain an automated exception/alarm state. There is no documented API guarantee making an unavailable post-uninstall readback recoverable. This is the principal design question remaining before claiming fully unattended race coverage.

### Authoritative receipt and deactivation

- Resolve the secret path to its original immutable binding; verify raw HMAC, bounded exact Shop body and signed shop ID/domain compatibility. Header topic must be consistent as a rejection check, but does not select purpose/generation. Subscription ID/name headers are not authority. Unknown/recycled/wrong-purpose URLs and old-body-to-new-URL attempts without the new capability reject.
- Store the callback's fixed generation binding alongside ingress evidence. ACK only after durable handoff. Retried callbacks/worker restarts become idempotent receipts against that same binding. Keep receipt collection times and expiration unchanged; do not deduplicate distinct genuine installations by identical body hash.
- Under the existing shop/installation locks, check exact tenant/provider identity and expected generation/installation ID. Reuse the atomic deactivation semantics in `packages/database/src/repositories/tenant.ts::deactivateCurrent`: revoke only that generation's credentials and clear its effective publication safely. A stale receipt cannot call that method with the latest generation. If g is already superseded, record g's lifecycle observation without touching the new installation; review whether installation replacement has already closed g.
- Preserve the generic `/api/webhooks/shopify` uninstall HOLD. Only the new qualified capability route may supply lifecycle authority. Do not reinterpret historical generic receipts or experiment captures as new authoritative events.

### Shop erasure and reinstall

- Keep the mandatory compliance endpoint and authenticate its raw body and exact signed shop ID/domain. Persist a durable privacy obligation and an **immutable eligible generation set**, derived from independently recorded uninstall bindings preceding its original receipt collection. Never calculate `<= current_generation` later when processing retries.
- A delayed old privacy request may clean only those independently inactive old generations. It must not erase active replacement generations, their settings, sessions, offers, artwork or new records. When a shop is active and the request cannot identify eligible old data safely, persist a pending/no-current-generation-effect state; do not invent current absence from the 48-hour description or a failed Admin call.
- The current SQL stages only when the latest installation was already inactive at collection, otherwise permanently records `SHOP_ERASURE_BLOCKED`. A **new versioned prospective receipt/state machine** is required for generation-set processing and reorder recovery. Existing permanently blocked decisions remain immutable; do not relabel them PASS or upgrade them merely because an installation later deactivates. Newly authoritative evidence requires its own linked decision.
- Treat a missing uninstall callback and a privacy request arriving first as a durable unresolved obligation, with unattended retry on later authoritative binding and an alert deadline. A later callback must prove the original eligible generation rather than expand a receipt to any newly inactive generation. Unsigned trigger time cannot resolve that ordering by itself.
- Apply the fixed set through existing design/offer/session erasure fences, retention rules and lease-aware artwork/preview cleanup. Preserve minimal lawful economic facts. Await actual object deletion, settle ambiguous storage outcomes, propagate exclusions into backups, and expose completion counts. A staged row/HTTP200 is not physical erasure.

## Security and completeness limits

An attacker with an old signed same-Shop body plus **the current secret URL** can replay that body at the current destination. This is the already documented `CURRENT_CAPABILITY_COMPROMISE` boundary in `scripts/m5-callback-qualification/README.md`. The design is safe only when confidentiality/non-reuse of the destination is an enforceable security assumption, comparable to other bearer credentials. Independent registration readback does not eliminate this residual. If the locked threat model requires surviving current-capability disclosure, this HTTPS design cannot satisfy it: stronger authenticated delivery infrastructure or a separately qualified provider authority is needed, requiring a separately authorized resource/design change. Never waive that boundary in a comment.

No inspected documented alternative supplies an uninstall event's exact `AppInstallation` ID: Partner [Relationship](https://shopify.dev/docs/api/partner/2026-07/objects/Relationship) events remain historical app/shop events; current Admin installation reads are positive authentication-bound observations. The management verifier currently supplies release/installation-presence observations, not a generation-bound negative authority.

Therefore a normal unattended path is feasible prospectively with secret generation routing, but unconditional completion is not established by documentation alone. Registration-ack loss plus immediate uninstall, loss/reordering of authoritative deliveries and strict capability-compromise requirements need an explicit tested contract. These are engineering failures to handle or concrete platform limits to report, not grounds to substitute a routine manual-only product workflow.

## Existing seams and required qualification

- `packages/database/src/repositories/shopify-webhooks.ts`: generic Shop identity validation and intentional unqualified result.
- `packages/database/src/repositories/tenant.ts`: managed-install locking/bootstrap fence and expected-generation deactivation.
- `packages/database/migrations/20261017000300_shop_privacy_staging.sql`: current permanent blocked/staged privacy distinction and erasure targets.
- `apps/worker/src/handlers.ts`: durable routing, deferred uninstall and blocked-privacy alerts.
- `scripts/m5-callback-qualification/`: reusable design/test evidence for private immutable callback maps, raw-body verification, durable arrivals, expiration and secret-leak boundary; it is an experiment, not production-ready lifecycle code.
- `scripts/privacy/restore-exclusions.mjs`: retain/reapply new authoritative generation fences and original receipt distinctions in a versioned export contract.

Meaningful tests must cover wrong shop/purpose/capability; generic-HMAC replay; old callback after reinstall; simultaneous bootstrap/uninstall; same body across two generations; registration timeout before/after remote effect; callback before create response; absent/mismatched readback; duplicate/restart/concurrent receipts; privacy before/after uninstall and after reinstall; late blocked history; no global current-generation erasure; actual role restrictions and physical cleanup/restore. Qualify real subscription readback and native delivery on an explicitly allocated disposable installation; never uninstall protected rewrite-dev or repeat consumed effects. Until those pass, retain the native HOLD and state exactly which prospective source behavior is implemented.

## Concrete adapter surface and existing-installation transition

Proposed narrow Shopify adapter signatures (server-only, using the existing verified online grant; do not accept browser-selected tenant/shop/callback):

```ts
type LifecycleSubscription = {
  id: string; topic: 'APP_UNINSTALLED'; uri: string;
};
createUninstallSubscription(input: {
  shop: string; accessToken: string; uri: string;
}): Promise<LifecycleSubscription>;
readUninstallSubscription(input: {
  shop: string; accessToken: string; id: string;
}): Promise<LifecycleSubscription | null>;
findUninstallSubscriptions(input: {
  shop: string; accessToken: string; uri: string;
}): Promise<LifecycleSubscription[]>;
```

Exact pinned operations:

```graphql
mutation LifecycleSubscribe($uri: String!) {
  webhookSubscriptionCreate(
    topic: APP_UNINSTALLED,
    webhookSubscription: {uri: $uri, format: JSON}
  ) {
    webhookSubscription {id topic uri}
    userErrors {field message}
  }
}
query LifecycleReadback($id: ID!) {
  webhookSubscription(id: $id) {id topic uri}
}
query LifecycleSettle($uri: String!, $after: String) {
  webhookSubscriptions(first: 100, after: $after,
    topics: [APP_UNINSTALLED], uri: $uri) {
    nodes {id topic uri}
    pageInfo {hasNextPage endCursor}
  }
}
```

The pinned `WebhookSubscriptionInput.uri` is `String`; URL shape is independently validated by the adapter. Validate no GraphQL/user errors, exact APP_UNINSTALLED/topic+URI, ID shape, bounded complete pagination and duplicate ambiguity; no fresh create on an unresolved outcome. The pinned mutation advertises no additional operation-specific scope requirement. Reuse the existing authorized grant; this research grants no scope and does not promise a runtime permission result.

For the already-installed current generation, qualify its current verified online `currentAppInstallation`/shop identity and the existing local generation, then provision and arm a fresh binding for that exact generation. Preserve all prior generic pending obligations. Generic duplicates may be linked to a subsequently authoritative callback's same signed body/shop and recorded routing observation for accounting, but they must not independently deactivate and must not be marked processed/stale solely from unsigned IDs/times. Resolve them through a separate immutable lifecycle decision describing which effects were already applied and which retained payload/queue cleanup obligations remain. Distinct identical-body receipts and historical lifecycle generations retain their original identity.

Historical inactive generations can be included in a new privacy decision only when their inactivity is already independently established; do not retrofit a new capability onto their old generic receipts. For a delayed authoritative uninstall arriving after an original `SHOP_ERASURE_BLOCKED`, append a separate recovery decision linking that original receipt, exact capability-bound generation and its independently observed state. Preserve the original blocked record, never widen the target set to a newer generation. Qualifying whether this later evidence proves inactivity before the original privacy collection is essential: receipt arrival order or an unsigned trigger time cannot establish it. If the strict original-collection rule cannot be proved, the prospective state machine needs a deliberately reviewed later authority decision for the now-independently inactive generation, not a false claim about its past state.

An unattended registration-race solution can use a second explicit authority class: `DISPATCHED_CAPABILITY_CALLBACK_CONFIRMED`, rather than fabricating provider subscription readback. Its admission requires durable fixed-topic exact-URI dispatch intent, proof that dispatch crossed the boundary, a unique never-exposed destination and a genuine raw-HMAC/Shop-valid callback on that destination. This callback proves a successful route to the declared topic under the bearer-capability model; it does not recover a subscription ID. Freeze that distinction and independently review it. Neither a local prepared intent alone nor an incoming generic callback is sufficient. This provides a concrete route for immediate uninstall/response loss without requiring a revoked-token readback; if the security review rejects callback-as-settlement under the stated capability threat model, the race remains a real missing authority rather than an automatic retry opportunity.
