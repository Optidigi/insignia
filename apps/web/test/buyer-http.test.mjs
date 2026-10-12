import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleBuyerRequest } from '../src/server/buyer/http.ts';

const post = (body, path = '/v1/quote-proposals') =>
  new Request(`https://app.invalid${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('buyer authority has no fallback when production composition is absent', async () => {
  const result = await handleBuyerRequest(post({}), undefined, 'quote-proposals');
  assert.equal(result.status, 503);
  const error = await result.json();
  assert.equal(error.code, 'UNAVAILABLE');
  assert.ok(error.requestId);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
});
test('buyer rejects oversized bodies before authentication and never copies an unlimited stream', async () => {
  let verified = 0;
  const result = await handleBuyerRequest(
    post({ capability: 'x', padding: 'x'.repeat(130000) }),
    {
      guest: {
        verify: async () => {
          verified++;
          return null;
        },
      },
    },
    'quote-proposals',
  );
  assert.equal(result.status, 400);
  assert.equal(verified, 0);
});
test('buyer refuses unsigned tenant fields and capability-less private requests', async () => {
  const services = { guest: { verify: async () => null } };
  assert.equal((await handleBuyerRequest(post({ shopId: 'attacker' }), services, 'quote-proposals')).status, 401);
});
