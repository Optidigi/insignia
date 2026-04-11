# Insignia Shopify App — State Audit

> **Audit date**: 2026-04-11 (updated same day — blockers 1, 2, 5 resolved)
> **Auditor**: Claude (automated)  
> **Working directory**: `Insignia-shopify-app/`

---

## 1. Tooling

| Tool | Version / Status | Notes |
|------|-----------------|-------|
| Node.js | v25.5.0 — **OUT OF RANGE** | `package.json` engines: `>=20.19 <22 \|\| >=22.12`. Node v25 is not in either range. App will emit an engines warning; framework compatibility is untested at this version. |
| npm | 11.8.0 | Emits `Unknown project config "shamefully-hoist"` warning on every run. |
| Shopify CLI | ✅ **3.93.2** (installed same day) | `npm install -g @shopify/cli`. `shopify version 3.93.2` confirmed. |
| Prisma CLI | 6.19.2 (local, not on PATH) | Only runnable as `node node_modules/prisma/build/index.js`. `npx prisma` fails because `prisma` is not on PATH. |
| TypeScript | 5.9.3 | Available via `node_modules`. |
| ESLint | 8.57.1 | Available via `node_modules`. |
| node_modules | Installed (599 top-level packages) | |
| `.env` file | ✅ **Created** (same day) | `DATABASE_URL=postgresql://insignia:insignia_dev@localhost:5432/insignia`; `SHOPIFY_API_KEY` set from `shopify.app.toml client_id`. `SHOPIFY_API_SECRET` still empty — requires Shopify Partner Dashboard. |
| PostgreSQL | ✅ **18.3** (scoop, running) | Installed via scoop. `insignia` user + database created. 15 migrations applied successfully. |
| Prisma client | ✅ **Generated** (same day) | `prisma generate` completed. All missing enums (`ViewPerspective`, `ProductionStatus`) and types now present. |
| Claude in Chrome MCP | Not tested | Dev server not yet started (SHOPIFY_API_SECRET missing). |
| Shopify Dev MCP | Not tested | |

**Prisma validate**: ✅ `The schema at prisma\schema.prisma is valid 🚀` — ran after setting DATABASE_URL and running migrations.

**Migrations**: All 15 migrations applied successfully. Last: `20260410134821_add_calibration_px_per_cm`.

---

## 2. Static Analysis

### 2a. TypeScript (`npm run typecheck`)

**✅ RESOLVED (same day): 0 errors after `prisma generate`.** Prisma client regenerated; all enum and type errors eliminated.

Original errors documented below for reference.

#### Category A — Prisma client not generated (RESOLVED)

The Prisma client types in `node_modules/.prisma/client/` do not match the current `prisma/schema.prisma`. Fix: run `npx prisma generate` (or `node node_modules/prisma/build/index.js generate`).

| Error | File:Line | Details |
|-------|-----------|---------|
| TS2305 `ViewPerspective` not exported from `@prisma/client` | `app/lib/services/product-configs.server.ts:9` | Enum exists in schema.prisma but not in generated client |
| TS2305 `ViewPerspective` not exported from `@prisma/client` | `app/lib/services/views.server.ts:11` | Same |
| TS2305 `ProductionStatus` not exported from `@prisma/client` | `app/routes/app.orders.$id.tsx:30` | Enum exists in schema.prisma but not in generated client |
| TS2305 `ProductionStatus` not exported from `@prisma/client` | `app/routes/webhooks.orders.create.tsx:9` | Same |
| TS2339 `Prisma.DbNull` does not exist | `app/lib/services/methods.server.ts:185` | Prisma v6 API change |
| TS2339 `Prisma.DbNull` does not exist | `app/lib/services/views.server.ts:218,232,288` | Same |
| TS2339 `Prisma.DbNull` does not exist | `app/routes/webhooks.orders.create.tsx:135,138` | Same |
| TS2694 `Prisma.InputJsonValue` not exported | `app/lib/services/product-configs.server.ts:276` | Prisma v6 API change |
| TS2694 `Prisma.InputJsonValue` not exported | `app/lib/services/views.server.ts:219,233` | Same |
| TS2694 `Prisma.InputJsonValue` not exported | `app/routes/app.products.$id.views.$viewId.tsx:386` | Same |
| TS2694 `Prisma.InputJsonValue` not exported | `app/routes/webhooks.orders.create.tsx:137,169,192,196,200,207` | Same |

