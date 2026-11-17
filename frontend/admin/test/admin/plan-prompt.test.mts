import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimPlanSelectionPrompt, planSelectionTarget } from '../../src/shared/plan-prompt.ts';

const pricing = 'https://admin.shopify.com/store/example/charges/insignia-1/pricing_plans';

test('only a definitive no-plan observation names Shopify plan selection', () => {
  assert.equal(planSelectionTarget({ status: 'inactive', managementUrl: pricing }), pricing);
  for (const status of ['unavailable', 'trial', 'active', undefined])
    assert.equal(planSelectionTarget({ status, managementUrl: pricing }), null, `status ${status}`);
  for (const view of [null, undefined, 'inactive', {}, { newActionsAllowed: false }])
    assert.equal(planSelectionTarget(view), null);
});

test('plan selection is only Shopify managed pricing', () => {
  assert.equal(planSelectionTarget({ status: 'inactive', managementUrl: null }), null);
  for (const managementUrl of [
    'https://evil.example/store/example/charges/insignia-1/pricing_plans',
    'http://admin.shopify.com/store/example/charges/insignia-1/pricing_plans',
    'https://admin.shopify.com/store/example/settings',
    'javascript:alert(1)',
  ])
    assert.equal(planSelectionTarget({ status: 'inactive', managementUrl }), null, managementUrl);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test('the automatic prompt is claimed at most once per browser session', () => {
  const storage = memoryStorage();
  assert.equal(
    claimPlanSelectionPrompt(() => storage),
    true,
  );
  assert.equal(
    claimPlanSelectionPrompt(() => storage),
    false,
  );
  assert.equal(
    claimPlanSelectionPrompt(() => storage),
    false,
  );
});

test('without usable session storage there is no automatic prompt, so a returning merchant is never looped', () => {
  assert.equal(
    claimPlanSelectionPrompt(() => {
      throw new DOMException('blocked', 'SecurityError');
    }),
    false,
  );
  assert.equal(
    claimPlanSelectionPrompt(() => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    })),
    false,
  );
  // A storage that silently drops writes cannot remember the prompt either.
  assert.equal(
    claimPlanSelectionPrompt(() => ({ getItem: () => null, setItem: () => {} })),
    false,
  );
});
