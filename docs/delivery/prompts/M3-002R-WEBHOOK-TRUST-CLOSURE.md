# M3-002R — Shopify authenticated-webhook trust closure

## Scope

Continue existing PR #23 only. Do not create a successor PR and do not merge.

The implementation is otherwise retained. The principal correction is to adopt Shopify's supported authenticated-webhook context instead of requiring an independent second authority for topic/install metadata.

## Trust contract

A Shopify HTTPS delivery is application-authenticated only when it reaches the controlled Insignia HTTPS ingress, the raw-body HMAC validates under the configured current/previous client-secret ring, and required Shopify routing headers pass existing bounds/normalization.

After those checks, treat these as trusted provider metadata for that authenticated delivery: X-Shopify-Topic, X-Shopify-Shop-Domain, X-Shopify-Webhook-Id, X-Shopify-Triggered-At, X-Shopify-API-Version, and optional Event-Id/Name.

Do not claim those fields are covered by the raw-body HMAC. For lifecycle effects additionally require the body-signed Shopify Shop ID and body myshopify_domain consistency already implemented.

## Code correction

Change the uninstall path so a resolved, authenticated `app/uninstalled` delivery deactivates its bound active generation atomically. The transaction must lock/resolve the same inbox delivery, confirm current generation/shop identity, call the existing generation-scoped deactivation operation, revoke credentials and fence generation-bound work through existing logic, mark the inbox row processed, and be idempotent.

A concurrent reinstall or already-newer generation must make the old delivery stale rather than deactivating the newer generation.

Remove the blanket `unverified_uninstall_headers` outcome. Keep the signed Shop-ID/domain mismatch quarantine.

## Delivery identity

Keep `(shop_domain, X-Shopify-Webhook-Id)` as the stable provider delivery key. For an existing key, every stored routing field and raw body must match exactly. Conflicting reuse is a hard conflict.

Keep Triggered-At generation fencing for previously unseen delayed/preinstall deliveries.

## Required tests

Use real PostgreSQL and the existing pg-boss/HTTP harness. Add tests for current uninstall deactivation, credential revocation, outbox/publication fencing, atomic inbox completion, exact replay idempotency, same-ID topic/time/body conflicts, Shop-shaped `shop/update` non-uninstall, Shop-ID mismatch quarantine, preinstall staleness, old uninstall after reinstall, and worker retry/crash single-fact behavior.

## Documentation

Add `docs/architecture/SHOPIFY-WEBHOOK-TRUST-BOUNDARY.md` with the principal trust rule and residual. M10 must verify TLS/proxy/header integrity and that raw webhook body/HMAC are not logged.

## Preserve / do not add

Preserve credential envelope, refresh claim/CAS, pg-boss queues/version, dbmate ownership, database boundaries, Option A and M2 semantics.

Do not add per-install callback secrets, EventBridge/PubSub, shop-specific webhook registration, live Admin confirmation, or polling merely to authenticate topic metadata.

## Verification

Run frozen install; PostgreSQL 18 M3 database tests; Shopify/application/observability tests; worker pg-boss tests; built HTTP ingress tests; all boundaries/secrets; pinned foundation workflow; retained M0 workflows.

Use fresh read-only Spec/correctness and Standards/security review against this principal trust model rather than re-imposing independent header signing.

## External boundary

Pure local/off-store only. No authenticated Shopify/provider calls, secret-file reads, preview/deployment, webhook registration, commerce/billing, R2, host-security change or legacy work.

## Return

Update existing PR #23 with exact new head/tree, trust-boundary decision, uninstall atomicity/replay/generation evidence, full final-head workflows and reviewer dispositions. Stop for principal review.

No merge or M4 work is authorized.
