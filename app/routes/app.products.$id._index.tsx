/**
 * Product Config Detail Page
 *
 * Single hub for managing a product configuration:
 * views, placements (print areas), linked products, and methods.
 */

import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useSubmit,
  useFetcher,
  useNavigation,
  useActionData,
  useNavigate,
  useRevalidator,
  redirect,
  Link,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  Modal,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Checkbox,
  Divider,
  Box,
  ResourceList,
  ResourceItem,
  Icon,
} from "@shopify/polaris";
import { AlertCircleIcon, CalculatorIcon, CheckCircleIcon, ImageIcon, ChevronRightIcon, DragHandleIcon } from "@shopify/polaris-icons";
import { formatCurrency } from "../components/storefront/currency";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getProductConfig,
  updateProductConfig,
  deleteProductConfig,
  duplicateProductConfig,
  UpdateProductConfigSchema,
} from "../lib/services/product-configs.server";
import { groupVariantsByColor } from "../lib/services/image-manager.server";
import { listMethods, effectiveMethodPriceCents } from "../lib/services/methods.server";
import { createView, deleteView, reorderViews, CreateViewSchema } from "../lib/services/views.server";
import { createPlacement, deletePlacement, CreatePlacementSchema } from "../lib/services/placements.server";
import { handleError, validateOrThrow, AppError } from "../lib/errors.server";


// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    throw new Response("Config ID required", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  try {
    const [config, methods] = await Promise.all([
      getProductConfig(shop.id, id),
      listMethods(shop.id),
    ]);

    // NOTE: config.linkedProductIds contains raw Shopify GIDs. If a product is
    // deleted in Shopify, its GID remains in the DB until a merchant manually
    // removes it via the resource picker. The admin UI shows the GID in that case.
    // No Shopify API lookup is done here for product titles, so no null-guard needed.
    const variantConfigCount = config.variantViewConfigurations.length;

    const variantConfigsWithImages = config.variantViewConfigurations.filter(
      (vc) => vc.imageUrl
    ).length;

    const variantConfigsWithGeometry = config.variantViewConfigurations.filter(
      (vc) => vc.placementGeometry && Object.keys(vc.placementGeometry as object).length > 0
    ).length;

    // Also check view-level shared geometry (used when sharedZones is true)
    const viewsWithGeometry = config.views.filter(
      (v) => v.placementGeometry && Object.keys(v.placementGeometry as object).length > 0
    ).length;

    // First-setup state: no views have been created yet
    const isFirstSetup = config.views.length === 0;

    // Fetch the Shopify product handle for the "Preview on store" button.
    // Only fetch if there is at least one linked product GID.
    // Also fetches all variants to compute color groups for badge counts.
    let colorGroupCount = 0;
    let representativeVariantIds: string[] = [];
    let productHandle: string | null = null;
    let customizerUrl: string | null = null;
    const firstProductGid = config.linkedProductIds[0];
    if (firstProductGid) {
      try {
        const handleResponse = await admin.graphql(
          `#graphql
          query GetProductHandle($id: ID!) {
            product(id: $id) {
              handle
              variants(first: 250) {
                nodes {
                  id
                  selectedOptions { name value }
                }
              }
            }
          }`,
          { variables: { id: firstProductGid } }
        );
        const handleData = (await handleResponse.json()) as {
          data?: {
            product?: {
              handle?: string;
              variants?: {
                nodes?: Array<{
                  id?: string;
                  selectedOptions?: Array<{ name: string; value: string }>;
                }>;
              };
            };
          };
          errors?: unknown;
        };
        if (handleData.errors) {
          console.error("[GetProductHandle] GraphQL errors:", handleData.errors);
        }
        productHandle = handleData.data?.product?.handle ?? null;
        const firstVariantGid = handleData.data?.product?.variants?.nodes?.[0]?.id ?? null;
        const productNumericId = firstProductGid?.split("/").pop() ?? null;
        const variantNumericId = firstVariantGid?.split("/").pop() ?? null;
        customizerUrl =
          productNumericId && variantNumericId
            ? `https://${session.shop}/apps/insignia/modal?p=${productNumericId}&v=${variantNumericId}`
            : null;

        // Compute color groups for accurate per-view image badge counts
        const rawVariants = handleData.data?.product?.variants?.nodes ?? [];
        const typedVariants = rawVariants.filter(
          (v): v is { id: string; selectedOptions: Array<{ name: string; value: string }> } =>
            typeof v.id === "string" && Array.isArray(v.selectedOptions)
        );
        const colorGroups = groupVariantsByColor(typedVariants);
        colorGroupCount = colorGroups.length;
        representativeVariantIds = colorGroups.map((g) => g.representativeVariantId);
      } catch (e) {
        // Non-fatal: if the product no longer exists in Shopify, skip the button
        console.error("[GetProductHandle] unexpected error:", e);
        productHandle = null;
        customizerUrl = null;
      }
    }

    // Filled image counts per view, scoped to representative variant IDs only.
    // representativeVariantId is always the image-bearing row (queueSave writes to it;
    // batchSaveImages fans out to all variants including it). One row per color group
    // per view → _count equals number of color groups with an image for that view.
    const filledImageCounts = representativeVariantIds.length > 0
      ? await db.variantViewConfiguration.groupBy({
          by: ["viewId"],
          where: {
            productConfigId: id,
            variantId: { in: representativeVariantIds },
            imageUrl: { not: null },
          },
          _count: true,
        })
      : [];

    const allPlacements = config.views.flatMap((v) => v.placements);
    const pricingRanges = allPlacements.map((p) => {
      const firstMethod = config.allowedMethods[0];
      const methodBase = firstMethod
        ? effectiveMethodPriceCents(
            firstMethod.decorationMethod.basePriceCents,
            firstMethod.basePriceCentsOverride
          )
        : 0;
      const placementBase = p.basePriceAdjustmentCents;
      const stepPrices = p.steps.length > 0 ? p.steps.map((s) => s.priceAdjustmentCents) : [0];
      const minStep = Math.min(...stepPrices);
      const maxStep = Math.max(...stepPrices);
      return {
        name: p.name,
        methodName: config.allowedMethods[0]?.decorationMethod?.name ?? "—",
        minCents: methodBase + placementBase + minStep,
        maxCents: methodBase + placementBase + maxStep,
      };
    });
    const totalMinCents = pricingRanges.length > 0 ? Math.min(...pricingRanges.map((r) => r.minCents)) : 0;
    const totalMaxCents = pricingRanges.length > 0 ? Math.max(...pricingRanges.map((r) => r.maxCents)) : 0;

    // Config is "ready" for storefront use when all setup steps are complete.
    // Geometry can live on views (shared zones) or per-variant configs — either counts.
    const hasAnyGeometry = viewsWithGeometry > 0 || variantConfigsWithGeometry > 0;
    const isConfigReady =
      config.linkedProductIds.length > 0 &&
      config.allowedMethods.length > 0 &&
      config.views.length > 0 &&
      variantConfigsWithImages > 0 &&
      allPlacements.length > 0 &&
      hasAnyGeometry;

    // Sync insignia.enabled metafield: set "true" only when config is ready,
    // "false" otherwise. This controls the storefront Customize button visibility.
    if (config.linkedProductIds.length > 0) {
      void admin
        .graphql(
          `#graphql
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
          {
            variables: {
              metafields: (config.linkedProductIds as string[]).map((productGid) => ({
                ownerId: productGid,
                namespace: "insignia",
                key: "enabled",
                value: isConfigReady ? "true" : "false",
                type: "single_line_text_field",
              })),
            },
          }
        )
        .catch(() => {}); // non-fatal, ignore errors
    }

    return {
      config,
      methods,
      shopId: shop.id,
      shopDomain: session.shop,
      currencyCode: shop.currencyCode,
      productHandle,
      customizerUrl,
      isConfigReady,
      isFirstSetup,
      stats: {
        variantConfigCount,
        variantConfigsWithImages,
        variantConfigsWithGeometry,
        viewsWithGeometry,
      },
      colorGroupCount,
      filledImageCounts,
      pricingRanges,
      totalMinCents,
      totalMaxCents,
    };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      throw new Response("Config not found", { status: 404 });
    }
    throw error;
  }
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const { id } = params;

    if (!id) {
      throw new Response("Config ID required", { status: 400 });
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    // Verify config ownership before ANY intent (services accept shopId but
    // create-view/delete-view use only configId internally — guard here)
    const configOwnership = await db.productConfig.findFirst({
      where: { id, shopId: shop.id },
      select: { id: true, name: true, linkedProductIds: true },
    });
    if (!configOwnership) {
      throw new Response("Not found", { status: 404 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await deleteProductConfig(shop.id, id);
      return redirect("/app/products");
    }

    if (intent === "update-basic") {
      const name = formData.get("name") as string;
      const productIds = JSON.parse(formData.get("productIds") as string || "[]") as string[];

      const prevProductIds: string[] = (configOwnership.linkedProductIds ?? []) as string[];

      const input = validateOrThrow(
        UpdateProductConfigSchema,
        { name, linkedProductIds: productIds },
        "Invalid config data"
      );

      await updateProductConfig(shop.id, id, input);

      // Sync the insignia.enabled metafield so the theme block only shows the
      // Customize button on products that have an active Insignia configuration.
      try {
        const added = productIds.filter((pid) => !prevProductIds.includes(pid));
        const removed = prevProductIds.filter((pid) => !productIds.includes(pid));

        // Set metafield on newly linked products
        if (added.length > 0) {
          await admin.graphql(
            `#graphql
            mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                userErrors { field message }
              }
            }`,
            {
              variables: {
                metafields: added.map((productGid) => ({
                  ownerId: productGid,
                  namespace: "insignia",
                  key: "enabled",
                  value: "true",
                  type: "single_line_text_field",
                })),
              },
            }
          );
        }

        // Delete metafield on unlinked products
        for (const productGid of removed) {
          const metafieldQuery = await admin.graphql(
            `#graphql
            query GetInsigniaMetafield($id: ID!) {
              product(id: $id) {
                metafield(namespace: "insignia", key: "enabled") { id }
              }
            }`,
            { variables: { id: productGid } }
          );
          const mfData = (await metafieldQuery.json()) as {
            data?: { product?: { metafield?: { id?: string } } };
          };
          const metafieldId = mfData.data?.product?.metafield?.id;
          if (metafieldId) {
            await admin.graphql(
              `#graphql
              mutation MetafieldDelete($input: MetafieldDeleteInput!) {
                metafieldDelete(input: $input) {
                  userErrors { field message }
                }
              }`,
              { variables: { input: { id: metafieldId } } }
            );
          }
        }
      } catch (metafieldError) {
        // Non-fatal: log but do not fail the save
        console.error("[update-basic] metafield sync error:", metafieldError);
      }

      return { success: true, intent: "update-basic" };
    }

    if (intent === "update-methods") {
      const methodIds = JSON.parse(formData.get("methodIds") as string || "[]");
      const rawOverrides = formData.get("methodPriceOverrides");
      const methodPriceOverrides = rawOverrides
        ? (JSON.parse(rawOverrides as string) as Record<string, number | null>)
        : undefined;

      await updateProductConfig(shop.id, id, {
        allowedMethodIds: methodIds,
        methodPriceOverrides,
      });
      return { success: true, intent: "update-methods" };
    }

    if (intent === "create-view") {
      const perspective = (formData.get("perspective") as string) || "custom";
      const name = (formData.get("name") as string | null)?.trim() || undefined;
      const input = validateOrThrow(
        CreateViewSchema,
        { perspective, name },
        "Invalid view data"
      );
      const newView = await createView(id, input);
      return redirect(`/app/products/${id}/views/${newView.id}`);
    }

    if (intent === "delete-view") {
      const viewId = formData.get("viewId") as string;
      // Guard: cannot delete the last view
      const viewCount = await db.productView.count({ where: { productConfigId: id } });
      if (viewCount <= 1) {
        return { success: false, intent: "delete-view", error: "Cannot delete the last view. A product setup must have at least one view." };
      }
      await deleteView(id, viewId);
      return { success: true, intent: "delete-view" };
    }

    if (intent === "create-placement") {
      const placementName = (formData.get("placementName") as string)?.trim() || "Print area";
      const input = validateOrThrow(
        CreatePlacementSchema,
        { name: placementName },
        "Invalid placement data"
      );
      await createPlacement(shop.id, id, input);
      // Navigate to the first view editor so the merchant can position it
      const firstView = await db.productView.findFirst({
        where: { productConfigId: id },
        orderBy: { displayOrder: "asc" },
        select: { id: true },
      });
      if (firstView) return redirect(`/app/products/${id}/views/${firstView.id}`);
      return { success: true, intent: "create-placement" };
    }

    if (intent === "delete-placement") {
      const placementId = formData.get("placementId") as string;
      // Guard: cannot delete the last placement
      const placementCount = await db.placementDefinition.count({
        where: { productView: { productConfigId: id } },
      });
      if (placementCount <= 1) {
        return { success: false, intent: "delete-placement", error: "Cannot delete the last placement. A product setup must have at least one placement." };
      }
      await deletePlacement(shop.id, id, placementId);
      return { success: true, intent: "delete-placement" };
    }

    if (intent === "duplicate") {
      const newConfig = await duplicateProductConfig(
        shop.id,
        id,
        `${configOwnership.name} (copy)`,
        configOwnership.linkedProductIds as string[]
      );
      return redirect(`/app/products/${newConfig.id}`);
    }

    if (intent === "reorder-views") {
      const orderedViewIdsJson = formData.get("orderedViewIds") as string;
      if (!orderedViewIdsJson) {
        throw new Response("Missing orderedViewIds", { status: 400 });
      }
      let orderedViewIds: string[];
      try {
        orderedViewIds = JSON.parse(orderedViewIdsJson);
      } catch {
        throw new Response("Invalid orderedViewIds JSON", { status: 400 });
      }
      if (!Array.isArray(orderedViewIds) || orderedViewIds.length === 0 || orderedViewIds.some((v) => typeof v !== "string" || !v)) {
        throw new Response("orderedViewIds must be a non-empty array of strings", { status: 400 });
      }
      if (new Set(orderedViewIds).size !== orderedViewIds.length) {
        throw new Response("Duplicate IDs in orderedViewIds", { status: 400 });
      }
      // configOwnership already verified ownership (shopId check above)
      await reorderViews(id, orderedViewIds);
      return { success: true, intent: "reorder-views" };
    }

    throw new Response("Invalid intent", { status: 400 });
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Helpers
// ============================================================================

type AllowedMethods = ReturnType<typeof useLoaderData<typeof loader>>["config"]["allowedMethods"];

function deriveOverridesFromConfig(
  methods: AllowedMethods
): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const row of methods ?? []) {
    if (row.basePriceCentsOverride != null) {
      initial[row.decorationMethodId] = (row.basePriceCentsOverride / 100).toFixed(2);
    }
  }
  return initial;
}

// ============================================================================
// Component
// ============================================================================

export default function ProductConfigDetailPage() {
  const { config, methods, stats, colorGroupCount, filledImageCounts, isFirstSetup, customizerUrl, isConfigReady, currencyCode, pricingRanges, totalMinCents, totalMaxCents } =
    useLoaderData<typeof loader>();

  const currencySymbolMap: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$",
    JPY: "¥", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr",
  };
  const currencySymbol = currencySymbolMap[currencyCode ?? ""] ?? (currencyCode ?? "");
  const fmt = (cents: number) => formatCurrency(cents, currencyCode ?? "USD");
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const methodFetcher = useFetcher();
  const viewReorderFetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const [hasChanges, setHasChanges] = useState(false);
  const BANNER_KEY = `insignia-first-setup-dismissed-${config.id}`;
  const [firstSetupBannerDismissed, setFirstSetupBannerDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(BANNER_KEY) === "1"
  );
  const handleDismissBanner = useCallback(() => {
    sessionStorage.setItem(BANNER_KEY, "1");
    setFirstSetupBannerDismissed(true);
  }, [BANNER_KEY]);

  useEffect(() => {
    const shopify = window.shopify;
    if (hasChanges) {
      shopify?.saveBar?.show?.("product-detail-save-bar");
    } else {
      shopify?.saveBar?.hide?.("product-detail-save-bar");
    }
  }, [hasChanges]);

  const [name, setName] = useState(config.name);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    config.linkedProductIds
  );
  const [selectedMethodIds, setSelectedMethodIds] = useState<string[]>(
    config.allowedMethods.map((m) => m.decorationMethodId)
  );

  // Per-method price override inputs: key = decorationMethodId, value = display string (empty = inherit)
  const [methodOverrides, setMethodOverrides] = useState<Record<string, string>>(() =>
    deriveOverridesFromConfig(config.allowedMethods)
  );

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setHasChanges(true);
  }, []);

  // Drag-to-reorder state for Views card
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);
  const [dragOverViewId, setDragOverViewId] = useState<string | null>(null);
  const [localViewOrder, setLocalViewOrder] = useState<string[]>(() =>
    config.views.map((v) => v.id)
  );

  // Re-sync localViewOrder when loader data updates (after revalidation)
  useEffect(() => {
    setLocalViewOrder(config.views.map((v) => v.id));
  }, [config.views]);

  // Revalidate after successful view reorder
  useEffect(() => {
    const data = viewReorderFetcher.data as Record<string, unknown> | undefined;
    if (!data || viewReorderFetcher.state !== "idle") return;
    if (data.success && data.intent === "reorder-views") {
      revalidator.revalidate();
    }
  }, [viewReorderFetcher.data, viewReorderFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modals (delete only — add flows navigate to the view editor)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [deletePlacementId, setDeletePlacementId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const isSubmitting = navigation.state === "submitting";

  // Handle action results
  useEffect(() => {
    if (actionData && !isSubmitting) {
      const data = actionData as Record<string, unknown>;
      if ("error" in data) {
        setError((data.error as { message: string }).message);
      } else if ("success" in data) {
        if (data.intent === "delete-view") {
          if (data.success) {
            window.shopify?.toast?.show("View deleted");
          } else {
            window.shopify?.toast?.show(String(data.error ?? "Cannot delete view"), { isError: true });
          }
        }
        if (data.intent === "delete-placement") {
          if (data.success) {
            window.shopify?.toast?.show("Print area deleted");
          } else {
            window.shopify?.toast?.show(String(data.error ?? "Cannot delete placement"), { isError: true });
          }
        }
        if (data.intent === "update-basic") {
          window.shopify?.toast?.show("Changes saved");
          setHasChanges(false);
        }
        setError(null);
      }
    }
  }, [actionData, isSubmitting]);

  // Handle methodFetcher response (separate from main submit to avoid dual-submit race)
  useEffect(() => {
    const data = methodFetcher.data as Record<string, unknown> | undefined;
    if (!data || methodFetcher.state !== "idle") return;
    if (data.success && data.intent === "update-methods") {
      window.shopify?.toast?.show("Methods updated");
      setHasChanges(false);
      setMethodOverrides(deriveOverridesFromConfig(config.allowedMethods));
    }
  }, [methodFetcher.data, methodFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const views = config.views;
  // Optimistic display order for drag-to-reorder (falls back to server order)
  const displayViews = localViewOrder
    .map((id) => views.find((v) => v.id === id))
    .filter((v): v is typeof views[number] => v !== undefined);
  const placements = config.views.flatMap((v) => v.placements);

  const hasBasicChanges =
    name !== config.name ||
    JSON.stringify(selectedProducts.sort()) !==
      JSON.stringify([...config.linkedProductIds].sort());

  const hasMethodChanges = (() => {
    if (JSON.stringify(selectedMethodIds.sort()) !==
        JSON.stringify(config.allowedMethods.map((m) => m.decorationMethodId).sort())) {
      return true;
    }
    // Also detect override edits
    for (const row of config.allowedMethods) {
      const savedCents = row.basePriceCentsOverride;
      const inputStr = methodOverrides[row.decorationMethodId] ?? "";
      const savedStr = savedCents != null ? (savedCents / 100).toFixed(2) : "";
      if (inputStr !== savedStr) return true;
    }
    return false;
  })();

  // ---- Handlers ----

  const handleOpenResourcePicker = useCallback(async () => {
    try {
      const selected = await window.shopify?.resourcePicker?.({
        type: "product",
        multiple: true,
        action: "select",
        selectionIds: selectedProducts.map((id) => ({ id })),
        query: "NOT tag:insignia-fee",
      });
      if (selected && selected.length > 0) {
        setSelectedProducts(selected.map((p) => p.id));
        setHasChanges(true);
      }
    } catch (e) {
      console.error("ResourcePicker error:", e);
    }
  }, [selectedProducts]);

  const handleSaveBasic = useCallback(() => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const formData = new FormData();
    formData.append("intent", "update-basic");
    formData.append("name", name.trim());
    formData.append("productIds", JSON.stringify(selectedProducts));
    submit(formData, { method: "POST" });
    setError(null);
  }, [name, selectedProducts, submit]);

  const handleDiscard = useCallback(() => {
    setName(config.name);
    setSelectedProducts(config.linkedProductIds);
    setSelectedMethodIds(config.allowedMethods.map((m) => m.decorationMethodId));
    const initial: Record<string, string> = {};
    for (const row of config.allowedMethods) {
      if (row.basePriceCentsOverride != null) {
        initial[row.decorationMethodId] = (row.basePriceCentsOverride / 100).toFixed(2);
      }
    }
    setMethodOverrides(initial);
    setHasChanges(false);
  }, [config.name, config.linkedProductIds, config.allowedMethods]);

  const handleSaveMethods = useCallback(() => {
    // Build per-method price override payload (only for checked methods)
    const overridesPayload: Record<string, number | null> = {};
    for (const methodId of selectedMethodIds) {
      const inputStr = (methodOverrides[methodId] ?? "").trim();
      if (inputStr === "") {
        overridesPayload[methodId] = null;
      } else {
        const parsed = parseFloat(inputStr);
        overridesPayload[methodId] = Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
      }
    }

    const formData = new FormData();
    formData.append("intent", "update-methods");
    formData.append("methodIds", JSON.stringify(selectedMethodIds));
    formData.append("methodPriceOverrides", JSON.stringify(overridesPayload));
    methodFetcher.submit(formData, { method: "POST" });
  }, [selectedMethodIds, methodOverrides, methodFetcher]);

  const handleSaveAll = useCallback(() => {
    if (hasBasicChanges) {
      handleSaveBasic();
    }
    if (hasMethodChanges) {
      handleSaveMethods();
    }
    if (!hasBasicChanges && !hasMethodChanges) {
      setHasChanges(false);
    }
  }, [hasBasicChanges, hasMethodChanges, handleSaveBasic, handleSaveMethods]);

  const handleMethodToggle = useCallback((methodId: string) => {
    setSelectedMethodIds((prev) => {
      const isSelected = prev.includes(methodId);
      if (isSelected) {
        setMethodOverrides((overrides) => {
          if (!(methodId in overrides)) return overrides;
          const next = { ...overrides };
          delete next[methodId];
          return next;
        });
        return prev.filter((id) => id !== methodId);
      }
      return [...prev, methodId];
    });
    setHasChanges(true);
  }, []);

  const handleDelete = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "POST" });
    setDeleteModalOpen(false);
  }, [submit]);

  const handleDuplicate = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "duplicate");
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleDeleteView = useCallback(() => {
    if (!deleteViewId) return;
    const formData = new FormData();
    formData.append("intent", "delete-view");
    formData.append("viewId", deleteViewId);
    submit(formData, { method: "POST" });
    setDeleteViewId(null);
  }, [deleteViewId, submit]);

  const handleDeletePlacement = useCallback(() => {
    if (!deletePlacementId) return;
    const formData = new FormData();
    formData.append("intent", "delete-placement");
    formData.append("placementId", deletePlacementId);
    submit(formData, { method: "POST" });
    setDeletePlacementId(null);
  }, [deletePlacementId, submit]);

  // ---- Setup checklist ----

  const hasViews = views.length > 0;
  const hasPlacements = placements.length > 0;
  const hasLinkedProducts = config.linkedProductIds.length > 0;
  const hasMethods = config.allowedMethods.length > 0;
  const hasImages = stats.variantConfigsWithImages > 0;
  const hasGeometry = stats.variantConfigsWithGeometry > 0 || stats.viewsWithGeometry > 0;

  const setupSteps = [
    { done: hasLinkedProducts, label: "Linked products" },
    { done: hasMethods, label: "Decoration methods" },
    { done: hasViews, label: "Views added" },
    { done: hasImages, label: "Variant images uploaded" },
    { done: hasPlacements, label: "Print areas defined" },
    { done: hasGeometry, label: "Print areas positioned" },
  ];
  const completedSteps = setupSteps.filter((s) => s.done).length;

  return (
    <Page
      title={config.name}
      subtitle={`${config.linkedProductIds.length} product${config.linkedProductIds.length !== 1 ? "s" : ""} · ${config.views.length} view${config.views.length !== 1 ? "s" : ""} · ${placements.length} print area${placements.length !== 1 ? "s" : ""}`}
      backAction={{ content: "Products", url: "/app/products" }}
      secondaryActions={
        customizerUrl
          ? [{
              content: "Preview on store",
              onAction: () => setTimeout(() => window.open(customizerUrl!, "_blank"), 0),
              disabled: !isConfigReady,
              helpText: !isConfigReady ? "Complete all setup steps to enable preview" : undefined,
            }]
          : undefined
      }
    >
      <ui-save-bar id="product-detail-save-bar">
        <button variant="primary" type="button" onClick={handleSaveAll}>Save</button>
        <button type="button" onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* First-setup guidance banner — shown when no views have been created yet */}
        {isFirstSetup && !firstSetupBannerDismissed && (
          <Layout.Section>
            <Banner
              title="Product setup created — next steps"
              tone="info"
              onDismiss={handleDismissBanner}
              action={{
                content: "Manage Images",
                url: `/app/products/${config.id}/images`,
              }}
            >
              <p>Upload product photos in the Image Manager, then position print areas in the View Editor.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* 0-methods warning */}
        {selectedMethodIds.length === 0 && (
          <Layout.Section>
            <Banner tone="warning">
              This product has no decoration methods linked. Customers won&apos;t be able to customize it until you add at least one method.
            </Banner>
          </Layout.Section>
        )}

        {/* 0-placements warning */}
        {placements.length === 0 && (
          <Layout.Section>
            <Banner tone="warning">
              This product has no print areas defined. Add at least one print area before publishing.
            </Banner>
          </Layout.Section>
        )}

        {/* ============ MAIN CONTENT ============ */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* ---- General ---- */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  General
                </Text>

                <FormLayout>
                  <TextField
                    label="Setup name"
                    value={name}
                    onChange={handleNameChange}
                    autoComplete="off"
                  />

                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      Linked products ({selectedProducts.length})
                    </Text>
                    <div>
                      <Button onClick={handleOpenResourcePicker}>
                        Change products
                      </Button>
                    </div>
                  </BlockStack>
                </FormLayout>

                {hasBasicChanges && (
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={handleSaveBasic}
                      loading={isSubmitting}
                    >
                      Save changes
                    </Button>
                  </InlineStack>
                )}

                <Divider />

                <Text variant="headingSm" as="h3">
                  Decoration methods
                </Text>
                {methods.length === 0 ? (
                  <Banner>
                    <p>
                      No decoration methods available.{" "}
                      <Button variant="plain" url="/app/methods">Create one first</Button>.
                    </p>
                  </Banner>
                ) : (
                  <BlockStack gap="200">
                    {methods.map((method) => {
                      const isChecked = selectedMethodIds.includes(method.id);
                      return (
                        <BlockStack key={method.id} gap="150">
                          <Checkbox
                            label={method.name}
                            checked={isChecked}
                            onChange={() => handleMethodToggle(method.id)}
                          />
                          {isChecked && (
                            <Box paddingInlineStart="600">
                              <TextField
                                label="Price override"
                                type="number"
                                prefix={currencySymbol}
                                helpText="Leave blank to use method default"
                                autoComplete="off"
                                value={methodOverrides[method.id] ?? ""}
                                onChange={(v) => {
                                  setMethodOverrides((prev) => ({ ...prev, [method.id]: v }));
                                  setHasChanges(true);
                                }}
                                disabled={isSubmitting}
                              />
                            </Box>
                          )}
                        </BlockStack>
                      );
                    })}
                  </BlockStack>
                )}

                {hasMethodChanges && (
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={handleSaveMethods}
                      loading={isSubmitting}
                    >
                      Save methods
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {/* ---- Views ---- */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Views
                  </Text>
                  {views.length > 0 ? (
                    <InlineStack gap="200">
                      <Button
                        loading={isSubmitting}
                        onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "create-view");
                          fd.append("perspective", "custom");
                          fd.append("name", "New view");
                          submit(fd, { method: "POST" });
                        }}
                      >
                        Add view
                      </Button>
                      <Link to={`/app/products/${config.id}/views/${views[0].id}`}>
                        <Button variant="primary">Open view editor</Button>
                      </Link>
                    </InlineStack>
                  ) : (
                    <Button
                      loading={isSubmitting}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "create-view");
                        fd.append("perspective", "custom");
                        fd.append("name", "Front");
                        submit(fd, { method: "POST" });
                      }}
                    >
                      Add first view
                    </Button>
                  )}
                </InlineStack>

                {views.length === 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued" variant="bodySm">
                      No views yet. Add a view to get started with image
                      uploads and print areas.
                    </Text>
                  </BlockStack>
                ) : (
                  <BlockStack gap="0">
                    {displayViews.map((view) => {
                      const filled = filledImageCounts.find((c) => c.viewId === view.id)?._count ?? 0;
                      const total = colorGroupCount;
                      const isComplete = total > 0 && filled >= total;
                      const hasPartial = filled > 0 && !isComplete;
                      const isBeingDragged = draggedViewId === view.id;
                      const isDropTarget = dragOverViewId === view.id;

                      return (
                        <div
                          key={view.id}
                          onDragOver={(e) => {
                            if (!draggedViewId) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (draggedViewId !== view.id) {
                              setDragOverViewId(view.id);
                            }
                          }}
                          onDragLeave={() => setDragOverViewId(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!draggedViewId || draggedViewId === view.id) return;
                            const fromIdx = localViewOrder.indexOf(draggedViewId);
                            const toIdx = localViewOrder.indexOf(view.id);
                            if (fromIdx === -1 || toIdx === -1) return;
                            const newOrder = [...localViewOrder];
                            newOrder.splice(fromIdx, 1);
                            newOrder.splice(toIdx, 0, draggedViewId);
                            setDraggedViewId(null);
                            setDragOverViewId(null);
                            setLocalViewOrder(newOrder);
                            const formData = new FormData();
                            formData.append("intent", "reorder-views");
                            formData.append("orderedViewIds", JSON.stringify(newOrder));
                            viewReorderFetcher.submit(formData, { method: "POST" });
                          }}
                          style={{
                            display: "block",
                            borderBottom: "1px solid var(--p-color-border)",
                            borderRadius: 8,
                            opacity: isBeingDragged ? 0.4 : 1,
                            outline: isDropTarget ? "1.5px solid #2563EB" : undefined,
                            transition: "opacity 150ms ease",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "10px 12px",
                              textDecoration: "none",
                              color: "inherit",
                              gap: 8,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--p-color-bg-surface-hover, #f6f6f7)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                          >
                            {/* Drag handle — only this element is draggable to avoid Link URL drag conflict */}
                            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                            <span
                              draggable
                              aria-label="Drag to reorder"
                              role="button"
                              tabIndex={0}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", view.id);
                                setDraggedViewId(view.id);
                              }}
                              onDragEnd={() => {
                                setDraggedViewId(null);
                                setDragOverViewId(null);
                              }}
                              onKeyDown={(e) => {
                                // Keyboard reorder: move up/down with arrow keys
                                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                  e.preventDefault();
                                  const currentIdx = localViewOrder.indexOf(view.id);
                                  const targetIdx = e.key === "ArrowUp" ? currentIdx - 1 : currentIdx + 1;
                                  if (targetIdx < 0 || targetIdx >= localViewOrder.length) return;
                                  const newOrder = [...localViewOrder];
                                  newOrder.splice(currentIdx, 1);
                                  newOrder.splice(targetIdx, 0, view.id);
                                  setLocalViewOrder(newOrder);
                                  const formData = new FormData();
                                  formData.append("intent", "reorder-views");
                                  formData.append("orderedViewIds", JSON.stringify(newOrder));
                                  viewReorderFetcher.submit(formData, { method: "POST" });
                                }
                              }}
                              style={{
                                flexShrink: 0,
                                cursor: "grab",
                                display: "flex",
                                alignItems: "center",
                                color: "var(--p-color-icon-subdued)",
                              }}
                            >
                              <Icon source={DragHandleIcon} tone="subdued" />
                            </span>

                            {/* Clickable row navigates to view editor */}
                            {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events */}
                            <div
                              role="link"
                              style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", cursor: "pointer", minWidth: 0 }}
                              onClick={() => navigate(`/app/products/${config.id}/views/${view.id}`)}
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <Icon
                                  source={ImageIcon}
                                  tone={isComplete ? "success" : hasPartial ? "warning" : "subdued"}
                                />
                                <Text fontWeight="semibold" as="span">
                                  {view.name || view.perspective.charAt(0).toUpperCase() + view.perspective.slice(1)}
                                </Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone={isComplete ? "success" : hasPartial ? "warning" : undefined}>
                                  {`${filled}/${total} images`}
                                </Badge>
                                <Icon source={ChevronRightIcon} tone="subdued" />
                              </InlineStack>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* ---- Print Areas (Placements) ---- */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Print areas
                  </Text>
                  {views.length > 0 ? (
                    <Link to={`/app/products/${config.id}/views/${views[0].id}`}>
                      <Button>Add in view editor</Button>
                    </Link>
                  ) : (
                    <Button disabled>Add print area</Button>
                  )}
                </InlineStack>

                {placements.length === 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued" variant="bodySm">
                      No print areas defined yet. Add one so customers can
                      choose where to place their logo.
                    </Text>
                  </BlockStack>
                ) : (
                  <ResourceList
                    resourceName={{
                      singular: "print area",
                      plural: "print areas",
                    }}
                    items={placements}
                    renderItem={(placement) => {
                      const basePrice =
                        placement.basePriceAdjustmentCents === 0
                          ? null
                          : `${currencySymbol}${(placement.basePriceAdjustmentCents / 100).toFixed(2)}`;
                      const tierCount = placement.steps.length;

                      return (
                        <ResourceItem
                          id={placement.id}
                          url={config.views[0] ? `/app/products/${config.id}/views/${config.views[0].id}` : `/app/products/${config.id}`}
                          accessibilityLabel={`Edit ${placement.name} print area in View Editor`}
                        >
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            wrap={false}
                          >
                            <BlockStack gap="100">
                              <Text variant="bodyMd" fontWeight="bold" as="h3">
                                {placement.name}
                              </Text>
                              <Text variant="bodySm" tone="subdued" as="span">
                                {basePrice ? `Base: ${basePrice} · ` : ""}{tierCount} price {tierCount === 1 ? "tier" : "tiers"}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </BlockStack>
            </Card>

          </BlockStack>
        </Layout.Section>

        {/* ============ SIDEBAR ============ */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Setup checklist */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingSm" as="h2">
                    Setup progress
                  </Text>
                  <Badge
                    tone={
                      completedSteps === setupSteps.length
                        ? "success"
                        : "attention"
                    }
                  >
                    {`${completedSteps}/${setupSteps.length}`}
                  </Badge>
                </InlineStack>
                <BlockStack gap="100">
                  {setupSteps.map((step, i) => (
                    <InlineStack key={i} gap="200" blockAlign="center" wrap={false}>
                      <Box minWidth="20px">
                        <Icon
                          source={
                            step.done ? CheckCircleIcon : AlertCircleIcon
                          }
                          tone={step.done ? "success" : "subdued"}
                        />
                      </Box>
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={step.done ? undefined : "subdued"}
                      >
                        {step.label}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Manage Images */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Images</Text>
                <Text tone="subdued" as="p" variant="bodySm">
                  Upload product images for each view and variant combination.
                </Text>
                <div>
                  <Button
                    url={config.views.length > 0 ? `/app/products/${config.id}/images` : undefined}
                    disabled={config.views.length === 0}
                    variant="secondary"
                  >
                    Manage Images
                  </Button>
                </div>
                {config.views.length === 0 && (
                  <Text tone="subdued" variant="bodySm" as="p">Add views to start uploading images</Text>
                )}
              </BlockStack>
            </Card>

            {/* Pricing Summary — only shown when there are placements and at least one method */}
            {pricingRanges.length > 0 && config.allowedMethods.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Box>
                      <Icon source={CalculatorIcon} tone="subdued" />
                    </Box>
                    <Text variant="headingSm" as="h2">
                      Pricing Summary
                    </Text>
                  </InlineStack>
                  <BlockStack gap="300">
                    {pricingRanges.map((range, i) => (
                      <InlineStack key={i} align="space-between" blockAlign="baseline" gap="200" wrap={false}>
                        <BlockStack gap="025">
                          <Text variant="bodySm" fontWeight="medium" as="span">
                            {range.name}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="span">
                            {range.methodName}
                          </Text>
                        </BlockStack>
                        <Text variant="bodySm" as="span">
                          {range.minCents === range.maxCents
                            ? fmt(range.minCents)
                            : `${fmt(range.minCents)} – ${fmt(range.maxCents)}`}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                  <Divider />
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <Text variant="bodySm" tone="subdued" as="span">
                      Total range
                    </Text>
                    <Text variant="bodySm" fontWeight="semibold" as="span">
                      {totalMinCents === totalMaxCents
                        ? fmt(totalMinCents)
                        : `${fmt(totalMinCents)} – ${fmt(totalMaxCents)}`}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* Duplicate */}
            <Card>
              <BlockStack gap="300">
                <Text tone="subdued" as="p" variant="bodySm">
                  Creates a copy of this setup including views, placements,
                  and linked products.
                </Text>
                <div>
                  <Button
                    onClick={handleDuplicate}
                    loading={isSubmitting && navigation.formData?.get("intent") === "duplicate"}
                    disabled={isSubmitting}
                  >
                    Duplicate setup
                  </Button>
                </div>
              </BlockStack>
            </Card>

            {/* Delete */}
            <Card>
              <BlockStack gap="300">
                <Text tone="subdued" as="p" variant="bodySm">
                  Permanently delete this product setup, all views, print
                  areas, and variant settings.
                </Text>
                <div>
                  <Button
                    tone="critical"
                    onClick={() => setDeleteModalOpen(true)}
                  >
                    Delete product setup
                  </Button>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* ============ MODALS ============ */}

      {/* Delete View */}
      <Modal
        open={deleteViewId !== null}
        onClose={() => setDeleteViewId(null)}
        title="Delete view?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteView,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteViewId(null) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will remove the view and all its variant images and print
            area settings. This cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Delete Placement */}
      <Modal
        open={deletePlacementId !== null}
        onClose={() => setDeletePlacementId(null)}
        title="Delete print area?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeletePlacement,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeletePlacementId(null) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently remove this print area, its price tiers,
            and all print area settings across views. This cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Delete Config */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete product setup?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete &quot;{config.name}&quot;? This
            will also delete all views, print areas, and variant settings.
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
