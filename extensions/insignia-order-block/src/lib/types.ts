export type PlacementBlock = {
  placementId: string;
  name: string;
  logoThumbnailUrl: string | null;
};

export type LineItemBlock = {
  shopifyLineId: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  decorationMethod: string;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  productionStatus: string;
  overallArtworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  firstLogoThumbnailUrl: string | null;
  placements: PlacementBlock[];
};

export type OrderBlockResponse = {
  orderId: string;
  items: LineItemBlock[];
  feeTotal: string | null;        // decimal string e.g. "28.00"; null if no fee line items
  feeCurrencyCode: string | null; // ISO 4217 e.g. "EUR"
};
