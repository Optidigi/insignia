import { BlockStack, InlineStack, Text, Image, Divider } from "@shopify/ui-extensions-react/admin";
import type { LineItemBlock } from "../lib/types";
import { StatusBadgePair } from "./StatusBadges";

export function LineItemRow({ item }: { item: LineItemBlock }) {
  const showPlacements = item.placements.length > 1 || item.placements.some(p => !p.logoThumbnailUrl);

  return (
    <BlockStack gap="small">
      <Divider />
      <InlineStack gap="base" blockAlignment="start">
        {item.firstLogoThumbnailUrl ? (
          <BlockStack inlineSize={48}>
            <Image source={item.firstLogoThumbnailUrl} alt="Logo preview" />
          </BlockStack>
        ) : (
          <BlockStack inlineSize={48} />
        )}
        <BlockStack gap="small">
          <Text fontWeight="bold">
            {item.productName}
            {item.variantLabel ? ` — ${item.variantLabel}` : ""}
          </Text>
          <Text>
            {item.decorationMethod}
            {item.quantity > 1 ? ` · Qty ${item.quantity}` : ""}
          </Text>
          <StatusBadgePair
            artworkStatus={item.overallArtworkStatus}
            productionStatus={item.productionStatus}
          />
          {showPlacements && item.placements.map(p => (
            <InlineStack key={p.placementId} gap="small">
              <Text>{p.name}:</Text>
              <Text>{p.logoThumbnailUrl ? "Provided" : "Pending"}</Text>
            </InlineStack>
          ))}
        </BlockStack>
      </InlineStack>
    </BlockStack>
  );
}
