# V2 Gap Closure Plan

> **STATUS: ACTIVE.** This is the authoritative list of remaining work to close gaps between the .pen designs and the running app.
>
> **Source:** Mechanical 4-layer gap analysis (2026-04-07): admin-dashboard-v2.pen + storefront-modal-v2.pen vs all routes, schema, git history, and docs contracts.
> **Scale:** 11 phases, 46 tasks.
>
> **Note:** Originally mislabeled "V3". This is V2 gap closure, not new V3 features. V3 features are in `specs/2026-04-10-v3-future-features.md`.

**Goal:** Close every confirmed gap between the design files and the running application. Zero invented features — every task maps directly to a specific gap finding.

**Verification after every task:**
```bash
npm run typecheck    # must pass
npm run lint         # must pass
npx prisma validate  # after any schema change
```

---

## Phase Dependency Diagram

```
Phase 0: Schema (production workflow state)
    ↓
Phase 1: Quick Wins (labels, bugs, CORS — no design)
    ↓
Phase 2: Methods simplification
    ↓
Phase 3: Products — create modal + duplicate + add-view UX
    ↓
Phase 4: Orders List — search / filter / export / pagination
    ↓
Phase 5: Orders Detail — full production view (needs Phase 0 + 4)
    ↓
Phase 6: Dashboard — Activity tab + Export + Preview store
    ↓
Phase 7: Settings — Translations tab (independent, can parallel Phase 6)
    ↓
Phase 8: View Editor — quick start presets (independent)
    ↓
Phase 9: Image Manager — Import from Shopify (independent)
    ↓
Phase 10: Customer Upload Page — post-purchase storefront route
    ↓
Phase 11: Partial completions (undo/redo, pagination, rate limiting)
```

---

## Phase 0: Schema — Production Workflow State

### Task 0.1: Add production status to OrderLineCustomization

**Gap:** Order detail workflow is cosmetic-only. `in_production`, `quality_check`, `shipped` states have no DB backing.

- [ ] **Step 1:** Add enum `ProductionStatus { ARTWORK_PENDING ARTWORK_PROVIDED IN_PRODUCTION QUALITY_CHECK SHIPPED }` to `prisma/schema.prisma`
- [ ] **Step 2:** Add `productionStatus ProductionStatus @default(ARTWORK_PENDING)` to `OrderLineCustomization`
- [ ] **Step 3:** Run `npx prisma migrate dev --name add-production-status`
- [ ] **Step 4:** Update `webhooks.orders.create.tsx` — set initial `productionStatus` based on `artworkStatus` at order creation
- [ ] **Step 5:** `npx prisma validate && npm run typecheck` — verify and commit

---

## Phase 1: Quick Wins — Labels, Bugs, CORS

No design changes. All fixes are string replacements, filter additions, or single-line corrections.

### Task 1.1: Terminology sweep

**Gap:** Plan task 10.14 was never executed. "Configuration" appears in user-facing strings across 6 route files + the nav component. Direct audit found:
- `app.products._index.tsx`: page title, modal title, button, empty state, resourceList singular/plural, queryPlaceholder (~12 occurrences)
- `app.products.$id._index.tsx`: breadcrumb, field label, delete button, delete modal title + body (~7 occurrences)
- `app.products.$id.views.$viewId.tsx:785`: `backAction={{ content: "Configuration" }}`
- `app.products.$id.placements.$placementId.tsx:293`: `backAction={{ content: "Configuration" }}`
- `app._index.tsx`: setup guide steps ("Set up a product configuration", "Create a configuration", "Go to configurations"), dashboard section heading "Your configurations" (~10 occurrences)
- `app.tsx:74`: nav link label

