# Insignia V2 — Complete Implementation Plan

> **STATUS: PARTIALLY EXECUTED.** Phases 0-8 largely done. Remaining gaps tracked in `2026-04-07-v2-completion.md` and the definitive gap report in memory.

> **Scale:** 11 phases, 51 tasks, ~275 steps. Each phase produces working, testable software.

**Goal:** Implement all V2 features from design canvas to working code — schema migrations, backend services, API endpoints, admin UI (React Router 7 + Polaris), storefront changes, and theme extension updates — with zero gaps between design and code.

**Architecture:** Schema-first foundation, then vertical slices per feature. Each slice touches all layers (schema → service → route → component → storefront). The storefront config contract (`StorefrontConfig` type in `storefront-config.server.ts`) is the integration boundary between admin and storefront — every admin change that adds data must update this contract and the storefront consumer.

**Tech Stack:** React Router 7 (Remix) | Shopify Polaris v13 | Prisma + PostgreSQL | Sharp (image processing) | Konva (2D canvas) | R2/S3 (storage) | TypeScript (strict)

**Verification after every task:**
```bash
npm run typecheck    # Must pass (new errors = fix immediately)
npm run lint         # Must pass
npx prisma validate  # After any schema change
```

---

## Phase Dependency Diagram

```
Phase 0: Schema Foundation
    ↓
Phase 1: Shared Infrastructure (batch upload services)
    ↓           ↓
Phase 2:     Phase 3:
Methods      Image Manager
    ↓           ↓
    ↓       Phase 4: View Editor Merge
    ↓           ↓
    └───→ Phase 5: Product Detail ←───┘
              ↓
         Phase 6: Settings (independent, can parallel with 5)
              ↓
         Phase 7: Dashboard
              ↓
         Phase 8: Storefront & Integration
```

---

## Complete File Map

### Files to CREATE

| File | Purpose |
|------|---------|
| `prisma/migrations/2026XXXX_v2_schema/migration.sql` | All V2 schema additions |
| `app/lib/services/image-manager.server.ts` | Batch image upload, Shopify import, view defaults |
| `app/routes/api.admin.batch-upload-urls.tsx` | Batch presigned URL generation |
| `app/routes/api.admin.batch-save-images.tsx` | Batch VariantViewConfiguration upsert |
| `app/routes/api.admin.import-shopify-images.tsx` | Pull variant images from Shopify |
| `app/routes/app.products.$id.images.tsx` | Image Manager page (NEW route) |
| `app/components/ImageTray.tsx` | Drag-source staging tray component |
| `app/components/ImageMatrix.tsx` | Color-group card list with view tabs |
| `app/components/ZonePricingPanel.tsx` | Inline zone pricing accordion for View Editor |
| `app/routes/apps.insignia.uploads.$id.refresh.tsx` | Refresh presigned URLs for logo assets |

### Files to MODIFY

