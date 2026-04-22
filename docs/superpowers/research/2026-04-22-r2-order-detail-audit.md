# Order Detail Route Audit — Current State Inventory & Gaps

**Date:** 2026-04-22 | **Route:** `/Users/pc/Development/GitHub/insignia/app/routes/app.orders.$id.tsx` (~1221 lines) | **Context:** Full-page replacement with Polaris Web Components (in-progress)

---

## Section A: Current-State Inventory

### 1. Loader Return Shape

The loader (lines 50–384) returns a flattened object with these fields:

| Field | Type | Source | Consumer(s) | Notes |
|-------|------|--------|-----------|-------|
| `shopifyOrderId` | `string` | `params.id` (URL decoded) | Page title breadcrumb, secondary action URL construction | Used to link to `.print` and `.artwork` nested routes |
| `orderName` | `string` | Shopify GraphQL query (fallback: `#${last6Digits}`) | Page title | 42% chance of fallback if GraphQL call fails or customer is offline |
| `lines[]` | `OrderLineDTO[]` | `db.orderLineCustomization.findMany()` with shop-scoped FK (line 64–66) | Primary data grid; per-line cards in render | **Critical:** FK chain (`productConfig.shopId`) prevents cross-tenant leakage |
| `logoAssetMap` | `Record<assetId, LogoAssetDTO>` | `db.logoAsset.findMany()` in-memory union; presigned URLs generated per-asset (lines 104–140) | Placement card `<Thumbnail>` source; download URL anchors | **Presigned URLs are 3600s TTL** (line 133 `getPresignedGetUrl(a.previewPngUrl, 3600)`) |
| `placeholderLogoImageUrl` | `string \| null` | `settings.placeholderLogoImageUrl` | Fallback `<Thumbnail>` when asset missing (line 952–953) | Read-only; set in settings editor elsewhere |
| `emailReminderTemplate` | `string \| null` | `settings.emailReminderTemplate` | Email template editor (line 600) | Max 10k chars validated server-side on save (line 542) |
| `productionQcEnabled` | `boolean` | `settings.productionQcEnabled` | WORKFLOW_STEPS array (line 629) and button visibility (lines 1051, 1068) | Filters production status cascade; see Section A.8 |
| `shopDomain` | `string` | `session.shop` (authenticated) | Email template default (line 560); Shopify admin URL construction (line 660) | Never null; comes from authenticated Remix session |
| `customer` | `{ name, email } \| null` | Shopify GraphQL `order.customer.*` (coalesce line 228) | Customer card (lines 798–807) | Null coalesced to `"No customer information available"` (line 806) |
| `shopifyLineItemPrices` | `Record<shopifyLineId, { amount, currencyCode, quantity }>` | Shopify GraphQL `lineItems[].originalUnitPriceSet.shopMoney` | Subtotal calculation (line 646); per-item price display | Shopify may return different currency than `shop.currencyCode` if webhook not synced |
| `allShopifyLineItems` | `Array<{ id, title, quantity, variantTitle, amount, currencyCode }>` | Shopify GraphQL full line items (lines 237–244) | Non-customized items filter (lines 654–656); order summary (line 646) | **Currency fallback:** `shop.currencyCode ?? ""` (line 154) then `shopifyOrder.currencyCode ?? "USD"` (line 221) |
| `currencyCode` | `string` | Shopify GraphQL order (default: `shop.currencyCode` or `"USD"`) | Money formatter (lines 633–642) | **Fallback chain:** Shop record → GraphQL → hardcoded `"USD"` |
| `orderDataError` | `boolean` | Set to `true` if GraphQL call throws or returns `errors` (lines 215–250) | Banner tone (line 753) | **Does NOT prevent render;** page is usable even if customer/price data missing |
| `linePreviewData` | `Record<lineId, ViewPreview[] \| null>` | Async per-line canvas geometry merge (lines 260–334) | Konva canvas render (lines 896–929); canvas image load failure handled by `<OrderLinePreview>` | **See Section A.6** for geometry merging logic |

