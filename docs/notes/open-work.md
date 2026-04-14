# Open work / decisions to revisit

> **Last updated**: 2026-04-14 (Phase 3 audit fixes applied)

This file tracks decisions and missing contracts that block completion.

Rules:

- Do not invent contracts in role docs.
- When a decision is resolved, update the canonical doc(s) in `docs/core/` and then remove the item here.

---

## Active Open Questions

### View Editor right panel architecture
- **Decision needed**: Tabs (A) vs expand/collapse per-zone (B) vs overview-first (C)
- See: `docs/superpowers/specs/2026-04-09-v2.1-view-editor-brainstorm.md`
- Design file: `admin-dashboard-v2.1-final.pen`

### Logo sizing UX improvement
- **Decision needed**: Keep stepped tiers with better cards, add fixed-size-per-zone mode, or both?
- See: memory file `project_v21_view_editor_notes.md`

### Pretty storefront URLs
- **Resolved (partial)**: Path-based URLs (`/customize/:productId` and splat routes) both failed due to `AppProxyProvider` `<base>` tag incompatibility. Settled on short query params (`/modal?p=X&v=Y`) which are shorter than the original format.
- True path-based URLs would require dropping `AppProxyProvider` entirely — a major architectural change for cosmetic gain. Accepted as-is.

### Access token encryption
- **Decision needed**: Accept the risk of plaintext Shopify access tokens in the database, or implement Prisma middleware for encryption at rest.
- Tokens are in a server-only database behind VPS firewall, so risk is bounded. But encryption at rest is a best practice for App Store review.

### GDPR data request fulfillment
- **Open (low priority)**: `customers/data_request` compiles and logs customer data but has no automated delivery mechanism. Acceptable for App Store review if a manual process is documented. Full automation (email or persisted report) is a future improvement.

## Resolved (kept for history)

- ~~SVG allow-list strictness~~ — Implemented in `docs/core/svg-upload-safety.md` with DOMPurify.
- ~~End-to-end MVP flow~~ — Implemented: dashboard saves geometry, storefront calls /prepare, backend enforces configHash/pricingVersion.
- ~~Artwork intake channel~~ — Customer upload is deferred to V3 (item 5 in v3-future-features.md).
- ~~Customer artwork upload page~~ — Route `app/routes/apps.insignia.upload.tsx` is fully implemented (post-purchase artwork upload with loader, action, and UI). Closed 2026-04-11.
- ~~GDPR customers/redact deleting all shop data~~ — Fixed in Phase 3: filters by customerEmail. Closed 2026-04-14.
- ~~CORS preflight reflecting untrusted Origin~~ — Fixed in Phase 3: per-route OPTIONS handlers removed, server.mjs handles globally. Closed 2026-04-14.
- ~~Webhook idempotency race condition~~ — Fixed in Phase 3: atomic upsert replaces deleteMany + create. Closed 2026-04-14.
- ~~Upload content-type bypass~~ — Fixed in Phase 3: require valid MIME or infer from extension. Closed 2026-04-14.
- ~~Missing database indexes~~ — Fixed in Phase 3: GIN on linkedProductIds, B-tree on draft fields. Closed 2026-04-14.
