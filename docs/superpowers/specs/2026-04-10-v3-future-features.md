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

## Features Deferred from Order Management Overhaul (2026-04-20)

### 13. Direct Artwork Reminder Email to Customer

Send artwork reminder emails directly from Insignia to customers who chose "add logo later," rather than the current copy-template-and-send-manually flow.

- Resend infrastructure already exists in `merchant-notifications.server.ts`
- Customer email available from Shopify Admin API at order detail time
- `orderStatusUrl` stored on `OrderLineCustomization` — usable as upload link until Feature 5 (Customer Upload Page) ships
- Anti-spam: add `artworkReminderSentAt DateTime?` to `OrderLineCustomization`; 24-hour cooldown
- Template system: `MerchantSettings.emailReminderTemplate` already exists for merchant customization
- Feature 5 (Customer Upload Page) must ship first to give customers a proper upload destination
- **Depends on**: Feature 5 (Customer Artwork Upload Page) for a real upload link

### 14. Production CSV Export

Per-line-item CSV export with full production data for decoration shops.

- Current export groups by order and has 5 columns — insufficient for production workflow
- Required columns: order name (#1001), customer name, product title, variant (size/color), placement name, logo size step, logo filename, artwork status, production status, quantity, decoration method, fee amount
- Support `orderIds` param for exporting selected orders from the bulk list actions
- UTF-8 BOM for Windows embroidery software compatibility
- There are two export routes that both need updating: `app/routes/app.orders.export.tsx` and `app/routes/api.admin.orders.export.tsx`

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

## Features from Admin UI Redesign Research (2026-04-21)

These were surfaced by a competitor UX study (Zakeke, Printavo, YoPrint, DecoNetwork, ShopVOX) and a three-persona merchant evaluation. They appear as disabled placeholders in the redesigned admin UI frames.

### 15. Production Queue / Kanban View

An alternative view mode on the Orders page with a view-mode toggle (List / Queue) in the page header. Kanban lanes are **method-as-lane** (Embroidery / DTG / Screen Print) — not status-as-lane. A shop with multiple decoration methods does not share a production queue across methods; each method routes to a different physical station. Status is a secondary axis within each method lane (cards within a column are ordered by production status).

- **Impact**: High for high-volume shops (Studio Dekora persona). The canonical production floor tool across Printavo, YoPrint, DecoNetwork, ShopVOX.
- **Complexity**: Medium. Requires a drag-and-drop library (`@dnd-kit/core`) + a board-layout query that groups by decoration method, then by status within each column.
- **Placeholder**: Disabled view-toggle (List | Queue icon buttons) in Order Table page header. Queue button disabled with tooltip "Coming soon."

### 16. Due Date / Rush Flag

A `dueDate DateTime?` field on `OrderLineCustomization` (or a new `OrderMeta` table covering all lines per Shopify order). Shown in the order list as a `Due Apr 22` cell that turns amber within 48h and red when overdue. Rush flag is a boolean that pins the order to the top of production lists and adds a visual indicator (colored left border on the row card).

- **Impact**: High for mid-size and high-volume shops. Every decoration platform studied (Printavo, YoPrint, DecoNetwork) has this. Merchants currently track deadlines in spreadsheets or sticky notes.
- **Complexity**: Low-medium. Schema migration + one date column + sort logic.
- **Placeholder**: Disabled `DatePicker` in order detail right sidebar. Disabled "Due date" column in order table.

### 17. Team Member Assignment

Assign an order (or individual line item) to a specific staff member. Requires a `ShopUser` table linking Shopify staff accounts to internal assignee roles. Assignee name appears in the order list row and on the order detail card header.

- **Impact**: Medium-High for shops with 3+ production staff. Eliminates "who's handling this?" check-in messages.
- **Complexity**: Medium-High. New data model + Shopify Staff API scoping.
- **Placeholder**: Disabled `Select` in order detail right sidebar labeled "Assign to team member."

### 18. Status History / Audit Log

A chronological timeline per order showing every status change, note, file upload, and email sent — with timestamp and actor. Displayed as a collapsible `Timeline` section at the bottom of the order detail page. Requires a new `OrderLineStatusEvent` table: `{ id, orderLineId, timestamp, actorId, fromStatus, toStatus, note }`.

- **Impact**: High for all shop sizes. Dispute resolution ("I never approved that"), accountability for teams, debugging production errors.
- **Complexity**: Low-medium. Event-sourcing write on every status mutation + read-side timeline component.
- **Placeholder**: Greyed "Status history — coming soon" card in order detail right sidebar with 2 dummy entries.

### 19. Bulk Artwork Download (ZIP)

A single button (or bulk action) that generates a ZIP archive of all logo files (SVG + PNG) for a filtered set of orders. The ZIP is organized by order number → placement name → filename. This is how decoration shops hand off artwork to their production machines — they don't process files order by order.

- **Impact**: Very high for high-volume shops. Studio Dekora persona's most-requested feature. Zakeke supports this per-order; no Shopify app does bulk.
- **Complexity**: Medium. Server-side ZIP generation using a streaming library (`archiver`). R2 pre-signed URL batch fetch.
- **Placeholder**: Disabled "Download artwork (ZIP)" item in Order Table bulk actions overflow menu.

### 20. Shareable Proof Link per Placement

A shareable URL per placement that shows the artwork preview for that specific placement. The customer can approve (with a timestamped signature) or request changes (with a required comment). Each placement has its own approval state; the order-level artwork badge rolls up to the worst individual status ("Partially Approved" / "All Approved" / "Changes Requested").

This is NOT an authenticated customer portal — it's a token-based stateless page accessible by link only. No customer accounts required.

- **Impact**: Very high — no other Shopify customization app does this at placement level. Eliminates "I approved the front but not the sleeve" disputes. Scoped narrower than the original "approval portal" concept but delivers the same core value with significantly lower complexity.
- **Complexity**: Medium. New route (`apps.insignia.approval.$token.tsx`), approval token (UUID) per placement stored on `OrderLineCustomization`, mobile-optimized read-only proof view, approve/reject state write.
- **Depends on**: Feature 5 (Customer Artwork Upload Page) for the customer-facing URL infrastructure pattern.
- **Placeholder**: Disabled "Send for approval" `Button variant="plain"` per placement in Order Detail.

### 21. In-App Customer Messaging Thread

A message thread per order that sends email to the customer (via Resend) and logs the conversation inline on the order detail page. Merchants type in context ("Your Back logo needs to be at least 300 DPI") without leaving Insignia or switching to their email client. Customer replies are ingested via Resend inbound email webhook.

- **Impact**: Medium for small shops (Nathalie), high for mid-size (Marcus). Eliminates platform switching for per-order communication.
- **Complexity**: High. Resend inbound parsing, message threading data model, customer reply routing.
- **Placeholder**: Disabled "Send message to customer" button below production notes in Order Detail.

### 22. Keyboard Navigation Across Orders

From the Order Detail page: `N` = next order, `P` = previous order, `→` = advance production status, `?` = open keyboard shortcuts overlay. Requires a sequence-aware URL pattern and client-side hotkey registration (`useHotkeys`).

- **Impact**: Medium for high-volume shops. Studio Dekora processes 50+ orders/day — eliminating list navigation clicks is meaningful at that scale.
- **Complexity**: Low. Client-side only. The order sequence can be inferred from the current filter state stored in the URL.
- **Placeholder**: Greyed keyboard shortcut hint at bottom of Order Detail: `↑↓ to navigate · → to advance status` (disabled, coming soon).

### 23. Stacked Print File Generation

Merchants can choose whether all designs in one order are stacked into one combined print file (for batch machine runs) or kept separate per placement. For embroidery shops running multi-head machines, one combined DST file per machine run is required. Zakeke added this in July 2024 as a power feature.

- **Impact**: Medium for embroidery shops running batch production.
- **Complexity**: Medium. Configuration per order + server-side file composition.
- **Depends on**: Feature 8 (Production-Ready File Export) as the generation infrastructure.

---

## Features Flagged from Polaris WC Migration (2026-04-22)

Surfaced during admin Orders WC migration Phase 3 review. All require backend/schema work beyond render-layer scope.

### 24. Virus-scan gating on artwork uploads
**Trigger:** Customer uploads a logo; schema has no `LogoAsset.virusScanStatus`. Admin shows artwork as "Provided" the moment S3 upload completes — no malware check between ingest and merchant download.
**Scope:** Add `LogoAsset.virusScanStatus: NOT_SCANNED | CLEAN | INFECTED`, async scan hook (R2 event / ClamAV / S3 antivirus), "Scanning…" badge in admin during NOT_SCANNED, block status advance for INFECTED.
**Impact:** Low for small merchants, legal/reputational defense for high-volume.

### 25. Fee-product variant drift warning
**Trigger:** Merchant deletes/changes a fee product variant referenced by an active order's `OrderLineCustomization.feeShopifyVariantId`.
**Scope:** Surface "Fee variant missing" indicator on affected order detail; fall back to `unitPriceCents` snapshot for display.
**Impact:** Rare edge; variant pool self-heals for new orders, historical orders can drift.

### 26. Backward status transitions ("Revert for rework")
**Trigger:** Decorator rejects a print after merchant marked a line `IN_PRODUCTION`.
**Scope:** Add `regress-production-status` intent with authorization; "Revert for rework" button on advanced status lines; audit log entry.
**Impact:** Medium — decoration-shop quality rework is a real workflow.

### 27. Mixed-line refund detection
**Trigger:** Shopify sends `orders/updated` with a refund on a customized line; OLC stays active with no visible warning.
**Scope:** Subscribe to `orders/updated` webhook; detect refund on customized items; surface "Partially refunded" banner with option to set terminal "Refunded" state on that line.
**Impact:** Low volume, trust-preserving.

### 28. Concurrent status advance conflict detection
**Trigger:** Two tabs / two users advance the same line simultaneously; today idempotent if values match but loses intermediate steps if they differ.
**Scope:** Optimistic lock via `version` field on `OrderLineCustomization` OR last-write-wins with conflict toast.
**Impact:** Low — multi-user shops only.

### 29. Artwork version history / immutable audit trail
**Trigger:** Re-uploading artwork for a placement overwrites `previewPngUrl` with no history.
**Scope:** Store uploads immutably; soft-delete on re-upload; `/uploads/:id/versions` endpoint; "Restore previous" action in admin.
**Impact:** Medium for enterprise, low for small merchants.

---

## Full Priority Order (updated)

| # | Feature | Effort | Impact | Prerequisite |
|---|---------|--------|--------|-------------|
| 1 | Ruler Tool + calibration wins | Medium | High (production value) | V2.1 shipped |
| 2 | Live Storefront Preview | Medium | High (differentiator) | V2.1 tab architecture |
| 3 | Bulk Apply Config | Low-Medium | High (time savings) | Clone infrastructure from V2.1 |
| 16 | Due Date / Rush Flag | Low-Medium | High (all shops) | None |
| 18 | Status History / Audit Log | Low-Medium | High (accountability) | None |
| 19 | Bulk Artwork Download ZIP | Medium | High (high-volume) | None |
| 10 | White-Label Modal | Low-Medium | Medium (enterprise) | None |
| 5 | Customer Upload Page | Medium | Medium (gap closure) | None |
| 13 | Direct Artwork Reminder Email | Low | High (friction) | Feature 5 |
| 20 | Per-Placement Approval Portal | High | High (differentiator) | Feature 5 |
| 14 | Production CSV Export | Low | High (mid-size) | None |
| 15 | Production Queue / Kanban | Medium | High (high-volume) | None |
| 17 | Team Member Assignment | Medium-High | Medium (teams) | None |
| 21 | In-App Customer Messaging | High | Medium (all shops) | None |
| 7 | Toast + Undo | Low | Medium (confidence) | None |
| 8 | Production File Export | High | High (production) | Ruler Tool |
| 22 | Keyboard Navigation | Low | Medium (high-volume) | None |
| 23 | Stacked Print File Generation | Medium | Medium (embroidery) | Feature 8 |
| 6 | Cmd+K | Low | Low (delight) | None |
| 11 | Public API | High | Medium (enterprise) | Stable V2.1 |
| 4 | Area-Based Pricing | High | Low (niche) | Ruler Tool + demand |
| 9 | 3D Product Preview | Very High | Medium (wow factor) | Demand signal |
| 12 | Multi-Store Management | Very High | Low (agency niche) | Public API |