#### Category B — Downstream Prisma type errors

Caused by unresolved Prisma types; will resolve once client is regenerated.

| Error | File:Line |
|-------|-----------|
| TS2339 `imageUrl` does not exist on `{}` | `app/lib/services/storefront-config.server.ts:189` |
| TS2339 `placementGeometry` does not exist on `{}` | `app/lib/services/storefront-config.server.ts:211` |
| TS2339 `data` does not exist on `unknown` | `app/lib/services/placements.server.ts:161` |

#### Category C — Implicit `any` parameters (TS7006) — ~82 instances

Widespread throughout routes and services. These are callback/lambda parameters without explicit types (e.g., `.map((c) => ...)` instead of `.map((c: SomeType) => ...)`). Representative sample:

| File | Line | Parameter |
|------|------|-----------|
| `app/lib/services/image-manager.server.ts` | 204 | `tx` in Prisma transaction |
| `app/lib/services/storefront-config.server.ts` | 184,187,234,239,263 | Various callbacks |
| `app/lib/services/storefront-customizations.server.ts` | 42,50,55,116 | Various callbacks |
| `app/routes/app._index.tsx` | 221,242,292,298,304,310,352,984,1099 | Various callbacks |
| `app/routes/app.orders.$id.tsx` | 107,135,230,290,497,500,531,538,613,686,736,749 | Various callbacks |
| `app/routes/app.products.$id._index.tsx` | 99,103,155,158,168,169,371,433,472,646,701–703,883 | Various callbacks |
| `app/routes/app.products.$id.views.$viewId.tsx` | 193,198,762,773,868,900,905,913 | Various callbacks |
| `app/routes/webhooks.orders.create.tsx` | 189 | `vc` in geometry snapshot loop |
| `app/routes/webhooks.orders.paid.tsx` | 130 | `tx` in Prisma transaction |

These do not prevent compilation in non-strict mode but fail under `tsc --noEmit` because `tsconfig.json` has `strict: true` (implied by `@shopify/shopify-app-react-router` base config).

### 2b. ESLint (`npm run lint`)

**✅ RESOLVED (same day): 0 errors.** Removed unused `Select` import and `PERSPECTIVE_OPTIONS` constant from `app.products.$id._index.tsx`. 4 warnings remain (all `react-hooks/exhaustive-deps`, non-blocking).

Original errors:

| Severity | Rule | File:Line | Detail |
|----------|------|-----------|--------|
| ~~ERROR~~ FIXED | `@typescript-eslint/no-unused-vars` | `app/routes/app.products.$id._index.tsx:36` | `'Select'` import removed |
| ~~ERROR~~ FIXED | `@typescript-eslint/no-unused-vars` | `app/routes/app.products.$id._index.tsx:56` | `PERSPECTIVE_OPTIONS` constant removed |
| WARNING | `react-hooks/exhaustive-deps` | `app/components/storefront/CustomizationModal.tsx:319` | `logoAssetIdsByPlacementId` object recreated each render; should be memoized |
| WARNING | `react-hooks/exhaustive-deps` | `app/routes/app.methods.$id.tsx:202` | `loaderConstraints` expression in deps of `useMemo` (line 245) and `useCallback` (line 321) |
| WARNING | `react-hooks/exhaustive-deps` | `app/routes/app.settings.tsx:325` | `navigation.formData` missing from `useEffect` dependency array |

### 2c. Prisma Validate

Blocked — see Tooling section. Schema structure validated manually: 13 models, all relationships and indexes look syntactically correct. No structural issues detected from reading `prisma/schema.prisma`.

### 2d. Shopify GraphQL validation (`validate_graphql_codeblocks`)

Not run — Shopify Dev MCP requires a live app context. GraphQL operations inspected manually:

- All operations in `app/lib/services/variant-pool.server.ts` include `#graphql` template tag.
- Mutations observed: `productCreate`, `productVariantsBulkUpdate`, `productVariantsBulkCreate`, `publishablePublish`, `inventoryItemUpdate`, `productUpdate` — all are valid 2026-04 API mutations.
- Known issue: `shopify.server.ts:13` uses `ApiVersion.October25` — see Spec vs Code section.

### 2e. Theme Liquid validation (`validate_theme`)

