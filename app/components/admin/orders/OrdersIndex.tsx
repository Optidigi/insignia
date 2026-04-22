/**
 * OrdersIndex — Polaris Web Component render layer for the Orders list page.
 *
 * Reads data from the existing loader in app/routes/app.orders._index.tsx.
 * Does NOT import from @shopify/polaris — uses <s-*> WC elements exclusively.
 *
 * Selection state: useState<Set<string>> (replaces useIndexResourceState).
 * Toasts: useToast() from app-bridge.ts (no window.shopify calls).
 * Labels: terminology.ts for ALL status labels and badge tones.
 */

import { useCallback, useEffect, useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useFetcher,
} from "react-router";
import type { loader } from "../../../routes/app.orders._index";
import { useToast } from "../../../lib/admin/app-bridge";
import {
  productionStatusLabel,
  productionStatusTone,
  indexArtworkBadge,
} from "../../../lib/admin/terminology";
import type { ProductionStatus } from "@prisma/client";
import { OrdersEmptyState } from "./OrdersEmptyState";

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Currency formatting — loader returns the symbol string (e.g. "$"), not ISO code.
// We use it directly to format the fee total.
// ---------------------------------------------------------------------------

function formatMoney(cents: number, currencySymbol: string): string {
  return `${currencySymbol}${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Derive whether any filters are active (to choose empty-state variant)
// ---------------------------------------------------------------------------

function hasActiveFilters(
  search: string,
  methodId: string,
  dateRange: string,
  artworkStatus: string,
  tab: string,
): boolean {
  return (
    search !== "" ||
    methodId !== "" ||
    (dateRange !== "" && dateRange !== "all") ||
    artworkStatus !== "" ||
    tab !== "all"
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrdersIndex() {
  const {
    orders,
    currency,
    tab,
    methods,
    search,
    methodId,
    dateRange,
    artworkStatus,
    page,
    totalPages,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{
    advanced?: number;
    skipped?: number;
    error?: string;
  }>();
  const showToast = useToast();

  // ---- Selection state (replaces useIndexResourceState) ------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---- Export in-flight lock (Finding 6.1) --------------------------------
  const [isExporting, setIsExporting] = useState(false);

  // Reset selection when orders change (tab switch, filter, page nav)
  const orderKey = orders.map((o: { shopifyOrderId: string }) => o.shopifyOrderId).join(",");
  useEffect(() => {
    setSelected(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  const toggleRow = useCallback((id: string, isChecked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isChecked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const allChecked = orders.length > 0 && selected.size === orders.length;
  const someChecked = selected.size > 0 && !allChecked;

  const toggleAll = useCallback(
    (isChecked: boolean) => {
      if (isChecked) {
        setSelected(new Set(orders.map((o: { shopifyOrderId: string }) => o.shopifyOrderId)));
      } else {
        setSelected(new Set());
      }
    },
    [orders],
  );

  // ---- Tab helpers --------------------------------------------------------
  const ORDER_TABS = [
    { id: "all", label: "All orders" },
    { id: "awaiting", label: "Awaiting Artwork" },
  ];
  const activeTabId = tab === "awaiting" ? "awaiting" : "all";

  // ---- Handlers -----------------------------------------------------------

  const handleTabChange = useCallback(
    (tabId: string) => {
      const next = new URLSearchParams(searchParams);
      if (tabId === "all") {
        next.delete("tab");
        next.delete("artworkStatus");
      } else {
        next.set("tab", tabId);
        next.delete("artworkStatus");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleSearchInput = useCallback(
    (e: Event) => {
      const target = e.currentTarget as HTMLInputElement;
      const value = target.value ?? "";
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set("search", value);
      } else {
        next.delete("search");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleMethodChange = useCallback(
    (e: Event) => {
      const target = e.currentTarget as HTMLSelectElement;
      const value = target.value ?? "";
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set("methodId", value);
      } else {
        next.delete("methodId");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleDateRangeChange = useCallback(
    (e: Event) => {
      const target = e.currentTarget as HTMLSelectElement;
      const value = target.value ?? "";
      const next = new URLSearchParams(searchParams);
      if (value && value !== "all") {
        next.set("dateRange", value);
      } else {
        next.delete("dateRange");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleArtworkStatusChange = useCallback(
    (e: Event) => {
      const target = e.currentTarget as HTMLSelectElement;
      const value = target.value ?? "";
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set("artworkStatus", value);
      } else {
        next.delete("artworkStatus");
      }
      next.delete("page");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleClearAllFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("artworkStatus");
    next.delete("search");
    next.delete("methodId");
    next.delete("dateRange");
    next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handlePreviousPage = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page - 1));
    setSearchParams(next);
  }, [page, searchParams, setSearchParams]);

  const handleNextPage = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page + 1));
    setSearchParams(next);
  }, [page, searchParams, setSearchParams]);

  // ---- Bulk action --------------------------------------------------------

  const handleBulkMarkInProduction = useCallback(() => {
    const formData = new FormData();
    selected.forEach((id) => formData.append("orderId", id));
    formData.append("newStatus", "IN_PRODUCTION");
    fetcher.submit(formData, {
      method: "POST",
      action: "/app/orders/bulk-advance",
    });
  }, [selected, fetcher]);

  // ---- Toast on action result -------------------------------------------
  // Matches existing route exactly: toast on advanced count; error toast on failure.
  useEffect(() => {
    if (!fetcher.data) return;
    if (
      "advanced" in fetcher.data &&
      fetcher.data.advanced !== undefined
    ) {
      showToast(`${fetcher.data.advanced} lines marked as In Production`);
      setSelected(new Set());
    } else if ("error" in fetcher.data && fetcher.data.error) {
      showToast(fetcher.data.error, { isError: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // ---- Export CSV --------------------------------------------------------
  // Mirrors handleExportCSV from the existing route exactly.
  // Finding 6.1: isExporting lock prevents double-submits; try/finally ensures unlock.
  const handleExportCSV = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (methodId) params.set("methodId", methodId);
      if (dateRange && dateRange !== "all") params.set("dateRange", dateRange);
      if (activeTabId === "awaiting") params.set("tab", "awaiting");
      const response = await fetch(
        `/api/admin/orders/export?${params.toString()}`,
      );
      if (!response.ok) {
        showToast("Export failed. Please try again.", { isError: true });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }, [search, methodId, dateRange, activeTabId, showToast]);

  // ---- Derived state -----------------------------------------------------
  const filtersActive = hasActiveFilters(
    search,
    methodId,
    dateRange,
    artworkStatus,
    tab,
  );
  const isEmpty = orders.length === 0;
  const hasPreviousPage = page > 1;
  const hasNextPage = page < totalPages;
  const showPagination = totalPages > 1;

  // Method options for the decoration method select
  const methodOptions = [
    { label: "All methods", value: "" },
    ...methods.map((m: { id: string; name: string }) => ({
      label: m.name,
      value: m.id,
    })),
  ];

  // Artwork status options for filter select
  const artworkStatusOptions = [
    { label: "All artwork", value: "" },
    { label: "Provided", value: "PROVIDED" },
    { label: "Awaiting artwork", value: "PENDING_CUSTOMER" },
  ];

  // Date range options (matching loader)
  const dateRangeOptions = [
    { label: "All time", value: "all" },
    { label: "Today", value: "today" },
    { label: "This week", value: "this-week" },
    { label: "This month", value: "this-month" },
  ];

  // ---- Render ------------------------------------------------------------
  return (
    <s-page heading="Orders">
      {/* Primary action: Print production sheets — coming soon */}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="print"
        disabled={true}
        accessibilityLabel="Bulk print — coming soon"
      >
        Print production sheets
      </s-button>

      {/* Secondary action: Export */}
      <s-button
        slot="secondary-actions"
        variant="secondary"
        accessibilityLabel="Export orders as CSV"
        disabled={isExporting}
        onClick={handleExportCSV}
      >
        Export
      </s-button>

      {/* Secondary action: Download artwork — coming soon */}
      <s-button
        slot="secondary-actions"
        variant="secondary"
        disabled={true}
        accessibilityLabel="Download artwork — coming soon"
      >
        Download artwork
      </s-button>

      {/* ---------------------------------------------------------------- */}
      {/* Tabs                                                             */}
      {/* ---------------------------------------------------------------- */}
      {/*
       * Finding 1.2: <s-tabs> does not exist in Polaris WC (rejected by critic).
       * Using a button-pair with role="tablist" / role="tab" + aria-selected
       * for accessibility. Active tab uses variant="secondary" (styled bold via
       * s-text type="strong"), inactive uses variant="tertiary" to give visual
       * weight difference without the full primary colour fill.
       */}
      <s-section padding="none" accessibilityLabel="Order view tabs">
        {/*
         * Finding 1.2: Wrapping div carries role="tablist"; individual divs carry
         * role="tab" + aria-selected because <s-button> JSX types do not accept
         * arbitrary ARIA props directly. Active tab uses variant="secondary" (with
         * bold text via <s-text type="strong">), inactive uses variant="tertiary".
         */}
        <div role="tablist" aria-label="Order view" style={{ display: "flex" }}>
          {ORDER_TABS.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
            >
              <s-button
                variant={activeTabId === t.id ? "secondary" : "tertiary"}
                onClick={() => handleTabChange(t.id)}
              >
                {activeTabId === t.id ? (
                  <s-text type="strong">{t.label}</s-text>
                ) : (
                  t.label
                )}
              </s-button>
            </div>
          ))}
        </div>
      </s-section>

      {/* ---------------------------------------------------------------- */}
      {/* Bulk action bar (only when selection.size > 0)                  */}
      {/* ---------------------------------------------------------------- */}
      {selected.size > 0 && (
        <s-section padding="none" accessibilityLabel="Bulk actions bar">
          <s-stack
            direction="inline"
            gap="small-200"
            alignItems="center"
            paddingBlock="small"
          >
            <s-text color="subdued">
              {selected.size}{" "}
              {selected.size === 1 ? "order" : "orders"} selected
            </s-text>
            <s-button
              variant="secondary"
              onClick={handleBulkMarkInProduction}
              loading={fetcher.state === "submitting"}
              accessibilityLabel="Mark selected orders as In Production"
            >
              Mark as In Production
            </s-button>
          </s-stack>
        </s-section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Main content: table or empty state                              */}
      {/* ---------------------------------------------------------------- */}
      {isEmpty ? (
        <OrdersEmptyState
          variant={filtersActive ? "filtered" : "never"}
          isAwaitingTab={tab === "awaiting"}
        />
      ) : (
        <>
          <s-section padding="none" accessibilityLabel="Orders table">
            <s-table
              paginate={showPagination}
              hasPreviousPage={hasPreviousPage}
              hasNextPage={hasNextPage}
              onPreviousPage={handlePreviousPage}
              onNextPage={handleNextPage}
              loading={navigation.state === "loading"}
            >
              {/* Filters slot — Finding 1.1: 3-col grid per authoritative Shopify popover pattern */}
              {/* Grid: 1fr (search) | auto (filter button) | auto (sort button — disabled) */}
              <s-grid
                slot="filters"
                gap="small-200"
                gridTemplateColumns="1fr auto auto"
              >
                {/* Native search-field (not s-text-field icon="search") */}
                <s-search-field
                  label="Search orders"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search orders..."
                  value={search}
                  onInput={handleSearchInput}
                />
                {/* Filter popover trigger — opens orders-filter-popover */}
                <s-button
                  icon="filter"
                  variant="secondary"
                  accessibilityLabel="Filter"
                  commandFor="orders-filter-popover"
                />
                {/*
                 * TODO: Sort is not currently plumbed through the loader (no `sort` URL param).
                 * Keeping button disabled until the loader supports sort order.
                 * Remove `disabled` and wire a `<s-popover id="orders-sort-popover">` when
                 * the loader is updated to accept `sort` param.
                 */}
                <s-button
                  icon="sort"
                  variant="secondary"
                  disabled
                  accessibilityLabel="Sort — coming soon"
                />
              </s-grid>

              {/* Filter popover — contains the 3 filter selects */}
              <s-popover id="orders-filter-popover" inlineSize="280px">
                <s-box padding="base">
                  <s-stack direction="block" gap="base">
                    <s-select
                      label="Decoration method"
                      labelAccessibilityVisibility="exclusive"
                      value={methodId}
                      onChange={handleMethodChange}
                    >
                      {methodOptions.map((opt) => (
                        <s-option key={opt.value} value={opt.value}>
                          {opt.label}
                        </s-option>
                      ))}
                    </s-select>
                    <s-select
                      label="Date range"
                      labelAccessibilityVisibility="exclusive"
                      value={dateRange}
                      onChange={handleDateRangeChange}
                    >
                      {dateRangeOptions.map((opt) => (
                        <s-option key={opt.value} value={opt.value}>
                          {opt.label}
                        </s-option>
                      ))}
                    </s-select>
                    <s-select
                      label="Artwork status"
                      labelAccessibilityVisibility="exclusive"
                      value={artworkStatus}
                      onChange={handleArtworkStatusChange}
                    >
                      {artworkStatusOptions.map((opt) => (
                        <s-option key={opt.value} value={opt.value}>
                          {opt.label}
                        </s-option>
                      ))}
                    </s-select>
                    {/* Popover action buttons: Apply closes, Clear resets filters */}
                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="primary"
                        command="--hide"
                        commandFor="orders-filter-popover"
                      >
                        Apply
                      </s-button>
                      <s-button
                        variant="secondary"
                        command="--hide"
                        commandFor="orders-filter-popover"
                        onClick={handleClearAllFilters}
                      >
                        Clear
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-popover>

              {/* Applied filter badges row inside table */}
              {filtersActive && (
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  paddingBlock="small"
                >
                  {/* Finding 2.2: Active tab shown as a removable chip/badge */}
                  {tab !== "all" && (
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      <s-badge>
                        {tab === "awaiting" ? "Awaiting artwork" : tab}
                      </s-badge>
                      <s-button
                        variant="tertiary"
                        icon="x-circle"
                        accessibilityLabel="Clear tab filter"
                        onClick={() => handleTabChange("all")}
                      />
                    </s-stack>
                  )}
                  {artworkStatus && (
                    <s-badge>
                      {artworkStatus === "PROVIDED"
                        ? "Artwork: Provided"
                        : "Artwork: Awaiting artwork"}
                    </s-badge>
                  )}
                  {search && <s-badge>Search: {search}</s-badge>}
                  {methodId && (
                    <s-badge>
                      Method:{" "}
                      {methods.find(
                        (m: { id: string; name: string }) => m.id === methodId,
                      )?.name ?? methodId}
                    </s-badge>
                  )}
                  {dateRange && dateRange !== "all" && (
                    <s-badge>Date: {dateRange}</s-badge>
                  )}
                  <s-button
                    variant="tertiary"
                    onClick={handleClearAllFilters}
                    accessibilityLabel="Clear all filters"
                  >
                    Clear all
                  </s-button>
                </s-stack>
              )}

              {/* Header row */}
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  <s-checkbox
                    id="orders-select-all"
                    accessibilityLabel="Select all orders on this page"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onChange={(e: Event) => {
                      const el = e.currentTarget as unknown as { checked: boolean };
                      toggleAll(el.checked);
                    }}
                  />
                </s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Items</s-table-header>
                <s-table-header>Artwork</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
                <s-table-header format="numeric">Total</s-table-header>
              </s-table-header-row>

              {/* Body rows */}
              <s-table-body>
                {orders.map(
                  (order: {
                    shopifyOrderId: string;
                    orderName: string;
                    lineCount: number;
                    pendingArtwork: number;
                    latestStatus: string;
                    totalCents: number;
                    createdAt: string;
                  }) => {
                    const encodedId = encodeURIComponent(order.shopifyOrderId);
                    const checkboxId = `order-cb-${order.shopifyOrderId.replace(/\W/g, "-")}`;
                    const isSelected = selected.has(order.shopifyOrderId);

                    // Artwork badge via terminology module
                    const artworkBadge = indexArtworkBadge(order.pendingArtwork);

                    // Production status via terminology module
                    // latestStatus is typed as string (from Prisma group-by aggregation),
                    // cast to ProductionStatus for the terminology functions.
                    const status = order.latestStatus as ProductionStatus;
                    const statusLabel = productionStatusLabel(status);
                    const statusTone = productionStatusTone(status);

                    // Items count
                    const itemsLabel = `${order.lineCount} ${order.lineCount === 1 ? "item" : "items"}`;

                    // Fee total — loader returns currency as a symbol string (e.g. "$")
                    const feeDisplay = formatMoney(order.totalCents, currency);

                    return (
                      <s-table-row
                        key={order.shopifyOrderId}
                        clickDelegate={checkboxId}
                      >
                        {/* Order name + row checkbox */}
                        <s-table-cell>
                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <s-checkbox
                              id={checkboxId}
                              accessibilityLabel={`Select order ${order.orderName}`}
                              checked={isSelected}
                              onChange={(e: Event) => {
                                const el = e.currentTarget as unknown as {
                                  checked: boolean;
                                };
                                toggleRow(order.shopifyOrderId, el.checked);
                              }}
                            />
                            <s-link
                              href={`/app/orders/${encodedId}`}
                              onClick={(e: Event) => {
                                e.preventDefault();
                                navigate(`/app/orders/${encodedId}`);
                              }}
                            >
                              <s-text type="strong">{order.orderName}</s-text>
                            </s-link>
                          </s-stack>
                        </s-table-cell>

                        {/* Date */}
                        <s-table-cell>
                          <s-text color="subdued">
                            {formatDate(order.createdAt)}
                          </s-text>
                        </s-table-cell>

                        {/* Customer — loader does not return customer name */}
                        <s-table-cell>
                          <s-text color="subdued">—</s-text>
                        </s-table-cell>

                        {/* Items — lineCount only; no product titles in loader data */}
                        <s-table-cell>
                          <s-text>{itemsLabel}</s-text>
                        </s-table-cell>

                        {/* Artwork badge */}
                        <s-table-cell>
                          <s-badge tone={artworkBadge.tone}>
                            {artworkBadge.label}
                          </s-badge>
                        </s-table-cell>

                        {/* Production status badge */}
                        <s-table-cell>
                          <s-badge tone={statusTone}>{statusLabel}</s-badge>
                        </s-table-cell>

                        {/* Fee total */}
                        <s-table-cell>
                          <s-text>{feeDisplay}</s-text>
                        </s-table-cell>
                      </s-table-row>
                    );
                  },
                )}
              </s-table-body>
            </s-table>
          </s-section>

          {/* Pagination page indicator (supplements the WC pagination controls) */}
          {showPagination && (
            <s-stack
              direction="inline"
              alignItems="center"
              justifyContent="center"
              paddingBlock="base"
              gap="small"
            >
              <s-text color="subdued">{`Page ${page} of ${totalPages}`}</s-text>
            </s-stack>
          )}
        </>
      )}
      {/* Finding 1.3: Footer help link — matches in-scope.html pattern */}
      <s-stack alignItems="center" paddingBlock="large">
        <s-text color="subdued">
          Learn more about{" "}
          <s-link
            href="https://insignia.app/docs/artwork-workflows"
            target="_blank"
          >
            artwork workflows
          </s-link>
          .
        </s-text>
      </s-stack>
    </s-page>
  );
}
