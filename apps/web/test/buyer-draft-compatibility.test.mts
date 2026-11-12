import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublishedConfig } from '@insignia/domain';
import { draftCompatibility } from '../src/server/buyer/draft-compatibility.ts';

const config: PublishedConfig = {
  version: 'm2-published-config-v1',
  shopId: 'shop',
  productId: '111',
  revisionId: 'r1',
  revisionContentHash: 'a'.repeat(64),
  shopCurrency: 'EUR',
  methods: [{ id: 'print' }],
  placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
  productionOptions: [],
  pricingRules: [],
};
const draft = {
  productId: '111',
  configRevisionId: 'r1',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      {
        placementId: 'front',
        methodId: 'print',
        stepId: 'small',
        artwork: { kind: 'deferred' as const, intentId: 'later' },
      },
    ],
    options: [],
  },
  variants: [],
};

test('a draft without quantities is as restorable as one with them (#366)', () => {
  assert.equal(draftCompatibility('shop', draft, config), 'current');
  assert.equal(draftCompatibility('shop', { ...draft, variants: [{ variantId: '222', quantity: 2 }] }, config), 'current');
  assert.equal(
    draftCompatibility('shop', draft, { ...config, revisionId: 'r2', revisionContentHash: 'b'.repeat(64) }),
    'publication-changed',
  );
  assert.equal(
    draftCompatibility('shop', draft, { ...config, placements: [{ ...config.placements[0]!, allowedStepIds: ['large'] }] }),
    'choice-unavailable',
  );
  assert.equal(draftCompatibility('shop', draft, null), 'configuration-unavailable');
});