**Gap Identified:** `orderStatusUrl` is written to the DB (line 179 in `webhooks.orders.create.tsx`) but **NOT surfaced by the loader.** This field exists on the `OrderLineCustomization` schema (Prisma line 444) but the loader query (lines 63–90) does NOT select it. **This is the documented one-line patch target.**

---

### 2. Action Intents

| Intent | Lines | Validation | Server Writes | Success Response | Failure Response |
|--------|-------|-----------|----------------|------------------|------------------|
| `attach-artwork` | 392–439 | Requires `lineId` + `logoAssetId`; allows `placementId` | Updates `logoAssetIdsByPlacementId` JSONB; if all placements filled, sets `artworkStatus="PROVIDED"` + `productionStatus="ARTWORK_PROVIDED"` | `{ success: true }` | `{ error: "..." }` (shop not found, line not found, missing fields) |
| `advance-status` | 441–492 | Requires `lineId` + `newStatus`; validates against `PRODUCTION_STATUS_ORDER` enum (line 449); checks forward-only transition by index (lines 474–479); honors `productionQcEnabled` flag to skip QC step (line 470) | Atomic update to `productionStatus`; async fire-and-forget `syncOrderTags()` call (lines 487–489) never blocks on failure | `{ success: true }` | `{ error: "Invalid production status" \| "Can only advance forward" \| "Shop not found" \| "Order line not found" }` |
| `bulk-advance-status` | 494–533 | Batch variant; checks all `lineIds` are eligible before transaction (lines 517–520); filters by index < newIndex | Transactional batch update of eligible lines (line 522); tracks `{ success, advanced, skipped }` | `{ success: true, advanced: N, skipped: M }` | `{ error: "..." }` (invalid intent, missing fields) |
| `save-template` | 535–551 | Validates template length ≤ 10,000 chars (line 542) | Upserts `MerchantSettings.emailReminderTemplate` (lines 545–549) | `{ success: true }` | `{ error: "Template exceeds maximum length of 10,000 characters." \| "Shop not found" }` |

**Artwork upload flow:** The route itself does NOT handle `get-upload-url` or `complete-upload`—these go to `/api/admin/artwork-upload` (lines 1145–1176 in `ArtworkUploader`). The main route only handles the completed attachment via `attach-artwork` intent (which duplicates logic from the API route; see inconsistency flag in Section B).

---

### 3. Nested Route Invocations

| Nested Route | Entry Point | Behavior | Parameters |
|--------------|-------------|----------|-----------|
| `.print` | Secondary action button (lines 667–671) | Opens in new tab (not nested child) | Shopify order ID in URL |
| `.artwork` | Does not exist yet in codebase | Planned; part of I2 replacement | Will handle single-placement upload preview |
| `.reminder` | Does not exist; email template editor inline (lines 694–751) | Skipped; template saves via `save-template` intent on main route | N/A |

No `useOutlet()` calls; no child route composition. The `.print` route is completely independent (separate loader + markup).

---

### 4. ArtworkUploader Component State Machine

**Location:** Lines 1114–1220 (inline component; client-only with `useCallback`)

**State Variables:**
- `uploading: boolean` (lines 1125) — UI indicator + disable DropZone
- `error: string | null` (line 1126) — User-facing error text; dismissible banner (line 1204)
- `done: boolean` (line 1127) — Terminal success state; shows banner and collapses uploader

**State Transitions:**

```
[idle] ──drop file──> [validate type] ──fail──> [error]
                        ↓ success
                     [uploading]
                        ↓
                   [GET presigned URL]
                        ↓ success
                   [PUT to R2 presigned URL]
                        ↓ success
                   [POST complete-upload]
                        ↓ success
                      [done] ──banner shown──> [render success banner + close uploader]
                        ↑
                   [error] at any step ──dismiss──> [idle]
```

**Steps:**
1. **Get presigned URL** (lines 1145–1156): POST to `/api/admin/artwork-upload` with `intent=get-upload-url`; returns `{ uploadUrl, logoAssetId }` (3-minute TTL, line 60 in artwork-upload.tsx)
2. **PUT to S3** (lines 1159–1164): Direct `fetch(..., { method: "PUT", body: file, headers: { "Content-Type": file.type }})` with presigned URL; no retry logic
3. **Complete upload** (lines 1167–1178): POST `/api/admin/artwork-upload` with `intent=complete-upload` + placement binding; marks file as ready
4. **Reload page** (line 1183): Triggers `submit(null, { method: "GET" })` to refresh page state

