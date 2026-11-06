import { describe, expect, it } from 'vitest';
import {
  type CustomerArtworkGrant,
  type CustomerArtworkStore,
  createCustomerArtworkLinks,
} from './customer-artwork.js';

const merchant = { kind: 'merchant' as const, shopId: 'shop-one', installationGeneration: '1' };
const purchaseId = '4ae66163-79b4-48fa-a8c6-f84b22c30f01';
const requestId = '4ae66163-79b4-48fa-a8c6-f84b22c30f02';
function fixture() {
  const grants = new Map<string, CustomerArtworkGrant>();
  const store: CustomerArtworkStore = {
    async epoch() {
      return '4ae66163-79b4-48fa-a8c6-f84b22c30f03';
    },
    async issue(scope, input) {
      const existing = [...grants.values()].find(
        (grant) => grant.requestId === input.requestId && grant.purpose === input.purpose,
      );
      if (existing) return existing;
      const grant: CustomerArtworkGrant = {
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        purchaseId: input.purchaseId,
        capabilityHash: input.capabilityHash,
        requestId: input.requestId,
        purpose: input.purpose,
        expiresAt: '2026-11-06T12:00:00.000Z',
        artworkVersion: 0,
        slots: [
          {
            groupIndex: 0,
            placementId: 'front',
            productId: '11',
            revisionId: purchaseId,
            methodId: 'print',
            stepId: 'small',
          },
        ],
      };
      grants.set(grant.capabilityHash, grant);
      return grant;
    },
    async resolve(hash) {
      return grants.get(hash) ?? null;
    },
    async attach(hash, input) {
      const grant = grants.get(hash);
      if (!grant || grant.slots.length === 0 || input.placementId !== 'front')
        throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
      const next = { ...grant, artworkVersion: 1, slots: [] };
      grants.set(hash, next);
      return next;
    },
    async revoke() {},
  };
  return {
    store,
    grants,
    links: createCustomerArtworkLinks({
      store,
      secret: 'test-only-customer-link-secret-at-least-32',
      appOrigin: 'https://insignia.test',
      clock: () => new Date('2026-11-05T12:00:00Z'),
    }),
  };
}
describe('customer missing-artwork link authority', () => {
  it('replays one merchant request without storing a bearer capability or extending expiry', async () => {
    const { links, grants } = fixture();
    const first = await links.issue(merchant, { purchaseId, requestId });
    const second = await links.issue(merchant, { purchaseId, requestId });
    expect(second).toEqual(first);
    expect(first.url).toMatch(/^https:\/\/insignia.test\/artwork-upload#capability=[a-f0-9]{64}$/);
    expect(first.url).not.toContain('purchaseId=');
    const token = first.url.split('capability=')[1]!;
    expect(JSON.stringify([...grants.values()])).not.toContain(token);
    expect((await links.resolve(token)).purchaseId).toBe(purchaseId);
  });
  it('rejects missing/forged capability and does not confuse different tenant or request identities', async () => {
    const { links } = fixture();
    const first = await links.issue(merchant, { purchaseId, requestId });
    const other = await links.issue({ ...merchant, shopId: 'shop-two' }, { purchaseId, requestId: purchaseId });
    expect(first.url).not.toBe(other.url);
    await expect(links.resolve('a'.repeat(64))).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
    await expect(links.resolve('')).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
  });
  it('fills a missing slot only once and never exposes the stored capability hash to customer view', async () => {
    const { links } = fixture();
    const issued = await links.issue(merchant, { purchaseId, requestId });
    const token = issued.url.split('capability=')[1]!;
    const view = await links.resolve(token);
    expect(view).not.toHaveProperty('capabilityHash');
    expect(view).not.toHaveProperty('shopId');
    const input = { groupIndex: 0, placementId: 'front', expectedVersion: 0, assetId: requestId, requestId };
    expect((await links.attach(token, input)).slots).toEqual([]);
    await expect(links.attach(token, { ...input, assetId: purchaseId, requestId: purchaseId })).rejects.toThrow();
  });
});
