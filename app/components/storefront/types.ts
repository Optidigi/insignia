/**
 * Storefront modal types (client-safe).
 * Matches GET /apps/insignia/config response and modal-spec.md.
 */

export type PlacementGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  /** Optional — set when the merchant configured a specific zone height. */
  maxHeightPercent?: number | null;
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
  /**
   * Optional per-method overrides for this placement's base fee. When present,
   * keys are DecorationMethod ids and values are the effective cents charged
   * for this placement when that method is chosen. Only set when at least one
   * override exists server-side.
   */
  pricePerMethod?: Record<string, number>;
};

export type ConfiguredView = {
  id: string;
  name: string | null;
  perspective: "front" | "back" | "left" | "right" | "side" | "custom";
  imageUrl: string | null;
  isMissingImage: boolean;
  /**
   * Forward-compat: pixels-per-cm calibration from the placement editor's
   * ruler tool. Null = not calibrated. The storefront config service does
   * not return this yet (DB column exists at ProductView.calibrationPxPerCm
   * but is not projected into the response). When backend ships, the size
   * step will append "· ~N cm wide" to step labels.
   */
  calibrationPxPerCm?: number | null;
};

export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  hidePriceWhenZero: boolean;
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: {
    fileTypes: string[];
    maxColors: number | null;
    minDpi: number | null;
  } | null;
};

export type ProductVariantOption = {
  id: string;       // Shopify GID (gid://shopify/ProductVariant/...)
  title: string;    // e.g. "Small", "Medium / Blue"
  sizeLabel: string; // Extracted size option value, e.g. "S", "M", "L"
  priceCents: number;
  available: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
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
  variants: ProductVariantOption[];
  /** Which product axis drives the quantity grid cards. */
  variantAxis: "size" | "color" | "option";
  // design-fees: per-shop summary; null when feature disabled or no categories
  designFees?: {
    categories: Array<{
      id: string;
      methodId: string;
      name: string;
      feeCents: number;
    }>;
    placementCategoryByPlacementId: Record<string, string>;
  } | null;
  /**
   * Forward-compat: shop's branding square logo URL fetched via
   * `shop { brand { squareLogo { image { url } } } }`. The storefront
   * config service does not return this yet. When backend ships, the
   * modal header will prepend a 32×32 thumbnail before the title.
   */
  shopLogoUrl?: string | null;
  /**
   * Resolved storefront locale (BCP-47 base, e.g. "en", "nl"). Picked by the
   * server from merchant default → Accept-Language → "en". The modal uses
   * this to choose the right TranslationStrings bundle.
   */
  locale?: string;
};

export type PlacementSelection = {
  placementId: string;
  stepIndex: number;
};

/** UI state map: placementId → selected stepIndex. */
export type PlacementSelections = Record<string, number>;

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
