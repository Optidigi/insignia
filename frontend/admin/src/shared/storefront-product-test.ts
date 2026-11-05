import { z } from 'zod';

const productId = z.string().regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/);
const product = z.object({
  id: productId,
  title: z.string().trim().min(1).max(500),
  handle: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*$/u),
  templateSuffix: z
    .union([z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/), z.literal('').transform(() => null)])
    .nullable(),
});

export type StorefrontTestProduct = z.infer<typeof product>;
export type StorefrontTestSelection =
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'selected'; product: StorefrontTestProduct };

/** Carry an editor product to the existing test task without guessing its public handle. */
export function storefrontProductTestSetupHref(input: unknown): string | null {
  const parsed = productId.safeParse(input);
  if (!parsed.success) return null;
  const numericId = parsed.data.slice('gid://shopify/Product/'.length);
  return `/admin/settings/storefront?${new URLSearchParams({ testProduct: numericId })}#test-product`;
}

/** This identity only preselects the native picker. It cannot establish a public URL or eligibility. */
export function requestedStorefrontTestProductId(search: string): string | null {
  const params = new URLSearchParams(search);
  const values = params.getAll('testProduct');
  if (values.length !== 1 || !/^[1-9][0-9]{0,19}$/.test(values[0] ?? '')) return null;
  return `gid://shopify/Product/${values[0]}`;
}

/** Native cancellation is undefined; an empty or ambiguous payload is not a selection. */
export function parseStorefrontTestSelection(input: unknown): StorefrontTestSelection {
  if (input === undefined) return { kind: 'cancelled' };
  const parsed = z.array(product).length(1).safeParse(input);
  const selected = parsed.success ? parsed.data[0] : undefined;
  return selected ? { kind: 'selected', product: selected } : { kind: 'invalid' };
}

/** Product context observed in Shopify's View template link; no proposed theme changes. */
export function storefrontProductTestHref(editor: unknown, selected: unknown): string | null {
  const parsed = product.safeParse(selected);
  if (typeof editor !== 'string' || !parsed.success) return null;
  try {
    const url = new URL(editor);
    if (
      url.protocol !== 'https:' ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/admin/themes/current/editor'
    )
      return null;
    url.search = '';
    url.hash = '';
    url.searchParams.set(
      'previewPath',
      `/products/${encodeURIComponent(parsed.data.handle)}?view=${parsed.data.templateSuffix || '__DEFAULT__'}`,
    );
    return url.href;
  } catch {
    return null;
  }
}

export type StorefrontProductTestEligibility = 'published' | 'unpublished' | 'invalid';
const configuration = z.object({
  product: z.object({ id: productId }),
  config: z
    .object({
      publication: z.object({
        activeRevisionId: z
          .string()
          .min(1)
          .max(128)
          .regex(/^\S+$/)
          .refine((value) =>
            Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
          )
          .nullable(),
      }),
    })
    .nullable(),
});

/** Effective publication survives newer pending or failed requests; requested state alone is insufficient. */
export function storefrontProductTestEligibility(
  input: unknown,
  selectedProductId: string,
): StorefrontProductTestEligibility {
  const parsed = configuration.safeParse(input);
  if (
    !productId.safeParse(selectedProductId).success ||
    !parsed.success ||
    parsed.data.product.id !== selectedProductId
  )
    return 'invalid';
  return parsed.data.config?.publication.activeRevisionId ? 'published' : 'unpublished';
}
