import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fenceGuardedFetch, runSigningFence } from '../src/server/buyer/signing-fence.ts';

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
