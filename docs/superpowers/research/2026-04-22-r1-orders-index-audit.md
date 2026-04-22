# Orders Index Route Audit — Current State Inventory

**Date:** 2026-04-22  
**Target:** `/Users/pc/Development/GitHub/insignia/app/routes/app.orders._index.tsx` (528 lines)  
**Scope:** Read-only; loader + action behavior only. Render-layer replacement via `OrdersIndex.tsx` component.

---

## Section A: Current-State Inventory

### 1. Loader Return Shape

The loader returns an object with the following top-level fields:

| Field | Type | Source | Used by Render | UI Element(s) |
|-------|------|--------|-----------------|---------------|
| `orders` | `OrderGroup[]` | Grouped from `OrderLineCustomization` via `groupBy` + `groupMap` aggregation (lines 110–167) | ✓ Yes | IndexTable rows, pagination count |
| `currency` | `string` | `shop.currencyCode` via `currencySymbol()` helper (line 63) | ✓ Yes | Fee total cell formatter |
| `tab` | `string` | URL param `?tab` (line 49), defaults to `"all"` | ✓ Yes | Tabs selection state, empty state message |
| `methods` | `DecorationMethod[]` | `db.decorationMethod.findMany()` sorted by name (lines 66–70) | ✓ Yes | Method filter dropdown options |
| `search` | `string` | URL param `?search` (line 50), defaults to `""` | ✓ Yes | Search input value |
| `methodId` | `string` | URL param `?methodId` (line 51), defaults to `""` | ✓ Yes | Method filter selection state |
| `dateRange` | `string` | URL param `?dateRange` (line 52), defaults to `"all"` | ✓ Yes | Date range selector state |
| `artworkStatus` | `string` | URL param `?artworkStatus` (line 53), defaults to `""` | ✓ Yes | Artwork status filter state, applied filter badge |
| `page` | `number` | URL param `?page`, normalized 1-indexed (lines 54–55) | ✓ Yes | Pagination controls, "Page X of Y" display |
| `totalPages` | `number` | `Math.ceil(totalCount / PAGE_SIZE)` (line 129) | ✓ Yes | Pagination controls, page display |
| `totalCount` | `number` | Length of distinct order IDs (line 116) | ✓ Yes | Pagination display only; not displayed directly but used for `totalPages` |

**OrderGroup structure (aggregated per shop + shopifyOrderId):**
```typescript
{
  shopifyOrderId: string;        // Shopify Order GID
  orderName: string;             // Formatted "#XXXXXX" (last 6 digits of numeric ID)
  lineCount: number;             // Count of line items for this order
  pendingArtwork: number;        // Count of lines with artworkStatus = "PENDING_CUSTOMER"
  latestStatus: string;          // Lowest-priority ProductionStatus (ARTWORK_PENDING < ARTWORK_PROVIDED < IN_PRODUCTION < QUALITY_CHECK < SHIPPED)
  totalCents: number;            // Sum of all line unitPriceCents for this order
  createdAt: string;             // ISO 8601 timestamp of earliest/most recent line (from groupBy _max)
}
```

**Loader query logic (lines 79–106):**
- Filters by `productConfig.shopId` (multi-tenant scope)
- If `tab === "awaiting"`, adds filter `artworkStatus: "PENDING_CUSTOMER"`
- If `artworkStatus` is explicitly provided ("PROVIDED" or "PENDING_CUSTOMER"), overrides tab filter
- If `search` is present, strips all non-digits and filters `shopifyOrderId` contains (case-insensitive)
- If `methodId` is present, filters `customizationConfig.methodId` equals
- If `dateRange` is present, filters `createdAt >= computeDateFrom(dateRange)`
- Groups by distinct `shopifyOrderId` and orders by `-createdAt` (newest first, line 113)
- Paginates at the order level (not line level): 25 orders per page

**Null-shop fallback (line 61):** If shop lookup fails, returns empty orders list with defaults (currency "$", page 1, totalPages 1).

---

### 2. Action Intents

**Current state:** This route defines **NO action handler**. All mutations are delegated to child routes:

- **`/app/orders/bulk-advance`** (line 199): Handles bulk mark-to-production
  - **Intent name:** N/A (direct route, no intent field)
  - **Validation:** Checks `orderIds` array is non-empty, `newStatus` is in `PRODUCTION_STATUS_ORDER` enum, and `newStatus` is not the first status
  - **Logic:** Only advances lines at the immediately preceding status (prevents skipping ARTWORK_PROVIDED when advancing to IN_PRODUCTION). Uses `PRODUCTION_STATUS_ORDER` ordering (lines 7–13 in bulk-advance file) to enforce single-step advancement
  - **Prisma writes:** `db.orderLineCustomization.update()` × N (transaction, line 52–59)
  - **Success outcome:** Returns JSON `{ advanced: number, skipped: number }` (line 70)
  - **Failure outcome:** Returns JSON `{ error: string }` with HTTP status (400, 404, or 500)
  - **Side effects:** Fire-and-forget `syncOrderTags()` call per affected order (lines 62–66)

---

### 3. URL Params Consumed

| Param | Default | Source | Usage | Reset on Change |
|-------|---------|--------|-------|-----------------|
| `tab` | `"all"` | Line 49 | Filters `artworkStatus` when `tab === "awaiting"` | Clears on tab change (line 221) |
| `search` | `""` | Line 50 | Numeric search in `shopifyOrderId` (line 76) | Clears on search change (line 232); user can clear via TextField (line 342) |
| `methodId` | `""` | Line 51 | Filters `customizationConfig.methodId` (line 95–100) | Clears on method change (line 243) |
| `dateRange` | `"all"` | Line 52 | Passed to `computeDateFrom()` for `createdAt >= ` filter | Clears on dateRange change (line 254) |
| `artworkStatus` | `""` | Line 53 | Filters `artworkStatus` directly OR via tab (line 81–85) | Clears on filter remove/tab switch (lines 272, 219) |
| `page` | `1` | Line 54–55 | Pagination offset: `(page - 1) * 25` (line 119) | Resets to 1 on any filter/search/tab change (lines 221, 232, 243, 254, 265, 279) |

**Tab switching behavior (lines 211–223):**
- If selected tab is `"all"`: deletes `tab` param, deletes `artworkStatus` filter
- If selected tab is `"awaiting"`: sets `tab=awaiting`, deletes `artworkStatus` (because tab constraint already enforces it), deletes `page`

---

### 4. UI States Currently Handled

1. **Empty-never (no data ever created)**
   - **Trigger:** `orders.length === 0` (line 410)
   - **Heading:** "No customized orders yet"
   - **Message:** "Orders with Insignia customizations will appear here after customers complete purchases."
   - **Visual:** EmptyState component with Shopify CDN image

2. **Empty-filtered (filter active, 0 matches)**
   - **Trigger:** Same condition (`orders.length === 0`) but with active `tab`, `search`, `methodId`, `dateRange`, or `artworkStatus`
   - **Heading:** Context-aware: "No orders awaiting artwork" if `tab === "awaiting"`, else "No customized orders yet"
   - **Message:** Same as empty-never
   - **Distinction:** Not visually distinct in current code; empty state is identical regardless of filter state

3. **Populated with data**
   - **Trigger:** `orders.length > 0`
   - **Visual:** IndexTable with rows, each row showing: order name, customized lines count, artwork badge, status badge, fee total, date
   - **Selection:** Uses `useIndexResourceState` for row checkbox tracking (line 192)
   - **Bulk action:** "Mark as In Production" button visible if any rows selected (line 440)

4. **Bulk-selected (some rows checked)**
   - **Trigger:** `selectedResources.length > 0`
   - **Visual:** Row checkboxes checked, bulk-action bar becomes active
   - **Action:** Calls `handleBulkMarkInProduction()`, submits to `/app/orders/bulk-advance` (lines 195–200)

5. **Mixed-eligibility selection (rows at different statuses)**
   - **Trigger:** Selected rows have mixed `latestStatus` values
   - **Behavior:** Bulk action always sends to `/app/orders/bulk-advance` which filters by "immediately preceding status" (bulk-advance.tsx line 49); some rows may be skipped
   - **Feedback:** Toast shows `"${advanced} lines marked as In Production"` (line 204)