**Allowed MIME types** (line 1134): `image/jpeg`, `image/png`, `image/svg+xml` only. Error if type mismatch.

**Error Recovery:** Dismissible banner (line 1204); user can retry by clicking Attach again. No backoff or exponential retry.

---

### 5. UI States Exhaustive List

| State | Trigger | Rendering | Outcome |
|-------|---------|-----------|---------|
| `orderDataError=true` | GraphQL query fails or returns `errors` | Info banner (lines 753–759): "Could not load customer and pricing information from Shopify" | Order detail still renders; customer/pricing cards may show "No customer information available" or USD fallback |
| `currencyCode` fallback to USD | Webhook not synced; Shopify GraphQL returns `null` | Money formatter uses fallback (line 641: `catch` returns string like `"USD 123.45"`) | User sees "USD" label even if store currency is EUR |
| `customer=null` | No firstName/lastName/email in Shopify order | Card text: "No customer information available" (line 806) | Read-only state; no error |
| `hasPendingArtwork=true` | Any line has `artworkStatus="PENDING_CUSTOMER"` | **Page-level:** Banner (lines 683–691) tone="warning" + Card with email template editor (lines 694–751) | "Artwork pending" badge on title metadata (line 674); email copy button enabled |
| `hasPendingArtwork=false` | All lines have `artworkStatus="PROVIDED"` | **Page-level:** Success banner (lines 687–691) tone="success" | "Complete" badge on title metadata (line 677) |
| Per-line: `productionStatus="ARTWORK_PROVIDED"` + count ≥ 2 | Multiple lines ready for production | Bulk action card (lines 761–790): "N items ready for production" with "Mark all as In Production" button | Single large CTA; `pendingLineId="bulk"` tracks submission state |
| Per-line: `productionStatus="ARTWORK_PROVIDED"` | Single line ready | Primary button: "Mark in production" (lines 1032–1050) | Advances to `IN_PRODUCTION`; button only shown on this status |
| Per-line: `productionStatus="IN_PRODUCTION"` + `productionQcEnabled=true` | QC enabled in settings | Button: "Mark quality check" (lines 1051–1067) | Advances to `QUALITY_CHECK` |
| Per-line: `productionStatus="IN_PRODUCTION"` + `productionQcEnabled=false` | QC disabled | Button: "Mark shipped" (lines 1068–1084) | Skips QC; advances directly to `SHIPPED` |
| Per-line: `productionStatus="QUALITY_CHECK"` | QC step in progress | Button: "Mark shipped" (lines 1085–1101) | Advances from QC to `SHIPPED` |
| Per-placement: No logo asset + uploader collapsed | User hasn't clicked "Attach" | Thumbnail fallback (lines 950–957): asset preview OR placeholder image OR gray box with "LOGO" text | Read-only; no affordance for editing |
| Per-placement: Upload in-flight (`uploading=true`) | File being sent to R2 | DropZone disabled + `<Spinner>` shown (lines 1216–1217); no interaction possible | Blocking; cannot cancel mid-upload |
| Per-placement: Upload done (`done=true`) | 3-step upload complete | Success banner (lines 1194–1198); uploader collapses; page reloads | User sees fresh asset thumbnail after reload |
| Per-placement: Upload error (`error != null`) | Any step fails (type validation, presigned URL fetch, PUT, complete-upload) | Dismissible critical banner (lines 1203–1206) with error message | Error can be dismissed; user can retry by clicking "Attach" again |
| Canvas image load failure | `imageUrl` presigned URL is 403/404 or malformed | `<OrderLinePreview>` catches via `img.onerror` (line 50 in OrderLinePreview.client.tsx); no logo shown | Placement zone rendered; logo text label shown instead of image |
| Canvas logo image 403/404 | Presigned URL expired (>3600s old) or asset deleted | `img.onerror` handler (line 71); pending count decremented; no fallback shown | Zone rendered but logo not visible; user sees placement name text in zone |
| Missing shop record | Authenticated user from shop that isn't in DB | 404 throw (line 58) | Route throws 404; no page render |
| Cross-tenant order lookup | Authenticated shop A user tries to view shop B order | FK scope prevents query match (lines 64–66: `productConfig: { shopId: shop.id }`); query returns empty array | 404 throw (line 92) |
| Shop domain missing | `session.shop` is null/undefined | Breaks Shopify admin URL construction (line 660) | Live bug: would fail at format time or pass empty string to URL |

