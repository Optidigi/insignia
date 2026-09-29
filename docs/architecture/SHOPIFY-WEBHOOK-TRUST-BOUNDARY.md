# Shopify webhook trust boundary

Status: principal-directed M3-002R correction on PR #23. This records the accepted webhook trust rule; it does not amend the v1.3 plan or decision ledger or qualify a production deployment.

## Authenticated delivery

Insignia accepts a Shopify webhook only through its controlled HTTPS ingress. The ingress verifies the HMAC of the **exact raw request body** under the configured current or previous app-secret ring before database or queue handoff. It bounds and normalizes the required Shopify headers. The HMAC covers body bytes only; it does **not** separately sign the routing headers.

Within that verified ingress context, `X-Shopify-Topic`, `X-Shopify-Shop-Domain`, `X-Shopify-Webhook-Id`, `X-Shopify-Triggered-At`, `X-Shopify-API-Version`, and optional Event-Id/Name are trusted Shopify delivery metadata. `X-Shopify-Webhook-Id`, paired with shop domain, is the stable delivery identity. Reuse with a changed topic, version, time, optional metadata, body hash or body bytes is a hard conflict. Event-Id is not substituted as the idempotency key.

For `app/uninstalled`, the signed Shop object must contain a valid Shop ID matching the stored Shopify Shop ID. Its `myshopify_domain` must be null or match the routed shop domain. A mismatch is durably quarantined as unverified and cannot deactivate the installation. A current verified delivery binds to one installation generation. Triggered-At fences first-seen preinstall or old-generation deliveries; a previously bound delivery keeps its generation through reinstall. The inbox completion and current-generation deactivation, including credential revocation and publication/outbox fencing, commit in one transaction. Exact replay is idempotent.

## Accepted residual and deployment checks

An attacker with disclosed valid authenticated request material (raw body and HMAC), or control inside the trusted TLS termination/ingress path, could replay it with altered routing headers and change lifecycle interpretation. This is an accepted boundary residual, not a claim that headers are cryptographically bound to the body. Insignia does not add a second webhook authentication protocol for these headers.

M10 must verify TLS termination and proxy/header integrity so untrusted clients cannot replace Shopify routing metadata inside the trusted path. It must verify that raw webhook bodies and HMAC values are never logged, including error and proxy logs. Local M3-002R tests exercise the application behavior with synthetic requests and PostgreSQL; they do not establish those deployment properties.

Sources of this decision: [external PR #23 principal review](../delivery/PR-023-principal-review.md) and [authorized correction](../delivery/prompts/M3-002R-WEBHOOK-TRUST-CLOSURE.md).