- [ ] **Step 1:** In `app.products._index.tsx` — change page title "Configurations" → "Products", modal title "Add Product Configuration" → "Add Product Setup", field label "Configuration Name" → "Setup name", resourceList `singular: "configuration"` → `"product setup"`, `plural: "configurations"` → `"product setups"`, `queryPlaceholder="Search configurations"` → `"Search products"`, all empty state button/body copy
- [ ] **Step 2:** In `app.products.$id._index.tsx` — change `backAction={{ content: "Configurations" }}` → `"Products"`, `label="Configuration name"` → `"Setup name"`, "Delete configuration" button → "Delete product setup", delete modal title/body copy
- [ ] **Step 3:** In `app.products.$id.views.$viewId.tsx:785` — change `backAction={{ content: "Configuration" }}` → `content: config.name` (the product setup name)
- [ ] **Step 4:** In `app.products.$id.placements.$placementId.tsx:293` — change `backAction={{ content: "Configuration" }}` → `content: "Product setup"`
- [ ] **Step 5:** In `app._index.tsx` — change setup guide copy: "Set up a product configuration" → "Set up a product", "Create a configuration" → "Create a product setup", "Go to configurations" → "Go to products", "Your configurations" section heading → "Your products", empty state copy
- [ ] **Step 6:** In `app.tsx:74` — change `Configurations` nav link label → `Products`
- [ ] **Step 7:** Full grep check: `grep -rn "onfiguration" app/routes/ --include="*.tsx"` — fix any remaining user-facing occurrences not caught above
- [ ] **Step 8:** `npm run typecheck && npm run lint` — verify and commit

### Task 1.2: Fix resource picker — exclude fee products

**Gap:** `handleSelectProducts` in `app.products._index.tsx` has no query filter; fee products appear as options.

- [ ] **Step 1:** In `app.products._index.tsx`, add `query: "NOT tag:insignia-fee"` to the `window.shopify.resourcePicker` call (same pattern already used in `app.products.$id._index.tsx:359`)
- [ ] **Step 2:** `npm run typecheck` — verify and commit

### Task 1.3: Fix methods list — optimistic UI + toast

**Gap:** 2-second delay after method creation; toast fires after full reload.

- [ ] **Step 1:** In `app.methods._index.tsx`, convert the create form to use `useFetcher` instead of `useSubmit` + `useNavigation`
- [ ] **Step 2:** Add optimistic rendering: while `fetcher.state === "submitting"`, append a ghost row with the new method name to the table
- [ ] **Step 3:** Move the toast to fire when `fetcher.state` transitions from `"submitting"` to `"idle"` with success data — not on `actionData` effect
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 1.5: Remove debug test endpoint

**Gap:** `app/routes/apps.insignia.test.tsx` is a live debug endpoint with a comment "Can be removed after initial verification." It serves no production purpose and is a minor information-disclosure risk.

- [ ] **Step 1:** Delete `app/routes/apps.insignia.test.tsx`
- [ ] **Step 2:** `npm run typecheck` — verify no other file imports it, then commit

### Task 1.6: Fix attach-artwork — single-logo-to-all-placements bug

**Gap:** In `app.orders.$id.tsx:140-143`, the `attach-artwork` action assigns the same logo to ALL null placement slots at once:
```ts
for (const key of Object.keys(updatedMap)) {
  if (!updatedMap[key]) updatedMap[key] = logoAssetId;
}
```
For orders with multiple placements (e.g., left chest + full back), this blindly fills every empty placement with the same logo. There's also no way to assign different logos per placement from the admin UI. The "Attach artwork" action should accept a `placementId` to target a specific slot, or at minimum not overwrite already-assigned slots (which it doesn't — but it fills ALL empty ones at once).

- [ ] **Step 1:** In `app.orders.$id.tsx` action — accept optional `placementId` in the form data. If provided, only update that specific placement slot in `logoAssetIdsByPlacementId`. If not provided (legacy path), fill all null slots as before.
- [ ] **Step 2:** In the order detail UI — change "Attach artwork" from a single button per line to one "Attach" action per placement row (each row passes its `placementId`)
- [ ] **Step 3:** Only set `artworkStatus = "PROVIDED"` when ALL placements in the map have a non-null `logoAssetId` (check after update, not always on save)
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 1.7: Fix storefront CORS — strict allowlist

**Gap:** Error response paths in storefront endpoints call `corsOrigin()` which echoes the request `Origin` header unchecked. Success paths correctly use `allowedOrigin = \`https://${shopDomain}\`` but the 401/404/400 error paths that fire before the shop domain is validated use the unchecked value.