6. **Pagination: single page**
   - **Trigger:** `totalPages === 1`
   - **Visual:** IndexTable shown, pagination controls hidden (line 507)

7. **Pagination: first page (of many)**
   - **Trigger:** `page === 1 && totalPages > 1`
   - **Visual:** "Previous" disabled, "Next" enabled, "Page 1 of N" text (lines 510–520)

8. **Pagination: middle page**
   - **Trigger:** `page > 1 && page < totalPages`
   - **Visual:** Both "Previous" and "Next" enabled

9. **Pagination: last page**
   - **Trigger:** `page === totalPages`
   - **Visual:** "Previous" enabled, "Next" disabled

10. **Tab switch reset behavior (lines 211–223)**
    - When tab changes, `artworkStatus` filter is deleted (line 219) so that the tab's own constraint takes precedence
    - `page` is always reset to 1 (line 221)

11. **Filter apply**
    - **Trigger:** User selects value in Search, Method dropdown, Date range dropdown, or Artwork status checkbox
    - **Behavior:** Updates URLSearchParams and resets `page=1` (lines 232, 243, 254, 265)
    - **Visual:** Filter badges appear below filter controls (line 389–399) showing active `artworkStatus` only

12. **Filter clear**
    - **Trigger:** User clicks X on applied filter badge (line 395) or "Clear all" button (line 400)
    - **Behavior:** Deletes `artworkStatus` param (or all filter params) and resets `page=1`

13. **Action success (bulk advance)**
    - **Trigger:** `fetcher.data` returns `{ advanced: number, ... }` (line 203)
    - **Toast:** `window.shopify?.toast?.show()` with message `"${advanced} lines marked as In Production"` (line 204)
    - **Side effect:** Runs in `useEffect` with `[fetcher.data]` dependency (lines 202–206)

