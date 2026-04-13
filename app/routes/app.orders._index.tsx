/**
 * Orders list page — shows Insignia-customized orders.
 * Canonical: docs/admin/orders-workflow.md
 */

import { useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  IndexTable,
  Badge,
  Text,
  Tabs,
  TextField,
  Select,
  InlineStack,
  Icon,
  Box,
  UnstyledLink,
  Pagination,
  Button,
  Filters,
  ChoiceList,
} from "@shopify/polaris";
import { SearchIcon, ExportIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { currencySymbol } from "../lib/services/shop-currency.server";
import { computeDateFrom } from "../lib/services/orders-utils.server";

const PAGE_SIZE = 25;

const DATE_RANGE_OPTIONS = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "This week", value: "this-week" },
  { label: "This month", value: "this-month" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "all";
  const search = url.searchParams.get("search") || "";
  const methodId = url.searchParams.get("methodId") || "";
  const dateRange = url.searchParams.get("dateRange") || "all";
  const artworkStatus = url.searchParams.get("artworkStatus") || "";
  const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });
  if (!shop) return { orders: [], currency: "$", tab: "all", methods: [], search: "", methodId: "", dateRange: "all", artworkStatus: "", page: 1, totalPages: 1, totalCount: 0 };

  const currency = currencySymbol(shop.currencyCode);

  // Load available decoration methods for this shop (for filter dropdown)
  const methods = await db.decorationMethod.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Build date filter
  const dateFrom = computeDateFrom(dateRange);

  // Normalize search: strip non-digits so "#1001", "1001", "order 1001" all match the GID
  const numericSearch = search.replace(/\D/g, "");

  // Build shared where clause for both count and findMany
  const where = {
    productConfig: { shopId: shop.id },
    ...(tab === "awaiting"
      ? { artworkStatus: "PENDING_CUSTOMER" as const }
      : artworkStatus === "PENDING_CUSTOMER" || artworkStatus === "PROVIDED"
        ? { artworkStatus: artworkStatus as "PENDING_CUSTOMER" | "PROVIDED" }
        : {}),
    ...(numericSearch
      ? {
          shopifyOrderId: {
            contains: numericSearch,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(methodId
      ? {
          customizationConfig: {
            methodId,
          },
        }
      : {}),
    ...(dateFrom
      ? {
          createdAt: { gte: dateFrom },
        }
      : {}),
  };

  // Count and paginate by distinct shopifyOrderId so one order with N line items
  // counts as 1 row in the table, not N.
  const distinctOrderIds = await db.orderLineCustomization.groupBy({
    by: ["shopifyOrderId"],
    where,
    orderBy: { shopifyOrderId: "asc" },
  });
  const totalCount = distinctOrderIds.length;

  const pagedOrderIds = distinctOrderIds
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((g) => g.shopifyOrderId);

  const orderLines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: { in: pagedOrderIds } },
    include: {
      customizationConfig: { select: { state: true, unitPriceCents: true, decorationMethod: { select: { name: true } } } },
    },
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  type OrderGroup = {
    shopifyOrderId: string;
    orderName: string;
    lineCount: number;
    pendingArtwork: number;
    latestStatus: string;
    totalCents: number;
    createdAt: string;
  };

  const groupMap = new Map<string, OrderGroup>();
  for (const line of orderLines) {
    const existing = groupMap.get(line.shopifyOrderId);
    const unitCents = line.customizationConfig?.unitPriceCents ?? 0;
    const status = line.customizationConfig?.state ?? "UNKNOWN";
    if (existing) {
      existing.lineCount++;
      existing.totalCents += unitCents;
      if (line.artworkStatus === "PENDING_CUSTOMER") existing.pendingArtwork++;
    } else {
      const idNum = line.shopifyOrderId.replace(/\D/g, "");
      groupMap.set(line.shopifyOrderId, {
        shopifyOrderId: line.shopifyOrderId,
        orderName: `#${idNum.slice(-6)}`,
        lineCount: 1,
        pendingArtwork: line.artworkStatus === "PENDING_CUSTOMER" ? 1 : 0,
        latestStatus: status,
        totalCents: unitCents,
        createdAt: line.createdAt.toISOString(),
      });
    }
  }

  return { orders: Array.from(groupMap.values()), currency, tab, methods, search, methodId, dateRange, artworkStatus, page, totalPages, totalCount };
};

const ORDER_TABS = [
  { id: "all", content: "All orders", panelID: "all-orders" },
  { id: "awaiting", content: "Awaiting Artwork", panelID: "awaiting-artwork" },
];

export default function OrdersPage() {
  const { orders, currency, tab, methods, search, methodId, dateRange, artworkStatus, page, totalPages } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();


  const selectedTabIndex = ORDER_TABS.findIndex((t) => t.id === tab);
  const activeTabIndex = selectedTabIndex === -1 ? 0 : selectedTabIndex;

  const handleTabChange = (index: number) => {
    const selected = ORDER_TABS[index];
    const next = new URLSearchParams(searchParams);
    if (selected.id === "all") {
      next.delete("tab");
    } else {
      next.set("tab", selected.id);
    }
    next.delete("page");
    setSearchParams(next);
  };

  const handleSearchChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("search", value);
    } else {
      next.delete("search");
    }
    next.delete("page");
    setSearchParams(next);
  };

  const handleMethodChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("methodId", value);
    } else {
      next.delete("methodId");
    }
    next.delete("page");
    setSearchParams(next);
  };

  const handleDateRangeChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      next.set("dateRange", value);
    } else {
      next.delete("dateRange");
    }
    next.delete("page");
    setSearchParams(next);
  };

  const handleArtworkStatusChange = useCallback((value: string[]) => {
    const next = new URLSearchParams(searchParams);
    if (value.length > 0) {
      next.set("artworkStatus", value[0]);
    } else {
      next.delete("artworkStatus");
    }
    next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handleRemoveArtworkStatusFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("artworkStatus");
    next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handleClearAllFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("artworkStatus");
    next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handlePreviousPage = () => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page - 1));
    setSearchParams(next);
  };

  const handleNextPage = () => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page + 1));
    setSearchParams(next);
  };

  const methodOptions = [
    { label: "All methods", value: "" },
    ...methods.map((m) => ({ label: m.name, value: m.id })),
  ];

  const handleExportCSV = async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (methodId) params.set("methodId", methodId);
    if (dateRange && dateRange !== "all") params.set("dateRange", dateRange);
    if (activeTabIndex === 1) params.set("tab", "awaiting-artwork");
    const response = await fetch(`/api/admin/orders/export?${params.toString()}`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "orders.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title="Orders"
      secondaryActions={
        <Button icon={ExportIcon} onClick={handleExportCSV}>
          Export CSV
        </Button>
      }
    >
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack gap="300" wrap={false} align="start" blockAlign="center">
              <Box width="100%">
                <TextField
                  label="Search orders"
                  labelHidden
                  placeholder="Search orders..."
                  value={search}
                  onChange={handleSearchChange}
                  prefix={<Icon source={SearchIcon} />}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                />
              </Box>
              <Box minWidth="180px">
                <Select
                  label="Decoration method"
                  labelHidden
                  options={methodOptions}
                  value={methodId}
                  onChange={handleMethodChange}
                />
              </Box>
              <Box minWidth="140px">
                <Select
                  label="Date range"
                  labelHidden
                  options={DATE_RANGE_OPTIONS}
                  value={dateRange}
                  onChange={handleDateRangeChange}
                />
              </Box>
            </InlineStack>
            <Filters
              queryValue=""
              queryPlaceholder=""
              onQueryChange={() => {}}
              onQueryClear={() => {}}
              hideQueryField
              filters={[
                {
                  key: "artworkStatus",
                  label: "Artwork status",
                  filter: (
                    <ChoiceList
                      title="Artwork status"
                      titleHidden
                      choices={[
                        { label: "Provided", value: "PROVIDED" },
                        { label: "Pending customer", value: "PENDING_CUSTOMER" },
                      ]}
                      selected={artworkStatus ? [artworkStatus] : []}
                      onChange={handleArtworkStatusChange}
                    />
                  ),
                  shortcut: true,
                },
              ]}
              appliedFilters={
                artworkStatus
                  ? [
                      {
                        key: "artworkStatus",
                        label: artworkStatus === "PROVIDED" ? "Artwork: Provided" : "Artwork: Pending customer",
                        onRemove: handleRemoveArtworkStatusFilter,
                      },
                    ]
                  : []
              }
              onClearAll={handleClearAllFilters}
            />
          </Card>
          <Card padding="0">
            <Tabs
              tabs={ORDER_TABS}
              selected={activeTabIndex}
              onSelect={handleTabChange}
            />
          </Card>
          {orders.length === 0 ? (
            <Card>
              <EmptyState
                heading={tab === "awaiting" ? "No orders awaiting artwork" : "No customized orders yet"}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {tab === "awaiting"
                    ? "Orders where customers chose to provide artwork later will appear here."
                    : "Orders with Insignia customizations will appear here after customers complete purchases."}
                </p>
              </EmptyState>
            </Card>
          ) : (
            <>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "order", plural: "orders" }}
                itemCount={orders.length}
                headings={[
                  { title: "Order" },
                  { title: "Customized lines" },
                  { title: "Artwork" },
                  { title: "Status" },
                  { title: "Fee total", alignment: "end" },
                  { title: "Date", alignment: "end" },
                ]}
                selectable={false}
                hasZebraStriping
              >
                {orders.map((order, idx) => {
                  const encodedId = encodeURIComponent(order.shopifyOrderId);
                  return (
                    <IndexTable.Row
                      key={order.shopifyOrderId}
                      id={order.shopifyOrderId}
                      position={idx}
                      onNavigation={() => navigate(`/app/orders/${encodedId}`)}
                    >
                      <IndexTable.Cell>
                        <UnstyledLink url={`/app/orders/${encodedId}`}>
                          <Text variant="bodyMd" fontWeight="bold" as="span">
                            {order.orderName}
                          </Text>
                        </UnstyledLink>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{order.lineCount}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {order.pendingArtwork > 0 ? (
                          <Badge tone="attention">
                            {`${order.pendingArtwork} pending`}
                          </Badge>
                        ) : (
                          <Badge tone="success">All provided</Badge>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge
                          tone={
                            order.latestStatus === "PURCHASED"
                              ? "success"
                              : order.latestStatus === "ORDERED"
                                ? "info"
                                : undefined
                          }
                        >
                          {order.latestStatus}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" alignment="end" numeric>
                          {currency}{(order.totalCents / 100).toFixed(2)}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm" tone="subdued" as="span" alignment="end" numeric>
                          {new Date(order.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </Card>
            {totalPages > 1 && (
              <Box paddingBlock="400">
                <InlineStack align="center" gap="400" blockAlign="center">
                  <Pagination
                    hasPrevious={page > 1}
                    hasNext={page < totalPages}
                    onPrevious={handlePreviousPage}
                    onNext={handleNextPage}
                  />
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`Page ${page} of ${totalPages}`}
                  </Text>
                </InlineStack>
              </Box>
            )}
            </>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
