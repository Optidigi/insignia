# V3 — Future Features & Enhancements

**Date**: 2026-04-10
**Status**: Planning / Backlog
**Depends on**: V2.1 View Editor rework (tabs/pricing/clone) must ship first

---

## 1. Ruler / Measurement Tool — Advanced Features

> **Note**: The basic ruler (draw line, input distance, show zone dimensions) has been moved to **V2.1 scope**. See `v2-design-decisions-and-todos.md`. The items below are V3 enhancements that build on the basic calibration.

**Origin**: Zakeke's Ruler Tool pattern, adapted as an optional add-on.

### How it works

1. Merchant clicks a "Measure" tool icon in the View Editor canvas toolbar
2. Click point A on product image, click point B — a line appears with a distance input field
3. Merchant types the real-world distance (e.g., "30 cm")
4. System calculates `pixelsPerCm = pixelDistance / realWorldDistance`
5. Stored on `ProductView` as `calibrationPxPerCm` (nullable Float)
6. Unit preference (cm / inches) configurable in Settings or in the calibration popover — default from store locale

**Key principle**: This is optional. Everything works without it. Every feature below degrades gracefully to current behavior when `calibrationPxPerCm` is null.

### Schema change

```prisma
model ProductView {
  // ...existing fields
  calibrationPxPerCm  Float?   // pixels-per-cm from ruler tool; null = not calibrated
}
```

### What calibration unlocks (7 small wins, zero redesign)

#### 1.1 Storefront: Real dimensions in size step
Instead of "Medium (0.75x)", customer sees **"Medium — approx. 5.2 x 3.8 cm"**.
- Calculation: `zonePxWidth = maxWidthPercent * imagePxWidth`, then `cm = zonePxWidth * scaleFactor / pxPerCm`
- Falls back to current label if uncalibrated

#### 1.2 Admin zone list: approximate dimensions
Zone card subtitle shows **"~8 x 6 cm"** next to the zone name. Merchant sees what the zone means in physical terms.

#### 1.3 Auto-suggest step labels
When merchant creates size tiers, instead of typing "Small" / "Medium" / "Large" manually, system suggests **"~3 cm" / "~5 cm" / "~7 cm"** from scaleFactor x calibrated zone width. Merchant can override.

#### 1.4 Artwork quality warnings
At storefront upload, check: "This image is 300 DPI at Small but only 72 DPI at Large."
- `dpi = imagePixelWidth / (realWorldWidthCm / 2.54)`
- Show yellow warning on the size card if DPI drops below threshold
- Links to existing `artworkConstraints.minDpi` on DecorationMethod

#### 1.5 Clone dimension comparison
When using "Clone layout from...", warn: **"Left Chest on Polo = 8 cm, but on Hoodie maps to 12 cm — positions transfer but sizes differ."**
- Only possible when both source and target views are calibrated

#### 1.6 Order detail: production-ready dimensions
Instead of "scaleFactor: 0.75", production team sees **"Logo: 5.2 x 3.8 cm"**. What they actually need for embroidery/print.

#### 1.7 Pricing summary in real terms
**"Left Chest — Medium (5.2 cm): €3.00"** instead of **"Left Chest — Medium (0.75x): €3.00"**.

### Implementation scope
- Ruler tool UI: Konva line + two draggable endpoints + input popover (~1 component)
- Schema: 1 nullable Float on ProductView + migration
- Utility function: `getDimensionsCm(geometry, calibration): { widthCm, heightCm } | null`
- Touch points: SizeStep label, ZonePricingPanel subtitle, OrderDetail specs, PricingSummary — each is a conditional render

---

## 2. Live Storefront Preview Tab

**Origin**: V2.1 brainstorm spec Phase 3.

A third tab in the View Editor right panel that renders the actual customer customization modal inline. Updates live as zones and pricing change.

- **Mini modal preview** with sample logo
- **"Open full preview"** button launches the real storefront modal in a new window
- Addresses the #1 merchant complaint: "I never see what customers see until I visit the store myself"
- No competitor does this well — genuine differentiator

### Depends on
- V2.1 View Editor rework (the tab architecture must exist first)
- App proxy must support a preview mode that doesn't require a real Shopify session

---

## 3. Bulk "Apply Config to Products"

**Origin**: V2.1 brainstorm — Config Cloning Phase 2.

On the Product Detail page, a button: **"Apply this setup to other products"**. Opens a resource picker where merchant selects multiple Shopify products. The system stamps the same zones, pricing, and views onto each.

- Infrastructure exists: `product-configs.server.ts` → `duplicateProductConfig()`
- Missing: multi-product target selection + progress UI
- Cuts setup time by ~80% for typical merchants (30-80 products, most identical config)

---

## 4. Area-Based Pricing Mode (Advanced)

For professional print shops that price by square inch/cm. Merchant sets a rate, customer sees real dimensions and price updates with resize.

