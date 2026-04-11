# Geometry Snapshot Specification (canonical)

This file specifies how placement geometry is snapshotted at order creation and used for immutable, historical order accuracy.

## Overview

`placementGeometrySnapshotByViewId` is an immutable copy of placement geometry captured at order finalization. It:

- **Never changes** (WORM – write-once-read-many)
- **Captures the exact state** when order was placed
- **Enables accurate fulfillment** (print-on-demand knows exact spec)
- **Enables dispute resolution** (proves what customer ordered)

## Problem It Solves

### Current Issue (Without Geometry Snapshot)

```
2026-01-31 10:00 UTC
  Customer orders embroidered polo
  Placement center position: x=50%, y=50%
  Order created in system

2026-02-05
  Merchant edits placement config
  New center position: x=40%, y=40% (moved logo higher)

2026-02-10
  Admin dashboard shows order preview
  Displays: x=40%, y=40%  ❌ WRONG
  Customer ordered at x=50%, y=50%
  Merchant reprints based on wrong preview
  ❌ Fulfillment error
```

### Solution (With Geometry Snapshot)

```
2026-01-31 10:00 UTC
  Customer orders embroidered polo
  Placement center position: x=50%, y=50%
  placementGeometrySnapshotByViewId captured for order view
  Order created in system

2026-02-05
  Merchant edits placement config
  New center position: x=40%, y=40%

2026-02-10
  Admin dashboard shows order preview
  Loads placementGeometrySnapshotByViewId from order record
  Displays: x=50%, y=50%  ✅ CORRECT
  Merchant has accurate data for fulfillment
```

## Implementation

### Schema Changes

Add `placement_geometry_snapshot_by_view_id` to `order_line_customizations`:

```sql
CREATE TABLE order_line_customizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL,
  customization_config_id UUID NOT NULL,
  shopify_order_id VARCHAR NOT NULL,
  shopify_line_item_id VARCHAR NOT NULL,
  variant_id VARCHAR NOT NULL,
  
  -- Immutable geometry snapshot (per view)
  placement_geometry_snapshot_by_view_id JSONB, -- ← NEW: optional, immutable WORM
  
  -- Other fields...
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (shop_id, shopify_order_id, shopify_line_item_id)
);

-- Prevent accidental updates to snapshot
CREATE TRIGGER immutable_geometry_snapshot
BEFORE UPDATE ON order_line_customizations
FOR EACH ROW
WHEN (OLD.placement_geometry_snapshot_by_view_id IS DISTINCT FROM NEW.placement_geometry_snapshot_by_view_id)
DO RAISE EXCEPTION 'placement_geometry_snapshot_by_view_id is immutable';
```

**Schema for `placement_geometry_snapshot_by_view_id`:**

```json
{
  "view_uuid_1": {
    "placement_uuid_1": {
      "centerXPercent": 50,
      "centerYPercent": 50,
      "maxWidthPercent": 30
    },
    "placement_uuid_2": {
      "centerXPercent": 75,
      "centerYPercent": 25,
      "maxWidthPercent": 20
    }
  },
  "view_uuid_2": {
    "placement_uuid_3": {
      "centerXPercent": 10,
      "centerYPercent": 20,
      "maxWidthPercent": 40
    }
  }
}
```

### Capture at Order Creation

When webhook processes `orders/create`, capture current geometry for each order line view:

```typescript
async function handleOrdersCreate(event: WebhookEvent) {
  for (const line of event.line_items) {
    const customizationId = line.properties._insignia_customization_id;
    if (!customizationId) continue;
    
    // Resolve the customization to get its config and variant/view info
    const customization = await Customizations.findById(customizationId);
    const config = await ProductConfigs.findById(customization.product_config_id);
    
    const geometrySnapshotByViewId = {};
    for (const view of config.views) {
      const variantViewConfig = await VariantViewConfigurations.findOne({
        product_config_id: config.id,
        variant_id: line.variant_id,
        view_id: view.id,
      });

      if (!variantViewConfig) continue; // This view not configured for this variant; skip

      geometrySnapshotByViewId[view.id] = variantViewConfig.placement_geometry || {};
    }

    // Create order line record with snapshot map
    await OrderLineCustomizations.create({
      shop_id: shop.id,
      customization_config_id: customization.customization_config_id,
      shopify_order_id: event.order_id,
      shopify_line_item_id: line.id,
      variant_id: line.variant_id,
      placement_geometry_snapshot_by_view_id: geometrySnapshotByViewId, // ← IMMUTABLE SNAPSHOT
      artwork_status: 'PROVIDED',
    });
  }
}
```

