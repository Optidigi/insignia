# Changelog

## Unreleased

### Added
- Staging image tray on product images page — drag images onto color-card cells
- Bulk image upload to Cloudflare R2 via presigned PUT URLs
- `shopify.app.insignia-demo.toml` config for isolated local development
- `.env.demo` for demo app credentials (gitignored)

### Fixed
- Double file picker on image tray Upload button (removed `<label>` wrapper, use direct `onClick`)
- "admin.shopify.com refused to connect" — theme editor button now uses `window.open(url, "_top")` instead of embedded iframe navigation
- R2 image upload 403 — R2 bucket CORS policy updated to allow `PUT` from app origins
- 405 on "Add first view" — replaced native `<form>` with `useSubmit()` to prevent OAuth re-auth loop in embedded iframe
- 500 on storefront `/config` endpoint — `AppError` catch now handles all status codes, not just 404
- MIME type allowlist on tray upload endpoint (security)
- Extension key sanitisation in R2 storage path (security)
- `use_theme_style` toggle default changed to `false` so the Customize button renders independently of the theme style

### Changed
- `shopify.app.toml` renamed to `shopify.app.insignia.toml`
- `package.json` name updated to `insignia-shopify-app`, version set to `0.2.0`
- README rewritten to be Insignia-specific (removed Shopify template boilerplate)

---

## 0.1.0 — 2026-04-06

Initial production deployment.

- Product configuration (views, placements, decoration methods)
- Storefront modal (4-step: upload → placement → size → review)
- Variant pool pricing for non-Shopify-Plus merchants
- Cloudflare R2 storage with server-side upload
- Docker + GitHub Actions CI/CD
- PostgreSQL + Prisma schema (18 models)
- Theme app extension (Customize button block)
- App Proxy for storefront modal serving
- GDPR webhook handlers
- Merchant settings (placeholder logo, storefront translations)
