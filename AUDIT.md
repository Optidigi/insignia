# Insignia — Production Readiness Audit

> **Date**: 2026-04-13
> **Version**: `0.2.1` (phase1-hardening — commit `2937802`)
> **Overall**: Core product is functional and deployed. Phase 1 hardening complete: rate limiting, cron cleanup, test coverage (partial), CI quality gate, admin UX fixes, storefront URL normalization. Remaining gaps are in merchant-facing flows and operational monitoring.

---

## Quick Status

| Area | Status | Notes |
|---|---|---|
| Core product flow | ✅ Working | Upload → placement → size → review → order |
| Admin dashboard | ✅ Working | Products, methods, orders, settings all functional |
| Storefront modal | ✅ Working | App proxy, CORS, CSP all resolved |
| Database | ✅ Solid | 18 models, migrations applied, immutability enforced |
| Storage (R2) | ✅ Working | Server-side upload + presigned PUT for tray images |
| Docker / CI/CD | ✅ Working | Auto-deploy on push to main |
| Theme extension | ✅ Deployed | Customize button block live (`insignia-6`) |
| Variant pool pricing | ✅ Implemented | Self-healing, UNLISTED status, inventory disabled |
| Error handling | 🟡 Partial | Global handler in place; some edge cases unhandled |
| Monitoring | 🟡 Partial | Sentry installed; DSN may not be set on VPS |
| Tests | 🟡 Partial | Variant pool, storefront-prepare, cron-cleanup covered |
| Order webhooks | ❌ Blocked | Requires Shopify "protected data" approval |

---

## Section Index

