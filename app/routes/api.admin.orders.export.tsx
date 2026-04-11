/**
 * Admin API: Export orders as CSV
 *
 * GET /api/admin/orders/export?search=&methodId=&dateRange=&tab=
 *
 * Returns a CSV file with all matching orders (no pagination).
 * Canonical: docs/admin/orders-workflow.md
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleError } from "../lib/errors.server";
import { computeDateFrom } from "../lib/services/orders-utils.server";

/** Wrap a CSV field value in quotes if it contains commas, quotes, or newlines. */
function csvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";
    const methodId = url.searchParams.get("methodId") || "";
    const dateRange = url.searchParams.get("dateRange") || "all";
    const tab = url.searchParams.get("tab") || "all";

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true, currencyCode: true },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    // Normalize search: strip non-digits so "#1001", "1001" all match the GID
    const numericSearch = search.replace(/\D/g, "");
    const dateFrom = computeDateFrom(dateRange);

    const where = {
      productConfig: { shopId: shop.id },
      ...(tab === "awaiting-artwork"
        ? { artworkStatus: "PENDING_CUSTOMER" as const }
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

    // Fetch ALL matching lines (no pagination limit)
    const lines = await db.orderLineCustomization.findMany({
      where,
      include: {
        customizationConfig: {
          select: {
            unitPriceCents: true,
            decorationMethod: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Group lines by shopifyOrderId — one CSV row per order
    type OrderRow = {
      orderId: string;
      date: string;
      method: string;
      artworkStatus: string;
      totalCents: number;
    };

    const groupMap = new Map<string, OrderRow>();
    for (const line of lines) {
      const existing = groupMap.get(line.shopifyOrderId);
      const unitCents = line.customizationConfig?.unitPriceCents ?? 0;
      const methodName =
        line.customizationConfig?.decorationMethod?.name ?? "Unknown";
      const dateStr = line.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      const idNum = line.shopifyOrderId.replace(/\D/g, "");

      if (existing) {
        existing.totalCents += unitCents;
      } else {
        groupMap.set(line.shopifyOrderId, {
          orderId: idNum,
          date: dateStr,
          method: methodName,
          artworkStatus: line.artworkStatus,
          totalCents: unitCents,
        });
      }
    }

    // Build CSV content
    const currencyCode = shop.currencyCode ?? "";
    const header = `Order ID,Date,Method,Artwork Status,Fee (${currencyCode})`;
    const rows = Array.from(groupMap.values()).map((row) => {
      return [
        csvField(row.orderId),
        csvField(row.date),
        csvField(row.method),
        csvField(row.artworkStatus),
        csvField((row.totalCents / 100).toFixed(2)),
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="orders.csv"',
      },
    });
  } catch (error) {
    return handleError(error);
  }
};
