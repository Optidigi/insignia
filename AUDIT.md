# Insignia — Production Readiness Audit

> **Date**: 2026-04-14
> **Version**: 0.4.0 (phase3-audit-fixes)
> **Overall**: MVP-ready. Phase 1 + Phase 2 + Phase 3 complete. All critical security issues fixed (GDPR compliance, CORS, upload validation, webhook races). Server hardened with compression, security headers, body limits, expanded rate limiting. 45 tests across 7 files. Remaining gaps: order webhooks (blocked on Shopify approval), Sentry DSN verification, and UX design decisions for post-launch iteration.

---

## Quick Status

| Area | Status | Notes |
|---|---|---|
| Core product flow | Done | Upload, placement, size, review, order |
| Admin dashboard | Done | Products, methods, orders, settings all functional; empty states added |
| Storefront modal | Done | App proxy, CORS locked down, CSP expanded, mobile responsive, draft persistence |
| Database | Done | 18 models, GIN + B-tree indexes, onDelete policies, immutability trigger |
| Storage (R2) | Done | Server-side upload + presigned PUT; image dimension limits (4096px) |
| Docker / CI/CD | Done | Auto-deploy on push to main, lint/typecheck gate |
| Theme extension | Done | Customize button block live, config readiness guard |
| Variant pool pricing | Done | Self-healing, UNLISTED status, inventory disabled, slot rollback |
| Webhooks | Done | Idempotency (atomic upsert), retry on incomplete, reject missing event IDs |
| Input validation | Done | Deep validation on customizations; UUID format check on IDs; 0-config guards |
| Accessibility | Done | ARIA roles, 36px slider thumb, 44px+ touch targets |
| GDPR compliance | Done | Customer-scoped redact/data-request; customerEmail tracked on drafts |
| Error handling | Done | All routes wrapped in try/catch; generic messages in production |
| Security | Done | CORS origin-only headers, compression, HSTS, nosniff, body size limit, SVG hardened |
| Monitoring | Partial | Sentry installed; DSN may not be set on VPS |
| Tests | Done | 45 tests across 7 files (GDPR, webhook, config, cart-confirm, variant pool, prepare, cron) |
| Order webhooks | Blocked | Requires Shopify "protected data" approval |

---

## What's Done (Completed)

### Core Infrastructure
- App proxy URL forwarding (Shopify strips prefix before forwarding)
- CORS for cross-origin ES module loading (Cloudflare tunnel to myshopify.com)
- CORS restricted to Shopify domains only (was wildcard) -- Phase 2
- CSP `frame-ancestors` missing when `?shop` absent in request URL
- R2 CORS policy for presigned PUT (bucket-level policy in Cloudflare dashboard)
- Fee products created as `UNLISTED` (hidden from collections, search, recommendations)
- Geometry snapshot immutability enforced via Postgres `BEFORE UPDATE` trigger
- SVG sanitisation via DOMPurify + JSDOM before R2 storage
- MIME type allowlist on tray-upload endpoint (security)
- R2 storage key extension sanitisation (path injection prevention)
- Timing-safe cron auth -- constant-time token comparison in `lib/cron-auth.server.ts`
- Database indexes for order status queries and config cleanup -- Phase 2

### Webhooks & Order Processing
- Webhook idempotency via `WebhookEvent` deduplication table
- Webhook reject missing X-Shopify-Event-Id headers -- Phase 2
- Webhook retry incomplete handlers -- Phase 2
- Slot rollback on Shopify price update failure in /prepare -- Phase 2
- Retry with exponential backoff for slot price reset on orders/paid -- Phase 2

### Input Validation
- Deep validation for customization placements and logo mapping -- Phase 2

### Admin Dashboard
- View editor: inline rename, delete-with-confirmation, create-view on same page
- Admin button popup blocker fix -- `setTimeout(() => window.open(...), 0)`
- Artwork download button on order detail -- presigned GET URL
- CSV export UI button on orders page
- Order production status API and UI controls
- Empty states on Products, Methods, Orders pages -- Phase 2
- Artwork status filter on Orders page -- Phase 2
- ContextualSaveBar on Settings translations form -- Phase 2
- 0-methods/0-placements admin warning banners -- Phase 2
- Setup progress recognizes view-level shared geometry -- Phase 2
- View editor back navigation uses Link instead of `<a href>` (was causing login prompt) -- Phase 2
- Theme editor link opens in new tab (`_blank` instead of `_top`) -- Phase 2

### Storefront Modal
- Storefront modal base URL derived from request origin (never stale on tunnel rotation)
- Storefront URL uses numeric IDs (GID extracted before building customizerUrl)
- Canvas centering fix
- `use_theme_style` toggle default changed to `false`
- Fee product UNLISTED fix (removed invalid `seo`/`productType` fields)
- 0-methods/0-placements storefront 422 guard -- Phase 2
- ARIA roles on method cards and step pills -- Phase 2
- 44px touch targets on storefront modal buttons -- Phase 2
- localStorage draft persistence with 24h expiry -- Phase 2
- Close confirmation dialog with neutral copy -- Phase 2
- Mobile responsive CSS for 375px and 390px viewports -- Phase 2
- Config readiness guards: Preview button disabled until config complete -- Phase 2
- Storefront Customize button visibility tied to config completeness (insignia.enabled metafield) -- Phase 2
- Shorter storefront URLs using `?p=` and `?v=` short query params (both long and short params supported) -- Phase 2
- Setup guide "I've added it" button for theme block step (persisted) -- Phase 2
- Theme banner dismiss persisted across page reloads -- Phase 2