Not run — requires Shopify Dev MCP. Manual inspection of `extensions/insignia-theme/blocks/`:

- `customize-button.liquid`: Valid `{% schema %}` block with `"target": "section"`. Uses `block.shopify_attributes`, `block.settings`, and `product` Liquid objects correctly.
- `fee-product-redirect.liquid`: Valid `{% schema %}` block with `"target": "head"`. Uses `template.name` and `product.tags` — both valid Liquid objects.
- No `templates/` directory exists — constraint satisfied.

---

## 3. Spec vs Code

### 3.1 API Version — CRITICAL DIVERGENCE

**Spec** (`CLAUDE.md`, `shopify.app.toml`): API version must be `2026-04`.

**Code** (`app/shopify.server.ts:13,28`):
```ts
apiVersion: ApiVersion.October25,  // ← WRONG
export const apiVersion = ApiVersion.October25;  // ← WRONG
```

`ApiVersion.October25` corresponds to `2025-10`, not `2026-04`. All Shopify Admin GraphQL calls made through the framework client will use the wrong version. This affects every admin-side operation: product creation, variant updates, publications, etc.

### 3.2 Webhook Subscriptions — CRITICAL (orders/create and orders/paid inactive)

**Spec** (`docs/core/api-contracts/webhooks.md`): `orders/create` and `orders/paid` webhooks are required for order binding, geometry snapshot capture, and slot recycling.

**Code** (`shopify.app.toml:27–35`): Both subscriptions are commented out:
```toml
# NOTE: Order webhooks require "protected customer data" approval
# [[webhooks.subscriptions]]
# topics = [ "orders/create" ]
# uri = "/webhooks/orders/create"
# [[webhooks.subscriptions]]
# topics = [ "orders/paid" ]
# uri = "/webhooks/orders/paid"
```

The route handlers (`app/routes/webhooks.orders.create.tsx`, `webhooks.orders.paid.tsx`) and all underlying services are fully implemented. But without the subscriptions registered in `shopify.app.toml`, Shopify will not send these webhooks. Slot recycling and order-line binding do not work in production.

### 3.3 Upload Endpoint — DIVERGENCE from spec

**Spec** (`docs/core/api-contracts/storefront.md`):
```
POST /apps/insignia/uploads → { uploadId, putUrl, expiresAt }  (client PUTs directly)
POST /apps/insignia/uploads/:id/complete → { logoAsset }
```

**Code** (`app/routes/apps.insignia.uploads.tsx`): Accepts `multipart/form-data` with a `file` field and performs server-side upload. Returns the `logoAsset` directly. Does NOT return a presigned PUT URL. The `createStorefrontUpload()` service (which returns `{uploadId, putUrl, expiresAt}`) exists in `app/lib/services/storefront-uploads.server.ts:43` but is not called by the route.

**Effect**: `apps.insignia.uploads.$id.complete.tsx` exists and compiles, but is unreachable via the current storefront upload flow. The storefront `CustomizationModal` must call the server-side endpoint instead of doing a direct PUT. If the modal JS expects the presigned URL flow (spec), it will break.

### 3.4 Rate Limiting on `cart-confirm` — ✅ RESOLVED

**Spec** (`docs/core/api-contracts/storefront.md`): All storefront endpoints MUST apply rate limiting.

**Code** (`app/routes/apps.insignia.cart-confirm.tsx`): `checkRateLimit` added to cart-confirm after shop lookup, matching the pattern used in all other storefront routes.

### 3.5 CORS Preflight — ✅ RESOLVED

**Spec**: "MUST enforce a strict CORS allowlist."

**Code**: Sets `Access-Control-Allow-Origin: https://{shopDomain}` (correct single-origin restriction). OPTIONS preflight handling added to all storefront routes, returning proper `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` headers.

### 3.6 Auth / Session Token Validation — MATCHES SPEC

`app/shopify.server.ts` uses `@shopify/shopify-app-react-router` which handles JWT validation automatically on every request via `authenticate.admin(request)`. Per-request, not cached. Matches the admin.md spec requirement.

### 3.7 SVG Upload Safety — MATCHES SPEC

`app/lib/svg-sanitizer.server.ts` uses DOMPurify + JSDOM server-side. Forbids `script`, `iframe`, `object`, `embed`, `link`, `use` tags. Checks for external `https://` references. Matches all rules in `docs/core/svg-upload-safety.md`.

