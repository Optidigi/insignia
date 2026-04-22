import type { LineItemBlock } from "./types";

type BadgeTone = "caution" | "info" | "warning" | "success";

type BadgeIcon = "check-circle" | "alert-triangle" | "clock";
export type BadgeProps = { tone: BadgeTone; label: string; icon?: BadgeIcon };

export function productionBadge(status: string): BadgeProps {
  const map: Record<string, BadgeProps> = {
    ARTWORK_PENDING:  { tone: "caution",  label: "Awaiting artwork", icon: "alert-triangle" },
    ARTWORK_PROVIDED: { tone: "info",     label: "Artwork received",  icon: "check-circle" },
    IN_PRODUCTION:    { tone: "info",     label: "In production",    icon: "clock" },
    QUALITY_CHECK:    { tone: "warning",  label: "Quality check",    icon: "alert-triangle" },
    SHIPPED:          { tone: "success",  label: "Shipped",          icon: "check-circle" },
  };
  return map[status] ?? { tone: "caution", label: status };
}

// Single highest-urgency badge per item row
export function itemBadge(
  item: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">
): BadgeProps {
  if (item.overallArtworkStatus === "PENDING_CUSTOMER") {
    return { tone: "caution", label: "Awaiting artwork", icon: "alert-triangle" };
  }
  return productionBadge(item.productionStatus);
}

// Overall worst-case badge for the block header
export function overallBadge(
  items: Pick<LineItemBlock, "overallArtworkStatus" | "productionStatus">[]
): BadgeProps {
  if (items.length === 0) return { tone: "info", label: "No items" };
  if (items.every(i => i.productionStatus === "SHIPPED")) {
    return { tone: "success", label: "Complete", icon: "check-circle" };
  }
  if (items.some(i => i.overallArtworkStatus === "PENDING_CUSTOMER")) {
    return { tone: "caution", label: "Needs action", icon: "alert-triangle" };
  }
  return { tone: "info", label: "In progress", icon: "clock" };
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
