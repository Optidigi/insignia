# Insignia Backend — Frontend Integration Reference

**Audience:** Frontend developers building or extending the admin UI and storefront modal.
**Scope:** Every endpoint the app exposes, every data shape it produces, everything Shopify gives us, and everything planned for v3 that isn't wired yet.
**Last audit:** 2026-04-22 (against commit `5ea206f` + migration state as of that date).
**Stack:** React 18 + React Router 7 (Remix flat-routes) · Prisma + PostgreSQL · Shopify Admin GraphQL `2026-04` · AWS S3 / Cloudflare R2 · Polaris v13.9.5 (admin) · custom CSS (storefront modal).

---

## What Insignia is and how orders are composed

### The product in one paragraph

Insignia is a Shopify app that lets merchants sell **customizable apparel** — T-shirts, polos, hoodies, caps — where the customer uploads their own logo and places it on specific zones of the garment before checkout. The merchant configures what's possible (which products, which zones, which decoration methods, what pricing); the customer sees a modal storefront wizard that walks them through placement choices and shows a live preview; the resulting order arrives with enough data for a decoration shop to produce it. This doc is about the backend surface behind that.

### The three surfaces the backend serves

| Surface | Who sees it | Tech | What it does |
|---|---|---|---|
| **Admin UI** (`/app/*`) | Merchant | React Router + Polaris | Create/edit product configs, views, zones, methods, pricing; manage orders; configure settings. |
| **Storefront modal** (`/apps/insignia/*`) | Customer shopping | Custom React + CSS, loaded via Shopify App Proxy | The customization wizard. Runs on the merchant's theme. |
| **Admin Block extension** (`extensions/insignia-order-block/`) | Merchant inside Shopify's native Order detail page | Shopify UI Extensions (web components) | Shows customization details inline on the Shopify order page. Out of scope for the React admin UI but shares the same backend data. |

### The merchant's model: ProductConfig → Views → Placements → Steps

The merchant builds a configuration tree for each kind of garment they sell:

```
Shop
└── DecorationMethod (N)           e.g., "Embroidery" · "Screen Print" · "DTG"
│                                  Each method has pricing + artwork constraints (file types, DPI, colors)
│
└── ProductConfig (N)              e.g., "Polo shirts" (links to N Shopify products via GID)
    │                              Configured once, applies to every linked product + variant
    │
    ├── DecorationMethod M:M       Which methods are allowed for this config
    │
    ├── ProductView (N)            e.g., Front · Back · Left Sleeve · Right Sleeve
    │   │                          Each view has a product image (per variant possible)
    │   │
    │   ├── PlacementDefinition (N)  e.g., "Left Chest" · "Center Back" · "Sleeve Stripe"
    │   │   │                        Each zone has a position + max size on the garment
    │   │   │                        Priced independently (base fee per zone)
    │   │   │
    │   │   └── PlacementStep (N)    e.g., "Small (~3 cm)" · "Standard (~5 cm)" · "Large (~7 cm)"
    │   │                            Each step has a scaleFactor + price delta
    │   │
    │   └── VariantViewConfiguration (per variant)
    │       ├── imageUrl                Per-variant product image (e.g., "polo navy front")
    │       └── placementGeometry Json  Per-variant zone overrides (if zones shift per color)
    │
    └── linkedProductIds: String[]  Shopify product GIDs this config applies to
```

**N, in practice:**

| Level | Typical | Max seen |
|---|---|---|
| DecorationMethods per shop | 1–3 (one per technique) | 5–6 |
| ProductConfigs per shop | 3–15 (one per garment type) | 50+ for agencies |
| Views per ProductConfig | 2–4 (front/back, or front/back/left/right) | 6 |
| Placements per View | 1–3 (most zones are on front/back) | 5 |
| Steps per Placement | 1–4 (size tiers) | 5 |
| Variants per linked product | 5–30 (sizes × colors) | 100+ |

### Per-variant geometry and images

Not all variants of a product look identical. A navy polo might have a different zone position than a white polo, and the product image certainly differs per color. Insignia handles this with **per-variant overrides** layered on top of view-level defaults:

- `ProductView.defaultImageKey` → fallback image for the view.
- `ProductView.placementGeometry` → view-level default geometry for each placement.
- `VariantViewConfiguration.imageUrl` → per-variant product image (overrides default).
- `VariantViewConfiguration.placementGeometry` → per-variant geometry overrides per placement.

When the storefront resolves a view for a specific variant, it merges: variant geometry → view geometry. Where the variant entry is `null`, the view default applies.

### What "geometry" means

Each placement renders a zone rectangle on the product image. The geometry is **percentage-based** (so it scales with any image size):

```ts
{
  centerXPercent: 50,   // horizontal center, 0–100
  centerYPercent: 30,   // vertical center, 0–100
  maxWidthPercent: 20,  // zone width as % of image width
  maxHeightPercent: 15, // optional; aspect ratio inferred from logo if omitted
}
```

A placement step's `scaleFactor` multiplies this to get the actual logo size for that tier (e.g., Small = 0.75 × maxWidthPercent).