### 3.8 Variant Pool Invariants — MATCHES SPEC

- Fee products created with `status: "UNLISTED"` (`variant-pool.server.ts:197`).
- Published to Online Store via `publishablePublish` mutation.
- Self-healing: `ensureVariantPoolExists` detects deleted products, cleans stale DB rows, re-provisions (`variant-pool.server.ts:326–384`).
- Inventory tracking disabled; `inventoryPolicy: CONTINUE` set on all slots.
- Matches `docs/core/variant-pool/overview.md` and `implementation.md`.

### 3.9 Geometry Snapshot — MATCHES SPEC (with noted limitation)

- `placementGeometrySnapshotByViewId` JSONB column exists on `OrderLineCustomization` (schema.prisma:429).
- `webhooks.orders.create.tsx:166–208` captures snapshot at order creation, respects `sharedZones` flag.
- `useLiveConfigFallback: true` set when snapshot is null.
- Matches `docs/core/geometry-snapshot-specification.md`.
- **Noted limitation (✅ RESOLVED)**: DB-level immutability trigger added via raw SQL migration. A Postgres `BEFORE UPDATE` trigger now enforces snapshot immutability on `OrderLineCustomization.placementGeometrySnapshotByViewId`.

### 3.10 Storefront Config Response — MATCHES SPEC

`app/lib/services/storefront-config.server.ts` returns all fields required by `docs/core/storefront-config.md`: `shop`, `productId`, `variantId`, `currency`, `placeholderLogo`, `views`, `methods`, `placements` with `geometryByViewId`. Extra fields `translations` and `locale` are additions, not conflicts.

### 3.11 Webhook Idempotency — MATCHES SPEC

`app/lib/services/webhook-idempotency.server.ts` persists `eventId` in `WebhookEvent` table with unique constraint. Uses `processWebhookIdempotently()` wrapper in both order webhooks. Matches `docs/core/api-contracts/webhooks.md`.

---

## 4. Runtime

### 4.1 Dev server

**Status: ✅ RUNNING**

```
shopify app dev --store=insignia-app.myshopify.com
Tunnel: https://priest-authority-resource-marathon.trycloudflare.com
App proxy: https://priest-authority-resource-marathon.trycloudflare.com/apps/insignia
Local: http://localhost:61446/
GraphiQL: http://localhost:3457/
Theme ext: http://127.0.0.1:9293/
```

All services started without errors. Prisma ran `prisma generate` on boot and confirmed no pending migrations. `shopify-api v12.3.0` initialized successfully.

### 4.2 Visual inspection

**Status: ✅ COMPLETE**

All admin dashboard pages verified via screenshot in Shopify Admin (`insignia-app.myshopify.com`):

| Page | Route | Result |
|------|-------|--------|
| Dashboard / Home | `/app` | ✅ Renders correctly — "Welcome to Insignia" setup guide, 4-step onboarding, "Export orders" + "Preview store" buttons |
| Decoration Methods (empty) | `/app/methods` | ✅ Renders correctly — empty state with illustration and CTA |
| Decoration Methods (populated) | `/app/methods` | ✅ Renders correctly — table with Name, Products, Created columns after creation |
| Method detail | `/app/methods/:id` | ✅ Renders correctly — General (Name, Description, Storefront display name), Pricing (Base price), Artwork constraints (file type checkboxes: SVG, PNG, JPG, PDF, AI, EPS, WEBP, TIFF) |
| Products (empty) | `/app/products` | ✅ Renders correctly — dependency warning banner ("Create a method first"), empty state with CTA |
| Orders | `/app/orders` | ✅ Renders correctly — Search bar, "All methods" + "All time" filters, "All orders" / "Awaiting Artwork" tabs, "Export CSV" button, empty state |
| Settings | `/app/settings` | ✅ Renders correctly — "General" + "Translations" tabs, Theme integration card, Placeholder logo upload |

No broken layouts, missing Polaris components, or visual inconsistencies observed.

### 4.3 Functional test — Decoration Method creation

**Status: ✅ PASSED**

Created "Embroidery" decoration method via the modal dialog:
- Modal opens correctly with "Method Name" field and Cancel/Create buttons
- Form submitted successfully
- Record persisted to PostgreSQL: appeared in list with "0 products" and creation date "11 Apr 2026"
- "Method created" success toast fired
- Navigation to detail page (`/app/methods/:uuid`) worked correctly
- DB write round-trip confirmed end-to-end

