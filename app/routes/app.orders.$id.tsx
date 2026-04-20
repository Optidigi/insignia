/**
 * Order detail page — shows customization details per line item.
 * Includes Logo Later status and artwork upload.
 * Canonical: docs/admin/order-detail-rendering.md, docs/admin/orders-workflow.md
 */

import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Divider,
  Banner,
  Box,
  Button,
  Collapsible,
  DropZone,
  Spinner,
  Thumbnail,
  TextField,
} from "@shopify/polaris";
import { ExternalIcon } from "@shopify/polaris-icons";
import { ProductionStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleError } from "../lib/errors.server";
import { getPresignedDownloadUrl, getPresignedGetUrl } from "../lib/storage.server";
import type { PlacementGeometry } from "../lib/admin-types";

const OrderLinePreviewLazy = lazy(() =>
  import("../components/OrderLinePreview.client").then((m) => ({ default: m.OrderLinePreview }))
);

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
          state: true,
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
    select: { placeholderLogoImageUrl: true, emailReminderTemplate: true },
  });

  // Fetch order details from Shopify Admin GraphQL: customer info + line item prices
  let customer: { name: string; email: string } | null = null;
  const shopifyLineItemPrices: Record<string, { amount: string; currencyCode: string; quantity: number }> = {};
  let currencyCode = shop.currencyCode ?? "";
  let orderDataError = false;
  try {
    const orderResponse = await admin.graphql(
      `#graphql
      query GetOrderDetails($id: ID!) {
        order(id: $id) {
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
                quantity
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
          currencyCode?: string;
          customer?: { firstName?: string; lastName?: string; email?: string } | null;
          lineItems?: {
            edges: Array<{
              node: {
                id: string;
                quantity: number;
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
      }
    }
  } catch (e) {
    console.error("[GetOrderDetails] unexpected error:", e);
    orderDataError = true;
  }

  const idNum = shopifyOrderId.replace(/\D/g, "");
  const orderName = `#${idNum.slice(-6)}`;

  // --- Per-line view preview data (Konva canvas) ---
  const linePreviewData: Record<string, { imageUrl: string; geometry: Record<string, PlacementGeometry | null>; logoUrls: Record<string, string | null> } | null> = {};

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
            select: { id: true, placementGeometry: true, sharedZones: true },
          },
        },
      });

      let chosen: (typeof variantConfigs)[0] | null = null;
      for (const vc of variantConfigs) {
        if (vc.imageUrl) { chosen = vc; break; }
      }
      if (!chosen) { linePreviewData[line.id] = null; return; }

      // Use immutable snapshot geometry when available; fall back to live config
      const snapshot = line.placementGeometrySnapshotByViewId as Record<string, Record<string, PlacementGeometry | null> | null> | null;
      let effectiveGeometry: Record<string, PlacementGeometry | null>;

      if (!line.useLiveConfigFallback && snapshot && chosen.productView?.id && snapshot[chosen.productView.id]) {
        effectiveGeometry = (snapshot[chosen.productView.id] ?? {}) as Record<string, PlacementGeometry | null>;
      } else {
        const sharedZones = chosen.productView?.sharedZones ?? true;
        const sharedGeometry = (chosen.productView?.placementGeometry ?? null) as Record<string, PlacementGeometry | null> | null;
        const perVariantGeometry = (chosen.placementGeometry ?? null) as Record<string, PlacementGeometry | null> | null;
        effectiveGeometry = sharedZones
          ? (sharedGeometry ?? perVariantGeometry ?? {})
          : (perVariantGeometry ?? sharedGeometry ?? {});
      }

      let signedImageUrl: string | null = null;
      try {
        const rawKey = chosen.imageUrl!;
        const key = rawKey.startsWith("shops/")
          ? rawKey
          : rawKey.split("/").slice(-4).join("/");
        signedImageUrl = await getPresignedGetUrl(key, 3600);
      } catch (e) {
        console.error(`[OrderDetail] failed to sign image URL for line ${line.id}:`, e);
      }

      // Build logoUrls map from already-computed logoAssetPreviewUrls
      const logoUrlsForLine: Record<string, string | null> = {};
      if (line.logoAssetIdsByPlacementId) {
        for (const [placementId, logoId] of Object.entries(line.logoAssetIdsByPlacementId as Record<string, string | null>)) {
          const previewUrl = logoId ? (logoAssetPreviewUrls[logoId] || null) : null;
          logoUrlsForLine[placementId] = previewUrl;
        }
      }

      linePreviewData[line.id] = signedImageUrl
        ? { imageUrl: signedImageUrl, geometry: effectiveGeometry, logoUrls: logoUrlsForLine }
        : null;
    })
  );

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
      configState: l.customizationConfig?.state ?? "UNKNOWN",
      unitPriceCents: l.customizationConfig?.unitPriceCents ?? 0,
      placements: l.productConfig?.views.flatMap((v) => v.placements) ?? [],
      logoAssetIdsByPlacementId: l.logoAssetIdsByPlacementId as Record<string, string | null> | null,
      createdAt: l.createdAt.toISOString(),
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
    shopDomain: session.shop,
    customer,
    shopifyLineItemPrices,
    currencyCode,
    orderDataError,
    linePreviewData,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
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
        select: { productionStatus: true },
      });
      if (!line) return { error: "Order line not found" };

      const currentIndex = PRODUCTION_STATUS_ORDER.indexOf(line.productionStatus);
      const newIndex = PRODUCTION_STATUS_ORDER.indexOf(newStatus as ProductionStatus);

      if (newIndex <= currentIndex) {
        return { error: "Can only advance production status forward" };
      }

      await db.orderLineCustomization.update({
        where: { id: lineId },
        data: { productionStatus: newStatus as ProductionStatus },
      });

      return { success: true };
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

    return { error: "Unknown intent" };
  } catch (error) {
    return handleError(error);
  }
};