| File | What changes |
|------|-------------|
| `prisma/schema.prisma` | Add fields to ProductView, DecorationMethod; add index to VariantViewConfiguration |
| `app/lib/services/methods.server.ts` | CRUD for new fields (description, customerName, artworkConstraints) |
| `app/lib/services/views.server.ts` | View default image, batch image operations, color grouping |
| `app/lib/services/placements.server.ts` | Expose placement data for inline editing (used by View Editor) |
| `app/lib/services/storefront-config.server.ts` | Add method description/customerName to StorefrontConfig |
| `app/routes/app.methods.$id.tsx` | Redesign as AnnotatedSection with all new fields |
| `app/routes/app.methods._index.tsx` | Already has base price + product count; verify |
| `app/routes/app.products.$id._index.tsx` | Per-view rows, remove storefront card, SaveBar |
| `app/routes/app.products.$id.views.$viewId.tsx` | Merge placement pricing into right panel, shared-zone toggle |
| `app/routes/app._index.tsx` | Onboarding wizard for first-time merchants |
| `app/routes/app.settings.tsx` | General tab with theme integration + placeholder logo |
| `app/routes/app.orders.$id.tsx` | Status banner, workflow steps, remove inch-based position |
| `app/components/storefront/CustomizationModal.tsx` | localStorage draft, method description display |
| `app/components/storefront/UploadStep.tsx` | Artwork re-upload (don't hide uploader), method constraints |
| `app/components/storefront/SizeStep.tsx` | "Logo size" header, single-size auto-skip |
| `app/components/storefront/PlacementStep.tsx` | Single-placement auto-select |
| `app/components/storefront/ReviewStep.tsx` | "Estimated total" label |
| `app/routes/app.products._index.tsx` | Resource Picker + auto-navigate after creation |
| `app/routes/app.orders.$id.tsx` | Status banner, workflow steps, remove position row |
| `app/components/PlacementGeometryEditor.tsx` | Replace raw HTML with Polaris components |
| `extensions/insignia-theme/blocks/*.liquid` | Terminology updates if any |

### Files to DELETE (after merge)

| File | Reason |
|------|--------|
| `app/routes/app.products.$id.placements.$placementId.tsx` | Merged into View Editor |
| `app/routes/app.products.$id.placements.tsx` | Layout route no longer needed |

---

## Phase 0: Schema Foundation

**Purpose:** Add all new fields and indexes in a single migration. Nullable fields with no defaults — existing code keeps working unchanged.

### Task 0.1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/2026XXXX_v2_schema_additions/migration.sql`

- [ ] **Step 1: Add fields to DecorationMethod**

In `prisma/schema.prisma`, add to the `DecorationMethod` model after `basePriceCents`:

```prisma
model DecorationMethod {
  id                  String   @id @default(uuid())
  shopId              String
  name                String
  basePriceCents      Int      @default(0)
  description         String?              // NEW: merchant-facing notes
  customerName        String?              // NEW: storefront display name
  customerDescription String?              // NEW: storefront method selector text
  artworkConstraints  Json?               // NEW: { fileTypes: string[], maxColors: number, minDpi: number }
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  // ... relations unchanged
}
```

- [ ] **Step 2: Add `defaultImageKey` to ProductView**

```prisma
model ProductView {
  id              String          @id @default(uuid())
  productConfigId String
  perspective     ViewPerspective
  displayOrder    Int             @default(0)
  defaultImageKey String?         // NEW: R2 key for view-level default image
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  // ... relations unchanged
}
```

- [ ] **Step 3: Add compound index to VariantViewConfiguration**

```prisma
model VariantViewConfiguration {
  // ... all existing fields unchanged

  @@unique([productConfigId, variantId, viewId])
  @@index([productConfigId])
  @@index([variantId])
  @@index([productConfigId, viewId])  // NEW: efficient batch view queries
}
```

- [ ] **Step 4: Run the migration**

```bash
npx prisma migrate dev --name v2_schema_additions
```

Expected output: Migration created and applied. All existing data preserved.

- [ ] **Step 5: Validate and verify**

```bash
npx prisma validate
npm run typecheck
```

Both must pass. The new nullable fields don't affect existing code.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add V2 fields — method description/constraints, view defaultImageKey, batch index"
```

---

## Phase 1: Shared Infrastructure

**Purpose:** Build the backend services that multiple screens depend on.

### Task 1.1: Image Manager Service

**Files:**
- Create: `app/lib/services/image-manager.server.ts`

- [ ] **Step 1: Create the service file with types**

```typescript
/**
 * Image Manager Service
 *
 * Handles batch image operations for the Image Manager screen:
 * - Color group derivation from Shopify variant options
 * - Batch presigned URL generation
 * - Batch VariantViewConfiguration upsert
 * - Shopify variant image import
 * - View default image management
 */

import db from "../../db.server";
import { getPresignedPutUrl, getPresignedGetUrl, putObject, getObjectBody } from "../storage.server";

// ---------- Types ----------

export type ColorGroup = {
  colorValue: string;
  colorOptionName: string;
  variantIds: string[];
  representativeVariantId: string;
};

export type ImageCell = {
  colorValue: string;
  viewId: string;
  variantIds: string[];
  imageUrl: string | null;
  isDefault: boolean; // true = inherited from ProductView.defaultImageKey
};

export type BatchUploadUrlItem = {
  viewId: string;
  variantId: string;
  contentType: string;
  fileName: string;
};

export type BatchUploadUrlResult = {
  viewId: string;
  variantId: string;
  uploadUrl: string;
  storageKey: string;
};

export type BatchSaveImageItem = {
  viewId: string;
  variantIds: string[];
  storageKey: string;
};
```

- [ ] **Step 2: Implement color grouping**

```typescript
/**
 * Group Shopify variants by their color option value.
 * Detects the color option by name ("Color", "Colour", "Kleur") or falls back to
 * the option with the most unique values.
 */
export function groupVariantsByColor(
  variants: Array<{
    id: string;
    selectedOptions: Array<{ name: string; value: string }>;
  }>
): ColorGroup[] {
  // Find the color-like option
  const optionNames = new Set<string>();
  const optionValueCounts: Record<string, Set<string>> = {};

  for (const v of variants) {
    for (const opt of v.selectedOptions) {
      optionNames.add(opt.name);
      if (!optionValueCounts[opt.name]) optionValueCounts[opt.name] = new Set();
      optionValueCounts[opt.name].add(opt.value);
    }
  }

  const colorKeywords = ["color", "colour", "kleur", "farbe", "couleur"];
  let colorOptionName = Array.from(optionNames).find((n) =>
    colorKeywords.some((k) => n.toLowerCase().includes(k))
  );

  // Fallback: option with most unique values
  if (!colorOptionName) {
    colorOptionName = Object.entries(optionValueCounts)
      .sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  }

  if (!colorOptionName) {
    // Single variant, no options — return one group
    return [
      {
        colorValue: "Default",
        colorOptionName: "",
        variantIds: variants.map((v) => v.id),
        representativeVariantId: variants[0]?.id ?? "",
      },
    ];
  }

  // Group by color value
  const groups: Record<string, string[]> = {};
  for (const v of variants) {
    const colorOpt = v.selectedOptions.find((o) => o.name === colorOptionName);
    const value = colorOpt?.value ?? "Default";
    if (!groups[value]) groups[value] = [];
    groups[value].push(v.id);
  }

  return Object.entries(groups).map(([colorValue, variantIds]) => ({
    colorValue,
    colorOptionName: colorOptionName!,
    variantIds,
    representativeVariantId: variantIds[0],
  }));
}
```

- [ ] **Step 3: Implement batch presigned URL generation**

```typescript
/**
 * Generate presigned PUT URLs for multiple image uploads in one call.
 */
export async function batchGetUploadUrls(
  shopId: string,
  items: BatchUploadUrlItem[]
): Promise<BatchUploadUrlResult[]> {
  const results: BatchUploadUrlResult[] = [];

  for (const item of items) {
    const ext = item.fileName.split(".").pop() || "jpg";
    const storageKey = `shops/${shopId}/views/${item.viewId}/variants/${item.variantId}/view-image.${ext}`;
    const uploadUrl = await getPresignedPutUrl(storageKey, item.contentType, 300);

    results.push({
      viewId: item.viewId,
      variantId: item.variantId,
      uploadUrl,
      storageKey,
    });
  }

  return results;
}
```

- [ ] **Step 4: Implement batch save images**

```typescript
/**
 * Upsert multiple VariantViewConfigurations in a single transaction.
 * Each item can target multiple variantIds (color group → all size variants).
 */
export async function batchSaveImages(
  productConfigId: string,
  images: BatchSaveImageItem[]
): Promise<number> {
  let count = 0;

  await db.$transaction(async (tx) => {
    for (const img of images) {
      for (const variantId of img.variantIds) {
        await tx.variantViewConfiguration.upsert({
          where: {
            productConfigId_variantId_viewId: {
              productConfigId,
              variantId,
              viewId: img.viewId,
            },
          },
          create: {
            productConfigId,
            variantId,
            viewId: img.viewId,
            imageUrl: img.storageKey,
          },
          update: {
            imageUrl: img.storageKey,
          },
        });
        count++;
      }
    }
  });

  return count;
}
```

- [ ] **Step 5: Implement set view default**

```typescript
/**
 * Set the default image for a ProductView.
 * Variants without explicit images will fall back to this.
 */
export async function setViewDefault(
  viewId: string,
  storageKey: string
): Promise<void> {
  await db.productView.update({
    where: { id: viewId },
    data: { defaultImageKey: storageKey },
  });
}

/**
 * Get the complete image matrix for a product config.
 * Returns cells with resolved image URLs (explicit or default fallback).
 */
export async function getImageMatrix(
  productConfigId: string,
  views: Array<{ id: string; perspective: string; defaultImageKey: string | null }>,
  colorGroups: ColorGroup[]
): Promise<ImageCell[]> {
  const configs = await db.variantViewConfiguration.findMany({
    where: { productConfigId },
    select: { variantId: true, viewId: true, imageUrl: true },
  });

  const configMap = new Map<string, string | null>();
  for (const c of configs) {
    configMap.set(`${c.variantId}:${c.viewId}`, c.imageUrl);
  }

  const cells: ImageCell[] = [];

  for (const group of colorGroups) {
    for (const view of views) {
      const repVarId = group.representativeVariantId;
      const explicit = configMap.get(`${repVarId}:${view.id}`);
      const isDefault = !explicit && !!view.defaultImageKey;
      const imageUrl = explicit || view.defaultImageKey;

      cells.push({
        colorValue: group.colorValue,
        viewId: view.id,
        variantIds: group.variantIds,
        imageUrl,
        isDefault,
      });
    }
  }

  return cells;
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/image-manager.server.ts
git commit -m "feat: add image manager service — color grouping, batch uploads, view defaults"
```

### Task 1.2: Batch Upload API Endpoints

**Files:**
- Create: `app/routes/api.admin.batch-upload-urls.tsx`
- Create: `app/routes/api.admin.batch-save-images.tsx`
- Create: `app/routes/api.admin.import-shopify-images.tsx`

- [ ] **Step 1: Create batch-upload-urls endpoint**

```typescript
// app/routes/api.admin.batch-upload-urls.tsx
import type { ActionFunctionArgs } from "react-router";
import { json } from "react-router";
import { authenticate } from "../shopify.server";
import { batchGetUploadUrls } from "../lib/services/image-manager.server";
import type { BatchUploadUrlItem } from "../lib/services/image-manager.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const body = await request.json();
  const { productConfigId, items } = body as {
    productConfigId: string;
    items: BatchUploadUrlItem[];
  };

  if (!productConfigId || !items?.length) {
    return json({ error: { message: "Missing productConfigId or items", code: "INVALID_INPUT" } }, { status: 400 });
  }

  if (items.length > 50) {
    return json({ error: { message: "Maximum 50 items per batch", code: "BATCH_TOO_LARGE" } }, { status: 400 });
  }

  // Verify the product config belongs to this shop
  const config = await (await import("../db.server")).default.productConfig.findFirst({
    where: { id: productConfigId, shopId },
    select: { id: true },
  });
  if (!config) {
    return json({ error: { message: "Product config not found", code: "NOT_FOUND" } }, { status: 404 });
  }

  const results = await batchGetUploadUrls(shopId, items);
  return json({ items: results });
};
```

- [ ] **Step 2: Create batch-save-images endpoint**

```typescript
// app/routes/api.admin.batch-save-images.tsx
import type { ActionFunctionArgs } from "react-router";
import { json } from "react-router";
import { authenticate } from "../shopify.server";
import { batchSaveImages } from "../lib/services/image-manager.server";
import type { BatchSaveImageItem } from "../lib/services/image-manager.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const body = await request.json();
  const { productConfigId, images } = body as {
    productConfigId: string;
    images: BatchSaveImageItem[];
  };

  if (!productConfigId || !images?.length) {
    return json({ error: { message: "Missing productConfigId or images", code: "INVALID_INPUT" } }, { status: 400 });
  }

  // Verify ownership
  const config = await (await import("../db.server")).default.productConfig.findFirst({
    where: { id: productConfigId, shopId },
    select: { id: true },
  });
  if (!config) {
    return json({ error: { message: "Product config not found", code: "NOT_FOUND" } }, { status: 404 });
  }

  const count = await batchSaveImages(productConfigId, images);
  return json({ saved: count });
};
```

- [ ] **Step 3: Create import-shopify-images endpoint**

```typescript
// app/routes/api.admin.import-shopify-images.tsx
import type { ActionFunctionArgs } from "react-router";
import { json } from "react-router";
import { authenticate } from "../shopify.server";
import { putObject } from "../lib/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  const body = await request.json();
  const { productConfigId, shopifyProductId } = body as {
    productConfigId: string;
    shopifyProductId: string;
  };

  if (!productConfigId || !shopifyProductId) {
    return json({ error: { message: "Missing required fields", code: "INVALID_INPUT" } }, { status: 400 });
  }

  // Query Shopify for variant media
  const response = await admin.graphql(
    `#graphql
    query GetVariantMedia($productId: ID!) {
      product(id: $productId) {
        variants(first: 100) {
          nodes {
            id
            selectedOptions { name value }
            media(first: 10) {
              nodes {
                ... on MediaImage {
                  image {
                    url
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { productId: shopifyProductId } }
  );

  const data = await response.json();
  const variants = data.data?.product?.variants?.nodes ?? [];

  // Collect unique images (deduplicate by URL)
  const seenUrls = new Set<string>();
  const importedImages: Array<{
    variantId: string;
    colorOption: string;
    originalUrl: string;
    storageKey: string;
  }> = [];

  for (const variant of variants) {
    for (const media of variant.media?.nodes ?? []) {
      const url = media.image?.url;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Download and store in R2
      const imageResponse = await fetch(url);
      if (!imageResponse.ok) continue;
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      const ext = url.includes(".png") ? "png" : "jpg";
      const key = `shops/${shopId}/imports/${productConfigId}/${Date.now()}-${importedImages.length}.${ext}`;

      await putObject(key, buffer, `image/${ext === "png" ? "png" : "jpeg"}`);

      const colorOpt = variant.selectedOptions?.find(
        (o: { name: string }) => o.name.toLowerCase().includes("color")
      );

      importedImages.push({
        variantId: variant.id,
        colorOption: colorOpt?.value ?? "Default",
        originalUrl: url,
        storageKey: key,
      });
    }
  }

  return json({ imported: importedImages });
};
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/api.admin.batch-upload-urls.tsx app/routes/api.admin.batch-save-images.tsx app/routes/api.admin.import-shopify-images.tsx
git commit -m "feat: add batch image API endpoints — upload URLs, save images, Shopify import"
```

### Task 1.3: Update Methods Service for New Fields

**Files:**
- Modify: `app/lib/services/methods.server.ts`

- [ ] **Step 1: Read the current methods service**

Read `app/lib/services/methods.server.ts` to understand the current CRUD functions. Look for `createMethod`, `updateMethod`, `getMethod`, `deleteMethod`.

- [ ] **Step 2: Update the create/update functions to accept new fields**

Add `description`, `customerName`, `customerDescription`, `artworkConstraints` to both create and update inputs. Use Zod for validation:

```typescript
import { z } from "zod";

const artworkConstraintsSchema = z.object({
  fileTypes: z.array(z.enum(["svg", "png", "jpg", "webp", "gif", "tiff", "heic", "pdf", "ai", "eps"])),
  maxColors: z.number().int().min(1).max(100).optional(),
  minDpi: z.number().int().min(72).max(1200).optional(),
}).optional();

const methodCreateSchema = z.object({
  name: z.string().min(1).max(100),
  basePriceCents: z.number().int().min(0).optional(),
  description: z.string().max(500).optional(),
  customerName: z.string().max(100).optional(),
  customerDescription: z.string().max(300).optional(),
  artworkConstraints: artworkConstraintsSchema,
});

const methodUpdateSchema = methodCreateSchema.partial().extend({
  id: z.string().uuid(),
});
```

Update the `createMethod` and `updateMethod` functions to pass through the new fields to Prisma.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/methods.server.ts
git commit -m "feat(methods): support description, customerName, customerDescription, artworkConstraints"
```

---

## Phase 2: Methods Detail Redesign

**Purpose:** Redesign the Method Detail page to AnnotatedSection layout with all new fields.

### Task 2.1: Method Detail — AnnotatedSection Layout

**Files:**
- Modify: `app/routes/app.methods.$id.tsx`

- [ ] **Step 1: Read the current route**

Read the full file. Note: it currently has a single `TextField` for name and a delete section. The loader fetches the method by ID. The action handles `update` and `delete` intents.

- [ ] **Step 2: Update the loader to return all new fields**

The loader should select all new fields from the method:

```typescript
const method = await db.decorationMethod.findUnique({
  where: { id: methodId },
  include: {
    productConfigs: {
      include: {
        productConfig: { select: { id: true, name: true } },
      },
    },
  },
});
```

This also fetches linked product configs for the "Linked Products" section.

- [ ] **Step 3: Update the action to handle new fields**

Add `description`, `customerName`, `customerDescription`, `basePriceCents`, and `artworkConstraints` to the `update` intent handler.

```typescript
if (intent === "update") {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;
  const customerName = formData.get("customerName") as string | null;
  const customerDescription = formData.get("customerDescription") as string | null;
  const basePriceCents = parseInt(formData.get("basePriceCents") as string, 10) || 0;
  const artworkConstraintsRaw = formData.get("artworkConstraints") as string | null;
  const artworkConstraints = artworkConstraintsRaw ? JSON.parse(artworkConstraintsRaw) : undefined;

  await updateMethod({
    id: methodId,
    name,
    description: description || undefined,
    customerName: customerName || undefined,
    customerDescription: customerDescription || undefined,
    basePriceCents,
    artworkConstraints,
  });

  return { success: true, intent: "update" };
}
```

- [ ] **Step 4: Rebuild the component with AnnotatedSection layout**

Replace the single-field form with a Polaris `Layout` using `Layout.AnnotatedSection` for each section. Follow the pattern from `app/routes/app.settings.tsx`.

**Sections:**
1. **General**: name, description (textarea), customer-facing name
2. **Pricing**: basePriceCents (currency input)
3. **Artwork Constraints**: file type checkboxes, maxColors number input, minDpi number input
4. **Linked Products**: read-only list of product config names with links
5. **Delete**: destructive action

Each section uses:
```tsx
<Layout.AnnotatedSection
  title="General"
  description="Name and description for this decoration method."
>
  <Card>
    <BlockStack gap="400">
      <TextField label="Name" value={name} onChange={setName} autoComplete="off" />
      <TextField
        label="Description"
        value={description}
        onChange={setDescription}
        multiline={3}
        autoComplete="off"
        helpText="Merchant-facing notes about this method"
      />
      <TextField
        label="Customer-facing name"
        value={customerName}
        onChange={setCustomerName}
        autoComplete="off"
        helpText="Shown on the storefront method selector. Falls back to name if empty."
      />
    </BlockStack>
  </Card>
</Layout.AnnotatedSection>
```

**UI States:**
- **Loading**: Polaris `SkeletonPage` with `SkeletonBodyText` in each section
- **Error** (method not found): `Banner tone="critical"` with "Method not found" + back link
- **Saving**: `contextualSaveBar` visible, primary action loading
- **Delete confirmation**: Polaris `Modal` with destructive action

- [ ] **Step 5: Add Shopify SaveBar**

```tsx
useEffect(() => {
  const saveBar = (window as any).shopify?.saveBar;
  if (hasChanges) {
    saveBar?.show("method-save-bar");
  } else {
    saveBar?.hide("method-save-bar");
  }
  return () => saveBar?.hide("method-save-bar");
}, [hasChanges]);
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/app.methods.$id.tsx
git commit -m "feat(methods): redesign detail page with AnnotatedSection — description, pricing, constraints, linked products"
```

### Task 2.2: Update Storefront Config for Method Fields

**Files:**
- Modify: `app/lib/services/storefront-config.server.ts`

- [ ] **Step 1: Add new fields to DecorationMethodRef type**

```typescript
export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  customerName: string | null;      // NEW
  customerDescription: string | null; // NEW
};
```

- [ ] **Step 2: Update the config builder to include new fields**

In the function that builds `StorefrontConfig`, update the methods mapping:

```typescript
methods: config.allowedMethods.map((am) => ({
  id: am.decorationMethod.id,
  name: am.decorationMethod.name,
  basePriceCents: am.decorationMethod.basePriceCents,
  customerName: am.decorationMethod.customerName,
  customerDescription: am.decorationMethod.customerDescription,
})),
```

- [ ] **Step 3: Update storefront UploadStep to show method descriptions**

In `app/components/storefront/UploadStep.tsx`, when rendering method pills/selector, display `customerName` (fallback to `name`) and show `customerDescription` as helper text.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/storefront-config.server.ts app/components/storefront/UploadStep.tsx
git commit -m "feat: add method customerName/description to storefront config and method selector"
```

---

## Phase 3: Image Manager

**Purpose:** Build the complete Image Manager page — the new route with view tabs, image tray, color group cards, and all interactions.

### Task 3.1: Image Manager Route — Loader

**Files:**
- Create: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Create the route with loader**

The loader needs:
1. Product config with views
2. Shopify variants (via GraphQL) for color grouping
3. Existing VariantViewConfigurations for image data
4. The image matrix (cells with resolved URLs)

```typescript
import type { LoaderFunctionArgs } from "react-router";
import { json } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { groupVariantsByColor, getImageMatrix } from "../lib/services/image-manager.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const productConfigId = params.id!;

  // Fetch product config with views
  const config = await db.productConfig.findFirst({
    where: { id: productConfigId, shopId: session.shop },
    include: {
      views: { orderBy: { displayOrder: "asc" } },
    },
  });

  if (!config) throw new Response("Not found", { status: 404 });

  // Fetch variants from Shopify for color grouping
  const shopifyProductId = config.linkedProductIds[0];
  if (!shopifyProductId) {
    return json({ config, views: config.views, colorGroups: [], cells: [], viewImageCounts: {} });
  }

  const response = await admin.graphql(
    `#graphql
    query GetVariants($productId: ID!) {
      product(id: $productId) {
        variants(first: 100) {
          nodes {
            id
            selectedOptions { name value }
          }
        }
      }
    }`,
    { variables: { productId: shopifyProductId } }
  );

  const data = await response.json();
  const variants = data.data?.product?.variants?.nodes ?? [];
  const colorGroups = groupVariantsByColor(variants);
  const cells = await getImageMatrix(productConfigId, config.views, colorGroups);

  // Compute per-view image counts for tabs
  const viewImageCounts: Record<string, { filled: number; total: number }> = {};
  for (const view of config.views) {
    const viewCells = cells.filter((c) => c.viewId === view.id);
    viewImageCounts[view.id] = {
      filled: viewCells.filter((c) => c.imageUrl !== null).length,
      total: viewCells.length,
    };
  }

  return json({ config, views: config.views, colorGroups, cells, viewImageCounts });
};
```

