# Canvas Consolidation: NativeCanvas for Admin Order Detail

**Date**: 2026-04-22  
**Status**: Research only — no source modified  
**Scope**: Replace Konva-based `OrderLinePreview.client.tsx` with an extension of `NativeCanvas.tsx` for the order detail page.

---

## 1. Current-State Inventory

### NativeCanvas (`app/components/storefront/NativeCanvas.tsx`)

**Props** (lines 34–63):

| Prop | Type | Purpose |
|---|---|---|
| `imageUrl` | `string` | Product view image |
| `logoUrl` | `string \| null` | **Single** logo URL applied to all placements |
| `placements` | `CanvasPlacement[]` | Position/size metadata for each zone |
| `highlightedPlacementId` | `string \| null` | Optional single-placement highlight (blue stroke) |
| `sizeMultiplier` | `number` (deprecated) | Legacy global scale override |
| `headless` | `boolean` | Suppress built-in loading/error UI |
| `onLoadStateChange` | callback | Reports `loading \| ready \| error` |
| `onImageMeta` | callback | Reports product image natural dimensions |
| `onLogoMeta` | callback | Reports logo natural dimensions |

**What it renders**: One product image on a 2D canvas. The same single `logoUrl` is drawn at every `CanvasPlacement` position in the array (lines 152–179). Highlighted placement gets a blue `strokeRect`; others render at 0.85 alpha. Max canvas dimension is 700 px; aspect ratio is preserved. Built-in fallback shows a grey placeholder on load and an error string on failure.

**Key gap**: `logoUrl` is a single string. There is no way to supply per-placement logos through the existing API.

### Admin OrderLinePreview (`app/components/OrderLinePreview.client.tsx`)

**Props** (lines 20–25):

| Prop | Type | Purpose |
|---|---|---|
| `imageUrl` | `string` | Product view image |
| `placements` | `Array<{id, name}>` | Placement definitions |
| `geometry` | `Record<string, PlacementGeometry \| null>` | Per-placement bounding box |
| `logoUrls` | `Record<string, string \| null>` | **Per-placement** logo URL map |

**What it renders**: A Konva `Stage` (square, 400 px base, responsive via `ResizeObserver`). Draws a background image covering the full stage (aspect is lost — always square). For each placement that has geometry, draws a coloured `Rect` zone overlay. If the placement has a logo loaded it scales-to-fit letterboxed inside the zone; otherwise it renders the placement name as `KonvaText`. Loads logos in parallel and re-renders on completion.

### What Konva gives us that NativeCanvas doesn't

1. **Per-placement logo images** — `logoUrls` is a keyed map; NativeCanvas uses a single URL.
2. **Rectangular zone overlays** — coloured fill + stroke border drawn as Konva `Rect` nodes. NativeCanvas only draws the logo; it has no zone-box concept.
3. **Responsive via `ResizeObserver`** — NativeCanvas uses CSS `max-width: 100%` scaling; Konva stage resizes its pixel dimensions. Both are effectively responsive but through different mechanisms.
4. **Logo letterboxed into zone bounds** — Konva scales each logo to fit within its zone. NativeCanvas scales the logo relative to `maxWidthPercent` and the image's natural aspect.
5. **Parallel logo loading** — both support this, though Konva coordinates all loads before the first setState call.

### Prototype `CanvasZoneView` (`in-scope.html`, lines 227–304)

The prototype is an HTML-only mock (no actual image: a grey `<div>` with a text label stands in). Its distinctive additions versus both implementations:

- **View switcher** — a `<s-button-group>` above the canvas that filters placements to those on `activeView` (lines 229–246). Neither existing canvas component has this.
- **Coloured zone rectangles as absolutely-positioned `<div>` overlays** — uses `top/left/width/height` as percentage strings pulled from `p.zone`, colour-coded per placement (lines 258–275). This is a CSS approach, not canvas drawing.
- **Legend row** below the canvas: coloured dot + placement name for each active placement (lines 283–293).
- **Download-all button** in the legend row, only rendered when there are placements on the current view (lines 295–299). It is a sibling of the canvas `<div>`, not inside it.
- **No logo rendering at all** — the prototype shows a `✓` checkmark when artwork is provided, not the actual artwork.

---

## 2. Gap Analysis

The admin Order detail needs all of the following from a unified canvas:

| Requirement | NativeCanvas today | Gap |
|---|---|---|
| Per-placement logos (different artwork per zone) | No — single `logoUrl` | Must add `logoUrlByPlacementId?: Record<string, string \| null>` |
| View switching (Front / Back / Left / Right) | No | Must add `activeView` filtering above or inside the canvas |
| Zone rectangle overlays (coloured fill + stroke) | No | Must add a draw pass for zone boxes |
| Hover/highlight per zone | Partial — `highlightedPlacementId` draws a blue outline on the logo rect, not a zone rect | Overlay must target zone box, not logo box |
| Download-all button | Not a canvas concern — prototype places it outside canvas | Caller concern; not inside canvas |
| Logo-load failure → fallback | `onerror` path sets `error` state, shows "Image could not be loaded" for the whole canvas | Should degrade per-placement (show placeholder or zone text) rather than full canvas error |
| Presigned URL expiry → re-fetch | Not addressed by either implementation | Caller concern: loader re-generates URLs at 3600 s TTL; canvas itself should not retry |

**Hover / highlight**: The existing admin page has no hover interaction on the canvas. Not needed for Phase 4; `highlightedPlacementId` can remain available for future use.

**Presigned URL expiry**: The loader already generates URLs with a 3600 s TTL. Stale URL handling is a caller concern (trigger a `revalidate`). The canvas should not retry internally.

