# V2 — Design Decisions, Review Findings & Open Todos

> **Consolidated from**: v2-design-review.md, v2-final-verification.md, v2-todo.md, v2-ux-decisions.md (all dated 2026-04-05)
> **Status**: Reference document. Items marked [DONE] are implemented. Unmarked items are still open.

---

## Design Decisions (finalized)

| Decision | Chosen | Why |
|----------|--------|-----|
| Nav items | 5 (Dashboard, Products, Methods, Orders, Settings) | Methods are cross-cutting. 6+ causes scan fatigue |
| Analytics | Dashboard tab, not separate nav | Weekly activity, not daily |
| Templates | Modal presets + duplicate button | Separate pages were redundant. 95% served by presets |
| Geometry editor | Merged into View Editor | Eliminates round-trip navigation |
| Methods detail | Inline editing on list page | Methods have ~2 fields. Separate page was a dead-end |
| Storefront step order | Upload first | 60% have logo ready. Rewarding them first builds engagement |
| Storefront pricing | Line items + ATC button only | Dark total bar was redundant |
| Quantity input | Text field, not stepper (+/-) | B2B buyers order 12-100 units |
| Progress bar | Step header pills only | 4px bar barely visible |
| "Logo later" | 48px card, not text link | B2B uses this ~40%. Must be visible |

## Expert Review Scores

| Reviewer | Score | Key Feedback |
|----------|-------|-------------|
| Senior UX Designer (12yr) | 7.5/10 | Strong IA, View Editor well-designed. Storefront step order suboptimal (A/B test candidate) |
| Shopify Partner Expert (50+ apps) | B+ | Would pass Built for Shopify. Orders improvements top priority |
| Flow Efficiency | Best-in-class setup speed | 3 clicks first product, 2 clicks order processing, 5 clicks customer flow |

---

## Priority 1 Fixes (from design review)

- [x] [DONE] Delete confirmations — show dependency count before destructive actions
- [ ] Step order A/B test candidate — Upload+Method first vs Method+Placement first (defer to post-launch data)
- [x] [DONE] Methods: inline editing on list page
- [x] [DONE] Reactive pricing on storefront Step 1 — include method fee in footer price
- [ ] ContextualSaveBar — use App Bridge SaveBar on all form pages (required for Built for Shopify)
- [x] [DONE] Price on ATC button — "Add to Cart — $70.00"

## Priority 2 Fixes

- [x] [DONE] Logo thumbnail in Review summary
- [ ] Close confirmation — change guilt-based copy to neutral: "You've configured [Method, Placement]. Close without adding to cart?"
- [x] [DONE] Contrast fixes — darken muted text from #9CA3AF to #6B7280
- [ ] Touch targets — qty buttons 36→44px, slider thumb 24→36px, close button 40→44px
- [ ] Method cards — add `role="radio"` + `aria-checked` semantics
- [ ] Step pills — add `aria-current="step"` to active pill
- [x] [DONE] Size context — "Logo size" disambiguation from Shopify garment size

## Priority 3 (Nice to Have)

- [ ] "+$3.00" animation next to selections that change the total
- [ ] Skeleton/loading states on admin pages
- [ ] "View in Shopify" link on Order Detail
- [ ] Trust signals on Review step ("Secured by Shopify")
- [ ] "What happens after I order?" line below ATC

---

## Open Implementation Todos

### Critical
- [ ] Storefront draft persistence — `localStorage` instead of `sessionStorage`
- [ ] Geometry editor unsaved-changes — `beforeunload` + React Router `useBlocker`
- [ ] 0-methods guard — reject products with 0 methods linked
- [ ] 0-placements guard — reject products with 0 placements

### Important
- [x] [DONE] Single-placement auto-select
- [x] [DONE] Single-size auto-apply (skip slider for 1 tier)
- [ ] Artwork re-upload — allow replacing uploaded artwork on both sides
- [x] [DONE] Presigned URL refresh on step transitions
- [x] [DONE] 1-method auto-select — collapse method section for single method
- [x] [DONE] Auto-navigate to Product Detail after creation

### Image Manager
- [x] [DONE] Image Matrix UI (color x view grid)
- [x] [DONE] Image Tray with drag-to-assign
- [ ] Import from Shopify — query `variant.media` images
- [x] [DONE] Smart defaults per view
- [x] [DONE] Copy/apply across variants
- [x] [DONE] Completeness indicator