- [ ] **Step 2: Verify loader compiles**

```bash
npm run typecheck
```

### Task 3.2: Image Manager Route — Action

- [ ] **Step 1: Add action handler with intents**

```typescript
import type { ActionFunctionArgs } from "react-router";
import { setViewDefault } from "../lib/services/image-manager.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-view-default") {
    const viewId = formData.get("viewId") as string;
    const storageKey = formData.get("storageKey") as string;
    await setViewDefault(viewId, storageKey);
    return json({ success: true, intent: "set-view-default" });
  }

  if (intent === "save-image") {
    const viewId = formData.get("viewId") as string;
    const variantId = formData.get("variantId") as string;
    const imageKey = formData.get("imageKey") as string;
    const productConfigId = params.id!;

    await db.variantViewConfiguration.upsert({
      where: {
        productConfigId_variantId_viewId: { productConfigId, variantId, viewId },
      },
      create: { productConfigId, variantId, viewId, imageUrl: imageKey },
      update: { imageUrl: imageKey },
    });
    return json({ success: true, intent: "save-image" });
  }

  if (intent === "remove-image") {
    const viewId = formData.get("viewId") as string;
    const variantId = formData.get("variantId") as string;
    const productConfigId = params.id!;

    await db.variantViewConfiguration.updateMany({
      where: { productConfigId, variantId, viewId },
      data: { imageUrl: null },
    });
    return json({ success: true, intent: "remove-image" });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};
```

### Task 3.3: Image Manager Route — Component

- [ ] **Step 1: Build the page component**

The component renders:
1. Subheader with back nav to Product Detail
2. View tabs with completion badges (from `viewImageCounts`)
3. Image Tray (from imports/uploads, client state)
4. Color group cards for the selected view
5. Overall progress bar

**UI States per color card:**
- **Empty**: Dashed border, "+" icon, "Drop image from tray, or click to upload"
- **Default (inherited)**: Dimmed thumbnail + "Default" badge, "Override" button
- **Uploaded**: Full thumbnail, "✓ Uploaded" green status, "Set as default" + "Copy to..." actions
- **Uploading**: Progress ring on thumbnail
- **Failed**: Red border, error message, "Retry" button

**Page-level states:**
- **Loading**: `SkeletonPage` with skeleton tabs + skeleton cards
- **No views**: `EmptyState` — "Add views to your product first"
- **No variants**: `EmptyState` — "Link a Shopify product to see color variants"
- **All complete**: Success `Banner` — "All images assigned!"

```typescript
export default function ImageManagerPage() {
  const { config, views, colorGroups, cells, viewImageCounts } = useLoaderData<typeof loader>();
  const [activeViewId, setActiveViewId] = useState(views[0]?.id ?? "");
  const [trayImages, setTrayImages] = useState<TrayImage[]>([]);
  // ... upload queue state, drag state

  const activeCells = cells.filter((c) => c.viewId === activeViewId);
  const totalFilled = Object.values(viewImageCounts).reduce((s, v) => s + v.filled, 0);
  const totalCells = Object.values(viewImageCounts).reduce((s, v) => s + v.total, 0);

  // ... render tabs, tray, cards, progress
}
```

- [ ] **Step 2: Implement the upload flow (presigned URL → PUT → save)**

Follow the existing pattern from `app/routes/app.products.$id.views.$viewId.tsx`:
1. Client validates file (type, size < 10MB)
2. Calls batch-upload-urls API
3. PUTs file directly to R2
4. Submits `save-image` intent to the route action
5. Page revalidates

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/app.products.$id.images.tsx
git commit -m "feat: add Image Manager page — view tabs, color group cards, upload flow"
```

---

## Phase 4: View Editor Merge

**Purpose:** Merge placement pricing into the View Editor right panel. Delete the separate Placement Detail route.

### Task 4.1: Add Inline Pricing to View Editor Right Panel

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx`

- [ ] **Step 1: Read the current route**

The route currently has 7 intents: `get-upload-url`, `save-image`, `remove-image`, `save-placement-geometry`, `duplicate-geometry`, `create-placement`, `delete-placement`. It renders: view tabs, canvas, variant bar, right panel (zones + presets + image settings).

- [ ] **Step 2: Add pricing intents to the action**

Add new intents for inline pricing editing:

```typescript
if (intent === "update-placement") {
  const placementId = formData.get("placementId") as string;
  const name = formData.get("name") as string;
  const basePriceAdjustmentCents = parseInt(formData.get("basePriceAdjustmentCents") as string, 10) || 0;
  const hidePriceWhenZero = formData.get("hidePriceWhenZero") === "true";
  const defaultStepIndex = parseInt(formData.get("defaultStepIndex") as string, 10) || 0;

  await db.placementDefinition.update({
    where: { id: placementId },
    data: { name, basePriceAdjustmentCents, hidePriceWhenZero, defaultStepIndex },
  });
  return { success: true, intent: "update-placement" };
}

if (intent === "update-step") {
  const stepId = formData.get("stepId") as string;
  const label = formData.get("label") as string;
  const scaleFactor = parseFloat(formData.get("scaleFactor") as string) || 1.0;
  const priceAdjustmentCents = parseInt(formData.get("priceAdjustmentCents") as string, 10) || 0;

  await db.placementStep.update({
    where: { id: stepId },
    data: { label, scaleFactor, priceAdjustmentCents },
  });
  return { success: true, intent: "update-step" };
}

if (intent === "add-step") {
  const placementId = formData.get("placementId") as string;
  const label = formData.get("label") as string || "New Size";
  const maxOrder = await db.placementStep.aggregate({
    where: { placementDefinitionId: placementId },
    _max: { displayOrder: true },
  });
  await db.placementStep.create({
    data: {
      placementDefinitionId: placementId,
      label,
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
    },
  });
  return { success: true, intent: "add-step" };
}

if (intent === "delete-step") {
  const stepId = formData.get("stepId") as string;
  await db.placementStep.delete({ where: { id: stepId } });
  return { success: true, intent: "delete-step" };
}
```

- [ ] **Step 3: Update the loader to include placement steps**

Ensure the loader fetches placements WITH their steps:

```typescript
const config = await db.productConfig.findFirst({
  where: { id: productConfigId, shopId },
  include: {
    views: { orderBy: { displayOrder: "asc" } },
    placements: {
      include: { steps: { orderBy: { displayOrder: "asc" } } },
      orderBy: { displayOrder: "asc" },
    },
  },
});
```

- [ ] **Step 4: Build the ZonePricingPanel component**

Create `app/components/ZonePricingPanel.tsx` — an accordion of zone cards. When a zone is selected, it expands to show: name field, base price, size tiers (compact rows), "Hide price when zero" checkbox, "Add tier" button.

**Zone card states:**
- **Collapsed**: colored dot + name + badge ("€0 base · 3 sizes") + chevron-down
- **Expanded**: all pricing fields visible, chevron-up
- **Saving**: inline spinner on the field being saved

- [ ] **Step 5: Replace the right panel zones section**

Remove the "Pricing rules →" link from zone cards. Replace with the `ZonePricingPanel` accordion. Remove the "Image settings" collapsed section (images are in Image Manager now).

- [ ] **Step 6: Add "Print areas shared across variants" toggle**

Replace the "Apply to all variants" button in the variant bar with a toggle:

```tsx
<InlineStack gap="200" align="center">
  <input
    type="checkbox"
    checked={zonesShared}
    onChange={(e) => setZonesShared(e.target.checked)}
    style={{ width: 28, height: 16 }}
  />
  <Text variant="bodySm">Print areas shared across variants</Text>
</InlineStack>
```

When `zonesShared` is ON: geometry edits apply to the view level (all variants). When OFF: geometry edits apply to the selected variant only.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/app.products.$id.views.$viewId.tsx app/components/ZonePricingPanel.tsx
git commit -m "feat(view-editor): merge placement pricing into right panel, add shared-zones toggle"
```

### Task 4.2: Delete Placement Detail Route

**Files:**
- Delete: `app/routes/app.products.$id.placements.$placementId.tsx`
- Delete: `app/routes/app.products.$id.placements.tsx`

- [ ] **Step 1: Verify no imports reference these files**

```bash
grep -r "placements\.\$placementId" app/ --include="*.tsx" --include="*.ts" -l
grep -r "placements\.tsx" app/ --include="*.tsx" --include="*.ts" -l
```

Remove any navigation links in Product Detail that point to the old placement route.

- [ ] **Step 2: Delete the files**

```bash
rm app/routes/app.products.$id.placements.$placementId.tsx
rm app/routes/app.products.$id.placements.tsx
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "refactor: delete Placement Detail route — pricing merged into View Editor"
```

---

## Phase 5: Product Detail

**Purpose:** Add per-view clickable rows, remove storefront card, add SaveBar.

### Task 5.1: Per-View Rows with Status

**Files:**
- Modify: `app/routes/app.products.$id._index.tsx`

- [ ] **Step 1: Update the loader to compute per-view image counts**

Query VariantViewConfigurations grouped by viewId to get image counts:

```typescript
const imageCounts = await db.variantViewConfiguration.groupBy({
  by: ["viewId"],
  where: { productConfigId, imageUrl: { not: null } },
  _count: true,
});
```

Combine with total variant count per view to get "X of Y images" per view.

- [ ] **Step 2: Replace the "Open View Editor" / "Edit Zones" button with per-view rows**

Each view renders as a clickable `ResourceItem`-like row:
```tsx
{views.map((view) => {
  const count = imageCounts.find((c) => c.viewId === view.id);
  const filled = count?._count ?? 0;
  const total = colorGroups.length; // one image per color group per view
  const isComplete = filled >= total && total > 0;

  return (
    <InlineStack key={view.id} align="center" gap="300" wrap={false}>
      <Icon source={ImageIcon} tone={isComplete ? "success" : filled > 0 ? "warning" : "subdued"} />
      <Link url={`/app/products/${productConfigId}/views/${view.id}`} removeUnderline>
        <Text fontWeight="semibold">{view.perspective}</Text>
      </Link>
      <Box width="100%" />
      <Badge tone={isComplete ? "success" : filled > 0 ? "warning" : undefined}>
        {`${filled}/${total} images`}
      </Badge>
      <Text variant="bodySm" tone="subdued">{`${zoneCount} zones`}</Text>
      <Icon source={ChevronRightIcon} tone="subdued" />
    </InlineStack>
  );
})}
```

- [ ] **Step 3: Remove the storefront button card from the sidebar**

Delete the "Storefront button" / "Open theme editor" card from the right column. This moves to Settings (Phase 6).

- [ ] **Step 4: Add SaveBar integration**

```typescript
const hasChanges = nameChanged || methodsChanged;

useEffect(() => {
  if (hasChanges) {
    (window as any).shopify?.saveBar?.show("product-detail-save-bar");
  } else {
    (window as any).shopify?.saveBar?.hide("product-detail-save-bar");
  }
}, [hasChanges]);
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/app.products.$id._index.tsx
git commit -m "feat(product-detail): per-view status rows, remove storefront card, add SaveBar"
```

---

## Phase 6: Settings

**Purpose:** Add theme integration section to the General tab.

### Task 6.1: Settings General Tab — Theme Integration

**Files:**
- Modify: `app/routes/app.settings.tsx`

- [ ] **Step 1: Read the current route**

The Settings route currently has the Translations tab with text overrides and the placeholder logo upload. Check if a General tab exists or needs to be created.

- [ ] **Step 2: Add a General tab with theme integration**

Add a tab bar (if not present) with "General" and "Translations". On the General tab:

```tsx
<Layout.AnnotatedSection
  title="Theme integration"
  description="Add the Insignia Customize button to your store's product pages."
>
  <Card>
    <BlockStack gap="300">
      {themeBlockActive ? (
        <Banner tone="success">
          <Text>Block added to your live theme. The Customize button is active on product pages.</Text>
        </Banner>
      ) : (
        <Banner tone="warning">
          <Text>The Customize button has not been added to your theme yet.</Text>
        </Banner>
      )}
      <Button
        url={`https://${shop}/admin/themes/current/editor?addAppBlockId=${appId}/customize-button`}
        external
        icon={ExternalIcon}
      >
        Open theme editor
      </Button>
    </BlockStack>
  </Card>
</Layout.AnnotatedSection>
```

Move the existing placeholder logo section under the General tab as well.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.settings.tsx
git commit -m "feat(settings): add General tab with theme integration and placeholder logo"
```

---

## Phase 7: Dashboard Onboarding

**Purpose:** Add a setup guide wizard for first-time merchants.

### Task 7.1: Dashboard Setup Guide

**Files:**
- Modify: `app/routes/app._index.tsx`

- [ ] **Step 1: Update the loader to detect first-time state**

```typescript
const methodCount = await db.decorationMethod.count({ where: { shopId } });
const configCount = await db.productConfig.count({ where: { shopId } });
const hasImages = await db.variantViewConfiguration.count({
  where: { productConfig: { shopId }, imageUrl: { not: null } },
});
const settings = await getMerchantSettings(shopId);

const setupSteps = {
  methodCreated: methodCount > 0,
  productCreated: configCount > 0,
  imagesUploaded: hasImages > 0,
  themeBlockAdded: false, // Would need to check via Shopify API or stored flag
};

const isFirstTime = !setupSteps.methodCreated;
const setupComplete = Object.values(setupSteps).every(Boolean);
const completedCount = Object.values(setupSteps).filter(Boolean).length;
```

