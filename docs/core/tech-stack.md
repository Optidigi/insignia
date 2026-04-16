# Tech stack (canonical)

> **Last verified**: 2026-04-10

These are the fixed stack decisions for Insignia.

## Runtime

- Node.js 20.19+ or 22.12+ (LTS).
- TypeScript (strict mode).

## Shopify admin app

- React 18 + React Router 7 (`@shopify/shopify-app-react-router`).
- Shopify Polaris v13 for all admin UI.
- Shopify Admin GraphQL API version `2026-04`.

## Database

- PostgreSQL via Prisma ORM.
- Prisma migrations required for all schema changes (`npx prisma migrate dev`).
- Schema source of truth: `prisma/schema.prisma`.

## Canvas rendering

- Konva.js for 2D placement editing (admin View Editor) and size preview (storefront).

## Object storage

- Cloudflare R2 (S3-compatible API) for uploaded logos, product view images, and generated assets.

## Storefront delivery

- Theme App Extension + App Embed Block for loading the customizer.
- App Proxy at `/apps/insignia/*` for all storefront endpoints.
- Avoid ScriptTag-based injection patterns.

## Storefront pricing (non-Plus)

- Method-based UNLISTED fee products + variant pool slots.
- App Proxy `/prepare` endpoint + AJAX Cart API quantity aggregation.

## Validation

- Zod for runtime validation at system boundaries.
- TypeScript types for internal contracts.

## Email policy

- Merchant email notifications are implemented via [Resend](https://resend.com) in `app/lib/services/merchant-notifications.server.ts`.
- Gated behind `RESEND_API_KEY` env var — if absent, notifications are silently skipped and the app behaves normally.
- Storefront-to-customer emails are deferred to a future version.
