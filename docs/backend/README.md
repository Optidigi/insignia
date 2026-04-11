# Backend (setup + operations)

This doc captures the minimum required setup and operational notes for backend developers.

## Stack

See canonical stack decisions:

- [`../core/tech-stack.md`](../core/tech-stack.md)

## Required services

- PostgreSQL 16.x
- Object storage (Cloudflare R2)

### R2 CORS (browser uploads)

For **direct browser uploads** (e.g. view images via presigned PUT URLs), the R2 bucket must have a CORS policy that allows your app origin and `PUT` with `Content-Type`. Otherwise the browser’s OPTIONS preflight gets **403** and uploads fail.

See **[R2 CORS setup](r2-cors.md)** for the exact JSON and steps.

## Start order (recommended)

1. Start PostgreSQL.
2. Start backend API.
3. Start background worker for jobs (Postgres-backed).

## Deployment notes

This section captures operational requirements needed for production.

### Data

- PostgreSQL migrations MUST run before serving traffic.
- Background workers MUST run for:
  - variant pool maintenance jobs

## Implementation order (parallel work)

This section exists to enable parallel work without stepping on each other.

### Suggested sequence

1. Implement auth verification middleware for:
   - admin session tokens
   - App Proxy signature
   - webhook signature
2. Implement core persistence for:
   - ProductConfig / ProductView / Viewport
3. Implement variant pool endpoints:
   - `/apps/insignia/prepare`
   - `/apps/insignia/cart-confirm`
4. Implement webhook finalization:
   - orders/create
   - orders/paid

## Canonical references

- Admin API: [`../core/api-contracts/admin.md`](../core/api-contracts/admin.md)
- Storefront API: [`../core/api-contracts/storefront.md`](../core/api-contracts/storefront.md)
- Webhooks: [`../core/api-contracts/webhooks.md`](../core/api-contracts/webhooks.md)
- Variant pool maintenance jobs: [`../core/variant-pool/implementation.md`](../core/variant-pool/implementation.md)
