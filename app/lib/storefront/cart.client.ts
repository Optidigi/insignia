/**
 * Storefront cart helpers (browser-only).
 * Canonical: docs/storefront/integration-guide.md — re-fetch after every mutation.
 *
 * Uses window.location.origin to build absolute URLs because the App Proxy
 * page has a <base> tag pointing to the app server for asset loading. Without
 * absolute URLs, fetch() would resolve "/cart/add.js" against the app server
 * instead of the store domain.
 */

function getCartRoot(): string {
  if (typeof window === "undefined") return "/";
  const root = window.Shopify?.routes?.root ?? "/";
  return `${window.location.origin}${root}`;
}

export type CartItem = {
  key: string;
  id: number;
  variant_id: number;
  quantity: number;
  properties: Record<string, string>;
};

export type Cart = {
  items: CartItem[];
  item_count: number;
};

export async function getCart(): Promise<Cart> {
  const res = await fetch(`${getCartRoot()}cart.js`);
  if (!res.ok) throw new Error("Failed to fetch cart");
  return res.json();
}

// design-fees: get the active cart token (or null if no cart yet exists).
// Best-effort dedup identity, NOT a security boundary (§14.C).
export async function getCartToken(): Promise<string | null> {
  try {
    const cart = (await getCart()) as Cart & { token?: string };
    return typeof cart?.token === "string" && cart.token ? cart.token : null;
  } catch {
    // /cart.js may legitimately return non-200 on first visit; fail-open to null.
    return null;
  }
}

export async function addToCart(
  variantId: string | number,
  quantity: number,
  properties: Record<string, string>
): Promise<Cart> {
  const id = typeof variantId === "string" ? variantId.replace("gid://shopify/ProductVariant/", "") : variantId;
  const res = await fetch(`${getCartRoot()}cart/add.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: Number(id), quantity, properties }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.description || "Failed to add to cart");
  }
  await res.json();
  return getCart();
}

export type GarmentPropertiesInput = {
  customizationId: string;
  methodCustomerName: string;
  placementNames: string[];
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
};

export function buildGarmentProperties(p: GarmentPropertiesInput): Record<string, string> {
  return {
    _insignia_customization_id: p.customizationId,
    Decoration: p.methodCustomerName,
    Placement: p.placementNames.join(", "),
    "Artwork status": p.artworkStatus === "PROVIDED" ? "Provided" : "Artwork requested",
  };
}

export function buildFeeProperties(): Record<string, string> {
  return { _insignia_fee: "true" };
}

// design-fees: a single, one-time design-fee cart line (not per-garment)
export type DesignFeeLineInput = {
  variantId: string | number;
  /** Quantity is always 1 for one-time design fees (one row per cart per fee tuple). */
  quantity: number;
  properties: Record<string, string>;
};

export async function addCustomizedToCart(
  baseVariantId: string | number,
  feeVariantId: string | number,
  quantity: number,
  garmentProperties: Record<string, string>,
  feeProperties: Record<string, string>,
  // design-fees: optional extra one-time fee lines added in the same /cart/add.js call
  designFeeLines: DesignFeeLineInput[] = [],
): Promise<Cart> {
  const baseId =
    typeof baseVariantId === "string"
      ? baseVariantId.replace("gid://shopify/ProductVariant/", "")
      : baseVariantId;
  const feeId =
    typeof feeVariantId === "string"
      ? feeVariantId.replace("gid://shopify/ProductVariant/", "")
      : feeVariantId;

  const items: Array<{ id: number; quantity: number; properties: Record<string, string> }> = [
    { id: Number(baseId), quantity, properties: garmentProperties },
    { id: Number(feeId), quantity, properties: feeProperties },
  ];
  // design-fees: append one line per fee tuple
  for (const dfl of designFeeLines) {
    const id = typeof dfl.variantId === "string"
      ? dfl.variantId.replace("gid://shopify/ProductVariant/", "")
      : dfl.variantId;
    items.push({ id: Number(id), quantity: dfl.quantity, properties: dfl.properties });
  }

  const res = await fetch(`${getCartRoot()}cart/add.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.description || "Failed to add to cart");
  }
  await res.json();
  return getCart();
}

export type CartItemPair = {
  baseVariantId: string | number;
  feeVariantId: string | number;
  quantity: number;
  garmentProperties: Record<string, string>;
  feeProperties: Record<string, string>;
};

/**
 * Add multiple base+fee variant pairs to the cart in a single request.
 * Used for B2B per-size quantity ordering where each size is a separate cart line.
 *
 * design-fees: optional `designFeeLines` are appended after all pairs as one-time
 * additional cart lines.
 */
export async function addMultipleCustomizedToCart(
  pairs: CartItemPair[],
  // design-fees:
  designFeeLines: DesignFeeLineInput[] = [],
): Promise<Cart> {
  const items: Array<{ id: number; quantity: number; properties: Record<string, string> }> = [];

  for (const { baseVariantId, feeVariantId, quantity, garmentProperties, feeProperties } of pairs) {
    const baseId =
      typeof baseVariantId === "string"
        ? baseVariantId.replace("gid://shopify/ProductVariant/", "")
        : baseVariantId;
    const feeId =
      typeof feeVariantId === "string"
        ? feeVariantId.replace("gid://shopify/ProductVariant/", "")
        : feeVariantId;

    items.push({ id: Number(baseId), quantity, properties: garmentProperties });
    items.push({ id: Number(feeId), quantity, properties: feeProperties });
  }
  // design-fees:
  for (const dfl of designFeeLines) {
    const id = typeof dfl.variantId === "string"
      ? dfl.variantId.replace("gid://shopify/ProductVariant/", "")
      : dfl.variantId;
    items.push({ id: Number(id), quantity: dfl.quantity, properties: dfl.properties });
  }

  const res = await fetch(`${getCartRoot()}cart/add.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.description || "Failed to add to cart");
  }
  await res.json();
  return getCart();
}

// design-fees: convenience builder for the customization-line property tags
// described in §14.B. Returns a flat properties record suitable for merging
// onto buildGarmentProperties() output.
export function buildCustomizationDesignFeeProperties(args: {
  logoContentHash: string | null;
  feeCategoryIds: string[];
  methodId: string;
}): Record<string, string> {
  if (!args.logoContentHash || args.feeCategoryIds.length === 0) return {};
  return {
    _insignia_logo_hash: args.logoContentHash,
    _insignia_fee_categories: args.feeCategoryIds.join(","),
    _insignia_method_id: args.methodId,
  };
}

export async function changeCartLine(
  key: string,
  quantity: number,
  properties?: Record<string, string>
): Promise<Cart> {
  const cart = await getCart();
  const item = cart.items.find((i: CartItem) => i.key === key);
  if (!item) throw new Error("Cart line not found");
  const body: { id: string; quantity: number; properties?: Record<string, string> } = {
    id: key,
    quantity,
  };
  if (properties) body.properties = { ...item.properties, ...properties };
  const res = await fetch(`${getCartRoot()}cart/change.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.description || "Failed to update cart");
  }
  await res.json();
  return getCart();
}