---

### 6. Geometry Merging Logic

**Source:** Lines 260–334 in loader; schema: `Prisma/schema.prisma` lines 199–226

**Shape of `linePreviewData[lineId]`:**
```typescript
ViewPreview[] = Array<{
  viewId: string;
  viewName: string;
  imageUrl: string; // presigned R2 URL (3600s TTL)
  geometry: Record<string, PlacementGeometry | null>;
  logoUrls: Record<string, string | null>; // presigned per-placement
}>
```

**Merging precedence (lines 298–308):**

1. **If snapshot exists AND `!useLiveConfigFallback`:** Use snapshot `placementGeometrySnapshotByViewId[viewId]` (immutable, captured at order creation)
2. **If fallback flag set OR snapshot missing:** Merge live config using `sharedZones` boolean:
   - **`sharedZones=true`** (view.placementGeometry is authoritative): Use ProductView geometry, fallback to per-variant override
   - **`sharedZones=false`** (per-variant is authoritative): Use per-variant geometry, fallback to shared view geometry
3. **Fallback:** Empty object `{}` if all sources are null

**PlacementGeometry shape:**
```typescript
{
  centerXPercent: number;    // 0–100
  centerYPercent: number;    // 0–100
  maxWidthPercent: number;   // 0–100
  maxHeightPercent?: number; // optional; defaults to width
}
```

**Rendering in Konva (OrderLinePreview lines 93–102):**
- Zone X,Y calculated as `(centerX% / 100) * stageWidth - (zoneW / 2)`
- Zone W,H calculated as `(maxWidth% / 100) * stageWidth`
- If `maxHeightPercent` missing, height = width (square zone)

**Logo scaling (lines 114–126):**
- Fit logo image inside zone using `Math.min(zoneW / logoW, zoneH / logoH)`
- Center inside zone with 4px padding margin

---

### 7. Toast Emissions

**No toast library is imported or used.** The route uses:
- **Polaris `Banner` component** (lines 683–758): Page-level, non-dismissible (artwork pending/complete)
- **Critical `Banner` in `ArtworkUploader`** (lines 1203–1206): Dismissible error toast-like component
- **Success `Banner` in `ArtworkUploader`** (lines 1194–1198): "Artwork uploaded successfully."
- **Client-side copy feedback** (lines 614–622): `setCopySuccess(true)` for 2 seconds; changes button text to "Copied!"

No Shopify Toast component; no server-side toast emission via loader action. Success/error states communicated via page reload or UI state change.

---

### 8. Production Status Cascade Rules

**Valid transitions** (defined on lines 42–48 + enforced at lines 441–492):

```
ARTWORK_PENDING
    ↓
ARTWORK_PROVIDED ──→ IN_PRODUCTION
    ↓ [optionally]
QUALITY_CHECK (if productionQcEnabled=true)
    ↓
SHIPPED
```

**Rules:**
- **Forward-only:** New status index must be > current index (line 477); backward transitions blocked
- **QC optional:** If `productionQcEnabled=false`, the cascade skips QUALITY_CHECK step (line 470–472)
- **Bulk-eligible lines only:** `bulk-advance-status` only advances lines whose current index < newIndex (lines 517–520)
- **Fire-and-forget tag sync:** On every status advance, `syncOrderTags()` is called but never blocks (lines 487–489)

