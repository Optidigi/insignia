/**
 * Insignia Dashboard (Home)
 *
 * Context-aware home page:
 * - New merchants: warm welcome + guided setup
 * - In-progress merchants: setup guide + config overview
 * - Active merchants: overview with status, attention items, recent configs
 */

import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData, useSubmit } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  DataTable,
  Button,
  Box,
  Divider,
  Badge,
  Icon,
  Collapsible,
  ProgressBar,
  Banner,
  ResourceList,
  ResourceItem,
  FooterHelp,
  EmptyState,
  Tabs,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, OrderIcon } from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fixExistingFeeProducts } from "../lib/services/fix-fee-products.server";
import { syncShopCurrency } from "../lib/services/shop-currency.server";
import { getMerchantSettings } from "../lib/services/settings.server";
import { useState, useCallback } from "react";

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return { success: false };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "dismiss-setup-guide") {
    await db.merchantSettings.upsert({
      where: { shopId: shop.id },
      update: { setupGuideDismissedAt: new Date() },
      create: { shopId: shop.id, setupGuideDismissedAt: new Date() },
    });
    return { success: true };
  }

  return { success: false };
};

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const themeEditorUrl =
    apiKey && session.shop
      ? `https://${session.shop}/admin/themes/current/editor?template=product`
      : null;

  if (!shop) {
    return {
      configsCount: 0,
      methodsCount: 0,
      ordersCount: 0,
      pendingArtworkCount: 0,
      hasViews: false,
      hasImages: false,
      hasPlacements: false,
      recentConfigs: [] as Array<{
        id: string;
        name: string;
        viewCount: number;
        placementCount: number;
        methodCount: number;
        productCount: number;
      }>,
      needsAttention: [] as Array<{
        id: string;
        shopifyOrderId: string;
        createdAt: string;
        productConfig: { name: string };
        waitingDays: number;
      }>,
      themeEditorUrl,
      setupSteps: {
        methodCreated: false,
        productCreated: false,
        imagesUploaded: false,
        themeBlockAdded: false,
      },
      completedCount: 0,
      isFirstTime: true,
      setupGuideDismissed: false,
      activityEvents: [] as Array<{
        id: string;
        type: "order" | "artwork" | "method" | "setup";
        description: string;
        timestamp: string;
      }>,
      shopDomain: session.shop,
      analytics: {
        totalOrders: 0,
        pendingArtwork: 0,
        activeConfigs: 0,
        methodBreakdown: [] as Array<{ name: string; orderCount: number }>,
      },
    };
  }

  const [
    configsCount,
    methodsCount,
    ordersCount,
    pendingArtworkCount,
    viewsCount,
    placementsCount,
    imageCount,
    settings,
    methodBreakdown,
  ] = await Promise.all([
    db.productConfig.count({ where: { shopId: shop.id } }),
    db.decorationMethod.count({ where: { shopId: shop.id } }),
    db.orderLineCustomization.count({
      where: { productConfig: { shopId: shop.id } },
    }),
    db.orderLineCustomization.count({
      where: {
        productConfig: { shopId: shop.id },
        artworkStatus: "PENDING_CUSTOMER",
      },
    }),
    db.productView.count({
      where: { productConfig: { shopId: shop.id } },
    }),
    db.placementDefinition.count({
      where: { productConfig: { shopId: shop.id } },
    }),
    db.variantViewConfiguration.count({
      where: {
        productConfig: { shopId: shop.id },
        imageUrl: { not: null },
      },
    }),
    getMerchantSettings(shop.id),
    // Analytics: count actual OrderLineCustomization records per decoration method
    db.$queryRaw<Array<{ name: string; orderCount: number }>>`
      SELECT dm.name, COALESCE(COUNT(DISTINCT olc.id), 0)::int AS "orderCount"
      FROM "DecorationMethod" dm
      LEFT JOIN "CustomizationConfig" cc ON cc."methodId" = dm.id
      LEFT JOIN "OrderLineCustomization" olc ON olc."customizationConfigId" = cc.id
      WHERE dm."shopId" = ${shop.id}
      GROUP BY dm.id, dm.name
      ORDER BY "orderCount" DESC
    `,
  ]);

  const setupSteps = {
    methodCreated: methodsCount > 0,
    productCreated: configsCount > 0,
    imagesUploaded: imageCount > 0,
    themeBlockAdded: !!settings?.setupGuideDismissedAt,
  };

  const completedCount = Object.values(setupSteps).filter(Boolean).length;
  const isFirstTime = !setupSteps.methodCreated && !setupSteps.productCreated;
  const setupGuideDismissed = !!settings?.setupGuideDismissedAt;

  // Load pending orders needing attention (waiting for customer artwork)
  const pendingOrders = await db.orderLineCustomization.findMany({
    where: {
      productConfig: { shopId: shop.id },
      artworkStatus: "PENDING_CUSTOMER",
    },
    select: {
      id: true,
      shopifyOrderId: true,
      createdAt: true,
      productConfig: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  const needsAttention = pendingOrders.map((o) => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    waitingDays: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  // Load recent configs with counts for the overview section
  const recentConfigs = await db.productConfig.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      name: true,
      linkedProductIds: true,
      views: { select: { id: true } },
      placements: { select: { id: true } },
      allowedMethods: { select: { decorationMethodId: true } },
    },
  });

  const recentConfigsMapped = recentConfigs.map((c) => ({
    id: c.id,
    name: c.name,
    viewCount: c.views.length,
    placementCount: c.placements.length,
    methodCount: c.allowedMethods.length,
    productCount: c.linkedProductIds.length,
  }));

  // --- Activity feed (last 20 events across all event types) ---
  const [recentOrders, recentArtworkUploads, recentMethods, recentSetups] = await Promise.all([
    // Orders received (via WebhookEvent for orders/create)
    db.webhookEvent.findMany({
      where: { shopId: shop.id, topic: "orders/create" },
      orderBy: { receivedAt: "desc" },
      take: 10,
      select: { id: true, receivedAt: true },
    }),
    // Artwork uploaded (artworkStatus changed to PROVIDED)
    db.orderLineCustomization.findMany({
      where: { productConfig: { shopId: shop.id }, artworkStatus: "PROVIDED" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, updatedAt: true, shopifyOrderId: true },
    }),
    // Methods created
    db.decorationMethod.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, createdAt: true },
    }),
    // Product setups created
    db.productConfig.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  // Merge and sort by timestamp desc, take top 20
  type ActivityEventRaw = {
    id: string;
    type: "order" | "artwork" | "method" | "setup";
    description: string;
    timestamp: Date;
  };

  const rawEvents: ActivityEventRaw[] = [
    ...recentOrders.map((e) => ({
      id: e.id,
      type: "order" as const,
      description: "Order received",
      timestamp: e.receivedAt,
    })),
    ...recentArtworkUploads.map((e) => ({
      id: e.id,
      type: "artwork" as const,
      description: "Artwork uploaded",
      timestamp: e.updatedAt,
    })),
    ...recentMethods.map((e) => ({
      id: e.id,
      type: "method" as const,
      description: `Method created — ${e.name}`,
      timestamp: e.createdAt,
    })),
    ...recentSetups.map((e) => ({
      id: e.id,
      type: "setup" as const,
      description: `Product setup created — ${e.name}`,
      timestamp: e.createdAt,
    })),
  ];

  const activityEvents = rawEvents
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 20)
    .map((e) => ({ ...e, timestamp: e.timestamp.toISOString() }));

  // Background maintenance tasks (fire-and-forget)
  fixExistingFeeProducts(shop.id, admin.graphql).catch((e) =>
    console.error("[dashboard] fixExistingFeeProducts error:", e)
  );
  syncShopCurrency(shop.id, admin.graphql).catch((e) =>
    console.error("[dashboard] syncShopCurrency error:", e)
  );

  return {
    configsCount,
    methodsCount,
    ordersCount,
    pendingArtworkCount,
    hasViews: viewsCount > 0,
    hasImages: imageCount > 0,
    hasPlacements: placementsCount > 0,
    recentConfigs: recentConfigsMapped,
    needsAttention,
    themeEditorUrl,
    setupSteps,
    completedCount,
    isFirstTime,
    setupGuideDismissed,
    activityEvents,
    shopDomain: session.shop,
    analytics: {
      totalOrders: ordersCount,
      pendingArtwork: pendingArtworkCount,
      activeConfigs: configsCount,
      methodBreakdown: methodBreakdown.map((m) => ({
        name: m.name,
        orderCount: Number(m.orderCount),
      })),
    },
  };
};