function getDefaultTemplate(orderName: string, pendingCount: number, shopDomain: string): string {
  return `Hi,\n\nThank you for your order ${orderName}!\n\nWe noticed you chose to provide your logo later for ${pendingCount} customized item(s). Please reply to this email with your logo file (SVG, PNG, or JPG).\n\nThank you,\n${shopDomain}`;
}

function sanitizeFilename(name: string): string {
  // Keep only safe characters for Content-Disposition filename parameter
  return name.replace(/[^A-Za-z0-9._\-() ]/g, "_").trim() || "download";
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export default function OrderDetailPage() {
  const {
    shopifyOrderId,
    orderName,
    lines,
    logoAssetMap,
    placeholderLogoImageUrl,
    emailReminderTemplate,
    shopDomain,
    customer,
    shopifyLineItemPrices,
    currencyCode,
    orderDataError,
    linePreviewData,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // expandedUploader tracks which "lineId:placementId" is expanded, or "lineId:" for legacy
  const [expandedUploader, setExpandedUploader] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const [templateText, setTemplateText] = useState(emailReminderTemplate ?? "");
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);

  useEffect(() => {
    if (navigation.state === "idle") {
      setPendingLineId(null);
      setTemplateSaving(false);
      setTemplateText(emailReminderTemplate ?? "");
    }
  }, [navigation.state, emailReminderTemplate]);

  const hasPendingArtwork = lines.some((l) => l.artworkStatus === "PENDING_CUSTOMER");

  const handleCopyEmail = useCallback(() => {
    const pendingLines = lines.filter((l) => l.artworkStatus === "PENDING_CUSTOMER");
    const textToCopy = templateText.trim()
      ? templateText
      : getDefaultTemplate(orderName, pendingLines.length, shopDomain);
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, [lines, orderName, shopDomain, templateText]);

  const WORKFLOW_STEPS = [
    { key: "artwork_pending", label: "Artwork pending" },
    { key: "artwork_provided", label: "Artwork provided" },
    { key: "in_production", label: "In production" },
    { key: "quality_check", label: "Quality check" },
    { key: "shipped", label: "Shipped" },
  ];

  const formatMoney = (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currencyCode} ${amount.toFixed(2)}`;
    }
  };

  // Product subtotal: sum of unit price × qty for Insignia-customized line items
  const productSubtotal = lines.reduce((sum, line) => {
    const priceData = shopifyLineItemPrices[line.shopifyLineId];
    if (!priceData) return sum;
    return sum + parseFloat(priceData.amount) * priceData.quantity;
  }, 0);

  // Customization fee total
  const feeTotal = lines.reduce((sum, line) => sum + line.unitPriceCents / 100, 0);

  // Shopify admin URL for this order
  const numericOrderId = shopifyOrderId.replace(/\D/g, "");
  const shopifyAdminOrderUrl = `https://${shopDomain}/admin/orders/${numericOrderId}`;

  return (
    <Page
      title={`Order ${orderName}`}
      backAction={{ content: "Orders", url: "/app/orders" }}
      titleMetadata={
        hasPendingArtwork ? (
          <Badge tone="attention">Artwork pending</Badge>
        ) : (
          <Badge tone="success">Complete</Badge>
        )
      }
    >
      <Layout>
        <Layout.Section>
          {hasPendingArtwork ? (
            <Banner tone="warning" title="Artwork pending — Waiting for customer">
              <Text as="p">Customer chose to provide artwork later. Send a reminder via the customer upload link.</Text>
            </Banner>
          ) : (
            <Banner tone="success" title="Artwork provided — Ready for production">
              <Text as="p">Customer uploaded artwork. Review the file and mark as in production when ready.</Text>
            </Banner>
          )}
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Artwork reminder</Text>
              <InlineStack gap="200" blockAlign="center">
                <Button size="slim" variant="plain" onClick={handleCopyEmail}>
                  {copySuccess ? "Copied!" : "Copy email template"}
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => setShowTemplateEditor((v) => !v)}
                >
                  {showTemplateEditor ? "Hide editor" : "Edit template"}
                </Button>
              </InlineStack>
              <Collapsible open={showTemplateEditor} id="template-editor">
                <BlockStack gap="200">
                  <TextField
                    label="Email reminder template"
                    value={templateText}
                    onChange={setTemplateText}
                    multiline={6}
                    autoComplete="off"
                    helpText="Leave blank to use the default template. The text is copied as-is when you click 'Copy email template'."
                  />
                  <InlineStack gap="200">
                    <Button
                      size="slim"
                      loading={templateSaving}
                      onClick={() => {
                        setTemplateSaving(true);
                        const fd = new FormData();
                        fd.append("intent", "save-template");
                        fd.append("template", templateText);
                        submit(fd, { method: "POST" });
                      }}
                    >
                      Save template
                    </Button>
                    <Button
                      size="slim"
                      variant="plain"
                      onClick={() => {
                        const pendingLines = lines.filter((l) => l.artworkStatus === "PENDING_CUSTOMER");
                        setTemplateText(getDefaultTemplate(orderName, pendingLines.length, shopDomain));
                      }}
                    >
                      Reset to default
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        {orderDataError && (
          <Layout.Section>
            <Banner tone="info" title="Order data unavailable">
              <Text as="p">Could not load customer and pricing information from Shopify. The order details below are still accurate.</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Customer</Text>
                <Divider />
                {customer ? (
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">{customer.name}</Text>
                    {customer.email && (
                      <Text as="p" tone="subdued">{customer.email}</Text>
                    )}
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">No customer information available</Text>
                )}
                <Box paddingBlockStart="100">
                  <Button
                    url={shopifyAdminOrderUrl}
                    external
                    icon={ExternalIcon}
                    size="slim"
                    variant="plain"
                  >
                    View in Shopify
                  </Button>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Order summary</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Product subtotal</Text>
                  <Text as="p">{formatMoney(productSubtotal)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Customization fees</Text>
                  <Text as="p">{formatMoney(feeTotal)}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" fontWeight="semibold">Total</Text>
                  <Text as="p" fontWeight="semibold">{formatMoney(productSubtotal + feeTotal)}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {lines.map((line) => {
          const currentStepIndex = PRODUCTION_STATUS_ORDER.indexOf(line.productionStatus as ProductionStatus);
          return (
            <Layout.Section key={line.id}>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h3">
                        {line.productConfigName}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        Method: {line.methodName} &middot; Variant: {line.variantId.split("/").pop()}
                      </Text>
                    </BlockStack>
                    <Badge
                      tone={
                        line.configState === "PURCHASED"
                          ? "success"
                          : line.configState === "ORDERED"
                            ? "info"
                            : undefined
                      }
                    >
                      {line.configState}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  <InlineStack align="space-between">
                    <Text as="p" variant="bodySm">
                      Customization fee
                    </Text>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {formatMoney(line.unitPriceCents / 100)}
                    </Text>
                  </InlineStack>

                  {/* Visual mockup canvas */}
                  {(() => {
                    const preview = linePreviewData[line.id];
                    if (!preview) return null;

                    const logoUrlsForLine = preview.logoUrls;

                    return (
                      <Suspense fallback={<Spinner size="small" />}>
                        <OrderLinePreviewLazy
                          imageUrl={preview.imageUrl}
                          placements={line.placements.map((p) => ({ id: p.id, name: p.name }))}
                          geometry={preview.geometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number } | null>}
                          logoUrls={logoUrlsForLine}
                        />
                      </Suspense>
                    );
                  })()}

                  {line.placements.length > 0 && (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h4">
                        Placements
                      </Text>
                      {line.placements.map((p) => {
                        const logoId = line.logoAssetIdsByPlacementId?.[p.id] ?? null;
                        const asset = logoId ? logoAssetMap[logoId] : null;
                        const uploaderKey = `${line.id}:${p.id}`;
                        const isUploaderOpen = expandedUploader === uploaderKey;
                        return (
                          <BlockStack key={p.id} gap="100">
                            <InlineStack gap="300" blockAlign="center" align="space-between">
                              <InlineStack gap="300" blockAlign="center">
                                {asset ? (
                                  <Thumbnail source={asset.previewUrl || ""} alt="Logo" size="small" />
                                ) : placeholderLogoImageUrl ? (
                                  <Thumbnail source={placeholderLogoImageUrl} alt="Placeholder" size="small" />
                                ) : (
                                  <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                    <Text as="span" variant="bodySm" fontWeight="bold">LOGO</Text>
                                  </Box>
                                )}
                                <Text as="span">{p.name}</Text>
                              </InlineStack>
                              {!asset && (
                                <Button
                                  size="slim"
                                  variant="plain"
                                  onClick={() =>
                                    setExpandedUploader(isUploaderOpen ? null : uploaderKey)
                                  }
                                >
                                  {isUploaderOpen ? "Cancel" : "Attach"}
                                </Button>
                              )}
                            </InlineStack>
                            {asset ? (
                              <BlockStack gap="050">
                                {asset.originalFileName && (
                                  <Text as="p" variant="bodySm" tone="subdued">{asset.originalFileName}</Text>
                                )}
                                {typeof asset.fileSizeBytes === "number" && (
                                  <Text as="p" variant="bodySm" tone="subdued">{formatFileSize(asset.fileSizeBytes)}</Text>
                                )}
                                {asset.downloadUrl && (
                                  <Button url={asset.downloadUrl} external size="slim" variant="plain">Download</Button>
                                )}
                              </BlockStack>
                            ) : line.artworkStatus === "PENDING_CUSTOMER" ? (
                              <Text as="p" variant="bodySm" tone="subdued">Artwork not yet provided</Text>
                            ) : null}
                            <Collapsible open={isUploaderOpen} id={`artwork-${uploaderKey}`}>
                              <ArtworkUploader
                                lineId={line.id}
                                placementId={p.id}
                                submit={submit}
                                onDone={() => setExpandedUploader(null)}
                              />
                            </Collapsible>
                          </BlockStack>
                        );
                      })}
                    </BlockStack>
                  )}

                  <Divider />

                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h4">
                      Production status
                    </Text>
                    <BlockStack gap="300">
                      {WORKFLOW_STEPS.map((step, i) => {
                        const isComplete = i < currentStepIndex;
                        const isCurrent = i === currentStepIndex;
                        return (
                          <InlineStack key={step.key} gap="200" blockAlign="center">
                            <div style={{
                              width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                              background: isComplete ? "var(--p-color-bg-fill-success)" : isCurrent ? "var(--p-color-bg-fill-info)" : "var(--p-color-bg-fill-secondary)",
                              border: isCurrent ? "2px solid var(--p-color-border-info)" : "none",
                            }} />
                            <Text
                              tone={i > currentStepIndex ? "subdued" : undefined}
                              fontWeight={isCurrent ? "semibold" : "regular"}
                              as="span"
                            >
                              {step.label}
                            </Text>
                          </InlineStack>
                        );
                      })}
                    </BlockStack>
                    {line.productionStatus === ProductionStatus.ARTWORK_PROVIDED && (
                      <Button
                        tone="success"
                        variant="primary"
                        size="slim"
                        loading={navigation.state === "submitting" && pendingLineId === line.id}
                        disabled={navigation.state === "submitting" && pendingLineId !== line.id}
                        onClick={() => {
                          setPendingLineId(line.id);
                          const fd = new FormData();
                          fd.append("intent", "advance-status");
                          fd.append("lineId", line.id);
                          fd.append("newStatus", ProductionStatus.IN_PRODUCTION);
                          submit(fd, { method: "POST" });
                        }}
                      >
                        Mark in production
                      </Button>
                    )}
                    {line.productionStatus === ProductionStatus.IN_PRODUCTION && (
                      <Button
                        size="slim"
                        loading={navigation.state === "submitting" && pendingLineId === line.id}
                        disabled={navigation.state === "submitting" && pendingLineId !== line.id}
                        onClick={() => {
                          setPendingLineId(line.id);
                          const fd = new FormData();
                          fd.append("intent", "advance-status");
                          fd.append("lineId", line.id);
                          fd.append("newStatus", ProductionStatus.QUALITY_CHECK);
                          submit(fd, { method: "POST" });
                        }}
                      >
                        Mark quality check
                      </Button>
                    )}
                    {line.productionStatus === ProductionStatus.QUALITY_CHECK && (
                      <Button
                        size="slim"
                        loading={navigation.state === "submitting" && pendingLineId === line.id}
                        disabled={navigation.state === "submitting" && pendingLineId !== line.id}
                        onClick={() => {
                          setPendingLineId(line.id);
                          const fd = new FormData();
                          fd.append("intent", "advance-status");
                          fd.append("lineId", line.id);
                          fd.append("newStatus", ProductionStatus.SHIPPED);
                          submit(fd, { method: "POST" });
                        }}
                      >
                        Mark shipped
                      </Button>
                    )}
                  </BlockStack>

                </BlockStack>
              </Card>
            </Layout.Section>
          );
        })}
      </Layout>
    </Page>
  );
}

function ArtworkUploader({
  lineId,
  placementId,
  submit,
  onDone,
}: {
  lineId: string;
  placementId: string;
  submit: ReturnType<typeof useSubmit>;
  onDone?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const allowedTypes = ["image/jpeg", "image/png", "image/svg+xml"];
      if (!allowedTypes.includes(file.type)) {
        setError("Please upload a JPG, PNG, or SVG file");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        // Step 1: Get presigned upload URL + create LogoAsset
        const urlForm = new FormData();
        urlForm.append("intent", "get-upload-url");
        urlForm.append("lineId", lineId);
        urlForm.append("contentType", file.type);
        urlForm.append("fileName", file.name);

        const urlRes = await fetch("/api/admin/artwork-upload", {
          method: "POST",
          body: urlForm,
        });
        const urlData = await urlRes.json();
        if (!urlData.success) throw new Error(urlData?.error?.message ?? "Failed to get upload URL");

        // Step 2: Upload file directly to R2
        const putRes = await fetch(urlData.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error("Failed to upload file to storage");

        // Step 3: Complete the upload and bind to the specific placement
        const completeForm = new FormData();
        completeForm.append("intent", "complete-upload");
        completeForm.append("lineId", lineId);
        completeForm.append("logoAssetId", urlData.logoAssetId);
        completeForm.append("placementId", placementId);

        const completeRes = await fetch("/api/admin/artwork-upload", {
          method: "POST",
          body: completeForm,
        });
        const completeData = await completeRes.json();
        if (!completeData.success) throw new Error("Failed to finalize upload");

        setDone(true);
        onDone?.();
        // Trigger a page reload to reflect the new status
        submit(null, { method: "GET" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [lineId, placementId, submit, onDone]
  );

  if (done) {
    return (
      <Box paddingBlockStart="200">
        <Banner tone="success">Artwork uploaded successfully.</Banner>
      </Box>
    );
  }

  return (
    <Box paddingBlockStart="200">
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}
      <DropZone
        accept="image/jpeg,image/png,image/svg+xml"
        type="image"
        onDrop={handleDrop}
        disabled={uploading}
        variableHeight
      >
        <DropZone.FileUpload actionTitle="Upload artwork" actionHint="SVG, PNG, JPG" />
        {uploading && <Spinner size="small" />}
      </DropZone>
    </Box>
  );
}