- [ ] **Step 2: Render the setup guide conditionally**

```tsx
{isFirstTime && !setupDismissed && (
  <Card>
    <BlockStack gap="400">
      <InlineStack align="space-between">
        <Text variant="headingMd">Setup guide</Text>
        <Text variant="bodySm" tone="subdued">{completedCount} of 4</Text>
      </InlineStack>
      <ProgressBar progress={(completedCount / 4) * 100} size="small" />

      {/* Step 1: Create method */}
      <SetupStep
        title="Create your first method"
        description="Define how logos are applied to products."
        completed={setupSteps.methodCreated}
        active={!setupSteps.methodCreated}
        actionLabel="Add method"
        actionUrl="/app/methods"
      />
      {/* Step 2-4 follow same pattern */}
    </BlockStack>
  </Card>
)}
```

**UI States:**
- **First time**: Setup guide visible, stat cards show zeros, empty state below
- **Setup in progress**: Guide shows progress (1-3 of 4), stat cards start populating
- **Setup complete**: Guide shows "Complete!" with dismiss button, normal dashboard below
- **Returning merchant**: No guide, full dashboard with activity + analytics

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app._index.tsx
git commit -m "feat(dashboard): add onboarding setup guide with 4 progressive steps"
```

---

## Phase 8: Storefront & Integration

**Purpose:** Apply all storefront-facing changes: localStorage drafts, terminology, auto-select logic, artwork re-upload.

### Task 8.1: Storefront Draft Persistence

**Files:**
- Modify: `app/components/storefront/CustomizationModal.tsx`

- [ ] **Step 1: Switch from sessionStorage to localStorage**

Find all `sessionStorage` references and replace with `localStorage`. The draft key should include the product ID to avoid cross-product collisions:

```typescript
const DRAFT_KEY = `insignia-draft-${productId}`;

function saveDraft(state: DraftState) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch { /* quota exceeded — silently fail */ }
}

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
```

Include full `LogoState` (logoAssetId + URLs) in the draft, not just the upload type.

### Task 8.2: Storefront Terminology & Auto-Select

**Files:**
- Modify: `app/components/storefront/SizeStep.tsx`
- Modify: `app/components/storefront/PlacementStep.tsx`
- Modify: `app/components/storefront/ReviewStep.tsx`
- Modify: `app/components/storefront/UploadStep.tsx`

- [ ] **Step 1: SizeStep — "Logo size" header + single-size auto-skip**

```typescript
// Change step header from "Size" to "Logo size"
<Text variant="headingMd">Logo size</Text>

// Auto-skip when only 1 tier:
useEffect(() => {
  if (placement.steps.length === 1) {
    onSelectSize(0);
    onNext(); // Skip this step entirely
  }
}, [placement.steps.length]);
```

- [ ] **Step 2: PlacementStep — single-placement auto-select**

```typescript
useEffect(() => {
  if (placements.length === 1) {
    onSelectPlacement(placements[0].id);
    // Don't auto-advance — still show the placement with a note
  }
}, [placements.length]);

// Render note when auto-selected:
{placements.length === 1 && (
  <Text tone="subdued">This product has one print area.</Text>
)}
```

- [ ] **Step 3: ReviewStep — "Estimated total" label**

```typescript
// Change from "Total so far" to "Estimated total"
<Text variant="bodySm" tone="subdued">Estimated total</Text>
```

- [ ] **Step 4: UploadStep — artwork re-upload**

Ensure the upload area is always visible, even after first upload. Don't hide the uploader — show a "Replace artwork" option alongside the preview.

- [ ] **Step 5: UploadStep — 1-method auto-select**

```typescript
useEffect(() => {
  if (methods.length === 1) {
    onSelectMethod(methods[0].id);
  }
}, [methods.length]);
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/components/storefront/
git commit -m "feat(storefront): localStorage drafts, Logo size header, auto-select, Estimated total, artwork re-upload"
```

### Task 8.3: Storefront Guards

**Files:**
- Modify: `app/lib/services/storefront-config.server.ts`

- [ ] **Step 1: Add 0-methods and 0-placements validation**

In `getStorefrontConfig`, after fetching the config, add guards:

```typescript
if (config.allowedMethods.length === 0) {
  throw new AppError(
    "This product has no decoration methods configured. Please contact the store.",
    ErrorCodes.INVALID_CONFIG,
    400
  );
}