### Merchant Notifications
- Merchant email notification service (gated behind RESEND_API_KEY) -- Phase 2

### Placement Editor
- Placement editor zoom/pan (mouse wheel + drag) -- Phase 2

### Backend Operations
- Rate limiting on all storefront endpoints -- `checkRateLimit()`
- Cron cleanup: variant slots + abandoned drafts
- CI lint/typecheck quality gate (Node 22)

### Code Quality
- ESLint hook dependency warnings resolved (useMemo/useCallback/useEffect) -- Phase 2
- Test suite: 38 tests across 6 files (webhook idempotency, config, cart-confirm, variant pool, prepare, cron) -- Phase 2
- Storefront spec corrected -- `docs/core/api-contracts/storefront.md` updated

### Bug Fixes (Historical)
- `X-Frame-Options: SAMEORIGIN` on theme editor
- 405 on "Add first view" -- `useSubmit()` replaces native `<form>`
- 500 on storefront `/config` -- `AppError` catch handles all status codes
- Double file picker on image tray

### Phase 3 — Audit Fixes (0.4.0)

**GDPR Compliance**
- Customer-scoped `customers/redact`: filters by customerEmail, not all shop drafts -- Phase 3
- `customers/data_request`: compiles customer-specific data (drafts filtered by email) -- Phase 3
- `customerEmail` field added to CustomizationDraft model with composite index -- Phase 3
- customerEmail passed through storefront draft creation flow -- Phase 3
- GDPR handlers extracted to testable `gdpr.server.ts` service -- Phase 3

**CORS & Security**
- Redundant per-route OPTIONS handlers removed (8 routes); server.mjs handles globally -- Phase 3
- CORS Allow-Methods/Allow-Headers moved inside origin check (was leaking to all responses) -- Phase 3
- Response compression via `compression` middleware -- Phase 3
- Security headers: X-Content-Type-Options, Referrer-Policy, HSTS (production) -- Phase 3
- Request body size limit (6MB) as early middleware -- Phase 3
- Rate limiting expanded to all storefront endpoints (/price, /cart-confirm, /customizations, /uploads) -- Phase 3
- CSP fallback expanded with script-src, style-src, img-src, connect-src directives -- Phase 3

**Database**
- GIN index on ProductConfig.linkedProductIds for storefront config lookup -- Phase 3
- B-tree indexes on CustomizationDraft.productConfigId and variantId -- Phase 3
- Redundant Shop.shopifyDomain index removed (@unique already creates one) -- Phase 3
- Explicit onDelete: SetNull on OrderLineCustomization.customizationConfig -- Phase 3
- Timestamps (createdAt/updatedAt) added to PlacementStep model -- Phase 3

**Webhook & Upload Security**
- Webhook idempotency race fix: atomic upsert replaces deleteMany + create -- Phase 3
- Upload content-type bypass fixed: require valid MIME or infer from extension (was OR, now AND) -- Phase 3
- Image dimension limits: 4096x4096 max on sharp() to prevent decompression bombs -- Phase 3
- SVG external reference check extended: data:, ftp://, protocol-relative URLs -- Phase 3

**Route Hardening**
- All storefront routes wrapped in try/catch (was only around service calls) -- Phase 3
- customizationId UUID format validation on /prepare, /price, /cart-confirm -- Phase 3
- Rate limiting added to post-purchase upload route -- Phase 3
- 0-methods/0-placements guard added to /prepare endpoint -- Phase 3
- Generic error messages in production 500 responses (no internal details leaked) -- Phase 3

**Email Notifications**
- HTML escaping on all interpolated values in notification emails (XSS prevention) -- Phase 3
- Optional shopEmail parameter (falls back to admin@domain) -- Phase 3

**Frontend**
- loadDraft() wired up on CustomizationModal mount (was dead code) -- Phase 3
- Slider thumb increased from 24px to 36px for accessibility -- Phase 3
- Expired slot recycling atomized (was find-then-update loop, now updateMany + raw SQL) -- Phase 3
- StorefrontUploadSession cleanup added to cron -- Phase 3

**Code Quality**
- Test suite expanded: 45 tests across 7 files (added GDPR handler tests) -- Phase 3
- Stale checkboxes in v2-design-decisions doc updated -- Phase 3

---

## What's Left To Do

### Blockers (ops tasks — no code changes needed)

**Order webhooks are disabled**
Order webhooks (`orders/paid`, `orders/updated`, etc.) are commented out in `shopify.app.insignia.toml`. Shopify requires "protected customer data" approval. Without this, order fulfillment data is never populated automatically.

