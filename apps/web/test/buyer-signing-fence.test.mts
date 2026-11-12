import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fenceGuarded, fenceGuardedFetch, runSigningFence } from '../src/server/buyer/signing-fence.ts';
import { createSubscriptionCache } from '../src/server/buyer/subscription-cache.ts';

test('a provider request started inside a signing fence is refused before dispatch (#390)', async () => {
  let dispatched = 0;
  const guarded = fenceGuardedFetch(async () => {
    dispatched++;
    return new Response('ok');
  });
  // Also after an await inside the fence: the guard follows the async context, not a flag.
  await assert.rejects(
    runSigningFence(async () => {
      await Promise.resolve();
      return guarded('https://buyer.myshopify.com/admin/api/2026-07/graphql.json');
    }),
    /Provider request is not allowed inside the signing fence/,
  );
  assert.equal(dispatched, 0);
  assert.equal(await (await guarded('https://buyer.myshopify.com/admin/api/2026-07/graphql.json')).text(), 'ok');
  assert.equal(dispatched, 1);
});

test('a subscription read inside a signing fence is refused before the shared single-flight cache (#390)', async () => {
  const target = { appId: 'gid://shopify/App/7', shopId: 'gid://shopify/Shop/11' };
  const observedAt = new Date().toISOString();
  let dispatched = 0,
    release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Production shape: the Partner fetch is fence-guarded beneath a per-shop single-flight cache.
  const partnerFetch = fenceGuardedFetch(async () => {
    dispatched++;
    await gate;
    return new Response('{}');
  });
  const cache = createSubscriptionCache(async () => {
    await partnerFetch('https://partners.shopify.com/9/api/2026-07/graphql.json');
    return { observedAt, active: true };
  }, 300000);
  const read = fenceGuarded('Subscription read', cache);
  const refused = /Subscription read is not allowed inside the signing fence/;

  // An in-fence call cannot start the shared read, so a buyer joining it outside is unaffected.
  const inside = runSigningFence(() => read(target));
  const outside = read(target);
  await assert.rejects(inside, refused);
  assert.equal(dispatched, 1);
  // Nor can it join the read already in flight...
  await assert.rejects(
    runSigningFence(() => read(target)),
    refused,
  );
  release();
  assert.equal((await outside).active, true);
  // ...or reuse the cached snapshot.
  await assert.rejects(
    runSigningFence(() => read(target)),
    refused,
  );
  assert.equal((await read(target)).active, true);
  assert.equal(dispatched, 1);
});
