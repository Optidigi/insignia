import { z } from 'zod';

export type ThemeTaskStatus = 'active' | 'available' | 'unavailable' | 'unknown';
export type ThemeSetupStatus = { button: ThemeTaskStatus; cart: ThemeTaskStatus };
export const unknownThemeSetup = (): ThemeSetupStatus => ({ button: 'unknown', cart: 'unknown' });
/** The single definition of "the theme is connected", shared by Home and the storefront setup page. */
export const themeConnected = (status: ThemeSetupStatus) => status.button === 'active' && status.cart === 'active';

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
  if (!result.success) return unknownThemeSetup();
  const records = result.data
    .filter((extension) => extension.type === 'theme_app_extension')
    .flatMap((extension) => extension.activations);
  function status(handle: string, target: 'section' | 'body'): ThemeTaskStatus {
    const matches = records.filter(
      (record) => record !== null && typeof record === 'object' && 'handle' in record && record.handle === handle,
    );
    // Ambiguous, missing or invalid records must never produce a positive status or an Add link.
    if (matches.length !== 1) return 'unknown';
    const parsed = themeBlock.safeParse(matches[0]);
    if (!parsed.success || parsed.data.target !== target) return 'unknown';
    const block = parsed.data;
    if (
      (block.status === 'active' && block.activations.length === 0) ||
      (block.status === 'available' && block.activations.length > 0)
    )
      return 'unknown';
    return block.status;
  }
  // The existing body embed now owns both automatic placement and cart repair.
  // A manual section block is an optional placement override, not a setup prerequisite.
  const storefront = status('cart-repair', 'body');
  return { button: storefront, cart: storefront };
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
    cartEditor: `${editor}?context=apps&template=product`,
    button: `${editor}?${new URLSearchParams({ context: 'apps', template: 'product', activateAppId: `${apiKey}/cart-repair` })}`,
    cart: `${editor}?${new URLSearchParams({ context: 'apps', template: 'product', activateAppId: `${apiKey}/cart-repair` })}`,
  };
}
