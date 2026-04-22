# Dead-Code Inventory: Polaris WC Migration for Order Routes

**Date:** 2026-04-22  
**Scope:** Render-layer candidates for removal from:
- `app/routes/app.orders._index.tsx`
- `app/routes/app.orders.$id.tsx`

Loaders and actions remain unchanged. Only render functions and their direct dependencies are evaluated.

---

## 1. Polaris React Imports Becoming Dead

| File | Line(s) | Imported Symbols | Usage in Loader/Action | Status |
|------|---------|------------------|------------------------|--------|
| `app.orders._index.tsx` | 9–29 | `Page, Layout, Card, useIndexResourceState, EmptyState, IndexTable, Badge, Text, Tabs, TextField, Select, InlineStack, Icon, Box, UnstyledLink, Pagination, Button, Filters, ChoiceList` | `useIndexResourceState` only (line 193) — used ONLY in render via selection state | **Safe to remove** |
| `app.orders._index.tsx` | 30 | `SearchIcon, ExportIcon` from `@shopify/polaris-icons` | Only in JSX buttons (lines 323, 339) | **Safe to remove** |
| `app.orders.$id.tsx` | 10–28 | `Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Divider, Banner, Box, Button, Collapsible, DropZone, Spinner, Thumbnail, TextField` | None in loader/action (lines 50–557) | **Safe to remove** |
| `app.orders.$id.tsx` | 29 | `ExternalIcon` from `@shopify/polaris-icons` | Only in JSX button (line 812) | **Safe to remove** |

**Finding:** All Polaris React imports in both files are render-only. The `useIndexResourceState` hook (line 193 in `_index.tsx`) is used for managing row selection state in the IndexTable and has no bearing on loader/action logic.

---

## 2. Local Helpers Used Only by Old Render

| File | Lines | Function | Server Use | Status |
|------|-------|----------|-----------|--------|
| `app.orders.$id.tsx` | 559–561 | `getDefaultTemplate(orderName, pendingCount, shopDomain)` | Loader: No. Action: No. (Called only in render at lines 618, 740) | **Safe to remove** |
| `app.orders.$id.tsx` | 563–566 | `sanitizeFilename(name)` | Loader: Used at line 119 (SVG asset filename). Action: No. | **Still used** — invoked in loader |
| `app.orders.$id.tsx` | 568–572 | `formatFileSize(bytes)` | Loader: No. Action: No. (Called only in JSX at line 979) | **Safe to remove** |
| `app.orders.$id.tsx` | 633–643 | `formatMoney(amount)` | Loader: No. Action: No. (Render only, lines 834, 848, 852, 857, 891) | **Safe to remove** |

**Note:** `sanitizeFilename` (line 563) is called during loader execution (line 119) to sanitize asset filenames for presigned URLs. It must remain or be moved to a utility module.

---

## 3. Polaris React-Specific Hooks No Longer Needed

| Hook | File | Line(s) | Consumers | Status |
|------|------|---------|-----------|--------|
| `useIndexResourceState` | `app.orders._index.tsx` | 13, 193 | Selection/bulk-action state in IndexTable render (lines 437–441, 451) | **Dead in render, no loader/action use** |
| N/A (Index Filters) | `app.orders._index.tsx` | Filters component at line 364 | Inline filter UI for artwork status only (render at lines 364–401) | **No hook used; Filters is a component** |
| N/A (Tab state) | `app.orders._index.tsx` | Tabs component at line 404 | Tab switching via URL params handled by router hooks (lines 189, 211–223) | **URL-based, not hook-based** |

**Finding:** `useIndexResourceState` is used only for the render-layer selection state (checkboxes in IndexTable). No server logic depends on it. The filters and tabs are managed via URL search parameters, not Polaris hooks.

---

## 4. Konva/Canvas Imports and Usage

| Import | File | Line(s) | Primary Usage | Dead Status |
|--------|------|---------|---------------|-------------|
| `react-konva` | `app/components/OrderLinePreview.client.tsx` | 7 | Read-only Konva canvas rendering placement zones on product images (lazy-loaded by `app.orders.$id.tsx` line 38) | **Not dead** — still needed; only file reference changes |
| `konva` | `app/components/PlacementGeometryEditor.tsx` | 10 | Admin canvas editor for defining zone geometry. Consumed by `app.products.$id.views.$viewId.tsx` (line 1408), NOT the order routes. | **Out of scope** |
| (HTML Canvas 2D) | `app/components/storefront/NativeCanvas.tsx` | (No Konva) | Storefront product customization canvas. Consumed by `CustomizationModal`, `PlacementStep`, `SizeStep`. | **Out of scope** (not admin) |

**Verdict:** `OrderLinePreview.client.tsx` uses Konva to display a read-only preview of placements on product images. It is only imported by `app.orders.$id.tsx` (lazy load at line 38–39). The component itself is safe — only the render pathway disappears. `PlacementGeometryEditor` (used in products, not orders) remains.

---

## 5. Stale "Logo" Terminology in UI Strings

| File | Line(s) | String Context | Reference Type | Status |
|------|---------|----------------|-----------------|--------|
| `app.orders.$id.tsx` | 951 | `alt="Logo"` in `<Thumbnail>` | Accessibility alt text (not visible to user) | **Acceptable** — part of new Polaris component prop |
| `app.orders.$id.tsx` | 956 | `<Text>LOGO</Text>` | Fallback UI when no thumbnail available (JSX text node) | **Stale terminology** — should route through terminology module in WC render |
| `app.orders._index.tsx` | None found | N/A | N/A | N/A |