**Physical dimensions** are not stored — each `ProductView` has an optional `calibrationPxPerCm` (set via the v3 ruler tool, [§9.3](#93-v3-features-that-require-schema--endpoint-changes)) that converts percentages into real centimeters. When calibration is missing, the UI displays "Small / Medium / Large" labels instead of "~3 cm / ~5 cm / ~7 cm".

### The customer journey (what produces an order)

1. **Merchant installs theme block** on their storefront. Every product page with a linked `ProductConfig` shows a "Customize" button.
2. **Customer clicks** → Shopify loads the Insignia modal via App Proxy. Modal fetches `GET /apps/insignia/config?productId=...&variantId=...` — gets the full config tree (views, placements, methods, variants, prices, translations).
3. **Customer picks** in the wizard:
   - A decoration method (if >1 allowed) → affects pricing and constraints.
   - Which views to customize (most pick 1–2).
   - Which placement on each view (e.g., Left Chest on the Front view).
   - Which step/size per placement.
   - An artwork file — uploaded now (via 3-step R2 upload flow) or deferred ("upload later" → triggers reminder flow).
4. **Draft persisted.** `POST /apps/insignia/customizations` creates a `CustomizationDraft` row capturing every selection. Each draft has a `configHash` — identical selections collapse to the same config.
5. **Price locked.** `POST /apps/insignia/price` computes the authoritative unit price for the review step:
   ```
   unitPriceCents = baseProductPriceCents
                  + effectiveMethodPrice  // = ProductConfigMethod.basePriceCentsOverride ?? DecorationMethod.basePriceCents
                  + sum over placements of:
                      placement.basePriceAdjustmentCents
                    + step.priceAdjustmentCents
   ```
6. **Slot reserved.** `POST /apps/insignia/prepare` picks a `VariantSlot` from the pool (a pre-provisioned fee-product variant), sets its price to `unitPriceCents` via Shopify `productVariantsBulkUpdate`, and returns `slotVariantId`.
7. **Customer adds to cart.** Theme JavaScript calls Shopify's `/cart/add.js` with **two line items**: the actual product variant they want + the fee slot variant. Shopify charges the combined total.
8. **Order placed.** Shopify sends `orders/create` webhook. Insignia creates one `OrderLineCustomization` per customized line item, snapshotting every selection + every piece of geometry (so later merchant edits don't retroactively change old orders).
9. **Payment captured.** Shopify sends `orders/paid`. Insignia releases the variant slot back to `FREE` (reset price to $0), promotes `CustomizationConfig` to `PURCHASED`.
10. **Merchant fulfills.** In the Insignia admin, the merchant sees the order with every zone, size, and artwork file. They mark it through production states (`ARTWORK_PENDING` → `ARTWORK_PROVIDED` → `IN_PRODUCTION` → optional `QUALITY_CHECK` → `SHIPPED`, displayed as "Complete").

### Why the "variant pool" exists

Shopify only lets non-Plus merchants create a variant dynamically at checkout via Plus-only draft order flows. For custom pricing per order, Insignia instead **pre-provisions a pool of fee-product variants** per decoration method, all priced at $0, with `inventoryPolicy: CONTINUE` (never out of stock). At checkout:

- A slot is reserved from the pool for ~10 minutes (`RESERVED`).
- Its price is set to the exact unit price for this customization (`productVariantsBulkUpdate`).
- The customer adds this slot's variant GID to their cart.
- On `orders/paid`, the slot's price is reset to $0 and the slot returns to the `FREE` pool.

Two practical consequences for the frontend:

- The **fee products are `UNLISTED`** — they never appear in collections or search — but they must be published to the Online Store publication for `/cart/add.js` to accept them.
- If a merchant accidentally deletes a fee product, `ensureVariantPoolExists` self-heals by re-provisioning on the next storefront config fetch.

### What an order actually looks like

The Insignia-side order record is a set of `OrderLineCustomization` rows, one per customized line item in the Shopify order. A Shopify order can contain a mix of customized and non-customized lines; only the customized ones have an OLC row. Concrete shapes:

**Example 1 — single polo, single placement**

> Shopify order `#1042`: 1× "Polo Navy Size M" + 1× fee slot variant (both line items combined as one customized line).

```
OrderLineCustomization × 1
├── productConfigId        = "cfg-polo-basic"
├── variantId              = "gid://.../ProductVariant/9999" (the Navy-M polo)
├── artworkStatus          = PROVIDED
├── productionStatus       = ARTWORK_PROVIDED
├── logoAssetIdsByPlacementId = {
│     "plc-leftChest": "asset-12345"
│   }
└── placementGeometrySnapshotByViewId = {
      "view-front": { "plc-leftChest": { centerX: 25, centerY: 30, maxWidth: 14 } }
    }
```

**Example 2 — 3 polos, mixed sizes, 2 placements per line, shared artwork**

> Shopify order `#1039`: 3× polo line items (S/M/L) + 3× fee slot variants.

```
OrderLineCustomization × 3
(one per polo line item; all three share:)
├── productConfigId           = "cfg-polo-basic"
├── artworkStatus             = PROVIDED
├── productionStatus          = ARTWORK_PROVIDED
├── logoAssetIdsByPlacementId = {
│     "plc-leftChest": "asset-12345",
│     "plc-centerBack": "asset-67890"
│   }
└── placementGeometrySnapshotByViewId = { "view-front": {...}, "view-back": {...} }
```

**Example 3 — bulk homogeneous (triggers compact-homogeneous render mode in admin)**

> Shopify order `#1028`: 10× polos, all same product, same placements, same artwork.

```
OrderLineCustomization × 10
(all share productConfigId, placements, logo assets; differ only in variantId for sizes/colors)
```

This pattern triggers the admin's compact-table layout — rendering 10 separate cards would be noisy, so a single-card IndexTable-style grid is used instead (v3 design decision).

**Example 4 — "upload later" flow**

> Customer picks "I'll upload my logo later" in the wizard. Order is placed, but no artwork yet.

```
OrderLineCustomization × 1
├── artworkStatus    = PENDING_CUSTOMER
├── productionStatus = ARTWORK_PENDING
├── logoAssetIdsByPlacementId = { "plc-leftChest": null }
├── orderStatusUrl   = "https://store.../orders/.../status"  (customer-facing status page)
└── (merchant_placeholder may fill the zone until the customer uploads)
```

The merchant sees "Awaiting artwork" in the Orders list with an aging indicator (turns amber >3 days, red >7 days). An artwork reminder email is a v3 placeholder feature ([§9.1](#91-admin-ui-placeholders--whats-disabled-today-and-what-endpointmodel-it-needs) feature #13).

**Example 5 — mixed customized + non-customized cart**

> Shopify order `#1033`: 1× polo with customization + 2× plain T-shirts (no customization).

```
OrderLineCustomization × 1   (only the customized line)
```

The two plain T-shirts appear in Shopify's order data but have no OLC row. Non-customized line items are invisible to Insignia.

### Snapshot discipline — why orders don't break when merchants edit configs

Every `OrderLineCustomization` row carries **frozen copies** of the data it depends on:

- `logoAssetIdsByPlacementId` — which logo file was on which placement at order time.
- `placementGeometrySnapshotByViewId` — the exact zone geometry at order time.
- `feeShopifyVariantId` / `feeShopifyProductId` — which slot variant handled the fee.

If a merchant later deletes a placement, renames a view, or moves a zone, past orders still render correctly because they use their snapshots. The `useLiveConfigFallback` flag on OLC is a legacy compatibility shim for orders made before snapshots were captured — when true, the UI falls through to the live config.

### Order statuses — what the merchant can do

Two independent axes:

- **Artwork status** (binary): `PROVIDED` vs `PENDING_CUSTOMER`. Set at order creation; changed only if artwork is later uploaded.
- **Production status** (5-step workflow): `ARTWORK_PENDING` → `ARTWORK_PROVIDED` → `IN_PRODUCTION` → `QUALITY_CHECK` → `SHIPPED`. Merchant advances via the Order Detail page or bulk action.

User-facing labels (per the terminology lock, [§2.4](#24-terminology-lock)):
- `ARTWORK_PENDING` → "Artwork pending"
- `ARTWORK_PROVIDED` → "Ready to produce"
- `IN_PRODUCTION` → "In production"
- `QUALITY_CHECK` → "In production" (rolled up; QC is an internal state)
- `SHIPPED` → "Complete"

The Orders table shows **worst-case rollup** across all lines in the order (e.g., if any line is pending, the whole order badges as "Artwork pending").

---

## How to use this doc

Open it to a section and skim. Every endpoint answers four questions:

1. **Where does it live?** (file path + line number)
2. **How do I authenticate?** (admin session / app proxy signature / webhook HMAC)
3. **What does it accept?** (input shape)
4. **What does it return?** (output shape and success/error codes)

Data shapes in [Section 7](#7-data-shapes) are authoritative — every endpoint response composes from those types.

[Section 9](#9-placeholder-and-v3-features) tracks what's designed but **not yet wired** (features that show as disabled in the UI today with "Coming soon" helpText).

---

## Table of contents

1. [TL;DR — 30-second orientation](#1-tldr--30-second-orientation)
2. [Conventions](#2-conventions)
3. [Admin page routes (`app.*`)](#3-admin-page-routes)
4. [Admin API routes (`api.admin.*`)](#4-admin-api-routes)
5. [Storefront routes via App Proxy (`apps.insignia.*`)](#5-storefront-routes-via-app-proxy)
6. [Webhooks (`webhooks.*`)](#6-webhooks)
7. [Data shapes](#7-data-shapes)
8. [Shopify integration surface](#8-shopify-integration-surface)
9. [Placeholder and v3 features](#9-placeholder-and-v3-features)
10. [Known integration gaps per UI feature](#10-known-integration-gaps-per-ui-feature)
11. [Appendix: file paths at a glance](#11-appendix)

---

## 1. TL;DR — 30-second orientation

| Surface | Path prefix | Authentication | Response shape |
|---|---|---|---|
| Admin pages | `/app/*` | `authenticate.admin` (Shopify session) | Remix loader returns plain object; action returns JSON + redirect |
| Admin API | `/api/admin/*` | `authenticate.admin` | JSON `{ ... }` on success, JSON `{ error: { code, message } }` on failure |
| Storefront (via App Proxy) | `/apps/insignia/*` | `authenticate.public.appProxy` (HMAC) + per-shop rate limit | JSON `{ ...}` on success, `{ error: { code, message } }` on failure |
| Webhooks inbound | `/webhooks/*` | `authenticate.webhook` (HMAC) + `X-Shopify-Event-Id` idempotency | `200` ack |
| Health | `/api/health` | none (public) | `{ status, db, timestamp }` + 200/503 |

**The five things to remember when wiring UI:**

1. **Actions on admin pages are `intent`-routed.** Form POSTs include a hidden `intent` field that selects which handler to run. Contract is "form-post, Remix style". See [Section 2.3](#23-intent-based-action-routing).
2. **Storefront endpoints return `{ error: { code, message } }` on any failure** with HTTP `4xx`/`5xx`. Client code must check `error` key before treating response as success.
3. **R2 object keys are server-only.** Frontend receives presigned URLs (typically 600–3600 s expiry). Never persist an R2 key client-side.
4. **Terminology lock.** UI displays `Artwork` (not "Logo"), `Complete` (not "Shipped" — the Prisma enum is `SHIPPED` but users see "Complete"), `Awaiting artwork` (not "Pending"), `Artwork provided`. See [Section 2.4](#24-terminology-lock).
5. **Some features are "Coming soon" placeholders.** The UI renders disabled controls; no backend wiring yet. See [Section 9](#9-placeholder-and-v3-features) before building against any feature marked there.

---

## 2. Conventions

### 2.1 Authentication patterns

Three distinct patterns; they do NOT compose.

| Helper | File | Use when |
|---|---|---|
| `authenticate.admin(request)` | `app/shopify.server.ts` | Route serves a merchant in the Shopify admin iframe. Returns `{ session, admin, cors }`. `session.shop` is the shop domain (`store.myshopify.com`). `session.accessToken` is the offline token. `admin.graphql(...)` is the Shopify Admin GraphQL client. |
| `authenticate.public.appProxy(request)` | same | Storefront customers reach the server via Shopify's App Proxy. Returns `{ session }` where `session.shop` is derived from the HMAC signature. Throws `400` if the signature is invalid. |
| `authenticate.webhook(request)` | same | Inbound webhook from Shopify. Returns `{ shop, topic, payload, webhookId, apiVersion }`. Throws `401` if HMAC fails. |
| `unauthenticated.admin(shop)` | same | Server-initiated GraphQL (e.g. scheduled job, webhook follow-up) using a stored offline access token. Use sparingly and only inside `*.server.ts`. |

### 2.2 Response shape conventions

**Admin API routes** (`api.admin.*`):
- Success: `{ ...payload }` with HTTP 2xx.
- Failure: `{ error: { code: string, message: string, fieldErrors?: Record<string, string> } }` with HTTP 4xx/5xx. Helper: `handleError(e)` in `app/lib/errors.server.ts` → wraps `Errors.notFound`, `Errors.validation`, `Errors.unauthorized`, `Errors.forbidden`, `Errors.conflict`, `Errors.internal`.

**Storefront endpoints** (`apps.insignia.*`):
- Identical success/error shapes as admin API.
- Additional `429 Too Many Requests` returned by `checkRateLimit(shopId)` with `Retry-After` header (seconds).
- CORS: response carries `Access-Control-Allow-Origin: https://<shop-domain>` (never `*`).

**Admin page routes** (`app.*`):
- Loader returns a plain object consumed by `useLoaderData()`.
- Action returns either JSON `{ ok: true, ... }` or a `redirect(...)` Response. On validation failure, returns JSON with HTTP 400 + `{ error: ... }`.

**Webhook routes** (`webhooks.*`):
- Handler returns bare `200` on success. Returns `500` to trigger Shopify retry. Idempotency prevents duplicate processing of the same `X-Shopify-Event-Id`.

### 2.3 Intent-based action routing

Admin page routes often have a single `action` export that handles many distinct operations. The convention:

```tsx
// Form POST:
<Form method="post">
  <input type="hidden" name="intent" value="advance-status" />
  <input type="hidden" name="lineId" value="..." />
  <input type="hidden" name="newStatus" value="IN_PRODUCTION" />
  <button type="submit">Advance</button>
</Form>
```

```tsx
// Server action:
const intent = formData.get("intent");
switch (intent) {
  case "advance-status": /* ... */ break;
  case "bulk-advance-status": /* ... */ break;
  case "save-template": /* ... */ break;
}
```

When you're listing a route's contract in this doc, every `intent` value is an independent mini-endpoint with its own input + output.

**From the UI side**, use `useSubmit()`, `useFetcher()`, or `<Form>`. `useFetcher()` is preferred when you want to post without navigating (e.g. adding a note, advancing a line item without page reload).

### 2.4 Terminology lock

User-facing copy vs. backend values — the UI must translate these. Fails a design review if violated.

| User-facing string | Backend value | Where mapping lives |
|---|---|---|
| Artwork | (never "Logo" in UI) | Throughout |
| Complete | Prisma `ProductionStatus.SHIPPED` | `PRODUCTION_STATUS_OPTIONS` in orders loader |
| Awaiting artwork | Prisma `ArtworkStatus.PENDING_CUSTOMER` | Badge render logic |
| Artwork provided | Prisma `ArtworkStatus.PROVIDED` | Badge render logic |
| Ready to produce | Computed: all lines `ARTWORK_PROVIDED` and none IN_PRODUCTION | Derived in loader |
| In production | Prisma `ProductionStatus.IN_PRODUCTION` (or `QUALITY_CHECK`) | Badge render logic |
| Artwork pending | Prisma `ProductionStatus.ARTWORK_PENDING` | Badge render logic |
| Mark as In Production | Bulk action label | Orders index bulk action |
| Mark in production | Per-line CTA label | Order detail card footer |
| Mark all as In Production | Page primary action | Order detail header |
| Customer upload | `LogoAsset.kind === "buyer_upload"` | Placement row badge |
| Merchant placeholder | `LogoAsset.kind === "merchant_placeholder"` | Placement row badge |

### 2.5 Sensitive fields — never expose to frontend

| Field | Model | Why sensitive |
|---|---|---|
| `accessToken` | `Shop` | Shopify API token; server-only. |
| `WebhookEvent.*` | `WebhookEvent` | Replay-attack surface. |
| R2 object keys (`defaultImageKey`, `sanitizedSvgUrl`, `previewPngUrl`, `placeholderLogoImageUrl`, `storageKey` on `StorefrontUploadSession`) | various | Must be converted to presigned URL before response. Any field ending in `Key` or `storageKey` is not safe to serialize raw. |
| `Session.*` | `Session` | Internal Remix session store. |
| Environment variables (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `DATABASE_URL`, R2 credentials) | `.env` | Server-only. |

### 2.6 Color and Polaris discipline (admin only)

- **No hardcoded Shopify blue (`#005BD3`) on `variant="primary"` Button.** Blue is valid only on `Button variant="plain"` text links (Polaris paints it automatically).
- **Green success CTA = `<Button variant="primary" tone="success">`**, NOT `variant="success"`.
- **Dark primary** = `variant="primary"` (defaults to dark `#303030`).
- **Row/Badge/Text tones diverge** — the same color word maps to different Polaris tones per component:
  - `Badge` amber = `tone="attention"`
  - `IndexTable.Row` amber = `tone="warning"`
  - `Text` amber = `tone="caution"`

### 2.7 Storefront error codes

Storefront endpoints return structured error codes a frontend can branch on. Canonical list:

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | App proxy HMAC invalid/missing. |
| `RATE_LIMITED` | 429 | Per-shop rate limit exceeded. `Retry-After` header present. |
| `VALIDATION_ERROR` | 400 | Body malformed or field invalid. `fieldErrors` may be present. |
| `NOT_FOUND` | 404 | Draft / config / asset missing. |
| `CONFLICT` | 409 | Duplicate draft or slot already reserved. |
| `INTERNAL_ERROR` | 500 | Unhandled server exception. |

See `app/lib/errors.server.ts` and `app/lib/storefront/error-codes.ts` (if present) for the authoritative list in code.

---

## 3. Admin page routes

Routes served to the merchant inside the Shopify admin iframe. Always use Polaris exclusively.

### 3.1 Root layout — `/app` — [`app/routes/app.tsx`](../../app/routes/app.tsx)

- **Auth:** `authenticate.admin`.
- **Loader → :** `{ apiKey: string, sessionTokenForApi: string }` (for internal API fetches that include the admin session token).
- **Action:** none.
- **Renders:** Polaris `AppProvider`, `NavMenu`, `<Outlet />`.

### 3.2 Dashboard — `/app` (index) — [`app/routes/app._index.tsx`](../../app/routes/app._index.tsx)

- **Auth:** `authenticate.admin`.
- **Loader →**
  ```ts
  {
    configsCount: number;
    methodsCount: number;
    ordersCount: number;
    pendingArtworkCount: number;
    hasViews: boolean; hasImages: boolean; hasPlacements: boolean;
    recentConfigs: Array<{ id, name, viewCount, placementCount, methodCount, productCount }>;
    needsAttention: Array<{ id, shopifyOrderId, createdAt, productConfig: { name }, waitingDays }>;
    themeEditorUrl: string | null;
    themeBlockDeepLinkUrl: string | null;
    setupSteps: { methodCreated, productCreated, imagesUploaded, themeBlockAdded };
    completedCount: number;
    isFirstTime: boolean;
    setupGuideDismissed: boolean;
    activityEvents: Array<{ id, type: "order"|"artwork"|"method"|"setup", description, timestamp }>;
    analytics: {
      totalOrders: number;
      pendingArtwork: number;
      activeConfigs: number;
      methodBreakdown: Array<{ name, orderCount }>;
    };
  }
  ```
- **Action intents:**
  - `install-theme-block` → `{ themeBlockInstall: { status, themeId?, message?, debug? } }`.
  - `dismiss-setup-guide` → `{ success: true }`.

### 3.3 Decoration methods list — `/app/methods` — [`app/routes/app.methods._index.tsx`](../../app/routes/app.methods._index.tsx)

- **Loader →** `{ methods: DecorationMethod[], shopId: string }` where each method includes `_count.productConfigs`.
- **Action:** POST `{ name: string }` → creates method + auto-provisions variant pool → `{ method, success: true }`.

### 3.4 Method detail — `/app/methods/:id` — [`app/routes/app.methods.$id.tsx`](../../app/routes/app.methods.$id.tsx)

- **Loader →** `{ method: { id, name, basePriceCents, artworkConstraints, productConfigs[] }, shopId, currency }`. `basePriceCents` is the method-level default; per-product-config overrides live on `ProductConfigMethod.basePriceCentsOverride`.
- **Action intents:**
  - `update` (JSON body): `{ name?, basePriceCents?, artworkConstraints? }` → `{ method }`.
  - `delete`: `{ success: true }`.

### 3.5 Product configs list — `/app/products` — [`app/routes/app.products._index.tsx`](../../app/routes/app.products._index.tsx)

- **Loader →** `{ configs: ProductConfig[], methods: DecorationMethod[], shopId: string }`.
- **Action:** POST `{ name, productIds[], methodIds[], duplicateFromId? }` → redirect 303 to `/app/products/:id`.

### 3.6 Product config detail — `/app/products/:id` — [`app/routes/app.products.$id._index.tsx`](../../app/routes/app.products.$id._index.tsx)

The workhorse of the admin. All config editing goes through this route.

- **Loader →**
  ```ts
  {
    config: {
      id, name, linkedProductIds: string[],
      views: Array<{
        id, name, displayOrder,
        placements: Array<{ id, name, displayOrder, steps: Array<{ id }> }>,
        variantViewConfigurations: Array<{ variantId, imageUrl: string|null, placementGeometry: object }>;
      }>;
      allowedMethods: Array<{ decorationMethodId, decorationMethod: { name } }>;
      variantViewConfigurations: Array<{ id, variantId, imageUrl, placementGeometry }>;
    };
    methods: Array<{ id, name }>;
    shopId, currency;
    productHandle: string | null;
    customizerUrl: string | null;
  }
  ```
- **Action intents:**
  - `update-name` `{ name }`
  - `update-methods` `{ methodIds: string[] }`
  - `add-product` `{ productIds: string[] }`
  - `remove-product` `{ productId }`
  - `create-view` `{ name }` (201)
  - `update-view` `{ viewId, name }`
  - `delete-view` `{ viewId }`
  - `create-placement` `{ viewId, name }` (201)
  - `delete-placement` `{ placementId }`
  - `duplicate-placement` `{ placementId, name }` (201)
  - `update-placement-geometry` `{ viewId, variantId, geometry: PlacementGeometryMap }`
  - `delete-config` — deletes whole config.
  - `duplicate` `{ name, productIds }` → redirect 303.

### 3.7 Views / images / placements (nested)

| Route | File | Purpose |
|---|---|---|
| `/app/products/:id/views` | [`app.products.$id.views.tsx`](../../app/routes/app.products.$id.views.tsx) | List + manage views |
| `/app/products/:id/views/:viewId` | [`app.products.$id.views.$viewId.tsx`](../../app/routes/app.products.$id.views.$viewId.tsx) | Single view canvas/geometry editor |
| `/app/products/:id/images` | [`app.products.$id.images.tsx`](../../app/routes/app.products.$id.images.tsx) | Batch image upload |
| `/app/products/:id/placements/:placementId` | [`app.products.$id.placements.$placementId.tsx`](../../app/routes/app.products.$id.placements.$placementId.tsx) | Placement detail (steps, pricing) |

Each exposes a loader + action; read the file for specific intents. All follow the same `intent`-routing pattern.

### 3.8 Orders index — `/app/orders` — [`app/routes/app.orders._index.tsx`](../../app/routes/app.orders._index.tsx)

- **Loader query params:** `tab` (`all` | `awaiting`), `search`, `methodId`, `dateRange` (`all`|`today`|`this-week`|`this-month`), `artworkStatus` (`PROVIDED`|`PENDING_CUSTOMER`), `page` (default 1, 25 per page).
- **Loader →**
  ```ts
  {
    orders: Array<{
      shopifyOrderId: string;   // "gid://shopify/Order/12345"
      orderName: string;         // "#1042"
      lineCount: number;
      pendingArtwork: number;    // count of line items with PENDING_CUSTOMER artwork
      latestStatus: ProductionStatus;  // worst-case across lines
      totalCents: number;
      createdAt: string;         // ISO
    }>;
    currency: string;            // "$", "€", ...
    tab: "all" | "awaiting";
    methods: Array<{ id, name }>;
    search: string;
    methodId: string;
    dateRange: string;
    artworkStatus: string;
    page: number;
    totalPages: number;
    totalCount: number;
  }
  ```
- **Action:** none. Mutations happen via POST to [`/app/orders/bulk-advance`](#310-bulk-advance---apporders-bulk-advance) or [`/app/orders/:id`](#39-order-detail---apporders-id).
- **UI gaps (backend extensions required for v3 UI — see [Section 10](#10-known-integration-gaps-per-ui-feature)):** customer name, artwork thumbnail, tab counts (3), production-status filter, method column aggregation / "Mixed", `session.shop` return for View-in-Shopify.

### 3.9 Order detail — `/app/orders/:id` — [`app/routes/app.orders.$id.tsx`](../../app/routes/app.orders.$id.tsx)

- **URL param:** `:id` is URL-encoded Shopify Order GID (e.g., `gid%3A%2F%2Fshopify%2FOrder%2F12345`).
- **Loader →**
  ```ts
  {
    orderLines: Array<OrderLineCustomization & {
      productConfig: { id, name, views: ProductView[...] };
      customizationConfig?: { id, unitPriceCents, methodId, decorationMethod: { name } };
    }>;
    logoAssetMap: Record<string, LogoAsset>;
    logoAssetDownloadUrls: Record<string, string>;   // presigned 3600s
    logoAssetPreviewUrls: Record<string, string>;    // presigned 3600s
    settings: MerchantSettings;
    customer: { name: string, email: string } | null;  // from Shopify Admin GraphQL
    order: { name: string, createdAt: string };
    shopId: string;
  }
  ```
  Note: `name` + `createdAt` come from a Shopify GraphQL `query GetOrderDetails($id)` at loader time — see [Section 8.2](#82-outbound-graphql-queries).
- **Action intents:**
  - `advance-production-status` `{ lineId, newStatus: ProductionStatus }` — single-line advance.
  - `upload-artwork` FormData `{ file, lineId }` — writes a LogoAsset + attaches to the line.
  - `set-artwork-status` `{ lineId, status: ArtworkStatus }` — manual override.
- **Side effects:** each status advance fires `syncOrderTags()` (fire-and-forget); `orders/paid` webhook reconciliation is not coupled to this route.
- **UI gaps (backend extensions required for v3 UI):** customer subtitle Page prop, worst-case `titleMetadata` Badge states, IN_PRODUCTION banner, product image URL per line, `renderMode` branching (cards/collapsible/compact-homogeneous). (OrderNote list — RESOLVED 2026-04-22.)

### 3.10 Bulk advance — `/app/orders/bulk-advance` — [`app/routes/app.orders.bulk-advance.tsx`](../../app/routes/app.orders.bulk-advance.tsx)

- **Auth:** `authenticate.admin`.
- **Method:** POST (no loader).
- **Body:** FormData with repeated `orderId[]` and single `newStatus`.
- **Response:** `{ advanced: number, skipped: number }`.
- **Transaction:** wrapped in `db.$transaction(...)` for atomicity.

### 3.11 CSV export — `/app/orders/export` — [`app/routes/app.orders.export.tsx`](../../app/routes/app.orders.export.tsx)

- **Auth:** `authenticate.admin`.
- **Method:** GET loader only.
- **Response:** `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment`.
- **Query params:** same filter set as the orders index.
- **Columns today:** order name · customer email · total · status · created (5 columns). v3 feature #14 expands this to production-ready columns — see [Section 9](#9-placeholder-and-v3-features).

### 3.12 Print production sheet — `/app/orders/:id/print` — [`app/routes/app.orders.$id.print.tsx`](../../app/routes/app.orders.$id.print.tsx)

- **Auth:** `authenticate.admin`.
- **Method:** GET only; renders an HTML page suitable for browser print dialog.
- **Loader →** merges local `OrderLineCustomization` with a Shopify GraphQL `GetPrintData` query (`name, lineItems[title, quantity, variant.title]`).
- **Usage:** Linked as a secondary action in order detail page chrome.

### 3.13 Settings — `/app/settings` — [`app/routes/app.settings.tsx`](../../app/routes/app.settings.tsx)

- **Loader →**
  ```ts
  {
    settings: MerchantSettings | null;
    apiBaseUrl: string;
    sessionTokenForApi: string;
    shopId: string;
    themeEditorUrl: string | null;
    themeBlockDeepLinkUrl: string | null;
    translationMap: Record<string, Record<string, string>>;  // locale → key → value
  }
  ```
- **Action intents:**
  - `install-theme-block` → same result shape as dashboard version.
  - `remove-placeholder` → removes placeholder logo asset.
  - `save-general-settings` `{ defaultStorefrontLocale: SupportedStorefrontLocale }`.
  - `save-placeholder` FormData with `file` → uploads new placeholder logo to R2, stores key on MerchantSettings.
  - `save-translations` `{ locale, translations: Record<string, string> }` → upserts `StorefrontTranslation` rows.

---

## 4. Admin API routes

Internal JSON endpoints called by admin page routes (typically via `useFetcher()`). All authenticate via `authenticate.admin`.

### 4.1 `POST /api/admin/upload-url` — [`api.admin.upload-url.tsx`](../../app/routes/api.admin.upload-url.tsx)

Generate presigned R2 upload URLs so the browser can PUT directly to R2 without the bytes flowing through our server.

**Action intents:**
| Intent | Body | Response |
|---|---|---|
| `get-upload-url` | `{ productConfigId, viewId, variantId, contentType, fileName }` | `{ uploadUrl, key, success: true }` |
| `tray-upload` | `{ productConfigId, contentType, fileName }` | `{ uploadUrl, key, success: true }` |
| `placeholder-logo` | `{ contentType, fileName }` | `{ uploadUrl, key, publicUrl, success: true }` |

### 4.2 `POST /api/admin/upload` — [`api.admin.upload.tsx`](../../app/routes/api.admin.upload.tsx)

Server-mediated upload (bytes go through our server then to R2). Use when R2 CORS is problematic.

**Action intents:**
| Intent | Body (FormData) | Response |
|---|---|---|
| `view-image` | `file, productConfigId, viewId, variantId` | `{ key, publicUrl, success: true }` |
| `placeholder-logo` | `file` | `{ key, publicUrl, success: true }` |
| `artwork` | `file, lineId` | `{ key, publicUrl, logoAssetId, success: true }` |

### 4.3 `POST /api/admin/batch-upload-urls` — [`api.admin.batch-upload-urls.tsx`](../../app/routes/api.admin.batch-upload-urls.tsx)

Same as `/upload-url` but batched for the image importer.

- **Body:** `{ productConfigId, items: Array<{ viewId, variantId, contentType, fileName }> }`
- **Response:** `{ items: Array<{ viewId, variantId, uploadUrl, storageKey }> }`

### 4.4 `POST /api/admin/batch-save-images` — [`api.admin.batch-save-images.tsx`](../../app/routes/api.admin.batch-save-images.tsx)

Persists bulk-uploaded view images after the browser PUTs them. Body includes `{ productConfigId, items: [{ viewId, variantId, storageKey }] }`; response upserts `VariantViewConfiguration.imageUrl`.

### 4.5 `/api/admin/methods` — [`api.admin.methods.tsx`](../../app/routes/api.admin.methods.tsx)

REST wrapper on `/app/methods`. Intended for cross-page fetches (e.g. methods dropdown in storefront config editor).

- **GET `/api/admin/methods`** → `{ methods: Array<DecorationMethod> }` (200).
- **POST `/api/admin/methods`** → JSON `{ name }` → `{ method }` (201).

### 4.6 `/api/admin/methods/:id` — [`api.admin.methods.$id.tsx`](../../app/routes/api.admin.methods.$id.tsx)

- **GET** → `{ method }`.
- **POST** (PUT semantics; Remix action dispatches on `intent`): `intent=update|delete` same shape as [§3.4](#34-method-detail---appmethodsid).

### 4.7 `POST /api/admin/import-shopify-images` — [`api.admin.import-shopify-images.tsx`](../../app/routes/api.admin.import-shopify-images.tsx)

Import product images directly from Shopify Products API into R2.

- **Body:** `{ productConfigId, productIds: string[] }`.
- **Response:** `{ imported: Array<{ viewId, variantId, storageKey, publicUrl }>, skipped: Array<{ productId, reason }> }`.
- **Uses Shopify GraphQL `GetProductImages`** — see [§8.2](#82-outbound-graphql-queries).

### 4.8 `POST /api/admin/artwork-upload` — [`api.admin.artwork-upload.tsx`](../../app/routes/api.admin.artwork-upload.tsx)

Admin-side upload of customer artwork (merchant uploads on customer's behalf). 3-step pattern mirrors storefront:
1. Client requests presigned URL (intent=`get-upload-url` — returns `{ uploadUrl, assetId }`).
2. Client PUTs bytes to R2.
3. Client POSTs `intent=complete` `{ assetId, lineId, placementId }` → server links LogoAsset to OrderLineCustomization.

### 4.9 `GET /api/admin/order-block/:orderId` — [`api.admin.order-block.$orderId.tsx`](../../app/routes/api.admin.order-block.$orderId.tsx)

Powers the **Shopify Admin Order Details block extension** (`extensions/insignia-order-block/`). This is a separate UI surface (Shopify UI Extensions, web components, NOT React/Polaris) but it pulls the same customization data.

- **URL param:** `:orderId` — Shopify order GID.
- **Response:**
  ```ts
  {
    orderId: string;
    items: Array<{
      shopifyLineId: string;
      productName: string;
      variantLabel: string;
      quantity: number;
      decorationMethod: string;
      artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
      productionStatus: ProductionStatus;
      overallArtworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
      firstLogoThumbnailUrl: string | null;
      placements: Array<{ placementId, name, logoThumbnailUrl: string | null }>;
    }>;
    feeTotal: string | null;        // pre-formatted currency string
    feeCurrencyCode: string | null;
  }
  ```

### 4.10 Cron endpoints — `api.admin.cron.*`

| Route | File | Purpose |
|---|---|---|
| `/api/admin/cron/cleanup-drafts` | [`api.admin.cron.cleanup-drafts.tsx`](../../app/routes/api.admin.cron.cleanup-drafts.tsx) | Delete stale `CustomizationDraft` rows older than N days. |
| `/api/admin/cron/cleanup-slots` | [`api.admin.cron.cleanup-slots.tsx`](../../app/routes/api.admin.cron.cleanup-slots.tsx) | Recycle expired `VariantSlot` reservations back to `FREE`. |

Both POST-only; intended to be called by a scheduler (cron or external job runner).

### 4.11 `GET /api/health` — [`api.health.tsx`](../../app/routes/api.health.tsx)

Public, no auth. Used by Docker HEALTHCHECK / Uptime Kuma.

- **Response:** `{ status: "ok"|"error", db: "ok"|"unreachable", timestamp: ISO }`.
- **Status codes:** 200 healthy, 503 DB unreachable.

---

## 5. Storefront routes via App Proxy

Routes under `/apps/insignia/*` are customer-facing. Shopify signs every request with HMAC; `authenticate.public.appProxy(request)` verifies and extracts the shop domain from the signature.

Every storefront endpoint also calls `checkRateLimit(session.shop)` before doing work — returns `429` with `Retry-After` if exceeded.

### 5.1 Layout — `/apps/insignia` — [`apps.insignia.tsx`](../../app/routes/apps.insignia.tsx)

Wraps the storefront modal surface. Renders an HTML `<ErrorBoundary>` fallback for child JSON routes. Does NOT authenticate — child routes do, individually.

### 5.2 Modal page — `GET /apps/insignia/modal` — [`apps.insignia.modal.tsx`](../../app/routes/apps.insignia.modal.tsx)

Returns the modal HTML shell consumed by the storefront theme block.

- **Query params:** `productId` (or `p`), `variantId` (or `v`), `return` (safe-origin redirect after close).
- **Loader →** `{ productId, variantId, appUrl, returnUrl }` where `productId`/`variantId` are normalized to GID format.
- **Client-side `clientLoader`** additionally fetches `/apps/insignia/config` to hydrate the wizard.

### 5.3 `GET /apps/insignia/config` — [`apps.insignia.config.tsx`](../../app/routes/apps.insignia.config.tsx)

The big hydration endpoint. Powers the storefront wizard.

- **Query params:** `productId`, optional `variantId`.
- **Response = `StorefrontConfig`** (shape in [§7.4](#74-typescript-shared-types)).
  ```ts
  {
    productConfigId: string;
    shop: string;                    // domain
    productId: string;
    variantId: string;
    currency: string;                // ISO 4217
    baseProductPriceCents: number;
    productTitle: string;
    placeholderLogo: {
      mode: "merchant_asset" | "bold_text";
      text: string | null;
      imageUrl: string | null;       // presigned
    };
    views: ConfiguredView[];         // product views with presigned imageUrl + geometry
    methods: DecorationMethodRef[];
    placements: Placement[];
    variants: ProductVariantOption[];
    defaultLocale: string;           // BCP-47
    translations: Record<string, Record<string, string>>;  // locale → key → text
  }
  ```

### 5.4 `POST /apps/insignia/customizations` — [`apps.insignia.customizations.tsx`](../../app/routes/apps.insignia.customizations.tsx)

Persist a draft customization after the customer finishes the wizard.

- **Body:**
  ```ts
  {
    productId: string;
    variantId: string;
    productConfigId: string;
    methodId: string;
    placements: Array<{ placementId, stepIndex }>;
    logoAssetIdsByPlacementId: Record<string, string | null>;
    artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
    customerEmail?: string;          // required when PENDING_CUSTOMER (for reminder emails)
  }
  ```
- **Response:** `{ customizationId, unitPriceCents }`.
- **Side effect:** creates `CustomizationDraft` row; idempotent via `configHash`.

### 5.5 `POST /apps/insignia/price` — [`apps.insignia.price.tsx`](../../app/routes/apps.insignia.price.tsx)

Authoritative price computation for the review step.

- **Body:** `{ customizationId: string }`.
- **Response:**
  ```ts
  {
    unitPriceCents: number;
    breakdown: {
      baseCents: number;
      methodCents: number;
      totalCents: number;
    };
  }
  ```

### 5.6 `POST /apps/insignia/prepare` — [`apps.insignia.prepare.tsx`](../../app/routes/apps.insignia.prepare.tsx)

Reserve a variant-pool slot and set its purchasable price for exactly this customization. Client calls this right before `/cart/add.js`.

- **Body:** `{ customizationId: string }`.
- **Response:** `{ slotVariantId, configHash, pricingVersion, unitPriceCents, feeCents }`. Client uses `slotVariantId` for the `/cart/add.js` line item.

### 5.7 Uploads — `POST /apps/insignia/uploads` — [`apps.insignia.uploads.tsx`](../../app/routes/apps.insignia.uploads.tsx)

3-step upload flow:

| Step | Endpoint | Body | Response |
|---|---|---|---|
| 1. Get PUT URL | `POST /apps/insignia/uploads` | `{ fileName, contentType, sizeBytes? }` | `{ uploadId, putUrl, expiresAt }` |
| 2. PUT bytes | R2 direct | file body to `putUrl` | 200 (R2) |
| 3. Complete | `POST /apps/insignia/uploads/:id/complete` ([`apps.insignia.uploads.$id.complete.tsx`](../../app/routes/apps.insignia.uploads.$id.complete.tsx)) | (none) | `{ logoAsset: { id, kind, previewPngUrl, sanitizedSvgUrl } }` |

Additional helper: `POST /apps/insignia/uploads/:id/refresh` ([`apps.insignia.uploads.$id.refresh.tsx`](../../app/routes/apps.insignia.uploads.$id.refresh.tsx)) re-signs the preview/download URLs if the client's copies have expired.

### 5.8 `POST /apps/insignia/cart-confirm` — [`apps.insignia.cart-confirm.tsx`](../../app/routes/apps.insignia.cart-confirm.tsx)

Called after the customer successfully adds the line to cart. Promotes the `CustomizationConfig` state from `RESERVED` → `IN_CART` and binds the line item properties.

- **Body:** `{ customizationId, cartItemKey }`.

---

## 6. Webhooks

All POST-only; `authenticate.webhook(request)` verifies HMAC and extracts `{ topic, shop, payload, webhookId }`.

All go through `processWebhookIdempotently(shopId, eventId, topic, handler)` ([`app/lib/services/webhook-idempotency.server.ts`](../../app/lib/services/webhook-idempotency.server.ts)) which:
- Records `WebhookEvent { shopId, eventId, topic, receivedAt, processedAt }`.
- Uses `FOR UPDATE SKIP LOCKED` to prevent double-processing under retry races.
- Returns 500 if handler throws, letting Shopify retry.

### 6.1 `POST /webhooks/orders/create` — [`webhooks.orders.create.tsx`](../../app/routes/webhooks.orders.create.tsx)

- **Topic:** `orders/create`.
- **Payload fields consumed:** `admin_graphql_api_id` (Order GID), `id`, `order_status_url`, `line_items[id, variant_id, properties[{name, value}]]`, `customer` (if present).
- **Writes:**
  - `OrderLineCustomization` — one row per customized line item (properties-matched).
  - `CustomizationConfig` — state → `ORDERED`.
- **Side effects:** order tag sync (fire-and-forget), optional customer denorm if fields present.

### 6.2 `POST /webhooks/orders/paid` — [`webhooks.orders.paid.tsx`](../../app/routes/webhooks.orders.paid.tsx)

- **Topic:** `orders/paid`.
- **Payload fields consumed:** `admin_graphql_api_id`, `id`, `line_items`.
- **Writes:**
  - `VariantSlot` — state → `FREE` (recycle for reuse).
  - `CustomizationConfig` — state → `PURCHASED`.
- **Mutations to Shopify:** `productVariantsBulkUpdate` resets slot price back to $0 (3 retries with exponential backoff).

### 6.3 `POST /webhooks/app/uninstalled` — [`webhooks.app.uninstalled.tsx`](../../app/routes/webhooks.app.uninstalled.tsx)

- **Topic:** `app/uninstalled`.
- **Writes:** `Session` — `deleteMany({ where: { shop } })`.

### 6.4 `POST /webhooks/app/scopes_update` — [`webhooks.app.scopes_update.tsx`](../../app/routes/webhooks.app.scopes_update.tsx)

Registered but currently empty handler. Returns 200.

### 6.5 GDPR webhooks — [`webhooks.gdpr.tsx`](../../app/routes/webhooks.gdpr.tsx)

Multi-topic handler:
- `customers/data_request` — logs, no response payload yet.
- `customers/redact` — deletes `CustomizationDraft` + `OrderLineCustomization` matching customer email.
- `shop/redact` — cascading delete of entire `Shop` and its children.

---

## 7. Data shapes

### 7.1 Prisma models

Grouped by domain, in the order a newcomer learns the system.

#### `Shop`
Root tenancy record.
| Field | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `shopifyDomain` | `String` (unique) | e.g. `store.myshopify.com` |
| `accessToken` | `String` | **Server-only.** Offline OAuth token |
| `currencyCode` | `String` | ISO 4217, default `USD` |
| `installedAt` | `DateTime` | |
| `uninstalledAt` | `DateTime?` | |

#### `MerchantSettings` (1:1 with `Shop`)
| Field | Type | Notes |
|---|---|---|
| `shopId` | `String` (unique FK) | |
| `placeholderLogoImageUrl` | `String?` | R2 key; null = fall back to "Bold text" placeholder |
| `setupGuideDismissedAt` | `DateTime?` | null until merchant dismisses |
| `emailReminderTemplate` | `String?` | Custom artwork-reminder template |
| `productionQcEnabled` | `Boolean` | Reserved for QC workflow |
| `defaultStorefrontLocale` | `String` | BCP-47 (`en`, `nl`, `de`, `fr`, `es`, `it`, `pt`, `pl`) |

#### `DecorationMethod`
| Field | Type | Notes |
|---|---|---|
| `shopId` | FK | |
| `name` | `String` | Internal merchant label — "Embroidery" |
| `basePriceCents` | `Int?` | Method-level fee (default; may be overridden per product config via `ProductConfigMethod.basePriceCentsOverride`) |
| `description` | `String?` | Merchant-only notes |
| `customerName` | `String?` | Storefront label — "Embroider Your Logo" |
| `customerDescription` | `String?` | Storefront body copy |
| `artworkConstraints` | `Json?` | `{ fileTypes: string[], maxColors: number?, minDpi: number? }` |
| Unique | `[shopId, name]` | |

#### `ProductConfig` (+ `ProductConfigMethod` join)
| Field | Type | Notes |
|---|---|---|
| `shopId` | FK | |
| `name` | `String` | |
| `linkedProductIds` | `String[]` | Array of Shopify product GIDs |
| `presetKey` | `String?` | `t-shirt`, `hoodie`, `polo`, `cap`, or null |

#### `ProductView`
| Field | Type | Notes |
|---|---|---|
| `productConfigId` | FK | |
| `perspective` | `ViewPerspective` | `front`, `back`, `left`, `right`, `side`, `custom` |
| `name` | `String?` | Overrides perspective label |
| `displayOrder` | `Int` | |
| `defaultImageKey` | `String?` | R2 key (server-only; presigned on read) |
| `placementGeometry` | `Json?` | Map placementId → `PlacementGeometry`; view-level default |
| `sharedZones` | `Boolean` | If true, geometry shared across variants |
| `calibrationPxPerCm` | `Float?` | Ruler tool calibration (v3 feature #1) |

#### `VariantViewConfiguration`
Per-variant per-view image + geometry overrides.
| Field | Type | Notes |
|---|---|---|
| `productConfigId`, `variantId`, `viewId` | FKs | Unique together |
| `imageUrl` | `String?` | R2 key; null falls back to `ProductView.defaultImageKey` |
| `placementGeometry` | `Json?` | Override map placementId → `PlacementGeometry` |

#### `PlacementDefinition`
| Field | Type | Notes |
|---|---|---|
| `productViewId` | FK | |
| `name` | `String` | "Left Chest" |
| `basePriceAdjustmentCents` | `Int` | Zone-level fee |
| `hidePriceWhenZero` | `Boolean` | |
| `defaultStepIndex` | `Int` | Pre-selected size step |
| `displayOrder` | `Int` | |

#### `PlacementStep`
| Field | Type | Notes |
|---|---|---|
| `placementDefinitionId` | FK | |
| `label` | `String` | "Small" / "Standard" / "Large" |
| `priceAdjustmentCents` | `Int` | Step-level fee delta |
| `scaleFactor` | `Float` | Logo size multiplier |
| `displayOrder` | `Int` | |

#### `CustomizationDraft`
Pre-order draft (cart session scoped).
| Field | Type | Notes |
|---|---|---|
| `shopId`, `productConfigId`, `methodId` | FKs | |
| `productId`, `variantId` | `String` | Shopify GIDs |
| `placements` | `Json` | `Array<{ placementId, stepIndex }>` |
| `logoAssetIdsByPlacementId` | `Json` | `Record<placementId, logoAssetId \| null>` |
| `artworkStatus` | `ArtworkStatusDraft` | `PROVIDED` / `PENDING_CUSTOMER` |
| `customerEmail` | `String?` | For GDPR redaction + reminders |
| `unitPriceCents`, `feeCents` | `Int?` | Set after `/price` call |
| `configHash` | `String` | SHA256 of config; dedupes across draft reuse |
| `pricingVersion` | `String` | `"v1"` currently |

#### `StorefrontUploadSession`
Temporary record between step 1 (get PUT URL) and step 3 (complete).
| Field | Type | Notes |
|---|---|---|
| `shopId` | FK | |
| `storageKey` | `String` | R2 path; **server-only** |
| `contentType`, `fileName`, `sizeBytes` | | |

#### `LogoAsset`
Finalized processed logo (post-complete).
| Field | Type | Notes |
|---|---|---|
| `shopId` | FK | |
| `kind` | `LogoAssetKind` | `buyer_upload` / `merchant_placeholder` |
| `sanitizedSvgUrl` | `String?` | R2 key (server-only). Null for raster. |
| `previewPngUrl` | `String?` | R2 key (server-only). Always set post-complete. |
| `originalFileName` | `String?` | |
| `fileSizeBytes` | `Int?` | |

#### `VariantSlot`
Fee-product-variant pool. One slot reserved per customization.
| Field | Type | Notes |
|---|---|---|
| `shopId`, `methodId` | FK | |
| `shopifyProductId`, `shopifyVariantId` | `String` | The fee product + variant |
| `state` | `VariantSlotState` | `FREE` / `RESERVED` / `IN_CART` |
| `reservedAt`, `reservedUntil`, `inCartUntil` | `DateTime?` | Lifecycle timestamps |
| `currentConfigId` | FK to `CustomizationConfig` (unique, nullable) | |

#### `CustomizationConfig`
Priced, fee-variant-linked configuration.
| Field | Type | Notes |
|---|---|---|
| `shopId`, `methodId`, `customizationDraftId` | FKs | |
| `configHash` | `String` | |
| `pricingVersion` | `String` | |
| `unitPriceCents`, `feeCents` | `Int` | |
| `state` | `CustomizationConfigState` | `RESERVED` → `IN_CART` → `ORDERED` → `PURCHASED` (or `EXPIRED`) |
| `reservedAt`, `inCartAt`, `orderedAt`, `purchasedAt`, `expiredAt` | `DateTime?` | Per-state timestamp |
| Inverse | `VariantSlot.currentConfigId` | |

#### `OrderLineCustomization`
Per-line-item customization record after the order is placed.
| Field | Type | Notes |
|---|---|---|
| `shopifyOrderId` | `String` | Shopify Order GID |
| `shopifyLineId` | `String` | Shopify LineItem GID |
| `productConfigId` | FK | |
| `variantId` | `String` | Shopify variant GID (the customer's chosen variant, not the fee variant) |
| `customizationConfigId` | FK? | null for legacy unpaired lines |
| `artworkStatus` | `ArtworkStatus` | |
| `productionStatus` | `ProductionStatus` | |
| `logoAssetIdsByPlacementId` | `Json?` | Snapshot, immutable after order |
| `placementGeometrySnapshotByViewId` | `Json?` | Snapshot of geometry at order time, immutable |
| `useLiveConfigFallback` | `Boolean` | Legacy; true = fall through to live config |
| `orderStatusUrl` | `String?` | Shopify customer order-status page URL |
| `feeShopifyVariantId`, `feeShopifyProductId` | `String?` | Audit trail for fee variant |
| Unique | `[shopifyOrderId, shopifyLineId]` | |

#### `WebhookEvent`
Idempotency ledger.
| Field | Type | Notes |
|---|---|---|
| `shopId` | FK | |
| `eventId` | `String` (unique) | `X-Shopify-Event-Id` header |
| `topic` | `String` | |
| `receivedAt`, `processedAt` | `DateTime?` | `processedAt` null = in-flight / retry |

#### `StorefrontTranslation`
Merchant overrides for storefront modal UI strings.
| Field | Type | Notes |
|---|---|---|
| `shopId`, `locale`, `key` | FK / string | Unique together |
| `value` | `String` | Translated text |

### 7.2 Enums

| Enum | Values | Used by |
|---|---|---|
| `ViewPerspective` | `front`, `back`, `left`, `right`, `side`, `custom` | `ProductView.perspective` |
| `ArtworkStatusDraft` | `PROVIDED`, `PENDING_CUSTOMER` | `CustomizationDraft.artworkStatus` |
| `LogoAssetKind` | `buyer_upload`, `merchant_placeholder` | `LogoAsset.kind` |
| `VariantSlotState` | `FREE`, `RESERVED`, `IN_CART` | `VariantSlot.state` |
| `CustomizationConfigState` | `RESERVED`, `IN_CART`, `ORDERED`, `PURCHASED`, `EXPIRED` | `CustomizationConfig.state` |
| `ArtworkStatus` | `PROVIDED`, `PENDING_CUSTOMER` | `OrderLineCustomization.artworkStatus` |
| `ProductionStatus` | `ARTWORK_PENDING`, `ARTWORK_PROVIDED`, `IN_PRODUCTION`, `QUALITY_CHECK`, `SHIPPED` | `OrderLineCustomization.productionStatus` |

**Key UI translation:** `ProductionStatus.SHIPPED` → user-facing label `"Complete"`. `ArtworkStatus.PENDING_CUSTOMER` → user-facing label `"Awaiting artwork"`.

### 7.3 JSON blob field shapes

These fields are typed `Json` in Prisma; the application enforces shape at read/write time.

#### `ProductView.placementGeometry`
```ts
Record<placementId, {
  centerXPercent: number;    // 0–100
  centerYPercent: number;    // 0–100
  maxWidthPercent: number;   // 0–100
  maxHeightPercent?: number; // optional; derived from aspect ratio otherwise
}>
```

#### `VariantViewConfiguration.placementGeometry`
Same shape as above, but values can be explicitly `null` to mean "inherit from `ProductView.placementGeometry` for this placement".

#### `OrderLineCustomization.logoAssetIdsByPlacementId`
```ts
Record<placementId, logoAssetId | null>
```

#### `OrderLineCustomization.placementGeometrySnapshotByViewId`
```ts
Record<viewId, Record<placementId, PlacementGeometry | null> | null>
```
Outer value may be null for the whole view; inner entry may be null for per-placement inheritance. When the entire field is null, `useLiveConfigFallback` must be true and the live config applies.

#### `CustomizationDraft.placements`
```ts
Array<{ placementId: string, stepIndex: number }>
```

#### `DecorationMethod.artworkConstraints`
```ts
{
  fileTypes: string[];       // ["image/svg+xml", "image/png", "image/jpeg"]
  maxColors: number | null;  // null = unconstrained
  minDpi: number | null;
}
```

### 7.4 TypeScript shared types

From [`app/lib/admin-types.ts`](../../app/lib/admin-types.ts) and [`app/lib/services/storefront-config.server.ts`](../../app/lib/services/storefront-config.server.ts).

#### `PlacementGeometry` (admin + storefront)
```ts
interface PlacementGeometry {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  maxHeightPercent?: number;
}
```

#### `PlacementStep` (admin, from admin-types.ts)
```ts
interface PlacementStep {
  id: string;
  label: string;
  scaleFactor: number;
  priceAdjustmentCents: number;
  displayOrder: number;
}
```

#### `Placement` (admin, hydrated)
```ts
interface Placement {
  id: string;
  name: string;
  basePriceAdjustmentCents: number;
  hidePriceWhenZero: boolean;
  defaultStepIndex: number;
  steps: PlacementStep[];
}
```

#### `ConfiguredView` (storefront)
```ts
interface ConfiguredView {
  id: string;
  name: string;
  perspective: ViewPerspective;
  imageUrl: string | null;      // presigned
  isMissingImage: boolean;
  calibrationPxPerCm: number | null;
}
```

#### `DecorationMethodRef` (storefront-safe method)
```ts
interface DecorationMethodRef {
  id: string;
  name: string;
  basePriceCents: number; // effective price — override-resolved (ProductConfigMethod.basePriceCentsOverride ?? DecorationMethod.basePriceCents)
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: ArtworkConstraints | null;
}
```

#### `StorefrontConfig` — `GET /apps/insignia/config` response
```ts
interface StorefrontConfig {
  productConfigId: string;
  shop: string;
  productId: string;
  variantId: string;
  currency: string;
  baseProductPriceCents: number;
  productTitle: string;
  placeholderLogo: {
    mode: "merchant_asset" | "bold_text";
    text: string | null;
    imageUrl: string | null;
  };
  views: ConfiguredView[];
  methods: DecorationMethodRef[];
  placements: Placement[];          // flat list with embedded geometryByViewId
  variants: ProductVariantOption[];
  defaultLocale: string;
  translations: Record<string, Record<string, string>>;
}
```

#### `PlacementSelection` / `CreateDraftInput` (storefront)
```ts
interface PlacementSelection { placementId: string; stepIndex: number; }

interface CreateDraftInput {
  productId: string;
  variantId: string;
  productConfigId: string;
  methodId: string;
  placements: PlacementSelection[];
  logoAssetIdsByPlacementId: Record<string, string | null>;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  customerEmail?: string;
}
```

#### `PriceResult` (response of `/apps/insignia/price`)
```ts
interface PriceResult {
  unitPriceCents: number;
  feeCents: number;
  breakdown: { baseCents: number; methodCents: number; totalCents: number };
  validation: { ok: boolean; issues?: string[] };
}
```

#### `PrepareResult` (response of `/apps/insignia/prepare`)
```ts
interface PrepareResult {
  slotVariantId: string;       // the fee variant GID to use in /cart/add.js
  configHash: string;
  pricingVersion: string;
  unitPriceCents: number;
  feeCents: number;
}
```

#### `CreateUploadResult` / `CompleteUploadResult` (storefront uploads)
```ts
interface CreateUploadResult { uploadId: string; putUrl: string; expiresAt: string; }

interface CompleteUploadResult {
  logoAsset: {
    id: string;
    kind: "buyer_upload" | "merchant_placeholder";
    previewPngUrl: string;     // presigned
    sanitizedSvgUrl: string | null;  // presigned or null
  };
}
```

### 7.5 Derived response shapes (loader-composed)

#### `OrderGroup` — Orders Index loader
Aggregation of `OrderLineCustomization` rows per `shopifyOrderId`:
```ts
{
  shopifyOrderId: string;
  orderName: string;          // derived "#1042" from last 6 digits of GID
  lineCount: number;          // number of customized line items
  pendingArtwork: number;     // count of rows with artworkStatus=PENDING_CUSTOMER
  latestStatus: ProductionStatus;  // worst-case per STATUS_PRIORITY
  totalCents: number;         // sum of customizationConfig.unitPriceCents
  createdAt: string;          // ISO; from first-row createdAt
}
```

#### `LinePreviewData` — Order Detail loader
Per-line preview payload with hydrated geometry + presigned URLs. One entry per `OrderLineCustomization`:
```ts
{
  lineId: string;
  productConfigId: string;
  variantId: string;
  productConfigName: string;
  decorationMethodName: string;
  artworkStatus: ArtworkStatus;
  productionStatus: ProductionStatus;
  views: Array<{
    id: string;
    name: string;
    perspective: ViewPerspective;
    imageUrl: string | null;            // presigned
    placements: Array<{
      id: string;
      name: string;
      geometry: PlacementGeometry | null;
      logoAssetId: string | null;
    }>;
  }>;
}
```
The loader additionally returns `logoAssetMap`, `logoAssetDownloadUrls`, `logoAssetPreviewUrls` as flat `Record<logoAssetId, ...>` maps.

---

## 8. Shopify integration surface

### 8.1 App config

| Config | File | Client ID | Environment |
|---|---|---|---|
| **Production** | [`shopify.app.insignia.toml`](../../shopify.app.insignia.toml) | `eb2c3c7dd059991bc6cd4d421578a8ab` | `https://insignia.optidigi.nl` |
| **Development** | [`shopify.app.insignia-demo.toml`](../../shopify.app.insignia-demo.toml) | `8d5562e5ec9a58bfe5c0cc5e0f8e63a3` | Cloudflare tunnel (auto) |
| **Custom (private)** | [`shopify.app.insignia-custom.toml`](../../shopify.app.insignia-custom.toml) | `REPLACE_WITH_CUSTOM_APP_CLIENT_ID` | Per-merchant; placeholder until used |

**All configs share:**
- **API version:** `2026-04`
- **Scopes:** `write_products`, `read_products`, `read_orders`, `write_orders`, `write_app_proxy`, `write_publications`, `write_inventory`, `read_themes`
- **App proxy:** subpath `insignia`, prefix `apps`, full store URL `myshop.myshopify.com/apps/insignia/*`
- **Webhook subscriptions (declarative):**
  - `app/uninstalled` → `/webhooks/app/uninstalled`
  - `app/scopes_update` → `/webhooks/app/scopes_update`
  - `orders/create` → `/webhooks/orders/create`
  - `orders/paid` → `/webhooks/orders/paid`
- **GDPR webhooks:**
  - `customers/data_request`, `customers/redact`, `shop/redact` → `/webhooks/gdpr/*`
- **Session storage:** `PrismaSessionStorage` (PostgreSQL).

### 8.2 Outbound GraphQL queries

Every use of `admin.graphql(...)` in the codebase:

| Query name | File | Object | Fields selected | Variables | Triggered by |
|---|---|---|---|---|---|
| `shopCurrency` | [`shop-currency.server.ts:22`](../../app/lib/services/shop-currency.server.ts) | `Shop` | `currencyCode` | none | Dashboard load |
| `productVariants` | [`variant-pool.server.ts:112`](../../app/lib/services/variant-pool.server.ts) | `Product`, `Variant`, `InventoryItem`, `InventoryLevel` | `id`, `inventoryPolicy`, `inventoryItem.id/tracked`, `inventoryLevels` | `productId` | Variant pool self-heal |
| `publications` | [`variant-pool.server.ts:55`](../../app/lib/services/variant-pool.server.ts) | `Publication` | `id`, `name` | none | Fee product provisioning |
| `product (exists check)` | [`storefront-prepare.server.ts:60`](../../app/lib/services/storefront-prepare.server.ts) | `Product` | `id` | `productId` | `/prepare` idempotency |
| `GetOrderTags` | [`order-tags.server.ts:14`](../../app/lib/services/order-tags.server.ts) | `Order` | `tags` | `id` | Sync tags after status change |
| `GetOrderDetails` | [`app.orders.$id.tsx`](../../app/routes/app.orders.$id.tsx) (inline) | `Order`, `Customer`, `LineItem` | `name`, `currencyCode`, `customer.firstName/lastName/email`, `lineItems(first: 50)[id, title, quantity, originalUnitPriceSet, image.url, variant.title/image.url]` | `id` | Order detail loader |
| `GetProductImages` | [`api.admin.import-shopify-images.tsx:75`](../../app/routes/api.admin.import-shopify-images.tsx) | `Product`, `Media`, `Variant` | `media(first:250, query:IMAGE)`, `variants(first:100)[id, selectedOptions, media]` | `productId` | Admin image import |
| `GetPrintData` | [`app.orders.$id.print.tsx:66`](../../app/routes/app.orders.$id.print.tsx) | `Order`, `LineItem` | `name`, `lineItems(first:50)[id, title, quantity, variant.title]` | `id` | Print page |

### 8.3 Outbound GraphQL mutations

| Mutation | File | Object | Input | Response | Triggered by |
|---|---|---|---|---|---|
| `productVariantsBulkUpdate` | [`webhooks.orders.paid.tsx:223`](../../app/routes/webhooks.orders.paid.tsx) | `ProductVariant` | `productId`, `variants[id, price]` | `id`, `price`, `userErrors` | Reset slot variant to $0 after paid |
| `productVariantsBulkUpdate` | [`variant-pool.server.ts:144`](../../app/lib/services/variant-pool.server.ts) | `ProductVariant` | `productId`, `variants[id, inventoryPolicy]` | `id`, `userErrors` | Keep fee variants always purchasable (`CONTINUE` policy) |
| `publishablePublish` | [`variant-pool.server.ts:76`](../../app/lib/services/variant-pool.server.ts) | `Publishable (Product)` | `id`, `input[publicationId]` | `userErrors` | Publish fee product to Online Store |
| `productUpdate` | [`fix-fee-products.server.ts:31`](../../app/lib/services/fix-fee-products.server.ts) | `Product` | `product { id, status: UNLISTED }` | `id`, `status`, `userErrors` | One-time fix: mark fee products `UNLISTED` |
| `tagsAdd` | [`webhooks.orders.create.tsx:225`](../../app/routes/webhooks.orders.create.tsx) | `Order` | `id`, `tags[]` | `node.id`, `userErrors` | Tag order after OLC binding |
| `orderUpdate` (for tag sync) | [`order-tags.server.ts:54`](../../app/lib/services/order-tags.server.ts) | `Order` | `input { id, tags[] }` | `id`, `userErrors` | Sync tags with production status |

### 8.4 Inbound webhook topics (summary)

| Topic | When Shopify sends it | Handler | Prisma writes |
|---|---|---|---|
| `orders/create` | New line items in any Shopify order | `webhooks.orders.create.tsx` | `OrderLineCustomization` create + `CustomizationConfig` → `ORDERED` |
| `orders/paid` | Payment captured | `webhooks.orders.paid.tsx` | `VariantSlot` → `FREE`; `CustomizationConfig` → `PURCHASED` |
| `app/uninstalled` | App removed | `webhooks.app.uninstalled.tsx` | `Session` deleteMany |
| `app/scopes_update` | Scope change | `webhooks.app.scopes_update.tsx` | (no-op) |
| `customers/data_request` | GDPR export request | `webhooks.gdpr.tsx` | (logged) |
| `customers/redact` | GDPR delete request | `webhooks.gdpr.tsx` | `CustomizationDraft` + `OrderLineCustomization` delete |
| `shop/redact` | Shop-level delete | `webhooks.gdpr.tsx` | Cascade delete `Shop` |

### 8.5 Rate limits / pagination / caching

- **Storefront rate limit:** per-shop token bucket; `checkRateLimit(shopId)` in [`app/lib/storefront/rate-limit.server.ts`](../../app/lib/storefront/rate-limit.server.ts). Returns `429` with `Retry-After` header when exceeded.
- **Shopify GraphQL:**
  - `GetProductImages` uses `media(first: 250)` + `variants(first: 100)`. Marks result incomplete if `pageInfo.hasNextPage`; current code does not paginate further.
  - `GetOrderDetails` uses `lineItems(first: 50)`. Orders with >50 line items would silently truncate — not expected in practice.
- **Presigned URL expiry:** typically `3600s` (1 hour) for logo previews / downloads; `600s` for storefront view images. Clients must tolerate 4xx on stale URLs (call `/apps/insignia/uploads/:id/refresh` to re-sign).
- **Webhook retries:** `orders/paid` has 3× retry with exponential backoff for the price-reset mutation (respects `Retry-After` from Shopify).

---

## 9. Placeholder and v3 features

Every entry below represents UI shown to merchants as a disabled or "Coming soon" control today. Frontend developers must render these as placeholders per the terminology lock — **do not remove them** (UI studies showed merchants find placeholders acceptable; removing them = losing feature signal).

Canonical source: [`docs/superpowers/specs/2026-04-10-v3-future-features.md`](../superpowers/specs/2026-04-10-v3-future-features.md). Numbers below match that document.

### 9.1 Admin UI placeholders — what's disabled today and what endpoint/model it needs

| # | Feature | UI placement today | Endpoint/model needed | Data shape |
|---|---|---|---|---|
| **13** | Direct artwork reminder email | Disabled "Send Artwork Reminder" on Order Detail primaryAction + bulk action overflow | New `POST /api/admin/orders/:id/send-reminder` + `OrderLineCustomization.artworkReminderSentAt DateTime?` (24h cooldown) | `{ orderGid, lineIds?: string[] }` → `{ sent: number, skipped: number }` |
| **14** | Production CSV export (per-line-item) | Overflow "Export CSV" already works but returns old 5-column format | Extend [`app/routes/app.orders.export.tsx`](../../app/routes/app.orders.export.tsx) and [`api.admin.orders.export.tsx`](../../app/routes/api.admin.orders.export.tsx) | Add columns: customer name, variant label, placement name, size step, logo filename, quantity, method |
| **15** | Production queue / Kanban view | Disabled "Queue" icon in view toggle on Orders page | New `GET /api/admin/orders/queue?method=<id>` | Groups orders by decoration method → lanes by production status |
| **16** | Due date / rush flag | Disabled `DatePicker` in order detail sidebar; disabled Due column in Orders table | Schema migration: `OrderLineCustomization.dueDate DateTime?` + `rushFlag Boolean` | New `intent=set-due-date` / `intent=set-rush-flag` on order detail route |
| **17** | Team member assignment | Disabled `Select` "Assign to team member" in order detail sidebar | New `ShopUser` model + Shopify Staff API scoping | `OrderLineCustomization.assignedShopUserId String?` |
| **18** | Status history / audit log | Greyed "Status history — coming soon" card in order detail sidebar with 2 dummy entries | New `OrderLineStatusEvent` table: `{ id, orderLineId, timestamp, actorId, fromStatus, toStatus, note }` | Emit event on every status mutation + read-side timeline loader |
| **19** | Bulk artwork download (ZIP) | Disabled "Download artwork (ZIP)" in Orders table bulk actions overflow | New `POST /api/admin/orders/download-artwork-zip` (streaming) | `{ orderGids: string[] }` → ZIP archive organized by order → placement |
| **20** | Shareable proof link per placement | Disabled "Send for approval" `Button variant="plain"` per placement | New route `apps.insignia.approval.$token.tsx` + `placementApprovalTokens Json?` on OLC | `{ token: string }` → per-placement approval page with approve/reject |
| **21** | In-app customer messaging | Disabled "Send message to customer" button below production notes | New `OrderLineMessage` table + Resend inbound webhook | `{ orderGid, body }` → Resend email + log thread entry |
| **22** | Keyboard navigation across orders | Greyed hint "↑↓ to navigate · → to advance status" at bottom of Order Detail | Client-side only (`useHotkeys` + URL-derived sequence); no backend | — |
| **23** | Stacked print file generation | — (merchant setting TBD) | Depends on #8 (production file export infra) | TBD |

### 9.2 Frontend-only v3 features (no backend work)

- **#6 Cmd+K command palette** — purely client.
- **#7 Toast + undo** — client-side soft-delete with optimistic rollback; existing endpoints suffice.
- **#10 White-label modal** — extend storefront config to expose brand tokens; no new endpoints.

### 9.3 V3 features that require schema + endpoint changes

- **#1 Ruler tool & calibration** — already has `ProductView.calibrationPxPerCm` in schema; needs ruler UI + `getDimensionsCm()` utility.
- **#2 Live storefront preview tab** — new preview mode on `/apps/insignia/config` that bypasses variant check.
- **#3 Bulk "Apply config to products"** — infrastructure exists (`duplicateProductConfig()`); needs multi-product target UI + progress endpoint.
- **#4 Area-based pricing** — new `pricingMode` + `ratePerSqCm` fields on `PlacementDefinition`. Depends on #1.
- **#5 Customer artwork upload page** — new route `apps.insignia.artwork.$orderId.tsx` + token-based auth. Prerequisite for #13 and #20.
- **#8 Production file export** — new `POST /api/admin/orders/:id/production-file` endpoint that generates high-res composite PNG/PDF. Depends on #1.
- **#9 3D product preview** — requires Three.js + per-product 3D models.
- **#11 Public API** — full REST surface under `/api/v1/*` with token auth.
- **#12 Multi-store management** — cross-tenant agency layer. Very large.

### 9.4 Terminology for placeholder controls

When rendering any placeholder, use this exact copy (frontend consistency check):

| Control type | Polaris pattern | Copy |
|---|---|---|
| Disabled Button | `<Button disabled><Tooltip content="Coming soon">…</Tooltip></Button>` or native `disabled` + aria-label | Label in sentence case; tooltip always "Coming soon" (or more specific e.g. "Email sending coming soon") |
| Disabled Select / DatePicker | `<Select disabled>` with helpText | "Coming soon" |
| Entire placeholder card | `<Box style={{opacity:0.5}} aria-label="Coming soon">` + `<Badge>Coming soon</Badge>` in header | Card heading normal; Badge neutral tone |

See [Section 2.6](#26-color-and-polaris-discipline-admin-only) for color discipline when rendering these.

---

## 10. Known integration gaps per UI feature

These are **real bindings the v3 admin UI wants to consume but the backend does not yet provide**. Each requires a small backend extension before the UI work can consume real data.

| UI need | Today | Frontend workaround | Extension needed |
|---|---|---|---|
| Orders table — customer name column | `OrderLineCustomization` has no customer fields | Render "—" | Denormalize at webhook time: add `customerFirstName`, `customerLastName`, `customerEmail`, `customerName` (nullable) to `OrderLineCustomization`; populate in `webhooks.orders.create.tsx`. |
| Orders table — artwork thumbnail column | `OrderGroup` doesn't include first logo | Render placeholder icon | Extend index loader to batch presigned `LogoAsset.previewPngUrl` for first-logo-per-order. Cheap (local signing, not a network call). |
| Orders table — tab counts (All / Needs Artwork / Ready to Produce) | Only active tab count returned | Show no count | 3 additional `db.orderLineCustomization.groupBy` calls with appropriate `where` clauses. |
| Orders table — production-status filter | No `productionStatus` param handled in loader | Filter disabled | Add `productionStatus` multi-value reader + `{ productionStatus: { in: ... } }` to query `where`. |
| Orders table — method column (with "Mixed") | `DecorationMethod.name` isn't aggregated into `OrderGroup` | Blank column | After grouping, collect unique method names per order; render `"—"` / single name / `"Mixed"`. |
| Orders table — "View in Shopify" secondary action | `session.shop` not in loader return | Button disabled | Add `shopDomain: session.shop` to loader return. |
| Order detail — Page subtitle (customer name) | `customer.firstName` + `lastName` fetched but not passed to Page | No subtitle | Compute `pageSubtitle` in loader (name → email → null). |
| Order detail — titleMetadata `Badge` worst-case states | Only 2 states computed (`Artwork pending` / `Complete`) | Wrong badge | Extend loader to compute worst-case production rollup → `{ tone, label }` with 4 possible states (`Artwork pending`, `Ready to produce`, `In production`, `Complete`). |
| Order detail — banner strip tones | `IN_PRODUCTION` banner state missing | No banner in that state | Extend banner rollup to emit `{ tone: "info", title: "In production", body: ... }` when lines are IN_PRODUCTION. |
| Order detail — line-item card header thumbnail | Shopify product image not fetched in `GetOrderDetails` | Placeholder icon | Extend GraphQL query to include `lineItems[].image.url` + `variant.image.url`; map onto each line. |
| Order detail — `renderMode` branching | No loader-side computation of `lines.length >= 4` or homogeneity | UI computes client-side | (Optional) add `renderMode: "cards"|"collapsible"|"compact-homogeneous"` + `homogeneousConfigId` to loader return. |
| ~~Order detail — OrderNote list + add-note~~ | **Resolved 2026-04-22:** `OrderNote` model + migration live; `save-note` intent wired into `app.orders.$id.tsx` action; loader returns `notes: OrderNoteResult[]`. Service at `app/lib/services/order-notes.server.ts`. | Notes UI functional | — |

Each of these is small (most are single-query extensions). The changes are additive and don't affect storefront. If a frontend dev needs any of these, coordinate with backend for a short-turnaround extension.

---

## 11. Appendix

### 11.1 File paths at a glance

**Routes**
- Admin pages: `app/routes/app.*.tsx`
- Admin APIs: `app/routes/api.admin.*.tsx`
- Storefront / app proxy: `app/routes/apps.insignia.*.tsx`
- Webhooks: `app/routes/webhooks.*.tsx`
- Health: `app/routes/api.health.tsx`

**Services**
- Shopify integration: `app/shopify.server.ts`
- Shop currency: `app/lib/services/shop-currency.server.ts`
- Methods: `app/lib/services/methods.server.ts`
- Product configs: `app/lib/services/product-configs.server.ts`
- Placements: `app/lib/services/placements.server.ts`
- Views: `app/lib/services/views.server.ts`
- Storefront config builder: `app/lib/services/storefront-config.server.ts`
- Storefront customizations: `app/lib/services/storefront-customizations.server.ts`
- Storefront prepare (slot reservation): `app/lib/services/storefront-prepare.server.ts`
- Storefront uploads: `app/lib/services/storefront-uploads.server.ts`
- Storefront cart confirm: `app/lib/services/storefront-cart-confirm.server.ts`
- Orders utilities: `app/lib/services/orders-utils.server.ts`
- Order tags sync: `app/lib/services/order-tags.server.ts`
- Variant pool: `app/lib/services/variant-pool.server.ts`
- Settings: `app/lib/services/settings.server.ts`
- Webhook idempotency: `app/lib/services/webhook-idempotency.server.ts`
- Merchant notifications (Resend): `app/lib/services/merchant-notifications.server.ts`
- Fix fee products (one-time): `app/lib/services/fix-fee-products.server.ts`
- Image manager (R2): `app/lib/services/image-manager.server.ts`
- Install theme block: `app/lib/services/install-theme-block.server.ts`
- Cron cleanup: `app/lib/services/cron-cleanup.server.ts`
- GDPR helpers: `app/lib/services/gdpr.server.ts`

**Shared libs**
- Error helpers: `app/lib/errors.server.ts`
- Admin types: `app/lib/admin-types.ts`
- Storage (R2 + presigning): `app/lib/storage.server.ts`
- Rate limit: `app/lib/storefront/rate-limit.server.ts`
- Prisma client: `app/db.server.ts`

**Schema**
- Prisma: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`

**Configs**
- Shopify app configs: `shopify.app.*.toml`

### 11.2 Common integration recipes

**Fetch orders and display one:**
```tsx
// In a Remix component
const { orders } = useLoaderData<typeof loader>();
orders.map(o => <OrderRow key={o.shopifyOrderId} order={o} />);
```

**POST an action from a React component:**
```tsx
const fetcher = useFetcher();
fetcher.submit(
  { intent: "advance-production-status", lineId, newStatus: "IN_PRODUCTION" },
  { method: "post" }
);
// Read fetcher.state and fetcher.data for result.
```

**Call an admin API endpoint:**
```tsx
const res = await fetch("/api/admin/methods", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Embroidery" }),
});
const { method, error } = await res.json();
if (error) handleError(error);
```

**Call a storefront endpoint from the modal:**
```ts
const res = await fetch(`/apps/insignia/customizations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(draft),
});
if (res.status === 429) {
  // honor Retry-After
}
const data = await res.json();
if (data.error) { /* handle by code */ }
```

**Consume a presigned URL:**
```tsx
<img src={logoAssetPreviewUrls[line.logoAssetId]} alt="Artwork preview" />
```
Never store the URL longer than its expiry. Refetch the loader or call `/refresh` if it expires.

### 11.3 When to talk to backend

If you're about to build a UI feature and can't find the data source in this doc, check:
1. [Section 9](#9-placeholder-and-v3-features) — is it a planned v3 feature?
2. [Section 10](#10-known-integration-gaps-per-ui-feature) — is it a known extension gap?
3. `docs/superpowers/specs/2026-04-10-v3-future-features.md` — for full v3 priority + complexity context.

If none of those match, it's genuinely missing — coordinate with backend to add the endpoint or field rather than hallucinating one.

---

**Questions, errors, or missing sections?** Open an issue or PR against this file. The audit that produced it is reproducible from the Prisma schema + route files + `shopify.app.*.toml`; update this doc alongside any backend change that adds/removes/renames an endpoint or field.
