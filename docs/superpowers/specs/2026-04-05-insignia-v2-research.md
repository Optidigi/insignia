# Insignia V2 Research & Prioritized Roadmap

> **STATUS: REFERENCE.** Competitor analysis, persona research, and feature prioritization. Decisions are final — this is the "why" behind V2. Items 16-20 (deferred features) are now tracked in `2026-04-10-v3-future-features.md`.
> **Original status:** Research complete. Decisions made — P0 + P1 scoped for V2. P2 deferred.
> **Date:** 2026-04-05
> **Sources:** Codebase audit, competitive analysis (7 competitors), UX best practices research, template/3D technology research, 3 merchant persona simulations

---

## Executive Summary

Insignia V1 solves a genuinely hard problem -- dynamic per-customization pricing on non-Plus Shopify stores via a variant pool system. The storefront modal wizard is well-designed and the core concept is sound. However, five cross-cutting themes emerge from the research:

1. **Onboarding is too heavy.** 5 new concepts (methods, configs, views, placements, steps) across 4+ setup screens. Best-in-class competitors get merchants to their first customizable product in under 5 minutes using templates.
2. **The admin is CRUD-heavy, not workflow-driven.** The dashboard shows entity counts but doesn't guide merchants through their actual daily work (process orders, handle pending artwork, monitor revenue).
3. **The storefront experience is solid but fragile.** The 5-step wizard works well conceptually, but sequential API calls with weak error recovery create risk of lost customer progress.
4. **Templates are table stakes, not a differentiator.** Every successful competitor offers pre-built product templates. Insignia requires merchants to build everything from scratch.
5. **The mid-market gap is the opportunity.** Inkybay (complex, print-shop focused) and Teeinblue (simple, POD-focused) leave a gap for an app that's powerful enough for 50+ orders/day but simple enough for a 1-person shop.

---

## Part 1: Current State Assessment

### What Works Well

| Strength | Evidence |
|----------|----------|
| Variant pool pricing on non-Plus stores | Clever use of UNLISTED fee products with self-healing. Unique approach. |
| Storefront wizard flow | Upload > Placement > Size > Preview > Review is logical and customer-friendly |
| Live canvas preview | Konva-based rendering with real product images builds purchase confidence |
| "Logo later" support | Critical for B2B where logos aren't ready at order time. Most competitors lack this. |
| Documentation quality | 3-tier docs structure (canonical/working/notes) is well-organized |
| Type safety | Full TypeScript + Zod at boundaries; clean service/route separation |

### What's Broken or Missing

| Issue | Severity | Impact |
|-------|----------|--------|
| **5 concepts to learn before first sale** | Critical | High merchant churn in first hour. Setup guide helps but doesn't eliminate the learning curve. |
| **Per-variant, per-view image upload** | Critical | 10 variants x 3 views = 30 manual uploads. Unscalable beyond 5 products. |
| **No product templates** | Critical | Every configuration starts from scratch. Competitors offer 15-50+ pre-built templates. |
| **No order pagination/filtering/search** | High | Unusable above ~50 orders. Mid-market merchants can't operate. |
| **No customer artwork upload (post-purchase)** | High | "Logo later" creates orders but provides no self-serve path for customers to submit artwork later. |
| **Sequential API calls with weak recovery** | High | 4-call sequence (draft > price > prepare > cart) can fail mid-flow; customer loses progress. |
| **No analytics/reporting** | High | No revenue breakdown, no conversion metrics, no pending artwork aging. Dashboard is entity counts only. |
| **No bulk operations** | Medium | Can't assign config to 20 products at once, can't batch upload images. |
| **Placement selection has no visual preview** | Medium | Customers see placement names ("Left chest") but can't see WHERE on the product until step 3. |
| **Error handling is unspecified** | Medium | No standardized error responses. Storefront modal can show cryptic failures. |
| **No CSV/data export** | Medium | Production teams can't get order data for fulfillment without screen-scraping. |
| **Variant pool observability** | Medium | 5-state machine with TTLs, no audit trail. Debugging requires raw DB queries. |

---

## Part 2: Competitive Landscape

### Market Position

Insignia occupies a **focused niche** (logo decoration on products) within a broader market (product customization). This is simultaneously a strength (simpler, more opinionated) and a risk (narrow feature set vs. Swiss-army-knife competitors).

### Key Competitors