**Finding:** One hardcoded "LOGO" string in a fallback UI box (line 956). All other references are data field names (`logoAssetIdsByPlacementId`, `placeholderLogoImageUrl`) or asset metadata, which are legitimate.

---

## 6. Stale Enum Rendering (Raw Status Strings)

| File | Line(s) | Enum String | Context | Render or Server | Status |
|------|---------|-------------|---------|------------------|--------|
| `app.orders._index.tsx` | 173–179 | `ARTWORK_PENDING, ARTWORK_PROVIDED, IN_PRODUCTION, QUALITY_CHECK, SHIPPED` | `STATUS_PRIORITY` map (server-side priority logic) | **Server** (loader, line 150–154) | **Still used** |
| `app.orders._index.tsx` | 485 | `order.latestStatus.replace(/_/g, " ")` | Badge text rendering (e.g., "IN PRODUCTION") | **Render** | **Stale string render** |
| `app.orders.$id.tsx` | 43–47 | `ARTWORK_PENDING, ARTWORK_PROVIDED, IN_PRODUCTION, QUALITY_CHECK, SHIPPED` | `PRODUCTION_STATUS_ORDER` array (action validation) | **Server** (action, lines 449, 499, 510) | **Still used** |
| `app.orders.$id.tsx` | 866, 1026 | `step.label` from `WORKFLOW_STEPS` array | Rendered UI labels (lines 625–631 define steps; line 1026 renders label) | **Render** | **Render-only labels** |

**Finding:** Enums in `STATUS_PRIORITY` and `PRODUCTION_STATUS_ORDER` are server-side (loader/action). However, raw enum strings are rendered directly to the UI (line 485 in `_index.tsx` renders "IN_PRODUCTION" as "IN PRODUCTION" via string replacement). The `WORKFLOW_STEPS` array in `$id.tsx` contains pre-formatted labels, so no raw enum strings leak into JSX there.

---

## 7. Test Files Exercising Old Render

| Test File | Location | What It Tests | Status |
|-----------|----------|---------------|--------|
| (None found) | N/A | No dedicated route tests for `app.orders._index` or `app.orders.$id` render output | **N/A** |

**Finding:** No tests were found in `app/routes/__tests__/` or `app/lib/services/__tests__/` that exercise the React-rendered output of these two routes. The existing test suite appears to focus on server logic (storefront cart, webhook handling, etc.).

---

## 8. Components Consumed Only by Old Render

| Component | File | Lines Consumed | Other Consumers | Status |
|-----------|------|-----------------|-----------------|--------|
| `OrderLinePreview` | `app/components/OrderLinePreview.client.tsx` | Lazy-imported by `app.orders.$id.tsx` (38–39); rendered at line 920 | None found (grep result: 3 files total) | **Deletable at phase cutover** if render is fully replaced by Polaris WC |
| `ArtworkUploader` | Defined inline in `app.orders.$id.tsx` (lines 1114–1220) | Used only within same file at line 989 | None (inline function) | **Deletable at phase cutover** |

**Analysis:** Both components are exclusive to the order detail page render. `OrderLinePreview` is a separate file and could be deleted when the Konva preview is replaced by the WC equivalent. `ArtworkUploader` is a render-layer helper function defined inline in the route and will be removed with the render rewrite.

---

## Summary Table: Removal Candidates by Phase

| Category | Item | Phase | Justification |
|----------|------|-------|---------------|
| **Polaris Imports** | All 27 symbols from `@shopify/polaris` + icons | Phase 2 (Render cutover) | Replaced by Polaris WC bundle |
| **Hooks** | `useIndexResourceState` | Phase 2 | Handled by WC table component |
| **Local Helpers** | `getDefaultTemplate`, `formatFileSize`, `formatMoney` | Phase 2 | Render-only; move to utility if needed elsewhere |
| **Local Helpers (keep)** | `sanitizeFilename` | On-demand | Used in loader for filename safety |
| **Components** | `OrderLinePreview.client.tsx` | Phase 2 | Replaced by WC canvas component |
| **Inline Functions** | `ArtworkUploader` | Phase 2 | Render-layer helper |
| **UI Strings** | "LOGO" fallback at line 956 | Phase 2 | Replace with WC terminology |
| **Enum Usage** | Status enums in render (line 485) | Phase 2 | Server enums stay; render strings must route through WC |

---

## Risk Flags

1. **`sanitizeFilename` in loader:** Line 119 uses this helper in the loader. Do NOT delete without confirming the new implementation has equivalent protection.
2. **Enum rendering (line 485):** The direct `.replace(/_/g, " ")` pattern on raw enum strings is fragile. The WC implementation should use a terminology map.
3. **No tests:** Routes lack render-specific tests, so changes carry higher regression risk. Recommend snapshot or E2E test for phase cutover.
4. **Konva canvas transition:** `OrderLinePreview.client.tsx` will be replaced by a Polaris WC component; ensure parity in placement visualization.

---

**Report Generated:** 2026-04-22 by Claude Code research agent  
**Confidence Level:** High (full codebase scan with line-specific citations)
