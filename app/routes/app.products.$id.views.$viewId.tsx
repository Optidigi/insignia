/**
 * Product Config View Detail Page
 * 
 * Configure per-variant images for a specific view.
 */

import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useFetcher, useNavigation, useRevalidator, useActionData, useBlocker, useNavigate, Link, redirect } from "react-router";
import {
  Text,
  Spinner,
  Modal,
  Button,
  TextField,
  Icon,
  Popover,
  ActionList,
} from "@shopify/polaris";
import { PlusCircleIcon, CursorIcon, ChevronDownIcon, CheckSmallIcon } from "@shopify/polaris-icons";
import { RulerCalibration } from "../components/RulerCalibration";

const PlacementGeometryEditorLazy = lazy(() =>
  import("../components/PlacementGeometryEditor").then((m) => ({
    default: m.PlacementGeometryEditor,
  }))
);
import { ZonePricingPanel } from "../components/ZonePricingPanel";
import type { PricingChange } from "../components/ZonePricingPanel";
import { CloneLayoutModal } from "../components/CloneLayoutModal";
import type { SetupItem } from "../components/CloneLayoutModal";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getProductConfig, cloneLayoutInto } from "../lib/services/product-configs.server";
import { createPlacement } from "../lib/services/placements.server";
import {
  getView,
  upsertVariantViewConfig,
  copyVariantViewConfigs,
  createView,
  deleteView,
  CreateViewSchema,
} from "../lib/services/views.server";
import { handleError, validateOrThrow, AppError } from "../lib/errors.server";
import { getPresignedPutUrl, getPresignedGetUrl, StorageKeys } from "../lib/storage.server";

// ============================================================================
// Types
// ============================================================================

interface ShopifyVariant {
  id: string;
  title: string;
  displayName: string;
  image?: {
    url: string;
    altText?: string;
  };
}

