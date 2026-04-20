import { InlineStack, Text, Badge, Link } from "@shopify/ui-extensions-react/admin";
import type { LineItemBlock } from "../lib/types";
import { overallTone } from "../lib/statusHelpers";

export function SummaryRow({ items, orderId }: { items: LineItemBlock[]; orderId: string }) {
  const tone = overallTone(items);
  const pendingCount = items.filter(i => i.overallArtworkStatus === "PENDING_CUSTOMER").length;
  const label = pendingCount > 0
    ? `${items.length} item${items.length > 1 ? "s" : ""} · ${pendingCount} artwork pending`
    : `${items.length} item${items.length > 1 ? "s" : ""}`;

  const encodedOrderId = encodeURIComponent(orderId);

  return (
    <InlineStack inlineAlignment="space-between" blockAlignment="center">
      <InlineStack gap="small" blockAlignment="center">
        <Text fontWeight="bold">Insignia Customizations</Text>
        <Badge tone={tone}>{label}</Badge>
      </InlineStack>
      <Link to={`app:orders/${encodedOrderId}`}>View details →</Link>
    </InlineStack>
  );
}
