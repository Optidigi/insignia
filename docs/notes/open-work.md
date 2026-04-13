# Open work / decisions to revisit

> **Last updated**: 2026-04-14

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
- **Pinned**: `/customize/:productId` was attempted in Phase 2 but broke App Proxy routing. Reverted to `/modal?productId=X`.
- Needs App Proxy routing research before re-implementing.
- See: AUDIT.md "Low Priority" section.

### Access token encryption
- **Decision needed**: Accept the risk of plaintext Shopify access tokens in the database, or implement Prisma middleware for encryption at rest.
- Tokens are in a server-only database behind VPS firewall, so risk is bounded. But encryption at rest is a best practice for App Store review.

## Resolved (kept for history)

- ~~SVG allow-list strictness~~ — Implemented in `docs/core/svg-upload-safety.md` with DOMPurify.
- ~~End-to-end MVP flow~~ — Implemented: dashboard saves geometry, storefront calls /prepare, backend enforces configHash/pricingVersion.
- ~~Artwork intake channel~~ — Customer upload is deferred to V3 (item 5 in v3-future-features.md).
- ~~Customer artwork upload page~~ — Route `app/routes/apps.insignia.upload.tsx` is fully implemented (post-purchase artwork upload with loader, action, and UI). Closed 2026-04-11.