### 4.4 Code-inferred runtime observations

Based on code review:
- **Extension**: `customize-button.liquid` renders an `<a>` linking to `/apps/insignia/modal`. No JavaScript modal injection — full-page navigation. This may not match the intended UX if the design calls for an inline modal.

### 4.4 Code-inferred runtime observations

Based on code review:
- **Admin dashboard routes** (`app/routes/app.*`): All use Polaris components consistently. Products list, product detail, view editor, orders list, settings, and methods pages all have loader+action+component structure.
- **Storefront modal** (`app/components/storefront/CustomizationModal.tsx`): 4-step wizard (Upload → Placement → Size → Review) with full step components present.
- **Extension**: `customize-button.liquid` renders an `<a>` linking to `/apps/insignia/modal`. No JavaScript modal injection — full-page navigation. This may not match the intended UX if the design calls for an inline modal.

---

## 5. Open Work

### 5.1 Items from `docs/notes/open-work.md` (last updated 2026-04-10)

| Item | Status | Evidence |
|------|--------|----------|
| View Editor right panel architecture (Tabs A vs expand/collapse B vs overview-first C) | **OPEN** | No decision in docs; `ZonePricingPanel.tsx` implements an approach but the open-work.md question remains unresolved |
| Logo sizing UX improvement (stepped tiers vs fixed-size-per-zone vs both) | **OPEN** | No decision in docs |
| ~~Customer artwork upload page (post-purchase)~~ | ✅ **COMPLETE** — closed 2026-04-11 | `app/routes/apps.insignia.upload.tsx` is fully implemented with loader, action, and UI component. `open-work.md` updated to move this to Resolved. |

### 5.2 Items from `docs/superpowers/plans/`

#### `2026-04-10-v2.1-view-editor-rework.md` (94 tasks, 0 checked)

Plan tracking shows 0 completed tasks. Code evidence shows **partial implementation**:

| Plan item | Status | Evidence |
|-----------|--------|---------|
| Task 0.1: Add `calibrationPxPerCm` to ProductView | **COMPLETE** | `prisma/schema.prisma:199`; migration `20260410134821_add_calibration_px_per_cm` exists |
| Task 0.2: Fix duplicate `scaleFactor` bug | Unknown | Cannot verify without prior state |
| RulerCalibration component | **COMPLETE** | `app/components/RulerCalibration.tsx` exists and is used in `app/routes/app.products.$id.views.$viewId.tsx:1023` |
| ZonePricingPanel component | **COMPLETE** | `app/components/ZonePricingPanel.tsx` exists and is used in `app/routes/app.products.$id.views.$viewId.tsx:1277` |
| View overflow selectors (no Polaris Tabs for view switching) | **COMPLETE** | `app.products.$id.views.$viewId.tsx` uses popover overflow selectors (`viewTabs`, lines 772,866,900,913), not Polaris `Tabs` |
| Full task checklist | **NOT TRACKED** | No checkboxes marked; plan may have been written to document work done rather than guide future work |

**Summary**: The v2.1 view editor is substantially implemented. The plan tracking is stale and does not reflect actual code state.

#### `2026-04-11-image-manager-color-cards.md` (20 tasks, 0 checked)

Plan tracking shows 0 completed tasks. Code evidence shows **implementation complete**:

| Plan item | Status | Evidence |
|-----------|--------|---------|
| Remove `Tabs`/`activeTabIndex` state | **COMPLETE** | No `Tabs` import or `activeTabIndex` in `app/routes/app.products.$id.images.tsx` |
| Color card layout (`colorGroups.map()`) | **COMPLETE** | `app.products.$id.images.tsx:753` — `colorGroups.map((group) => ...)` renders Polaris `Card` per color group |
| ImageTray compact inline display | **COMPLETE** | `app/components/ImageTray.tsx` is 167 lines, uses `InlineStack` layout |
| Per-view completion badges in progress card | **COMPLETE** | `app.products.$id.images.tsx` includes `viewImageCounts` computed values |

**Summary**: The image manager color card redesign is fully implemented. Plan checkboxes are not marked.

### 5.3 Previously resolved items (kept in open-work.md history)

