# Authentication & verification (canonical)

This file defines the authentication/verification requirements for each API surface.

## Admin (embedded dashboard)

- Dashboard runs inside Shopify Admin (iframe) and uses App Bridge session tokens.
- Dashboard calls backend `/admin/*` endpoints with `Authorization: Bearer <shopify_session_token>`.
- Backend MUST verify the session token on every admin request.

## Storefront (App Proxy)

- Storefront calls backend through Shopify App Proxy paths (e.g., `/apps/insignia/*`).
- Backend MUST verify the App Proxy signature and resolve the `shop`.
- Backend MUST enforce rate limiting and a strict CORS allowlist for storefront endpoints.

## Webhooks

- Shopify webhooks call backend `/webhooks/*`.
- Backend MUST verify webhook signatures.
- Webhook handlers MUST be idempotent.

## OAuth installation flow (admin)

This is the canonical, concise statement of the install flow:

- Backend MUST validate request authenticity using Shopify HMAC on OAuth callback requests.
- Backend MUST validate a `state` nonce to prevent CSRF.
- Backend exchanges `code` for an Admin API access token.
- Backend stores the access token in the database via `PrismaSessionStorage`. Tokens are currently stored **plaintext** — application-layer encryption is an open decision (see `docs/notes/open-work.md`). Risk is bounded by VPS firewall + DB access controls.
- After install, embedded admin UI uses App Bridge session tokens for per-request authorization.

If you need the detailed step-by-step walkthrough and example encryption code, see:

- `developer-reference-implementation.full.md` (legacy, not in this repo)

See also:

- [`architecture.md`](architecture.md)
- [`api-contracts/webhooks.md`](api-contracts/webhooks.md)
