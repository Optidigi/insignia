# Plan: Merchant-configurable one-time design fees

## 1. Summary

We're adding a feature-flagged subsystem that charges a one-time **design fee** per (cart × logo content × fee category × decoration method) tuple, modeling the real-world digitizing-setup cost merchants like Stitchs absorb (Borduren on Klein/Groot zones: €25/€39 once per cart per logo per zone-class). Identity is the Shopify cart token; on checkout the cart token is consumed and on next cart the fee re-applies. The whole thing is gated behind `DESIGN_FEES_ENABLED` (env var, default false on the public `insignia` deployment, true on `insignia-custom`) AND a per-shop opt-in (creating any `DesignFeeCategory` row plus assigning it on a `PlacementDefinition`); with both off the diff is invisible. The shape of the diff: 1 migration, 2 new Prisma models + 2 new columns, ~5 server modules under `app/lib/services/design-fees/`, 4–5 new admin routes, ~6 storefront-modal touch points (all tagged `// design-fees:` for grep-and-delete reverse-out), 1 new cron endpoint, ~600 LOC total.

Load-bearing files (per CLAUDE.md "load-bearing subsystem touch"):
- `app/components/storefront/CustomizationModal.tsx` (storefront cart submit path)
- `app/lib/services/storefront-prepare.server.ts` (prepare → slot reservation → Shopify variant price write)
- `app/lib/services/storefront-customizations.server.ts` (price computation)
- `app/lib/storefront/cart.client.ts` (`cart/add.js` mechanic)
- `app/lib/services/storefront-uploads.server.ts` (server-side file processing)

## 2. Data model

### 2.1 New Prisma definitions (additions to `prisma/schema.prisma`)

```prisma
// design-fees: merchant-configurable categories per decoration method
model DesignFeeCategory {
  id            String   @id @default(uuid())
  shopId        String
  methodId      String
  name          String   // e.g. "Klein", "Groot"
  feeCents      Int
  displayOrder  Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  shop             Shop                  @relation(fields: [shopId], references: [id], onDelete: Cascade)
  decorationMethod DecorationMethod      @relation(fields: [methodId], references: [id], onDelete: Cascade)
  placements       PlacementDefinition[]

  @@unique([methodId, name])
  @@index([shopId])
  @@index([methodId])
}

// design-fees: persisted "this cart already paid this fee tuple" record
model CartDesignFeeCharge {
  id                 String   @id @default(uuid())
  shopId             String
  cartToken          String   // Shopify cart token (from /cart.js)
  logoContentHash    String   // LogoAsset.contentHash
  categoryId         String
  methodId           String
  feeCentsCharged    Int      // snapshot at charge time
  shopifyVariantId   String?  // slot variant used to land this fee on cart (null until added)
  shopifyLineKey     String?  // /cart.js line key — for later removal
  createdAt          DateTime @default(now())

  shop             Shop              @relation(fields: [shopId], references: [id], onDelete: Cascade)
  category         DesignFeeCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  decorationMethod DecorationMethod  @relation(fields: [methodId], references: [id], onDelete: Cascade)

  @@unique([cartToken, logoContentHash, categoryId, methodId])
  @@index([shopId, createdAt])
  @@index([cartToken])
}
```

### 2.2 New columns on existing models

```prisma
model LogoAsset {
  // ...
  contentHash String?  // SHA256 hex (lowercase). NULL for legacy rows.
  // index for fast cross-cart lookup
  @@index([shopId, contentHash])
}

model PlacementDefinition {
  // ...
  feeCategoryId String?  // null = no design fee for this placement
  feeCategory   DesignFeeCategory? @relation(fields: [feeCategoryId], references: [id], onDelete: SetNull)
  @@index([feeCategoryId])
}
```

Add inverse relations to `Shop`, `DecorationMethod`:
- `Shop.designFeeCategories DesignFeeCategory[]`
- `Shop.cartDesignFeeCharges CartDesignFeeCharge[]`
- `DecorationMethod.designFeeCategories DesignFeeCategory[]`
- `DecorationMethod.cartDesignFeeCharges CartDesignFeeCharge[]`

### 2.3 Migration

File: `prisma/migrations/20260428000000_add_design_fees/migration.sql` (mirroring style of `20260425000000_add_placement_method_price/migration.sql`):

```sql
-- AlterTable
ALTER TABLE "LogoAsset" ADD COLUMN "contentHash" TEXT;
CREATE INDEX "LogoAsset_shopId_contentHash_idx" ON "LogoAsset"("shopId", "contentHash");

ALTER TABLE "PlacementDefinition" ADD COLUMN "feeCategoryId" TEXT;
CREATE INDEX "PlacementDefinition_feeCategoryId_idx" ON "PlacementDefinition"("feeCategoryId");

-- CreateTable: DesignFeeCategory
CREATE TABLE "DesignFeeCategory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignFeeCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignFeeCategory_methodId_name_key" ON "DesignFeeCategory"("methodId", "name");
CREATE INDEX "DesignFeeCategory_shopId_idx" ON "DesignFeeCategory"("shopId");
CREATE INDEX "DesignFeeCategory_methodId_idx" ON "DesignFeeCategory"("methodId");

ALTER TABLE "DesignFeeCategory" ADD CONSTRAINT "DesignFeeCategory_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignFeeCategory" ADD CONSTRAINT "DesignFeeCategory_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for PlacementDefinition.feeCategoryId
ALTER TABLE "PlacementDefinition" ADD CONSTRAINT "PlacementDefinition_feeCategoryId_fkey"
    FOREIGN KEY ("feeCategoryId") REFERENCES "DesignFeeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CartDesignFeeCharge
CREATE TABLE "CartDesignFeeCharge" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "cartToken" TEXT NOT NULL,
    "logoContentHash" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "feeCentsCharged" INTEGER NOT NULL,
    "shopifyVariantId" TEXT,
    "shopifyLineKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CartDesignFeeCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartDesignFeeCharge_cartToken_logoContentHash_categoryId_methodId_key"
    ON "CartDesignFeeCharge"("cartToken", "logoContentHash", "categoryId", "methodId");
CREATE INDEX "CartDesignFeeCharge_shopId_createdAt_idx"
    ON "CartDesignFeeCharge"("shopId", "createdAt");
CREATE INDEX "CartDesignFeeCharge_cartToken_idx"
    ON "CartDesignFeeCharge"("cartToken");

ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "DesignFeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### 2.4 Backfill plan

**No backfill.** `LogoAsset.contentHash` is nullable. Pre-existing logos predate the feature and never need to trigger a fee — the storefront short-circuits to "no fee" on `contentHash == null`. New uploads from this migration onward populate it. Same posture for `PlacementDefinition.feeCategoryId` — null means "no fee from this zone" forever.

Rationale for `onDelete: Restrict` on `CartDesignFeeCharge.categoryId`: protects audit trail. Merchant who deletes a category mid-flight gets a clear DB error rather than silently orphaning charges; the category-delete admin action will guard against this with a friendly message ("3 active carts use this category — delete blocked").

## 3. Server logic — `app/lib/services/design-fees/`

All files start with `// design-fees:` header line so a future removal is `rm -rf app/lib/services/design-fees`.