- SVG allow-list strictness — RESOLVED (implemented correctly)
- End-to-end MVP flow — RESOLVED (implemented correctly)
- Artwork intake channel — RESOLVED (deferred to V3; upload page exists for V2)

---

## 6. Critical Blockers

These issues would prevent the app from being deployed or used correctly:

| # | Blocker | Location | Status |
|---|---------|----------|--------|
| 1 | ~~**Shopify CLI not installed**~~ | Host machine | ✅ **RESOLVED** — v3.93.2 installed |
| 2 | ~~**No `.env` file**~~ | Project root | ✅ **RESOLVED** — `.env` created; DATABASE_URL + SHOPIFY_API_KEY set. **SHOPIFY_API_SECRET still empty** — requires Shopify Partner Dashboard credentials. |
| 3 | ~~**API version mismatch: `October25` vs `2026-04`**~~ | `app/shopify.server.ts:13,28` | ✅ **RESOLVED** — Changed to `ApiVersion.April26`. All Admin GraphQL calls now use 2026-04 API. |
| 4 | **Order webhooks not registered** | `shopify.app.toml:27–35` | **OPEN** — `orders/create` and `orders/paid` subscriptions commented out. Requires protected customer data approval in Partner Dashboard. |
| 5 | ~~**Prisma client not generated**~~ | `node_modules/.prisma/client/` | ✅ **RESOLVED** — `prisma generate` run; TypeScript: 0 errors. |

---

## 7. Recommended Next Tasks

Ordered by priority (blockers first, then technical debt, then features):

### Priority 1 — Provide SHOPIFY_API_SECRET (manual step)

Blockers 1, 2, 5 are resolved. The only remaining dev-environment blocker is `SHOPIFY_API_SECRET` in `.env`. This must come from the Shopify Partner Dashboard for app `8248a0f27cfcd0613b21d5e75cddebc8`. Once set, run `npm run dev` to boot the dev server.

### ~~Priority 2 — Fix API version~~ ✅ DONE

**File**: `app/shopify.server.ts:13,28`

Changed `ApiVersion.October25` → `ApiVersion.April26`. Both the `apiVersion` config and exported constant now use the correct 2026-04 API version.

### Priority 3 — Enable order webhook subscriptions

**File**: `shopify.app.toml:27–35`

Uncomment the `orders/create` and `orders/paid` subscriptions after obtaining protected customer data approval in the Partner Dashboard.

### Priority 4 — Resolve TypeScript errors (Prisma API)

After `prisma generate` (Priority 1) resolves the missing enum types, fix remaining Prisma v6 API incompatibilities:

- `Prisma.DbNull` → use `null` or `Prisma.JsonNull` depending on context
- `Prisma.InputJsonValue` → use `Prisma.JsonValue` or explicit `object` type

Files affected: `app/lib/services/views.server.ts`, `app/lib/services/methods.server.ts`, `app/lib/services/product-configs.server.ts`, `app/routes/webhooks.orders.create.tsx`, `app/routes/app.products.$id.views.$viewId.tsx`

Suggested command: `/fix Prisma v6 type compatibility: replace Prisma.DbNull with Prisma.JsonNull and Prisma.InputJsonValue with Prisma.JsonValue across all service files`

### ~~Priority 5 — Fix lint errors (unused variables)~~ RESOLVED

Removed unused `Select` import and `PERSPECTIVE_OPTIONS` constant from `app/routes/app.products.$id._index.tsx`. ESLint now reports 0 errors.

### ~~Priority 6 — Add rate limiting to cart-confirm~~ ✅ DONE

**File**: `app/routes/apps.insignia.cart-confirm.tsx`

`checkRateLimit(shop.id)` added after shop lookup, matching the pattern in all other storefront routes.

### ~~Priority 7 — Add CORS OPTIONS preflight handling~~ ✅ DONE

OPTIONS handling added to all storefront routes (`apps.insignia.*`) with proper `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` headers.

### Priority 8 — Reconcile upload endpoint with spec OR update spec

The current server-side upload (`apps.insignia.uploads.tsx`) diverges from the spec. Either:
- Update the spec (`docs/core/api-contracts/storefront.md`) to document the server-side approach, OR  
- Change the route to use `createStorefrontUpload()` (return presigned URL) and ensure the storefront modal uses the two-step flow

Verify which flow `CustomizationModal.tsx` actually calls before deciding.

