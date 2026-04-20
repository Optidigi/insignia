import type { LineItemBlock } from "../lib/types";
import { overallTone } from "../lib/statusHelpers";

export function SummaryRow({ items, orderId }: { items: LineItemBlock[]; orderId: string }) {
  const tone = overallTone(items);
  const pendingCount = items.filter((i) => i.overallArtworkStatus === "PENDING_CUSTOMER").length;
  const label =
    pendingCount > 0
      ? `${items.length} item${items.length > 1 ? "s" : ""} · ${pendingCount} artwork pending`
      : `${items.length} item${items.length > 1 ? "s" : ""}`;

  const encodedOrderId = encodeURIComponent(orderId);

  return (
    <s-stack direction="inline" justify-content="space-between" align-items="center">
      <s-stack direction="inline" gap="small" align-items="center">
        <s-text type="strong">Insignia Customizations</s-text>
        <s-badge tone={tone}>{label}</s-badge>
      </s-stack>
      <s-link href={`app:orders/${encodedOrderId}`}>View details →</s-link>
    </s-stack>
  );
}
