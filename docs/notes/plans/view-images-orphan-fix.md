# Plan: View Images Orphan Fix

## 1. Summary

**Bug**: After the merchant deleted some size variants in Shopify admin, view images for non-front views (Achterkant, Zijkant Links, Zijkant Rechts) disappeared on the storefront for many surviving variants. Voorkant survived intact.

**Root cause** (refined from initial hypothesis): Per-variant view uploads via the views editor (`app/routes/app.products.$id.views.$viewId.tsx` action `intent=save-image`, line 325-339) write **exactly one** `VariantViewConfiguration` row keyed to the chosen `variantId`. When the merchant uploaded images for back/side views, they typically uploaded only for the *first size of each color* (the views editor pools by color but the upload action does not fan out). The Voorkant view, by contrast, was populated through the Image Manager's batch flow (`batchSaveImages` in `image-manager.server.ts:195`, called from `auto-assign-from-tray`) which fans `storageKey` across `matchingGroup.variantIds` — so every size of every color got its own VVC row pointing at the shared `imports/<productConfigId>/...` key.

When the merchant later removed sizes in Shopify admin, the *specific size variants* that owned the back-view VVC rows got deleted. Surviving size variants of the same color have no VVC for that view and no `ProductView.defaultImageKey` → storefront returns `imageUrl: null`, `isMissingImage: true`.

**Chosen fix**: Option (d) — **storefront-config color-group fallback**, plus a **one-time recovery script** that backfills the missing VVCs for Stitchs's surviving variants. Total implementation: ~150 LOC + ~80 lines of script + tests.

**Diff size estimate**:
- Storefront-config fallback: ~80 LOC in `storefront-config.server.ts`
- Helper module for color-group lookup: ~50 LOC
- Stitchs recovery script: ~80 LOC
- Unit tests: ~100 LOC
- **Total**: ~310 LOC, no schema changes.

## 2. Root Cause Confirmation

### Did Shopify regenerate variant GIDs?

**No.** Shopify variant GIDs (`gid://shopify/ProductVariant/<numericId>`) are stable identifiers. Removing options/sizes from a product:
- Deletes the variants whose option combinations no longer exist (their GIDs are retired permanently).
- Surviving variants retain their original GIDs.

There is no Shopify behavior where editing options on a product silently re-keys all surviving variants.

**Implication**: Existing VVC rows for surviving variants are still valid and reachable. The bug is **absence** of VVC rows for surviving variants of a color where only one variant ever had the row, plus the deletion of that one variant.

### What got deleted vs. what survives in Stitchs's DB

