# Open work / decisions to revisit

> **Last updated**: 2026-04-10

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

## Resolved (kept for history)

- ~~SVG allow-list strictness~~ — Implemented in `docs/core/svg-upload-safety.md` with DOMPurify.
- ~~End-to-end MVP flow~~ — Implemented: dashboard saves geometry, storefront calls /prepare, backend enforces configHash/pricingVersion.
- ~~Artwork intake channel~~ — Customer upload is deferred to V3 (item 5 in v3-future-features.md).
- ~~Customer artwork upload page~~ — Route `app/routes/apps.insignia.upload.tsx` is fully implemented (post-purchase artwork upload with loader, action, and UI). Closed 2026-04-11.