if (config.placements.length === 0) {
  throw new AppError(
    "This product has no print areas configured. Please contact the store.",
    ErrorCodes.INVALID_CONFIG,
    400
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/storefront-config.server.ts
git commit -m "feat(storefront): add 0-methods and 0-placements guards on config endpoint"
```

### Task 8.4: End-to-End Verification

- [ ] **Step 1: Run full verification suite**

```bash
npm run typecheck        # TypeScript compilation
npm run lint             # ESLint + a11y
npx prisma validate      # Schema integrity
npm run build            # Production build succeeds
```

- [ ] **Step 2: Manual flow test on dev server**

Start the dev server and walk through:
1. Dashboard → onboarding wizard appears
2. Create a method → wizard step 1 completes
3. Create a product setup → wizard step 2 completes
4. Open Image Manager → upload images via tray
5. Click view row on Product Detail → View Editor opens
6. Position zones → expand zone card → edit pricing inline
7. Settings → verify theme integration section
8. Storefront → verify method selector shows customerName, "Logo size" header, "Estimated total"

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete V2 implementation — all phases verified end-to-end"
```

---

## Phase 9: Missing Items Catchall

**Purpose:** Items from the V2 todo that don't fit neatly into a single phase. Each is a self-contained task.

### Task 9.1: Shopify Resource Picker for Create Setup Modal

**Files:**
- Modify: `app/routes/app.products._index.tsx` (the Products List page with the Create Setup modal)

- [ ] **Step 1: Replace custom product selector with native Resource Picker**

In the Create Setup modal's product selection handler, replace the custom picker with:

```typescript
const handleSelectProducts = async () => {
  const selected = await (window as any).shopify.resourcePicker({
    type: "product",
    multiple: true,
    action: "select",
    filter: { variants: true },
    selectionIds: selectedProducts.map((id: string) => ({ id })),
  });

  if (selected) {
    const productIds = selected.map((p: { id: string }) => p.id);
    setSelectedProducts(productIds);
  }
};
```

- [ ] **Step 2: Add auto-navigate after product creation**

In the action handler for the `create` intent, return a redirect instead of staying on the list:

```typescript
if (intent === "create") {
  const newConfig = await createProductConfig({ shopId, name, linkedProductIds, presetType });
  return redirect(`/app/products/${newConfig.id}`);
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.products._index.tsx
git commit -m "feat: use Shopify Resource Picker for product selection, auto-navigate after creation"
```

### Task 9.2: View Editor — Unsaved Changes Warning + SaveBar

**Files:**
- Modify: `app/routes/app.products.$id.views.$viewId.tsx`

- [ ] **Step 1: Add beforeunload listener when geometry is dirty**

```typescript
const [geometryDirty, setGeometryDirty] = useState(false);

useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    if (geometryDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [geometryDirty]);
```

- [ ] **Step 2: Add React Router useBlocker for in-app navigation**

```typescript
import { useBlocker } from "react-router";

const blocker = useBlocker(
  ({ currentLocation, nextLocation }) =>
    geometryDirty && currentLocation.pathname !== nextLocation.pathname
);

// Render a confirmation modal when blocked:
{blocker.state === "blocked" && (
  <Modal
    open
    title="Unsaved changes"
    primaryAction={{ content: "Leave", onAction: () => blocker.proceed(), destructive: true }}
    secondaryActions={[{ content: "Stay", onAction: () => blocker.reset() }]}
    onClose={() => blocker.reset()}
  >
    <Modal.Section>
      <Text>You have unsaved zone changes. Leave without saving?</Text>
    </Modal.Section>
  </Modal>
)}
```

- [ ] **Step 3: Add SaveBar to View Editor**

```typescript
useEffect(() => {
  const saveBar = (window as any).shopify?.saveBar;
  if (geometryDirty) {
    saveBar?.show("view-editor-save-bar");
  } else {
    saveBar?.hide("view-editor-save-bar");
  }
  return () => saveBar?.hide("view-editor-save-bar");
}, [geometryDirty]);
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.products.$id.views.$viewId.tsx
git commit -m "feat(view-editor): unsaved changes warning (beforeunload + useBlocker) + SaveBar"
```

### Task 9.3: Storefront — Presigned URL Refresh on Step Transitions

**Files:**
- Modify: `app/components/storefront/CustomizationModal.tsx`

- [ ] **Step 1: Add URL refresh logic when stepping between storefront steps**

Presigned URLs expire after 10 minutes. When the customer transitions between steps, check if the logo preview URL is still fresh and refresh if needed:

```typescript
const URL_REFRESH_THRESHOLD_MS = 8 * 60 * 1000; // 8 minutes (2 min buffer before 10 min expiry)

const [logoUrlTimestamp, setLogoUrlTimestamp] = useState(Date.now());

const refreshLogoUrlsIfNeeded = useCallback(async () => {
  if (Date.now() - logoUrlTimestamp > URL_REFRESH_THRESHOLD_MS && logoState?.logoAssetId) {
    // Re-fetch signed URLs from the server
    const response = await fetch(
      `/apps/insignia/uploads/${logoState.logoAssetId}/refresh`,
      { method: "POST" }
    );
    if (response.ok) {
      const { previewUrl, sanitizedUrl } = await response.json();
      setLogoState((prev) => prev ? { ...prev, previewPngUrl: previewUrl, sanitizedSvgUrl: sanitizedUrl } : prev);
      setLogoUrlTimestamp(Date.now());
    }
  }
}, [logoUrlTimestamp, logoState?.logoAssetId]);

// Call on every step transition
useEffect(() => {
  refreshLogoUrlsIfNeeded();
}, [currentStep]);
```

- [ ] **Step 2: Create the refresh endpoint if it doesn't exist**

Add `app/routes/apps.insignia.uploads.$id.refresh.tsx` that returns fresh presigned GET URLs for the logo asset.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/components/storefront/CustomizationModal.tsx app/routes/apps.insignia.uploads.$id.refresh.tsx
git commit -m "feat(storefront): refresh presigned logo URLs on step transitions"
```

### Task 9.4: Replace Raw HTML in PlacementGeometryEditor

**Files:**
- Modify: `app/components/PlacementGeometryEditor.tsx`

- [ ] **Step 1: Find and replace all raw `<button>` elements**

Search the file for `<button` and replace each with Polaris `<Button>`:

```typescript
// Before:
<button onClick={handleReset}>Reset</button>

// After:
<Button onClick={handleReset} variant="plain">Reset</Button>
```

Do this for every raw `<button>` in the component. Also check for raw `<input>`, `<select>` — replace with Polaris `TextField`, `Select`.

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/components/PlacementGeometryEditor.tsx
git commit -m "refactor: replace raw HTML elements with Polaris components in PlacementGeometryEditor"
```

### Task 9.5: Image Manager — Copy/Apply Actions + Upload Queue

**Files:**
- Modify: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Add "Copy to..." popover on uploaded color cards**

When a color group card has an image uploaded, show a "Copy to..." action that opens a `Popover` with checkboxes for other color groups:

```tsx
const [copyPopoverActive, setCopyPopoverActive] = useState<string | null>(null);

// In the card actions:
<Popover
  active={copyPopoverActive === cell.colorValue}
  activator={
    <Button variant="plain" onClick={() => setCopyPopoverActive(cell.colorValue)}>
      Copy to...
    </Button>
  }
  onClose={() => setCopyPopoverActive(null)}
>
  <ActionList
    items={otherColorGroups.map((g) => ({
      content: g.colorValue,
      onAction: () => handleCopyToGroup(cell, g),
    }))}
  />
</Popover>
```

- [ ] **Step 2: Add "Apply to all empty cells" action**

A button that copies the selected image to all cells in the current view that don't have an explicit image:

```typescript
const handleApplyToAllEmpty = async (sourceCell: ImageCell) => {
  const emptyGroups = activeCells.filter((c) => !c.imageUrl && c.colorValue !== sourceCell.colorValue);
  if (emptyGroups.length === 0) return;

  const images = emptyGroups.map((c) => ({
    viewId: c.viewId,
    variantIds: c.variantIds,
    storageKey: sourceCell.imageUrl!,
  }));

  await fetch("/api/admin/batch-save-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productConfigId: config.id, images }),
  });

  revalidator.revalidate();
};
```

- [ ] **Step 3: Implement client-side upload queue**

```typescript
type UploadJob = {
  id: string;
  file: File;
  viewId: string;
  variantId: string;
  status: "queued" | "uploading" | "complete" | "error";
  progress: number;
};

const MAX_CONCURRENT = 4;
const [uploadQueue, setUploadQueue] = useState<UploadJob[]>([]);

useEffect(() => {
  const activeUploads = uploadQueue.filter((j) => j.status === "uploading");
  const queued = uploadQueue.filter((j) => j.status === "queued");

  if (activeUploads.length < MAX_CONCURRENT && queued.length > 0) {
    const next = queued[0];
    processUpload(next);
  }
}, [uploadQueue]);

async function processUpload(job: UploadJob) {
  setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "uploading" } : j));

  try {
    // Get presigned URL
    const urlRes = await fetch("/api/admin/batch-upload-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productConfigId: config.id,
        items: [{ viewId: job.viewId, variantId: job.variantId, contentType: job.file.type, fileName: job.file.name }],
      }),
    });
    const { items } = await urlRes.json();
    const { uploadUrl, storageKey } = items[0];

    // Upload with progress
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, progress: (e.loaded / e.total) * 100 } : j));
        }
      });
      xhr.addEventListener("load", () => xhr.status < 400 ? resolve() : reject());
      xhr.addEventListener("error", reject);
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", job.file.type);
      xhr.send(job.file);
    });

    // Save reference
    const formData = new FormData();
    formData.append("intent", "save-image");
    formData.append("viewId", job.viewId);
    formData.append("variantId", job.variantId);
    formData.append("imageKey", storageKey);
    submit(formData, { method: "POST" });

    setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "complete", progress: 100 } : j));
  } catch {
    setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "error" } : j));
  }
}
```

- [ ] **Step 4: Add SaveBar to Image Manager**

Same SaveBar pattern as other pages. Trigger when tray has unassigned images or unsaved changes.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
npm run lint
git add app/routes/app.products.$id.images.tsx
git commit -m "feat(image-manager): copy/apply actions, upload queue with progress, SaveBar"
```

### Task 9.6: Methods List — Linked Product Count Badge

**Files:**
- Modify: `app/routes/app.methods._index.tsx`

- [ ] **Step 1: Update the loader to include linked product counts**

```typescript
const methods = await db.decorationMethod.findMany({
  where: { shopId },
  include: {
    _count: {
      select: { productConfigs: true },
    },
  },
  orderBy: { createdAt: "desc" },
});
```

- [ ] **Step 2: Add the count to the table rows**

In the `IndexTable` row mapping, add a `Badge` showing the linked count:

```tsx
<IndexTable.Cell>
  <Badge tone={method._count.productConfigs > 0 ? "info" : undefined}>
    {method._count.productConfigs} {method._count.productConfigs === 1 ? "product" : "products"}
  </Badge>
</IndexTable.Cell>
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.methods._index.tsx
git commit -m "feat(methods-list): show linked product count badge per method"
```

### Task 9.7: Order Detail — Status Banner + Workflow Steps

**Files:**
- Modify: `app/routes/app.orders.$id.tsx`

- [ ] **Step 1: Read the current Order Detail route**

Understand the current layout: what cards exist, how artwork status is displayed, what actions are available.

- [ ] **Step 2: Add a status banner above the two-column layout**

Based on the canvas design: a full-width `Banner` at the top indicating the current production status:

```tsx
{artworkStatus === "PROVIDED" ? (
  <Banner tone="success" title="Artwork provided — Ready for production">
    <Text>Customer uploaded artwork on {uploadDate}. Review the file and mark as in production when ready.</Text>
  </Banner>
) : (
  <Banner tone="warning" title="Artwork pending — Waiting for customer">
    <Text>Customer chose to provide artwork later. Send a reminder via the customer upload link.</Text>
  </Banner>
)}
```

- [ ] **Step 3: Replace the production status dropdown with a workflow step list**

In the sidebar status card, replace the `<Select>` dropdown with a vertical step list:

```tsx
const WORKFLOW_STEPS = [
  { key: "artwork", label: "Artwork provided" },
  { key: "production", label: "In production" },
  { key: "quality", label: "Quality check" },
  { key: "shipped", label: "Shipped" },
];

// Render steps with the current step highlighted:
<BlockStack gap="200">
  {WORKFLOW_STEPS.map((step, i) => {
    const isComplete = i < currentStepIndex;
    const isCurrent = i === currentStepIndex;
    const isPending = i > currentStepIndex;

    return (
      <InlineStack key={step.key} gap="200" align="center">
        {isComplete && <Icon source={CircleCheckIcon} tone="success" />}
        {isCurrent && <Box width="16px" height="16px" borderRadius="full" background="bg-fill-info" />}
        {isPending && <Box width="16px" height="16px" borderRadius="full" borderWidth="025" borderColor="border-secondary" />}
        <Text tone={isPending ? "subdued" : undefined} fontWeight={isCurrent ? "semibold" : "regular"}>
          {step.label}
        </Text>
        {isCurrent && (
          <Button size="slim" variant="primary" onClick={() => advanceStep()}>Mark</Button>
        )}
      </InlineStack>
    );
  })}
</BlockStack>
```

- [ ] **Step 4: Remove the fabricated "Position" row from production specs**

Remove any row showing inch-based position data. Only show: Method, Placement (print area name), Logo size (tier name + scale), Product (variant + qty).

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.orders.$id.tsx
git commit -m "feat(orders): status banner, workflow step list, remove fabricated position data"
```

### Task 9.8: Geometry Per-View Migration (Foundation Only)

**Purpose:** Add the `placementGeometry` field to `ProductView` without removing it from `VariantViewConfiguration`. Both fields coexist during transition. The View Editor reads from `ProductView` first (if populated), falls back to `VariantViewConfiguration`.

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add placementGeometry to ProductView**

```prisma
model ProductView {
  id                String          @id @default(uuid())
  productConfigId   String
  perspective       ViewPerspective
  displayOrder      Int             @default(0)
  defaultImageKey   String?
  placementGeometry Json?           // NEW: shared zone geometry, overridable per-variant
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  // ... relations unchanged
}
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_view_level_geometry
npx prisma validate
npm run typecheck
```

- [ ] **Step 3: Update the View Editor loader to read view-level geometry first**

In `app/routes/app.products.$id.views.$viewId.tsx`, when the "Zones shared" toggle is ON, read `ProductView.placementGeometry`. When OFF, read `VariantViewConfiguration.placementGeometry` for the selected variant.

- [ ] **Step 4: Update the View Editor save to write to the correct location**

When "Zones shared" is ON, save geometry to `ProductView.placementGeometry`. When OFF, save to `VariantViewConfiguration.placementGeometry` for the selected variant.

- [ ] **Step 5: Update storefront config builder to prefer view-level geometry**

In `storefront-config.server.ts`, when building `Placement.geometryByViewId`, check `ProductView.placementGeometry` first. If null, fall back to the representative variant's `VariantViewConfiguration.placementGeometry`.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
git add prisma/ app/routes/app.products.$id.views.$viewId.tsx app/lib/services/storefront-config.server.ts
git commit -m "feat: add view-level geometry with shared/per-variant toggle — both fields coexist"
```

---

## Phase 10: Audit Fixes — Security, Behavioral Gaps, Implementation Gaps

**Purpose:** Items identified during the final audit that are MISSING or RISKY. Grouped by priority.

### Task 10.1: Security — Auth & Ownership on ALL Endpoints

**CRITICAL — Every mutation endpoint must authenticate AND verify shop ownership.**

- [ ] **Step 1: Image Manager route action — add auth + ownership**

In `app/routes/app.products.$id.images.tsx`, the action handler MUST call `authenticate.admin(request)` and verify the product config belongs to the session's shop:

```typescript
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productConfigId = params.id!;

  // Verify ownership
  const config = await db.productConfig.findFirst({
    where: { id: productConfigId, shopId: session.shop },
    select: { id: true },
  });
  if (!config) return json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");
  // ... rest of intents
};
```

- [ ] **Step 2: import-shopify-images — add shop ownership check**

The endpoint verifies `productConfigId` exists but DOES NOT verify it belongs to `shopId`. Add:

```typescript
const config = await db.productConfig.findFirst({
  where: { id: productConfigId, shopId },
  select: { id: true },
});
if (!config) {
  return json({ error: { message: "Product config not found", code: "NOT_FOUND" } }, { status: 404 });
}
```

- [ ] **Step 3: set-view-default action — verify view belongs to shop**

When the `set-view-default` intent fires, verify the viewId belongs to a ProductConfig owned by this shop:

```typescript
if (intent === "set-view-default") {
  const viewId = formData.get("viewId") as string;
  const view = await db.productView.findFirst({
    where: { id: viewId, productConfig: { shopId: session.shop } },
  });
  if (!view) return json({ error: "View not found" }, { status: 404 });
  // ... proceed
}
```

- [ ] **Step 4: apps.insignia.uploads.$id.refresh — use proxy signature auth, NOT admin auth**

This is a storefront proxy route. Use Shopify proxy signature verification (same as other `apps.insignia.*` routes):

```typescript
import { authenticate } from "../shopify.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  // ... refresh presigned URLs
};
```

- [ ] **Step 5: Add Zod schemas to ALL batch endpoints**

Replace raw `body as { ... }` casts with Zod validation in `batch-upload-urls` and `batch-save-images`:

```typescript
import { z } from "zod";

const batchUploadUrlsSchema = z.object({
  productConfigId: z.string().uuid(),
  items: z.array(z.object({
    viewId: z.string().uuid(),
    variantId: z.string(),
    contentType: z.string().regex(/^image\/(jpeg|png|webp|gif|tiff|svg\+xml|heic)$/),
    fileName: z.string().max(255),
  })).min(1).max(50),
});

// In the action:
const parsed = batchUploadUrlsSchema.safeParse(body);
if (!parsed.success) {
  return json({ error: { message: "Invalid input", details: parsed.error.flatten() } }, { status: 400 });
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "security: add auth + ownership checks to all endpoints, Zod validation on batch APIs"
```

### Task 10.2: Behavioral Guards & Edge Cases

- [ ] **Step 1: Prevent deletion of last size tier**

In the View Editor's `delete-step` intent (Task 4.1), add a guard:

```typescript
if (intent === "delete-step") {
  const stepId = formData.get("stepId") as string;
  const step = await db.placementStep.findUnique({
    where: { id: stepId },
    include: { placementDefinition: { include: { _count: { select: { steps: true } } } } },
  });
  if (!step) return json({ error: "Step not found" }, { status: 404 });
  if (step.placementDefinition._count.steps <= 1) {
    return json({ error: "Cannot delete the last size tier. A print area must have at least one." }, { status: 400 });
  }
  await db.placementStep.delete({ where: { id: stepId } });
  return { success: true, intent: "delete-step" };
}
```

- [ ] **Step 2: Specify shared-zones toggle ON/OFF behavior**

When toggling shared zones OFF: Per-variant geometry is initialized by COPYING the current view-level geometry to the selected variant's `VariantViewConfiguration.placementGeometry`. Merchant can then edit that variant independently.

When toggling shared zones ON: The view-level geometry stays as-is. Per-variant overrides are NOT deleted (preserved for future toggle-off). The canvas shows the view-level geometry when toggle is ON.

```typescript
if (intent === "toggle-shared-zones") {
  const shared = formData.get("shared") === "true";
  if (!shared) {
    // Copy view-level geometry to selected variant as starting point
    const view = await db.productView.findUnique({ where: { id: viewId } });
    if (view?.placementGeometry) {
      await db.variantViewConfiguration.upsert({
        where: { productConfigId_variantId_viewId: { productConfigId, variantId: selectedVariantId, viewId } },
        create: { productConfigId, variantId: selectedVariantId, viewId, placementGeometry: view.placementGeometry },
        update: { placementGeometry: view.placementGeometry },
      });
    }
  }
  return { success: true, intent: "toggle-shared-zones", shared };
}
```

- [ ] **Step 3: Stale draft detection for storefront**

Add a `configVersion` field to the draft. On load, compare against the current config hash:

```typescript
function saveDraft(state: DraftState, configVersion: string) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, configVersion, savedAt: Date.now() }));
}

function loadDraft(currentConfigVersion: string): DraftState | null {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  // If config changed since draft was saved, discard the draft
  if (parsed.configVersion !== currentConfigVersion) {
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }
  return parsed;
}
```

Pass `config.updatedAt.toISOString()` as the `configVersion` from the storefront config endpoint.

- [ ] **Step 4: Setup guide dismiss persistence**

Add to `MerchantSettings`:

```prisma
model MerchantSettings {
  // ... existing fields
  setupGuideDismissedAt DateTime?  // NEW
}
```

In the Dashboard loader, check `settings.setupGuideDismissedAt`. In the Dashboard action, add a `dismiss-setup` intent that sets this field.

- [ ] **Step 5: Artwork constraints in storefront upload validation**

The storefront config endpoint must include `artworkConstraints` per method. Update `StorefrontConfig.methods`:

```typescript
export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: {            // NEW
    fileTypes: string[];
    maxColors: number | null;
    minDpi: number | null;
  } | null;
};
```

In `UploadStep.tsx`, when a method is selected, validate the uploaded file against its constraints:

```typescript
const validateFileAgainstConstraints = (file: File, constraints: ArtworkConstraints | null) => {
  if (!constraints) return { valid: true };
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (constraints.fileTypes.length > 0 && !constraints.fileTypes.includes(ext || "")) {
    return { valid: false, error: `This method accepts: ${constraints.fileTypes.join(", ").toUpperCase()}` };
  }
  return { valid: true };
};
```

DPI validation happens server-side after upload (requires reading image metadata via Sharp). Color count cannot be validated client-side.

- [ ] **Step 6: import-shopify-images — fix extension detection + add timeout**

Replace naive URL extension check with Content-Type header:

```typescript
const imageResponse = await fetch(url, { signal: AbortSignal.timeout(10_000) });
if (!imageResponse.ok) continue;