Steps:
1. Partners Dashboard -> App -> API access -> Request protected customer data
2. Once approved, uncomment webhook subscriptions in `shopify.app.insignia.toml`
3. `shopify app deploy --config insignia`

**Deploy Phase 3 fixes to VPS**
The `audit-fixes` branch has 9 commits with 2 Prisma migrations. After merging to main:
1. Push to trigger auto-deploy
2. SSH to VPS and run `npx prisma migrate deploy`
3. Verify the app starts cleanly

### High Priority (ops)

**Sentry DSN confirmation on VPS**
`@sentry/node` is installed and wired in `server.mjs` but `SENTRY_DSN` may not be set in the VPS `.env`. Without it all production errors are silently swallowed.
Fix: SSH to VPS, confirm `SENTRY_DSN` is set. 5-minute task.

**Verify cron jobs on VPS**
Confirm crontab has entries for `cleanup-slots` (every 5 min) and `cleanup-drafts` (hourly, now also cleans StorefrontUploadSession).

### Medium Priority (post-launch iteration)

**GDPR data request fulfillment process**
`customers/data_request` compiles and logs customer data but has no delivery mechanism (email/notification to merchant). Acceptable for App Store if you document a manual process. Full automation is a future improvement.

**View Editor UX decision unresolved**
Three design options documented (A: tabs, B: expand/collapse, C: overview-first) but no decision made. See `docs/notes/open-work.md`.

**Logo sizing UX decision unresolved**
Stepped size tiers vs. fixed-size-per-zone vs. both -- no decision made.

**Multi-image support per view**
Currently one image per variant-view cell. Some products need multiple separate images composited together. Data model and upload flow don't support this yet.

**No staging environment**
All fixes are tested locally then deployed live. A second VPS compose stack or preview deploy would reduce risk.

**Access token encryption**
Shopify access tokens stored in plaintext in the database. Risk is bounded by VPS firewall. Encryption at rest is a best practice for App Store review but not blocking for MVP.

### Low Priority / Nice-to-Have

**Pretty storefront URLs**
Path-based URLs (`/customize/:productId` and splat routes) were attempted but broke App Proxy routing due to `AppProxyProvider` `<base>` tag incompatibility with non-static routes. Settled on short query params (`/modal?p=X&v=Y`). True path-based pretty URLs would require dropping `AppProxyProvider` — a major architectural change for cosmetic gain.

**No CDN for storefront modal assets**
Storefront modal scripts load from single VPS (Netherlands). International customers see latency.

**Import variant images from Shopify**
Allow merchants to pull existing product images from Shopify instead of re-uploading.

**Storefront artwork re-upload on review step**
"Change artwork" shortcut on the review step to reduce drop-off.

**Admin preview of storefront modal**
Let merchants see the customer experience without going to a live storefront.

**Bulk product linking**
Currently product configs are linked to product IDs one at a time.

**Image tray should use Polaris DropZone**
Replace hidden file input + `.click()` with Polaris DropZone for drag-and-drop.

**Pricing bulk edit**
Batch edit table for method/placement prices.

**Storefront translations preview**
Let merchants see translation text in context inside the modal.

### Feature Backlog

| Feature | Description |
|---|---|
| Customer artwork intake channel | Request artwork from customers post-order (email link to re-upload) |
| Multiple logo positions per order | Customer selects more than one placement in a single customization |
| Artwork approval workflow | Merchant reviews uploaded artwork before production |
| Per-product pricing overrides | Override base method price per product |
| Reorder / duplicate product configs | Clone an existing config as a starting point |
| Storefront: saved customizations | Returning customers retrieve and re-apply previous customization |
| Merchant portal: production overview | Kanban or table view grouped by artwork status |
| Analytics: conversion funnel | Open modal, upload, complete, checkout tracking |
| Shopify Flow integration | Trigger automations on `customization.completed` or `artwork.received` |

### V3 / Future

| Feature | Notes |
|---|---|
| 3D product preview | Three.js or Konva UV-map approach |
| Ruler calibration auto-detect | Real-world dimensions from product metadata |
| CJK / RTL locale support | RTL layout audit of the storefront modal |
| CDN for modal bundle | Cloudflare Pages instead of single VPS |
| Multi-tenant SaaS mode | Billing tiers, usage limits, white-label theming |
| AI logo upscaling | Super-resolution model on uploaded logos |

---

## Manual/Ops Tasks

These require SSH or dashboard actions, not code changes.

| Task | Where | Effort |
|---|---|---|
| Confirm `SENTRY_DSN` is set on VPS | SSH to VPS, check `.env` | 5 min |
| Apply for Shopify protected data access | Partners Dashboard -> App -> API access | 15 min (form) |
| Uncomment order webhooks after approval | `shopify.app.insignia.toml` + `shopify app deploy` | 5 min |
| Set up staging environment | Second VPS or Fly.io/Render preview deploy | 1 day |
| Verify cron jobs running on VPS | SSH, check crontab for cleanup-slots and cleanup-drafts | 5 min |