interface ShopifyProduct {
  id: string;
  title: string;
  variants: {
    nodes: ShopifyVariant[];
  };
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { id: configId, viewId } = params;
  const url = new URL(request.url);
  const apiBaseUrl = url.origin;
  // Session token for client-side API calls (same as server used for this request)
  const sessionTokenForApi =
    url.searchParams.get("id_token") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!configId || !viewId) {
    throw new Response("Config ID and View ID required", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  try {
    const [config, view, allConfigs] = await Promise.all([
      getProductConfig(shop.id, configId),
      getView(configId, viewId),
      db.productConfig.findMany({
        where: { shopId: shop.id, id: { not: configId } },
        include: {
          views: { select: { id: true } },
          placements: { select: { id: true } },
          allowedMethods: { include: { decorationMethod: { select: { name: true } } } },
        },
      }),
    ]);

    // Fetch variants from Shopify for all linked products
    const productIds = config.linkedProductIds;
    let variants: Array<ShopifyVariant & { productTitle: string }> = [];

    if (productIds.length > 0) {
      // Build GraphQL query to fetch products and their variants
      const response = await admin.graphql(
        `#graphql
        query GetProductVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              variants(first: 100) {
                nodes {
                  id
                  title
                  displayName
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }`,
        {
          variables: { ids: productIds },
        }
      );

      const data = await response.json();
      const products = (data.data?.nodes || []).filter(Boolean) as ShopifyProduct[];

      // Flatten variants with product title
      variants = products.flatMap((product) =>
        product.variants.nodes.map((variant) => ({
          ...variant,
          productTitle: product.title,
        }))
      );
    }

    // Get existing variant view configurations
    const variantConfigs = await db.variantViewConfiguration.findMany({
      where: {
        productConfigId: configId,
        viewId,
      },
    });

    // Create a map of variantId -> imageUrl and variantId -> placementGeometry
    const variantImages: Record<string, string | null> = {};
    const rawVariantPlacementGeometry: Record<string, Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null> = {};
    for (const vc of variantConfigs) {
      variantImages[vc.variantId] = vc.imageUrl;
      rawVariantPlacementGeometry[vc.variantId] = (vc.placementGeometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }>) ?? null;
    }

    // Geometry is always view-level (shared across all variants)
    const sharedGeometry = (view.placementGeometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null) ?? null;
    const variantPlacementGeometry: Record<string, Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null> = {};
    const allVariantIds = new Set([
      ...Object.keys(rawVariantPlacementGeometry),
      ...(variants.map((v) => v.id)),
    ]);
    for (const vid of allVariantIds) {
      variantPlacementGeometry[vid] = sharedGeometry;
    }

    // Generate signed URLs for existing images
    const signedImageUrls: Record<string, string> = {};
    for (const [variantId, imageUrl] of Object.entries(variantImages)) {
      if (imageUrl) {
        // Extract the key from the URL if it's a full URL, or use as-is if it's a key
        const key = imageUrl.startsWith("shops/") ? imageUrl : imageUrl.split("/").slice(-4).join("/");
        try {
          signedImageUrls[variantId] = await getPresignedGetUrl(key, 600);
        } catch (e) {
          console.error(`Failed to get signed URL for ${key}:`, e);
        }
      }
    }

    // Map allConfigs to SetupItem[]
    const otherSetups: SetupItem[] = allConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      viewCount: c.views.length,
      placementCount: c.placements.length,
      methodNames: c.allowedMethods.map((m) => m.decorationMethod.name),
    }));

    return {
      config,
      view,
      variants,
      variantImages,
      signedImageUrls,
      variantPlacementGeometry,
      shopId: shop.id,
      currencyCode: shop.currencyCode,
      apiBaseUrl,
      sessionTokenForApi,
      otherSetups,
    };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      throw new Response("View not found", { status: 404 });
    }
    throw error;
  }
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const { id: configId, viewId } = params;

    if (!configId || !viewId) {
      throw new Response("Config ID and View ID required", { status: 400 });
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    // Verify config ownership — applies to ALL intents in this route
    const configOwnership = await db.productConfig.findFirst({
      where: { id: configId, shopId: shop.id },
      select: { id: true },
    });
    if (!configOwnership) {
      throw new Response("Not found", { status: 404 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "get-upload-url") {
      const variantId = formData.get("variantId") as string;
      const contentType = formData.get("contentType") as string;
      const fileName = formData.get("fileName") as string;

      if (!variantId || !contentType || !fileName) {
        throw new Response("Missing required fields", { status: 400 });
      }

      // Generate storage key
      const key = StorageKeys.viewImage(shop.id, viewId, variantId, fileName);
      
      // Get presigned PUT URL
      const uploadUrl = await getPresignedPutUrl(key, contentType, 300);

      return { uploadUrl, key, success: true };
    }

    if (intent === "save-image") {
      const variantId = formData.get("variantId") as string;
      const imageKey = formData.get("imageKey") as string;

      if (!variantId || !imageKey) {
        throw new Response("Missing required fields", { status: 400 });
      }

      // Save the variant view configuration
      await upsertVariantViewConfig(configId, variantId, viewId, {
        imageUrl: imageKey,
      });

      return { success: true };
    }

    if (intent === "remove-image") {
      const variantId = formData.get("variantId") as string;

      if (!variantId) {
        throw new Response("Missing variant ID", { status: 400 });
      }

      await upsertVariantViewConfig(configId, variantId, viewId, {
        imageUrl: null,
      });

      return { success: true };
    }

    if (intent === "duplicate-geometry") {
      const sourceVariantId = formData.get("sourceVariantId") as string;
      const targetVariantId = formData.get("targetVariantId") as string;

      if (!sourceVariantId || !targetVariantId) {
        throw new Response("Missing source or target variant ID", { status: 400 });
      }
      if (sourceVariantId === targetVariantId) {
        throw new Response("Source and target must be different variants", {
          status: 400,
        });
      }

      await copyVariantViewConfigs(configId, sourceVariantId, targetVariantId, {
        copyImages: false,
      });

      return { success: true };
    }

    if (intent === "apply-to-all") {
      const sourceVariantId = formData.get("sourceVariantId") as string;
      const targetVariantIdsJson = formData.get("targetVariantIds") as string;

      if (!sourceVariantId || !targetVariantIdsJson) {
        throw new Response("Missing sourceVariantId or targetVariantIds", { status: 400 });
      }

      let targetVariantIds: string[];
      try {
        targetVariantIds = JSON.parse(targetVariantIdsJson) as string[];
      } catch {
        throw new Response("Invalid targetVariantIds JSON", { status: 400 });
      }

      for (const targetId of targetVariantIds) {
        if (targetId !== sourceVariantId) {
          await copyVariantViewConfigs(configId, sourceVariantId, targetId, {
            copyImages: false,
          });
        }
      }

      return { success: true, intent: "apply-to-all" };
    }

    if (intent === "save-placement-geometry") {
      const variantId = formData.get("variantId") as string;
      const placementGeometryJson = formData.get("placementGeometry") as string;

      if (!variantId) {
        throw new Response("Missing variant ID", { status: 400 });
      }

      let placementGeometry: Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null = null;
      if (placementGeometryJson) {
        try {
          placementGeometry = JSON.parse(placementGeometryJson) as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }>;
        } catch {
          throw new Response("Invalid placement geometry JSON", { status: 400 });
        }
      }

      // Always save to view-level geometry (shared across all variants)
      // Include ownership check in the query — viewId must belong to configId/shopId
      const view = await db.productView.findFirst({
        where: { id: viewId, productConfig: { id: configId, shopId: shop.id } },
        select: { placementGeometry: true },
      });
      if (!view) {
        throw new Response("View not found", { status: 404 });
      }

      // Save to view-level geometry (merged with any existing entries)
      const existing = (view.placementGeometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null) ?? {};
      const merged: Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> = {
        ...existing,
        ...(placementGeometry ?? {}),
      };
      await db.productView.update({
        where: { id: viewId, productConfig: { id: configId, shopId: shop.id } },
        data: {
          placementGeometry: merged as import("@prisma/client").Prisma.InputJsonValue,
        },
      });

      return { success: true, intent: "save-placement-geometry" };
    }

    // ------------------------------------------------------------------
    // Inline placement pricing intents
    // ------------------------------------------------------------------

    if (intent === "update-placement") {
      const placementId = formData.get("placementId") as string;
      const name = formData.get("name") as string;
      const basePriceAdjustmentCents =
        parseInt(formData.get("basePriceAdjustmentCents") as string ?? "0", 10) || 0;
      const hidePriceWhenZero = formData.get("hidePriceWhenZero") === "true";
      const defaultStepIndex =
        parseInt(formData.get("defaultStepIndex") as string ?? "0", 10) || 0;

      if (!placementId || !name) {
        throw new Response("Missing placement ID or name", { status: 400 });
      }

      await db.placementDefinition.update({
        where: {
          id: placementId,
          productConfig: { shopId: shop.id },
        },
        data: { name, basePriceAdjustmentCents, hidePriceWhenZero, defaultStepIndex },
      });

      return { success: true, intent: "update-placement" };
    }

    if (intent === "update-step") {
      const stepId = formData.get("stepId") as string;
      const label = formData.get("label") as string;
      const rawScale = parseFloat(formData.get("scaleFactor") as string ?? "1");
      const scaleFactor = Number.isNaN(rawScale) ? 1.0 : rawScale;
      const priceAdjustmentCents =
        parseInt(formData.get("priceAdjustmentCents") as string ?? "0", 10) || 0;

      if (!stepId || !label) {
        throw new Response("Missing step ID or label", { status: 400 });
      }

      await db.placementStep.update({
        where: {
          id: stepId,
          placementDefinition: { productConfig: { shopId: shop.id } },
        },
        data: { label, scaleFactor, priceAdjustmentCents },
      });

      return { success: true, intent: "update-step" };
    }

    if (intent === "batch-pricing-update") {
      const payloadJson = formData.get("payload") as string;
      if (!payloadJson) {
        throw new Response("Missing payload", { status: 400 });
      }

      let payload: {
        placements?: Array<{ placementId: string; name: string; basePriceAdjustmentCents: number; hidePriceWhenZero: boolean; defaultStepIndex: number }>;
        steps?: Array<{ stepId: string; label: string; scaleFactor: number; priceAdjustmentCents: number }>;
      };
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        throw new Response("Invalid JSON payload", { status: 400 });
      }

      // Apply all placement updates
      for (const p of payload.placements ?? []) {
        if (!p.placementId || !p.name) continue;
        await db.placementDefinition.update({
          where: { id: p.placementId, productConfig: { shopId: shop.id } },
          data: {
            name: p.name,
            basePriceAdjustmentCents: p.basePriceAdjustmentCents,
            hidePriceWhenZero: p.hidePriceWhenZero,
            defaultStepIndex: p.defaultStepIndex,
          },
        });
      }

      // Apply all step updates
      for (const s of payload.steps ?? []) {
        if (!s.stepId || !s.label) continue;
        const rawScale = Number.isNaN(s.scaleFactor) ? 1.0 : s.scaleFactor;
        await db.placementStep.update({
          where: { id: s.stepId, placementDefinition: { productConfig: { shopId: shop.id } } },
          data: {
            label: s.label,
            scaleFactor: rawScale,
            priceAdjustmentCents: s.priceAdjustmentCents,
          },
        });
      }

      return { success: true, intent: "batch-pricing-update" };
    }

    if (intent === "add-step") {
      const placementId = formData.get("placementId") as string;
      const label = (formData.get("label") as string) || "New Size";

      if (!placementId) {
        throw new Response("Missing placement ID", { status: 400 });
      }

      // Verify ownership before adding a step
      const placement = await db.placementDefinition.findUnique({
        where: {
          id: placementId,
          productConfig: { shopId: shop.id },
        },
        select: { id: true },
      });

      if (!placement) {
        throw new Response("Placement not found", { status: 404 });
      }

      const maxOrder = await db.placementStep.aggregate({
        where: { placementDefinitionId: placementId },
        _max: { displayOrder: true },
      });

      await db.placementStep.create({
        data: {
          placementDefinitionId: placementId,
          label,
          displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
          scaleFactor: 1.0,
          priceAdjustmentCents: 0,
        },
      });

      return { success: true, intent: "add-step" };
    }

    if (intent === "delete-step") {
      const stepId = formData.get("stepId") as string;

      if (!stepId) {
        throw new Response("Missing step ID", { status: 400 });
      }

      const step = await db.placementStep.findUnique({
        where: {
          id: stepId,
          placementDefinition: { productConfig: { shopId: shop.id } },
        },
        include: {
          placementDefinition: {
            include: { _count: { select: { steps: true } } },
          },
        },
      });

      if (!step) {
        throw new Response("Step not found", { status: 404 });
      }

      if (step.placementDefinition._count.steps <= 1) {
        throw new Response("Cannot delete the last size tier", { status: 400 });
      }

      await db.placementStep.delete({
        where: {
          id: stepId,
          placementDefinition: { productConfig: { shopId: shop.id } },
        },
      });

      return { success: true, intent: "delete-step" };
    }

    if (intent === "clone-layout") {
      const sourceConfigId = String(formData.get("sourceConfigId"));
      if (!sourceConfigId) {
        throw new Response("Missing sourceConfigId", { status: 400 });
      }
      await cloneLayoutInto(shop.id, configId, sourceConfigId);
      return { success: true, intent: "clone-layout" };
    }

    if (intent === "add-placement") {
      const name = (formData.get("name") as string)?.trim();
      if (!name) {
        throw new Response("Missing placement name", { status: 400 });
      }

      await createPlacement(shop.id, configId, {
        name,
        basePriceAdjustmentCents: 0,
        hidePriceWhenZero: false,
        defaultStepIndex: 0,
        steps: [],
      });

      return { success: true, intent: "add-placement" };
    }

    if (intent === "save-calibration") {
      const pxPerCm = Number(formData.get("pxPerCm"));
      if (!Number.isFinite(pxPerCm) || pxPerCm <= 0) {
        return { success: false, intent: "save-calibration", error: "Invalid calibration value" };
      }
      await db.productView.update({
        where: { id: viewId },
        data: { calibrationPxPerCm: pxPerCm },
      });
      return { success: true, intent: "save-calibration" };
    }

    if (intent === "create-view") {
      const perspective = (formData.get("perspective") as string) || "custom";
      const name = (formData.get("name") as string | null)?.trim() || undefined;
      const input = validateOrThrow(
        CreateViewSchema,
        { perspective, name },
        "Invalid view data"
      );
      const newView = await createView(configId, input);
      return redirect(`/app/products/${configId}/views/${newView.id}`);
    }

    if (intent === "rename-view") {
      const name = (formData.get("name") as string | null)?.trim();
      if (!name) {
        return { success: false, intent: "rename-view", error: "View name cannot be empty" };
      }
      await db.productView.update({
        where: { id: viewId, productConfig: { id: configId, shopId: shop.id } },
        data: { name },
      });
      return { success: true, intent: "rename-view" };
    }

    if (intent === "delete-view") {
      // Guard: cannot delete the last view
      const viewCount = await db.productView.count({ where: { productConfigId: configId } });
      if (viewCount <= 1) {
        return { success: false, intent: "delete-view", error: "Cannot delete the only view. A product setup must have at least one view." };
      }
      await deleteView(configId, viewId);
      return redirect(`/app/products/${configId}`);
    }

    throw new Response("Invalid intent", { status: 400 });
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Helpers
// ============================================================================

function getPerspectiveLabel(perspective: string) {
  const labels: Record<string, string> = {
    front: "Front",
    back: "Back",
    left: "Left",
    right: "Right",
    side: "Side",
    custom: "Custom",
  };
  return labels[perspective] || perspective;
}

// ============================================================================
// Component
// ============================================================================

export default function ViewDetailPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { config, view, variants, signedImageUrls, variantPlacementGeometry, currencyCode, otherSetups } =
    loaderData;
  const submit = useSubmit();
  const geometryFetcher = useFetcher();
  const pricingFetcher = useFetcher();
  const nameFetcher = useFetcher();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    variants[0]?.id ?? null
  );
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [geometryDirty, setGeometryDirty] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [addingZone, setAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  /** Pending geometry from the inline editor, used by the App Bridge SaveBar. */
  const [pendingGeometry, setPendingGeometry] = useState<
    Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }> | null
  >(null);
  const [viewPopoverOpen, setViewPopoverOpen] = useState(false);
  const [variantPopoverOpen, setVariantPopoverOpen] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  /** Natural pixel dimensions of the currently-displayed variant image (set when image loads). */
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  /** Rename view state */
  const [viewName, setViewName] = useState<string>(view.name ?? getPerspectiveLabel(view.perspective));
  const [nameDirty, setNameDirty] = useState(false);
  const [renameSaved, setRenameSaved] = useState(false);
  /** Delete view confirmation modal */
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const anyDirty = geometryDirty || pricingDirty || nameDirty;

  // Warn before browser navigation when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  // Block in-app (React Router) navigation when there are unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty && currentLocation.pathname !== nextLocation.pathname
  );

  // Show / hide Shopify SaveBar in sync with dirty state
  useEffect(() => {
    const saveBar = window.shopify?.saveBar;
    if (anyDirty) {
      saveBar?.show("view-editor-save-bar");
    } else {
      saveBar?.hide("view-editor-save-bar");
    }
    return () => { saveBar?.hide("view-editor-save-bar"); };
  }, [anyDirty]);

  // Show toast + clear dirty for fetcher-based saves (geometry, pricing, name)
  useEffect(() => {
    const data = geometryFetcher.data as Record<string, unknown> | undefined;
    if (data && "success" in data && data.success === true) {
      setGeometryDirty(false);
      setPendingGeometry(null);
    }
  }, [geometryFetcher.data]);

  useEffect(() => {
    const data = pricingFetcher.data as Record<string, unknown> | undefined;
    if (data && "success" in data && data.success === true) {
      window.shopify?.toast?.show("Pricing saved");
    }
  }, [pricingFetcher.data]);

  useEffect(() => {
    const data = nameFetcher.data as Record<string, unknown> | undefined;
    if (data && "success" in data && data.success === true) {
      setNameDirty(false);
      setRenameSaved(true);
      window.shopify?.toast?.show("View renamed");
      setTimeout(() => setRenameSaved(false), 2000);
    }
  }, [nameFetcher.data]);

  // Clear dirty flag and show toast feedback after action responses (non-fetcher submits)
  useEffect(() => {
    if (!actionData) return;
    const data = actionData as Record<string, unknown>;

    if ("success" in data && data.success === true) {
      const intent = data.intent as string | undefined;
      if (intent === "delete-step") {
        window.shopify?.toast?.show("Size tier deleted");
      } else if (intent === "clone-layout") {
        window.shopify?.toast?.show("Layout cloned successfully");
      } else if (intent === "save-calibration") {
        window.shopify?.toast?.show("View calibrated");
      } else if (intent === "add-placement") {
        window.shopify?.toast?.show("Print area added");
      } else if (intent === "add-step") {
        window.shopify?.toast?.show("Size tier added");
      } else if (intent === "apply-to-all") {
        window.shopify?.toast?.show("Applied to all variants");
      }
    } else if ("error" in data) {
      const intent = data.intent as string | undefined;
      // error shape from handleError: { error: { message, code, ... } }
      // error shape from explicit return: string (e.g. save-calibration)
      const errObj = data.error;
      const errorMsg =
        typeof errObj === "string"
          ? errObj
          : typeof errObj === "object" && errObj !== null && "message" in (errObj as object)
          ? (errObj as { message: string }).message
          : "An error occurred";
      if (intent === "clone-layout") {
        window.shopify?.toast?.show("Clone failed", { isError: true });
      } else if (errorMsg) {
        // For all other intents show the error message from the server
        window.shopify?.toast?.show(errorMsg, { isError: true });
      }
    }
  }, [actionData]);

  // Revalidate after successful form submission
  useEffect(() => {
    if (navigation.state === "idle" && navigation.formData) {
      revalidator.revalidate();
    }
  }, [navigation.state, navigation.formData, revalidator]);

  // Map ISO 4217 currency code to symbol for display
  const currencySymbolMap: Record<string, string> = {
    USD: "$", EUR: "\u20ac", GBP: "\u00a3", CAD: "CA$", AUD: "A$",
    JPY: "\u00a5", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr",
  };
  const currencySymbol = currencySymbolMap[currencyCode] ?? currencyCode + " ";

  const handleSaveGeometry = useCallback(() => {
    // Submit geometry changes via dedicated fetcher (won't cancel other fetchers)
    if (pendingGeometry && selectedVariantId) {
      const fd = new FormData();
      fd.set("intent", "save-placement-geometry");
      fd.set("variantId", selectedVariantId);
      fd.set("placementGeometry", JSON.stringify(pendingGeometry));
      geometryFetcher.submit(fd, { method: "POST" });
    }
    // Trigger pricing panel save via custom event (uses pricingFetcher)
    if (pricingDirty) {
      document.dispatchEvent(new CustomEvent("pricing-panel-save"));
    }
    // Submit rename via dedicated fetcher
    if (nameDirty) {
      const trimmed = viewName.trim();
      if (trimmed && trimmed !== (view.name ?? getPerspectiveLabel(view.perspective))) {
        const fd = new FormData();
        fd.set("intent", "rename-view");
        fd.set("name", trimmed);
        nameFetcher.submit(fd, { method: "POST" });
      }
      setNameDirty(false);
    }
  }, [pendingGeometry, selectedVariantId, geometryFetcher, pricingDirty, nameDirty, viewName, view.name, view.perspective, nameFetcher]);

  const handleDiscardGeometry = useCallback(() => {
    setEditorResetKey((k) => k + 1);
    setGeometryDirty(false);
    setPendingGeometry(null);
    // Also discard pricing edits
    setPricingDirty(false);
    document.dispatchEvent(new CustomEvent("pricing-panel-discard"));
    // Revert view name
    setViewName(view.name ?? getPerspectiveLabel(view.perspective));
    setNameDirty(false);
  }, [view.name, view.perspective]);

  /** Submit all pricing changes as a single batch via dedicated fetcher. */
  const handlePricingSave = useCallback(
    (changes: PricingChange[]) => {
      if (changes.length === 0) {
        setPricingDirty(false);
        return;
      }

      // Build a batch payload from the FormData objects
      const placementUpdates: Array<{ placementId: string; name: string; basePriceAdjustmentCents: number; hidePriceWhenZero: boolean; defaultStepIndex: number }> = [];
      const stepUpdates: Array<{ stepId: string; label: string; scaleFactor: number; priceAdjustmentCents: number }> = [];

      for (const change of changes) {
        if (change.type === "placement") {
          placementUpdates.push({
            placementId: change.data.get("placementId") as string,
            name: change.data.get("name") as string,
            basePriceAdjustmentCents: parseInt(change.data.get("basePriceAdjustmentCents") as string ?? "0", 10) || 0,
            hidePriceWhenZero: change.data.get("hidePriceWhenZero") === "true",
            defaultStepIndex: parseInt(change.data.get("defaultStepIndex") as string ?? "0", 10) || 0,
          });
        } else {
          stepUpdates.push({
            stepId: change.data.get("stepId") as string,
            label: change.data.get("label") as string,
            scaleFactor: parseFloat(change.data.get("scaleFactor") as string ?? "1") || 1.0,
            priceAdjustmentCents: parseInt(change.data.get("priceAdjustmentCents") as string ?? "0", 10) || 0,
          });
        }
      }

      const fd = new FormData();
      fd.set("intent", "batch-pricing-update");
      fd.set("payload", JSON.stringify({ placements: placementUpdates, steps: stepUpdates }));
      pricingFetcher.submit(fd, { method: "POST" });
      setPricingDirty(false);
    },
    [pricingFetcher],
  );

  const handleCalibrate = useCallback(
    (pxPerCm: number) => {
      setRulerActive(false);
      const fd = new FormData();
      fd.set("intent", "save-calibration");
      fd.set("pxPerCm", String(pxPerCm));
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const handleCloneApply = useCallback(
    (sourceConfigId: string) => {
      setCloneModalOpen(false);
      submit({ intent: "clone-layout", sourceConfigId }, { method: "post" });
    },
    [submit]
  );

  const handleRenameBlur = useCallback(() => {
    const trimmed = viewName.trim();
    if (!trimmed) {
      // Reset to last saved name
      setViewName(view.name ?? getPerspectiveLabel(view.perspective));
      return;
    }
    const currentName = view.name ?? getPerspectiveLabel(view.perspective);
    if (trimmed === currentName) return;
    const fd = new FormData();
    fd.set("intent", "rename-view");
    fd.set("name", trimmed);
    nameFetcher.submit(fd, { method: "POST" });
  }, [viewName, view.name, view.perspective, nameFetcher]);

  const handleDeleteView = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "delete-view");
    submit(fd, { method: "POST" });
    setDeleteModalOpen(false);
  }, [submit]);

  const handleAddZone = useCallback(() => {
    if (!newZoneName.trim()) return;
    const formData = new FormData();
    formData.append("intent", "add-placement");
    formData.append("name", newZoneName.trim());
    submit(formData, { method: "post" });
    setAddingZone(false);
    setNewZoneName("");
  }, [newZoneName, submit]);

  // Derived values — memoized so their references stay stable across re-renders
  // triggered by onChange → setPendingGeometry. Without memoization, new array/object
  // references on every render cause PlacementGeometryEditor's initialisation useEffect
  // to fire repeatedly, resetting rects back to the saved position on every drag event.
  const selectedVariantImageUrl = selectedVariantId ? (signedImageUrls[selectedVariantId] ?? null) : null;

  // Sync viewName when navigating to a different view
  useEffect(() => {
    setViewName(view.name ?? getPerspectiveLabel(view.perspective));
    setNameDirty(false);
  }, [view.id, view.name, view.perspective]);

  // Load natural image dimensions whenever the selected variant image changes
  useEffect(() => {
    setImageDimensions(null);
    if (!selectedVariantImageUrl) return;
    const img = new window.Image();
    img.onload = () => setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = selectedVariantImageUrl;
    return () => { img.onload = null; img.src = ""; };
  }, [selectedVariantImageUrl]);

  const selectedVariantGeometry = useMemo(
    () => (selectedVariantId ? (variantPlacementGeometry[selectedVariantId] ?? {}) : {}),
    [selectedVariantId, variantPlacementGeometry]
  );

  const editorPlacements = useMemo(
    () => config.placements.map((p) => ({ id: p.id, name: p.name })),
    [config.placements]
  );

  const isCloning =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "clone-layout";

  const imageCount = Object.values(signedImageUrls).filter(Boolean).length;

  const viewTabs = useMemo(
    () => config.views.map((v) => ({
      id: v.id,
      label: v.name || getPerspectiveLabel(v.perspective),
      url: `/app/products/${config.id}/views/${v.id}`,
      isCurrent: v.id === view.id,
    })),
    [config.views, config.id, view.id]
  );

  return (
    <>
      {/* App Bridge SaveBar — shown when geometry has unsaved changes */}
      <ui-save-bar id="view-editor-save-bar">
        <button variant="primary" type="button" onClick={handleSaveGeometry}>Save changes</button>
        <button type="button" onClick={handleDiscardGeometry}>Discard</button>
      </ui-save-bar>

      {/* Clone Layout Modal */}
      <CloneLayoutModal
        open={cloneModalOpen}
        onClose={() => setCloneModalOpen(false)}
        onApply={handleCloneApply}
        setups={otherSetups}
        loading={isCloning}
      />

      {/* Delete View Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        title="Delete view?"
        primaryAction={{
          content: "Delete view",
          destructive: true,
          onAction: handleDeleteView,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
        onClose={() => setDeleteModalOpen(false)}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete this view and all its variant images. This cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* In-app navigation blocker when geometry is dirty */}
      {blocker.state === "blocked" && (
        <Modal
          open
          title="Unsaved changes"
          primaryAction={{ content: "Leave anyway", destructive: true, onAction: () => blocker.proceed?.() }}
          secondaryActions={[{ content: "Stay", onAction: () => blocker.reset?.() }]}
          onClose={() => blocker.reset?.()}
        >
          <Modal.Section>
            <Text as="p">You have unsaved changes. Leave without saving?</Text>
          </Modal.Section>
        </Modal>
      )}

      {/* ================================================================
          Full-width two-column view editor layout (matches design S8Dx0)
          ================================================================ */}
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>

        {/* Sub-nav bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 24px", height: 52, flexShrink: 0,
          background: "#ffffff", borderBottom: "1px solid #E5E7EB",
        }}>
          <Link
            to={`/app/products/${config.id}`}
            style={{ color: "#6B7280", display: "flex", alignItems: "center", textDecoration: "none" }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            to={`/app/products/${config.id}`}
            style={{ color: "#2563EB", fontSize: 14, textDecoration: "none" }}
          >
            {config.name}
          </Link>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!anyDirty}
            onClick={handleSaveGeometry}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none", cursor: anyDirty ? "pointer" : "default",
              background: anyDirty ? "#111827" : "#D1D5DB",
              color: "#ffffff", fontSize: 13, fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>

        {/* Body: canvas column + right panel */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

          {/* Left: canvas column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#F3F4F6", minWidth: 0 }}>

            {/* View tabs / dropdown selector */}
            <div style={{
              display: "flex", alignItems: "center", gap: 0,
              padding: "0 16px", height: 40, flexShrink: 0,
              background: "#ffffff", borderBottom: "1px solid #E5E7EB",
            }}>
              {viewTabs.length <= 4 ? (
                /* Tab links mode (≤4 views) */
                viewTabs.map((tab) => (
                  <Link
                    key={tab.id}
                    to={tab.url}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      height: "100%", padding: "0 16px",
                      borderBottom: tab.isCurrent ? "2px solid #2563EB" : "2px solid transparent",
                      color: tab.isCurrent ? "#2563EB" : "#6B7280",
                      fontSize: 13, fontWeight: tab.isCurrent ? 600 : 400,
                      textDecoration: "none", whiteSpace: "nowrap",
                    }}
                  >
                    {tab.label}
                  </Link>
                ))
              ) : (
                /* Dropdown mode (5+ views) */
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Popover
                    active={viewPopoverOpen}
                    activator={
                      <button
                        type="button"
                        onClick={() => setViewPopoverOpen((o) => !o)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 6,
                          border: "1px solid #D1D5DB", background: "#F9FAFB",
                          cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#111827",
                        }}
                      >
                        {viewTabs.find((t) => t.isCurrent)?.label ?? "View"}
                        <span style={{
                          fontSize: 10, fontWeight: 500, color: "#2563EB",
                          background: "#EFF6FF", borderRadius: 10, padding: "1px 6px",
                        }}>
                          {`${viewTabs.findIndex((t) => t.isCurrent) + 1} of ${viewTabs.length}`}
                        </span>
                        <Icon source={ChevronDownIcon} tone="subdued" />
                      </button>
                    }
                    onClose={() => setViewPopoverOpen(false)}
                  >
                    <ActionList
                      items={viewTabs.map((tab) => ({
                        content: tab.label,
                        icon: tab.isCurrent ? CheckSmallIcon : undefined,
                        onAction: () => {
                          setViewPopoverOpen(false);
                          navigate(tab.url);
                        },
                      }))}
                    />
                  </Popover>
                </div>
              )}
              <div style={{ flex: 1 }} />
              {/* Add view — always visible */}
              <button
                onClick={() => {
                  const fd = new FormData();
                  fd.append("intent", "create-view");
                  fd.append("perspective", "custom");
                  fd.append("name", "New view");
                  submit(fd, { method: "POST" });
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 6,
                  background: "#F3F4F6", border: "none",
                  color: "#6B7280", fontSize: 11, cursor: "pointer",
                }}
              >
                + Add view
              </button>
            </div>

            {/* Canvas area */}
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "16px 24px 8px", overflow: "auto",
            }}>
              {config.placements.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9CA3AF" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 14 }}>No print areas defined yet.</p>
                  <p style={{ margin: 0, fontSize: 13 }}>Use the panel on the right to add your first print area.</p>
                </div>
              ) : !selectedVariantImageUrl ? (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 20, padding: "48px 32px", maxWidth: 360, textAlign: "center",
                }}>
                  {/* Camera icon */}
                  <div style={{
                    width: 72, height: 72, borderRadius: 18,
                    background: "linear-gradient(135deg, #F0F4FF 0%, #E8F0FF 100%)",
                    border: "1.5px dashed #BFCFFF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6B7FCC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>
                      {variants.length === 0 ? "No variants found" : "No image for this variant"}
                    </span>
                    <span style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>
                      {variants.length === 0
                        ? "This product has no variants. Make sure it's connected to a Shopify product."
                        : "Upload a product photo so you can position print areas on it."}
                    </span>
                  </div>
                  {variants.length > 0 && (
                    <Link
                      to={`/app/products/${config.id}/images`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "9px 18px", borderRadius: 8,
                        background: "#2563EB", color: "#ffffff",
                        fontSize: 13, fontWeight: 600, textDecoration: "none",
                      }}
                    >
                      Upload product images
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </Link>
                  )}
                </div>
              ) : (
                <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
                  <Suspense
                    fallback={
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Spinner size="small" />
                        <span style={{ fontSize: 13, color: "#9CA3AF" }}>Loading editor…</span>
                      </div>
                    }
                  >
                    <PlacementGeometryEditorLazy
                      key={`${editorResetKey}-${selectedVariantId ?? ""}`}
                      inline
                      imageUrl={selectedVariantImageUrl}
                      placements={editorPlacements}
                      initialGeometry={selectedVariantGeometry}
                      onSave={handleSaveGeometry}
                      onCancel={handleDiscardGeometry}
                      onChange={(geometry) => {
                        setGeometryDirty(true);
                        setPendingGeometry(geometry);
                      }}
                      selectedPlacementId={selectedPlacementId}
                      onSelectPlacement={setSelectedPlacementId}
                    />
                  </Suspense>

                  {/* Ruler calibration overlay — covers exactly the Konva stage */}
                  {imageDimensions && (
                    <RulerCalibration
                      active={rulerActive}
                      onCalibrate={handleCalibrate}
                      onCancel={() => setRulerActive(false)}
                      imageWidth={imageDimensions.width}
                      imageHeight={imageDimensions.height}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Hint bar */}
            {selectedVariantImageUrl && config.placements.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 6, height: 28, flexShrink: 0,
              }}>
                <svg width="12" height="12" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                  Click a print area to select · Drag to reposition · Corners to resize · Ctrl+Z to undo
                </span>
              </div>
            )}

            {/* Calibration status bar */}
            {selectedVariantImageUrl && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 6, paddingBottom: 4, flexShrink: 0,
              }}>
                {/* Ruler icon */}
                <svg width="12" height="12" fill="none" stroke="#7C3AED" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M6 10v4M10 11v2M14 11v2M18 10v4" strokeLinecap="round" />
                </svg>
                {view.calibrationPxPerCm ? (
                  <span style={{ fontSize: 11, color: "#7C3AED" }}>
                    {`Calibrated: ${view.calibrationPxPerCm.toFixed(1)} px/cm`}
                    {" \u00b7 "}
                    <button
                      type="button"
                      onClick={() => setRulerActive(true)}
                      style={{
                        background: "none", border: "none", padding: 0,
                        color: "#7C3AED", fontSize: 11, cursor: "pointer",
                        textDecoration: "underline", fontWeight: 500,
                      }}
                    >
                      Recalibrate
                    </button>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                    <button
                      type="button"
                      onClick={() => setRulerActive(true)}
                      style={{
                        background: "none", border: "none", padding: 0,
                        color: "#7C3AED", fontSize: 11, cursor: "pointer",
                        textDecoration: "underline", fontWeight: 500,
                      }}
                    >
                      Calibrate view
                    </button>
                    {" for real-world dimensions"}
                  </span>
                )}
              </div>
            )}

            {/* Variant bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 16px", height: 40, flexShrink: 0,
              background: "#ffffff", borderTop: "1px solid #E5E7EB",
              overflowX: "auto",
            }}>
              <span style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap" }}>Variant:</span>
              {variants.length <= 6 ? (
                /* Pill mode (≤6 variants) */
                variants.map((v) => {
                  const isSelected = v.id === selectedVariantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={anyDirty && !isSelected}
                      title={anyDirty && !isSelected ? "Save or discard current changes before switching variant" : v.displayName}
                      onClick={() => setSelectedVariantId(v.id)}
                      style={{
                        padding: "4px 10px", borderRadius: 6, border: "none",
                        cursor: anyDirty && !isSelected ? "not-allowed" : "pointer",
                        background: isSelected ? "#111827" : "#F3F4F6",
                        color: isSelected ? "#ffffff" : "#374151",
                        fontSize: 11, fontWeight: isSelected ? 500 : 400,
                        whiteSpace: "nowrap", opacity: anyDirty && !isSelected ? 0.4 : 1,
                      }}
                    >
                      {v.title === "Default Title" ? "Default" : v.title}
                    </button>
                  );
                })
              ) : (
                /* Dropdown mode (7+ variants) */
                <Popover
                  active={variantPopoverOpen}
                  activator={
                    <button
                      type="button"
                      onClick={() => setVariantPopoverOpen((o) => !o)}
                      disabled={anyDirty}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "4px 10px", borderRadius: 6,
                        border: "1px solid #D1D5DB", background: "#F9FAFB",
                        cursor: anyDirty ? "not-allowed" : "pointer",
                        fontSize: 11, fontWeight: 500, color: anyDirty ? "#9CA3AF" : "#111827",
                        opacity: anyDirty ? 0.6 : 1,
                      }}
                    >
                      {(() => {
                        const v = variants.find((v) => v.id === selectedVariantId);
                        if (!v) return "Select variant";
                        return v.title === "Default Title" ? "Default" : v.title;
                      })()}
                      <span style={{
                        fontSize: 10, fontWeight: 500, color: "#2563EB",
                        background: "#EFF6FF", borderRadius: 10, padding: "1px 6px",
                      }}>
                        {`${variants.findIndex((v) => v.id === selectedVariantId) + 1} of ${variants.length}`}
                      </span>
                      <Icon source={ChevronDownIcon} tone="subdued" />
                    </button>
                  }
                  onClose={() => setVariantPopoverOpen(false)}
                >
                  <ActionList
                    items={variants.map((v) => {
                      const isSelected = v.id === selectedVariantId;
                      const label = v.title === "Default Title" ? "Default" : v.title;
                      return {
                        content: label,
                        icon: isSelected ? CheckSmallIcon : undefined,
                        disabled: anyDirty && !isSelected,
                        onAction: () => {
                          setVariantPopoverOpen(false);
                          setSelectedVariantId(v.id);
                        },
                      };
                    })}
                  />
                </Popover>
              )}
              <div style={{ flex: 1 }} />
              {/* Apply to all — always visible, separated by divider */}
              {variants.length > 1 && (
                <>
                  <div style={{ width: 1, height: 20, background: "#E5E7EB", flexShrink: 0 }} />
                  <button
                    type="button"
                    disabled={!selectedVariantId}
                    title="Copy this variant's print area layout to all other variants"
                    onClick={() => {
                      if (!selectedVariantId) return;
                      const targetIds = variants
                        .map((v) => v.id)
                        .filter((id) => id !== selectedVariantId);
                      submit(
                        {
                          intent: "apply-to-all",
                          sourceVariantId: selectedVariantId,
                          targetVariantIds: JSON.stringify(targetIds),
                        },
                        { method: "post" }
                      );
                    }}
                    style={{
                      padding: "4px 10px", borderRadius: 6,
                      border: "1px solid #D1D5DB", background: "#F9FAFB",
                      color: selectedVariantId ? "#374151" : "#9CA3AF",
                      fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
                      cursor: selectedVariantId ? "pointer" : "not-allowed",
                    }}
                  >
                    Apply to all
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right panel (380px) */}
          <div style={{
            width: 380, flexShrink: 0,
            borderLeft: "1px solid #E5E7EB", background: "#ffffff",
            display: "flex", flexDirection: "column",
          }}>
            {/* Panel header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #E5E7EB" }}>
              {/* Rename inline text field */}
              <div style={{ marginBottom: 6 }}>
                <TextField
                  label="View name"
                  labelHidden
                  value={viewName}
                  onChange={(val) => { setViewName(val); setNameDirty(true); }}
                  onBlur={handleRenameBlur}
                  autoComplete="off"
                  placeholder="View name"
                  suffix={renameSaved ? <span style={{ color: "#16A34A", fontSize: 11 }}>Saved</span> : undefined}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
                  Position print areas for this view
                </div>
                <Button
                  tone="critical"
                  variant="plain"
                  onClick={() => setDeleteModalOpen(true)}
                  disabled={config.views.length <= 1}
                >
                  Delete view
                </Button>
              </div>
            </div>

            {/* Scrollable panel content */}
            <div style={{ flex: 1, overflowY: "auto" }}>

              {/* Print areas section */}
              <div style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>Print areas</span>
                  <div style={{ flex: 1 }} />
                  {config.placements.length > 0 && !addingZone && (
                    <button
                      type="button"
                      onClick={() => setAddingZone(true)}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", borderRadius: 5,
                        border: "1px solid #D1D5DB", background: "#F9FAFB",
                        color: "#374151", fontSize: 11, fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                      Add print area
                    </button>
                  )}
                </div>

                {config.placements.length === 0 && !addingZone ? (
                  <div style={{ padding: "32px 18px", textAlign: "center" }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%", background: "#F3F4F6",
                      display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
                    }}>
                      <Icon source={PlusCircleIcon} tone="subdued" />
                    </div>
                    <Text as="p" variant="headingSm">No print areas yet</Text>
                    <Text as="p" tone="subdued">
                      Add your first print area to define where customers can place their logo on this view.
                    </Text>
                    <div style={{ marginTop: 12 }}>
                      <Button variant="primary" onClick={() => setAddingZone(true)}>Add print area</Button>
                    </div>
                  </div>
                ) : (
                  <ZonePricingPanel
                    placements={config.placements}
                    currency={currencyCode}
                    currencySymbol={currencySymbol}
                    selectedPlacementId={selectedPlacementId}
                    onSelectPlacement={setSelectedPlacementId}
                    methodBasePriceCents={config.allowedMethods[0]?.decorationMethod?.basePriceCents ?? 0}
                    calibrationPxPerCm={view.calibrationPxPerCm ?? undefined}
                    imageWidth={imageDimensions?.width}
                    imageHeight={imageDimensions?.height}
                    placementGeometry={pendingGeometry ?? selectedVariantGeometry}
                    onDirty={setPricingDirty}
                    onSave={handlePricingSave}
                  />
                )}

                {/* Inline "Add print area" name input */}
                {addingZone && (
                  <div style={{
                    padding: "10px 14px", borderRadius: 8, background: "#EFF6FF",
                    border: "1px solid #2563EB", marginTop: config.placements.length > 0 ? 10 : 0,
                  }}>
                    <Text as="p" variant="headingXs" fontWeight="semibold">New print area name</Text>
                    <div style={{ marginTop: 6 }}>
                      <TextField
                        label="Name"
                        labelHidden
                        value={newZoneName}
                        onChange={setNewZoneName}
                        autoComplete="off"
                        placeholder="e.g. Left Chest"
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button variant="primary" onClick={handleAddZone} disabled={!newZoneName.trim()}>
                        Add
                      </Button>
                      <Button onClick={() => { setAddingZone(false); setNewZoneName(""); }}>
                        Cancel
                      </Button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: "#6B7280" }}>
                      <Icon source={CursorIcon} tone="subdued" />
                      <div>
                        <Text as="p" variant="bodySm" fontWeight="medium" tone="subdued">
                          New print area will appear on the canvas
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Drag it to position, then configure pricing.
                        </Text>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Clone layout from another setup */}
              {otherSetups.length > 0 && (
                <div style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <svg width="13" height="13" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>Clone layout from another setup</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCloneModalOpen(true)}
                    disabled={isCloning}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      width: "100%", padding: "8px 12px",
                      borderRadius: 6, border: "1px solid #2563EB",
                      background: "#ffffff", color: "#2563EB",
                      fontSize: 12, fontWeight: 500,
                      cursor: isCloning ? "not-allowed" : "pointer",
                      opacity: isCloning ? 0.6 : 1,
                    }}
                  >
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {isCloning ? "Cloning\u2026" : "Choose setup to clone\u2026"}
                  </button>
                </div>
              )}

              {/* Manage images link */}
              <div style={{ padding: "12px 18px" }}>
                <Link
                  to={`/app/products/${config.id}/images`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    color: "#2563EB", textDecoration: "none", fontSize: 12, fontWeight: 500,
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  Manage product images →
                  <div style={{ flex: 1 }} />
                  <span style={{
                    padding: "2px 8px", borderRadius: 10, background: "#F3F4F6",
                    fontSize: 10, fontWeight: 500, color: "#6B7280",
                  }}>
                    {imageCount} of {variants.length}
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
