# Insignia — Production Readiness Audit

> **Date**: 2026-04-12  
> **Version audited**: `0.2.0` (commit `a051641`)  
> **Status summary**: Core product is functional and deployed. Several gaps remain before the app is fully production-hardened.

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
| Tests | ❌ None | Zero test coverage |
| Order webhooks | ❌ Blocked | Commented out — requires Shopify "protected data" approval |
| Monitoring | 🟡 Partial | Sentry installed but DSN may not be set on VPS |

---

## 1. BLOCKERS — Must fix before scaling / listing on App Store

### 1.1 Order webhooks are disabled
**File**: `shopify.app.insignia.toml`  
Order webhooks (`orders/paid`, `orders/updated`, etc.) are commented out because Shopify requires a "protected customer data" approval to subscribe to order topics.

**What's needed:**
1. Apply for protected customer data access in the Shopify Partner Dashboard (App → API access → Protected customer data).
2. Once approved, uncomment the webhook subscriptions in `shopify.app.insignia.toml`.
3. Run `shopify app deploy --config insignia`.

**Impact**: Without this, order fulfillment data (production status, artwork binding) must be manually triggered or polled. The `OrderLineCustomization` model exists and is wired — it just isn't populated automatically on order paid.

---

### 1.2 No test coverage
Zero `*.test.ts` / `*.spec.ts` files exist in the repo. The variant pool, geometry snapshot, and storefront prep logic are all untested.

**Minimum viable test suite needed:**
- Unit: `variant-pool.server.ts` — slot reservation, expiry, self-heal
- Unit: `storefront-prepare.server.ts` — price calculation, config hash
- Unit: `storefront-config.server.ts` — config shape, placement resolution
- Integration: `POST /apps/insignia/prepare` — full round-trip
- Integration: `POST /apps/insignia/cart-confirm` — order binding

**Risk**: Any refactor to pricing or geometry logic has no safety net.

---

### 1.3 Variant slot expiry has no scheduled cleanup
**File**: `app/lib/services/variant-pool.server.ts`  
Expired `RESERVED` and `IN_CART` slots are cleaned up lazily (on next `ensureVariantPoolExists` call). There is no background job or cron to sweep stale slots.

**What's needed:**  
A cron job (or Shopify `app/scopes_update` webhook handler) that periodically calls the expiry sweep. Could be a simple `/api/admin/cron/cleanup-slots` endpoint called by a VPS cron entry every 5 minutes.

**Impact**: Under high concurrency, stale reserved slots could exhaust the variant pool until the next self-heal trigger.

---

## 2. HIGH PRIORITY — Fix before public launch

### 2.1 No rate limiting on storefront endpoints
The storefront API (`/apps/insignia/*`) endpoints have no per-IP or per-shop rate limiting. A malicious actor could exhaust variant slots or hammer the upload endpoint.

**Needed**: Express `rate-limiter-flexible` or similar on `/apps/insignia/prepare` and `/apps/insignia/upload`.

---

### 2.2 No email notifications to merchant on new orders
When a customer completes a customization and checks out, the merchant has no automated notification beyond standard Shopify order emails. The `emailReminderTemplate` field exists on `MerchantSettings` but is unused.

**Needed**: Trigger an email (via Shopify Email or a transactional provider) when `OrderLineCustomization` is created.

---

### 2.3 Sentry DSN not confirmed on VPS
`@sentry/node` is installed and wired in `server.mjs`, but the `SENTRY_DSN` environment variable may not be set in the VPS `.env`.

**Check**: SSH to VPS and confirm `SENTRY_DSN` is set. Without it, all production errors are silently swallowed.

---

### 2.4 No artwork delivery mechanism to merchant
The `artworkStatus` field tracks whether artwork has been submitted, but there is no way for the merchant to download the customer's logo from the orders page.

**Needed**: A "Download artwork" button on the order detail page that generates a presigned R2 GET URL for the logo asset.

---

### 2.5 `CustomizationDraft` records accumulate indefinitely
Drafts created during the storefront flow (before checkout) are never cleaned up. Over time this table will grow unboundedly.

**Needed**: Either a TTL Postgres trigger (delete drafts older than 24h) or a cron sweep.

---

## 3. MEDIUM PRIORITY — Production quality improvements

### 3.1 CI pipeline has no lint/typecheck gate
**File**: `.github/workflows/docker-publish.yml`  
The CI builds and publishes the Docker image without running `npm run typecheck` or `npm run lint` first. A broken-types commit can ship to production.