### 3.1 `feature-flag.server.ts`
```ts
// design-fees: single source for the env-flag check. ALL design-fees code
// imports from here; nothing else in the app reads DESIGN_FEES_ENABLED.
export function designFeesEnabled(): boolean {
  return process.env.DESIGN_FEES_ENABLED === "true";
}
```
Used by every other module + every UI surface. Branch is mocked in tests via `vi.stubEnv`.

### 3.2 `categories.server.ts`
CRUD for `DesignFeeCategory` plus the placement-mapping helpers. Mirrors style of `app/lib/services/methods.server.ts`.

Functions:
- `listCategoriesForMethod(shopId, methodId): Promise<DesignFeeCategory[]>` — ordered by `displayOrder, name`.
- `listCategoriesForShop(shopId): Promise<DesignFeeCategory[]>`
- `createCategory(shopId, methodId, input: { name, feeCents, displayOrder? })` — validates `methodId` belongs to shop.
- `updateCategory(shopId, categoryId, input)` — partial. Editing `feeCents` does NOT retroactively change existing `CartDesignFeeCharge.feeCentsCharged` (snapshot at charge time, see §10).
- `deleteCategory(shopId, categoryId)` — refuses if any open `CartDesignFeeCharge` references it (FK is `RESTRICT`); admin UI surfaces the count.
- `setPlacementCategory(shopId, placementId, categoryId | null)` — validates the placement is on a view whose product config allows the category's method.
- `getCategoryForPlacement(placementId): Promise<DesignFeeCategory | null>` — shop-scoped read used in `compute.server.ts`.

### 3.3 `compute.server.ts`
Pure decision logic over the cart. Idempotent — never writes outside its own transaction.

```ts
// design-fees: given a draft + cart token, compute which design-fee tuples
// are "first time on this cart" (need to be charged) vs. "already charged".
export type FeeDecision = {
  categoryId: string;
  methodId: string;
  logoContentHash: string;
  alreadyCharged: boolean;        // true → don't add to cart, but show "verrekend"
  feeCentsToCharge: number;       // 0 if alreadyCharged
  category: { id: string; name: string; feeCents: number };
};

export async function computeFeeDecisionsForDraft(args: {
  shopId: string;
  cartToken: string | null;
  draft: { methodId: string; placements: PlacementSelection[]; logoAssetIdsByPlacementId: Record<string, string | null> };
}): Promise<FeeDecision[]>
```

Algorithm:
1. If `!designFeesEnabled()` → return `[]`.
2. If `!cartToken` → return `[]` (storefront never sent token; treat as no fees).
3. Resolve each placement → category (via `PlacementDefinition.feeCategoryId`). Skip placements with no category.
4. For each placement, look up its assigned `LogoAsset` → `contentHash`. Skip if null.
5. Group by `(logoContentHash, categoryId, methodId)` (drops dup zones in same category).
6. For each tuple, query `CartDesignFeeCharge` by `(cartToken, logoContentHash, categoryId, methodId)`. If exists → `alreadyCharged: true, feeCentsToCharge: 0`. Otherwise look up the category to get `feeCents` and return `alreadyCharged: false, feeCentsToCharge: category.feeCents`.

This is called by **both** `/price` (read-only — just for breakdown) and `cart-line.server.ts` at submit time (the call that also persists). Keep it pure (no DB writes); the persistence path is a separate function below.

Add a sibling persistence function:
```ts
// design-fees: insert one row per "to-charge" decision. ON CONFLICT DO NOTHING
// covers the simultaneous-tab race (§10).
export async function persistFeeCharges(
  shopId: string,
  cartToken: string,
  decisions: FeeDecision[],
): Promise<{ persisted: FeeDecision[] }>
```
Implemented with raw SQL `INSERT ... ON CONFLICT (cartToken, logoContentHash, categoryId, methodId) DO NOTHING RETURNING *` so the unique constraint absorbs the race. Returns only the rows that were actually inserted.

### 3.4 `cart-line.server.ts`
**Deep research summary** (see §8 for risk discussion):

The existing fee-product flow (`app/lib/services/variant-pool.server.ts`) creates ONE unlisted product per `(shop × method)` containing ~25 zero-priced slot variants. `/prepare` (`app/lib/services/storefront-prepare.server.ts:111` `ensureVariantPoolExists`) reserves a slot, then writes the per-customization fee price onto its variant via `productVariantsBulkUpdate` (`storefront-prepare.server.ts:301`). The storefront then adds `(garmentVariant, qty) + (slotVariant, qty)` as TWO line items in a single `/cart/add.js` call (`addCustomizedToCart` in `app/lib/storefront/cart.client.ts:77`).

