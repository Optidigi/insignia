import type { ConfigView } from '../../../src/shared/admin-view.js';
import type { EditorDraft } from './editor-commands.mts';

const id = 'gid://shopify/Product/111';
const variant = 'gid://shopify/ProductVariant/11';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const rect = { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 };

export function draft(): EditorDraft {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [
      { id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small', 'large'], logoLaterAllowed: true },
    ],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_111', width: 1, height: 1 },
          variantImages: [{ variantId: 'variant_11', image: { revisionId: 'variant_11', width: 1, height: 1 } }],
          placements: [
            {
              id: 'front',
              rect,
              variantOverrides: [
                { variantId: 'variant_11', rect: { ...rect, centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
        {
          id: 'back-view',
          image: { revisionId: 'product_111', width: 1, height: 1 },
          variantImages: [],
          placements: [{ id: 'front', rect: { ...rect, centerY: 0.6 } }],
        },
      ],
      steps: [
        { id: 'small', widthFraction: 0.5, heightFraction: 0.5 },
        { id: 'large', widthFraction: 0.8, heightFraction: 0.8 },
      ],
    },
  };
}
export function response(
  config: EditorDraft,
): Omit<ConfigView, 'config'> & { config: NonNullable<ConfigView['config']> & { draft: EditorDraft } } {
  return {
    product: {
      id,
      title: 'Synthetic shirt',
      status: 'ACTIVE',
      imageUrl: png,
      variants: [{ id: variant, title: 'Blue', imageUrl: png, selectedOptions: [] }],
    },
    config: {
      configId: 'config-1',
      installationGeneration: '1',
      draftVersion: '1',
      draft: config,
      currentShopCurrency: 'USD',
      publication: {
        state: 'DRAFT',
        revisionId: null,
        sourceDraftVersion: null,
        requestKey: null,
        activeRevisionId: null,
        reason: null,
        requiresAllChannelHold: null,
        functionReadiness: null,
      },
      publishEligibility: { allowed: false, reason: 'Synthetic policy unavailable' },
    },
  };
}
