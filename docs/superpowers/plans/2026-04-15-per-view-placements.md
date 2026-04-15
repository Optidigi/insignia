# Per-View Placements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PlacementDefinition from per-ProductConfig to per-ProductView so each view has its own set of print areas.

**Architecture:** Add `productViewId` FK to PlacementDefinition (replace `productConfigId`). Migrate existing placements to their first associated view. Update all queries to scope placements by view. Storefront API returns placements filtered per-view with geometry. Admin view editor shows only placements belonging to the current view.

**Tech Stack:** Prisma, PostgreSQL, React Router 7, TypeScript

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Modify | Add `productViewId` FK, remove `productConfigId` FK on PlacementDefinition |
| `prisma/migrations/xxx_per_view_placements/` | Create | Data migration: assign existing placements to first view |
| `app/lib/services/placements.server.ts` | Modify | Change all queries from configId to viewId |
| `app/lib/services/product-configs.server.ts` | Modify | Remove `placements` include from getProductConfig; add per-view placement loading |
| `app/lib/services/storefront-config.server.ts` | Modify | Query placements per-view instead of per-config |
| `app/lib/services/storefront-customizations.server.ts` | Modify | Validate placements exist for the selected view |
| `app/lib/admin-types.ts` | Modify | Update ProductConfig type to not include placements directly |
| `app/routes/app.products.$id.views.$viewId.tsx` | Modify | Load placements from view, pass to ZonePricingPanel |
| `app/routes/app.products.$id._index.tsx` | Modify | Show placements per-view in product detail |
| `app/routes/apps.insignia.config.tsx` | Modify | Filter placements by view in storefront config response |
| `app/routes/app.orders.$id.tsx` | Check | Order snapshots may already have placement data frozen — verify no change needed |

## Tasks

### Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma:245-261`
- Create: `prisma/migrations/..._per_view_placements/migration.sql`

- [ ] **Step 1: Update PlacementDefinition model**

In `prisma/schema.prisma`, change PlacementDefinition:
- Replace `productConfigId String` with `productViewId String`
- Replace `productConfig ProductConfig @relation(...)` with `productView ProductView @relation(...)`
- Update the `@@index`
- Add `placements PlacementDefinition[]` to ProductView model
- Remove `placements PlacementDefinition[]` from ProductConfig model

```prisma
model PlacementDefinition {
  id                      String  @id @default(uuid())
  productViewId           String
  name                    String
  basePriceAdjustmentCents Int     @default(0)
  hidePriceWhenZero       Boolean @default(false)
  defaultStepIndex        Int     @default(0)
  displayOrder            Int     @default(0)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  // Relations
  productView ProductView @relation(fields: [productViewId], references: [id], onDelete: Cascade)
  steps       PlacementStep[]

  @@index([productViewId])
}
```

- [ ] **Step 2: Run prisma validate**

```bash
DATABASE_URL="postgresql://insignia:insignia_dev@localhost:5432/insignia" npx prisma validate
```

Expected: Schema valid

- [ ] **Step 3: Create the migration**

```bash
npx prisma migrate dev --name per_view_placements
```

This will fail because existing data has `productConfigId` but no `productViewId`. We need a custom migration.

- [ ] **Step 4: Edit the generated migration SQL**

The migration SQL needs to:
1. Add `productViewId` column (nullable initially)
2. Populate it: for each placement, find the FIRST view of its config and assign that view's ID
3. Make `productViewId` NOT NULL
4. Drop `productConfigId` column
5. Add foreign key and index

```sql
-- Step 1: Add nullable productViewId
ALTER TABLE "PlacementDefinition" ADD COLUMN "productViewId" TEXT;

-- Step 2: Populate from first view of each config
UPDATE "PlacementDefinition" pd
SET "productViewId" = (
  SELECT pv.id FROM "ProductView" pv
  WHERE pv."productConfigId" = pd."productConfigId"
  ORDER BY pv."displayOrder" ASC, pv."createdAt" ASC
  LIMIT 1
);

-- Step 3: Delete orphaned placements (configs with no views)
DELETE FROM "PlacementDefinition" WHERE "productViewId" IS NULL;

-- Step 4: Make NOT NULL
ALTER TABLE "PlacementDefinition" ALTER COLUMN "productViewId" SET NOT NULL;

-- Step 5: Drop old column and index
DROP INDEX IF EXISTS "PlacementDefinition_productConfigId_idx";
ALTER TABLE "PlacementDefinition" DROP COLUMN "productConfigId";

-- Step 6: Add new FK and index
ALTER TABLE "PlacementDefinition"
  ADD CONSTRAINT "PlacementDefinition_productViewId_fkey"
  FOREIGN KEY ("productViewId") REFERENCES "ProductView"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PlacementDefinition_productViewId_idx" ON "PlacementDefinition"("productViewId");
```

- [ ] **Step 5: Run migration and generate client**

```bash
npx prisma migrate dev
npx prisma generate
```

- [ ] **Step 6: Verify database**

```bash
PGPASSWORD=insignia_dev psql -U insignia -d insignia -c "SELECT pd.id, pd.name, pd.\"productViewId\", pv.name as view_name FROM \"PlacementDefinition\" pd JOIN \"ProductView\" pv ON pd.\"productViewId\" = pv.id;"
```

- [ ] **Step 7: Commit**

```bash
git add prisma/
git commit -m "schema: move PlacementDefinition from per-config to per-view"
```

---

### Task 2: Update Placements Service

**Files:**
- Modify: `app/lib/services/placements.server.ts`