- [ ] **Step 1:** Read all storefront route files that set `Access-Control-Allow-Origin`: `apps.insignia.config.tsx`, `apps.insignia.customizations.tsx`, `apps.insignia.prepare.tsx`, `apps.insignia.cart-confirm.tsx`, `apps.insignia.uploads.tsx`, `apps.insignia.price.tsx`
- [ ] **Step 2:** In each file — audit every `jsonResponse(...)` call that passes an origin. Change error-path calls that use the unchecked echoed origin to either (a) use the validated `allowedOrigin` if the shop domain is already known, or (b) pass `undefined` (no CORS header) if the shop is not yet validated — safer than echoing an untrusted origin
- [ ] **Step 3:** `npm run typecheck` — verify and commit

---

## Phase 2: Methods Detail — Simplify to 2+1 Fields

**Gap:** Design shows Name + Description (with optional customer-facing name as fallback override). Implementation has 4 fields: Name, Description (internal), Customer-facing name, Customer-facing description.

### Task 2.1: Remove customer-facing description from methods form

**Note:** Keep `customerName` (storefront uses it for method display). Remove `customerDescription` from the UI — the storefront can use `description` for the method body text instead. **Do not drop the DB column** — just stop showing it.

- [ ] **Step 1:** In `app.methods.$id.tsx` — remove the "Customer-facing description" `TextField` from the form JSX
- [ ] **Step 2:** Remove `customerDescription` from the component state, dirty-check, save handler, and discard handler
- [ ] **Step 3:** Remove `customerDescription` from the action's `formData` read and service call
- [ ] **Step 4:** In `app/lib/services/methods.server.ts` — remove `customerDescription` from the update input type (keep it in the DB, just don't write from this form anymore)
- [ ] **Step 5:** Rename "Customer-facing name" label to "Storefront display name" with helpText: "Shown to customers in the method selector. Defaults to the name above if left empty."
- [ ] **Step 6:** Rename "Description" label helpText from "Internal notes — Visible to merchants only" to just "Describe this decoration method to help merchants and customers understand it."
- [ ] **Step 7:** `npm run typecheck && npm run lint` — verify and commit

### Task 2.2: Update storefront config — fall back correctly

**Gap:** Storefront uses `customerDescription` for method body text. After removing it from the form, ensure the storefront falls back to `description`.

- [ ] **Step 1:** In `app/lib/services/storefront-config.server.ts` (or wherever methods are serialised for `/config`) — change the method description field to: `description: method.customerDescription ?? method.description ?? null`
- [ ] **Step 2:** `npm run typecheck` — verify and commit

---

## Phase 3: Products — Create Modal + Duplicate + Add View UX

### Task 3.1: Multi-step create setup modal

**Gap:** Current modal is a flat form. Design shows: Step 1 — pick product (resource picker). Step 2 — choose start method (preset / duplicate / blank) with descriptions. Step 3 — confirm with auto-generated name (editable).

- [ ] **Step 1:** Refactor `app.products._index.tsx` modal into a 3-step wizard using Polaris `Modal` + local step state
- [ ] **Step 2:** Step 1 — product picker only (resource picker button + selected product display: title + variant count + price)
- [ ] **Step 3:** Step 2 — three choice cards: "Use a preset" (pre-configured zones), "Duplicate existing setup" (copy from another config), "Start blank" (manual). Show preset selector when "Use a preset" chosen (T-Shirt / Hoodie / Polo / Cap / More). Show config selector when "Duplicate" chosen.
- [ ] **Step 4:** Step 3 — confirm: show auto-generated name (from product title, editable), summary of choices, "Create setup" primary button
- [ ] **Step 5:** Wire "Duplicate existing setup" to pass `duplicateFromId` to the action; add duplicate logic in the action (copy views + placements + pricing from source config)
- [ ] **Step 6:** `npm run typecheck && npm run lint` — verify and commit

### Task 3.2: Duplicate setup on product detail

**Gap:** "Duplicate this product setup" CTA shown in design but not implemented.

- [ ] **Step 1:** Add a "Duplicate setup" button to `app.products.$id._index.tsx` in the danger zone / actions section
- [ ] **Step 2:** Add `intent: "duplicate"` to the action handler — create a new `ProductConfig` copying `name + " (copy)"`, same `linkedProductIds`, `allowedMethods`, `views` (with `variantViewConfigurations`), and `placements` (with `steps`)
- [ ] **Step 3:** After duplication, `redirect` to the new config's detail page
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 3.3: Add view — explainer + custom name

**Gap:** Add view modal is just a perspective dropdown. No explanation of what a view is. No custom name entry.

- [ ] **Step 1:** In `app.products.$id._index.tsx`, add a `Text` paragraph above the `Select` in the Add View modal: "A view represents a product angle (e.g. Front, Back, Left Sleeve). Upload a product photo for each view, then position your print areas on it."
- [ ] **Step 2:** Add a "Custom name" `TextField` that appears when perspective is "custom", replacing the perspective value with a freeform name
- [ ] **Step 3:** Update the create-view action to accept either a preset perspective or a custom name
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 3.4: First-setup banner + Preview on store

**Gap:** "Product setup created — next steps" banner and "Preview on store" link missing for first-time state.

- [ ] **Step 1:** In `app.products.$id._index.tsx` loader, detect first-setup state: `views.length === 0 && variantConfigsWithImages === 0`
- [ ] **Step 2:** Render a dismissible `Banner` when first-setup: "Product setup created — next steps: Upload product photos in the Image Manager, then position zones in the View Editor." with a "Manage Images" primary action
- [ ] **Step 3:** Add a "Preview on store" secondary button (links to the Shopify storefront product page for the first `linkedProductIds` entry)
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 4: Orders List — Search, Filter, Export, Pagination

### Task 4.1: Search + method filter + date filter

**Gap:** No search bar, no method filter, no date filter on orders list.

- [ ] **Step 1:** In `app.orders._index.tsx` loader — accept `search`, `methodId`, `dateFrom` URL params and apply them as Prisma `where` filters on `OrderLineCustomization`
- [ ] **Step 2:** Add `TextField` (search), `Select` (All methods), `Select` (All dates: Today / This week / This month / All time) to the page header
- [ ] **Step 3:** Wire filter changes to update URL search params (`useSearchParams` + `setSearchParams`)
- [ ] **Step 4:** Populate "All methods" selector options from loader data (list of distinct methods on orders)
- [ ] **Step 5:** `npm run typecheck && npm run lint` — verify and commit

### Task 4.2: Pagination

**Gap:** `take: 100` hardcoded. No pagination UI.

- [ ] **Step 1:** In the orders loader — accept `page` param (default 1), use `skip: (page-1)*PAGE_SIZE, take: PAGE_SIZE` with `_count` query for total pages. `PAGE_SIZE = 25`.
- [ ] **Step 2:** Add `Pagination` Polaris component below the table: "Previous / Page X of Y / Next"
- [ ] **Step 3:** Wire Previous/Next to increment/decrement `page` param in URL
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 4.3: Export CSV

**Gap:** "Export CSV" button missing from orders list.

- [ ] **Step 1:** Add a new action intent `export-csv` to the orders list action (or a dedicated resource route `api.admin.orders.export.tsx`)
- [ ] **Step 2:** Query all matching orders (respecting current search/filter, no pagination limit)
- [ ] **Step 3:** Build CSV: Order #, Date, Method, Lines, Artwork status, Fee
- [ ] **Step 4:** Return response with `Content-Type: text/csv` and `Content-Disposition: attachment; filename="orders.csv"`
- [ ] **Step 5:** Add "Export CSV" `Button` (variant plain, icon `ExportIcon`) to orders list page header
- [ ] **Step 6:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 5: Orders Detail — Full Production View

### Task 5.1: Wire production workflow to DB

**Gap:** `WORKFLOW_STEPS` is cosmetic. `currentStepIndex` hardcoded to 0/1. No DB field, no action. Requires Phase 0.

- [ ] **Step 1:** In `app.orders.$id.tsx` loader — read `productionStatus` from `OrderLineCustomization`
- [ ] **Step 2:** Map `productionStatus` enum values to step indices: `ARTWORK_PENDING=0, ARTWORK_PROVIDED=1, IN_PRODUCTION=2, QUALITY_CHECK=3, SHIPPED=4`
- [ ] **Step 3:** Replace hardcoded `currentStepIndex` with the mapped value from DB
- [ ] **Step 4:** Add action intent `advance-status` — accepts `lineId` + `newStatus`, validates the transition is forward-only, updates `productionStatus` in DB
- [ ] **Step 5:** Add "Mark in production" `Button` (primary) that fires when `productionStatus === ARTWORK_PROVIDED`. Button advances status to `IN_PRODUCTION`.
- [ ] **Step 6:** Add subsequent advance buttons contextually (Quality check → Shipped) at each stage
- [ ] **Step 7:** `npm run typecheck && npm run lint` — verify and commit

### Task 5.2: Customer info + order summary

**Gap:** No customer name/email/Shopify link. No product subtotal/fee subtotal/total breakdown.

- [ ] **Step 1:** In the orders loader, fetch the Shopify order via Admin GraphQL: `query { order(id: $id) { name customer { firstName lastName email } currentTotalPriceSet { shopMoney { amount currencyCode } } lineItems { edges { node { id quantity originalUnitPriceSet { shopMoney { amount } } } } } } }`
- [ ] **Step 2:** Add "Customer" card to order detail: customer name, email, "View in Shopify" link (to Shopify admin order URL)
- [ ] **Step 3:** Add "Order summary" card: Product total (from Shopify line item price × qty), Customization fee total (sum of `unitPriceCents` across lines), Total
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 5.3: Artwork file metadata + download link

**Gap:** No filename, dimensions, file size, or download link shown for uploaded artwork.

- [ ] **Step 1:** In the orders loader — join `LogoAsset` fields: `originalFileName`, `fileSizeBytes`, and add a presigned GET URL for the original file (using `getPresignedGetUrl`)
- [ ] **Step 2:** In the order line rendering — show "Artwork file" block: filename, file size (formatted KB/MB), "Download" link (presigned URL, `target="_blank"`)
- [ ] **Step 3:** If `artworkStatus === PENDING_CUSTOMER` show placeholder text instead
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 5.4: Visual mockup canvas (Konva)

**Gap:** `order-detail-rendering.md` specifies client-side Konva rendering with placement geometry. Not implemented.

- [ ] **Step 1:** In the loader — fetch all data required per `order-detail-rendering.md`: `VariantViewConfiguration` for the order line's `variantId` (image URL), `ProductView.placementGeometry`, placement names and step sizes
- [ ] **Step 2:** Create `app/components/OrderLinePreview.tsx` — a lazy-loaded Konva Stage that: renders the product image, overlays a rectangle per placement zone (from `placementGeometry`), shows the logo asset (presigned URL) or placeholder "LOGO" text at the correct zone
- [ ] **Step 3:** Use the same `PlacementGeometryEditor` Stage/Layer/Image primitives — render-only, no interaction
- [ ] **Step 4:** Replace the current logo thumbnail + placement list with `<OrderLinePreview />` per line
- [ ] **Step 5:** `npm run typecheck && npm run lint` — verify and commit

### Task 5.5: "Send reminder" button + template management

**Gap:** `orders-workflow.md` says "Send reminder" MUST be present (disabled) + template management UI needed.

- [ ] **Step 1:** Add a "Send reminder" `Button` (disabled, with tooltip "Coming soon — use Copy email template for now") next to the copy-template button
- [ ] **Step 2:** Add a collapsible "Edit template" section below the copy button — a `TextField` (multiline) pre-filled with the hardcoded template, with a "Reset to default" link
- [ ] **Step 3:** Persist the merchant's custom template in `MerchantSettings.emailReminderTemplate` (add field to schema + migration)
- [ ] **Step 4:** Load the custom template in the orders detail loader; use it in `handleCopyEmail`
- [ ] **Step 5:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 6: Dashboard — Activity Tab + Export + Preview Store

### Task 6.1: Activity tab

**Gap:** "Activity" tab designed but missing. "Analytics" tab is a placeholder.

- [ ] **Step 1:** In `app._index.tsx` — add "Activity" tab alongside existing content
- [ ] **Step 2:** Activity tab content: a time-sorted list of recent events — method created, product setup created, order received, artwork uploaded. Query from `WebhookEvent` table + recent `OrderLineCustomization` + `DecorativeMethod`/`ProductConfig` `createdAt` fields, limit 20
- [ ] **Step 3:** Each activity item: icon, description ("Order #1042 received — Embroidery"), timestamp (relative: "3 hours ago")
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 6.3: Analytics tab — real data (from existing DB)

**Gap:** "Analytics" tab shows `<EmptyState heading="Analytics coming soon">` — no data. Revenue/billing API is not required: all needed data already exists in `OrderLineCustomization` (fees, method, dates) and `LogoAsset` (artwork completions).

- [ ] **Step 1:** In the `app._index.tsx` loader — query analytics from DB: total orders this month (`_count` on `OrderLineCustomization` grouped by `createdAt` month), artwork completion rate (`PROVIDED` / total × 100%), top methods by order count, total fee revenue this month (sum of `unitPriceCents`)
- [ ] **Step 2:** Replace the `EmptyState` with a `Layout` of `Card` stat blocks: Orders this month, Artwork provided %, Top method, Estimated revenue this month (formatted currency)
- [ ] **Step 3:** Add a simple bar-style list for "Orders by method" (method name + count, no charting library needed — use Polaris `ProgressBar` for visual proportion)
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

### Task 6.2: Export orders + Preview store buttons

**Gap:** Both buttons shown in dashboard header, not implemented.

- [ ] **Step 1:** Add "Export orders" `Button` to dashboard page header — links to the orders export endpoint from Phase 4 (no filters, exports all)
- [ ] **Step 2:** Add "Preview store" `Button` — links to `https://{shopDomain}/products` (open in new tab). Read shop domain from loader session.
- [ ] **Step 3:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 7: Settings — Translations Tab

**Gap:** "Translations" tab is in the design (`Settings > General | Translations`) but entirely absent.

### Task 7.1: Schema — translations table

- [ ] **Step 1:** Add model `StorefrontTranslation { id, shopId, languageCode, key, value, updatedAt }` to `prisma/schema.prisma`
- [ ] **Step 2:** Define translation keys as a TS const: step labels (Upload, Placement, Size, Review), button labels (Continue, Add to Cart, Add my logo later), modal title, method selector heading, placement selector heading
- [ ] **Step 3:** `npx prisma migrate dev --name add-translations` + `npx prisma validate`
- [ ] **Step 4:** Verify and commit

### Task 7.2: Translations UI

- [ ] **Step 1:** In `app.settings.tsx` — add "Translations" tab to the existing tabs array
- [ ] **Step 2:** Translations panel: language selector (dropdown of ISO codes, start with `en`, `nl`, `de`, `fr`) + a table of key/value rows
- [ ] **Step 3:** Each row: key label (human-readable), default value (grayed out placeholder), editable `TextField` for override
- [ ] **Step 4:** Save action — upsert `StorefrontTranslation` rows for the selected language
- [ ] **Step 5:** In the storefront `/config` endpoint — include translations for the shop's configured language(s) in the response
- [ ] **Step 6:** `npm run typecheck && npm run lint` — verify and commit

### Task 7.3: Expand base storefront i18n.ts

**Gap:** `app/components/storefront/i18n.ts` has `type Locale = "en"` — only English. The original V2 plan specified 8 languages (nl, de, fr, es, pt, it, pl, sv) but the expansion was never done. This is the built-in base locale fallback, separate from merchant-configurable overrides (Task 7.2).

- [ ] **Step 1:** In `app/components/storefront/i18n.ts` — expand `type Locale` to `"en" | "nl" | "de" | "fr" | "es" | "pt" | "it" | "pl" | "sv"`
- [ ] **Step 2:** Add full translation objects for all 8 additional locales — all string keys that exist under `en` must have equivalents for each locale
- [ ] **Step 3:** Update the `t()` function to fall back to `en` if a key is missing in the requested locale
- [ ] **Step 4:** In the storefront modal bootstrapping code — detect the shop's locale from the `window.Shopify.locale` value (already available via App Proxy) and pass it to `t()`
- [ ] **Step 5:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 8: View Editor — Quick Start Presets

**Gap:** "Quick start presets" section (Left Chest, Center, Full, Sleeve) shown in view editor design but not implemented.

### Task 8.1: Add quick-start zone presets

- [ ] **Step 1:** Define preset geometries as a const in the view editor route: `LEFT_CHEST = { centerXPercent: 28, centerYPercent: 30, maxWidthPercent: 20 }`, `CENTER = { centerXPercent: 50, centerYPercent: 45, maxWidthPercent: 35 }`, `FULL_FRONT = { centerXPercent: 50, centerYPercent: 45, maxWidthPercent: 70 }`, `SLEEVE = { centerXPercent: 15, centerYPercent: 30, maxWidthPercent: 15 }`
- [ ] **Step 2:** Add "Quick start presets" section below the print areas list in the right panel — four small clickable cards (Left Chest, Center, Full, Sleeve)
- [ ] **Step 3:** Clicking a preset fires `save-placement-geometry` intent with the preset geometry merged into the existing zones (adds the zone if a placement with that name doesn't exist yet)
- [ ] **Step 4:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 9: Image Manager — Import from Shopify

**Gap:** "Import from Shopify" feature designed but not wired to UI. The backend endpoint `import-shopify-images` already exists (`0a07d3a`).

### Task 9.1: Wire Import from Shopify UI

- [ ] **Step 1:** In `app.products.$id.images.tsx` loader — call the existing Shopify import endpoint to get a count of available product images for the linked Shopify product. Store `shopifyImageCount` in loader data.
- [ ] **Step 2:** If `shopifyImageCount > 0` and there are unassigned tray slots, render a `Banner` in the image tray area: "We found {n} product images in your Shopify store. Import them, then drag to the correct colour below." with an "Import" `Button`
- [ ] **Step 3:** Clicking "Import" fires the existing `import-shopify-images` action intent — fetches Shopify product images and adds them to the tray as unassigned images
- [ ] **Step 4:** After import, banner updates to show "X images imported to tray"
- [ ] **Step 5:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 10: Customer Upload Page — Post-Purchase Storefront Route

**Gap:** The design shows a standalone customer-facing page "Upload your logo / Order #XXXX" for post-purchase artwork submission. No route exists.

### Task 10.1: Customer upload route

**Note:** `app/routes/apps.insignia.uploads.tsx` already exists (partial — handles file upload mechanics). This task completes the missing customer-facing UI: the order-linked page, token validation, and "Back to order status" flow. Do NOT create a new route — extend the existing one.

- [ ] **Step 1:** Read `app/routes/apps.insignia.uploads.tsx` to understand what's already implemented before adding anything
- [ ] **Step 2:** GET loader — accepts `?orderId=&lineId=&token=` params. Validate `token` (a signed HMAC of `orderId:lineId` using the app secret — prevents unauthorized access). Return order name, product name, method name for display.
- [ ] **Step 3:** Page UI: "Upload your logo" heading, "Order #{name} — {product}" subheading, file upload zone (SVG/PNG/JPG, max 5MB), "Submit Logo" primary button, "Back to order status" link (to `orderStatusUrl` from `OrderLineCustomization`)
- [ ] **Step 4:** POST action — same upload flow as the admin artwork attach: create presigned URL, receive `storageKey`, create `LogoAsset`, update `OrderLineCustomization.artworkStatus = PROVIDED`
- [ ] **Step 5:** Success state: "Logo received!" confirmation with filename + size, "Replace" button, "Back to order status" link
- [ ] **Step 6:** In `app.orders.$id.tsx` — generate the signed customer upload URL per pending line and display it as a copyable link alongside the "Copy email template" button
- [ ] **Step 7:** `npm run typecheck && npm run lint` — verify and commit

---

## Phase 11: Remaining Partial Completions

### Task 11.1: Last-tier deletion guard

**Gap:** Plan 10.2 — prevent deleting the last size tier on a placement.

- [ ] **Step 1:** In the view editor `delete-step` action — check `steps.length > 1` before deleting; return error if attempting to delete the last step
- [ ] **Step 2:** In the UI — disable the delete button on a step row when `steps.length === 1`, with tooltip "A placement must have at least one size tier"
- [ ] **Step 3:** Verify and commit

### Task 11.2: Image Tray — 20+ color pagination + retry

**Gap:** Plan 10.3 — image tray missing pagination for 20+ color groups and upload retry.

- [ ] **Step 1:** In `app.products.$id.images.tsx` — if `colorGroups.length > 20`, paginate: show 20 at a time with "Show more" button
- [ ] **Step 2:** Add retry button on `Upload failed` cell state — re-queues the failed upload
- [ ] **Step 3:** Verify and commit

### Task 11.3: View Editor — undo/redo + arrow nudge

**Gap:** Plan 10.4 — undo/redo and keyboard arrow-key nudge missing.

- [ ] **Step 1:** In `PlacementGeometryEditor.tsx` — add a history stack (array of rect states). On every geometry change, push a snapshot. Limit to 20 entries.
- [ ] **Step 2:** Add `Cmd+Z` / `Ctrl+Z` listener → pop from history stack and restore previous state
- [ ] **Step 3:** Add `keydown` listener on selected zone: arrow keys nudge `x/y` by 0.5% increments (percentage-based, so resolution-independent)
- [ ] **Step 4:** Verify and commit

### Task 11.4: Rate limiting on storefront endpoints

**Gap:** `storefront.md` contract requires rate limiting. Not implemented.

- [ ] **Step 1:** Add a lightweight in-memory rate limiter (or use a simple sliding window counter in the DB via `WebhookEvent` table counts) — limit to 60 requests/minute per shop on storefront endpoints
- [ ] **Step 2:** Apply to `/config`, `/customizations`, `/price`, `/prepare`, `/uploads`
- [ ] **Step 3:** Return `429 Too Many Requests` with `Retry-After` header when limit exceeded
- [ ] **Step 4:** Verify and commit


---

## Appendix A: Gap → Task Map

| Gap | Task |
|-----|------|
| Terminology: "Configuration" across 6 routes + nav + dashboard | 1.1 |
| Fee products in resource picker | 1.2 |
| Methods list delay + toast | 1.3 |
| CORS echoes unchecked origin on error paths | 1.7 |
| Debug test endpoint still live in production | 1.5 |
| Attach-artwork assigns same logo to all placements at once | 1.6 |
| Methods form 4→2 fields | 2.1 |
| Storefront falls back to description | 2.2 |
| Create setup multi-step modal | 3.1 |
| Duplicate setup | 3.2 |
| Add view explainer + custom name | 3.3 |
| First-setup banner + Preview on store | 3.4 |
| Orders search + filter | 4.1 |
| Orders pagination | 4.2 |
| Export CSV | 4.3 |
| Production workflow DB-backed | 5.1 |
| Customer info + order summary | 5.2 |
| Artwork download link + metadata | 5.3 |
| Visual mockup canvas (Konva) | 5.4 |
| Send reminder + template editor | 5.5 |
| Dashboard Activity tab | 6.1 |
| Export orders + Preview store buttons | 6.2 |
| Analytics tab with real DB data | 6.3 |
| Translations schema | 7.1 |
| Translations UI | 7.2 |
| Base storefront i18n.ts — 8 languages | 7.3 |
| View editor quick start presets | 8.1 |
| Image manager Import from Shopify | 9.1 |
| Customer upload page | 10.1 |
| Last-tier deletion guard | 11.1 |
| Image tray 20+ pagination + retry | 11.2 |
| Undo/redo + arrow nudge | 11.3 |
| Rate limiting | 11.4 |
**Total: 46 tasks across 11 phases**

---

## Appendix B: What Is NOT in This Plan

These were explicitly considered and excluded:

- **Bulk actions** (bulk delete products/methods) — not in any .pen design. Out of scope.
- **Global search** — not in .pen design. Out of scope.
- **Schema column drops** (orphaned `customerDescription`, `installedAt` etc.) — safe to leave; not worth a migration just for cleanup.
- **TTL configurability via env vars** — `RESERVED_TTL_MINUTES = 15` and `IN_CART_TTL_DAYS = 7` are hardcoded constants. Acceptable defaults; making them env-configurable is not a gap against any design or spec.
- **Multiply-blend colour matching** — was planned in V2 (Task 6 of `2026-04-05-insignia-v2-implementation.md`) but **explicitly abandoned** in `2026-04-06-image-manager-dashboard-redesign.md`: "Color matching via multiply blend was abandoned." The Color Match frame was gutted and replaced with the Image Manager. Do not implement.
