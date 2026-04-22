import type { LineItemBlock } from "../lib/types";
import { itemBadge } from "../lib/statusHelpers";

export function ItemRow({ item }: { item: LineItemBlock }) {
  const badge = itemBadge(item);

  const name = item.variantLabel
    ? `${item.productName} — ${item.variantLabel}`
    : item.productName;

  const detailParts: string[] = [];
  if (item.placements.length > 0) {
    detailParts.push(item.placements.map(p => p.name).join(", "));
  }
  if (item.decorationMethod) detailParts.push(item.decorationMethod);

  return (
    <s-grid gridTemplateColumns="1fr auto" alignItems="center">
      <s-stack direction="block" gap="none">
        <s-text type="strong">{name}</s-text>
        {detailParts.length > 0 && (
          <s-text color="subdued">{detailParts.join(" · ")}</s-text>
        )}
      </s-stack>
      <s-stack direction="inline" alignItems="center" gap="small">
        <s-stack direction="inline" alignItems="center" gap="none">
          <s-text color="subdued">×</s-text>
          <s-chip accessibility-label={`Qty ${item.quantity}`}>{item.quantity}</s-chip>
        </s-stack>
        <s-badge tone={badge.tone} icon={badge.icon}>{badge.label}</s-badge>
      </s-stack>
    </s-grid>
  );
}
