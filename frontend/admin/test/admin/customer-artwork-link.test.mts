import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomerArtworkLinkClient, hasCustomerArtworkSlots } from '../../src/shared/customer-artwork-link.ts';

test('ambiguous issuance and clipboard failure reuse the exact request without minting another grant', async () => {
  const commands: string[] = [];
  let fail = true;
  let copies = 0;
  const client = createCustomerArtworkLinkClient(
    'purchase',
    async (_path, init) => {
      commands.push(String(init.body));
      if (fail) {
        fail = false;
        throw new Error('Lost acknowledgement');
      }
      return {
        purchaseId: 'purchase',
        expiresAt: '2027-01-01T00:00:00Z',
        url: `https://example.com/artwork-upload#capability=${'a'.repeat(64)}`,
      };
    },
    async () => {
      copies++;
      if (copies === 1) throw new Error('Clipboard denied');
    },
    () => 'original-uuid',
  );
  await assert.rejects(client.copy, /acknowledgement/);
  await assert.rejects(client.copy, /Clipboard/);
  await client.copy();
  assert.equal(commands.length, 2);
  assert.equal(commands[0], commands[1]);
  assert.equal(copies, 2);
});
test('only originally missing retained artwork is shareable; payment is irrelevant', () => {
  const purchase = {
    canUploadArtwork: true,
    canShareCustomerArtwork: true,
    lines: [{}],
    artworkState: 'PENDING_ARTWORK',
    cancelledAt: null,
    artworkEvents: [],
    groups: [
      {
        index: 0,
        payloadExpiresAt: '2027-01-01T00:00:00Z',
        placements: [{ id: 'front', originalArtwork: { kind: 'deferred' }, currentAssetId: null, expired: false }],
      },
    ],
  };
  assert.equal(hasCustomerArtworkSlots(purchase, Date.parse('2026-11-05')), true);
  assert.equal(
    hasCustomerArtworkSlots({ ...purchase, canShareCustomerArtwork: false }, Date.parse('2026-11-05')),
    false,
  );
  assert.equal(hasCustomerArtworkSlots({ ...purchase, canUploadArtwork: false }, Date.parse('2026-11-05')), false);
  assert.equal(
    hasCustomerArtworkSlots(
      { ...purchase, artworkEvents: [{ kind: 'ATTACH', groupIndex: 0, placementId: 'front' }] },
      Date.parse('2026-11-05'),
    ),
    false,
  );
  assert.equal(hasCustomerArtworkSlots({ ...purchase, artworkState: 'ERASED' }, Date.parse('2026-11-05')), false);
  assert.equal(hasCustomerArtworkSlots(purchase, Date.parse('2027-02-01')), false);
});
