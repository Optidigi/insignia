import type { LineItemBlock } from "../lib/types";
import { artworkBadge, productionBadge } from "../lib/statusHelpers";

export function LineItemRow({ item }: { item: LineItemBlock }) {
  const showPlacements =
    item.placements.length > 1 || item.placements.some((p) => !p.logoThumbnailUrl);
  const aw = artworkBadge(item.overallArtworkStatus);
  const prod = productionBadge(item.productionStatus);

  return (
    <s-stack direction="block" gap="small">
      <s-divider />
      <s-stack direction="inline" gap="base" align-items="start">
        {item.firstLogoThumbnailUrl ? (
          <s-thumbnail src={item.firstLogoThumbnailUrl} alt="Logo preview" size="base" />
        ) : (
          <s-box inline-size="48px" />
        )}
        <s-stack direction="block" gap="small">
          <s-text type="strong">
            {item.productName}
            {item.variantLabel ? ` — ${item.variantLabel}` : ""}
          </s-text>
          <s-text>
            {item.decorationMethod}
            {item.quantity > 1 ? ` · Qty ${item.quantity}` : ""}
          </s-text>
          <s-stack direction="inline" gap="small">
            <s-badge tone={aw.tone}>{aw.label}</s-badge>
            <s-badge tone={prod.tone}>{prod.label}</s-badge>
          </s-stack>
          {showPlacements &&
            item.placements.map((p) => (
              <s-stack key={p.placementId} direction="inline" gap="small">
                <s-text>{p.name}:</s-text>
                <s-text>{p.logoThumbnailUrl ? "Provided" : "Pending"}</s-text>
              </s-stack>
            ))}
        </s-stack>
      </s-stack>
    </s-stack>
  );
}
