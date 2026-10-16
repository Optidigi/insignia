import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerUsageRuntime } from '../dist/usage-runtime.js';

const enabled = {
  INSIGNIA_M9_QUALIFICATION_ENABLED: '1',
  INSIGNIA_M9_TENANT_SHOP_ID: 'tenant',
  INSIGNIA_M9_INSTALLATION_GENERATION: '1',
  INSIGNIA_SHOPIFY_APP_ID: '123',
};
test('Lean flat-plan runtime ignores inherited usage enablement without touching financial or provider ports', () => {
  const touches = [];
  const forbidden = new Proxy(
    {},
    {
      get(_target, key) {
        touches.push(String(key));
        throw new Error('Lean runtime must not access financial/provider ports');
      },
    },
  );
  assert.equal(createWorkerUsageRuntime({ env: enabled, core: forbidden }), undefined);
  assert.deepEqual(touches, []);
});