**Fix**: Add a `check` job that runs before `build`:
```yaml
- run: npm run typecheck
- run: npm run lint
```

---

### 3.2 Admin-side image upload uses a hidden file input + programmatic `.click()`
The tray upload pattern works in modern browsers but is fragile in some iframe environments. Long-term, consider a proper `<DropZone>` (Polaris) for the image tray to match the settings page pattern.

---

### 3.3 View Editor UX decision is unresolved
**File**: `docs/notes/open-work.md`  
Three design options for the right panel (tabs vs expand/collapse vs overview-first) are documented but no decision has been made. The current implementation uses option A (tabs) as a temporary default.

---

### 3.4 Logo sizing UX decision is unresolved
**File**: `docs/notes/open-work.md`  
Stepped size tiers vs. fixed-size-per-zone vs. both — no decision made. Current implementation exposes size steps from the placement definition.

---

### 3.5 `docs/core/api-contracts/storefront.md` diverges from implementation
The spec describes a presigned URL upload flow for storefront logo uploads. The actual implementation uses server-side upload via the `/apps/insignia/upload` endpoint. The spec should be updated to match reality.

---

### 3.6 No multi-region or CDN for storefront modal assets
Storefront modal scripts load from `insignia.optidigi.nl` (single VPS in NL). International customers will see latency loading the modal JavaScript.

**Longer term**: Serve the modal bundle from a CDN (Cloudflare Pages or R2 with Workers).

---

## 4. LOW PRIORITY / POLISH

### 4.1 `SETUP.md` and README partially overlap
Both cover local setup steps. Consider merging or making one canonical and the other a short pointer.

### 4.2 Stale plan tracking in `docs/superpowers/plans/`
Several plan files show 0% completion despite features being ~70–100% implemented. These are internal planning artifacts, not user-facing, but should be reconciled for future agent sessions.

### 4.3 No `robots.txt` or `sitemap.xml` protection for storefront proxy routes
The App Proxy path (`/apps/insignia/*`) is publicly routable. While it requires a valid Shopify proxy signature, search engines may still attempt to crawl it. A `robots.txt` disallow rule on the store side is worth documenting for merchants.

### 4.4 `package.json` has no `repository` or `homepage` field
Minor metadata gap. Useful for `npm audit` source resolution and GitHub tooling.

### 4.5 The `StorefrontTranslation` locale list is English-EU-focused
Eight locales supported. No CJK (Japanese, Korean, Chinese), Arabic, or other RTL languages. Fine for current market; worth noting for future expansion.

---

## 5. COMPLETED (resolved before this audit)

- ✅ App proxy URL forwarding (Shopify strips prefix before forwarding)
- ✅ CORS for cross-origin ES module loading (Cloudflare tunnel → myshopify.com)
- ✅ CSP `frame-ancestors` missing when `?shop` absent
- ✅ `X-Frame-Options: SAMEORIGIN` on theme editor button (now uses `window.open`)
- ✅ R2 CORS policy for presigned PUT (user added bucket-level policy)
- ✅ 405 on "Add first view" (useSubmit replaces native form)
- ✅ 500 on `/config` (AppError catch now handles all status codes)
- ✅ Double file picker on image tray (label wrapper removed)
- ✅ MIME type allowlist on tray-upload endpoint
- ✅ Extension key path injection sanitisation
- ✅ `use_theme_style` default set to `false`
- ✅ Fee products created as UNLISTED (hidden from storefront/collections/search)
- ✅ Geometry snapshot immutability enforced via DB trigger
- ✅ Webhook idempotency via `WebhookEvent` deduplication table
- ✅ SVG sanitisation via DOMPurify + JSDOM before storage

---

## Recommended Priority Order

| # | Item | Effort | Impact |
|---|---|---|---|
| 1 | Apply for Shopify protected data access (order webhooks) | Low (form submission) | High |
| 2 | Add `SENTRY_DSN` to VPS `.env` | 5 min | High |
| 3 | Add lint/typecheck to CI pipeline | 30 min | Medium |
| 4 | Variant slot expiry cron | 2–3 hours | High |
| 5 | Artwork download button on order detail | 2–3 hours | High |
| 6 | Draft cleanup (TTL or cron) | 1–2 hours | Medium |
| 7 | Rate limiting on storefront endpoints | 2–3 hours | High |
| 8 | Test suite (variant pool + storefront prep) | 1–2 days | High |
| 9 | View Editor UX decision + implementation | 1 day | Medium |
| 10 | Merchant email notification on new order | 1 day | Medium |
