# Changelog

## Unreleased

### Added
- Staging image tray on product images page -- drag images onto color-card cells
- Bulk image upload to Cloudflare R2 via presigned PUT URLs
- `shopify.app.insignia-demo.toml` config for isolated local development
- `.env.demo` for demo app credentials (gitignored)

---

## 0.5.0 — 2026-04-15

UI polish + per-view placements architecture change.

### Architecture
- **Per-view placements**: PlacementDefinition now belongs to ProductView (was ProductConfig). Each view has its own independent set of print areas. Migration assigns existing placements to first view.
- Auto-create default "Front" view on product config creation (image manager immediately usable)

### Fixed
- Admin save clobbering: useFetcher per save type (geometry, pricing, name) + batch-pricing-update intent — saves no longer cancel each other
- View switching: all view-dependent state reset on view.id change; Link→navigate for embedded app compatibility
- Canvas zoom: minimum 1x so image always fills viewport; position clamped after zoom/pan
- Storefront logo scaling: per-placement scaleFactor from config data (was synthetic linear interpolation)
- Storefront placement rendering: all placements shown (0-step get synthetic default); geometry scoped to owning view only
- Storefront close button: navigates to product page instead of closing tab
- View rows on product detail: entire row clickable with hover state (was only name text)
- Clone layout: geometry re-keyed with new placement IDs (was copying stale source IDs)
- save-calibration: ownership scoping via productConfig chain

### Changed
- Size selector: range slider replaced with clickable cards (name, scale, price, "Recommended" badge)
- Dead CSS removed: ~90 lines of old slider/tick styles
- Delete placement: action handler with cascade + geometry cleanup from view JSON

---

## 0.4.0 — 2026-04-14

Phase 3 production readiness audit — 31 findings fixed across security, GDPR, performance, and code quality.

### Security
- GDPR `customers/redact` now filters by customer email (was deleting all shop drafts)
- GDPR `customers/data_request` compiles customer-specific data
- Redundant CORS OPTIONS handlers removed from 8 routes (server.mjs handles globally)
- CORS Allow-Methods/Allow-Headers only sent when origin matches Shopify domains
- Response compression via gzip middleware
- Security headers: X-Content-Type-Options, Referrer-Policy, HSTS
- Request body size limit (6MB) rejects oversized payloads
- Rate limiting expanded to all public storefront endpoints
- Upload content-type bypass fixed (was accepting any MIME with valid extension)
- Image dimension limits (4096x4096) prevent decompression bombs
- SVG external reference check extended (data:, ftp://, protocol-relative URLs)
- HTML escaping in merchant notification emails (XSS prevention)
- Generic error messages in production 500 responses (no internal details leaked)
- CSP fallback expanded with script-src, style-src, img-src, connect-src

### Fixed
- Webhook idempotency race condition: atomic upsert replaces non-atomic delete+create
- Expired slot recycling race: atomized with updateMany + raw SQL (was find-then-update loop)
- loadDraft() wired up on CustomizationModal mount (was defined but never called)
- Slider thumb increased from 24px to 36px for touch accessibility
- customizationId UUID format validation on /prepare, /price, /cart-confirm
- 0-methods/0-placements guard added to /prepare endpoint
- All storefront routes wrapped in full try/catch (was only around service calls)
- Rate limiting added to post-purchase upload route

### Added
- `customerEmail` field on CustomizationDraft (for GDPR compliance)
- GDPR service (`gdpr.server.ts`) with testable handler functions
- GIN index on ProductConfig.linkedProductIds for storefront config lookup performance
- B-tree indexes on CustomizationDraft.productConfigId and variantId
- Timestamps on PlacementStep model
- StorefrontUploadSession cleanup in cron job
- Optional `shopEmail` parameter on notification service
- 7 new GDPR tests (45 total across 7 files)

### Changed
- Explicit onDelete: SetNull on OrderLineCustomization.customizationConfig relation
- Removed redundant Shop.shopifyDomain index (@unique already creates one)
- Updated stale checkboxes in v2-design-decisions doc

---

## 0.3.0 — 2026-04-14

Phase 2 production hardening.

### Added
- Webhook idempotency: reject missing event IDs, retry incomplete handlers
- Slot rollback on Shopify price update failure in /prepare
- Retry with backoff for slot price reset on orders/paid
- CORS restricted to Shopify domains (was wildcard)
- Deep input validation on storefront customizations endpoint
- Database indexes for order status queries and config cleanup
- 0-methods/0-placements guards (storefront 422 + admin warning banners)
- ARIA roles on storefront method cards and step pills
- 44px touch targets on storefront modal buttons
- localStorage draft persistence with 24h expiry
- Close confirmation dialog with neutral copy
- Empty states on Products, Methods, Orders pages
- Artwork status filter on Orders page
- ContextualSaveBar on Settings translations form
- Merchant email notification service (gated behind RESEND_API_KEY)
- Placement editor zoom/pan (mouse wheel + drag)
- Mobile responsive CSS for storefront modal (375px, 390px)
- Config readiness guards: Preview button disabled until config complete
- Storefront Customize button visibility tied to config completeness
- Test suite: 38 tests (webhook idempotency, config, cart-confirm, variant pool, prepare, cron)

### Fixed
- ESLint hook dependency warnings (useMemo/useCallback/useEffect)
- View editor back navigation causing login prompt (Link instead of `<a>`)
- Setup progress "Print areas positioned" not recognizing view-level geometry
- Theme editor link opening in same tab instead of new tab
- Setup guide theme block step now has "I've added it" button (persisted)
- Theme banner dismiss persisted across page reloads
- Shorter storefront URLs: `?p=` and `?v=` short query params (old format still works)

---

## 0.1.0 — 2026-04-06

Initial production deployment.

- Product configuration (views, placements, decoration methods)
- Storefront modal (4-step: upload, placement, size, review)
- Variant pool pricing for non-Shopify-Plus merchants
- Cloudflare R2 storage with server-side upload
- Docker + GitHub Actions CI/CD
- PostgreSQL + Prisma schema (18 models)
- Theme app extension (Customize button block)
- App Proxy for storefront modal serving
- GDPR webhook handlers
- Merchant settings (placeholder logo, storefront translations)