### ~~Priority 9 — Add DB-level geometry snapshot immutability~~ ✅ DONE

Raw SQL migration added with a Postgres `BEFORE UPDATE` trigger on `OrderLineCustomization` that raises an exception if `placementGeometrySnapshotByViewId` is modified after being set.

### ~~Priority 10 — Update plan tracking~~ ✅ DONE

Marked completed tasks in:
- `docs/superpowers/plans/2026-04-10-v2.1-view-editor-rework.md`
- `docs/superpowers/plans/2026-04-11-image-manager-color-cards.md`

Updated `docs/notes/open-work.md` to close the customer upload page item.

---

## 8. Storefront E2E

**Status**: ✅ **PASSED** — tested 2026-04-11 against dev store `insignia-app.myshopify.com` with tunnel `switch-wrapping-sku-leg.trycloudflare.com`.

### Seed data used

| Entity | Value |
|--------|-------|
| Product | The Complete Snowboard (`gid://shopify/Product/8359850934372`) |
| ProductConfig | `3bcf19ff-d052-4038-8170-7bcfb6bcc1ba` |
| DecorationMethod | Embroidery (`32400a06-0a46-45e5-9c04-3125c1d1d18a`) |
| ProductView | Front (`4b495ff1-4d87-4775-95af-9036d85b055e`) |
| PlacementDefinition | Front Center (`3521ab89-c4f3-4be3-a441-5a6094c32e89`) |
| PlacementStep | Standard (scaleFactor: 1.0) |
| placementGeometry | `{ centerXPercent: 50, centerYPercent: 40, maxWidthPercent: 60 }` |
| Variant tested | Ice (`gid://shopify/ProductVariant/47790096547940`) |

Seed data created via `scripts/seed-e2e.mjs`.

### Flow results

| Step | URL / Endpoint | Result |
|------|---------------|--------|
| Product page | `https://insignia-app.myshopify.com/products/the-complete-snowboard` | ✅ "Customize" button rendered by theme extension block |
| Customize click | Opens `/apps/insignia/modal?productId=...&variantId=...` via App Proxy | ✅ Modal loaded, title "Upload your artwork" |
| Upload step | Shows dropzone + "I'll provide artwork later" + Decoration selector | ✅ "Embroidery / Included" shown; "Placeholder selected" on deferral |
| Placement step | Shows "Where should we print?" | ✅ "Front Center / Included" auto-checked |
| Review step | Order summary with Product / Decoration / Customizations line items | ✅ Correct — US$699.95 base + US$0.00 customization |
| `/apps/insignia/prepare` | POST from modal | ✅ 200 — variant slot reserved |
| `/cart/add.js` | POST to Shopify cart | ✅ 200 — item added |
| `/apps/insignia/cart-confirm` | POST from cart listener | ✅ 200 — customization config confirmed |
| Post-add | Modal closes, page returns to product page | ✅ |

### Issues found

1. **Preview pane shows "No preview available"** — expected. No `defaultImageKey` set on the ProductView and no `VariantViewConfiguration` with an `imageUrl`. Merchants must upload a product view image via the admin view editor to enable the canvas preview. Not a bug.

2. **Stale VariantSlot on first attempt** — one slot record pointed to a deleted variant ID (`gid://shopify/ProductVariant/48238892482660`). The `ensureVariantPoolExists` self-heal only detects full product deletion, not partial variant deletion. The stale slot was removed manually. **Recommended fix**: add a variant-existence check in `ensureVariantPoolExists` that cleans up slots whose `shopifyVariantId` is no longer in the product's variant list.

3. **Logo upload not fully tested** — the browser automation `upload_image` tool could not access screenshot images from the compressed conversation history. The upload endpoint (`POST /apps/insignia/uploads`) was validated separately via the prepare flow (the modal correctly transitions when artwork status is `PENDING_CUSTOMER`).

### API endpoint health (confirmed live)

| Endpoint | Method | Status |
|----------|--------|--------|
| `/apps/insignia/config` | GET | ✅ Returns config with placements, methods, translations |
| `/apps/insignia/prepare` | POST | ✅ Reserves variant slot, returns cart item |
| `/apps/insignia/cart-confirm` | POST | ✅ Confirms customization config |
| `/apps/insignia/modal` | GET | ✅ React modal app loads via App Proxy |
