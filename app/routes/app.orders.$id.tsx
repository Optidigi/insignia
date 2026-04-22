/**
 * Order detail page — shows customization details per line item.
 * Includes Logo Later status and artwork upload.
 * Canonical: docs/admin/order-detail-rendering.md, docs/admin/orders-workflow.md
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { ProductionStatus } from "@prisma/client";
import OrderDetail from "../components/admin/orders/OrderDetail";
import { authenticate } from "../shopify.server";
import { syncOrderTags } from "../lib/services/order-tags.server";
import {
  SaveNoteSchema,
  createOrderNote,
  listOrderNotes,
} from "../lib/services/order-notes.server";
import db from "../db.server";
import { handleError } from "../lib/errors.server";
import { getPresignedDownloadUrl, getPresignedGetUrl } from "../lib/storage.server";
import type { PlacementGeometry } from "../lib/admin-types";


const PRODUCTION_STATUS_ORDER: ProductionStatus[] = [
  ProductionStatus.ARTWORK_PENDING,
  ProductionStatus.ARTWORK_PROVIDED,
  ProductionStatus.IN_PRODUCTION,
  ProductionStatus.QUALITY_CHECK,
  ProductionStatus.SHIPPED,
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopifyOrderId = decodeURIComponent(params.id ?? "");

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Scope by shop to prevent cross-tenant order data exposure. Shopify order GIDs
  // are not secrets — without this filter, an authenticated admin at Shop A could
  // view Shop B's order customizations by constructing a URL with Shop B's order ID.
  const orderLines = await db.orderLineCustomization.findMany({
    where: {
      shopifyOrderId,
      productConfig: { shopId: shop.id },
    },
    include: {
      productConfig: {
        select: {
          id: true,
          name: true,
          views: {
            include: {
              placements: { include: { steps: true }, orderBy: { displayOrder: "asc" } },
            },
          },
        },
      },
      customizationConfig: {
        select: {
          id: true,
          unitPriceCents: true,
          methodId: true,
          customizationDraftId: true,
          decorationMethod: { select: { name: true } },
        },
      },
    },
  });

  if (orderLines.length === 0) {
    throw new Response("Order not found", { status: 404 });
  }

  const logoAssetIds = new Set<string>();
  for (const line of orderLines) {
    const map = line.logoAssetIdsByPlacementId as Record<string, string | null> | null;
    if (map) {
      Object.values(map).forEach((id) => { if (id) logoAssetIds.add(id); });
    }
  }

  const logoAssets = logoAssetIds.size > 0
    ? await db.logoAsset.findMany({
        where: { id: { in: Array.from(logoAssetIds) }, shopId: shop.id },
      })
    : [];

  // Generate presigned download URLs and preview URLs for each asset
  const logoAssetDownloadUrls: Record<string, string> = {};
  const logoAssetPreviewUrls: Record<string, string> = {};
  await Promise.all(
    logoAssets.map(async (a) => {
      try {
        if (a.sanitizedSvgUrl) {
          logoAssetDownloadUrls[a.id] = await getPresignedDownloadUrl(
            a.sanitizedSvgUrl,
            sanitizeFilename(a.originalFileName ?? "logo.svg")
          );
        } else if (a.previewPngUrl) {
          if (!a.previewPngUrl.startsWith("http")) {
            logoAssetDownloadUrls[a.id] = await getPresignedDownloadUrl(
              a.previewPngUrl,
              sanitizeFilename(a.originalFileName ?? "logo.png")
            );
          } else {
            // Already a full URL (R2_PUBLIC_URL configured) — use directly
            logoAssetDownloadUrls[a.id] = a.previewPngUrl;
          }
        }
        const previewUrl = a.previewPngUrl && !a.previewPngUrl.startsWith("http")
          ? await getPresignedGetUrl(a.previewPngUrl, 3600)
          : (a.previewPngUrl || null);
        logoAssetPreviewUrls[a.id] = previewUrl || "";
      } catch (e) {
        console.error(`[OrderDetail] Failed to generate download URL for asset ${a.id}:`, e);
      }
    })
  );

  const logoAssetMap = Object.fromEntries(logoAssets.map((a) => [a.id, a]));

  const settings = await db.merchantSettings.findUnique({
    where: { shopId: shop.id },
    select: { placeholderLogoImageUrl: true, emailReminderTemplate: true, productionQcEnabled: true },
  });

  // Fetch order details from Shopify Admin GraphQL: customer info + line item prices
  let customer: { name: string; email: string } | null = null;
  const shopifyLineItemPrices: Record<string, { amount: string; currencyCode: string; quantity: number }> = {};
  const shopifyVariantTitles: Record<string, string> = {};
  const allShopifyLineItems: Array<{ id: string; title: string; quantity: number; variantTitle: string; amount: string; currencyCode: string }> = [];
  let currencyCode = shop.currencyCode ?? "";
  let orderDataError = false;
  const idNum = shopifyOrderId.replace(/\D/g, "");
  let orderName = `#${idNum.slice(-6)}`; // fallback until GraphQL returns name
  try {
    const orderResponse = await admin.graphql(
      `#graphql
      query GetOrderDetails($id: ID!) {
        order(id: $id) {
          name
          currencyCode
          customer {
            firstName
            lastName
            email
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                quantity
                variant {
                  title
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: shopifyOrderId } }
    );
    const orderData = (await orderResponse.json()) as {
      data?: {
        order?: {
          name?: string;
          currencyCode?: string;
          customer?: { firstName?: string; lastName?: string; email?: string } | null;
          lineItems?: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                quantity: number;
                variant?: { title?: string } | null;
                originalUnitPriceSet: {
                  shopMoney: { amount: string; currencyCode: string };
                };
              };
            }>;
          };
        } | null;
      };
      errors?: unknown;
    };
    if (orderData.errors) {
      console.error("[GetOrderDetails] GraphQL errors:", orderData.errors);
      orderDataError = true;
    }
    const shopifyOrder = orderData.data?.order;
    if (shopifyOrder) {
      currencyCode = shopifyOrder.currencyCode ?? "USD";
      if (shopifyOrder.name) orderName = shopifyOrder.name;
      const firstName = shopifyOrder.customer?.firstName ?? "";
      const lastName = shopifyOrder.customer?.lastName ?? "";
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      const email = shopifyOrder.customer?.email ?? "";
      if (fullName || email) {
        customer = { name: fullName || email, email };
      }
      for (const edge of shopifyOrder.lineItems?.edges ?? []) {
        shopifyLineItemPrices[edge.node.id] = {
          amount: edge.node.originalUnitPriceSet.shopMoney.amount,
          currencyCode: edge.node.originalUnitPriceSet.shopMoney.currencyCode,
          quantity: edge.node.quantity,
        };
        shopifyVariantTitles[edge.node.id] = edge.node.variant?.title ?? "";
        allShopifyLineItems.push({
          id: edge.node.id,
          title: edge.node.title,
          quantity: edge.node.quantity,
          variantTitle: edge.node.variant?.title ?? "",
          amount: edge.node.originalUnitPriceSet.shopMoney.amount,
          currencyCode: edge.node.originalUnitPriceSet.shopMoney.currencyCode,
        });
      }
    }
  } catch (e) {
    console.error("[GetOrderDetails] unexpected error:", e);
    orderDataError = true;
  }

  type ViewPreview = {
    viewId: string;
    viewName: string;
    imageUrl: string;
    geometry: Record<string, PlacementGeometry | null>;
    logoUrls: Record<string, string | null>;
    calibrationPxPerCm: number | null;
  };

  // --- Per-line view preview data (Konva canvas) — all views per line ---
  const linePreviewData: Record<string, ViewPreview[] | null> = {};

  await Promise.all(
    orderLines.map(async (line) => {
      if (!line.productConfig) {
        linePreviewData[line.id] = null;
        return;
      }

      const variantConfigs = await db.variantViewConfiguration.findMany({
        where: {
          productConfigId: line.productConfig.id,
          variantId: line.variantId,
        },
        include: {
          productView: {
            select: { id: true, name: true, perspective: true, placementGeometry: true, sharedZones: true, calibrationPxPerCm: true },
          },
        },
      });
      // Unnamed-view counter scoped per line — used only as the final
      // fallback when BOTH name and perspective are null/empty.
      let unnamedViewCounter = 0;

      const snapshot = line.placementGeometrySnapshotByViewId as Record<string, Record<string, PlacementGeometry | null> | null> | null;

      // Build logoUrls map shared across all views for this line
      const logoUrlsForLine: Record<string, string | null> = {};
      if (line.logoAssetIdsByPlacementId) {
        for (const [placementId, logoId] of Object.entries(line.logoAssetIdsByPlacementId as Record<string, string | null>)) {
          logoUrlsForLine[placementId] = logoId ? (logoAssetPreviewUrls[logoId] || null) : null;
        }
      }

      const views: ViewPreview[] = [];
      for (const vc of variantConfigs) {
        if (!vc.imageUrl) continue;
        const viewId = vc.productView?.id;
        if (!viewId) continue;

        let geometry: Record<string, PlacementGeometry | null>;
        if (!line.useLiveConfigFallback && snapshot && snapshot[viewId]) {
          geometry = (snapshot[viewId] ?? {}) as Record<string, PlacementGeometry | null>;
        } else {
          const sharedZones = vc.productView?.sharedZones ?? true;
          const sharedGeometry = (vc.productView?.placementGeometry ?? null) as Record<string, PlacementGeometry | null> | null;
          const perVariantGeometry = (vc.placementGeometry ?? null) as Record<string, PlacementGeometry | null> | null;
          geometry = sharedZones
            ? (sharedGeometry ?? perVariantGeometry ?? {})
            : (perVariantGeometry ?? sharedGeometry ?? {});
        }

        let signedImageUrl: string | null = null;
        try {
          const rawKey = vc.imageUrl;
          const key = rawKey.startsWith("shops/")
            ? rawKey
            : rawKey.split("/").slice(-4).join("/");
          signedImageUrl = await getPresignedGetUrl(key, 3600);
        } catch (e) {
          console.error(`[OrderDetail] failed to sign image URL for line ${line.id} view ${viewId}:`, e);
        }

        if (signedImageUrl) {
          // Mirror the storefront + view-editor naming precedence:
          //   explicit `name` → capitalized `perspective` ("Front" / "Back")
          //   → indexed fallback ("View 1"). See PlacementStep.viewName +
          //   getPerspectiveLabel. DO NOT regress this to `name ?? "View"` —
          //   merchants often leave `name` null and rely on perspective.
          const rawName = vc.productView?.name;
          const perspective = vc.productView?.perspective;
          let viewName: string;
          if (rawName && rawName.trim()) {
            viewName = rawName;
          } else if (perspective && perspective.trim()) {
            viewName = perspective.charAt(0).toUpperCase() + perspective.slice(1);
          } else {
            viewName = `View ${++unnamedViewCounter}`;
          }
          views.push({
            viewId,
            viewName,
            imageUrl: signedImageUrl,
            geometry,
            logoUrls: logoUrlsForLine,
            calibrationPxPerCm: vc.productView?.calibrationPxPerCm ?? null,
          });
        }
      }

      linePreviewData[line.id] = views.length > 0 ? views : null;
    })
  );

  // --- Batch-fetch CustomizationDrafts for selected step resolution ---
  // Collect all unique draft IDs from order lines (filter nulls + dedupe).
  const draftIds = Array.from(
    new Set(
      orderLines
        .map((l) => l.customizationConfig?.customizationDraftId)
        .filter((id): id is string => id != null),
    ),
  );

  type DraftPlacementEntry = { placementId: string; stepIndex: number };

  // stepIndexByPlacementByDraft: draftId → { [placementId]: stepIndex }
  const stepIndexByPlacementByDraft: Record<string, Record<string, number>> = {};

  if (draftIds.length > 0) {
    const drafts = await db.customizationDraft.findMany({
      where: { id: { in: draftIds } },
      select: { id: true, placements: true },
    });
    for (const draft of drafts) {
      const entries = draft.placements as DraftPlacementEntry[];
      if (!Array.isArray(entries)) continue;
      stepIndexByPlacementByDraft[draft.id] = Object.fromEntries(
        entries.map((e) => [e.placementId, e.stepIndex]),
      );
    }
  }

  // Build selectedSteps per line: Record<placementId, { stepIndex, label, scaleFactor, priceAdjustmentCents } | null>
  const selectedStepsByLine: Record<
    string,
    Record<string, { stepIndex: number; label: string; scaleFactor: number; priceAdjustmentCents: number } | null>
  > = {};

  for (const line of orderLines) {
    const draftId = line.customizationConfig?.customizationDraftId ?? null;
    const stepIndexByPlacement = draftId ? (stepIndexByPlacementByDraft[draftId] ?? {}) : {};

    // All placements across all views for this line.
    const allPlacements = line.productConfig?.views.flatMap((v) => v.placements) ?? [];

    const selectedSteps: Record<
      string,
      { stepIndex: number; label: string; scaleFactor: number; priceAdjustmentCents: number } | null
    > = {};

    for (const placement of allPlacements) {
      const stepIndex = stepIndexByPlacement[placement.id];
      if (stepIndex == null) {
        selectedSteps[placement.id] = null;
        continue;
      }
      const step = placement.steps[stepIndex];
      if (!step) {
        selectedSteps[placement.id] = null;
        continue;
      }
      selectedSteps[placement.id] = {
        stepIndex,
        label: step.label,
        scaleFactor: step.scaleFactor,
        priceAdjustmentCents: step.priceAdjustmentCents,
      };
    }

    selectedStepsByLine[line.id] = selectedSteps;
  }

  // TODO: Add cursor-based pagination when per-order note counts exceed ~50 (see listOrderNotes).
  const notes = await listOrderNotes(shop.id, shopifyOrderId);

  return {
    shopifyOrderId,
    orderName,
    lines: orderLines.map((l) => ({
      id: l.id,
      shopifyLineId: l.shopifyLineId,
      variantId: l.variantId,
      artworkStatus: l.artworkStatus,
      productionStatus: l.productionStatus,
      productConfigName: l.productConfig?.name ?? "Unknown config",
      methodName: l.customizationConfig?.decorationMethod?.name ?? "Unknown",
      variantTitle: shopifyVariantTitles[l.shopifyLineId] ?? null,
      unitPriceCents: l.customizationConfig?.unitPriceCents ?? 0,
      placements: l.productConfig?.views.flatMap((v) => v.placements) ?? [],
      viewPlacements: l.productConfig?.views.map((v) => ({
        viewId: v.id,
        viewName: v.name,
        placements: v.placements,
      })) ?? [],
      logoAssetIdsByPlacementId: l.logoAssetIdsByPlacementId as Record<string, string | null> | null,
      orderStatusUrl: l.orderStatusUrl, // Phase 3 patch: exposes upload link for pending-artwork banner
      createdAt: l.createdAt.toISOString(),
      selectedSteps: selectedStepsByLine[l.id] ?? {},
    })),
    logoAssetMap: Object.fromEntries(
      Object.entries(logoAssetMap).map(([k, v]) => [
        k,
        {
          id: v.id,
          kind: v.kind,
          previewPngUrl: v.previewPngUrl,
          originalFileName: v.originalFileName ?? null,
          fileSizeBytes: v.fileSizeBytes ?? null,
          sanitizedSvgUrl: v.sanitizedSvgUrl ?? null,
          downloadUrl: logoAssetDownloadUrls[v.id] ?? null,
          previewUrl: logoAssetPreviewUrls[v.id] ?? null,
        },
      ])
    ),
    placeholderLogoImageUrl: settings?.placeholderLogoImageUrl ?? null,
    emailReminderTemplate: settings?.emailReminderTemplate ?? null,
    productionQcEnabled: settings?.productionQcEnabled ?? false,
    shopDomain: session.shop,
    customer,
    shopifyLineItemPrices,
    allShopifyLineItems,
    currencyCode,
    orderDataError,
    linePreviewData,
    notes,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "attach-artwork") {
      const lineId = formData.get("lineId") as string;
      const logoAssetId = formData.get("logoAssetId") as string;
      if (!lineId || !logoAssetId) {
        return { error: "Missing lineId or logoAssetId" };
      }

      const shop = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (!shop) return { error: "Shop not found" };

      const line = await db.orderLineCustomization.findFirst({
        where: { id: lineId, productConfig: { shopId: shop.id } },
      });
      if (!line) return { error: "Order line not found" };

      const placementId = formData.get("placementId") as string | null;

      const existingMap = (line.logoAssetIdsByPlacementId as Record<string, string | null>) ?? {};
      const updatedMap = { ...existingMap };

      if (placementId) {
        // Allow if key already exists OR map is empty (OLC created before logoAssetIdsByPlacementId was populated)
        if (placementId in updatedMap || Object.keys(updatedMap).length === 0) {
          updatedMap[placementId] = logoAssetId;
        }
      } else {
        // Legacy/backward compat: fill all null slots
        for (const key of Object.keys(updatedMap)) {
          if (!updatedMap[key]) updatedMap[key] = logoAssetId;
        }
      }

      const allFilled = Object.values(updatedMap).every((v) => v != null);

      await db.orderLineCustomization.update({
        where: { id: lineId },
        data: {
          artworkStatus: allFilled ? "PROVIDED" : "PENDING_CUSTOMER",
          ...(allFilled ? { productionStatus: "ARTWORK_PROVIDED" } : {}),
          logoAssetIdsByPlacementId: updatedMap,
        },
      });

      return { success: true };
    }

    if (intent === "advance-status") {
      const lineId = formData.get("lineId") as string;
      const newStatus = formData.get("newStatus") as string;

      if (!lineId || !newStatus) {
        return { error: "Missing lineId or newStatus" };
      }

      if (!PRODUCTION_STATUS_ORDER.includes(newStatus as ProductionStatus)) {
        return { error: "Invalid production status" };
      }

      const shop = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (!shop) return { error: "Shop not found" };

      const line = await db.orderLineCustomization.findFirst({
        where: { id: lineId, productConfig: { shopId: shop.id } },
        select: { productionStatus: true, shopifyOrderId: true },
      });
      if (!line) return { error: "Order line not found" };

      const shopSettings = await db.merchantSettings.findUnique({
        where: { shopId: shop.id },
        select: { productionQcEnabled: true },
      });
      const qcEnabled = shopSettings?.productionQcEnabled ?? false;
      const effectiveOrder = qcEnabled
        ? PRODUCTION_STATUS_ORDER
        : PRODUCTION_STATUS_ORDER.filter(s => s !== ProductionStatus.QUALITY_CHECK);

      const currentIndex = effectiveOrder.indexOf(line.productionStatus);
      const newIndex = effectiveOrder.indexOf(newStatus as ProductionStatus);

      if (newIndex <= currentIndex) {
        return { error: "Can only advance production status forward" };
      }

      await db.orderLineCustomization.update({
        where: { id: lineId },
        data: { productionStatus: newStatus as ProductionStatus },
      });

      // Fire-and-forget tag sync — never block the status advance on this
      syncOrderTags(line.shopifyOrderId, shop.id, admin).catch(e =>
        console.error(`[advance-status] Tag sync failed for ${line.shopifyOrderId}:`, e)
      );

      return { success: true };
    }

    if (intent === "bulk-advance-status") {
      const lineIds = formData.getAll("lineId") as string[];
      const newStatus = formData.get("newStatus") as string;

      if (!lineIds.length || !newStatus) return { error: "Missing lineIds or newStatus" };
      if (!PRODUCTION_STATUS_ORDER.includes(newStatus as ProductionStatus)) {
        return { error: "Invalid production status" };
      }

      const shop = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (!shop) return { error: "Shop not found" };

      const newStatusTyped = newStatus as ProductionStatus;
      const newIndex = PRODUCTION_STATUS_ORDER.indexOf(newStatusTyped);

      const linesToAdvance = await db.orderLineCustomization.findMany({
        where: { id: { in: lineIds }, productConfig: { shopId: shop.id } },
        select: { id: true, productionStatus: true },
      });

      const eligible = linesToAdvance.filter(
        (l) => PRODUCTION_STATUS_ORDER.indexOf(l.productionStatus) < newIndex
      );

      if (eligible.length > 0) {
        await db.$transaction(
          eligible.map((l) =>
            db.orderLineCustomization.update({
              where: { id: l.id },
              data: { productionStatus: newStatusTyped },
            })
          )
        );
      }

      return { success: true, advanced: eligible.length, skipped: linesToAdvance.length - eligible.length };
    }

    if (intent === "save-template") {
      const shop = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (!shop) return { error: "Shop not found" };
      const template = formData.get("template") as string | null;
      if (template && template.length > 10_000) {
        return { error: "Template exceeds maximum length of 10,000 characters." };
      }
      await db.merchantSettings.upsert({
        where: { shopId: shop.id },
        create: { shopId: shop.id, emailReminderTemplate: template || null },
        update: { emailReminderTemplate: template || null },
      });
      return { success: true };
    }

    if (intent === "save-note") {
      const shop = await db.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (!shop) return { error: { code: "NOT_FOUND", message: "Shop not found" } };

      // Resolve shopifyOrderId from formData (the UI must POST it alongside intent).
      const shopifyOrderId = formData.get("shopifyOrderId") as string | null;
      if (!shopifyOrderId) {
        return { error: { code: "BAD_REQUEST", message: "Missing shopifyOrderId" } };
      }

      // Confirm the order belongs to this shop: at least one OLC must exist for it.
      const orderExists = await db.orderLineCustomization.findFirst({
        where: { shopifyOrderId, productConfig: { shopId: shop.id } },
        select: { id: true },
      });
      if (!orderExists) {
        return { error: { code: "NOT_FOUND", message: "Order not found in this shop" } };
      }

      // Validate body
      const rawBody = formData.get("body");
      const parsed = SaveNoteSchema.safeParse({ body: rawBody });
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Invalid note body";
        return { error: { code: "VALIDATION_ERROR", message } };
      }

      // Derive author info from the online session's associated_user (present for
      // merchant staff logins; absent for offline / API tokens — treated as system note).
      const associatedUser = session.onlineAccessInfo?.associated_user;
      const authorUserId = associatedUser ? BigInt(associatedUser.id) : null;
      const firstName = associatedUser?.first_name ?? "";
      const lastName = associatedUser?.last_name ?? "";
      const authorName = [firstName, lastName].filter(Boolean).join(" ") || null;

      const note = await createOrderNote(
        shop.id,
        shopifyOrderId,
        parsed.data.body,
        authorUserId,
        authorName,
      );

      return { ok: true, note };
    }

    return { error: "Unknown intent" };
  } catch (error) {
    return handleError(error);
  }
};

function sanitizeFilename(name: string): string {
  // Keep only safe characters for Content-Disposition filename parameter
  return name.replace(/[^A-Za-z0-9._\-() ]/g, "_").trim() || "download";
}

export default OrderDetail;
