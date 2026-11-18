/** The strict permanent shop domain accepted elsewhere (see `SHOP_DOMAIN` in signing-provision.ts). */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/;

/**
 * The embedded admin `frame-ancestors` directive for one request, as Shopify requires:
 * the requesting shop's own domain plus unified admin. A missing, repeated or non-canonical `shop`
 * (including any value that could inject another source or directive) yields unified
 * admin only; the parameter is a framing hint, never an authentication input.
 */
export function adminFrameAncestors(url: URL): string {
  const [shop, ...ambiguous] = url.searchParams.getAll('shop');
  return shop !== undefined && !ambiguous.length && SHOP_DOMAIN.test(shop)
    ? `frame-ancestors https://${shop} https://admin.shopify.com`
    : 'frame-ancestors https://admin.shopify.com';
}
