import type { LineItemBlock } from "./types";

type BadgeTone = "caution" | "info" | "warning" | "success";

export function productionBadge(status: string): { tone: BadgeTone; label: string } {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    ARTWORK_PENDING:  { tone: "caution",  label: "Awaiting artwork" },
    ARTWORK_PROVIDED: { tone: "info",     label: "Artwork received" },
    IN_PRODUCTION:    { tone: "info",     label: "In production" },
    QUALITY_CHECK:    { tone: "warning",  label: "Quality check" },
    SHIPPED:          { tone: "success",  label: "Shipped" },
  };
  return map[status] ?? { tone: "caution", label: status };
}

// Single highest-urgency badge per item row
export function itemBadge(
  item: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">
): { tone: BadgeTone; label: string } {
  if (item.overallArtworkStatus === "PENDING_CUSTOMER") {
    return { tone: "caution", label: "Awaiting artwork" };
  }
  return productionBadge(item.productionStatus);
}

// Overall worst-case badge for the block header
export function overallBadge(
  items: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">[]
): { tone: BadgeTone; label: string } {
  if (items.length === 0) return { tone: "info", label: "No items" };
  if (items.every(i => i.productionStatus === "SHIPPED")) {
    return { tone: "success", label: "Complete" };
  }
  if (items.some(i => i.overallArtworkStatus === "PENDING_CUSTOMER")) {
    return { tone: "caution", label: "Needs action" };
  }
  return { tone: "info", label: "In progress" };
}

function formatFee(amount: string, currencyCode: string): string {
  const num = parseFloat(amount);
  if (!Number.isFinite(num)) return amount;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(num);
}

// Full summary line for expanded block header
export function formatSummaryLine(
  items: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">[],
  feeTotal: string | null,
  feeCurrencyCode: string | null,
): string {
  const count = items.length;
  const noun = count === 1 ? "item" : "items";
  const feeStr =
    feeTotal && feeCurrencyCode ? ` · ${formatFee(feeTotal, feeCurrencyCode)}` : "";

  const allComplete = count > 0 && items.every(i => i.productionStatus === "SHIPPED");
  if (allComplete) {
    return `${count} ${noun} · all decorations complete${feeStr}`;
  }

  const pendingCount = items.filter(
    i => i.overallArtworkStatus === "PENDING_CUSTOMER"
  ).length;
  const pendingStr = pendingCount > 0 ? ` · ${pendingCount} awaiting artwork` : "";
  return `${count} ${noun}${pendingStr}${feeStr}`;
}

// Short summary for the s-admin-block collapsed-summary attribute
export function formatCollapsedSummary(
  items: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">[],
  feeTotal: string | null,
  feeCurrencyCode: string | null,
): string {
  const count = items.length;
  const noun = count === 1 ? "item" : "items";
  const feeStr =
    feeTotal && feeCurrencyCode ? ` · ${formatFee(feeTotal, feeCurrencyCode)}` : "";
  return `${count} ${noun}${feeStr}`;
}
