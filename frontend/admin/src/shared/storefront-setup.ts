import { z } from 'zod';

/** Status of the one storefront app embed, which owns both automatic Customize button placement and cart review. */
export type ThemeSetupStatus = 'active' | 'available' | 'unavailable' | 'unknown';
/** The single definition of "the theme is connected" for Home's setup card and getting-started steps. */
export const themeConnected = (status: ThemeSetupStatus) => status === 'active';

const extensionList = z.array(z.object({ type: z.string(), activations: z.array(z.unknown()) }));
const themeBlock = z.object({
  handle: z.string(),
  target: z.enum(['section', 'head', 'body', 'compliance_head']),
  status: z.enum(['active', 'available', 'unavailable']),
  activations: z.array(
    z.object({
      target: z.string().min(1),
      themeId: z.string().regex(/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/),
    }),
  ),
});

/** App Bridge reports published-theme placements, never draft-theme or journey completion. */
export function themeSetupStatus(input: unknown): ThemeSetupStatus {
  const result = extensionList.safeParse(input);
  if (!result.success) return 'unknown';
  const records = result.data
    .filter((extension) => extension.type === 'theme_app_extension')
    .flatMap((extension) => extension.activations);
  // The existing body embed owns both automatic placement and cart repair.
  // A manual section block is an optional placement override, not a setup prerequisite.
  const matches = records.filter(
    (record) => record !== null && typeof record === 'object' && 'handle' in record && record.handle === 'cart-repair',
  );
  // Ambiguous, missing or invalid records must never produce a positive status or an Enable link.
  if (matches.length !== 1) return 'unknown';
  const parsed = themeBlock.safeParse(matches[0]);
  if (!parsed.success || parsed.data.target !== 'body') return 'unknown';
  const block = parsed.data;
  if (
    (block.status === 'active' && block.activations.length === 0) ||
    (block.status === 'available' && block.activations.length > 0)
  )
    return 'unknown';
  return block.status;
}

export function storefrontLinks(shop: unknown, apiKey: unknown) {
  if (
    typeof shop !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    typeof apiKey !== 'string' ||
    !/^[a-f0-9]{32}$/.test(apiKey)
  )
    return null;
  const editor = `https://${shop}/admin/themes/current/editor`;
  return {
    editor: `${editor}?template=product`,
    // Shopify's app block deep link: proposes the optional customization block (blocks/customize.liquid) in the
    // product page's main section; the merchant positions and saves it in the theme editor.
    productBlock: `${editor}?${new URLSearchParams({ template: 'product', addAppBlockId: `${apiKey}/customize`, target: 'mainSection' })}`,
    embeds: `${editor}?context=apps&template=product`,
    // The one "Insignia storefront" app embed (handle cart-repair) owns the Customize button and cart review.
    activate: `${editor}?${new URLSearchParams({ context: 'apps', template: 'product', activateAppId: `${apiKey}/cart-repair` })}`,
  };
}
