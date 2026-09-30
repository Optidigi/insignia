import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewGrantCache } from '../../src/server/admin/preview-grant.ts';

const identity = { shop: 'synthetic.myshopify.com', staffId: '1', sessionId: 'synthetic-session', expiresAtMs: 60_000 };
const grant = {
  ...identity,
  expiresAtMs: 600_000,
  accessToken: 'synthetic',
  appScopes: ['write_products'],
  userScopes: ['write_products'],
};
test('preview same-token single flight; replacement and current-installation invalidation exchange fresh', async () => {
  let count = 0;
  const cache = createPreviewGrantCache(
    async () => {
      count++;
      return grant;
    },
    () => 0,
  );
  await Promise.all(Array.from({ length: 10 }, () => cache.acquire('synthetic-one', identity)));
  assert.equal(count, 1);
  await cache.acquire('synthetic-two', identity);
  assert.equal(count, 2);
  cache.clear();
  await cache.acquire('synthetic-two', identity);
  assert.equal(count, 3);
  await cache.acquire('synthetic-two', { ...identity, staffId: '2' }).then(
    () => assert.fail(),
    () => {},
  );
});
test('preview rejected exchange is not cached and expired or long-lived identity is denied', async () => {
  let time = 0,
    count = 0;
  const cache = createPreviewGrantCache(
    async () => {
      count++;
      throw new Error('synthetic denial');
    },
    () => time,
  );
  for (let i = 0; i < 2; i++) await assert.rejects(cache.acquire('synthetic', identity));
  assert.equal(count, 2);
  time = 60_000;
  await assert.rejects(cache.acquire('synthetic', identity), /lease/);
  assert.equal(count, 2);
  time = 0;
  await assert.rejects(cache.acquire('synthetic', { ...identity, expiresAtMs: 3600_000 }), /lease/);
});