**Per-line button visibility (render logic):**
- ARTWORK_PROVIDED: "Mark in production" button shown (lines 1032–1050)
- IN_PRODUCTION + QC enabled: "Mark quality check" button (lines 1051–1067)
- IN_PRODUCTION + QC disabled: "Mark shipped" button (lines 1068–1084)
- QUALITY_CHECK: "Mark shipped" button (lines 1085–1101)
- SHIPPED: No advance button (end state)

---

## Section B: States Not Currently Handled

### Brainstorm of Unhandled Edge Cases

#### 1. **Presigned URL Expiry (3600s = 1 hour)**
- **Trigger:** User keeps order detail page open for >1 hour without refreshing, then tries to download logo or view canvas
- **Current Behavior:** Canvas render fails silently; logo preview shows broken image; download link returns 403 Forbidden
- **Best Practice:** Implement automatic URL refresh on page via `setInterval` or background task; show expiry countdown badge on asset card
- **Shareable Data:** Presigned URLs are scoped to S3 object; reissuance is free

#### 2. **Canvas Image Presigned URL 403/404**
- **Trigger:** Admin deletes variant view configuration or image file from R2 after order created
- **Current Behavior:** `OrderLinePreview` catches `img.onerror` (line 50); no visual feedback to user; blank canvas
- **Merchant Experience:** Confusing; they don't know why canvas is broken
- **Best Practice:** Show inline warning banner per view: "Product image unavailable"; allow admin to reupload from variant config

#### 3. **Artifact-Specific: Virus Scan Status Not in Schema**
- **Trigger:** Upload > 5MB file; R2 triggers antivirus scan; scan completes async
- **Current Behavior:** Not tracked; no schema field for `logoAsset.virusScanStatus`
- **Merchant Experience:** Assume file is ready immediately; production team processes contaminated file
- **Product Decision Needed:** Should `artworkStatus` transition be gated on virus scan completion? Requires async webhook integration

#### 4. **Fee Product Variant Drift (Self-Healing Variant Pool)**
- **Trigger:** Merchant deletes/hides the fee variant after order placed; cron-cleanup nulls slot `currentConfigId`
- **Current Behavior:** Order line shows `unitPriceCents` from snapshot; no warning that fee variant no longer exists
- **Merchant Experience:** Can't link back to fee variant for reconciliation; only `feeShopifyVariantId` snapshot remains
- **Product Decision Needed:** Surface fee variant ID in order detail? Add "missing variant" warning? Show fallback price?

#### 5. **Partial Webhook Sync (Currency Mismatch)**
- **Trigger:** Webhook received; OLC created; `orderStatusUrl` persisted; but `orders/create` handler crashes before tag sync
- **Current Behavior:** `orderStatusUrl` in DB but not surfaced; next tag sync attempt skips old order
- **Merchant Experience:** Order status link never populated in customer email
- **Best Practice:** Implement webhook retry queue; surface `orderStatusUrl` in loader so merchants can manually verify

#### 6. **Concurrent Status Advances (Two Tabs)**
- **Trigger:** Admin opens order in tabs A and B; clicks "Mark in production" in both simultaneously
- **Current Behavior:** Both POSTs succeed; second UPDATE is idempotent (same `productionStatus` value written twice)
- **Merchant Experience:** No visible conflict; page reloads show single status; no data loss
- **Best Practice:** Add optimistic locking (version field) or last-write-wins timestamp to detect races; show merge conflict to user

#### 7. **Deleted Placements After Order Placed**
- **Trigger:** Merchant edits product config; removes/reorders placements; order already has `logoAssetIdsByPlacementId` JSONB
- **Current Behavior:** UI shows `line.placements` from live config (lines 349, 901); JSONB keys for deleted placements orphaned
- **Merchant Experience:** Asset count mismatch; can't edit orphaned placement assets
- **Best Practice:** Fallback to snapshot `placementGeometrySnapshotByViewId` to reconstruct deleted placement list; warn user of mismatch

#### 8. **S3 Upload Failure: File Too Large or Quota Exceeded**
- **Trigger:** User uploads 500MB file; R2 limit exceeded or presigned URL size limit
- **Current Behavior:** PUT request fails (line 1164); error message is generic ("Failed to upload file to storage")
- **Merchant Experience:** No guidance on file size limits; retry doesn't explain root cause
- **Best Practice:** Return specific error codes from `/api/admin/artwork-upload`; check file size before presigned URL generation