1. [Blockers](#1-blockers)
2. [Backend — High Priority](#2-backend--high-priority)
3. [Backend — Medium Priority](#3-backend--medium-priority)
4. [Frontend / UI — High Priority](#4-frontend--ui--high-priority)
5. [Frontend / UI — Medium Priority](#5-frontend--ui--medium-priority)
6. [Feature Backlog](#6-feature-backlog)
7. [V3 / Future](#7-v3--future)
8. [Infrastructure & DevOps](#8-infrastructure--devops)
9. [Completed](#9-completed)
10. [Priority Order](#10-priority-order)

---

## 1. Blockers

These will cause real problems with live orders and must be resolved before scaling or App Store listing.

### 1.1 Order webhooks are disabled
**File**: `shopify.app.insignia.toml`

Order webhooks (`orders/paid`, `orders/updated`, etc.) are commented out — Shopify requires "protected customer data" approval before these topics can be subscribed to. The `OrderLineCustomization` model and handler code both exist; they just can't fire.

**Without this**: Order fulfillment data is never populated automatically. Merchants can't see artwork status update on order paid.

**Steps:**
1. Partners Dashboard → App → API access → Request protected customer data
2. Once approved, uncomment webhook subscriptions in `shopify.app.insignia.toml`
3. `shopify app deploy --config insignia`

---

### 1.2 Test coverage is partial
Unit tests added for variant pool, storefront-prepare, and cron-cleanup (phase1). Core order binding, storefront-config, and webhook idempotency remain untested.

**Still needed:**
- Unit: `storefront-config.server.ts` — config shape, placement resolution
- Integration: `POST /apps/insignia/prepare` — full round-trip
- Integration: `POST /apps/insignia/cart-confirm` — order binding
- Integration: webhook idempotency under duplicate delivery

---

### ~~1.3 Variant slot expiry has no scheduled cleanup~~ ✅ Resolved (phase1)
`POST /api/admin/cron/cleanup-slots` endpoint added. VPS cron setup instructions in `docs/ops/cron-setup.md`. Bearer-token auth via `lib/cron-auth.server.ts`.

---

## 2. Backend — High Priority

### 2.1 Sentry DSN not confirmed on VPS
`@sentry/node` is installed and wired in `server.mjs` but `SENTRY_DSN` may not be set in the VPS `.env`. Without it all production errors are silently swallowed — you only find out when a merchant complains.

**Fix**: SSH to VPS, confirm `SENTRY_DSN` is set. 5-minute task.

---

### ~~2.2 No rate limiting on storefront endpoints~~ ✅ Resolved (phase1)
Per-shop rate limiting via `checkRateLimit()` applied to all storefront proxy routes (`/prepare`, `/upload`, `/config`, `/price`, `/cart-confirm`, `/customizations`).

---

### ~~2.3 `CustomizationDraft` records accumulate indefinitely~~ ✅ Resolved (phase1)
`POST /api/admin/cron/cleanup-drafts` endpoint added. Deletes drafts older than 24 h. VPS cron setup in `docs/ops/cron-setup.md`.

---

### 2.4 No merchant email notification on new orders
When a customer completes a customized checkout, the merchant gets no automated alert beyond standard Shopify order emails. The `emailReminderTemplate` field exists on `MerchantSettings` but is unused.

**Fix**: Trigger an email (Shopify Email API or transactional provider like Resend/Postmark) when `OrderLineCustomization` is created via `cart-confirm`.

---

### 2.5 Order production status has no lifecycle transitions
`artworkStatus` and `productionStatus` fields exist on `OrderLineCustomization` but there is no API or UI to transition them (received → in-production → shipped). The fields are stored but never updated after order creation.

**Fix**: Backend endpoints `PATCH /api/admin/orders/:id/status` to update both fields, consumed by the new UI controls (see §4.1).

---

### 2.6 Webhook retry idempotency is untested under duplicate delivery
The `WebhookEvent` deduplication table exists but the behavior under duplicate delivery (Shopify retries on 5xx) is untested. A failed handler that partially processes an order before throwing could result in partial state with the duplicate being rejected.

**Fix**: Integration test covering duplicate delivery + partial failure scenario.

---

## 3. Backend — Medium Priority

### 3.1 Multi-image support per view is unimplemented
Currently one image per variant-view cell. Some products (jacket front with collar, sleeve inset) need multiple separate images composited together. The canvas renderer supports layers in theory but the data model and upload flow don't.

---

### ~~3.2 `docs/core/api-contracts/storefront.md` diverges from implementation~~ ✅ Resolved (phase1)
Spec updated to reflect server-side upload via `/apps/insignia/upload`.

---

### 3.3 No CDN for storefront modal assets
Storefront modal scripts load from `insignia.optidigi.nl` (single VPS, Netherlands). International customers see latency loading the modal JS.

**Longer term**: Serve the modal bundle from Cloudflare Pages or R2 + Workers.

---

## 4. Frontend / UI — High Priority

### 4.1 No artwork download button on order detail
Merchants cannot retrieve the customer's uploaded logo. The file is in R2 and referenced in the DB — there is just no UI to get it. `getPresignedDownloadUrl()` already exists in `storage.server.ts`.

**Fix**: "Download artwork" button on the order detail page, generates a presigned R2 GET URL with `attachment` disposition.

---

### 4.2 No order production status controls
There is no way for the merchant to mark an order as "in production" or "shipped" from the admin. Status fields exist in the DB but are never updated.

**Fix**: Status badge + action buttons on the order detail page (tied to §2.5 backend endpoint).

---

### 4.3 Empty states are missing across the dashboard
When a merchant first installs the app — no products configured, no orders yet — most pages render blank or show a generic "No data" state. There is no onboarding guidance.

**Affected pages**: Products list, Methods list, Orders list.

**Fix**: Illustrated empty states with a clear call-to-action for each page.

---

### 4.4 Storefront modal has not been audited for mobile
The canvas is fixed-size. On narrow viewports (< 400px) the modal likely overflows or crops. No responsive audit has been done.

**Fix**: Responsive canvas scaling + layout audit on 375px and 390px viewports.

---

### 4.5 View Editor right panel UX decision unresolved
**File**: `docs/notes/open-work.md`

Three design options are documented (A: tabs, B: expand/collapse, C: overview-first) but no decision has been made. The current implementation uses option A as a placeholder.

---

### 4.6 Logo sizing UX decision unresolved
**File**: `docs/notes/open-work.md`

Stepped size tiers vs. fixed-size-per-zone vs. both — no decision made. Current implementation exposes stepped size tiers from the placement definition.

---

## 5. Frontend / UI — Medium Priority

### 5.1 No storefront artwork re-upload on review step
Once a customer reaches the review step they cannot change their logo without pressing Back through all previous steps. A "Change artwork" shortcut on the review step would significantly reduce drop-off.

---

### 5.2 Placement editor lacks zoom / pan
Large product images are difficult to work with at the current fixed canvas scale. Merchants configuring placement zones on detailed images have no way to zoom in.

**Fix**: Konva stage `draggable` + mouse wheel zoom (Konva supports this natively).

---

### 5.3 Orders page: no filter by artwork status
Once there are 50+ orders, merchants need to find "pending artwork" quickly. Currently the orders page has no filtering.

**Fix**: Polaris `Filters` component on the orders page filtering by `artworkStatus`.

---

### 5.4 Orders page: CSV export has no UI trigger
The export endpoint (`/api/admin/orders/export`) exists but there is no button in the UI to call it.

**Fix**: "Export CSV" button on the orders page header.

---

### 5.5 No admin preview of the storefront modal
Merchants can't see what the customer will experience without going to a live storefront. A preview mode that renders the modal from the admin would save time during configuration.

---

### 5.6 Bulk product linking
Currently a product config can only be linked to product IDs one at a time. Merchants with many product variants in a range need bulk assignment.

---

### 5.7 Dashboard onboarding checklist for new merchants
A new merchant installing the app sees no guidance. A setup checklist ("Add a decoration method → Configure a product → Add the Customize block to your theme → Make a test order") would significantly improve time-to-value.

---

### 5.8 Image tray should use Polaris `<DropZone>`
The current hidden file input + programmatic `.click()` works in modern browsers but is fragile in iframe environments. Polaris `<DropZone>` would match the settings page pattern and provide drag-and-drop from the desktop.

---

### 5.9 Pricing bulk edit
Editing method and placement prices one-by-one is tedious for merchants with many placements. A batch edit table (inline editing) would improve the configuration experience.

---

### 5.10 Storefront translations: no preview
Merchants editing translation overrides in Settings have no way to see how the text looks in context inside the modal.

---

## 6. Feature Backlog

These are meaningful features that aren't currently built but would directly increase merchant value.

| Feature | Description |
|---|---|
| Customer artwork intake channel | Let merchants request artwork from customers post-order (email link to re-upload) |
| Multiple logo positions per order | Customer selects more than one placement in a single customization |
| Artwork approval workflow | Merchant reviews uploaded artwork before it enters production (approve / request revision) |
| Per-product pricing overrides | Override base method price per product, not just per placement |
| Reorder / duplicate product configs | Clone an existing config as a starting point for a new product |
| Storefront: saved customizations | Let returning customers retrieve and re-apply a previous customization |
| Merchant portal: production overview | Kanban or table view of all active orders grouped by artwork status |
| Analytics: conversion funnel | How many customers open the modal → upload → complete → checkout |
| Shopify Flow integration | Trigger merchant automations on `customization.completed` or `artwork.received` |

---

## 7. V3 / Future

| Feature | Notes |
|---|---|
| 3D product preview | Canvas-based 3D wrap simulation using Three.js or a Konva UV-map approach |
| Ruler calibration auto-detect | Detect real-world dimensions from product metadata instead of manual calibration |
| CJK / RTL locale support | Japanese, Arabic, Hebrew — requires RTL layout audit of the storefront modal |
| CDN for modal bundle | Serve the storefront JS from Cloudflare Pages instead of the single VPS |
| Multi-tenant SaaS mode | Separate billing tiers, usage limits, white-label theming per merchant |
| AI logo upscaling | Run uploaded logos through a super-resolution model before rendering |

---

## 8. Infrastructure & DevOps

### ~~8.1 CI pipeline has no lint/typecheck gate~~ ✅ Resolved (phase1)
`Typecheck & Lint` job added to `.github/workflows/docker-publish.yml`. Docker build only runs if quality gate passes. CI runs on Node 22 to match Dockerfile.

---

### 8.2 No staging environment
There is no staging deploy between local dev and production. All fixes are tested locally then deployed live.

**Recommended**: A second VPS compose stack (or a Fly.io/Render preview deploy) that auto-deploys from `main` but points at a separate database and Shopify dev store.

---

### 8.3 `SETUP.md` and README overlap
Both cover local setup. Consider making `SETUP.md` the canonical detailed reference and README a quick-start pointer.

---

### 8.4 `package.json` missing `repository` and `homepage` fields
Minor metadata gap — useful for `npm audit` source resolution and GitHub dependency tooling.

---

## 9. Completed

Everything below was identified as a problem and resolved prior to this audit date.

- ✅ App proxy URL forwarding (Shopify strips prefix before forwarding)
- ✅ CORS for cross-origin ES module loading (Cloudflare tunnel → myshopify.com)
- ✅ CSP `frame-ancestors` missing when `?shop` absent in request URL
- ✅ `X-Frame-Options: SAMEORIGIN` on theme editor — now uses `window.open(url, "_top")`
- ✅ R2 CORS policy for presigned PUT (bucket-level policy added in Cloudflare dashboard)
- ✅ 405 on "Add first view" — `useSubmit()` replaces native `<form>` in embedded iframe
- ✅ 500 on storefront `/config` — `AppError` catch now handles all status codes, not just 404
- ✅ Double file picker on image tray — `<label>` wrapper removed, direct `onClick` used
- ✅ MIME type allowlist on tray-upload endpoint (security)
- ✅ R2 storage key extension sanitisation (path injection prevention)
- ✅ `use_theme_style` toggle default changed to `false`
- ✅ Fee products created as `UNLISTED` (hidden from collections, search, recommendations)
- ✅ Geometry snapshot immutability enforced via Postgres `BEFORE UPDATE` trigger
- ✅ Webhook idempotency via `WebhookEvent` deduplication table
- ✅ SVG sanitisation via DOMPurify + JSDOM before R2 storage
- ✅ Artwork download button on order detail — presigned GET URL via `getPresignedDownloadUrl()`, rendered at `app/routes/app.orders.$id.tsx:785`
- ✅ CSV export UI button — Export CSV button at `app/routes/app.orders._index.tsx:255` calling `/api/admin/orders/export`
- ✅ Order production status API — `advance-status` intent handler in `app/routes/app.orders.$id.tsx:380`
- ✅ Order production status UI controls — per-line action buttons in `app/routes/app.orders.$id.tsx:833`
- ✅ Rate limiting on all storefront endpoints — `checkRateLimit()` in `lib/storefront/rate-limit.server.ts`
- ✅ Cron cleanup: variant slots — `POST /api/admin/cron/cleanup-slots`, VPS setup in `docs/ops/cron-setup.md`
- ✅ Cron cleanup: abandoned drafts — `POST /api/admin/cron/cleanup-drafts`, bearer-token auth
- ✅ CI lint/typecheck quality gate — `Typecheck & Lint` job in `docker-publish.yml` (Node 22)
- ✅ Partial test coverage — variant pool, storefront-prepare, cron-cleanup unit tests added (`app/lib/services/__tests__/`)
- ✅ Storefront spec corrected — `docs/core/api-contracts/storefront.md` updated to match server-side upload implementation
- ✅ Admin button popup blocker fix — `setTimeout(() => window.open(...), 0)` on all external-link actions
- ✅ View editor: inline rename, delete-with-confirmation, create-view on same page (405 fix)
- ✅ Storefront modal base URL derived from request origin — never stale on tunnel rotation (`app/root.tsx`, `apps.insignia.modal.tsx`)
- ✅ Storefront URL uses numeric IDs — GID extracted before building `customizerUrl` to avoid App Proxy routing failure
- ✅ Canvas centering fix in storefront modal
- ✅ Fee product UNLISTED fix — removed invalid `seo`/`productType` fields from `fix-fee-products` mutation
- ✅ Timing-safe cron auth — constant-time token comparison in `lib/cron-auth.server.ts`

---

## 10. Priority Order

| # | Item | Section | Effort | Impact |
|---|---|---|---|---|
| 1 | Apply for Shopify protected data access | §1.1 | Low (form) | 🔴 Critical |
| 2 | Confirm `SENTRY_DSN` on VPS | §2.1 | 5 min | 🔴 Critical |
| 3 | Complete test coverage (config, cart-confirm, webhooks) | §1.2 | 2–3 days | 🟡 High |
| 4 | Merchant email notification on new order | §2.4 | 4–6 h | 🟡 High |
| 5 | Empty states + onboarding checklist | §4.3, §5.7 | 1 day | 🟡 High |
| 6 | Storefront mobile layout audit | §4.4 | 4–6 h | 🟡 High |
| 7 | View Editor UX decision + implementation | §4.5 | 1–2 days | 🟡 High |
| 8 | Logo sizing UX decision | §4.6 | 1 day | 🟡 High |
| 9 | Orders filter by artwork status | §5.3 | 2–3 h | 🟢 Medium |
| 10 | Storefront artwork re-upload shortcut | §5.1 | 3–4 h | 🟢 Medium |
| 11 | Placement editor zoom/pan | §5.2 | 2–3 h | 🟢 Medium |
| 12 | Staging environment | §8.2 | 1 day | 🟢 Medium |
| 13 | Multi-image support per view | §3.1 | 2–3 days | 🟢 Medium |
