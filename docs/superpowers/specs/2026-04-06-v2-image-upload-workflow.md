# V2 Image Upload Workflow — Research & Design Spec

> **Date:** 2026-04-06 (revised after second research pass)
> **Goal:** Make the tedious process of uploading product variant images (N colors × M views = N×M images) as frictionless as possible for V2, using a fully manual (non-3D) workflow.
> **Context:** 3D rendering is deferred to V3. V2 uses merchant-uploaded photos for all variant/view combinations.

---

## 1. Problem Statement

A product with 10 color variants × 3 views (front, back, left) = **30 image slots** to fill. Current flow uploads one image at a time with one API call each — 30 tedious iterations. Merchants doing this for 20+ products will abandon the app.

The goal is to reduce perceived and actual effort from "30 manual uploads" to "a few intentional actions that fill the matrix intelligently."

---

## 2. Industry Research: How Does Everyone Else Do This?

### 2A. The Universal Truth

**Zero platforms auto-detect which image is "front" vs "back."** Not Printful, Printify, Inkybay, Zakeke, Spreadshirt, DecoNetwork, InkSoft, or any Shopify app. No AI detection. No filename parsing. No position-based guessing.

The entire industry uses one pattern: **named slots that the merchant fills explicitly.**

### 2B. Competitor Workflows

| Platform | How images get assigned to views |
|----------|--------------------------------|
| **Printful** | Pre-defined product templates with tabbed print areas (Front, Back, Sleeve). Merchant clicks a tab, uploads into that specific slot. |
| **Printify** | Same: template-driven, click zone on product preview, upload into that zone. |
| **Zakeke** | **Auto-pulls product's main image from Shopify** for the first side. Merchant adds more sides manually. Each side = explicit upload. |
| **Inkybay** | Merchant clicks "+ New Part" to add a side, names it, uploads transparent PNG for that side. Fully manual. |
| **Spreadshirt** | Platform owns the product catalog — zones are pre-defined per product type. Merchant never uploads product photos. |
| **Shopify native** | Images are an ordered list with no semantic view tags. Variant images assigned via click-to-pick from gallery. |
| **Variant Image Wizard** | Drag-drop from image pool to variant slots. Manual assignment. |

### 2C. UX Research: Slot-First vs Upload-First

| Pattern | Best for | Accuracy | Speed |
|---------|----------|----------|-------|
| **Slot-first** (labeled empty containers, fill each one) | Small fixed slot count (2-6), semantically distinct slots | High — user's click IS the categorization | Moderate |
| **Upload-first** (bulk upload, then tag/categorize) | Large numbers (10-50+), optional slots | Lower — users skip tagging step | Fast upload, slow tagging |
| **Hybrid** (slots + staging tray) | Medium counts, mix of bulk and targeted | High — explicit assignment after fast upload | Best of both |

**For Insignia:** Typically 2-4 views × 3-15 color groups = 6-60 cells. The **hybrid pattern** fits best: named slot matrix with a staging tray for bulk drops.

### 2D. The Line Between Helpful and Guessing

| We CAN do (certain) | We CANNOT do (guessing) |
|---------------------|------------------------|
| Auto-pull existing images from Shopify variant media | Auto-detect which image is front vs back |
| Group variants by color (sizes share images) | Parse filenames to infer view assignment |
| Default one image across all colors for a view | Assume image order = view order |
| Let merchant explicitly copy/apply across cells | AI-based view classification |
| Bulk upload into a staging tray for manual placement | Any auto-assignment without merchant confirmation |

**Design principle:** Every image-to-cell assignment must be an explicit merchant action — a click, a drag, or a confirmed "apply to all." Never silent. Never assumed.

---

## 3. Shopify API Capabilities

- `ProductVariant.media` — connection to `MediaImage` nodes
- `stagedUploadsCreate` — batch presigned URLs
- `productVariantsBulkUpdate` — upload new media AND associate with variants simultaneously
- `productVariantAppendMedia` / `productVariantDetachMedia` — link/unlink existing product media
- `fileCreate` — up to 250 files per call
- Image limits: 20MB max, 4472×4472px, PNG/JPEG/WEBP/GIF/HEIC
- CDN transforms: `Image.url(transform: { maxWidth, crop, scale })`

**Key architectural note:** Variants reference parent product media — they don't own copies. Upload to product first, then link to variants.

---

## 4. Core Insight: Group by Color, Not by Variant

A merchant with 5 colors × 4 sizes has 20 Shopify variants but only needs **5 sets of images** (one per color). Sizes (S/M/L/XL) don't change the product photo.

