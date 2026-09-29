# PR #23 principal review — CHANGES_REQUESTED

## Binding

- Repository: `Optidigi/insignia`
- PR: `#23`
- Base/effective merge base: `86c466a9709b67f85601596fb7656857cc20a9cc`
- Reviewed head: `ae12f3474a277165be68b2eeee226865976ba56e`
- Reviewed tree: `0e5398f9eddb6c03774e2f1edaebba7c9eb529bd`
- Synthetic merge: `7dfa39909f5aac77f821a2d28b38f357fc16e481`
- Synthetic merge parents: exact base + reviewed head
- Synthetic merge tree: exact reviewed tree

PR #22 normal merge `86c466a9709b67f85601596fb7656857cc20a9cc` has the exact approved parents and tree.

The native GitHub REQUEST_CHANGES attempt returned HTTP 403 and was not posted. This file is the external principal verdict.

## Principal direction

M3-002 remains unaccepted at the reviewed head, but the required correction is **not** to invent an independent second webhook authentication mechanism.

The original M3-002 requirement over-tightened Shopify's supported HTTPS webhook trust contract.

Cryptographic fact: Shopify's HMAC is computed over the raw body, not the routing headers.

Platform-contract fact: Shopify documents the webhook headers as the topic, shop, delivery ID and trigger time for the delivery, documents Webhook-Id as the delivery idempotency key, and its official `authenticate.webhook(request)` returns `topic`, `shop`, `webhookId` and related metadata after verifying the webhook. Shopify's own APP_UNINSTALLED examples switch on that returned topic.

Insignia will therefore use this explicit trust boundary:

> After a request reaches Insignia through its controlled HTTPS ingress and the Shopify raw-body HMAC verifies under the configured app-secret ring, bounded Shopify webhook routing headers are trusted provider metadata for that authenticated delivery. They are not claimed to be separately HMAC-bound.

For destructive lifecycle actions, Insignia additionally requires the signed Shop payload identity to match the stored Shopify Shop identity/domain.

This matches the supported Shopify webhook model and avoids a bespoke per-install callback secret, Pub/Sub, EventBridge, or another authentication system solely to re-sign Shopify's routing metadata.

## Accepted residual

The application does not defend against an attacker who has obtained valid authenticated webhook request material (raw body + HMAC) and can inject altered Shopify routing headers inside the trusted HTTPS/ingress boundary.

That residual is accepted because external callers without the app secret cannot mint a valid HMAC body; exact replays retain the provider Webhook-Id and are durably deduplicated; raw body/HMAC are not logged by Insignia; and compromise or disclosure inside the trusted TLS termination/proxy path is a deployment/security-boundary failure, not a second webhook protocol the app must invent around.

M10 must retain deployment checks that prevent raw webhook/HMAC logging and untrusted header rewriting.

## Why the current quarantine is inconsistent

The current implementation already uses provider routing headers to key durable delivery identity by shop domain + Webhook-Id, reject duplicate deliveries whose topic/time/body change, use Triggered-At to fence pre-install/old-generation delivery, and bind a first-seen delivery to the current installation generation.

It then refuses only the final uninstall action because those same headers are not body-HMAC-bound. Under the accepted Shopify trust boundary, that final quarantine is no longer required.

## Required M3-002R correction

For a delivery that passed raw-body HMAC verification, has provider topic `app/uninstalled`, has a parsed signed Shop ID matching the stored Shopify Shop ID, has signed `myshopify_domain` null or matching routing shop, and resolves to the current active installation generation under the existing Webhook-Id / Triggered-At rules, `processUninstall` must atomically:

1. call the existing generation-scoped `deactivateCurrent`;
2. revoke/clear credentials through the existing deactivation path;
3. clear generation-dependent effective publication pointers as already implemented;
4. mark the same inbox row processed;
5. return an idempotent success result.

If the generation became stale during the transaction, it must not deactivate the newer generation. Mark the old delivery stale/processed as appropriate.

Remove `unverified_uninstall_headers` for an otherwise valid current delivery. Retain `unverified_shop_identity` quarantine for body Shop-ID/domain mismatch.

Keep the existing `assertSame` rule: the same `(shop_domain, webhook_id)` cannot be replayed with different topic, API version, trigger time, name/event ID, body hash or body bytes.

Treat `X-Shopify-Webhook-Id` as the provider idempotency key. Do not replace it with `X-Shopify-Event-Id`.

Retain first-seen generation binding, existing-bound-delivery staleness after reinstall, Triggered-At fencing for a previously unseen old delivery, and preinstall uninstall not binding to a later installation.

### Tests required

Add/update real PostgreSQL + worker + built HTTP tests for:

- valid current `app/uninstalled` deactivates the current generation;
- credential becomes inactive/revoked;
- generation-bound outbox is no longer claimable;
- publication/effective state remains fenced;
- inbox becomes processed atomically;
- exact duplicate is idempotent;
- same Webhook-Id with changed topic fails conflict;
- same Webhook-Id with changed Triggered-At fails conflict;
- same Webhook-Id with changed body fails conflict;
- a `shop/update` delivery with a Shop-shaped body does not uninstall;
- signed Shop-ID mismatch remains quarantined;
- preinstall uninstall remains stale;
- old uninstall after reinstall cannot deactivate the new generation;
- worker retry/crash keeps the tested business fact single.

## Documentation

Add `docs/architecture/SHOPIFY-WEBHOOK-TRUST-BOUNDARY.md` documenting the body-only HMAC fact, trusted HTTPS + verified webhook context rule, trusted routing metadata, signed Shop identity cross-check, accepted altered-header replay residual, no raw body/HMAC logging, and M10 deployment review obligation.

Reference it from the M3-002 review packet/state. Do not bump or rewrite the v1.3 plan/ledger solely for this clarification unless governance checks require it.

## Other reviewed M3-002 work

No other merge-blocking issue was identified in the reviewed scope. The identity-preserving inbox, PostgreSQL active-generation fences, AES-256-GCM credential envelopes, missing-key/tamper failure, serialized refresh claims/CAS replacement, lost-response recovery, bounded refresh transport, pg-boss 12.35.0/schema 43 runtime, Pino allowlist/redaction, bounded Prometheus labels, durable readiness, and handoff-before-2xx behavior are materially in shape.

## Final-head evidence reviewed

All 10 final-head workflows reported success. M3-002 runtime run `36618321748` includes 31 PostgreSQL database tests, 16 Shopify adapter tests, application and observability tests, 14 worker tests, built HTTP ingress/handoff tests, and migration down/up rehearsal.

The inherited local Polaris visibility failure is not a PR #23 blocker because the exact final-head foundation workflow passed with its pinned browser dependencies.

## Verdict

CHANGES_REQUESTED.

Keep PR #23 open and make this correction in the same PR.

No merge, M4 start, gate pass, production protocol adoption, deployment or live Shopify/provider operation is authorized.