const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: behavioral guards — last-tier protection, stale draft detection, shared-zones toggle, artwork validation"
```

### Task 10.3: Image Tray Drag-and-Drop Implementation

**Files:**
- Create: `app/components/ImageTray.tsx`
- Modify: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Implement the Image Tray component**

The tray holds images from Shopify import or bulk upload. Uses HTML5 drag-and-drop (no library needed for simple DnD):

```typescript
// app/components/ImageTray.tsx
import { useState, useCallback } from "react";
import { Card, InlineStack, Text, Button, Badge, Icon, BlockStack } from "@shopify/polaris";

export type TrayImage = {
  id: string;
  storageKey: string;
  previewUrl: string;
  originalFileName?: string;
};

type Props = {
  images: TrayImage[];
  onRemove: (id: string) => void;
  onBulkUpload: (files: FileList) => void;
  onDragStart: (image: TrayImage) => void;
};

export function ImageTray({ images, onRemove, onBulkUpload, onDragStart }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      onBulkUpload(e.dataTransfer.files);
    }
  }, [onBulkUpload]);

  if (images.length === 0 && collapsed) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <InlineStack gap="200" align="center">
            <Text variant="headingSm">Image Tray</Text>
            {images.length > 0 && (
              <Badge tone="warning">{`${images.length} unassigned`}</Badge>
            )}
          </InlineStack>
          <Button variant="plain" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? "Expand" : "Collapse"}
          </Button>
        </InlineStack>

        {!collapsed && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 72 }}
          >
            {images.map((img) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => onDragStart(img)}
                style={{
                  width: 64, height: 64, borderRadius: 6,
                  background: "#F3F4F6", border: "1px solid #D1D5DB",
                  cursor: "grab", position: "relative",
                  backgroundImage: `url(${img.previewUrl})`,
                  backgroundSize: "cover",
                }}
              />
            ))}
            <label
              style={{
                width: 64, height: 64, borderRadius: 6,
                border: "1px dashed #D1D5DB", display: "flex",
                alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 11, color: "#9CA3AF",
              }}
            >
              + Upload
              <input
                type="file"
                multiple
                accept="image/*"
                hidden
                onChange={(e) => e.target.files && onBulkUpload(e.target.files)}
              />
            </label>
          </div>
        )}

        {!collapsed && images.length > 0 && (
          <Text variant="bodySm" tone="subdued">
            Drag images to the correct color card below
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
```

- [ ] **Step 2: Add drop targets to color group cards**

In the Image Manager route component, each color group card accepts dropped tray images:

```typescript
const [draggedImage, setDraggedImage] = useState<TrayImage | null>(null);

// On each color card:
<div
  onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.outline = "2px solid #2563EB"; }}
  onDragLeave={(e) => { e.currentTarget.style.outline = "none"; }}
  onDrop={(e) => {
    e.preventDefault();
    e.currentTarget.style.outline = "none";
    if (draggedImage) {
      handleAssignImageToCell(draggedImage, cell);
      setDraggedImage(null);
    }
  }}
>
```

- [ ] **Step 3: Image removed from cell returns to tray**

When the `remove-image` intent succeeds, add the removed image back to the tray state:

```typescript
const handleRemoveImage = (cell: ImageCell) => {
  // Add back to tray
  if (cell.imageUrl && !cell.isDefault) {
    setTrayImages((prev) => [...prev, {
      id: `returned-${Date.now()}`,
      storageKey: cell.imageUrl!,
      previewUrl: cell.imageUrl!, // May need signed URL refresh
    }]);
  }
  // Submit remove intent
  submit(/* ... */);
};
```

- [ ] **Step 4: 20+ color groups pagination**

When `colorGroups.length > 20`, show only the first 20 with a "Show all N color groups" button:

```typescript
const [showAll, setShowAll] = useState(false);
const PAGE_SIZE = 20;
const visibleGroups = showAll ? activeCells : activeCells.slice(0, PAGE_SIZE);
const hasMore = activeCells.length > PAGE_SIZE;

// After the card list:
{hasMore && !showAll && (
  <Button variant="plain" onClick={() => setShowAll(true)}>
    Show all {activeCells.length} color groups
  </Button>
)}
```

- [ ] **Step 5: Upload retry mechanism**

Add a retry handler to the upload queue:

```typescript
const MAX_RETRIES = 3;

const handleRetry = (jobId: string) => {
  setUploadQueue((q) => q.map((j) =>
    j.id === jobId ? { ...j, status: "queued", progress: 0, retryCount: (j.retryCount ?? 0) + 1 } : j
  ));
};

