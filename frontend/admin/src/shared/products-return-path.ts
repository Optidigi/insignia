const productsPath = '/admin/products';
const maxProductCursorLength = 1024;
const maxProductCursorTrail = 40;
const maxReturnPathLength = 2048;
const configurationStates = ['not_configured', 'draft', 'published', 'unavailable'];

export function isProductCursorStack(value: unknown): value is (string | null)[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 1000 &&
    value.every(
      (cursor: unknown, index: number) =>
        (index === 0 && cursor === null) ||
        (typeof cursor === 'string' && cursor.length > 0 && cursor.length <= maxProductCursorLength),
    )
  );
}

export function productCursorTrail(values: string[], cursor: string | null): string[] | null {
  if (
    !cursor ||
    cursor.length > maxProductCursorLength ||
    values.length === 0 ||
    values.length > maxProductCursorTrail ||
    values.some((value) => value.length === 0 || value.length > maxProductCursorLength) ||
    values.at(-1) !== cursor
  )
    return null;
  return values;
}

/** Keep catalog view state without forwarding credentials or another destination. */
export function productsReturnPath(value: string | null): string {
  if (!value || value.length > maxReturnPathLength || (value !== productsPath && !value.startsWith(`${productsPath}?`)))
    return productsPath;
  const input = new URLSearchParams(value.slice(productsPath.length + 1));
  const output = new URLSearchParams();
  const query = input.get('q');
  if (query && query.length <= 100) output.set('q', query);
  const cursor = input.get('cursor');
  if (cursor && cursor.length <= maxProductCursorLength) output.set('cursor', cursor);
  const configuration = input.get('configuration');
  if (configuration && configurationStates.includes(configuration)) output.set('configuration', configuration);
  const trail = productCursorTrail(input.getAll('trail'), cursor);
  if (trail) {
    const withTrail = new URLSearchParams(output);
    for (const value of trail) withTrail.append('trail', value);
    if (`${productsPath}?${withTrail}`.length <= maxReturnPathLength)
      for (const value of trail) output.append('trail', value);
  }
  const result = output.size ? `${productsPath}?${output}` : productsPath;
  return result.length <= maxReturnPathLength ? result : productsPath;
}

export function productConfigHref(productId: string): string {
  const detail = `${productsPath}/${encodeURIComponent(productId)}/config`;
  let returnTo = productsReturnPath(typeof location === 'undefined' ? null : location.pathname + location.search);
  if (returnTo !== productsPath && typeof history !== 'undefined') {
    const state: unknown = history.state;
    const stack =
      state && typeof state === 'object' && 'insigniaProductCursors' in state ? state.insigniaProductCursors : null;
    const query = new URLSearchParams(returnTo.slice(productsPath.length + 1));
    const cursor = query.get('cursor');
    const trail =
      isProductCursorStack(stack) && stack[0] === null && stack.length > 1 && stack.at(-1) === cursor
        ? productCursorTrail(
            stack.slice(1).filter((value): value is string => value !== null),
            cursor,
          )
        : null;
    if (trail) {
      const withTrail = new URLSearchParams(query);
      withTrail.delete('trail');
      for (const value of trail) withTrail.append('trail', value);
      const candidate = `${productsPath}?${withTrail}`;
      if (candidate.length <= maxReturnPathLength) returnTo = productsReturnPath(candidate);
    }
  }
  return returnTo === productsPath ? detail : `${detail}?${new URLSearchParams({ returnTo })}`;
}

/** Product setup can return to this single Settings task, never an arbitrary URL. */
export function productEditorReturnPath(value: string | null): string {
  const storefront = '/admin/settings/storefront';
  if (value === storefront || value === `${storefront}#test-product`) return value;
  if (value?.startsWith(`${storefront}?`) && value.length <= maxReturnPathLength) {
    const url = new URL(value, 'https://insignia.invalid');
    if (url.hash === '#test-product' && Array.from(url.searchParams.keys()).every((key) => key === 'testProduct')) {
      const productId = requestedStorefrontTestProductId(url.search);
      if (productId) return storefrontProductTestSetupHref(productId) ?? productsPath;
    }
  }
  return productsReturnPath(value);
}

import { requestedStorefrontTestProductId, storefrontProductTestSetupHref } from './storefront-product-test.ts';