All functions currently take `productConfigId` — change to `productViewId`. The ownership check changes from "config belongs to shop" to "view belongs to shop (via config)".

- [ ] **Step 1: Update ensureViewBelongsToShop helper and all function signatures**

Replace `ensureConfigBelongsToShop` with `ensureViewBelongsToShop`. Update `listPlacements`, `getPlacement`, `createPlacement`, `updatePlacement`, `deletePlacement` to use `productViewId` instead of `productConfigId`.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

This WILL show errors in callers (routes) — that's expected. Fix in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add app/lib/services/placements.server.ts
git commit -m "refactor: placements service uses viewId instead of configId"
```

---

### Task 3: Update product-configs.server.ts

**Files:**
- Modify: `app/lib/services/product-configs.server.ts:68-100`

Remove `placements` from the `getProductConfig` include. Placements now live on views, not configs.

- [ ] **Step 1: Remove placements include from getProductConfig**

In the `include` block, remove:
```
placements: {
  include: { steps: { orderBy: { displayOrder: "asc" } } },
  orderBy: { displayOrder: "asc" },
},
```

Instead, include placements inside the `views` include:
```
views: {
  orderBy: { displayOrder: "asc" },
  include: {
    placements: {
      include: { steps: { orderBy: { displayOrder: "asc" } } },
      orderBy: { displayOrder: "asc" },
    },
  },
},
```

- [ ] **Step 2: Update listProductConfigs similarly**

Add placement counts per view if needed for the product list page.

- [ ] **Step 3: Update cloneLayoutInto if it references placements**

The clone function copies placements — it needs to clone them per-view now.

- [ ] **Step 4: Commit**

```bash
git add app/lib/services/product-configs.server.ts
git commit -m "refactor: getProductConfig loads placements per-view"
```

---

### Task 4: Update View Editor Route

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx`

This is the biggest change. The loader needs to get placements from the current view (not config). The ZonePricingPanel receives only the current view's placements.

- [ ] **Step 1: Update loader to get placements from view**

Change:
```typescript
const [config, view, ...] = await Promise.all([
  getProductConfig(shop.id, configId),
  getView(configId, viewId),
  ...
]);
```

The `view` object now includes `placements` (from the schema change). Use `view.placements` instead of `config.placements`.

- [ ] **Step 2: Update all references from config.placements to view.placements**

In the component: `editorPlacements`, ZonePricingPanel props, placement count checks, etc.

- [ ] **Step 3: Update action handlers**

- `add-placement`: use `viewId` instead of `configId` when calling `createPlacement`
- `delete-placement`: query by `productViewId` instead of `productConfigId`
- `update-placement`, `update-step`, `batch-pricing-update`: ownership check via view

- [ ] **Step 4: Remove placementGeometry from ProductView**

Since placements are now per-view, geometry can be stored directly on PlacementDefinition (as x/y/width/height fields) instead of as a JSON blob on ProductView. However, this is a larger change — for now, keep the JSON geometry on ProductView and reference it by placement ID.

- [ ] **Step 5: Run typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add app/routes/app.products.$id.views.$viewId.tsx
git commit -m "feat: view editor shows per-view placements"
```

---

### Task 5: Update Product Detail Page

**Files:**
- Modify: `app/routes/app.products.$id._index.tsx`

The product detail page shows a "Print areas" section. It needs to show placements grouped by view.

- [ ] **Step 1: Update placement display**

Instead of showing a flat list of `config.placements`, show placements under each view. The data comes from `config.views[].placements[]`.

- [ ] **Step 2: Update placement count in header**

The header shows "2 print areas" — this should now be the total across all views.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.products.$id._index.tsx
git commit -m "feat: product detail shows placements per view"
```

---

### Task 6: Update Storefront Config

**Files:**
- Modify: `app/lib/services/storefront-config.server.ts`

The storefront config endpoint returns placements with `geometryByViewId`. Now placements belong to a specific view, so each view's placements only have geometry for that one view.

- [ ] **Step 1: Update getProductConfigByProductId**

Change the `placements` include to come from `views.placements` instead of top-level `config.placements`.

- [ ] **Step 2: Update the placements mapping**

The `geometryByViewIdForPlacement` function needs to understand that a placement belongs to one view. Its geometry only exists on that view.

- [ ] **Step 3: Update the validation check**

`config.placements.length === 0` → check across all views: `config.views.every(v => v.placements.length === 0)`.

- [ ] **Step 4: Run typecheck + vitest**

```bash
npm run typecheck && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add app/lib/services/storefront-config.server.ts
git commit -m "feat: storefront config returns per-view placements"
```

---

### Task 7: Update Storefront Customizations + Remaining Routes

**Files:**
- Modify: `app/lib/services/storefront-customizations.server.ts`
- Modify: `app/routes/apps.insignia.customizations.tsx`
- Check: `app/routes/app.orders.$id.tsx`

- [ ] **Step 1: Update customization validation**

Placement selections need to reference placements that exist on the relevant views.

- [ ] **Step 2: Check order detail route**

Order snapshots may already have placement data frozen in the geometry snapshot. If so, no change needed.

- [ ] **Step 3: Final typecheck + lint + tests + build**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

All must pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: storefront customizations + orders updated for per-view placements"
```

---

### Task 8: Browser Verification

- [ ] **Step 1: Open view editor, verify each view shows its own placements**
- [ ] **Step 2: Add a placement on Front view — confirm it does NOT appear on Back view**
- [ ] **Step 3: Delete a placement — confirm it's removed from that view only**
- [ ] **Step 4: Test storefront modal — confirm placements show for the relevant view**