---

## Terminology Rules (apply everywhere)

- "Product setup" (never "configuration")
- "Print area" in admin, "placement" in storefront
- "Preset" (never "template")
- "Artwork pending" / "Artwork provided" for status badges
- "Logo size" (never just "Size" — conflicts with Shopify garment size)
- "Estimated total" on storefront Steps 2-3

---

---

## V2.1 View Editor Rework (NOT YET IMPLEMENTED)

> Design file: `admin-dashboard-v2.1-final.pen`
> Design notes: memory file `project_v21_view_editor_notes.md`

### Admin View Editor — Right Panel

Architecture: **Zone-centric** (no tabs). Single scrollable panel. Click a zone to expand its configuration.

**What was REMOVED from the right panel:**
- [ ] Position X/Y/W percentage inputs — canvas handles positioning via drag & drop
- [ ] Quick Start Presets section — replaced by "Clone layout from another setup"
- [ ] Shared Zones toggle — always shared, toggle removed

**What was ADDED:**
- [ ] **Logo sizes section** per zone — always at least 1 size (no toggle, no "0 sizes" state):
  - **1 size (default)**: Single row with radio filled (always default), editable name + price fields. Helper text: "Only one size — customer gets this automatically. Add more to let them choose." Storefront auto-skips the size step.
  - **2+ sizes**: Editable inline rows, each with: drag handle (reorder) + radio button (default selector) + name input + price adjustment input + delete X. Default row highlighted in blue. "+ Add size" link at top.
  - **Default size dropdown**: Separate select field above the tier list. Clearly shows which size is pre-selected for customers. Not crammed into the rows — its own labeled field.
  - **Price adjustments support negative values**: Smaller sizes can be cheaper (discount). Color-coded: green for negative (discount), gray for zero, amber for surcharge. The `priceAdjustmentCents` field in PlacementStep already supports negative integers — no schema change needed.
  - **"Hide price when €0" checkbox** below the tier list.
- [ ] **Scale factor column**: Only visible when 2+ sizes exist. Each row shows name + scale + price as editable inputs. Scale is relative to the zone size (0.5x = half the zone width, 1.0x = full zone width). When there's only 1 size, scale is always 1.0x and the column is hidden — no point showing it.
- [ ] Persistent pricing summary footer showing calculated customer price (method + placement + size)
- [ ] "Clone layout from another setup" button opening a modal with product setup selector
- [ ] Compact collapsed zone cards showing pricing summary badges (e.g., "€0 · 3 sizes" or "$5 · fixed")
- [ ] Empty state: "Select a print area" with icon and guidance text when no zone is selected

### Storefront Modal — Size Step Changes

- [ ] When placement has 2+ sizes: Replace the range slider with **clickable cards**. Each card shows: tier letter, name, description, price delta. Selected card has blue border. Live preview updates above. Step pill reads "Logo size".
- [ ] When placement has exactly 1 size: Replace the "Logo size" step with a **"Preview"** step. Show a confirmation-style preview of the logo at the fixed zone size with "Ready to add to cart" message. Step pill reads "Preview".
- [ ] When ALL placements have 1 size: Auto-skip the preview step entirely (already auto-skips for single-step — same behavior, no code change needed).
- [ ] Step header: "Logo size" (2+ sizes) or "Preview" (1 size) — never just "Size" (conflicts with Shopify garment size)

### Cascading Changes to Other Pages

- [ ] **Product Detail**: Add green "Pricing Summary" card in right sidebar showing per-placement price ranges and total range
- [ ] **Create Setup Modal**: Make "Duplicate existing setup" the highlighted default option with config selector showing zone/view counts
- [ ] **Clone Modal**: Full overlay modal with product setup list, selection state, yellow warning ("overwrites positions, pricing preserved"), Cancel/Apply actions

### Ruler / Calibration Tool (V2.1 scope — simple version)

