import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixture } from './support/buyer-fixture.mts';

test('owned design restoration preserves the original deadline and rejects foreign UUID, extra authority and expiry', {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.services.design(f.scope, id, { expectedVersion: 0, group: f.group });
  const saved = await f.core.buyers.getDesign(f.scope, id, f.now());
  assert(saved);
  const response = await f.http(`designs/${id}/restore`, { capability: f.session.capability });
  assert.equal(response.status, 200, await response.clone().text());
  const restored = await response.json();
  assert.equal(restored.id, id);
  assert.deepEqual(restored.value, f.group);
  assert.equal(restored.expiresAt, saved.expiresAt.toISOString());
  assert.equal(restored.compatibility, 'legacy');
  assert.equal(restored.retained, null);
  assert.equal((await f.http(`designs/${randomUUID()}/restore`, { capability: f.session.capability })).status, 404);
  assert.equal(
    (await f.http(`designs/${id}/restore`, { capability: f.session.capability, shopId: 'foreign' })).status,
    400,
  );
  const foreign = await (await f.http('sessions', {})).json();
  assert.equal((await f.http(`designs/${id}/restore`, { capability: foreign.capability })).status, 404);
  f.advance(+saved.expiresAt - +f.now() + 1);
  assert([401, 404].includes((await f.http(`designs/${id}/restore`, { capability: f.session.capability })).status));
});

test('a draft saved before quantities is stored and restored with its artwork and placement (#366)', {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  const draft = { ...f.group, variants: [] };
  const saved = await f.http(`designs/${id}`, { capability: f.session.capability, expectedVersion: 0, group: draft }, 'PUT');
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual((await saved.json()).value, draft);
  // Later edits save to the same draft: an update, never another draft.
  const edited = { ...f.group, variants: [{ variantId: '222', quantity: 4 }] };
  for (const [version, group] of [
    [1, edited],
    [2, draft],
  ] as const) {
    const response = await f.http(`designs/${id}`, { capability: f.session.capability, expectedVersion: version, group }, 'PUT');
    assert.equal(response.status, 200, await response.clone().text());
  }
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM design_drafts WHERE session_id=$1', [f.session.sessionId])).rows[0].n,
    1,
  );
  const response = await f.http(`designs/${id}/restore`, { capability: f.session.capability });
  assert.equal(response.status, 200, await response.clone().text());
  const restored = await response.json();
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.value, draft);
  // Quotes still need a size or colour with a quantity.
  assert.equal((await f.http('quote-proposals', { ...f.body, groups: [draft] })).status, 400);
});
