/**
 * Storefront modal types (client-safe).
 * Matches GET /apps/insignia/config response and modal-spec.md.
 */

export type PlacementGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
};

export type PlacementStep = {
  label: string;
  priceAdjustmentCents: number;
  scaleFactor: number;
};

export type Placement = {
  id: string;
  name: string;
  basePriceAdjustmentCents: number;
  hidePriceWhenZero: boolean;
  steps: PlacementStep[];
  defaultStepIndex: number;
  geometryByViewId: Record<string, PlacementGeometry | null>;
};

export type ConfiguredView = {
  id: string;
  perspective: "front" | "back" | "left" | "right" | "side";
  imageUrl: string | null;
  isMissingImage: boolean;
};

export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: {
    fileTypes: string[];
    maxColors: number | null;
    minDpi: number | null;
  } | null;
};

export type StorefrontConfig = {
  productConfigId: string;
  shop: string;
  productId: string;
  variantId: string;
  currency: string;
  baseProductPriceCents: number;
  productTitle: string;
  placeholderLogo: {
    mode: "merchant_asset" | "bold_text";
    text: string | null;
    imageUrl: string | null;
  };
  views: ConfiguredView[];
  methods: DecorationMethodRef[];
  placements: Placement[];
};

export type PlacementSelection = {
  placementId: string;
  stepIndex: number;
};

/** Draft payload for POST /apps/insignia/customizations */
export type CustomizationDraftPayload = {
  productId: string;
  variantId: string;
  productConfigId: string;
  methodId: string;
  placements: PlacementSelection[];
  logoAssetIdsByPlacementId: Record<string, string | null>;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
};

export type WizardStep = "upload" | "placement" | "size" | "review";

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "upload", label: "Upload your artwork" },
  { id: "placement", label: "Placement" },
  { id: "size", label: "Logo size" },
  { id: "review", label: "Review" },
];
