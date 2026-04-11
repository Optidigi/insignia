# Architecture

This document is the system-level map: who talks to whom, what must be verified, and where data lives.

## Components

- **Dashboard**: Shopify embedded admin app (iframe) that calls backend `/admin/*` using App Bridge session tokens.
- **Storefront modal**: Theme App Extension + App Embed Block that calls backend via App Proxy (`/apps/insignia/*`) and uses Shopify AJAX Cart API.
- **Backend**: Node.js + TypeScript API that verifies admin session tokens, App Proxy signatures, and webhook signatures; persists state in Postgres; stores assets in R2.

## Trust boundaries

- `/admin/*` is **authenticated** by verifying Shopify session tokens.
- `/apps/insignia/*` is **storefront public** and must verify the App Proxy signature, enforce CORS + rate limiting.
- `/webhooks/*` must verify Shopify webhook signatures and be idempotent.

## Core flows (summary)

### Admin install & setup

- Merchant installs app → backend OAuth callback validates HMAC + `state`, exchanges `code` for access token, stores token encrypted.
- Merchant opens dashboard → dashboard uses App Bridge session tokens for `/admin/*` calls.

### Storefront customization & purchase (non‑Plus)

- Storefront modal loads config → buyer configures logo.
- Modal calls App Proxy `POST /apps/insignia/prepare` → backend reserves a variant pool slot and sets unit price.
- Modal uses Shopify AJAX Cart API to add/aggregate the slot variant.
- Modal calls App Proxy `POST /apps/insignia/cart-confirm`.
- Webhooks (`orders/create`, then `orders/paid`) finalize state and recycle slot.

### Logo Later (MVP)

- Buyer selects “I’ll provide later” → order is recorded as artwork pending.
- Dashboard provides template editing + copy helpers; automated sending is disabled (Coming soon).

## Interaction map (high level)

```text
Dashboard (Admin) ──(Authorization: Bearer session token)──▶ Backend (/admin/*)

Storefront Modal ──(App Proxy signed requests)──────────────▶ Backend (/apps/insignia/*)
Storefront Modal ──(AJAX Cart API)──────────────────────────▶ Shopify Cart

Backend ──(GraphQL/REST)────────────────────────────────────▶ Shopify Admin API
Backend ──(webhook receiver)────────────────────────────────▶ Shopify Webhooks

Backend ──(SQL)─────────────────────────────────────────────▶ PostgreSQL
Backend ──(S3 API)──────────────────────────────────────────▶ Cloudflare R2
```

## Canonical references

- Data schemas: [`data-schemas.md`](data-schemas.md)
- API contracts: [`api-contracts/`](api-contracts/)
- Variant pool pricing: [`variant-pool/overview.md`](variant-pool/overview.md)
- Legacy full reference: `developer-reference-implementation.full.md` (legacy, not in this repo)