- [ ] **Toolbar button**: Small ruler icon in the canvas toolbar area. Click enters "Ruler mode".
- [ ] **Ruler mode**: Purple hint bar replaces the canvas hint with "Click two points on the image to measure a known distance" + "Esc to cancel". Canvas cursor changes.
- [ ] **Interaction**: Click point A → click point B → purple line + two endpoints appear on canvas → popover anchored to midpoint with: distance input field + unit dropdown (cm/in) + Apply/Cancel buttons.
- [ ] **On Apply**: Stores `calibrationPxPerCm` on the ProductView. Calculates `pixelDistance / realWorldDistance`. Stored in image-space coordinates (not screen-space) so zoom/resize doesn't affect it.
- [ ] **Calibrated state**: Purple dimension badges appear on zones on canvas (e.g., "~8 cm"). Zone list shows matching purple badges (e.g., "~8 × 6 cm"). Calibration bar below canvas shows "Calibrated: 30 cm reference · Recalibrate" link.
- [ ] **Recalibrate**: Clicking "Recalibrate" re-enters ruler mode to draw a new line.
- [ ] **Schema change**: Add `calibrationPxPerCm Float?` to ProductView model. One nullable field.
- [ ] **Screen-size consistency**: Calibration is stored as image-relative. Display dimensions are derived: `realWorldCm = (zoneWidthPercent / 100) * imageWidthPx / calibrationPxPerCm`. This is zoom/resize invariant because both the zone and the calibration reference the same image coordinate space.

### View Selector Overflow (6+ views)

- [ ] Replace tab bar with a **dropdown selector** when views exceed what fits. Shows "Front" with "1 of 6" badge + chevron. Click opens a searchable popover listing all views with checkmark on active.
- [ ] "Add view" button stays visible next to the dropdown.
- [ ] Scales to any number of views without layout changes.

### Variant Selector Overflow (8+ variants)

- [ ] Replace pill bar with a **dropdown selector**. Shows "Black / S" with "1 of 12" badge + chevron. Click opens a searchable popover listing all variants.
- [ ] **"Apply to all" button** stays visible next to the dropdown. Copies the current variant's image/geometry to all other variants.

### Clone Copies Everything

- [ ] Clone modal copies ALL data: print areas, positions, sizes, and pricing. The warning reads: "This will replace all print areas, positions, sizes, and pricing in this setup."
- [ ] Clone modal has a searchable scrollable list (same pattern as Create Setup). Not a static 3-item list.

### Schema: Minimal Changes

- Sizing: Every placement has at least 1 PlacementStep. 1 step = fixed size (storefront auto-skips). 2+ steps = customer gets card picker. No new fields needed — just enforce minimum 1 step in the UI.
- Ruler: Add `calibrationPxPerCm Float?` to ProductView. One nullable field, one migration.
- Overflow: View/variant selectors are pure UI changes — no schema impact.

---

## Still Open (from earlier reviews, NOT YET DONE)

### Critical
- [x] [DONE] ContextualSaveBar — use App Bridge SaveBar on all admin form pages (implemented on 4 pages)
- [x] [DONE] Storefront draft persistence — `localStorage` with loadDraft wired up on mount
- [ ] Geometry editor unsaved-changes — `beforeunload` + React Router `useBlocker`
- [x] [DONE] 0-methods guard — reject products with 0 methods linked
- [x] [DONE] 0-placements guard — reject products with 0 placements

### Important
- [x] [DONE] Close confirmation copy — neutral tone: "Close without adding to cart?"
- [x] [DONE] Touch targets — qty buttons 36→44px, slider thumb 24→36px, close button 40→44px
- [x] [DONE] Method cards — add `role="radio"` + `aria-checked` screen reader semantics
- [x] [DONE] Step pills — add `aria-current="step"` to active pill
- [ ] Artwork re-upload — allow replacing uploaded artwork on both merchant and customer sides
- [ ] Import from Shopify — query `variant.media` images in Image Manager

### Nice to Have
- [ ] "+$3.00" animation next to selections that change the total
- [ ] Skeleton/loading states on admin pages
- [ ] "View in Shopify" link on Order Detail
- [ ] Trust signals on Review step ("Secured by Shopify")

---

## V3 Items (captured here, detailed in v3-future-features.md)

- Ruler / Measurement Tool (calibration for real-world dimensions)
- Live Storefront Preview tab in View Editor
- 3D product preview (Three.js / model-viewer, UV-mapped logos)
- Shopify Flow triggers + actions
- Proof approval workflow
- Conversion rate analytics
- Brand theming for storefront modal