The matrix groups variants by their **color option value**. All variants sharing the same color share images. This reduces the matrix from 60 cells to 15 cells — a **4× reduction** before any other QOL features.

**Detection logic:** Read `variant.selectedOptions`, find the option named "Color"/"Colour"/"Kleur" or the option with the most visually distinct values. All variants sharing that option value share images.

**Fallback:** If no color-like option is detected, show all variants as individual rows (no grouping). The merchant can still use defaults and copy/apply to reduce work.

---

## 5. The Image Matrix UI

### 5A. Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Product Images                                                  │
│                                                                  │
│  ┌─ Shopify Import (shown if existing images found) ────────────┐
│  │  We found 8 images already in Shopify for this product.       │
│  │  [Import to Image Tray]                                       │
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Image Tray (shown when images need assignment) ─────────────┐
│  │  [img1] [img2] [img3] [img4]  ... [+ Upload more]            │
│  │  Drag images to the correct cell below                        │
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│           │  Front        │  Back         │  Left Sleeve  │      │
│  ─────────┼───────────────┼───────────────┼───────────────┤      │
│  ■ Black  │  [thumbnail]  │  [thumbnail]  │  [  +  ]      │      │
│   S,M,L,XL│               │               │               │      │
│  ─────────┼───────────────┼───────────────┼───────────────┤      │
│  ■ Navy   │  [default ↓]  │  [  +  ]      │  [  +  ]      │      │
│   S,M,L,XL│               │               │               │      │
│  ─────────┼───────────────┼───────────────┼───────────────┤      │
│  ■ Red    │  [default ↓]  │  [  +  ]      │  [  +  ]      │      │
│   S,M,L,XL│               │               │               │      │
│                                                                  │
│  Progress: 5 of 9 cells filled  ██████░░░░ 56%                   │
│                                                                  │
│  [default ↓] = Using view default (click to override)            │
│  [  +  ]     = Empty — click to upload or drag from tray         │
└──────────────────────────────────────────────────────────────────┘
```

### 5B. Cell States

| State | Visual | Behavior |
|-------|--------|----------|
| **Empty** | Dashed border, `+` icon | Click opens file picker. Also a drop target for drag from tray. |
| **Default (inherited)** | Thumbnail with "Default" badge, slightly dimmed | Uses the view's default image. Click to replace with color-specific upload. |
| **Uploaded (color-specific)** | Full thumbnail, bright border | This color group has its own image. Hover shows Replace / Remove / Copy to... |
| **Uploading** | Progress ring overlay on thumbnail area | Upload in progress. |
| **Failed** | Red border, "!" icon, "Retry" text | Click to retry. |

### 5C. Cell Actions (hover menu)

- **Replace** — opens file picker for this specific cell
- **Remove** — reverts to default (if exists) or empty
- **Set as view default** — makes this the default for the entire column; all other color groups without specific uploads inherit it
- **Copy to...** — opens popover with checkboxes for other color groups × views

---

## 6. QOL Features — Detailed Design

### 6A. Import from Shopify (Priority 1 — Low effort, Very High impact)

**Trigger:** When a product is linked and Shopify variants have `.media` images.

**Flow:**
1. On product link, query `product.variants(first: 100) { media(first: 10) { ... on MediaImage { image { url } } } }`
2. Deduplicate (multiple variants may share the same image)
3. Show banner: "We found N images already in Shopify for this product."
4. On click "Import to Image Tray": download each image to R2, add to the **Image Tray** above the matrix
5. Merchant drags images from tray to the correct cells

**Why a tray, not auto-assignment:** Shopify has no metadata for "this is the front image." Assuming position or order would be guessing. The tray gives merchants their images without re-uploading, while they explicitly decide where each one goes.

### 6B. Image Tray (Priority 1 — ships with import)

**The tray is the staging area.** It holds images that haven't been assigned to cells yet.

**Sources that populate the tray:**
- Shopify import (images pulled from variant media)
- Bulk upload (multi-file picker or drag-drop onto the tray area)
- Individual upload (via "Upload more" button in the tray)

**Tray behavior:**
- Horizontal scrollable strip of thumbnails
- Each thumbnail is draggable → drop onto a matrix cell to assign
- Click a thumbnail to see it larger (lightbox)
- Images leave the tray when assigned to a cell
- If an image is removed from a cell, it returns to the tray (not deleted)
- "Clear tray" action to remove unneeded imports
- Tray is collapsible when empty

**This is the Airbnb/DAM hybrid pattern:** fast bulk upload, explicit manual assignment.

### 6C. Smart Defaults Per View (Priority 2 — Low effort, Very High impact)

**Concept:** The first image assigned to any cell in a view column can be promoted to the "view default." All other color groups without specific uploads inherit it.

**How it works:**
1. Merchant uploads/assigns image to "Black / Front" cell
2. Cell hover menu: "Set as view default" action
3. On click: all other color groups' "Front" cells that are empty show this image with a "Default" badge
4. Merchant overrides specific colors as needed

**NOT automatic:** The default is set by an explicit merchant action ("Set as view default"), not by being the first upload. This avoids confusion about which image is the default and why.

**Implementation:**
- `ProductView.defaultImageKey` field in DB
- Matrix rendering: if `VariantViewConfiguration` has no `imageUrl` for a color group's view, fall back to `ProductView.defaultImageKey`
- Default badge is purely visual — the inherited image IS the working image for storefront

**Impact:** 10 colors × 3 views → **3 uploads + 3 "set as default" clicks** + optional overrides. ~90% reduction for the typical case.

### 6D. Completeness Indicator (Priority 3 — Low effort, High impact)

- Progress bar: "5 of 9 cells filled — 56%"
- Empty cells have dashed border with `+` icon (visual scan)
- Defaults count as "filled" (they are valid working images)
- Rows with all cells filled get a subtle green checkmark

### 6E. Copy/Apply Across Variants (Priority 4 — Low effort, High impact)

**Actions on any filled cell:**

1. **"Set as view default"** — Applies to entire column. Already described in 6C.

2. **"Copy to..."** — Opens popover:
   ```
   Copy this image to:
   ☐ Navy / Front
   ☐ Navy / Back
   ☑ Red / Front
   ☐ Red / Back
   [Apply]  [Cancel]
   ```
   Creates explicit `VariantViewConfiguration` records with the same `imageKey`.

3. **"Apply to all empty cells"** — Fills every empty cell in the matrix with this image. For merchants with a single generic product photo (e.g., unbranded white tee from different angles).

### 6F. Bulk Upload to Tray (Priority 5 — Low effort, High impact)

**The tray's "Upload more" button and the tray area itself accept multi-file selection or drag-drop.**

- Standard `<input type="file" multiple accept="image/*">` with drag-drop overlay
- All uploaded files land in the tray
- No auto-assignment. No filename parsing. Merchant drags each to the right cell.
- Upload progress shown per file in the tray (progress ring on thumbnail)
- Failed uploads shown with error state and retry

**Why no filename parsing:** Filenames are unpredictable (`IMG_4521.jpg`, `DSC_0089.jpg`, `product-photo-2.png`). Auto-matching introduces uncertainty — wrong assignments are worse than no assignments because the merchant may not notice. The tray + drag approach is fast enough and 100% accurate.

---

## 7. Upload Queue & Progress

**Client-side queue manager:**
- Max 4 concurrent uploads to R2 via presigned URLs
- Per-file progress (XHR `progress` event)
- Aggregate: "Uploading 3 of 12..."
- Failed files: inline retry, don't block others
- All uploaded files land in the tray or directly in a cell (if uploaded via cell click)

**Backend batching:**
- `POST /api/admin/batch-upload-urls` — request N presigned URLs in one round-trip
- `POST /api/admin/batch-save-images` — upsert N `VariantViewConfiguration` rows in one transaction

---

## 8. Data Model Changes

### New field on `ProductView`:

```prisma
model ProductView {
  // ... existing fields
  defaultImageKey String?  // R2 storage key for view-level default image
}
```

### New index on `VariantViewConfiguration`:

```prisma
model VariantViewConfiguration {
  // ... existing fields
  @@index([productConfigId, viewId])  // Efficient batch queries per view
}
```

### Color group concept (runtime, not persisted):

```typescript
type ColorGroup = {
  colorValue: string;              // "Navy Blue"
  colorOptionName: string;         // "Color" (the Shopify option name)
  variantIds: string[];            // All Shopify variant GIDs with this color
  swatch?: string;                 // Hex color if available
  representativeVariantId: string; // First variant in group (used for R2 storage key)
};
```

---

## 9. API Endpoints (New)

### `POST /api/admin/batch-upload-urls`

Request array of items, returns array of presigned URLs. One round-trip for N uploads.

### `POST /api/admin/batch-save-images`

Transactionally upserts multiple `VariantViewConfiguration` records. Accepts `variantIds[]` per entry (one color group = multiple size variants sharing one image).

### `POST /api/admin/import-shopify-images`

Queries Shopify `product.variants.media`, downloads to R2, returns image list for the tray.

### `POST /api/admin/set-view-default`

Sets `ProductView.defaultImageKey`.

---

## 10. Complete Merchant Workflows

### Workflow A: Merchant with existing Shopify images (fastest path)

1. Create product setup, link Shopify product
2. App finds 8 existing variant images → shows import banner
3. Click "Import to Image Tray" → 8 thumbnails appear in tray
4. Drag each image to the correct cell (recognizable by visual content)
5. After first column is filled, "Set as view default" on one cell → other colors inherit
6. Override where needed
7. **Time: ~2 minutes. Uploads: 0.**

### Workflow B: Merchant uploading from scratch (typical path)

1. Create product setup, add views (Front, Back, Left)
2. See empty matrix: 5 colors × 3 views = 15 cells
3. Click `+` on "Black / Front" → upload front photo → appears in cell
4. Click "Set as view default" → all other colors' Front cells inherit
5. Repeat for Back and Left: **3 uploads, 3 default-sets**
6. Override Red/Front with a red-specific photo if needed
7. **Time: ~3 minutes. Uploads: 3-5.**

### Workflow C: Power merchant with many photos (bulk path)

1. Click "Upload more" on tray → multi-select 15 files
2. All 15 upload in parallel, land in tray as thumbnails
3. Drag each to the correct cell (merchant knows their own photos)
4. **Time: ~4 minutes. Uploads: 15, but all in one batch.**

### Workflow D: Simple product (single variant, no color option)

1. Matrix collapses to 1 row × N views
2. Click `+` on each view, upload
3. **Time: ~1 minute. Uploads: 2-3.**

---

## 11. Edge Cases

| Scenario | Handling |
|----------|----------|
| No color option (single variant) | Matrix = 1 row, all view columns. No grouping needed. |
| 50+ color variants | Paginate matrix rows. Show 20 at a time with "Show all" toggle. |
| Merchant uploads wrong image to cell | Replace via cell hover menu. Image returns to tray on remove. |
| Multiple images per variant from Shopify | All imported to tray. Merchant assigns manually. |
| View deleted after images uploaded | Cascade delete `VariantViewConfiguration` rows for that view. |
| File too large (>10MB) | Client-side validation before upload. Inline error on the specific file. |
| Upload fails mid-batch | Failed items stay in tray with error badge. Retry button. Others proceed. |
| Product has option named "Style" not "Color" | Detection heuristic falls back. Merchant can manually set which option represents color in product settings. |

---

## 12. Implementation Phases

### Phase A: Foundation (Backend)
- Prisma migration: `defaultImageKey` on `ProductView`, new index on `VariantViewConfiguration`
- `POST /api/admin/batch-upload-urls` endpoint
- `POST /api/admin/batch-save-images` endpoint
- `POST /api/admin/import-shopify-images` endpoint
- `POST /api/admin/set-view-default` endpoint
- Color grouping utility function

### Phase B: Matrix UI (Frontend)
- Color grouping logic (parse Shopify variant `selectedOptions`)
- Matrix grid component (rows = color groups, columns = views)
- Cell component with 5 states
- Per-cell click-to-upload
- Per-cell drop target (for drag from tray)
- Completeness indicator

### Phase C: Image Tray + QOL (Frontend)
- Image Tray component (horizontal scrollable strip, drag source)
- Shopify import flow (banner → import → tray)
- Bulk upload to tray (multi-file picker + drag-drop)
- Smart defaults (set default action + badge rendering + fallback logic)
- Copy/apply actions (popover with checkboxes)
- Upload queue manager (parallel uploads with progress)

### Phase D: Polish
- Keyboard navigation (arrow keys between cells, Enter to upload)
- Empty state illustration
- Tray auto-collapse when empty
- Cell lightbox preview
- Mobile-responsive matrix (stack columns on narrow viewports)

---

## 13. What We Deliberately Chose NOT to Build

| Feature | Why not |
|---------|---------|
| **Filename parsing / auto-matching** | Filenames are unpredictable (`IMG_4521.jpg`). Wrong auto-assignments are worse than manual assignment because merchants may not notice errors. The tray + drag approach is fast enough and 100% accurate. |
| **AI view detection** | Accuracy below ~85% causes trust erosion. Users either miss wrong assignments (bad data in orders) or manually verify everything (no time savings). |
| **Position-based Shopify import** | "First image = Front" is an assumption. Merchants organize images differently. Import to tray + manual assignment respects their intent. |
| **Folder structure parsing** | Requires merchants to organize files a specific way. Most have `IMG_xxxx.jpg` files from cameras. Not worth the complexity for the small percentage who organize folders by color. |
| **Image reuse library** | Medium-high effort for medium impact. V2 scope — each product setup manages its own images. Cross-product reuse is a V3 consideration. |