// ============================================================================
// Local components
// ============================================================================

function SetupStepRow({
  stepNum,
  title,
  description,
  completed,
  active,
  actionLabel,
  actionUrl,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  stepNum: number;
  title: string;
  description: string;
  completed: boolean;
  active: boolean;
  actionLabel: string;
  actionUrl: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <InlineStack align="space-between" blockAlign="start" wrap={false} gap="400">
      <InlineStack gap="300" blockAlign="start">
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: completed
              ? "var(--p-color-bg-fill-success)"
              : active
                ? "var(--p-color-bg-fill-brand)"
                : "var(--p-color-bg-fill-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color:
              completed || active ? "white" : "var(--p-color-text-subdued)",
            fontSize: 12,
            fontWeight: "bold",
            flexShrink: 0,
          }}
        >
          {completed ? "✓" : stepNum}
        </div>
        <BlockStack gap="100">
          <Text
            variant="bodyMd"
            fontWeight={active ? "semibold" : "regular"}
            as="span"
          >
            {title}
          </Text>
          <Text variant="bodySm" tone="subdued" as="span">
            {description}
          </Text>
        </BlockStack>
      </InlineStack>
      {!completed && active && (
        <InlineStack gap="200">
          <Button url={actionUrl} size="slim">
            {actionLabel}
          </Button>
          {secondaryActionLabel && onSecondaryAction && (
            <Button size="slim" variant="primary" tone="success" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </InlineStack>
      )}
    </InlineStack>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return minutes < 1 ? "Just now" : minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

// ============================================================================
// Dashboard component
// ============================================================================

type LegacySetupStep = {
  label: string;
  description: string;
  done: boolean;
  action?: { label: string; url: string };
};

export default function Dashboard() {
  const {
    configsCount,
    methodsCount,
    ordersCount,
    pendingArtworkCount,
    hasViews,
    hasImages,
    hasPlacements,
    recentConfigs,
    needsAttention,
    themeEditorUrl,
    setupSteps,
    completedCount,
    isFirstTime,
    setupGuideDismissed,
    activityEvents,
    shopDomain,
    analytics,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();

  async function handleExport() {
    setIsExporting(true);
    try {
      const response = await fetch("/app/orders/export");
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `insignia-orders-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      window.shopify?.toast?.show(
        err instanceof Error ? err.message : "Export failed. Please try again.",
        { isError: true }
      );
    } finally {
      setIsExporting(false);
    }
  }

  const hasMethods = methodsCount > 0;
  const hasConfigs = configsCount > 0;

  const legacySteps: LegacySetupStep[] = [
    {
      label: "Create a decoration method",
      description:
        "Define how logos are applied to your products — for example, embroidery, screen print, or DTG.",
      done: hasMethods,
      action: { label: "Create your first method", url: "/app/methods" },
    },
    {
      label: "Set up a product",
      description:
        "Pick which Shopify products customers can customize, and link them to your decoration methods.",
      done: hasConfigs,
      action: { label: "Create a product setup", url: "/app/products" },
    },
    {
      label: "Upload product images",
      description:
        "Add views (Front, Back, etc.) and upload a product photo for each variant. These are shown during customization.",
      done: hasViews && hasImages,
      action: hasConfigs
        ? { label: "Go to products", url: "/app/products" }
        : undefined,
    },
    {
      label: "Define print areas and pricing",
      description:
        "Set where logos can be placed and configure pricing. Customers choose from these during checkout.",
      done: hasPlacements,
      action: hasConfigs
        ? { label: "Go to products", url: "/app/products" }
        : undefined,
    },
  ];

  const completedLegacySteps = legacySteps.filter((s) => s.done).length;
  const allDone = completedLegacySteps === legacySteps.length;
  const progressPercent = (completedLegacySteps / legacySteps.length) * 100;

  const [expandedStep, setExpandedStep] = useState<number | null>(
    legacySteps.findIndex((s) => !s.done)
  );
  const [themeCardDismissed, setThemeCardDismissed] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const toggleStep = useCallback(
    (index: number) => {
      setExpandedStep(expandedStep === index ? null : index);
    },
    [expandedStep]
  );

  const showNewSetupGuide = !setupGuideDismissed && completedCount < 4;
  const showLegacySetupGuide = !showNewSetupGuide && !allDone;
  const isFullySetup =
    hasMethods && hasConfigs && hasViews && hasImages && hasPlacements;

  return (
    <Page
      title="Insignia"
      subtitle="Product customization for your store"
      primaryAction={
        hasConfigs
          ? { content: "Add product setup", url: "/app/products" }
          : undefined
      }
      secondaryActions={[
        {
          content: "Export orders",
          loading: isExporting,
          onAction: handleExport,
        },
        {
          content: "Preview store",
          onAction: () => setTimeout(() => window.open(`https://${shopDomain}`, "_blank"), 0),
        },
      ]}
    >
      <Layout>
        {/* ===================== TOP: ATTENTION ITEMS ===================== */}

        {/* Pending artwork — most urgent, always on top */}
        {pendingArtworkCount > 0 && (
          <Layout.Section>
            <Banner
              title={`${pendingArtworkCount} order${pendingArtworkCount === 1 ? "" : "s"} waiting for customer artwork`}
              tone="warning"
              action={{ content: "Review orders", url: "/app/orders" }}
            >
              <Text as="p" variant="bodySm">
                Customers chose &quot;provide artwork later&quot; during checkout. You can
                contact them or upload artwork on their behalf.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ===================== WELCOME / SETUP ===================== */}

        {isFirstTime && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingLg" as="h2">
                  Welcome to Insignia
                </Text>
                <Text as="p">
                  Let customers customize your products with their own logos —
                  embroidery, screen print, DTG, and more. Follow the steps
                  below to get your first product ready for customization.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ===================== NEW SERVER-BACKED SETUP GUIDE ===================== */}

        {showNewSetupGuide && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Setup guide
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodySm" tone="subdued" as="span">
                      {completedCount} of 4 complete
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("intent", "dismiss-setup-guide");
                        submit(fd, { method: "POST" });
                      }}
                    >
                      Dismiss
                    </Button>
                  </InlineStack>
                </InlineStack>

                <ProgressBar
                  progress={(completedCount / 4) * 100}
                  size="small"
                />

                <BlockStack gap="300">
                  <SetupStepRow
                    stepNum={1}
                    title="Create your first decoration method"
                    description="Define how logos are applied (embroidery, screen print, etc.)."
                    completed={setupSteps.methodCreated}
                    active={!setupSteps.methodCreated}
                    actionLabel="Add method"
                    actionUrl="/app/methods"
                  />
                  <Divider />
                  <SetupStepRow
                    stepNum={2}
                    title="Set up a product"
                    description="Configure print areas and link Shopify products."
                    completed={setupSteps.productCreated}
                    active={
                      setupSteps.methodCreated && !setupSteps.productCreated
                    }
                    actionLabel="Add product setup"
                    actionUrl="/app/products"
                  />
                  <Divider />
                  <SetupStepRow
                    stepNum={3}
                    title="Upload product images"
                    description="Add photos of your product for each view and color."
                    completed={setupSteps.imagesUploaded}
                    active={
                      setupSteps.productCreated && !setupSteps.imagesUploaded
                    }
                    actionLabel="Manage images"
                    actionUrl="/app/products"
                  />
                  <Divider />
                  <SetupStepRow
                    stepNum={4}
                    title="Add the Customize button to your theme"
                    description="Let customers start customizing directly from product pages."
                    completed={setupSteps.themeBlockAdded}
                    active={
                      setupSteps.imagesUploaded && !setupSteps.themeBlockAdded
                    }
                    actionLabel="Go to Settings"
                    actionUrl="/app/settings"
                    secondaryActionLabel="I've added it"
                    onSecondaryAction={() => {
                      const formData = new FormData();
                      formData.append("intent", "dismiss-setup-guide");
                      submit(formData, { method: "POST" });
                    }}
                  />
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ===================== LEGACY COLLAPSIBLE SETUP GUIDE ===================== */}

        {showLegacySetupGuide && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      Setup guide
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {completedLegacySteps} of {legacySteps.length} steps
                      completed
                    </Text>
                  </BlockStack>
                </InlineStack>
                <ProgressBar
                  progress={progressPercent}
                  tone="primary"
                  size="small"
                />
                <BlockStack gap="0">
                  {legacySteps.map((step, i) => (
                    <div key={i}>
                      {i > 0 && <Divider />}
                      <Box paddingBlock="300">
                        <InlineStack
                          gap="300"
                          blockAlign="start"
                          wrap={false}
                        >
                          <Box minWidth="20px" paddingBlockStart="050">
                            <Icon
                              source={
                                step.done ? CheckCircleIcon : AlertCircleIcon
                              }
                              tone={step.done ? "success" : "subdued"}
                            />
                          </Box>
                          <Box width="100%">
                            <BlockStack gap="0">
                              <button
                                onClick={() => toggleStep(i)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  width: "100%",
                                  textAlign: "left",
                                }}
                              >
                                <Text
                                  as="span"
                                  variant="bodyMd"
                                  fontWeight={
                                    expandedStep === i && !step.done
                                      ? "semibold"
                                      : "regular"
                                  }
                                  tone={step.done ? "subdued" : undefined}
                                >
                                  {step.done ? (
                                    <s>{step.label}</s>
                                  ) : (
                                    step.label
                                  )}
                                </Text>
                              </button>
                              <Collapsible
                                open={expandedStep === i}
                                id={`step-${i}`}
                              >
                                <Box
                                  paddingBlockStart="200"
                                  paddingBlockEnd="100"
                                >
                                  <BlockStack gap="300">
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      tone="subdued"
                                    >
                                      {step.description}
                                    </Text>
                                    {step.action && !step.done && (
                                      <div>
                                        <Button
                                          variant="primary"
                                          size="slim"
                                          url={step.action.url}
                                        >
                                          {step.action.label}
                                        </Button>
                                      </div>
                                    )}
                                  </BlockStack>
                                </Box>
                              </Collapsible>
                            </BlockStack>
                          </Box>
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ===================== MAIN CONTENT ===================== */}

        {/* Two-column layout for set-up merchants */}
        {(hasConfigs || hasMethods) && (
          <>
            {/* Metrics row */}
            <Layout.Section>
              <InlineGrid
                columns={{ xs: 1, sm: 2, md: isFullySetup ? 4 : 2 }}
                gap="400"
              >
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued" as="p">
                      Products
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingLg" as="p">
                        {configsCount}
                      </Text>
                      {configsCount > 0 && (
                        <Badge tone="success">Active</Badge>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued" as="p">
                      Decoration methods
                    </Text>
                    <Text variant="headingLg" as="p">
                      {methodsCount}
                    </Text>
                  </BlockStack>
                </Card>
                {isFullySetup && (
                  <>
                    <Card>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">
                          Customized orders
                        </Text>
                        <Text variant="headingLg" as="p">
                          {ordersCount}
                        </Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued" as="p">
                          Pending artwork
                        </Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="headingLg" as="p">
                            {pendingArtworkCount}
                          </Text>
                          {pendingArtworkCount > 0 && (
                            <Badge tone="attention">Action needed</Badge>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </>
                )}
              </InlineGrid>
            </Layout.Section>

            {/* Configurations overview + sidebar */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      Your products
                    </Text>
                    <Button variant="plain" url="/app/products">
                      View all
                    </Button>
                  </InlineStack>
                  {recentConfigs.length > 0 ? (
                    <ResourceList
                      resourceName={{
                        singular: "product setup",
                        plural: "product setups",
                      }}
                      items={recentConfigs}
                      renderItem={(config) => {
                        const isComplete =
                          config.viewCount > 0 &&
                          config.placementCount > 0 &&
                          config.methodCount > 0;

                        return (
                          <ResourceItem
                            id={config.id}
                            url={`/app/products/${config.id}`}
                            accessibilityLabel={`Open ${config.name}`}
                          >
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              wrap={false}
                            >
                              <BlockStack gap="100">
                                <Text
                                  variant="bodyMd"
                                  fontWeight="bold"
                                  as="h3"
                                >
                                  {config.name}
                                </Text>
                                <Text
                                  variant="bodySm"
                                  tone="subdued"
                                  as="span"
                                >
                                  {config.productCount}{" "}
                                  {config.productCount === 1
                                    ? "product"
                                    : "products"}{" "}
                                  · {config.viewCount}{" "}
                                  {config.viewCount === 1 ? "view" : "views"}{" "}
                                  · {config.placementCount} print{" "}
                                  {config.placementCount === 1
                                    ? "area"
                                    : "areas"}
                                </Text>
                              </BlockStack>
                              <Badge
                                tone={isComplete ? "success" : "attention"}
                              >
                                {isComplete ? "Ready" : "Incomplete"}
                              </Badge>
                            </InlineStack>
                          </ResourceItem>
                        );
                      }}
                    />
                  ) : (
                    <Box padding="400">
                      <BlockStack gap="200" inlineAlign="center">
                        <Text as="p" tone="subdued" alignment="center">
                          No products set up yet. Create one to start offering
                          product customization.
                        </Text>
                        <div>
                          <Button variant="primary" url="/app/products">
                            Create your first product setup
                          </Button>
                        </div>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Needs attention — orders waiting for customer artwork with wait times */}
            {needsAttention.length > 0 && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Needs attention</Text>
                    {needsAttention.map((o) => (
                      <Link
                        key={o.id}
                        to={`/app/orders/${o.shopifyOrderId.split("/").pop()}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <InlineStack align="space-between">
                          <Text as="span">{o.productConfig.name}</Text>
                          <Badge tone={o.waitingDays > 3 ? "critical" : "warning"}>
                            {o.waitingDays === 0 ? "Today" : `${o.waitingDays}d waiting`}
                          </Badge>
                        </InlineStack>
                      </Link>
                    ))}
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            {/* Activity / Analytics tabs */}
            <Layout.Section>
              <Card padding="0">
                <Tabs
                  tabs={[
                    { id: "activity", content: "Activity" },
                    { id: "analytics", content: "Analytics" },
                  ]}
                  selected={selectedTab}
                  onSelect={setSelectedTab}
                >
                  <Box padding="400">
                    {selectedTab === 0 && (
                      activityEvents.length > 0 ? (
                        <BlockStack gap="300">
                          {activityEvents.map((event) => (
                            <div
                              key={`${event.type}-${event.id}`}
                              style={{ display: "flex", gap: 12, alignItems: "center" }}
                            >
                              <div style={{ flexShrink: 0, width: 20, height: 20 }}>
                                <Icon
                                  source={
                                    event.type === "order" ? OrderIcon : CheckCircleIcon
                                  }
                                  tone={
                                    event.type === "order" ? "info" :
                                    event.type === "artwork" ? "success" :
                                    "base"
                                  }
                                />
                              </div>
                              <BlockStack gap="0">
                                <Text as="p" variant="bodySm">{event.description}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">{relativeTime(String(event.timestamp))}</Text>
                              </BlockStack>
                            </div>
                          ))}
                        </BlockStack>
                      ) : (
                        <EmptyState heading="No activity yet" image="">
                          <Text as="p">Orders, artwork uploads, and new setups will appear here.</Text>
                        </EmptyState>
                      )
                    )}
                    {selectedTab === 1 && (
                      <BlockStack gap="600">
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                          <Card>
                            <BlockStack gap="100">
                              <Text variant="headingXl" as="p">
                                {analytics.totalOrders}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodySm">
                                Orders customized
                              </Text>
                            </BlockStack>
                          </Card>
                          <Card>
                            <BlockStack gap="100">
                              <Text variant="headingXl" as="p">
                                {analytics.pendingArtwork}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodySm">
                                Artwork pending
                              </Text>
                            </BlockStack>
                          </Card>
                          <Card>
                            <BlockStack gap="100">
                              <Text variant="headingMd" as="p">
                                {analytics.methodBreakdown.length > 0
                                  ? analytics.methodBreakdown[0].name
                                  : "—"}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodySm">
                                Top method
                              </Text>
                            </BlockStack>
                          </Card>
                          <Card>
                            <BlockStack gap="100">
                              <Text variant="headingXl" as="p">
                                {analytics.activeConfigs}
                              </Text>
                              <Text tone="subdued" as="p" variant="bodySm">
                                Active products
                              </Text>
                            </BlockStack>
                          </Card>
                        </InlineGrid>

                        {analytics.methodBreakdown.length > 0 ? (
                          <DataTable
                            columnContentTypes={["text", "numeric"]}
                            headings={["Method", "Orders"]}
                            rows={analytics.methodBreakdown.map((m) => [
                              m.name,
                              m.orderCount,
                            ])}
                          />
                        ) : (
                          <Text tone="subdued" as="p">
                            No order data yet — stats will appear once customers start customizing.
                          </Text>
                        )}
                      </BlockStack>
                    )}
                  </Box>
                </Tabs>
              </Card>
            </Layout.Section>

            {/* Theme editor reminder */}
            {isFullySetup && !themeCardDismissed && !setupGuideDismissed && (
              <Layout.Section>
                <Banner
                  title="Add the Customize button to your theme"
                  tone="info"
                  action={
                    themeEditorUrl
                      ? {
                          content: "Open theme editor",
                          onAction: () => setTimeout(() => window.open(themeEditorUrl, "_blank"), 0),
                        }
                      : {
                          content: "Go to products",
                          url: "/app/products",
                        }
                  }
                  onDismiss={() => {
                    setThemeCardDismissed(true);
                    const formData = new FormData();
                    formData.append("intent", "dismiss-setup-guide");
                    submit(formData, { method: "POST" });
                  }}
                >
                  <Text as="p" variant="bodySm">
                    Click to open the theme editor with the Insignia Customize
                    block ready to add to your product page.
                  </Text>
                </Banner>
              </Layout.Section>
            )}
          </>
        )}
      </Layout>
      <Box paddingBlockStart="600">
        <FooterHelp>
          Need help setting up?{" "}
          <Link to="/app/settings">Visit settings</Link> or contact support.
        </FooterHelp>
      </Box>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