### Usage in Order Preview Rendering

When admin dashboard displays order preview, use snapshot (not live config):

```typescript
async function getOrderPreview(
  shop_id: UUID,
  order_id: string,
  line_item_id: string,
  view_id: UUID
): Promise<PreviewData> {
  // Load order line customization with snapshot for this specific view
  const orderLine = await OrderLineCustomizations.findOne({
    shop_id,
    shopify_order_id: order_id,
    shopify_line_item_id: line_item_id,
  });
  
  if (!orderLine) return 404("Order line not found");
  
  // Determine which geometry to use:
  // 1. Prefer immutable snapshot (proves what was ordered)
  // 2. Fall back to live config if snapshot missing (legacy orders)
  let geometrySnapshot =
    orderLine.placement_geometry_snapshot_by_view_id?.[view_id] || null;
  
  if (!geometrySnapshot) {
    // Legacy order without snapshot; use current config
    // (Less accurate, but better than nothing)
    const variantViewConfig = await VariantViewConfigurations.findOne({
      variant_id: orderLine.variant_id,
      view_id: orderLine.view_id,
    });
    geometrySnapshot = variantViewConfig?.placement_geometry || {};
  }
  
  // Load view image for this variant
  const variantViewConfig = await VariantViewConfigurations.findOne({
    variant_id: orderLine.variant_id,
    view_id: orderLine.view_id,
  });
  
  // Generate preview using snapshot geometry + view image
  const preview = await generatePreview({
    viewImage: variantViewConfig.image_url,
    placements: geometrySnapshot,
    logoAssetId: orderLine.config.logo_asset_id,
  });
  
  return preview; // ✅ Shows correct geometry from snapshot
}
```

## Immutability Guarantee

After order creation:

✅ **Snapshot never changes** – Database constraint prevents updates
✅ **Snapshot is self-contained** – No external references that can change
✅ **Snapshot is historical** – Reflects state at order time, not current state
✅ **Snapshot is auditable** – Proves what customer ordered

## Query Pattern for Admin Views

When loading order data, always join through snapshot (with fallback to live if missing):

```sql
-- ✅ CORRECT: Uses immutable snapshot when available
SELECT 
  olc.shopify_order_id,
  olc.placement_geometry_snapshot_by_view_id, -- ← IMMUTABLE SNAPSHOT
  COALESCE(
    olc.placement_geometry_snapshot_by_view_id -> $2,
    vvc.placement_geometry  -- ← FALLBACK for legacy orders
  ) AS active_geometry,
  vvc.image_url
FROM order_line_customizations olc
JOIN variant_view_configurations vvc 
  ON vvc.variant_id = olc.variant_id 
  AND vvc.view_id = $2
WHERE olc.shopify_order_id = $1;
```

## Migration for Existing Orders (If Applicable)

For MVP (no existing orders), this is not needed. For production:

```sql
-- Back-fill geometry snapshot for existing orders
UPDATE order_line_customizations olc
SET placement_geometry_snapshot_by_view_id = vvc.placement_geometry
FROM variant_view_configurations vvc
WHERE olc.variant_id = vvc.variant_id
AND olc.view_id = vvc.view_id
AND olc.placement_geometry_snapshot_by_view_id IS NULL;
```

## Guarantees

✅ **Historical accuracy** – Order preview always matches what customer saw
✅ **Fulfillment correctness** – Exact geometry for print-on-demand
✅ **Dispute resolution** – Immutable proof of order spec
✅ **Audit trail** – Configuration changes don't affect historical orders

## Canonical References

- Data schemas: [`./data-schemas.md`](./data-schemas.md)
- Webhooks contract: [`./api-contracts/webhooks.md`](./api-contracts/webhooks.md)
- Order rendering: [`../admin/order-detail-rendering.md`](../admin/order-detail-rendering.md)
