/** Validated navigation context for the local product → method library → product flow. */
import type { MethodProduct } from './method-configuration.mts';

export type MethodReturnContext = { productId: string; productTitle: string; returnTo: string; search: string };

export function methodLibraryHref(productId: string, viewId: string, placementId: string): string {
  const id = productId.replace(/^gid:\/\/shopify\/Product\//, '');
  if (!/^\d+$/.test(id)) throw new Error('Choose an existing Shopify product.');
  const selection = new URLSearchParams({ view: viewId, placement: placementId, chooseMethods: '1' });
  const returnTo = `/admin/products/${id}/config?${selection}`;
  return `/admin/methods?${new URLSearchParams({ productId: id, returnTo })}`;
}

export function readMethodReturnContext(
  search: string,
  products: readonly MethodProduct[],
): MethodReturnContext | null {
  const params = new URLSearchParams(search);
  const id = params.get('productId') ?? '';
  const product = products.find((item) => item.id.replace(/^gid:\/\/shopify\/Product\//, '') === id);
  const returnTo = params.get('returnTo') ?? '';
  if (!/^\d+$/.test(id) || !product || !returnTo.startsWith(`/admin/products/${id}/config?`)) return null;
  const target = new URL(returnTo, 'https://preview.invalid');
  if (target.origin !== 'https://preview.invalid' || target.pathname !== `/admin/products/${id}/config` || target.hash)
    return null;
  if ([...target.searchParams.keys()].some((key) => !['view', 'placement', 'chooseMethods'].includes(key))) return null;
  if (
    ['view', 'placement'].some(
      (key) => !target.searchParams.get(key) || (target.searchParams.get(key)?.length ?? 0) > 200,
    )
  )
    return null;
  if (target.searchParams.get('chooseMethods') !== '1') return null;
  return {
    productId: product.id,
    productTitle: product.title,
    returnTo: `${target.pathname}${target.search}`,
    search: `?${new URLSearchParams({ productId: id, returnTo: `${target.pathname}${target.search}` })}`,
  };
}
