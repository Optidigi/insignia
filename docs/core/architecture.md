# Architecture

> **Last verified**: 2026-04-23

This document is the system-level map: who talks to whom, what must be verified, and where data lives.

## Components

- **Dashboard**: Shopify embedded admin app (iframe) that calls backend `/api/admin/*` JSON endpoints and uses React Router page loaders/actions under `app.*` routes. Auth via App Bridge session tokens.
- **Storefront modal**: Theme App Extension + App Embed Block that calls backend via App Proxy (`/apps/insignia/*`) and uses Shopify AJAX Cart API.
- **Order block extension**: Shopify Admin UI extension (`extensions/insignia-order-block/`) targeting `admin.order-details.block.render`. Renders in the native Shopify Admin order detail page. Fetches preview data from `GET /api/admin/order-block/:orderId`.
- **Backend**: Node.js + TypeScript API that verifies admin session tokens, App Proxy signatures, and webhook signatures; persists state in Postgres; stores assets in R2.

## Trust boundaries

- `/api/admin/*` and `app.*` page routes are **authenticated** by verifying Shopify session tokens via `authenticate.admin(request)`.
- `/apps/insignia/*` is **storefront public** and must verify the App Proxy signature, enforce CORS + rate limiting.
- `/webhooks/*` must verify Shopify webhook signatures and be idempotent.
- The order block extension authenticates via admin session (same trust boundary as the dashboard).

## Core flows (summary)

### Admin install & setup

- Merchant installs app → backend OAuth callback validates HMAC + `state`, exchanges `code` for access token, stores token.
- Merchant opens dashboard → React Router routes use `authenticate.admin(request)` for all `/api/admin/*` and page loader calls.

### Storefront customization & purchase (non‑Plus)

- Storefront modal loads config → buyer configures logo.
- Modal calls App Proxy `POST /apps/insignia/customizations` → draft persisted.
- Modal calls App Proxy `POST /apps/insignia/prepare` → backend reserves a variant pool slot and sets unit price.
- Modal uses Shopify AJAX Cart API to add/aggregate the slot variant.
- Modal calls App Proxy `POST /apps/insignia/cart-confirm`.
- Webhooks (`orders/create`, then `orders/paid`) finalize state and recycle slot.

### Logo Later (MVP)

- Buyer selects "I'll provide later" → order is recorded as artwork pending.
- Dashboard provides template editing + copy helpers; automated sending is disabled (Coming soon).

## Interaction map

```text
Dashboard (Admin) ──(Authorization: Bearer session token)──▶ Backend (/api/admin/*)
Dashboard (Admin) ──(React Router loaders/actions)──────────▶ Backend (app.* page routes)

Order Block Ext.  ──(Admin session token)────────────────────▶ Backend (/api/admin/order-block/:id)

Storefront Modal  ──(App Proxy signed requests)──────────────▶ Backend (/apps/insignia/*)
Storefront Modal  ──(AJAX Cart API)──────────────────────────▶ Shopify Cart

Backend ──(GraphQL/REST)────────────────────────────────────▶ Shopify Admin API
Backend ──(webhook receiver)────────────────────────────────▶ Shopify Webhooks

Backend ──(SQL)─────────────────────────────────────────────▶ PostgreSQL
Backend ──(S3 API)──────────────────────────────────────────▶ Cloudflare R2
```

## Canonical references

- Data schemas: [`data-schemas.md`](data-schemas.md)
- API contracts: [`api-contracts/`](api-contracts/)
- Variant pool pricing: [`variant-pool/overview.md`](variant-pool/overview.md)