// In processUpload, check retry count:
if (job.retryCount && job.retryCount >= MAX_RETRIES) {
  setUploadQueue((q) => q.map((j) => j.id === job.id ? { ...j, status: "error", errorMessage: "Upload failed after 3 attempts" } : j));
  return;
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
git add app/components/ImageTray.tsx app/routes/app.products.$id.images.tsx
git commit -m "feat(image-manager): Image Tray DnD, cell drop targets, remove-returns-to-tray, pagination, upload retry"
```

### Task 10.4: View Editor Enhancements (from Verification Report)

**Files:**
- Modify: `app/components/PlacementGeometryEditor.tsx`
- Modify: `app/routes/app.products.$id.views.$viewId.tsx`

- [ ] **Step 1: Add undo/redo with state history stack**

```typescript
type GeometrySnapshot = Record<string, PlacementGeometry | null>;

const [history, setHistory] = useState<GeometrySnapshot[]>([]);
const [historyIndex, setHistoryIndex] = useState(-1);

const pushHistory = (snapshot: GeometrySnapshot) => {
  setHistory((h) => [...h.slice(0, historyIndex + 1), snapshot]);
  setHistoryIndex((i) => i + 1);
};

const undo = () => {
  if (historyIndex > 0) {
    setHistoryIndex((i) => i - 1);
    applyGeometry(history[historyIndex - 1]);
  }
};

const redo = () => {
  if (historyIndex < history.length - 1) {
    setHistoryIndex((i) => i + 1);
    applyGeometry(history[historyIndex + 1]);
  }
};

// Keyboard handler:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [historyIndex, history]);
```

- [ ] **Step 2: Add keyboard arrow-key nudge**

When a zone is selected, arrow keys nudge its position by 1 grid step (~0.5% of canvas):

```typescript
const NUDGE_PERCENT = 0.5;

useEffect(() => {
  if (!selectedZoneId) return;
  const handler = (e: KeyboardEvent) => {
    const delta = { x: 0, y: 0 };
    if (e.key === "ArrowLeft") delta.x = -NUDGE_PERCENT;
    if (e.key === "ArrowRight") delta.x = NUDGE_PERCENT;
    if (e.key === "ArrowUp") delta.y = -NUDGE_PERCENT;
    if (e.key === "ArrowDown") delta.y = NUDGE_PERCENT;
    if (delta.x !== 0 || delta.y !== 0) {
      e.preventDefault();
      moveZoneBy(selectedZoneId, delta.x, delta.y);
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [selectedZoneId]);
```

- [ ] **Step 3: Add center crosshair at 8% opacity**

In the Konva Stage, add a permanent alignment guide:

```tsx
<Line points={[stageWidth / 2, 0, stageWidth / 2, stageHeight]} stroke="#9CA3AF" strokeWidth={1} opacity={0.08} />
<Line points={[0, stageHeight / 2, stageWidth, stageHeight / 2]} stroke="#9CA3AF" strokeWidth={1} opacity={0.08} />
```

- [ ] **Step 4: Unique hue per zone**

Assign a unique color from a predefined palette to each placement zone:

```typescript
const ZONE_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444"];

// In the zone rendering:
const zoneColor = ZONE_COLORS[index % ZONE_COLORS.length];
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add app/components/PlacementGeometryEditor.tsx app/routes/app.products.$id.views.$viewId.tsx
git commit -m "feat(view-editor): undo/redo, keyboard nudge, center crosshair, unique zone colors"
```

### Task 10.5: Customer Upload Page — Branding + Dynamic File Types

**Files:**
- Modify: `app/routes/apps.insignia.uploads.tsx` (or the customer upload page route)
- Modify: `app/lib/services/storefront-config.server.ts`
- Modify: `app/components/storefront/CustomizationModal.tsx` (if upload also happens in modal)

- [ ] **Step 1: Pass store branding in the storefront config / upload page**

The customer artwork upload page (`IbX0t` in design) shows "Upload your logo" with no store context. Add the shop name and optionally the brand logo:

```typescript
// In the upload page loader or the /prepare endpoint, include:
const shopName = session.shop.replace(".myshopify.com", "");

// Optionally fetch brand logo via Storefront API (if storefront token available):
// shop.brand.squareLogo.image.url — nullable, many stores won't have it set

// Return to the page:
return json({
  shopName,
  brandLogoUrl: null, // Will be populated if brand assets exist
  // ... other data
});
```

Render at the top of the upload page:
```tsx
<BlockStack gap="200" align="center">
  {brandLogoUrl ? (
    <img src={brandLogoUrl} alt={shopName} style={{ width: 40, height: 40, borderRadius: 8 }} />
  ) : (
    <div style={{
      width: 40, height: 40, borderRadius: 8, background: "#111827",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: 18, fontWeight: 700,
    }}>
      {shopName.charAt(0).toUpperCase()}
    </div>
  )}
  <Text variant="headingLg">Upload your logo</Text>
  <Text tone="subdued">for {shopName}</Text>
</BlockStack>
```

- [ ] **Step 2: Dynamic file type display from method constraints**

The upload page currently hardcodes "SVG, PNG, or JPG · Max 5MB." Replace with dynamic text from the order's method:

```typescript
// In the upload page loader, fetch the order's method constraints:
const order = await db.orderLineCustomization.findFirst({
  where: { id: orderLineId },
  include: {
    customizationConfig: {
      include: { decorationMethod: { select: { artworkConstraints: true } } },
    },
  },
});

const constraints = order?.customizationConfig?.decorationMethod?.artworkConstraints as ArtworkConstraints | null;
const acceptedTypes = constraints?.fileTypes?.length
  ? constraints.fileTypes.map((t: string) => t.toUpperCase()).join(", ")
  : "SVG, PNG, JPG, WebP, GIF"; // default if no constraints set
```

Render dynamically:
```tsx
<Text tone="subdued">{acceptedTypes} · Max 5MB</Text>
```

Also update the `<input accept="">` attribute to match:
```tsx
const acceptString = constraints?.fileTypes?.map((t: string) => {
  const mimeMap: Record<string, string> = {
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", tiff: "image/tiff", heic: "image/heic",
  };
  return mimeMap[t] || `image/${t}`;
}).join(",") || "image/*";
```

- [ ] **Step 3: Add upload progress + error states**

```tsx
const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle");
const [uploadProgress, setUploadProgress] = useState(0);
const [errorMessage, setErrorMessage] = useState("");

// During upload, show progress:
{uploadState === "uploading" && (
  <ProgressBar progress={uploadProgress} size="small" />
)}
{uploadState === "error" && (
  <Banner tone="critical" title="Upload failed">
    <Text>{errorMessage}</Text>
    <Button onClick={handleRetry}>Try again</Button>
  </Banner>
)}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(customer-upload): store branding, dynamic file types from method constraints, progress + error states"
```

### Task 10.6: Preset Application Logic

**Files:**
- Modify: `app/lib/services/product-configs.server.ts`
- Modify: `app/routes/app.products._index.tsx` (Create Setup modal action)

**The Create Setup modal offers presets (T-Shirt, Hoodie, Polo, Cap) but the plan never defines what applying a preset DOES. This task defines and implements preset application.**

- [ ] **Step 1: Define preset templates as data**

```typescript
// In app/lib/services/product-configs.server.ts

type PresetTemplate = {
  name: string;
  views: Array<{ perspective: ViewPerspective; displayOrder: number }>;
  placements: Array<{
    name: string;
    displayOrder: number;
    steps: Array<{ label: string; scaleFactor: number; displayOrder: number }>;
  }>;
};

export const PRESETS: Record<string, PresetTemplate> = {
  "t-shirt": {
    name: "T-Shirt",
    views: [
      { perspective: "front", displayOrder: 0 },
      { perspective: "back", displayOrder: 1 },
    ],
    placements: [
      {
        name: "Left Chest",
        displayOrder: 0,
        steps: [
          { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
          { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
          { label: "Large", scaleFactor: 1.0, displayOrder: 2 },
        ],
      },
      {
        name: "Full Front",
        displayOrder: 1,
        steps: [
          { label: "Standard", scaleFactor: 0.8, displayOrder: 0 },
          { label: "Full", scaleFactor: 1.0, displayOrder: 1 },
        ],
      },
      {
        name: "Full Back",
        displayOrder: 2,
        steps: [
          { label: "Standard", scaleFactor: 0.8, displayOrder: 0 },
          { label: "Full", scaleFactor: 1.0, displayOrder: 1 },
        ],
      },
    ],
  },
  "hoodie": {
    name: "Hoodie",
    views: [
      { perspective: "front", displayOrder: 0 },
      { perspective: "back", displayOrder: 1 },
    ],
    placements: [
      { name: "Left Chest", displayOrder: 0, steps: [
        { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
        { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
      ]},
      { name: "Full Front", displayOrder: 1, steps: [
        { label: "Standard", scaleFactor: 0.8, displayOrder: 0 },
        { label: "Full", scaleFactor: 1.0, displayOrder: 1 },
      ]},
    ],
  },
  "polo": {
    name: "Polo",
    views: [
      { perspective: "front", displayOrder: 0 },
      { perspective: "back", displayOrder: 1 },
      { perspective: "left", displayOrder: 2 },
    ],
    placements: [
      { name: "Left Chest", displayOrder: 0, steps: [
        { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
        { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
      ]},
    ],
  },
  "cap": {
    name: "Cap",
    views: [
      { perspective: "front", displayOrder: 0 },
    ],
    placements: [
      { name: "Front Center", displayOrder: 0, steps: [
        { label: "Small", scaleFactor: 0.6, displayOrder: 0 },
        { label: "Standard", scaleFactor: 1.0, displayOrder: 1 },
      ]},
    ],
  },
};
```

- [ ] **Step 2: Implement `applyPreset` function**

```typescript
export async function applyPreset(
  productConfigId: string,
  presetKey: string
): Promise<void> {
  const preset = PRESETS[presetKey];
  if (!preset) throw new AppError("Unknown preset", "INVALID_INPUT", 400);

  await db.$transaction(async (tx) => {
    // Create views
    for (const view of preset.views) {
      await tx.productView.create({
        data: {
          productConfigId,
          perspective: view.perspective,
          displayOrder: view.displayOrder,
        },
      });
    }

    // Create placements with steps
    for (const placement of preset.placements) {
      const created = await tx.placementDefinition.create({
        data: {
          productConfigId,
          name: placement.name,
          displayOrder: placement.displayOrder,
        },
      });

      for (const step of placement.steps) {
        await tx.placementStep.create({
          data: {
            placementDefinitionId: created.id,
            label: step.label,
            scaleFactor: step.scaleFactor,
            displayOrder: step.displayOrder,
          },
        });
      }
    }
  });
}
```

- [ ] **Step 3: Wire into Create Setup modal action**

In the `create` intent handler of `app/routes/app.products._index.tsx`:

```typescript
if (intent === "create") {
  const name = formData.get("name") as string;
  const presetKey = formData.get("presetKey") as string | null;
  const linkedProductIds = JSON.parse(formData.get("productIds") as string);

  const config = await createProductConfig({ shopId, name, linkedProductIds });

  if (presetKey && PRESETS[presetKey]) {
    await applyPreset(config.id, presetKey);
  }

  return redirect(`/app/products/${config.id}`);
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/product-configs.server.ts app/routes/app.products._index.tsx
git commit -m "feat: preset application logic — T-Shirt, Hoodie, Polo, Cap auto-create views + placements"
```

### Task 10.7: Dashboard Behavioral Gaps

**Files:**
- Modify: `app/routes/app._index.tsx`
- Modify: `app/routes/app.orders._index.tsx`

- [ ] **Step 1: Dashboard "Needs attention" — wait time query**

In the dashboard loader, query artwork-pending orders with wait time:

```typescript
const pendingOrders = await db.orderLineCustomization.findMany({
  where: {
    productConfig: { shopId },
    artworkStatus: "PENDING_CUSTOMER",
  },
  select: {
    id: true,
    shopifyOrderId: true,
    createdAt: true,
    productConfig: { select: { name: true } },
  },
  orderBy: { createdAt: "asc" },
  take: 10,
});

const needsAttention = pendingOrders.map((o) => ({
  ...o,
  waitingDays: Math.floor((Date.now() - o.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
}));
```

- [ ] **Step 2: Make stat cards clickable**

"Artwork pending: 4" should navigate to the Orders list filtered by pending artwork:

```tsx
<div onClick={() => navigate("/app/orders?tab=awaiting")} style={{ cursor: "pointer" }}>
  {/* stat card content */}
</div>
```

- [ ] **Step 3: Analytics tab — show placeholder or remove**

If analytics content isn't V2 scope, show a coming-soon placeholder:

```tsx
{activeTab === "analytics" && (
  <Card>
    <EmptyState heading="Analytics coming soon" image="">
      <Text>Conversion rates, revenue trends, and method popularity will appear here.</Text>
    </EmptyState>
  </Card>
)}
```

- [ ] **Step 4: Orders List — "Awaiting Artwork" tab**

In `app/routes/app.orders._index.tsx`, add the tab filter:

```typescript
// In loader, accept tab param:
const url = new URL(request.url);
const tab = url.searchParams.get("tab") || "all";

const where = tab === "awaiting"
  ? { productConfig: { shopId }, artworkStatus: "PENDING_CUSTOMER" as const }
  : { productConfig: { shopId } };

const orders = await db.orderLineCustomization.findMany({ where, /* ... */ });
```

- [ ] **Step 5: "Manage Images" button disabled when 0 views**

In Product Detail, conditionally disable the button:

```tsx
<Button
  disabled={views.length === 0}
  onClick={() => navigate(`/app/products/${config.id}/images`)}
  variant="primary"
  icon={GridIcon}
>
  Manage Images
</Button>
{views.length === 0 && (
  <Text tone="subdued" variant="bodySm">Add views to start uploading images</Text>
)}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck
git add app/routes/app._index.tsx app/routes/app.orders._index.tsx app/routes/app.products.$id._index.tsx
git commit -m "feat: dashboard wait times, clickable stats, analytics placeholder, awaiting-artwork tab, disabled image button"
```

### Task 10.8: Fix Cross-Feature Connection Bugs

**Purpose:** Three BROKEN connections and three PARTIAL connections found during final audit. These would cause runtime bugs.

#### Bug Fix 1: defaultImageKey not in storefront config (BROKEN)

The storefront config builder constructs `ConfiguredView.imageUrl` by reading `VariantViewConfiguration.imageUrl`. When a variant has no explicit image but the view has `defaultImageKey` (smart defaults), the storefront would show NO image — breaking the customer experience.

**Files:** Modify `app/lib/services/storefront-config.server.ts`

- [ ] **Step 1: Add defaultImageKey fallback to the storefront config builder**

In the function that builds the `views` array of `StorefrontConfig`, add a fallback:

```typescript
// Current (broken):
const imageUrl = vc?.imageUrl ? await getPresignedGetUrl(vc.imageUrl, SIGNED_URL_EXPIRES_SEC) : null;

// Fixed:
const rawImageKey = vc?.imageUrl ?? view.defaultImageKey;
const imageUrl = rawImageKey ? await getPresignedGetUrl(rawImageKey, SIGNED_URL_EXPIRES_SEC) : null;
const isMissingImage = !rawImageKey;
```

This ensures variants with no explicit image inherit the view's default, and customers see a real product photo.

#### Bug Fix 2: Product Detail loader missing color group query (BROKEN)

Product Detail shows per-view rows with "3/3 images" badges. The denominator (total images needed = color group count) requires knowing how many color groups exist, which requires a Shopify GraphQL query for variant options. The Product Detail loader doesn't make this query.

**Files:** Modify `app/routes/app.products.$id._index.tsx`

- [ ] **Step 2: Add color group count to Product Detail loader**

The simplest approach — don't query Shopify. Instead, count distinct `variantId` values per view from existing `VariantViewConfiguration` records, grouped by color option (which we already stored during image upload). Or even simpler: just show the raw count of images uploaded vs total VariantViewConfiguration records expected.

```typescript
// In the Product Detail loader, for each view:
const imageStats = await db.variantViewConfiguration.groupBy({
  by: ["viewId"],
  where: { productConfigId },
  _count: { _all: true },
});

const imageFilledStats = await db.variantViewConfiguration.groupBy({
  by: ["viewId"],
  where: { productConfigId, imageUrl: { not: null } },
  _count: { _all: true },
});

// For each view, total = all VVCs for that view, filled = non-null imageUrl
// This avoids a Shopify GraphQL call entirely
```

If no VariantViewConfigurations exist yet (fresh product), show "No images" instead of "0/0".

#### Bug Fix 3: Upload queue rapid revalidation (BROKEN)

4 concurrent uploads completing simultaneously trigger 4 `submit()` calls → 4 action executions → 4 loader revalidations (each with a Shopify GraphQL call). This causes UI flicker and potential race conditions.

**Files:** Modify `app/routes/app.products.$id.images.tsx` (Task 9.5)

- [ ] **Step 3: Replace per-upload submit with batch save + single revalidation**

Instead of calling `submit()` after each upload, accumulate completed uploads and batch-save:

```typescript
const pendingSaves = useRef<Array<{ viewId: string; variantId: string; storageKey: string }>>([]);
const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

function queueSave(viewId: string, variantId: string, storageKey: string) {
  pendingSaves.current.push({ viewId, variantId, storageKey });

  // Debounce: batch-save 500ms after the last completed upload
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    const batch = [...pendingSaves.current];
    pendingSaves.current = [];

    await fetch("/api/admin/batch-save-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productConfigId: config.id,
        images: batch.map((s) => ({
          viewId: s.viewId,
          variantIds: [s.variantId], // Single variant per save
          storageKey: s.storageKey,
        })),
      }),
    });

    revalidator.revalidate(); // ONE revalidation for the whole batch
  }, 500);
}
```

In `processUpload` (Task 9.5 Step 3), replace the `submit()` call with:
```typescript
// Instead of: submit(formData, { method: "POST" });
queueSave(job.viewId, job.variantId, storageKey);
```

#### Partial Fix 4: Shared "awaiting artwork" query

**Files:** Create helper in `app/lib/services/views.server.ts` or a new `app/lib/services/orders.server.ts`

- [ ] **Step 4: Extract shared awaiting-artwork query**

```typescript
// app/lib/services/orders.server.ts (or add to existing)
export async function getAwaitingArtworkCount(shopId: string): Promise<number> {
  return db.orderLineCustomization.count({
    where: {
      productConfig: { shopId },
      artworkStatus: "PENDING_CUSTOMER",
    },
  });
}

export async function getAwaitingArtworkOrders(shopId: string, limit = 10) {
  return db.orderLineCustomization.findMany({
    where: {
      productConfig: { shopId },
      artworkStatus: "PENDING_CUSTOMER",
    },
    select: {
      id: true,
      shopifyOrderId: true,
      createdAt: true,
      productConfig: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
```

Use `getAwaitingArtworkCount` in BOTH the Dashboard loader and the Orders List loader.

#### Partial Fix 5: Order status URL for customer confirmed page

**Files:** Modify `app/routes/webhooks.orders.create.tsx` + customer upload routes

- [ ] **Step 5: Store order status URL when order webhook fires**

The Shopify `Order` object has a `statusPageUrl` field (the customer-facing order status page). When the `orders/create` webhook fires, store this URL on the `OrderLineCustomization`:

First, add the field to the schema:
```prisma
model OrderLineCustomization {
  // ... existing fields
  orderStatusUrl String?  // NEW: Shopify customer-facing order status page URL
}
```

In the webhook handler, populate it from the order data. Then on the customer upload confirmed page, render:

```tsx
<Link url={orderStatusUrl || `https://${shop}/account`}>
  ← Back to order status
</Link>
```

#### Partial Fix 6: Preset tracking on ProductConfig

- [ ] **Step 6: Add presetKey to ProductConfig schema**

```prisma
model ProductConfig {
  // ... existing fields
  presetKey String?  // NEW: "t-shirt", "hoodie", "polo", "cap", or null if blank
}
```

Set when a preset is applied during creation (Task 10.6 Step 3). The progress checklist can then check `config.presetKey != null` for the "Preset applied" item instead of inferring from views/placements.

- [ ] **Step 7: Run migration for new fields**

```bash
npx prisma migrate dev --name add_order_status_url_and_preset_key
npx prisma validate
npm run typecheck
```

- [ ] **Step 8: Verify and commit**

```bash
git add -A
git commit -m "fix: 3 broken connections + 3 partial — defaultImageKey fallback, color group counts, batch revalidation, shared queries, order status URL, preset tracking"
```

### Task 10.9: Pricing Bug — Method basePriceCents Not Charged (CRITICAL)

**This is a money bug.** The storefront shows `method.basePriceCents` in the estimated total, but the server-side pricing function `computeCustomizationPrice()` never includes it. Customers see one price, get charged less. Merchants lose money on every order.

**Files:**
- Modify: `app/lib/services/storefront-customizations.server.ts`

- [ ] **Step 1: Add method basePriceCents to the server-side pricing computation**

In `computeCustomizationPrice()`, look up the method and add its base price:

```typescript
// Current (broken) — only sums placements:
// feeCents = sum of placement step priceAdjustmentCents + placement basePriceAdjustmentCents

// Fixed — also include method base price:
const method = await db.decorationMethod.findUnique({
  where: { id: methodId },
  select: { basePriceCents: true },
});

const methodBaseCents = method?.basePriceCents ?? 0;
const placementFeeCents = /* existing placement pricing calculation */;
const feeCents = methodBaseCents + placementFeeCents;
const unitPriceCents = baseGarmentCents + feeCents;
```

This must match what the client-side `estimatedTotal` shows to the customer. If they don't match, the customer sees a price shock at checkout.

- [ ] **Step 2: Verify the /price endpoint also includes method base price**

Check `app/routes/apps.insignia.price.tsx` — the endpoint that returns the price preview to the storefront modal. Ensure it calls the same `computeCustomizationPrice` function (not a separate calculation) so the preview and the actual charge always match.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/storefront-customizations.server.ts app/routes/apps.insignia.price.tsx
git commit -m "fix(critical): include method basePriceCents in server-side pricing — was displayed but never charged"
```

### Task 10.10: Minor Connection Fixes

- [ ] **Step 1: Webhook — extract orderStatusUrl**

In `app/routes/webhooks.orders.create.tsx`, when creating `OrderLineCustomization` records, extract the order status URL from the webhook payload:

```typescript
// The Shopify orders/create webhook payload includes order_status_url
const orderStatusUrl = payload.order_status_url ?? null;

// Pass to the create call:
await db.orderLineCustomization.create({
  data: {
    // ... existing fields
    orderStatusUrl,
  },
});
```

- [ ] **Step 2: Image Manager — mobile tap-to-assign fallback**

Add `onClick` handlers alongside drag events on the Image Tray and color cards for touch devices:

```typescript
// On tray images, add tap-to-select:
const [selectedTrayImage, setSelectedTrayImage] = useState<TrayImage | null>(null);

// On tray thumbnails:
onClick={() => setSelectedTrayImage(img)}

// On color cards, add tap-to-assign:
onClick={() => {
  if (selectedTrayImage) {
    handleAssignImageToCell(selectedTrayImage, cell);
    setSelectedTrayImage(null);
  }
}}
```

Add a helper text when a tray image is selected: "Tap a color card below to assign this image."

- [ ] **Step 3: Document last-write-wins as accepted behavior**

Add a comment at the top of `batchSaveImages` in `image-manager.server.ts`:

```typescript
/**
 * Concurrent edits use last-write-wins. This is acceptable because:
 * - Typically one merchant edits at a time
 * - No data corruption risk (upsert serializes at DB level)
 * - Optimistic locking is deferred to V3 if multi-user editing becomes common
 */
```

- [ ] **Step 4: R2 orphan cleanup note**

When a merchant re-uploads with a different file extension (e.g., replaces .png with .jpg), the old R2 object becomes orphaned. Add cleanup in the upload flow:

```typescript
// Before uploading, delete the old image if it exists with a different key
const existing = await db.variantViewConfiguration.findUnique({
  where: { productConfigId_variantId_viewId: { productConfigId, variantId, viewId } },
  select: { imageUrl: true },
});
if (existing?.imageUrl && existing.imageUrl !== newStorageKey) {
  try { await deleteObject(existing.imageUrl); } catch { /* ignore — orphan is non-critical */ }
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "fix: webhook orderStatusUrl, mobile tap fallback, R2 orphan cleanup, document last-write-wins"
```

### Task 10.11: Fix Hardcoded "USD" Currency in Storefront Config (BUG)

**Pre-existing bug.** `storefront-config.server.ts` line 238 uses `DEFAULT_CURRENCY` ("USD") instead of `shop.currencyCode`. A EUR merchant's customers see "$" instead of "€". All cent values are already in the shop's currency — only the display symbol is wrong.

**Files:**
- Modify: `app/lib/services/storefront-config.server.ts`

- [ ] **Step 1: Read shop.currencyCode from DB and use it**

```typescript
// Current (broken):
const currency = DEFAULT_CURRENCY; // always "USD"

// Fixed:
const shop = await db.shop.findUnique({
  where: { id: shopId },
  select: { currencyCode: true },
});
const currency = shop?.currencyCode || "USD";
```

Ensure this propagates to `StorefrontConfig.currency` which the modal uses for `formatCurrency()`.

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck
git add app/lib/services/storefront-config.server.ts
git commit -m "fix: use shop.currencyCode instead of hardcoded USD in storefront config"
```

### Task 10.12: Handle Deleted Shopify Products in linkedProductIds

**A merchant deletes a Shopify product that's linked to a ProductConfig.** The `linkedProductIds` array still references the deleted GID. The Image Manager and Product Detail break silently.

**Files:**
- Modify: `app/routes/app.products.$id._index.tsx`
- Modify: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Defensive filter in Product Detail loader**

When the loader fetches linked product names from Shopify, handle null responses:

```typescript
// Query Shopify for linked products — some may have been deleted
const productResults = await Promise.all(
  config.linkedProductIds.map(async (pid) => {
    try {
      const res = await admin.graphql(`#graphql
        query GetProduct($id: ID!) { product(id: $id) { id title } }
      `, { variables: { id: pid } });
      const data = await res.json();
      return data.data?.product; // null if deleted
    } catch { return null; }
  })
);

const linkedProducts = productResults.filter(Boolean);
const deletedProductIds = config.linkedProductIds.filter(
  (pid) => !productResults.find((p) => p?.id === pid)
);
```

If `deletedProductIds.length > 0`, show a warning Banner: "1 linked product was deleted from your Shopify store. Remove it from this product setup."

- [ ] **Step 2: Same defensive handling in Image Manager loader**

In the Image Manager, if the Shopify product query returns null, show an EmptyState: "The linked Shopify product was deleted. Update the product setup to link a new product."

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.products.$id._index.tsx app/routes/app.products.$id.images.tsx
git commit -m "fix: handle deleted Shopify products gracefully in Product Detail and Image Manager"
```

### Task 10.13: Admin Image Manager — Presigned URL Refresh

**Presigned GET URLs expire after 10 minutes.** A merchant spending 20+ minutes on the Image Manager sees broken thumbnails. The storefront has a refresh mechanism (Task 9.3) but the admin does not.

**Files:**
- Modify: `app/routes/app.products.$id.images.tsx`

- [ ] **Step 1: Use longer TTL for admin presigned URLs**

In the Image Manager loader, use 1-hour TTL instead of 10 minutes:

```typescript
const ADMIN_SIGNED_URL_EXPIRES_SEC = 3600; // 1 hour for admin editing sessions

// When generating presigned URLs for the image matrix:
const imageUrl = rawImageKey
  ? await getPresignedGetUrl(rawImageKey, ADMIN_SIGNED_URL_EXPIRES_SEC)
  : null;
```

- [ ] **Step 2: Add client-side staleness detection**

If the merchant has been on the page for over 50 minutes, show a subtle Banner prompting a page refresh:

```typescript
const [pageLoadTime] = useState(Date.now());
const STALE_THRESHOLD_MS = 50 * 60 * 1000; // 50 minutes

useEffect(() => {
  const timer = setInterval(() => {
    if (Date.now() - pageLoadTime > STALE_THRESHOLD_MS) {
      setShowRefreshBanner(true);
    }
  }, 60_000); // check every minute
  return () => clearInterval(timer);
}, [pageLoadTime]);

{showRefreshBanner && (
  <Banner tone="warning" onDismiss={() => setShowRefreshBanner(false)}>
    Image previews may have expired. <Button variant="plain" onClick={() => window.location.reload()}>Refresh page</Button>
  </Banner>
)}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
git add app/routes/app.products.$id.images.tsx
git commit -m "fix: 1-hour presigned URLs for admin Image Manager + staleness banner"
```

### Task 10.14: Terminology Sweep

**Purpose:** A systematic grep-and-fix pass across the entire codebase for wrong terminology. NOT passive guidance — an actual verifiable task.

- [ ] **Step 1: Search and replace "configuration" → "product setup" in user-facing strings**

```bash
grep -rn "configuration" app/routes/ app/components/ --include="*.tsx" --include="*.ts" | grep -i "label\|content\|title\|heading\|description\|text\|message"
```

Review each match. Replace "configuration" with "product setup" in user-facing strings only (not variable names or technical references).

- [ ] **Step 2: Search for "template" (should be "preset")**

```bash
grep -rn '"template\|Template' app/routes/ app/components/ --include="*.tsx" --include="*.ts"
```

Replace "template" with "preset" in user-facing strings.

- [ ] **Step 3: Search for "placement zone" in admin (should be "print area")**

```bash
grep -rn "placement zone\|Placement zone\|placement_zone" app/routes/app.* app/components/*.tsx --include="*.tsx" --include="*.ts"
```

Replace with "print area" in admin context.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck
npm run lint
git add -A
git commit -m "chore: terminology sweep — configuration→product setup, template→preset, placement zone→print area"
```

### Task 10.15: UX Refinements

- [ ] **Step 1: Single-size — show "Fixed size: [label]" instead of skipping**

In `SizeStep.tsx`, when only 1 tier, don't auto-skip. Show a non-interactive display:

```tsx
if (placement.steps.length === 1) {
  const fixedTier = placement.steps[0];
  return (
    <BlockStack gap="400">
      <Text variant="headingMd">Logo size</Text>
      <Banner tone="info">
        <Text>Fixed size: {fixedTier.label}</Text>
      </Banner>
      <Button variant="primary" onClick={onNext}>Continue</Button>
    </BlockStack>
  );
}
```

- [ ] **Step 2: 1-method — collapse/hide the method selection**

In `UploadStep.tsx`, when only 1 method, auto-select AND visually collapse the selector:

```tsx
{methods.length === 1 ? (
  <Text variant="bodySm" tone="subdued">Method: {methods[0].customerName || methods[0].name}</Text>
) : (
  <MethodSelector methods={methods} selected={selectedMethod} onSelect={onSelectMethod} />
)}
```

- [ ] **Step 3: Artwork re-upload — merchant-side on Order Detail**

In `app/routes/app.orders.$id.tsx`, ensure the artwork upload section always shows a "Replace artwork" button even after artwork is provided:

```tsx
{artworkProvided && (
  <InlineStack gap="200">
    <Badge tone="success">Artwork provided</Badge>
    <Button variant="plain" onClick={handleReplaceArtwork}>Replace</Button>
  </InlineStack>
)}
```

- [ ] **Step 4: Size disambiguation in admin (View Editor ZonePricingPanel)**

In the zone pricing panel, label the tiers section "Logo size tiers" (not "Size tiers" or just "Size options"):

```tsx
<Text variant="headingSm">Logo size tiers</Text>
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: UX refinements — fixed size display, 1-method collapse, merchant re-upload, logo size label"
```

---

## Appendix A: State Matrix

Every component with multiple states must implement ALL of these:

| Component | Empty | Loading | Error | Partial | Complete |
|-----------|-------|---------|-------|---------|----------|
| Image Manager page | "Link a product first" | SkeletonPage | Banner critical | View tabs show partial counts | "All images assigned" Banner |
| Image Tray | "Import or upload images" | Skeleton thumbnails | Toast error | Shows count badge | Auto-collapses |
| Color group card | Dashed border + "Add" | Progress ring | Red border + retry | N/A (per-card) | Green check + thumbnail |
| View Editor | "Add views first" | SkeletonPage | Banner critical | Zones partially placed | All zones placed |
| Zone pricing panel | "Add a print area" | Inline spinner | Toast error | Some fields empty | All priced |
| Method Detail | "Method not found" | SkeletonPage | Banner critical | Some fields empty | All fields filled |
| Dashboard guide | All steps pending | N/A | N/A | 1-3 of 4 complete | "Setup complete!" |
| Settings theme | "Not yet added" warning | N/A | N/A | N/A | "Block active" success |

## Appendix B: Storefront Config Contract

The `StorefrontConfig` type (in `storefront-config.server.ts`) is the integration boundary. After V2, it includes:

```typescript
type StorefrontConfig = {
  // ... existing fields unchanged
  methods: Array<{
    id: string;
    name: string;
    basePriceCents: number;
    customerName: string | null;       // NEW Phase 2
    customerDescription: string | null; // NEW Phase 2
  }>;
  // ... views, placements unchanged
};
```

**Rule:** Every field added to this type must be:
1. Populated in the config builder (`storefront-config.server.ts`)
2. Consumed in the storefront modal component
3. Handled gracefully when `null` (fallback to existing field)

## Appendix C: Terminology Map

Apply during ALL phases. When touching any file, check these:

| Wrong | Correct (admin) | Correct (storefront) |
|-------|-----------------|---------------------|
| "configuration" | "product setup" | — |
| "template" | "preset" | — |
| "placement zone" | "print area" | "placement" |
| "Size" (step header) | "Logo size tiers" | "Logo size" |
| "Total so far" | — | "Estimated total" |
| "Awaiting" | "Artwork pending" | "Artwork pending" |

## Appendix D: Files Changed Per Phase

| Phase | Files Created | Files Modified | Files Deleted |
|-------|-------------|---------------|---------------|
| 0 | 1 migration | 1 (schema.prisma) | 0 |
| 1 | 4 (service + 3 endpoints) | 1 (methods.server.ts) | 0 |
| 2 | 0 | 3 (method route + storefront config + UploadStep) | 0 |
| 3 | 1 (image manager route) | 0 | 0 |
| 4 | 1 (ZonePricingPanel) | 1 (view editor route) | 2 (placement routes) |
| 5 | 0 | 1 (product detail route) | 0 |
| 6 | 0 | 1 (settings route) | 0 |
| 7 | 0 | 1 (dashboard route) | 0 |
| 8 | 0 | 6 (storefront components + config) | 0 |
| 9 | 1 (URL refresh endpoint) | 6 (create modal, view editor, geometry editor, image manager, methods list, orders) | 0 |
| 10 | 1 (ImageTray.tsx) | 8 (security patches, behavioral guards, DnD, validation across all endpoints) | 0 |
| **Total** | **9 new files** | **29 modified** | **2 deleted** |
