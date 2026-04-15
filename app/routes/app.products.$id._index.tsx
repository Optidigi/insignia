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
  useNavigation,
  useActionData,
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
import { AlertCircleIcon, CalculatorIcon, CheckCircleIcon, ImageIcon, ChevronRightIcon } from "@shopify/polaris-icons";
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
import { listMethods } from "../lib/services/methods.server";
import { createView, deleteView, CreateViewSchema } from "../lib/services/views.server";
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

    // Get variant count for this config (total per view)
    const totalVariants = config.linkedProductIds.length > 0
      ? await db.variantViewConfiguration.groupBy({
          by: ["viewId"],
          where: { productConfigId: id },
          _count: true,
        })
      : [];

    // Get filled image counts per view
    const filledImageCounts = await db.variantViewConfiguration.groupBy({
      by: ["viewId"],
      where: { productConfigId: id, imageUrl: { not: null } },
      _count: true,
    });

    // First-setup state: no views have been created yet
    const isFirstSetup = config.views.length === 0;

    // Fetch the Shopify product handle for the "Preview on store" button.
    // Only fetch if there is at least one linked product GID.
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
              variants(first: 1) {
                nodes {
                  id
                }
              }
            }
          }`,
          { variables: { id: firstProductGid } }
        );
        const handleData = (await handleResponse.json()) as {
          data?: { product?: { handle?: string; variants?: { nodes?: Array<{ id?: string }> } } };
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
      } catch (e) {
        // Non-fatal: if the product no longer exists in Shopify, skip the button
        console.error("[GetProductHandle] unexpected error:", e);
        productHandle = null;
        customizerUrl = null;
      }
    }

    const allPlacements = config.views.flatMap((v) => v.placements);
    const pricingRanges = allPlacements.map((p) => {
      const methodBase = config.allowedMethods[0]?.decorationMethod?.basePriceCents ?? 0;
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
      totalVariants,
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

      await updateProductConfig(shop.id, id, {
        allowedMethodIds: methodIds,
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

    throw new Response("Invalid intent", { status: 400 });
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

export default function ProductConfigDetailPage() {
  const { config, methods, stats, totalVariants, filledImageCounts, isFirstSetup, customizerUrl, isConfigReady, currencyCode, pricingRanges, totalMinCents, totalMaxCents } =
    useLoaderData<typeof loader>();

  const currencySymbolMap: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$",
    JPY: "¥", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr",
  };
  const currencySymbol = currencySymbolMap[currencyCode ?? ""] ?? (currencyCode ?? "");
  const fmt = (cents: number) => formatCurrency(cents, currencyCode ?? "USD");
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

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

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setHasChanges(true);
  }, []);

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
        if (data.intent === "update-methods") {
          window.shopify?.toast?.show("Methods updated");
          setHasChanges(false);
        }
        setError(null);
      }
    }
  }, [actionData, isSubmitting]);

  const views = config.views;
  const placements = config.views.flatMap((v) => v.placements);

  const hasBasicChanges =
    name !== config.name ||
    JSON.stringify(selectedProducts.sort()) !==
      JSON.stringify([...config.linkedProductIds].sort());

  const hasMethodChanges =
    JSON.stringify(selectedMethodIds.sort()) !==
      JSON.stringify(
        config.allowedMethods.map((m) => m.decorationMethodId).sort()
      );

  // ---- Handlers ----

  const handleOpenResourcePicker = useCallback(async () => {
    try {
      const selected = await window.shopify.resourcePicker({
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
    setHasChanges(false);
  }, [config.name, config.linkedProductIds, config.allowedMethods]);

  const handleSaveMethods = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "update-methods");
    formData.append("methodIds", JSON.stringify(selectedMethodIds));
    submit(formData, { method: "POST" });
  }, [selectedMethodIds, submit]);

  const handleMethodToggle = useCallback((methodId: string) => {
    setSelectedMethodIds((prev) =>
      prev.includes(methodId)
        ? prev.filter((id) => id !== methodId)
        : [...prev, methodId]
    );
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
        <button variant="primary" type="button" onClick={handleSaveBasic}>Save</button>
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
                    {methods.map((method) => (
                      <Checkbox
                        key={method.id}
                        label={method.name}
                        checked={selectedMethodIds.includes(method.id)}
                        onChange={() => handleMethodToggle(method.id)}
                      />
                    ))}
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
                    {views.map((view) => {
                      const filled = filledImageCounts.find((c) => c.viewId === view.id)?._count ?? 0;
                      const total = totalVariants.find((c) => c.viewId === view.id)?._count ?? 0;
                      const isComplete = total > 0 && filled >= total;
                      const hasPartial = filled > 0 && !isComplete;

                      return (
                        <Link
                          key={view.id}
                          to={`/app/products/${config.id}/views/${view.id}`}
                          style={{
                            display: "block",
                            padding: "10px 12px",
                            borderBottom: "1px solid var(--p-color-border)",
                            textDecoration: "none",
                            color: "inherit",
                            borderRadius: 8,
                            transition: "background 100ms",
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--p-color-bg-surface-hover, #f6f6f7)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <InlineStack align="space-between" blockAlign="center" wrap={false}>
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
                          </InlineStack>
                        </Link>
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