| App | Monthly Price | Strengths | Weaknesses |
|-----|---------------|-----------|------------|
| **Inkybay** | $20-unlimited | Multi-method support, 4.9 stars, print-ready export | Steep learning curve, print-shop focused |
| **Zakeke** | $19 + 1.7% fee | 3D/AR preview, most features | Hidden transaction fee, slow support |
| **Customily** | $49 flat | Multi-platform (5), AI features, POD sync | No 3D, higher price point |
| **Kickflip** | $59 + 1.95% | Conditional logic, component configurator | Recent price hike backlash, narrow focus |
| **Teeinblue** | $19 | Budget-friendly, POD integration, templates | Basic features, limited to personalization |
| **CPB** | Usage-based (2%) | Enterprise-grade, no monthly fee | Very steep learning curve |

### Table Stakes (every successful app has these)

- Real-time 2D live preview
- Image/logo upload
- Dynamic pricing visible during configuration
- Mobile-responsive customization interface
- Free trial period
- **Pre-built product templates**
- Print-ready or production-ready output

### Insignia's Potential Differentiators

1. **No transaction fees** -- Zakeke (1.7-1.9%) and Kickflip (1.95%) draw significant complaints
2. **Focused simplicity** -- Logo placement only, not a general-purpose configurator
3. **Smart templates with color matching** -- Generic garment silhouettes + multiply-blend color previews from a single white product photo
4. **"Logo later" first-class support** -- Most competitors treat this as an afterthought
5. **Non-Plus pricing** -- Variant pool approach works on all Shopify plans

---

## Part 3: Target Personas

### Who Uses This App?

Three tiers emerged from persona simulation, each with distinct needs:

| Persona | Volume | Key Need | Tolerance for Complexity |
|---------|--------|----------|--------------------------|
| **Sarah** (1-person shop) | 5-10 orders/week | "Just works" in 10 minutes | Very low. 5 setup steps max. |
| **Mike** (5-10 employees) | 50+ orders/day | Operational efficiency | Medium. Will learn if it saves time. |
| **Lisa** (enterprise/agency) | 500+ orders/day | Scale, API, multi-store | High. Will invest if ROI is clear. |

### Universal Needs (All Three Agree)

1. Storefront modal must work reliably -- a broken checkout is unacceptable at any scale
2. "Logo later" workflow is critical -- logos not being ready is the norm, not the exception
3. Setup must be understandable without technical knowledge
4. Pricing must be transparent and correct
5. Order visibility with artwork status is the #1 admin feature after setup

### Top 5 Reasons Merchants Would REJECT This App

1. Setup takes too long or requires understanding internal concepts (variant pools, config hashes)
2. Fee products create visible artifacts in the store
3. No pagination or filtering on orders -- useless above ~50 orders
4. "Logo later" has no self-serve customer upload path
5. No analytics, no export, no API -- the app is an operational black box

### Top 5 Reasons Merchants Would RECOMMEND This App

1. Storefront wizard eliminates email-based mockup approval
2. Live preview on actual product images builds customer confidence
3. Variant pool self-healing means pricing works on non-Plus without hacks
4. Setup guide with progress tracking is well-designed
5. Per-placement, per-tier pricing supports diverse business models

---

## Part 4: V2 Prioritized Roadmap

### Priority Definitions

- **P0 (Must-Have):** Without these, merchants won't complete setup or will churn quickly. Competitive table stakes.
- **P1 (Should-Have):** Significant quality-of-life improvements. Differentiators that win reviews and retention.
- **P2 (Nice-to-Have):** Advanced features for power users. Future growth drivers.

---

### P0 -- Must-Have

#### 1. Product Template Library
**Problem:** Every configuration starts from scratch. Merchants must understand views, placements, and geometry before seeing any value.
**Solution:** Ship 15-20 pre-built garment templates (t-shirt front/back, hoodie front/back, polo, cap, mug, tote bag, etc.). Each template includes: standard views, pre-defined placement zones (left chest, full front, full back, sleeve), and sensible defaults.
**UX:** During config creation, merchant sees: "Start from template" (gallery of garment silhouettes) or "Start from scratch." Selecting a template auto-creates views + placements. Merchant only needs to: name the config, link products, and optionally adjust zones.
**Impact:** Reduces setup from 30+ minutes to under 5 minutes. Eliminates the need to understand views/placements/geometry upfront.
**Complexity:** Medium (2-3 weeks). Data model already supports this -- templates are just pre-populated configs.