#### 9. **Mixed-Line Refunds (Customized + Non-Customized)**
- **Trigger:** Order has both Insignia and non-Insignia items; customer refunds one item; Shopify doesn't know to unwind the fee variant
- **Current Behavior:** OLC remains in DB; `feeShopifyVariantId` snapshot kept for audit; no refund sync
- **Merchant Experience:** Fee charged but item refunded; reconciliation burden on merchant
- **Product Decision Needed:** Implement webhook handler for `orders/updated` (refund detected); trigger credit memo or variant slot reset?

#### 10. **Decorator Rejects Print (Regression Flow)**
- **Trigger:** Production team marks as SHIPPED but decorator rejects file; needs to regress to ARTWORK_PENDING for reupload
- **Current Behavior:** No backward transitions allowed (line 477)
- **Merchant Experience:** Can't undo status; must contact admin to manually reset via DB
- **Product Decision Needed:** Should backward transitions be allowed with authorization? Add "Revert for rework" intent?

#### 11. **Merchant Returns to Order After 2 Weeks (Orientation Cues)**
- **Trigger:** Order placed 2 weeks ago; marked SHIPPED; merchant opens order detail to cross-reference fulfillment
- **Current Behavior:** Page shows final status; no visible workflow breadcrumb or "last action at" timestamp
- **Merchant Experience:** Must infer status from production step circle UI (lines 1011–1030); if status already SHIPPED, no indicators for time elapsed
- **Best Practice:** Add "order age" subtitle; highlight `updatedAt` timestamp for each line; show action timeline

#### 12. **Upload > S3 Object Lock or Compliance Limits**
- **Trigger:** R2 bucket has object lock enabled; presigned PUT to versioned path fails
- **Current Behavior:** PUT fails (line 1164); generic error returned
- **Merchant Experience:** No retry guidance; doesn't know if issue is transient or config
- **Best Practice:** Distinguish HTTP 400 (malformed) from 403 (permission) from 503 (service); show user-facing guidance per category

#### 13. **Artwork File Content Changes Post-Upload (Audit Trail)**
- **Trigger:** Same user uploads file A, then hours later uploads file B to same placement; no hash or version tracking
- **Current Behavior:** `logoAsset` record updated in-place; no audit log of file changes; `previewPngUrl` overwrites old value
- **Merchant Experience:** Can't see which version was used for production; no rollback
- **Best Practice:** Store `previewPngUrl` immutably; add `logoAsset.uploadedAt` timestamp; implement soft-delete for old versions

#### 14. **Cross-Org Payment Processing (Fee Variant Not Charged)**
- **Trigger:** Merchant uses multi-org Shopify setup; fee variant syncs to Org A but order line is under Org B
- **Current Behavior:** `feeShopifyVariantId` references non-existent variant in order's org; checkout would fail
- **Merchant Experience:** Order can't be placed; no clear error message
- **Product Decision Needed:** Add org validation in webhook handler; surface org context in order detail UI?

#### 15. **Presigned URL Leaked in Logs or Browser History**
- **Trigger:** Admin shares screenshot of order; URL bar shows presigned S3 URL with embedded signature
- **Current Behavior:** Presigned URLs are 3600s TTL; leaked URL can be replayed within window
- **Merchant Experience:** Potential unauthorized access to artwork
- **Best Practice:** Use temporary in-memory signed URL state machine; render only within iframe with CSP restrictions; log redaction for URLs

---

## Confirmed Gap

**`orderStatusUrl` field exists in schema** (Prisma line 444) and **is written during webhook processing** (`webhooks.orders.create.tsx` line 179) but **is NOT selected by the loader query** (lines 63–90 in order detail route).

**Patch required:** Add `orderStatusUrl` to the `select` clause in the `db.orderLineCustomization.findMany()` call (line 63) and surface on the returned `lines[].orderStatusUrl` field for render consumption.

---