For each non-front view at Stitchs, the rows where `imageUrl IS NOT NULL` correspond to surviving variants that themselves originally received the upload (typically one per color, hence the 6-7 count = ~6-7 colors). Other VVC rows (84 - 7 = 77) exist (created by `copyGeometryToTargets` and `save-placement-geometry`'s `variantIds` fan-out at line 412-419) but their `imageUrl` is null because they were never uploaded for and the source variant was either deleted or its upload was never propagated.

`upsertVariantViewConfig` only creates a row on explicit save. The 84 rows count matches variant count because geometry was fanned out, but `imageUrl` was not.

## 3. Why Voorkant Survives

**Confirmed**: The Voorkant view was populated through the Image Manager's "Import from Shopify → auto-assign tray" flow, which calls `/api/admin/batch-save-images` with `images: [{ viewId, variantIds: matchingGroup.variantIds, storageKey }]` (see `app.products.$id.images.tsx:633-689`). `batchSaveImages` (`image-manager.server.ts:204-228`) upserts a row for **every variant in the color group**, all pointing at the same `imports/<productConfigId>/...` key.

The key itself is product-config-scoped (`shops/<shopId>/imports/<productConfigId>/<timestamp>-<idx>.<ext>` — `api.admin.import-shopify-images.tsx:176`). It survives variant churn because:
1. It's not in the variant-deleted variant's path namespace.
2. Multiple VVC rows reference it; deleting one variant only orphans its row, not the R2 object.
3. Surviving variants of the same color have their own rows pointing at the same key.

By contrast, the back/side view per-variant uploads at `views.$viewId.tsx:317` use `StorageKeys.viewImage(shopId, viewId, variantId, ...)` → `shops/<shopId>/views/<viewId>/variants/<variantId>/img.<ext>`, with one VVC row pointing at it. When the variant is deleted, the row is dangling and no other variant references that key.

## 4. Chosen Fix Architecture

**Option (d): Storefront-config color-group fallback** at read time.

### Why (d) over the alternatives

| Option | Verdict |
|---|---|
| (a) Auto-set `ProductView.defaultImageKey` on every variant upload | Blunt — picks one image to represent **all** colors. Wrong for multi-color products: a Black variant's image would fall back to Red's default. Doesn't actually fix the bug for the typical case (multi-color shirt). |
| (b) New "ColorGroupViewConfiguration" model | Best long-term but ~600+ LOC: schema, migration, admin UI changes, data migration, storefront read changes. Out of scope. |
| (c) Reactive variant-delete webhook + cloning UX | Reactive only — doesn't help merchants who haven't installed the new webhook scope yet (Stitchs is already broken). Adds merchant UX burden. Worth doing **in addition** to (d) as a follow-up. |
| **(d) Color-group fallback in storefront-config** | ~80 LOC in one read path. Zero schema change. Zero new merchant UX. Zero migration risk. Stitchs's storefront recovers immediately on deploy + recovery script. Generalizes to any future variant churn. |

### Behavior of fix (d)

For each `view` in the storefront-config response, the resolution order becomes:

1. VVC for the requesting `variantId` with non-null `imageUrl` — current behavior.
2. **NEW**: VVC for any other variant in the same **color group** (same value for the color option) for this `productConfigId` + `viewId`, with non-null `imageUrl`. Pick deterministically (earliest by `createdAt`) so the customer sees a consistent image across page loads.
3. `view.defaultImageKey` — current fallback.
4. `null` → `isMissingImage: true`.

The color group is determined from the `selectedOptions` we already fetched from Shopify (`storefront-config.server.ts:194-208`). Reuse the color detection helper or inline a 6-line detector reusing the `COLOR_NAME_RE` regex already at line 243.

## 5. Files to Change

### 5.1 `app/lib/services/storefront-config.server.ts`

**Change locations:**

- **Lines 263-266** (color detection): already detects `colorOptionName`. Keep.
- **Lines 287-301** (sibling variant filtering): already have all sibling variants in `variantNodes` and the selected variant's color. Capture the color value of the selected variant into a local `selectedColorValue: string | null`.
- **Lines 311-321** (VVC fetch): broaden the query. Replace the single `findMany({ where: { productConfigId, variantId } })` with a two-query approach:
  - Q1: VVCs for this variant only (existing, drives geometry resolution).
  - Q2 (new, conditional): if `colorOptionName` and `selectedColorValue` are non-null, fetch VVCs for **all sibling variants of the same color** that have `imageUrl != null`. Use `variantId IN (...)` where the `...` list is built from `variantNodes` filtered to the same color.
- **Lines 327-348** (per-view image resolution): change `rawImageKey` resolution:
  ```
  const rawImageKey =
    vc?.imageUrl
    ?? colorGroupImageByViewId.get(view.id)
    ?? view.defaultImageKey
    ?? null;
  ```
  where `colorGroupImageByViewId` is built from Q2: `Map<viewId, imageKey>`, picking deterministically (sort by `createdAt` ASC, take first).

### 5.2 No mandatory `image-manager.server.ts` change

Optionally export a tiny helper `findColorOption(variants)` that returns just the detected color option name, reusing the existing `COLOR_KEYWORDS` constant. Avoids duplicating the detection logic. Inlining a 6-line color detector in `storefront-config.server.ts` is fine if extracting feels heavy.

### 5.3 No changes needed in:
- `app/routes/app.products.$id.views.$viewId.tsx` — admin behavior is unchanged.
- `app/routes/app.products.$id.images.tsx` — admin behavior is unchanged.
- `prisma/schema.prisma` — no schema change.

## 6. Schema Changes

**None.** The fix is read-side only. Existing `ProductView.defaultImageKey` is not touched (remains a useful merchant-controlled override).

## 7. Storefront-config Plumbing Spec

Inside `getStorefrontConfig` (after line 308, before line 311):

```ts
// Determine selected variant's color value (for color-group fallback).
let selectedColorValue: string | null = null;
let siblingVariantIdsBySameColor: string[] = [];
if (colorOptionName) {
  const selected = allMappedVariants.find((v) => v.id === variantId);
  const colorOpt = selected?.selectedOptions.find((o) => o.name === colorOptionName);
  selectedColorValue = colorOpt?.value ?? null;
  if (selectedColorValue) {
    siblingVariantIdsBySameColor = allMappedVariants
      .filter((v) =>
        v.id !== variantId
        && v.selectedOptions.some((o) => o.name === colorOptionName && o.value === selectedColorValue)
      )
      .map((v) => v.id);
  }
}
```

Lift `allMappedVariants` from inside the `try` block (line 270) to outer scope, OR move the color computation inside the `try` and pass it out via two `let` variables already declared above (preferred, smallest diff).

Then update the `Promise.all` at line 311:

```ts
const [settings, variantViewConfigs, colorGroupVVCs, shopRecord] = await Promise.all([
  getMerchantSettings(shopId),
  db.variantViewConfiguration.findMany({
    where: { productConfigId: config.id, variantId },
    include: { productView: true },
  }),
  siblingVariantIdsBySameColor.length > 0
    ? db.variantViewConfiguration.findMany({
        where: {
          productConfigId: config.id,
          variantId: { in: siblingVariantIdsBySameColor },
          imageUrl: { not: null },
        },
        select: { viewId: true, imageUrl: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : Promise.resolve([] as Array<{ viewId: string; imageUrl: string | null; createdAt: Date }>),
  db.shop.findUnique({ where: { id: shopId }, select: { currencyCode: true } }),
]);

// Build viewId → first-available sibling imageKey
const colorGroupImageByViewId = new Map<string, string>();
for (const vvc of colorGroupVVCs) {
  if (vvc.imageUrl && !colorGroupImageByViewId.has(vvc.viewId)) {
    colorGroupImageByViewId.set(vvc.viewId, vvc.imageUrl);
  }
}
```

Then at line 330:
```ts
const rawImageKey =
  vc?.imageUrl
  ?? colorGroupImageByViewId.get(view.id)
  ?? view.defaultImageKey
  ?? null;
```

**Determinism**: `orderBy: createdAt: "asc"` on Q2 + `Map.set` only on first occurrence guarantees the same sibling image is returned across page loads for the same color.

**Geometry fallback**: Keep geometry resolution variant-only. Color-group geometry sharing is already handled by `view.placementGeometry` + `view.sharedZones`. Don't mix color-group fallback into geometry.

## 8. Recovery for Existing Stitchs Data

Two-pass recovery, idempotent and transactional. App-level script preferred over pure SQL because color metadata lives in Shopify.

### 8.1 Diagnostic query (before/after)

```sql
SELECT pc."shopId", pv.name AS view_name, pv.id AS view_id,
       COUNT(*) AS vvc_total,
       COUNT(vvc."imageUrl") AS vvc_with_image
FROM "VariantViewConfiguration" vvc
JOIN "ProductView" pv ON pv.id = vvc."viewId"
JOIN "ProductConfig" pc ON pc.id = vvc."productConfigId"
WHERE pc."shopId" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab'
GROUP BY pc."shopId", pv.id, pv.name
ORDER BY pv.name;
```

### 8.2 Recovery — `scripts/backfill-color-group-vvc-images.ts`

Pseudocode (~80 LOC):
1. For each `productConfig` belonging to `shopId = 'e300bab6...'`:
   1. Fetch `linkedProductIds`.
   2. Call Shopify Admin GraphQL once per product to get `variants(first: 250) { id, selectedOptions { name, value } }`.
   3. Run `groupVariantsByColor(variants)` from `image-manager.server.ts`.
   4. For each `view` of this productConfig:
      - For each `colorGroup`:
        - Find all VVCs for `(productConfigId, viewId, variantId IN colorGroup.variantIds)`.
        - If at least one has `imageUrl != null`, choose the **earliest by `createdAt`** as the source key.
        - For every variant in `colorGroup.variantIds` lacking an `imageUrl`, `upsert` a VVC row with the source key.
   5. Wrap the per-productConfig loop in a `db.$transaction`.

Idempotent: re-running is a no-op (existing imageUrls aren't overwritten — guard with `WHERE imageUrl IS NULL`).

### 8.3 Acceptance check
After running, the diagnostic query should show `vvc_with_image == vvc_total` for all Stitchs views.

## 9. Edge Cases

1. **Multi-product configs (linked products)**: Storefront-config siblings are within a single Shopify product. Cross-product color matching is a follow-up; same-product fallback is the demonstrated win.

2. **Tray-uploaded shared images**: Stored as VVC `imageUrl` strings; treated identically. No special-casing.

3. **Variants where the color group never had a representative image**: Falls through to `view.defaultImageKey` → null. Current behavior preserved.

4. **`sharedZones=true` vs `false`**: Affects geometry only, not imageUrl. The fix touches imageUrl resolution exclusively. Safe.

5. **Default-Title products** (single-variant): `colorOptionName` null, fallback skipped, behavior unchanged.

6. **Color option named oddly** (e.g., "Farve"): Extend `COLOR_NAME_RE` or add values-based fallback. Stitchs uses Dutch "Kleur", which is in the regex.

7. **Performance**: One additional `findMany` with `variantId IN (15-30 GIDs)`, indexed on `productConfigId`. Trivially cheap.

## 10. Testing Plan

### Unit tests (Vitest, mock Prisma)

`app/lib/services/__tests__/storefront-config.color-fallback.test.ts`:

1. **No fallback when variant has its own image** — variant VVC `imageUrl` wins.
2. **Fallback returns sibling's image when variant has VVC with null imageUrl**.
3. **Fallback returns sibling's image when variant has no VVC at all**.
4. **`view.defaultImageKey` wins when no sibling has an image**.
5. **No color option detected** → fallback skipped, behavior identical to today.
6. **Multiple siblings have images** → deterministic pick (earliest `createdAt`).
7. **Different colors don't cross-contaminate** — Black variant fallback only sees Black siblings, never Red.
8. **Default Title product** — no error, no fallback applied.

### Manual storefront verification (Stitchs)

- Pick 3 surviving Stitchs variants known to be missing back/side images today.
- Note variant GIDs.
- Post-deploy + recovery: hit each variant's product page, confirm Voorkant unchanged, Achterkant/Zijkant Links/Zijkant Rechts now show images consistent with another variant of the same color.
- Inspect Network tab → `/apps/insignia/config` response: every view should have non-null `imageUrl` and `isMissingImage: false`.
- Open a different color, verify it sees its color's image, not the other color's.

### Regression sweep
- Single-variant product (default title) still loads.
- Product with `defaultImageKey` set falls back to it correctly.

## 11. Rollout

1. Land code change (storefront-config.server.ts modification) — purely additive read path. Deploy.
2. Run `scripts/backfill-color-group-vvc-images.ts` against Stitchs: `pnpm tsx scripts/backfill-color-group-vvc-images.ts --shop-id e300bab6-d980-4ec2-9ef2-1067d181aaab`.
3. Verify with diagnostic SQL.
4. Manual storefront check on 2-3 variants per affected product.
5. Optional global backfill for all shops (not strictly necessary — read-time fallback alone makes it work).

**Backout**: revert the storefront-config commit. Recovery script is additive (only writes `imageUrl` where null), so backout is safe.

**Feature flag**: not strictly needed (additive fallback), but if cautious, gate `colorGroupImageByViewId` lookup behind `process.env.STOREFRONT_COLOR_FALLBACK !== "off"`. Default on. ~3 LOC.

## 12.5. Reviewer must-fixes (folded — overrides earlier sections)

### MF-1 (CRITICAL): Color detection MUST be independent of size axis

The current code at `storefront-config.server.ts:263-266` gates color detection behind `!sizeOptionName`:

```ts
if (!sizeOptionName) {
  colorOptionName = firstOptions.find((o) => COLOR_NAME_RE.test(o.name))?.name ?? null;
}
```

Stitchs (the merchant we're fixing for) has both Color **AND** Size axes, so `sizeOptionName` is non-null and `colorOptionName` would stay null. The fix would be a **no-op for Stitchs** as originally written.

**Required change**: detect `colorOptionName` independently, regardless of size detection. The new logic:

```ts
// Detect SIZE axis (existing behavior, unchanged)
const sizeOptionName = firstOptions.find((o) => SIZE_NAME_RE.test(o.name))?.name ?? null;
// Detect COLOR axis independently — needed for color-group image fallback
// even when size is also present.
const colorOptionName = firstOptions.find((o) => COLOR_NAME_RE.test(o.name))?.name ?? null;
```

Both `sizeOptionName` and `colorOptionName` can be set on the same product. The existing size-related logic continues to work; we just stop suppressing color detection.

### MF-2: Replace `pnpm tsx` with the repo's actual tooling

Repo uses **npm** (lockfile `package-lock.json`). `tsx` is not currently a dep. Recovery script invocation must use either:

- **Option A (preferred)**: install `tsx` as devDependency and add an npm script:
  ```json
  "scripts": {
    "backfill:vvc-images": "tsx scripts/backfill-color-group-vvc-images.ts"
  }
  ```
- **Option B (no new dep)**: use a self-bootstrapping `.mjs` entry that does `import("@prisma/client")` and uses raw Shopify Admin API auth via offline session.

Use Option A for clarity. Add `tsx` to devDependencies in the same PR.

### MF-3: Auth context for the recovery script

The recovery script needs to call Shopify Admin GraphQL on Stitchs's behalf. Use the offline session token already stored by `@shopify/shopify-app-react-router`:

```ts
import { unauthenticated } from "../app/shopify.server";

const { admin } = await unauthenticated.admin("stitchs-nl.myshopify.com");
const res = await admin.graphql(query, { variables });
```

This requires the offline session to exist in the DB (it does — the merchant has installed the app). Document this as a precondition: the script will fail loudly if the session is missing.

### MF-4: Add test case for "size axis + color axis BOTH present"

The unit-test list in §10 must include:

> 9. **Both size AND color axes present** — color-group fallback fires correctly. Without MF-1 this test would fail; the test ensures we never re-introduce the regression.

This is the actual Stitchs shape. Without this test, MF-1 could regress.

### MF-5: Image-flicker note

When a source sibling variant is deleted from Shopify, the customer-facing image for surviving variants of that color may *change* (a different sibling becomes the earliest by `createdAt`). This is acceptable but worth a single-line comment in the implementation alongside the `orderBy: createdAt: "asc"` line:

```ts
// Determinism caveat: if the chosen earliest sibling is later deleted,
// the displayed image flips to the next-earliest. Acceptable — better
// than showing a broken image — but worth knowing for support diagnostics.
```

### MF-6 (optional, faster path for Stitchs incident)

The recovery script as planned needs Shopify GraphQL. An alternative for the immediate Stitchs fix is a **pure-SQL recovery** that hardcodes the color groupings discovered by inspecting the existing data once. Trade-off:

- **Pro**: avoids dragging Shopify auth into a recovery flow; runs in ~2 minutes via `psql -f`.
- **Con**: only works for known shops; not generalizable.

**Recommendation**: ship BOTH — the TS script for future general use, AND a one-time `scripts/stitchs-vvc-recovery.sql` that hardcodes the Stitchs color mappings discovered manually. The SQL gets the live site working in minutes; the TS script handles future merchants.

## 13. Open questions (renumbered from 12)

1. **Should this also fall back across `linkedProductIds`** when a config groups multiple Shopify products? Current proposal limits to siblings within the customer-viewed product. Defer.
2. **Should we also implement option (a) — auto-set `defaultImageKey` on first per-variant upload** as belt-and-suspenders? Defer; (d) covers the reported scenario.
3. **Should we subscribe to `productVariants/delete` and warn the merchant**? Reactive UX. Defer to a follow-up ticket.