14. **Action failure (bulk advance)**
    - **Trigger:** Bulk-advance endpoint returns `{ error: string }` or HTTP error status
    - **Behavior:** No toast shown; error is silently discarded (line 190 type annotation allows `error?`, but render doesn't check for it)
    - **Risk:** User may not know bulk action failed

15. **Specific latestStatus color coding (lines 474–483)**
    - `SHIPPED` → Badge tone `"success"` (green)
    - `IN_PRODUCTION` or `QUALITY_CHECK` → Badge tone `"info"` (blue)
    - `ARTWORK_PENDING` → Badge tone `"attention"` (orange/red)
    - All others (including `ARTWORK_PROVIDED`) → No tone (default/gray)

16. **Loading / pending state**
    - **Current behavior:** Not explicitly handled. Fetcher state transitions are not shown to user (e.g., no spinner during bulk-advance submission)

---

### 5. Toast Emissions

| Location | Condition | Message | Context |
|----------|-----------|---------|---------|
| Line 204 | `fetcher.data?.advanced` is truthy | `"${fetcher.data.advanced} lines marked as In Production"` | After successful bulk-advance action |

---

### 6. Nested / Child Routes Referenced

- **`/app/orders/$id`** (line 452): Detail page; each row is clickable and navigates here
- **`/app/orders/bulk-advance`** (line 199): Bulk action endpoint; receives FormData with `orderId` list and `newStatus`
- **`/api/admin/orders/export`** (line 306): CSV export endpoint; called by `handleExportCSV()`, accepts same filters as loader (search, methodId, dateRange, tab)

---

### 7. Accessibility Affordances Currently Present

- **TextField (search):**
  - `label="Search orders"` with `labelHidden` (line 334–335)
  - `placeholder="Search orders..."` visible (line 336)
  - `prefix={<Icon source={SearchIcon} />}` (line 339)
  - `clearButton` enabled; `onClearButtonClick` clears search (lines 341–342)
  - `autoComplete="off"` (line 340)

- **Select (method, date range):**
  - Both have `label` with `labelHidden`; placeholder text visible as first option (lines 347–348, 356–357)
  - No `aria-` attributes explicitly added

- **Filters (artwork status):**
  - ChoiceList title="Artwork status" with `titleHidden` (lines 376–377)
  - Applied filter badge includes `onRemove` callback (line 395)
  - "Clear all" button on Filters component (line 400)

- **IndexTable:**
  - `resourceName` provided (singular/plural, line 427)
  - Column headings with `title` (line 429–435)
  - Row navigation via click on order name link (line 452)
  - Bulk action promotion (line 439–441)

- **Pagination:**
  - `hasPrevious` / `hasNext` props control button disabled state (line 510–511)
  - Text "Page X of Y" accompanies controls (line 516–518)
  - No `aria-label` for pagination buttons

- **Missing/Limited:**
  - No `aria-current="page"` or role hints on active tab
  - No skip-to-content link
  - No `aria-label` on "Export CSV" button (icon-only button, line 323–325)
  - No screen-reader label for bulk-action state
  - No `aria-busy` or loading indicator during async operations

---

## Section B: States Not Currently Handled but Production Admin Should Handle

### 1. **Loader crash / shop not found**
   - **What:** Database returns no shop record despite authenticated session (multi-tenant guard failure or race condition)
   - **When:** Shop is deleted or session is stale
   - **Current behavior:** Returns early with dummy data (line 61): `orders: []`, `currency: "$"`, etc. The admin sees empty state but has no indication why
   - **Best practice:** Clear. Return an error response with HTTP 404 and user-facing message. The parent layout should handle this uniformly

### 2. **Bulk-advance action failure (partial or total)**
   - **What:** Bulk-advance endpoint returns `{ error: string }` or network error
   - **When:** Database constraint violation (e.g., concurrent order state change), Prisma transaction rollback, or syncOrderTags fails for some orders
   - **Current behavior:** Error is typed in fetcher but never displayed (line 190 allows `error?` but render ignores it); no toast, no UI feedback. Bulk action silently fails
   - **Best practice:** Check `fetcher.data?.error` in render and show error toast or banner. At minimum, disable bulk-action button with explanatory tooltip

### 3. **Export CSV endpoint timeout / failure**
   - **What:** `/api/admin/orders/export` returns HTTP error or times out on large result set
   - **When:** Shop has 10K+ orders; Prisma query takes > 30s; S3 bucket unreachable
   - **Current behavior:** `handleExportCSV()` checks `!response.ok` and returns silently (line 307). No toast, no user indication
   - **Best practice:** Show error toast on HTTP error. For large exports, consider pagination or async job pattern

### 4. **Concurrent filter + pagination race**
   - **What:** User changes filter while on page 3, then quickly changes another filter. Two loaders fire; results may reorder
   - **When:** User is filtering rapidly or on slow connection
   - **Current behavior:** React Router handles this by latest-navigation-wins; but URL may briefly show inconsistent state (e.g., page=3 with new search that has < 3 pages)
   - **Best practice:** Consistently reset page to 1 on filter change (already done). Consider disabling pagination buttons during navigation

### 5. **OrderLineCustomization without customizationConfig (orphaned line)**
   - **What:** Order line exists but `customizationConfig` is null (FK was deleted or set to null during cleanup)
   - **When:** Variant pool cleanup runs; config expires; data integrity issue
   - **Current behavior:** `line.customizationConfig?.decorationMethod?.name ?? "Unknown"` defaults to "Unknown", but fee cell shows NaN or $0 (line 490); no warning to merchant
   - **Best practice:** Query should `include` customizationConfig and treat null as error state. Show badge or warning cell if method/price is missing

### 6. **Status enum mismatch (unexpected production status value)**
   - **What:** `latestStatus` is a string not in `STATUS_PRIORITY` map (e.g., typo in DB, migration bug, or schema version skew)
   - **When:** After Prisma migration; enum constraint failure; code deployed before migration
   - **Current behavior:** `STATUS_PRIORITY[order.latestStatus]` returns `undefined`, defaults to `-1`, and badge renders as "UNKNOWN" with no tone (line 485 replace `_` with space: "UNKNOWN")
   - **Best practice:** Validate `latestStatus` is in enum at loader; throw error if not

### 7. **Pagination boundary race (page out of range)**
   - **What:** User is on page 3, filter matches only 2 pages, URL still shows page=3
   - **When:** Data shrinks due to webhook deleting orders or status changes during slow load
   - **Current behavior:** `paged orders` query returns empty array; empty state is shown (line 410). No message distinguishes "filtered to 0 results" from "page out of range"
   - **Best practice:** If `page > totalPages`, redirect to `page=totalPages`. Or: fetch `totalCount` separately and validate before slicing

### 8. **syncOrderTags fire-and-forget failure (tag desync)**
   - **What:** Admin marks lines as "In Production", bulk-advance succeeds, but syncOrderTags fails (Admin API rate limit, session expired, network error)
   - **When:** Admin has many orders queued; Shopify API is slow; session token rotation happens
   - **Current behavior:** Error is caught and logged to console (bulk-advance.tsx line 64–66), but database was already updated. Shopify order tags are stale; merchant sees production status in Insignia but not in Shopify
   - **Best practice:** Consider using a job queue (Bull, RQ, etc.) or webhook to retry tag sync. Or: make tag sync synchronous and rollback DB on failure (trade-off: slower UX but guaranteed consistency). At minimum, log tag-sync failures to a separate monitoring table

### 9. **Webhook ordering / duplicate events (production status state machine violation)**
   - **What:** Status update webhook arrives out of order (e.g., SHIPPED arrives before IN_PRODUCTION) or bulk-advance submits while order webhook is processing
   - **When:** High order volume; async processing; network retries
   - **Current behavior:** Bulk-advance enforces single-step advancement (only lines at preceding status are advanced, line 49 bulk-advance.tsx). But webhook does NOT enforce this; it just overwrites status. Result: order can jump states
   - **Best practice:** Use production status as a state machine with explicit transitions. Reject status updates that violate the sequence. Track event ID for idempotency (WebhookEvent table exists but not used in orders context)

### 10. **Currency code missing or mismatched**
   - **What:** `shop.currencyCode` is null, or currency code changes mid-month (currency conversion)
   - **When:** Shop misconfiguration; Shopify account currency change
   - **Current behavior:** Defaults to "$" (line 63 via `currencySymbol()` — verify it handles null). Fee displays as "$X.XX" regardless of actual currency
   - **Best practice:** Validate currency at install time. Warn if currency changes. Store currency per-order (not just per-shop) for historical accuracy

### 11. **Group aggregation discrepancy (lineCount vs. actual lines)**
   - **What:** `lineCount` in loader is > actual lines returned in subsequent detail page load (concurrent deletion, race condition in groupBy)
   - **When:** Order line is deleted while list page is loading
   - **Current behavior:** IndexTable shows "lineCount: 5" but detail page loads only 3 lines. No reconciliation
   - **Best practice:** Clear. Don't cache lineCount in aggregation; compute fresh at render time. Or: use a consistent snapshot isolation level in DB transactions

### 12. **Merchant scale: 1000+ orders**
   - **What:** 1000+ orders in shop, pagination offset (page-1) * 25 is slow on DB; distinct shopifyOrderId groupBy becomes expensive
   - **When:** Mature shop; multi-year store
   - **Current behavior:** Loader may timeout (default ~30s); no index on the groupBy fields
   - **Best practice:** Create compound index on `(productConfig.shopId, createdAt DESC)`. Consider materialized view or caching for aggregation. Implement cursor-based pagination instead of offset

**Summary:** Items 1–6 have clear best practices. Items 7–12 need product/architecture decisions (queue vs. sync? denormalization? cursor-based pagination?).

---

## References

- Loader: lines 45–170
- Action: N/A (delegated to `/app/orders/bulk-advance`)
- Bulk-advance handler: `/app/routes/app.orders.bulk-advance.tsx` lines 15–71
- Order-tags sync: `/app/lib/services/order-tags.server.ts` lines 8–64
- CSV export: `/app/routes/api.admin.orders.export.tsx` lines 24–144
- Schema: `/prisma/schema.prisma` (OrderLineCustomization lines 424–464, ProductionStatus enum lines 416–422)
- Render: lines 186–528