- Requires calibration (Feature 1 above) as prerequisite
- Requires continuous slider (not stepped) for customer sizing
- Schema: new pricing mode field on PlacementDefinition, rate field
- Target audience: ~10% of merchants (professional decorators)
- Only build if there's explicit demand from this segment

---

## 5. Customer Artwork Upload Page (Post-Purchase)

**Origin**: Designed in storefront-modal-v2.pen but never built. Gap report item.

Standalone page where customers upload logos after purchase (for "add logo later" flow). Includes:
- Order reference
- Upload area per placement
- "Submit Logo" action
- "Back to order status" link

Requires a new route: `apps.insignia.artwork.$orderId.tsx`

---

## 6. Cmd+K Command Palette

Quick-jump navigation for power users. Search across products, orders, methods, settings by name.

- Pattern: Linear, Notion, Vercel
- Low priority but high delight for returning merchants
- Could use a lightweight library like `cmdk`

---

## 7. Toast + Undo for Destructive Actions

5-second toast with "Undo" for zone deletion, view removal, method deletion. Merchants take bolder actions when they know they can reverse them.

- Soft-delete with TTL, or optimistic undo via client-side state restore
- Applies to: placement delete, view delete, method delete, config delete

---

## Priority Order

| # | Feature | Effort | Impact | Prerequisite |
|---|---------|--------|--------|-------------|
| 1 | Ruler Tool + calibration wins | Medium | High (production value) | V2.1 shipped |
| 2 | Live Storefront Preview | Medium | High (differentiator) | V2.1 tab architecture |
| 3 | Bulk Apply Config | Low-Medium | High (time savings) | Clone infrastructure from V2.1 |
| 5 | Customer Upload Page | Medium | Medium (gap closure) | None |
| 7 | Toast + Undo | Low | Medium (confidence) | None |
| 6 | Cmd+K | Low | Low (delight) | None |
| 4 | Area-Based Pricing | High | Low (niche) | Ruler Tool + demand signal |

---

## Features Deferred from V2 Research (2026-04-05-insignia-v2-research.md, items 16-20)

### 8. Production-Ready File Export

Per-order "Download production file" button. Generates a high-res composite image with exact placement dimensions, DPI specs, and method details (PDF or PNG at print resolution).

- **Impact**: Eliminates manual production file preparation
- **Complexity**: High (3-4 weeks). Server-side high-res rendering.
- **Note**: The Ruler Tool (Feature 1) makes this much more valuable — calibrated views produce accurate real-world dimensions in the export

### 9. 3D Product Preview

Optional Three.js-based 3D viewer. Logo UV-mapped onto a 3D model in real-time. Falls back to 2D for products without models. AR potential via `<model-viewer>`.

- **Impact**: Premium differentiator. Zakeke's main edge over Insignia.
- **Complexity**: Very high (6-10 weeks). Requires 3D model creation/sourcing per product type.
- **Note**: 2D with color matching covers 80%+ of use cases. Only pursue if merchants explicitly request it or as a paid premium tier.

### 10. White-Label Storefront Modal

Theming options for enterprise/agency merchants: custom colors, custom fonts, hide "Powered by" branding, custom CSS injection.

- **Impact**: Enterprise upsell opportunity
- **Complexity**: Low-medium (1-2 weeks)
- **Note**: Could be a quick win. The storefront modal already uses CSS custom properties.

### 11. Public API

REST API for: configs (CRUD), methods (CRUD), orders (read + artwork upload), settings (read/write). Token-based auth.

- **Impact**: Enables enterprise integrations and headless storefront support
- **Complexity**: High (4-6 weeks)

### 12. Multi-Store Management

Agency dashboard linking multiple store installations. Shared template library. Unified order view.

- **Impact**: Enterprise/agency tier unlock
- **Complexity**: Very high (8-12 weeks). New auth model + cross-store data layer.

---

## Full Priority Order (updated)

| # | Feature | Effort | Impact | Prerequisite |
|---|---------|--------|--------|-------------|
| 1 | Ruler Tool + calibration wins | Medium | High (production value) | V2.1 shipped |
| 2 | Live Storefront Preview | Medium | High (differentiator) | V2.1 tab architecture |
| 3 | Bulk Apply Config | Low-Medium | High (time savings) | Clone infrastructure from V2.1 |
| 10 | White-Label Modal | Low-Medium | Medium (enterprise) | None |
| 5 | Customer Upload Page | Medium | Medium (gap closure) | None |
| 7 | Toast + Undo | Low | Medium (confidence) | None |
| 8 | Production File Export | High | High (production) | Ruler Tool |
| 6 | Cmd+K | Low | Low (delight) | None |
| 11 | Public API | High | Medium (enterprise) | Stable V2.1 |
| 4 | Area-Based Pricing | High | Low (niche) | Ruler Tool + demand |
| 9 | 3D Product Preview | Very High | Medium (wow factor) | Demand signal |
| 12 | Multi-Store Management | Very High | Low (agency niche) | Public API |
