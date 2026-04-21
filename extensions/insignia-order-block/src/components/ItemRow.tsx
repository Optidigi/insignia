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
  if (item.quantity > 1) detailParts.push(`Qty ${item.quantity}`);

  return (
    <s-stack direction="inline" gap="base" align-items="start">
      {item.firstLogoThumbnailUrl ? (
        <s-thumbnail src={item.firstLogoThumbnailUrl} alt="Logo preview" size="small" />
      ) : (
        <s-box
          inline-size="40px"
          block-size="40px"
          background="subdued"
          border-radius="base"
        />
      )}
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" align-items="center">
          <s-text type="strong">{name}</s-text>
          <s-badge tone={badge.tone}>{badge.label}</s-badge>
        </s-stack>
        {detailParts.length > 0 && (
          <s-text color="subdued">{detailParts.join(" · ")}</s-text>
        )}
      </s-stack>
    </s-stack>
  );
}
