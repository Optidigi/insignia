import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLocalDiagnostic } from '../dist/diagnostic.js';

test('diagnostic decodes and derives synthetic pixels without claiming durable readiness', async () => {
  const result = await runLocalDiagnostic();
  assert.deepEqual(result.source, { width: 4, height: 4, format: 'png' });
  assert.deepEqual(result.derivative, { width: 2, height: 2, format: 'png' });
  assert.equal(result.durableReady, false);
  assert.equal(result.sha256, 'a84cffc1eb292fe6e5600974e5cdd47fb35dbecf8650ccfae7a1560573b252d4');
});
