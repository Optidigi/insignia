# Admin API contract (canonical)

> **Last verified**: 2026-04-23

This file documents the real backend surface consumed by the embedded dashboard.

The admin surface is split into two layers:
- **Page routes** (`app.*`) — React Router loader/action routes. The browser never calls these as JSON APIs; they are server-rendered or handle form submissions. Auth is handled automatically by `authenticate.admin(request)` from `@shopify/shopify-app-react-router`.
- **JSON API routes** (`api.admin.*`) — called from the dashboard frontend (and from external tools). All require `Authorization: Bearer <shopify_session_token>`.

## Authentication

All `api.admin.*` endpoints are authenticated via `authenticate.admin(request)` on every request. This handles:
- Session token validation (short-lived, auto-refreshed by App Bridge)
- Shop resolution from the token
- Tenant isolation (all queries scoped to the resolved shop)

Do not cache token validation. App Bridge issues a fresh token per request.

External reference: https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens

---

## Decoration Methods

### `GET /api/admin/methods`
Returns all decoration methods for the shop.

### `GET /api/admin/methods/:id` (`api.admin.methods.$id.tsx`)
Returns a single method + its variant pool stats.

### `POST /api/admin/methods` (action on `api.admin.methods.tsx`)
Create a new decoration method.

### `PUT /api/admin/methods/:id` (action on `api.admin.methods.$id.tsx`)
Update method fields.

### `DELETE /api/admin/methods/:id` (action on `api.admin.methods.$id.tsx`)
Delete a method and its variant pool (fee product + variants).

Canonical references: `../data-schemas.md` (DecorationMethod)

---

## Product Configuration

Product config CRUD is handled by **page route loaders and actions** under `app.products.*`, not standalone JSON API endpoints. The routes return page data (including config, views, placements, variant assignments) directly to the React component.

Key page routes:
- `app.products._index.tsx` — list all configs; create action also lives here
- `app.products.$id.tsx` — edit config metadata + manage linked products
- `app.products.$id.views.tsx` — views layout (wraps view editor with Outlet)
- `app.products.$id.views.$viewId.tsx` — view editor (placement geometry, step schedules, variant image assignment)

---

## Image Upload (Admin)

### `GET /api/admin/upload-url` (`api.admin.upload-url.tsx`)
Returns a presigned R2 PUT URL for direct browser-to-R2 image uploads (used for view images).

### `POST /api/admin/upload` (`api.admin.upload.tsx`)
Server-side multipart image upload (fallback / alternative path).

### `POST /api/admin/batch-upload-urls` (`api.admin.batch-upload-urls.tsx`)
Returns multiple presigned PUT URLs in one call (batch view image imports).

### `POST /api/admin/batch-save-images` (`api.admin.batch-save-images.tsx`)
Saves metadata for batch-uploaded images after the client has PUT them to R2.

### `POST /api/admin/import-shopify-images` (`api.admin.import-shopify-images.tsx`)
Imports product images from Shopify into the view image library (copies from Shopify CDN to R2).

---

## Artwork Upload (Orders)

### `POST /api/admin/artwork-upload` (`api.admin.artwork-upload.tsx`)
Uploads or attaches artwork to an order line customization. Transitions `artworkStatus` to `PROVIDED` and creates/updates the associated `LogoAsset`.

---

## Orders

Orders are rendered as **page routes** (Polaris Web Components):
- `app.orders._index.tsx` — order list with tabs (`all`, `awaiting`, `in-production`, `shipped`)
- `app.orders.$id.tsx` — order detail page (loader returns all data needed for rendering)
- `app.orders.$id.print.tsx` — printable order detail view
- `app.orders.bulk-advance.tsx` — action route: bulk-advance production status for selected lines
- `app.orders.export.tsx` — CSV export page route

### `GET /api/admin/orders/export` (`api.admin.orders.export.tsx`)
Returns orders data as a downloadable CSV stream.

### `GET /api/admin/order-block/:orderId` (`api.admin.order-block.$orderId.tsx`)
Data endpoint for the `insignia-order-block` Shopify Admin UI extension. Returns line preview data, placement geometry, logo asset URLs (presigned), and production status for all customized lines on the order. Auth is via the extension's admin session.

Asset download links in the order detail are **presigned R2 URLs** returned inline in the page loader response — there is no separate `/admin/logo-assets/:id/download` endpoint. URLs expire after 10 minutes; the frontend re-fetches the loader if an `<img>` returns 403.

Canonical references:
- `../data-schemas.md` (OrderLineCustomization, LogoAsset, OrderNote)
- `../../admin/orders-workflow.md`
- `../../admin/order-detail-rendering.md`
- `./webhooks.md`

---

## Cron Jobs

These endpoints are called by an external cron scheduler (not by the dashboard). They require `Authorization: Bearer <CRON_SECRET>` (not a session token).

### `POST /api/admin/cron/cleanup-slots` (`api.admin.cron.cleanup-slots.tsx`)
Recycles expired `RESERVED`/`IN_CART` variant slots back to `FREE`.

### `POST /api/admin/cron/cleanup-drafts` (`api.admin.cron.cleanup-drafts.tsx`)
Deletes stale `CustomizationDraft` records older than the TTL.

See `docs/ops/cron-setup.md` for scheduling setup.

---

## Placement Editor (Page Routes)

The placement editor (Konva canvas) runs inside `app.products.$id.views.$viewId.tsx` and persists via form actions on that route. Sub-intents handled:

- `reorder-placements` — reorders `PlacementDefinition.displayOrder` for a view
- `reorder-steps` — reorders `PlacementStep.displayOrder` for a placement
- `clone-layout` — copies placement geometry from one variant/view to another
- `save-geometry` — persists `PlacementGeometry` for a view

Canonical references:
- `../placement-editor.md`
- `../data-schemas.md` (PlacementDefinition, PlacementStep, PlacementGeometry)
