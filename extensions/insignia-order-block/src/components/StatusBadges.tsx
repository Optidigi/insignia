import { Badge, InlineStack } from "@shopify/ui-extensions-react/admin";
import { artworkBadge, productionBadge } from "../lib/statusHelpers";

export function ArtworkBadge({ status }: { status: "PROVIDED" | "PENDING_CUSTOMER" }) {
  const { tone, label } = artworkBadge(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function ProductionBadge({ status }: { status: string }) {
  const { tone, label } = productionBadge(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadgePair({ artworkStatus, productionStatus }: {
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  productionStatus: string;
}) {
  return (
    <InlineStack gap="small">
      <ArtworkBadge status={artworkStatus} />
      <ProductionBadge status={productionStatus} />
    </InlineStack>
  );
}