#### 2. Simplified Onboarding (Concept Reduction)
**Problem:** 5 concepts (methods, configs, views, placements, steps) is too many. Merchants don't think in these abstractions.
**Solution:** Reduce visible concepts from 5 to 3:
- **Methods** stay (merchants understand "embroidery vs. screen print")
- **Products** replace "configs" (link a product to customization = create a config behind the scenes)
- **Placement zones** replace "views + placements + steps" (a zone has a position on the product, a size range, and pricing)
Views become an internal concept -- the template handles view creation. Steps become "size pricing" within a zone.
**UX:** Setup becomes: (1) Choose a decoration method, (2) Pick a product + template, (3) Review/adjust placement zones. Done.
**Impact:** Cuts onboarding to 3 steps. Aligns with merchant mental model.
**Complexity:** Medium. Mostly a UX/naming change + template system. Data model stays the same underneath.

#### 3. Dynamic Color-Matched Previews
**Problem:** Merchants must upload separate images for every color variant. A t-shirt in 10 colors = 10 photos per view.
**Solution:** Three-path approach, no external AI services:
- **Path A (default):** Template silhouettes serve as product preview. No photos needed. Works immediately.
- **Path B (recommended for realism):** Merchant uploads one photo per view of the product **in white or lightest color**. System applies multiply-blend color overlay to generate all variant colors. Brief explainer: "Use a white or light-colored product photo for best results across color variants."
- **Path C (advanced):** Upload separate photos per variant per view. Full control, same as V1.
**UX:** During image setup, merchant picks their approach. Path B shows variant list with auto-suggested hex colors from variant names (Black → #1A1A1A, Navy → #1E3A5F). Preview updates in real-time.
**Impact:** Reduces image uploads from N-variants to 1 per view (Path B) or 0 (Path A). Massive time savings.
**Complexity:** Low-medium (1-2 weeks). Multiply-blend runs in existing Konva pipeline. No external services.

#### 4. Orders: Pagination, Filtering, Search
**Problem:** Order list loads up to 100 items with no filtering. Unusable above ~50 orders.
**Solution:** Standard Polaris IndexTable with:
- Search by order number
- Filter by artwork status (All / Provided / Pending)
- Filter by order status (All / Ordered / Purchased)
- Date range picker
- Sort by date (newest/oldest)
- Cursor-based pagination (20 per page)
**Impact:** Makes the app viable for mid-market merchants (50+ orders/day).
**Complexity:** Low (1 week). Standard Polaris patterns.

#### 5. Customer Artwork Upload (Order Status Extension)
**Problem:** "Logo later" orders have `artworkStatus: PENDING_CUSTOMER` but no way for customers to submit artwork post-purchase.
**Solution:** Shopify Customer Account UI Extension targeting `customer-account.order-status.block.render`. Fully automatic — installs with the app via default placement, no merchant configuration needed. The extension:
- Reads order metafields set by Insignia (artwork status + upload token)
- Shows "Upload your logo" banner with upload link for pending orders
- Shows "Logo received" confirmation for completed orders
- Shows nothing for non-Insignia orders (conditional on metafield presence)
**Supplementary:** Provide optional Liquid snippet merchants can paste into their order confirmation email template (one-time setup, clear instructions). This is a bonus, not required — the order status extension is the primary channel.
**Constraint:** Requires the store to use new customer accounts (default for new stores, most existing stores have migrated).
**Impact:** Closes the biggest gap in the "Logo later" workflow. Zero merchant setup. Customer has persistent access via order status page.
**Complexity:** Medium (2 weeks). New customer account extension + upload route + token-based auth.

---

### P1 -- Should-Have

#### 6. Workflow-Driven Dashboard
**Problem:** Current dashboard shows entity counts (4 metric cards). Doesn't guide merchants through daily work.
**Solution:** Redesign dashboard around workflows:
- **Action required** section: pending artwork orders (with age), failed uploads, incomplete configs
- **Today's activity** section: new customized orders, artwork received, revenue
- **Quick actions**: "Process pending artwork" (batch view), "Review new orders"
- **Setup progress** (dismissible, only during onboarding)
**Impact:** Transforms dashboard from passive display to active workflow hub. Reduces "where do I go?" confusion.
**Complexity:** Medium (2 weeks).

#### 7. Visual Placement Preview in Storefront
**Problem:** During placement selection (step 2), customers see checkbox names ("Left chest", "Full back") but can't see WHERE these are on the product.
**Solution:** Show a small product thumbnail next to each placement option with the zone highlighted (blue rectangle overlay). When customer hovers/taps a placement, the preview updates.
**Impact:** Eliminates placement confusion. Increases placement selection confidence and reduces support tickets.
**Complexity:** Low (1 week). The geometry data and canvas rendering already exist.

#### 8. Batch Image Upload & Copy
**Problem:** Per-variant, per-view manual upload is unscalable.
**Solution:**
- **Batch upload:** Drag-drop multiple images. System auto-matches to variants by filename convention (e.g., `front-black.jpg`, `front-white.jpg`).
- **Copy from variant:** "Apply this image to all variants" button. One-click to use the same image across all color variants (for when color matching handles the rest).
- **Import from Shopify:** Select from existing product media in Shopify.
**Impact:** Reduces image setup time by 80%+ for multi-variant products.
**Complexity:** Medium (2 weeks).

#### 9. Basic Analytics
**Problem:** No revenue visibility, no conversion metrics, no operational insights.
**Solution:** Analytics tab on dashboard:
- Revenue from customization fees (daily/weekly/monthly chart)
- Orders by decoration method (pie/bar chart)
- Average placements per order
- Pending artwork aging (orders waiting > 3 days, > 7 days)
- Top configurations by revenue
**Impact:** Enables data-driven pricing and operational decisions.
**Complexity:** Medium (2 weeks). Query existing order data.

#### 10. CSV/Data Export
**Problem:** Production teams can't extract order data for fulfillment.
**Solution:** Export button on orders page. CSV includes: order number, customer, product, variant, method, placements, sizes, artwork status, artwork URLs, fee amount, date.
**Impact:** Bridges the gap between Insignia and production workflow tools.
**Complexity:** Low (3-5 days).

#### 11. Placement Geometry Templates
**Problem:** Every placement zone starts from scratch in the canvas editor. Merchants must manually position "left chest" every time.
**Solution:** Pre-defined zone templates: "Left chest (standard)", "Full front", "Full back", "Left sleeve", "Right sleeve", "Center chest", "Back yoke". One-click to apply, then fine-tune.
**Impact:** Faster placement setup. Consistent zone positioning across products.
**Complexity:** Low (1 week). Just pre-set geometry values.

#### 12. Multi-Language Support (i18n)
**Problem:** All UI strings are English-only across all surfaces (storefront modal, theme extension, admin dashboard, customer account extension). Insignia can't serve non-English markets.
**Solution:** Full i18n across all four surfaces:
- **Storefront modal:** Expand existing `i18n.ts` system (already has translation key structure). Detect shop locale via app proxy config endpoint. Add translation objects for top Shopify markets: English, French, German, Spanish, Dutch, Portuguese, Italian, Japanese.
- **Theme extension:** Add locale files (`fr.json`, `de.json`, etc.) in `extensions/insignia-theme/locales/`. Shopify auto-selects based on store language.
- **Customer account extension:** Use built-in `shopify.i18n.translate()` + locale files in extension directory.
- **Admin dashboard:** Extract hardcoded strings to translation maps. Use Polaris i18n patterns. Admin can ship with fewer languages initially (merchants commonly use English admin).
**All translations must be contextually accurate** — not literal word-for-word but natural in each language given the product customization domain.
- **Merchant translation overrides:** A dedicated settings page where merchants can customize any customer-facing string per language. Grouped by section (Modal UI, Buttons, Messages, Customer Account Extension). Locale selector at the top. Pre-filled with defaults. "Reset to default" per field. Overrides stored in DB and merged at runtime with built-in translations (merchant overrides take priority).
**Impact:** Opens Insignia to all Shopify markets. Required for "Built for Shopify" certification in non-English markets.
**Complexity:** Medium (2-3 weeks). Mostly content work — the i18n plumbing already exists or is provided by Shopify.

---

### P2 -- Nice-to-Have (Deferred — Not in V2 Scope)

#### 13. SVG Silhouette Fallbacks (Admin)
**Problem:** Merchants can't set up placements until they upload product photos. Creates a chicken-and-egg problem during onboarding.
**Solution:** Generic product silhouettes (SVG outlines of t-shirt, hoodie, etc.) used as placeholder images in the placement editor. Merchants can define zones on the silhouette, then replace with real photos later.
**Impact:** Decouples placement setup from image upload. Enables faster onboarding.
**Complexity:** Low (1 week).

#### 14. Multi-Logo Support
**Problem:** Each customization has one logo applied to all placements. Some customers want different logos on different placements.
**Solution:** Allow per-placement logo override in the storefront modal. Customer uploads a second logo and assigns it to specific placements.
**Impact:** Supports more complex customization scenarios (e.g., company logo on front, department logo on sleeve).
**Complexity:** Medium (2 weeks). Data model already has `logoAssetIdsByPlacementId` scaffolded.

#### 15. Shopify Flow Integration
**Problem:** No automation hooks for external workflows.
**Solution:** Expose Shopify Flow triggers:
- "Customization order created"
- "Artwork received"
- "Artwork pending > X days"
And Flow actions:
- "Send artwork reminder"
- "Mark artwork as received"
**Impact:** Enables merchants to build custom automation without coding.
**Complexity:** Medium (2-3 weeks).

#### 16. Production-Ready File Export
**Problem:** Logo placement data exists but isn't formatted for production equipment.
**Solution:** Per-order "Download production file" button. Generates a high-res composite image with exact placement dimensions, DPI specs, and method details in a production-ready format (PDF or PNG at print resolution).
**Impact:** Eliminates manual production file preparation.
**Complexity:** High (3-4 weeks). Requires server-side high-res rendering.

#### 17. 3D Product Preview
**Problem:** 2D canvas preview works but lacks the "wow factor" of competitors like Zakeke.
**Solution:** Optional Three.js-based 3D viewer for products with 3D models. Logo is UV-mapped onto the model in real-time. Falls back to 2D for products without 3D models.
**Impact:** Premium differentiator. AR potential via `<model-viewer>`.
**Complexity:** Very high (6-10 weeks). Requires 3D model creation/sourcing per product type.
**Recommendation:** Defer to V3. 2D with color matching covers 80%+ of use cases.

#### 18. White-Label Storefront Modal
**Problem:** Enterprise/agency merchants need the modal to match their brand, not show "Insignia."
**Solution:** Theming options: custom colors, custom fonts, hide "Powered by" branding, custom CSS injection.
**Impact:** Enterprise upsell opportunity.
**Complexity:** Low-medium (1-2 weeks).

#### 19. Public API
**Problem:** No programmatic access for integrations or custom tooling.
**Solution:** REST API for: configs (CRUD), methods (CRUD), orders (read + artwork upload), settings (read/write). Token-based auth.
**Impact:** Enables enterprise integrations and headless storefront support.
**Complexity:** High (4-6 weeks).

#### 20. Multi-Store Management
**Problem:** Each Shopify store is a separate Insignia installation. Agencies managing 5+ stores can't share templates or methods.
**Solution:** Agency dashboard linking multiple store installations. Shared template library. Unified order view.
**Impact:** Enterprise/agency tier unlock.
**Complexity:** Very high (8-12 weeks). Requires new auth model + cross-store data layer.

---

## Part 5: UX Philosophy for V2

### Core Principles

1. **Template-first, not blank-canvas.** Default to pre-built. Let merchants customize, not create. The "Start from scratch" option exists but is secondary.

2. **Show, don't explain.** Replace text descriptions with visual previews. A thumbnail with a highlighted zone communicates more than "Left chest placement at 25% from top, 15% from left."

3. **Workflow over CRUD.** The dashboard should answer "What do I need to do today?" not "How many entities exist?" Action items > entity counts.

4. **Progressive disclosure.** Show the 20% of features that cover 80% of use cases. Hide advanced options (step pricing, per-placement logo override, geometry fine-tuning) behind "Advanced" toggles or secondary screens.

5. **Fail gracefully, recover automatically.** If an API call fails, retry silently. If a variant pool slot expires, re-reserve transparently. Never show a customer a raw error message.

6. **One concept per screen.** Each admin page should do one thing well. Don't combine method management with config management. Don't show placement editing inline with view management.

### Polaris Usage (Smarter, Not Different)

The research supports staying with Polaris but using it more intentionally:

- **Use Polaris `Page` actions consistently** -- every page has one primary action, zero or more secondary
- **Use `IndexTable` with `IndexFilters`** for all list views -- not bare tables
- **Use `Layout.Section` + `Layout.AnnotatedSection`** for form pages -- description left, controls right
- **Use `CalloutCard` for actionable insights** -- not just informational banners
- **Use `ProgressBar` in setup guides** -- visual progress reduces perceived effort
- **Design all three states** -- empty (CTA to create), partial (progress indicator), full (operational view)

---

## Part 6: Technical Recommendations

### Quick Wins (Under 1 Week Each)

1. **Standardize error responses** across all API endpoints (JSON structure with `error.message`, `error.code`)
2. **Add cursor-based pagination** to order queries
3. **Add placement zone templates** (pre-set geometry values for common placements)
4. **Make TTL values configurable** (environment variables, not hardcoded)
5. **Add transaction wrapping** to slot reservation (single DB transaction for slot + config state updates)

### Architecture Changes

1. **State machine observability:** Add an `AuditLog` model that records every state transition for `VariantSlot` and `CustomizationConfig`. Enables debugging without raw DB queries.
2. **Idempotent storefront API calls:** Make `/prepare` and `/cart-confirm` idempotent so retries are safe. Use idempotency keys.
3. **Background job visibility:** Replace fire-and-forget patterns (variant pool provisioning, currency sync) with a simple job queue that surfaces failures in the admin dashboard.

### Data Model Evolution

The current 13-model schema is reasonable. For V2, consider:
- **`ProductTemplate` model** for pre-built templates (views + placements + geometry, not linked to any shop)
- **`ArtworkUploadToken` model** for customer post-purchase upload links
- **`AuditLog` model** for state machine observability
- **Rename `ProductConfig` to `CustomizationSetup`** or similar -- "config" is overloaded in software contexts

---

## Part 7: Implementation Sequence (V2 Scope)

Recommended order based on impact and dependencies. V2 covers P0 + P1 only.

### Phase 1: Foundation (Weeks 1-4)
- P0.1: Product Template Library
- P0.2: Simplified Onboarding (concept reduction)
- P0.4: Orders pagination/filtering/search
- P1.11: Placement Geometry Templates (needed by template library)
- Quick wins (error responses, TTL config, transaction wrapping)

### Phase 2: Core Experience (Weeks 5-8)
- P0.3: Dynamic Color-Matched Previews (three-path approach)
- P0.5: Customer Artwork Upload (order status extension)
- P1.7: Visual Placement Preview in Storefront
- P1.8: Batch Image Upload & Copy

### Phase 3: Operations (Weeks 9-12)
- P1.6: Workflow-Driven Dashboard
- P1.9: Basic Analytics
- P1.10: CSV/Data Export

### Phase 4: Polish (Weeks 13-16)
- P1.12: Multi-Language Support (i18n) — all surfaces (storefront modal, theme extension, customer account extension, admin dashboard)
- P1.12b: Merchant Translation Override Settings Page — per-locale customizable customer-facing strings
- Final QA, performance testing, documentation updates

---

## Appendix: Research Sources

### Codebase Audit
- Full traversal of `app/routes/`, `app/components/storefront/`, `app/lib/services/`, `prisma/schema.prisma`
- Review of all 3 documentation tiers (`docs/core/`, `docs/admin/`, `docs/storefront/`, `docs/notes/`)

### Competitive Analysis
- Zakeke, Customily, Inkybay, Kickflip, CPB, Teeinblue feature and pricing comparison
- Printful, Printify, SPOD, Gooten, CustomCat adjacent market review
- Shopify App Store reviews and ratings analysis

### UX Research
- Shopify App Design Guidelines and Polaris documentation
- SaaS onboarding best practices (interactive walkthroughs, progressive disclosure)
- Product configurator UX patterns (Framework Laptop, Herman Miller, Tylko)
- Dashboard design principles (action-driven, one focal metric per section)

### Technology Research
- Template systems: Placeit, Smartmockups, print-on-demand template structures
- 3D visualization: Three.js, `<model-viewer>`, Babylon.js feasibility analysis
- Color matching: HSL shifting, multiply-blend overlay, per-variant photography
- SVG silhouette approach for admin placement editing

### Persona Research
- Small business owner (1-person shop, 5-10 orders/week)
- Mid-size merch company (5-10 employees, 50+ orders/day)
- Enterprise/agency (5+ stores, 500+ orders/day)