We will **reuse the exact same machinery** for design fees, but with a separate variant pool keyed by method:

- A new helper `ensureDesignFeeVariantSlot(shopId, methodId, feeCents, adminGraphql)`:
  - First-call-ever: creates a new merchant-scoped Shopify product titled `"Insignia Design Fee – {methodName}"` (mirror `app/lib/services/variant-pool.server.ts` `publishProductToOnlineStore` + `ensureVariantsAlwaysPurchasable`).
  - Reuses the existing `VariantSlot` table — design-fee slots get a recognizable distinguisher; simplest is **a new `methodId`-scoped sub-pool** by adding a column `VariantSlot.purpose String @default("CUSTOMIZATION")` (values `"CUSTOMIZATION" | "DESIGN_FEE"`). This keeps churn minimal: cleanup-slots cron, growth, and reservation logic stay identical because the existing `ensureVariantPoolExists` filters by `(shopId, methodId)`. **Decision:** add `purpose` to `VariantSlot` in the same migration. It lives outside `app/lib/services/design-fees/` for tightness with variant-pool but is the only schema change outside the design-fees core.
  - Alternative considered & rejected: minting a fresh Shopify product per design-fee SKU. Cost: an extra Shopify product per merchant × per fee tuple. Reuse of variant-pool is cheaper and has battle-tested elastic growth.

API surface:
```ts
// design-fees: claim a slot variant, set its price to feeCentsToCharge, return the variant id
// for the storefront to send to /cart/add.js alongside the garment line.
export async function reserveDesignFeeSlot(args: {
  shopId: string;
  methodId: string;
  feeCentsToCharge: number;
  adminGraphql: AdminGraphql;
}): Promise<{ shopifyVariantId: string; slotId: string }>;

// design-fees: called from /cart-confirm equivalent path: stamp shopifyLineKey
// onto the matching CartDesignFeeCharge once we know which line lit up.
export async function attachLineKeyToCharge(chargeId: string, lineKey: string): Promise<void>;
```

The storefront receives, in the `/prepare` response payload, a new optional field `designFeeLines: Array<{ chargeId, slotVariantId, feeCentsCharged, categoryName, methodId }>`. The modal then issues one `/cart/add.js` call with `[garment, garmentFee, ...designFeeLines]` items.

Hand-off to `/cart-confirm`: after `addMultipleCustomizedToCart` resolves with the cart, the modal calls a new `/apps/insignia/design-fees/confirm` (or extends the existing `cart-confirm` action) with the cart token + array of `{ chargeId, lineKey }`. Server stamps `shopifyLineKey` on each `CartDesignFeeCharge`. This enables future "remove fee when last referencing line is deleted" behavior — but per locked decisions, removal is deferred (out of scope).

### 3.5 `gc.server.ts`
Periodic cleanup. See §9.
```ts
export async function cleanupStaleDesignFeeCharges(prisma: PrismaClient, opts?: {
  cutoffDays?: number; // default 14
}): Promise<{ deleted: number }>;
```
Pure-function style (mirrors `cleanupStaleDrafts` at `app/lib/services/cron-cleanup.server.ts:74`). Deletes rows where `createdAt < now - 14 days`. Recommendation: do NOT cross-reference Shopify's cart API per row (no public API for "does this token still exist"; admin-side cart API costs scale with shop traffic). 14-day TTL is correct — Shopify's storefront cart cookie expires at 14 days, so any row past that has zero chance of being relevant. Cheap and correct.

### 3.6 Tests under `app/lib/services/design-fees/__tests__/`
- `compute.server.test.ts` — fixture: 2 placements (Borst, Rug) on 2 categories (Klein, Groot), same logo → 2 fees. Same logo + 2 zones same category → 1 fee. Already-charged tuple → `alreadyCharged: true`. Feature-off → `[]`.
- `gc.server.test.ts` — rows older than cutoff are deleted, fresh rows are not.

## 4. Logo SHA256 hashing

Integration point: `app/lib/services/storefront-uploads.server.ts:163` (inside `serverSideStorefrontUpload`, right after `const rawBuffer = Buffer.from(await file.arrayBuffer())`).

```ts
import { createHash } from "crypto";
// ...
const rawBuffer = Buffer.from(await file.arrayBuffer());
// design-fees: hash original bytes BEFORE sharp/sanitization. Identical
// re-uploads of same source file must yield same hash for cross-product fee
// dedup. Hashing failures fail open — see §10 edge cases.
let contentHash: string | null = null;
try {
  contentHash = createHash("sha256").update(rawBuffer).digest("hex");
} catch (e) {
  console.warn("[design-fees] logo hashing failed, continuing with null hash:", e);
}
```

Then thread `contentHash` into the `db.logoAsset.create({ data: { ..., contentHash } })` call at line 212. **Critical**: hash the *raw incoming buffer*, NOT the sanitized SVG string, NOT the post-sharp PNG buffer. Otherwise re-uploading the same SVG (with byte-identical source) would yield different hashes after sanitizer normalization. Document this with an inline comment.

Symmetric change at `completeStorefrontUpload` (line 75) — same hash on `rawBuffer` at line 86.

## 5. Cart-token plumbing

### 5.1 Storefront acquisition
Already available: `window.Shopify.routes.root` is read in `app/lib/storefront/cart.client.ts:13`. Cart token is on the `cart.token` field of the JSON returned by `GET /cart.js` (the same call already used by `getCart()` at `cart.client.ts:30-34`).

Add to `cart.client.ts`:
```ts
// design-fees: returns the active cart token, or null if no cart yet exists.
export async function getCartToken(): Promise<string | null> {
  try {
    const cart = await getCart();
    return (cart as Cart & { token?: string }).token ?? null;
  } catch {
    return null;
  }
}
```

