import { describe, expect, it } from 'vitest';
import { type CatalogVariantContextSnapshot, resolveFreshCatalogContext } from '../src/pricing/catalog-context.js';

const input = {
  shopId: 'shop-uuid',
  installationGeneration: '3',
  productId: 'product-1',
  variantIds: ['variant-a', 'variant-b'],
  context: { country: 'NL' },
};
const price = (variantId: string): CatalogVariantContextSnapshot => ({
  shopId: input.shopId,
  installationGeneration: input.installationGeneration,
  productId: input.productId,
  variantId,
  productIdVerified: true,
  context: input.context,
  amount: '20.000000000000001',
  currencyCode: 'USD',
  sourceApiVersion: '2026-07',
  observedAt: '2026-09-29T12:00:00.000Z',
  freshUntil: '2026-09-29T12:05:00.000Z',
  correlation: { requestId: 'safe_1' },
});
const at = new Date('2026-09-29T12:01:00.000Z');

describe('quote catalog-context eligibility', () => {
  it('preserves exact decimal text and requested variant order', async () => {
    const result = await resolveFreshCatalogContext(
      { resolveVariantContext: async () => [price('variant-b'), price('variant-a')] },
      input,
      () => at,
    );
    expect(result.map((x) => x.variantId)).toEqual(['variant-a', 'variant-b']);
    expect(result[0]?.amount).toBe('20.000000000000001');
  });
  it('rejects missing, cross-installation and stale snapshots', async () => {
    await expect(
      resolveFreshCatalogContext({ resolveVariantContext: async () => [price('variant-a')] }, input, () => at),
    ).rejects.toMatchObject({ reason: 'missing' });
    await expect(
      resolveFreshCatalogContext(
        {
          resolveVariantContext: async () => [
            price('variant-a'),
            { ...price('variant-b'), installationGeneration: '2' },
          ],
        },
        input,
        () => at,
      ),
    ).rejects.toMatchObject({ reason: 'wrong_identity' });
    await expect(
      resolveFreshCatalogContext(
        { resolveVariantContext: async () => [price('variant-a'), price('variant-b')] },
        input,
        () => new Date('2026-09-29T12:05:00.000Z'),
      ),
    ).rejects.toMatchObject({ reason: 'stale' });
  });
});
