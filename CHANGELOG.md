# Changelog

## Unreleased

### Added
- Staging image tray on product images page -- drag images onto color-card cells
- Bulk image upload to Cloudflare R2 via presigned PUT URLs
- `shopify.app.insignia-demo.toml` config for isolated local development
- `.env.demo` for demo app credentials (gitignored)

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