### 5.2 Modal threading
In `app/components/storefront/CustomizationModal.tsx`:
- Add a `cartToken` ref captured early (lazily, via `useEffect` on mount that calls `getCartToken()` once).
- Forward it on every `/apps/insignia/customizations` POST (creates the draft) AND every `/apps/insignia/price` and `/apps/insignia/prepare` call. Three call-sites in `submitOneVariant` (line 740, 826) and `ensureCustomization` (search the file for the customizations POST — earlier in the file, around line 500).
- Body field name: `cartToken: string | null`.

### 5.3 Backend validation
- `app/routes/apps.insignia.price.tsx:58-67` and `apps.insignia.prepare.tsx:58-67`: read `body.cartToken`. Validate format with `/^[a-z0-9_-]{1,64}$/i` (Shopify cart tokens are short hex-like strings; this is forgiving enough). On mismatch → set to null, treat as "no cart token" (silently degrade — design fees just won't deduplicate correctly, but no error path).
- We do NOT call Shopify per-request to verify the token exists — the GC cron lazily invalidates stale rows after 14 days.
- Persist `cartToken` on `CustomizationDraft` (new nullable `cartToken` column? No — keep `CartDesignFeeCharge` as the only design-fees-aware table and pass the token into `compute.server.ts` from the request directly. The draft never needs to know it.) **Simpler:** thread the cart token through the request body all the way down to `computeCustomizationPrice` as a new optional param, pass on to `computeFeeDecisionsForDraft`.

## 6. Storefront UX integration

All UI changes are gated by a new `config.designFees` payload field returned from `GET /apps/insignia/config` (extend `app/lib/services/storefront-config.server.ts`). When the feature is off OR the shop has no categories configured, the loader returns `designFees: null` and the modal short-circuits.

### 6.1 `CustomizationModal.tsx` — running price summary
Around the footer rendering at line 1186 (`renderFooter`), inject a new sub-list before the price line at lines 1203–1212. Pass `priceResult.designFees` (new field) through the existing `PriceResult` type at line 71. UI:
```
Ontwerpkosten Borduren – Klein     €25.00 (eenmalig)
Ontwerpkosten Borduren – Groot     €39.00 (eenmalig)
```
Data source: extend `PriceResult` shape returned from `computeCustomizationPrice` (`app/lib/services/storefront-customizations.server.ts:97-102`) with `designFees: Array<{ categoryName: string; methodName: string; feeCents: number; alreadyCharged: boolean }>`. Already-charged entries render with strikethrough plus the "Ontwerpkosten al verrekend" suffix.

### 6.2 `ReviewStep.tsx` — explicit breakdown line items
Around line 175–179 (inside the `selectedPlacements.map((p) => …)` block, but as a separate section after it). Insert one row per design-fee entry with the same `insignia-review-row` class. Match the visual treatment of the placements: `data-tone="accent"` for to-be-charged, `data-tone="success"` for already-charged. Compute the totals correctly: `priceResult.unitPriceCents` will already include the fee cents (computed in §3.3); per-garment total at line 184 just renders the value.

### 6.3 `PlacementStep.tsx` — sub-label per row
Around line 198–209 (inside the placement row label block, after `insignia-placement-row-view`). For each placement that maps to a fee category, look up the corresponding fee decision from props (new prop `feeDecisionsByPlacementId: Record<string, { feeCents: number; alreadyCharged: boolean }>` — computed by parent from `priceResult.designFees` plus placement→category map). Render:
- Not selected, would-charge: `+€25 eenmalige ontwerpkosten`
- Selected, would-charge: same, but emphasized
- Already charged on this cart: `Ontwerpkosten al verrekend` (success-tone, no euro)

### 6.4 i18n
`app/components/storefront/i18n.ts`: add Dutch (primary) + English (fallback) keys under a new `designFees` namespace:
- `designFees.lineItem` → `"Ontwerpkosten {method} – {category}"` / `"Design fee {method} – {category}"`
- `designFees.oneTime` → `"(eenmalig)"` / `"(one-time)"`
- `designFees.alreadyCharged` → `"Ontwerpkosten al verrekend"` / `"Design fee already covered"`
- `designFees.placementSublabel` → `"+{amount} eenmalige ontwerpkosten"` / `"+{amount} one-time design fee"`

Mirror the existing translation key shape (look at `t.v2.review.*` and `t.v2.placement.*` patterns).

### 6.5 Behavior matrix (feature off)
- `designFeesEnabled() === false` → loader returns `designFees: null` in `/apps/insignia/config`. Modal sees `null`, all three UI sections render zero rows.
- Shop has flag on but **no categories defined** OR **no placement is mapped to a category** → `priceResult.designFees === []`. Same dead-quiet UX.
- No `// design-fees:` UI code paths execute for either case. `displayOrder.length === 0` short-circuit at the top of the new sub-list components.

## 7. Admin UI

### 7.1 Category management — recommendation
**Recommend (a):** Inline section on `app/routes/app.methods.$id.tsx`. Justification:
- Categories are intrinsically scoped to a method; navigating away to a separate page breaks the merchant's mental model ("I'm editing Borduren, why is Klein/Groot somewhere else?").
- The existing page already uses Polaris `BlockStack` + `Card` sections (loader at line 62). Adding a new "Design fee categories" `Card` block fits the pattern of the existing General/Pricing/Artwork-Constraints/Linked-Products sections.
- Keeps removal trivial — it's one block of JSX to delete.
- Gated by `designFeesEnabled()` at the loader: if false, the section is not rendered AND the loader skips fetching the data.

UI: per-category row with `name` text input, `feeCents` text input (euros, mirroring the basePrice pattern at `app.methods.$id.tsx`), `displayOrder` numeric, delete button. "Add category" button at bottom.

Server actions go through a new route `app/routes/api.admin.design-fees.categories.tsx` (POST/PATCH/DELETE) which calls into `categories.server.ts`. The form on the methods page submits to this endpoint via `useFetcher`.

### 7.2 Per-placement category picker
Files: `app/routes/app.products.$id.placements.$placementId.tsx` and `app/routes/app.products.$id.views.$viewId.tsx`.

In `app.products.$id.placements.$placementId.tsx` around line 178 (where `priceTiers` state is initialized), add:
```ts
const [feeCategoryId, setFeeCategoryId] = useState<string | null>(placement.feeCategoryId ?? null);
```
Polaris `Select` component (already imported at line 33), populated from `categories` returned by the loader (loader fetches all categories whose method is in `placement.productView.productConfig.allowedMethods`). First option `"No fee"` with value `""`, then each category `"{methodName} – {categoryName} (€{fee})"`.

Persist via the existing form submit (`handleSave` at line 238): append `formData.append("feeCategoryId", feeCategoryId ?? "")`. Action handler at line 86 reads it, calls `setPlacementCategory(shop.id, placementId, value || null)`.

Same dropdown injected into `app.products.$id.views.$viewId.tsx` per-placement controls (the views aggregator). Look for the inline placement edit panel in that file and add the dropdown next to the existing per-placement name/price fields.

When `designFeesEnabled() === false`, the dropdown does not render. No fallback "feature unavailable" UI.

### 7.3 New admin routes
- `app/routes/api.admin.design-fees.categories.tsx` — POST/PATCH/DELETE on `DesignFeeCategory`. Authenticate via existing `authenticate.admin(request)` pattern at `app.methods.$id.tsx:63`.
- `app/routes/api.admin.design-fees.placement-mapping.tsx` — POST `{ placementId, categoryId | null }`. Optional — could fold into the existing placement-update action instead. Recommend folding to keep the route count down.

## 8. Cart-line mechanism — deep research findings

Reuse of variant-pool is the right call (see §3.4). Key risks surfaced:

- **Tax handling.** Shopify computes tax per line item using the line's product/variant tax class. The design-fee Shopify product will inherit the shop's default tax class; for many EU shops "Borduren digitizing fee" is taxable at the same rate as the garment, which is fine. **Mitigation:** document for merchants in the admin section description, "Design fee variants are taxed at your default rate. If you need a separate tax class, create the design-fee product in Shopify manually and configure it via merchant settings." (Out of scope for v1; flag in Open Questions.)
- **Discount stacking.** If the merchant runs a 10% off cart-wide discount, the €25 fee gets discounted to €22.50. Acceptable per spec — no exclude-from-discounts wiring in v1. Flag in Open Questions whether to mark these variants `requires_shipping: false` and excluded.
- **Refund implications.** Out of scope per locked decision #8, but worth noting: if the customer refunds the garment, the fee line stays. Document for merchant in the admin section helper text.
- **Failure mode: Shopify rejects the additional line.** `addMultipleCustomizedToCart` at `cart.client.ts:123-151` already handles a rejected `/cart/add.js` (throws). The modal already has `submitState: "error"` UX (lines 1329–1345). Failure mode here is identical to existing fee-product failure → existing recovery path covers it. **Edge case:** if the design-fee line specifically fails but the garment line would have succeeded, `/cart/add.js` returns the entire batch as failed (Shopify is all-or-nothing on multi-item add). Customer never lands in a confused state where they're charged for the garment but not the fee, or vice versa.

## 9. GC cron

### 9.1 Endpoint
New file: `app/routes/api.admin.cron.cleanup-design-fee-charges.tsx`. Mirror the structure of `app/routes/api.admin.cron.cleanup-slots.tsx` (see lines 1–30). Body:

```ts
// design-fees: delete CartDesignFeeCharge rows older than 14 days
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import { cleanupStaleDesignFeeCharges } from "../lib/services/design-fees/gc.server";
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  verifyCronToken(request);
  if (!designFeesEnabled()) {
    return Response.json({ deleted: 0, skipped: "feature_disabled", timestamp: new Date().toISOString() });
  }
  const result = await cleanupStaleDesignFeeCharges(db);
  console.log(`[cron/cleanup-design-fee-charges] deleted=${result.deleted}`);
  return Response.json({ ...result, timestamp: new Date().toISOString() });
};
```

### 9.2 Frequency
Hourly is plenty. Aligned with existing `cleanup-drafts` cadence (see `docs/ops/cron-setup.md` lines 21–22).

### 9.3 Logic
14-day cutoff. Recommendation: **time-based, no Shopify lookup**. Justification:
- Shopify storefront cart cookies expire at 14 days. Any row past that is guaranteed-stale.
- Cross-referencing Shopify cart API per row would burn an Admin API call per stale charge per shop per hour — noisy and wasteful.
- The unique constraint guarantees no over-charging if the same cart somehow comes back; if the row was deleted but the cart is still alive (unlikely after 14 days), the worst case is the customer pays the design fee a second time on the next add — same posture as a brand-new cart, which the spec already accepts.

### 9.4 Cron entry
Add to `docs/ops/cron-setup.md` under "Custom/private instance cron" (lines 53–62 in the current file). The public `insignia` deployment doesn't need this (feature off), so put it ONLY in the custom block:

```cron
# Insignia CUSTOM design-fee cleanup
0   * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-design-fee-charges \
               -H "Authorization: Bearer $CRON_SECRET_CUSTOM" | logger -t insignia-custom-cron
```

## 10. Edge cases

1. **Customer customizes, fee added, customer removes the customization mid-modal-session** → Modal session has not yet hit `/cart/add.js`. No `CartDesignFeeCharge` row exists yet. `compute.server.ts` is read-only for `/price`; persistence happens only at `/prepare`-equivalent commit. Behavior: zero rows, zero ghosts. Resolved by not persisting on read-only price calls.
2. **Same logo + same category, two different products in one cart** → `compute.server.ts` step 5 groups by `(logoContentHash, categoryId, methodId)` regardless of product. Second product's prepare call sees `alreadyCharged: true` because the first product's row is in `CartDesignFeeCharge`. Resolved.
3. **Logo X on Borst, then re-customize same product to logo Y on Borst (replacing X)** → The customer abandons the first variant before adding to cart: no row was persisted (see edge case 1), so logo Y is treated as a fresh charge. If the customer DID add the X variant to cart and then customizes a SECOND product with logo Y on Borst: X row stays (it's still in cart), Y gets a new row. Different `logoContentHash` = different unique key. Resolved.
4. **Logo upload fails server-side hashing** → `contentHash = null`. `compute.server.ts` step 4 skips placements with null logo-hash. Result: zero design fees, customer unaffected. Silent fail-open, logged via `console.warn` for ops to notice. Documented in `storefront-uploads.server.ts:163` comment.
5. **Race: simultaneous customization adds, same cart, two tabs** → Both tabs concurrently call `/prepare` (or its successor that persists charges). Both call `persistFeeCharges` with same `(cartToken, hash, category, method)`. Unique constraint at `CartDesignFeeCharge.@@unique([cartToken, logoContentHash, categoryId, methodId])` makes the second insert fail. `INSERT ... ON CONFLICT DO NOTHING` returns the inserted rows; the loser sees `persisted: []`. Loser's `/cart/add.js` includes 0 design-fee lines (correct), winner's includes 1. Both garments end up in cart, fee charged once. Resolved.
6. **Merchant deletes a `DesignFeeCategory` while a charge is open** → FK `RESTRICT` blocks the delete. Admin UI surfaces "N active carts use this category — wait or force-delete." Force-delete (out of scope v1) would cascade-null the placement mapping and orphan the charges. v1: just block.
7. **Customer's cart cookie cleared between price call and prepare call** → New cart token on prepare. `compute.server.ts` re-runs with the new token, sees no prior charges, persists fees fresh. Customer charged correctly for the new cart. Slight UX confusion (the price they saw on review may differ from the cart total) but extremely rare.

## 11. Testing plan

### 11.1 Unit-style (vitest)
- `app/lib/services/design-fees/__tests__/compute.server.test.ts` — fixtures cover: empty cart, first-charge, already-charged, multi-category multi-tuple, feature off, no cart token, null logo hash.
- `__tests__/categories.server.test.ts` — CRUD + delete-blocked-by-charges path.
- `__tests__/gc.server.test.ts` — 14-day cutoff math.
- Hashing: extend `app/lib/services/__tests__/` with a hash determinism test (hash the same buffer twice → same hex; hash differs after one byte flip).

### 11.2 Integration
- Extend `app/lib/services/__tests__/storefront-prepare.server.test.ts` to assert `designFeeLines` field on the prepare response.
- Extend `app/lib/services/__tests__/storefront-cart-confirm.server.test.ts` to cover line-key stamping.
- New `app/lib/services/design-fees/__tests__/end-to-end.test.ts` — full flow: create category, map placement, upload logo, run prepare, assert `CartDesignFeeCharge` row exists; run prepare a second time same cart → no new row.

### 11.3 Regression
A vitest run at the head of CI with `DESIGN_FEES_ENABLED=false` (or unset) — confirm no new rows are written, no new fields are populated on existing-shop fixtures, and existing storefront-prepare/cart-confirm tests pass unchanged.

### 11.4 Manual smoke
Re-run `scripts/repro-ios.mjs` (the iOS Safari repro script per `CLAUDE.md`) on an opt-in dev shop after deploy. Confirm modal renders fee line on iPhone, `/cart/add.js` succeeds, cart page shows the design-fee line item.

## 12. Rollout / risk

- **Migration is additive.** New tables + nullable columns only. Safe under live traffic. Run via existing Prisma migrate flow.
- **Env var stays false on `insignia`.** The public app deployment never gates the feature on; only `insignia-custom` (Stitchs' private instance) sets `DESIGN_FEES_ENABLED=true` in its `.env`.
- **Runtime kill switch.** If the feature blows up in prod on `insignia-custom`: SSH the VPS, flip `DESIGN_FEES_ENABLED=false` in `/srv/saas/infra/stacks/insignia-custom/.env`, `docker-compose restart`. No code rollback. Customer-facing UI surfaces disappear within seconds; existing `CartDesignFeeCharge` rows stay (idle until customers' carts expire and the cron eats them).
- **Removal path.** Documented for posterity:
  1. Drop the cron entry in `docs/ops/cron-setup.md`.
  2. `git rm app/lib/services/design-fees/ app/routes/api.admin.cron.cleanup-design-fee-charges.tsx app/routes/api.admin.design-fees.*`
  3. Grep `// design-fees:` and delete those lines in `CustomizationModal.tsx`, `ReviewStep.tsx`, `PlacementStep.tsx`, `storefront-uploads.server.ts`, `storefront-customizations.server.ts`, `storefront-prepare.server.ts`, `app.methods.$id.tsx`, `app.products.$id.placements.$placementId.tsx`, `app.products.$id.views.$viewId.tsx`, `cart.client.ts`.
  4. New migration: `DROP TABLE "CartDesignFeeCharge"; DROP TABLE "DesignFeeCategory"; ALTER TABLE "LogoAsset" DROP COLUMN "contentHash"; ALTER TABLE "PlacementDefinition" DROP COLUMN "feeCategoryId"; ALTER TABLE "VariantSlot" DROP COLUMN "purpose";`
  5. Remove `DESIGN_FEES_ENABLED` from envs and `env.d.ts`.

  Estimated effort: 30 min mechanical work.

## 14. Locked amendments (override earlier sections where they conflict)

User-approved decisions and reviewer must-fixes folded in. Where this section conflicts with §1–§13, this section wins.

### A. Slot mechanism — separate `DesignFeeSlot` table (overrides §3.4)

**Do NOT add `VariantSlot.purpose`.** Reviewer caught real foot-guns in `cleanupExpiredSlots`, `growVariantPoolToTarget`, `provisionVariantPool`, and `fix-fee-products.server.ts` — all of which filter without `purpose` awareness. Touching them is risky and noisy. Instead create a new, fully independent slot pool just for design fees:

```prisma
model DesignFeeSlot {
  id                String              @id @default(uuid())
  shopId            String
  shopifyProductId  String
  shopifyVariantId  String
  state             DesignFeeSlotState  @default(FREE)
  reservedAt        DateTime?
  reservedUntil     DateTime?
  inCartUntil       DateTime?
  currentChargeId   String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@unique([shopifyVariantId])
  @@index([shopId, state])
}

enum DesignFeeSlotState { FREE  RESERVED  IN_CART }
```

Server module: `app/lib/services/design-fees/slot-pool.server.ts`. Mirrors the structure of `variant-pool.server.ts` but ONLY for design fees. Functions:
- `ensureDesignFeePool(shopId, methodName, adminGraphql)` — first-call creates Shopify product titled `"Insignia Design Fee – {methodName}"`, `requires_shipping: false`, `taxable: true`. Provisions 25 zero-price variants. Mirrors `ensureVariantPoolExists`.
- `reserveDesignFeeSlot(shopId, feeCents, adminGraphql)` — finds FREE slot, sets variant price via `productVariantsBulkUpdate` to feeCents, marks RESERVED with 5-min TTL, returns `{ slotId, shopifyVariantId }`.
- `confirmDesignFeeSlotInCart(slotId, lineKey, chargeId)` — RESERVED → IN_CART, stamps `lineKey` and `currentChargeId`, sets `inCartUntil = now + 30d`.
- `freeDesignFeeSlot(slotId)` — clears price, IN_CART → FREE, drops refs.
- `cleanupExpiredDesignFeeSlots(prisma)` — frees RESERVED past `reservedUntil` or IN_CART past `inCartUntil`.

The new GC cron from §9 invokes both `cleanupStaleDesignFeeCharges` AND `cleanupExpiredDesignFeeSlots`. **Existing variant-pool code is untouched.** The schema has TWO parallel slot pools that never see each other.

Add migration entries for the new model + enum. Drop the `VariantSlot.purpose` line from §2.3.

### B. Auto-removal of fee line in v1 (overrides §13 OQ #3)

Required behavior: when the last cart line referencing `(logoContentHash, categoryId, methodId)` is removed, the corresponding design-fee line is also removed and the `CartDesignFeeCharge` row is deleted.

#### Cart-line property tagging

Every customization-cart-line (the variant slot for a customization, NOT the design-fee slot) gets three NEW line item properties added at `/cart/add.js` time:
- `_insignia_logo_hash`: `<sha256 hex>`
- `_insignia_fee_categories`: comma-separated `categoryId` list (a single line can trigger multiple categories — e.g. logo on Borst + Rug = "klein-uuid,groot-uuid")
- `_insignia_method_id`: `<methodId>`

The design-fee slot variant ALSO gets line item properties:
- `_insignia_design_fee_for_hash`: matching `<sha256 hex>`
- `_insignia_design_fee_category_id`: `<categoryId>`
- `_insignia_design_fee_method_id`: `<methodId>`

These are for cart-sync matching. Already a non-breaking convention — Shopify cart-line properties prefixed with `_` are hidden from order admin display.

#### Sync endpoint

`POST /apps/insignia/design-fees/sync` — new route at `app/routes/apps.insignia.design-fees.sync.tsx`. Authenticates via `appProxy` HMAC. Body: `{ cartToken: string }`.

Server logic:
1. Look up `CartDesignFeeCharge` rows for the token.
2. Fetch the live cart contents via Shopify Storefront Cart API (Admin API also works; pick whichever the existing `cart-confirm.server.ts` already uses).
3. For each charge: scan customization lines for `_insignia_logo_hash == charge.logoContentHash AND _insignia_fee_categories contains charge.categoryId AND _insignia_method_id == charge.methodId`. If zero matches → orphan.
4. For each orphan: remove the design-fee line from cart (find by `_insignia_design_fee_*` properties), free the slot, delete the charge row. All inside one DB transaction; cart removal happens via Shopify cart API.

Response: `{ removed: number, removedLineKeys: string[] }` so the storefront can refresh its UI.

#### Sync trigger points

Three:
1. **Modal post-success** — after every successful customization add, the modal calls sync once. Catches the "customer customized, then in the same modal session decided to remove" flow.
2. **Theme cart-page block** — extend `extensions/insignia-theme/blocks/customize-button.liquid` (or add a new block `cart-sync.liquid`) with an inline `<script>` that on cart-page render fetches the storefront cart token and calls sync.
3. **Cart drawer / mini-cart** — same block subscribes to common Shopify-theme cart-update events (`document.addEventListener('cart:updated', …)` is the Dawn convention; some themes use `cart:refresh` or `cart-update`). Best-effort; not every theme emits these. Document for merchants in admin help text.

#### Race condition (corrected from §10 case 5 + reviewer must-fix #3)

The original plan persisted `CartDesignFeeCharge` rows in `/prepare`. That allowed a row to outlive a failed `/cart/add.js`. Fix:

- `/prepare` response includes a NEW `pendingDesignFeeLines: [{ tempId, slotVariantId, feeCentsCharged, categoryName, methodId, lineProperties }]` (note: `tempId`, not real charge id — generated server-side, ephemeral).
- Storefront calls `/cart/add.js` with garment + customization-fee + design-fee slot variants in one batch.
- On success, storefront calls `/apps/insignia/design-fees/confirm-charges` with `{ cartToken, persistedCharges: [{ tempId, lineKey, slotId }] }`.
- Server PERSISTS the `CartDesignFeeCharge` rows here, ON CONFLICT DO NOTHING. Calls `confirmDesignFeeSlotInCart(slotId, lineKey, chargeId)` for each.
- If `/cart/add.js` fails, storefront calls `/apps/insignia/design-fees/abort-charges` with the slot ids → server frees the slots, no rows persisted.
- If two tabs race to confirm-charges with the same tuple → one ON CONFLICTs (no row inserted) and the loser's design-fee slot now has a duplicate cart line. The confirm-charges response `{ persisted: [...], conflicts: [tempId, ...] }` tells the storefront which slots to remove from cart via `/cart/change.js`. Loser-tab cleanup: free the conflicted slot.

This fully addresses must-fix #3 from the review.

### C. Cart-token threat model (corrects §5.3)

Add this paragraph to §5.3:

> The cart token is a best-effort dedup identity, not a security boundary. A malicious customer who obtained another customer's cart token could send it to the design-fees backend to free-ride on the victim's fee credit. We accept this because (a) cart tokens aren't typically leaked, (b) the attacker must be customizing on the same shop with the same logo and category, (c) the worst-case loss is one waived design fee per stolen token (€25–€39), (d) the merchant's existing chargeback flow handles fraudulent orders. No HMAC binding in v1; revisit only if abuse is observed.

### D. Shopify-product attributes (locks §13 OQ #2)

`ensureDesignFeePool` creates the Shopify product with:
- `requiresShipping: false` — they're not physical goods.
- `taxable: true` — charged at shop default rate; covers NL VAT 21% for Stitchs out of the box.
- `productType: "Service"` (or merchant's preferred type — but never empty, otherwise some Shopify themes treat it weirdly).

### E. PriceResult composition (clarifies §6.1)

`priceResult.unitPriceCents` continues to mean per-garment unit price, NOT including design fees. Design fees are a SEPARATE field on the response: `priceResult.designFees: Array<{ categoryName, methodName, feeCents, alreadyCharged }>`. The modal's footer renders:

```
Subtotaal:        €40.00 (× 50 = €2000)
Ontwerpkosten:    €25.00 (eenmalig)
Totaal:           €2025.00
```

Cart line items: 50× garment at €40 + 50× customization-slot at €0 (price lives elsewhere) + 1× design-fee-slot at €25. Total = €2025. Matches what the modal shows. Modify `priceResult` shape in `storefront-customizations.server.ts` accordingly; existing callers see the new field as optional and ignore it on disabled shops.

### F. i18n — 32 entries (corrects §6.4)

Each of the 4 new keys added to ALL 8 locales (nl, en, de, fr, es, it, pt, pl). For non-Dutch/English: `TODO_TRANSLATE: <english fallback>` (existing convention in `i18n.ts`). Total: 32 string entries.

### G. Test fixture extensions (extends §11)

Existing tests will break unless their mocks are extended:
- `app/lib/services/__tests__/storefront-config.server.test.ts` — add `designFees: null` to mock config payload.
- `app/lib/services/__tests__/storefront-prepare.server.test.ts` (if it exists; create if not) — add `pendingDesignFeeLines: []` to expected `/prepare` response.
- `app/lib/services/__tests__/storefront-cart-confirm.server.test.ts` (if it exists; create if not) — cover the confirm-charges flow.
- `app/components/storefront/__tests__/CustomizationModal.test.tsx` (if exists; otherwise smoke-test in repro-ios.mjs) — confirm UI doesn't break when `designFees: null`.

### H. GC cutoff: 30 days (overrides §9.3)

Bump from 14 → 30 days. Storage is cheap; padding against Shopify-side cart-cookie extension settings (some merchants extend their cart life via `cart_persistence` settings).

### I. Removal-path additions (extends §12)

Add after step 5:
- Step 6: Delete the 32 i18n entries (`designFees.*` namespace) from all 8 locales in `i18n.ts`.
- Step 7: Delete any vitest test files under `app/lib/services/design-fees/__tests__/` AND any extensions to existing test fixtures (the new `designFees: null` lines, etc.).
- Step 8: Drop the new theme block file `extensions/insignia-theme/blocks/cart-sync.liquid` (if added in §B trigger #3).

### J. Hash collision (note added)

SHA-256 hash collision is mathematically negligible; treating two byte-identical files as the same logo is correct and treating two distinct files as the same logo would require a collision attack of cosmological cost. No mitigation needed.

## 13. Open questions

1. **Tax class for design-fee variants.** v1 inherits the shop default. Acceptable for Stitchs (NL VAT 21%), but should we expose a per-method "design fee tax class" override in the admin UI? Recommend: **no for v1**, revisit if a merchant complains.
2. **Should design-fee variants be marked `requires_shipping: false` on the Shopify product?** Recommend: **yes** — they're not physical goods. Single line in `ensureDesignFeeVariantSlot` product creation.
3. **Cart-line removal when last referencing line is deleted.** Locked decisions list this as a tracked field (`CartDesignFeeCharge.shopifyLineKey`) but not as v1 behavior. Confirm: are we OK shipping v1 with the field stamped but no auto-removal logic? The user previously said "Removed automatically when the last cart line referencing that (logo, category) tuple is removed" in the spec — but auto-removal requires polling `/cart.js` or hooking the storefront cart-update events, which is meaningful additional work. Recommend: **defer auto-removal to v1.1**, ship v1 with the line-key plumbing in place so v1.1 is just a hook.
4. **GC cron: live in cleanup-drafts route or new route?** Both work, slight preference to a new route (`api.admin.cron.cleanup-design-fee-charges.tsx`) because it can no-op cleanly when `DESIGN_FEES_ENABLED=false` without changing the always-on cleanup-drafts behavior. Plan above assumes new route.