---

## 3. Extension Plan

**Recommendation: Path A — extend `NativeCanvas.tsx` in place.**

Reasoning: The storefront caller only uses `logoUrl` (single string). If the new prop is optional and the existing single-logo code path is preserved when `logoUrlByPlacementId` is absent, all three storefront callsites are entirely unaffected. The canvas engine is already Canvas 2D; there is no architectural tension with adding a zone-rect draw pass or a per-placement logo map. Creating a wrapper (`PlacementCanvas.tsx`) would add a file and an import indirection with no benefit — the admin page already lazy-loads via `OrderLinePreviewLazy`; swapping the import is trivially the same work.

**Proposed new API shape (pseudo-code):**

```ts
// --- new optional props added to NativeCanvasProps ---
type NativeCanvasProps = {
  // ... all existing props unchanged ...

  /**
   * Per-placement logo URL map. When supplied, overrides `logoUrl` for each
   * placement that has an entry. Placements with a null entry render the
   * zone box only (no artwork). Falls back to `logoUrl` for placements not
   * in the map.
   */
  logoUrlByPlacementId?: Record<string, string | null>;

  /**
   * When true, draws a coloured rectangular zone outline (fill + stroke) for
   * every placement in `placements`, regardless of whether artwork is present.
   * Default false (storefront path does not need zone boxes).
   */
  showZoneOverlays?: boolean;

  /**
   * Zone colour palette. Index cycles if there are more placements than colours.
   * Defaults to the ZONE_COLORS constant defined in the admin.
   */
  zoneColors?: Array<{ fill: string; stroke: string }>;
};
```

The draw function gains a second pass: when `showZoneOverlays` is true, it draws `Rect`-equivalent fills and strokes **before** drawing logos. Per-placement logos are resolved by checking `logoUrlByPlacementId[placement.id]` first, then falling back to `logoUrl`. Logo loading is expanded to accept a map of `HTMLImageElement | null` keyed by `placementId` alongside the existing single `logoImgRef`.

The view-switcher (`activeView` filter) is intentionally **not** added to NativeCanvas — it is a layout concern belonging to the page component or a new `CanvasWithViewSwitcher` presenter that renders a view-tab bar above a `<NativeCanvas>` instance. This keeps the canvas itself stateless with respect to view selection.

---

## 4. Konva Code That Becomes Deletable at Phase 4 Cutover

### `app/components/OrderLinePreview.client.tsx`
- **Used by**: `app/routes/app.orders.$id.tsx` (lazy import at line 38–40, only callsite)
- **Konva imports**: `react-konva` (`Stage`, `Layer`, `Image`, `Rect`, `Text`, `Group`)
- **Deletable at cutover**: Yes. Once `app.orders.$id.tsx` switches its lazy import to the extended `NativeCanvas`, this file has zero callers. Verify with `grep -r "OrderLinePreview" app/` before deleting.

### `app/components/PlacementGeometryEditor.tsx`
- **Used by**: `app/routes/app.products.$id.views.$viewId.tsx` — the admin zone editor
- **Konva imports**: `react-konva` (`Stage`, `Layer`, `Image`, `Rect`, `Transformer`, `Line`) and `konva` type import
- **Deletable at cutover**: **No.** This component serves the drag-to-place zone editor on the product configuration page. It is unrelated to the order detail canvas and must remain. Konva stays as a dependency for this editor surface.

**Conclusion on the Konva dependency**: `react-konva` and `konva` cannot be fully removed from the project at Phase 4 because `PlacementGeometryEditor.tsx` requires them. The dependency shrinks in surface area (one fewer lazy bundle split) but does not drop to zero.

---

## 5. View-Switching Data

The loader in `app/routes/app.orders.$id.tsx` already computes `linePreviewData`, a `Record<lineId, ViewPreview[]>` where each `ViewPreview` contains `viewId`, `viewName`, `imageUrl`, `geometry`, and `logoUrls` (lines 252–333). Views are only included when `vc.imageUrl` is set (line 294).

**How `views[]` is derived for each product type:**

**Premium Polo** (`views: ['Front', 'Back', 'Left', 'Right']` in the prototype): The loader iterates `variantViewConfiguration` rows scoped to the line's `productConfigId` and `variantId`. Each row that has an `imageUrl` contributes one `ViewPreview`. A four-view polo has four `VariantViewConfiguration` rows for the variant. The `ProductView.perspective` enum supports `front | back | left | right | side | custom`, so all four polo views map to existing enum values. The `viewName` in `ViewPreview` comes from `vc.productView?.name` — this is the merchant-set `name` column on `ProductView`, not the enum, so display labels are correct without code changes.

**Cap** (`views: ['Front']`): A cap config typically has one `ProductView` (Front) and one `VariantViewConfiguration` per variant. `linePreviewData` will return a single-element array. The `CanvasZoneView` prototype already omits the button-group when `views.length <= 1` (line 229), so single-view products need no special casing.

**Hoodie** (`views: ['Front', 'Back']` — realistic third type): Same derivation as the polo but with two views. Both views require a `VariantViewConfiguration` row with an `imageUrl`. No backend changes needed if the merchant has configured those views.

**Is this already in `linePreviewData`?** Yes. `linePreviewData[lineId]` is an array of `ViewPreview` objects, one per view that has a signed image URL. The `viewName` field is the display label. No backend work is required to expose view arrays to the canvas layer — the data is already shaped and returned from the loader. The only wiring needed is: read `linePreviewData[line.id]`, maintain `activeViewIndex` state in the React component, and pass the current view's `imageUrl`, `geometry`, and `logoUrls` down to `NativeCanvas`.
