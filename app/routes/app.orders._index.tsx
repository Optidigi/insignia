/**
 * Orders list page — shows Insignia-customized orders.
 * Polaris Web Components render: app/components/admin/orders/OrdersIndex.tsx
 * Canonical: docs/admin/orders-workflow.md
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { currencySymbol } from "../lib/services/shop-currency.server";
import { computeDateFrom } from "../lib/services/orders-utils.server";

import OrdersIndex from "../components/admin/orders/OrdersIndex";

const PAGE_SIZE = 25;

const STATUS_PRIORITY: Record<string, number> = {
  ARTWORK_PENDING: 0,
  ARTWORK_PROVIDED: 1,
  IN_PRODUCTION: 2,
  QUALITY_CHECK: 3,
  SHIPPED: 4,
  UNKNOWN: -1,
};

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

  const methods = await db.decorationMethod.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const dateFrom = computeDateFrom(dateRange);

  const numericSearch = search.replace(/\D/g, "");

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

  const distinctOrderIds = await db.orderLineCustomization.groupBy({
    by: ["shopifyOrderId"],
    where,
    orderBy: { _max: { createdAt: "desc" } },
    _max: { createdAt: true },
  });
  const totalCount = distinctOrderIds.length;

  const pagedOrderIds = distinctOrderIds
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((g) => g.shopifyOrderId);

  const orderLines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: { in: pagedOrderIds } },
    include: {
      customizationConfig: { select: { unitPriceCents: true, decorationMethod: { select: { name: true } } } },
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
    if (existing) {
      existing.lineCount++;
      existing.totalCents += unitCents;
      if (line.artworkStatus === "PENDING_CUSTOMER") existing.pendingArtwork++;
      const existingPriority = STATUS_PRIORITY[existing.latestStatus] ?? -1;
      const newPriority = STATUS_PRIORITY[line.productionStatus] ?? -1;
      if (newPriority < existingPriority) {
        existing.latestStatus = line.productionStatus;
      }
    } else {
      const idNum = line.shopifyOrderId.replace(/\D/g, "");
      groupMap.set(line.shopifyOrderId, {
        shopifyOrderId: line.shopifyOrderId,
        orderName: `#${idNum.slice(-6)}`,
        lineCount: 1,
        pendingArtwork: line.artworkStatus === "PENDING_CUSTOMER" ? 1 : 0,
        latestStatus: line.productionStatus,
        totalCents: unitCents,
        createdAt: line.createdAt.toISOString(),
      });
    }
  }

  return { orders: Array.from(groupMap.values()), currency, tab, methods, search, methodId, dateRange, artworkStatus, page, totalPages, totalCount };
};

export default OrdersIndex;
