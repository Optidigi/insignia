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

export async function addCustomizedToCart(
  baseVariantId: string | number,
  feeVariantId: string | number,
  quantity: number,
  properties: Record<string, string>
): Promise<Cart> {
  const baseId =
    typeof baseVariantId === "string"
      ? baseVariantId.replace("gid://shopify/ProductVariant/", "")
      : baseVariantId;
  const feeId =
    typeof feeVariantId === "string"
      ? feeVariantId.replace("gid://shopify/ProductVariant/", "")
      : feeVariantId;

  const items: Array<{ id: number; quantity: number; properties?: Record<string, string> }> = [
    { id: Number(baseId), quantity, properties },
    { id: Number(feeId), quantity, properties },
  ];

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
  properties: Record<string, string>;
};

/**
 * Add multiple base+fee variant pairs to the cart in a single request.
 * Used for B2B per-size quantity ordering where each size is a separate cart line.
 */
export async function addMultipleCustomizedToCart(pairs: CartItemPair[]): Promise<Cart> {
  const items: Array<{ id: number; quantity: number; properties: Record<string, string> }> = [];

  for (const { baseVariantId, feeVariantId, quantity, properties } of pairs) {
    const baseId =
      typeof baseVariantId === "string"
        ? baseVariantId.replace("gid://shopify/ProductVariant/", "")
        : baseVariantId;
    const feeId =
      typeof feeVariantId === "string"
        ? feeVariantId.replace("gid://shopify/ProductVariant/", "")
        : feeVariantId;

    items.push({ id: Number(baseId), quantity, properties });
    items.push({ id: Number(feeId), quantity, properties });
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

export function buildInsigniaProperties(
  customizationId: string,
  methodId: string,
  configHash: string,
  pricingVersion: string
): Record<string, string> {
  return {
    _insignia_customization_id: customizationId,
    _insignia_method: methodId,
    _insignia_config_hash: configHash,
    _insignia_pricing_version: pricingVersion,
  };
}
