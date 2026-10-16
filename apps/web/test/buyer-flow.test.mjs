import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPublicationRepository } from '../../../packages/database/dist/repositories/publication.js';
import { fixture } from './support/buyer-fixture.mjs';

const connectionString = process.env.DATABASE_URL;

test('durable admission rejects saturated commands before signing and completed replay retains its application', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const rate = (count) =>
    f.pool.query('UPDATE buyer_sessions SET write_count=$2 WHERE session_id=$1', [f.session.sessionId, count]);
  await rate(60);
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 429);
  assert.equal(f.signings(), 0);
  assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
  f.unavailable(true);
  assert.equal((await f.http('quote-proposals', f.body)).status, 429);
  f.unavailable(false);
  await rate(0);
  const result = await (await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).json();
  assert.equal(f.signings(), 1);
  await rate(60);
  const replay = await (await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).json();
  assert.equal(replay.setId, result.setId);
  assert.equal(replay.applicationId, result.applicationId);
  assert.equal(
    (await f.http(`quotes/${result.quoteId}/renew`, { ...f.body, idempotencyKey: randomUUID() })).status,
    429,
  );
  assert.equal(f.signings(), 1);
  await rate(0);
  for (let i = 0; i < 63; i++) {
    if (i === 50) f.advance(61000);
    await f.core.buyers.reserveCommand(f.scope, {
      kind: 'renew',
      key: randomUUID(),
      requestDigest: 'a'.repeat(64),
      now: f.now(),
    });
  }
  assert.equal(
    (await f.http(`quotes/${result.quoteId}/renew`, { ...f.body, idempotencyKey: randomUUID() })).status,
    429,
  );
  assert.equal(f.signings(), 1);
  assert.equal(
    (await f.pool.query('SELECT 1 FROM quote_authorization_renewals WHERE shop_id=$1', [f.shopId])).rowCount,
    0,
  );
  assert.equal((await f.pool.query('SELECT 1 FROM cart_applications WHERE shop_id=$1', [f.shopId])).rowCount, 1);
});

test('unavailable variants deny new proposals, serialized acceptance and renewal while preserving an owned completed offer', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  f.availability(false);
  assert.equal((await f.http('quote-proposals', f.body)).status, 409);
  assert.equal(f.signings(), 0);
  f.availability(true);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  let reads = 0;
  f.availability(() => ++reads < 2);
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 409);
  assert.equal(f.signings(), 0);
  assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
  f.availability(true);
  const result = await (await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).json();
  assert.equal(f.signings(), 1);
  f.availability(false);
  const replay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).setId, result.setId);
  assert.equal(
    (await f.http(`quotes/${result.quoteId}/renew`, { ...f.body, idempotencyKey: randomUUID() })).status,
    409,
  );
  assert.equal(f.signings(), 1);
});

test('buyer HTTP qualifies real durable proposal, acceptance replay, owned restore, renewal and confirmation', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const response = await f.http('quote-proposals', f.body);
  assert.equal(response.status, 200, await response.clone().text());
  const proposal = await response.json();
  assert.equal(proposal.totalMinor, '2200');
  assert.equal(f.signings(), 0);
  const acceptBody = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const acceptedResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(acceptedResponse.status, 200, await acceptedResponse.clone().text());
  const accepted = await acceptedResponse.json();
  assert.equal(f.signings(), 1);
  const repeated = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(repeated.status, 200, await repeated.clone().text());
  const replay = await repeated.json();
  assert.equal(replay.quoteId, accepted.quoteId);
  assert.equal(replay.setId, accepted.setId);
  assert.deepEqual(replay.buckets, accepted.buckets);
  assert.equal(f.signings(), 1);
  f.amount('11.00');
  const changedReplay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(changedReplay.status, 200, await changedReplay.clone().text());
  assert.deepEqual((await changedReplay.json()).buckets, accepted.buckets);
  assert.equal(f.signings(), 1);
  f.amount('10.00');
  const lines = accepted.buckets.map((bucket, index) => ({ ...bucket, key: `key${index}`, sellingPlan: null }));
  const restoredResponse = await f.http('cart-state', { capability: f.session.capability, lines });
  assert.equal(restoredResponse.status, 200, await restoredResponse.clone().text());
  const restored = await restoredResponse.json();
  assert.deepEqual(restored.groups, [f.group]);
  assert.equal(restored.quoteId, accepted.quoteId);
  const paid = await f.http('cart-state', {
    capability: f.session.capability,
    lines: lines.map((line) => ({ ...line, sellingPlan: '99' })),
  });
  assert.equal(paid.status, 409);
  assert.equal(f.signings(), 1);
  const confirm = await f.http(`cart-applications/${accepted.applicationId}/confirm`, {
    capability: f.session.capability,
    fingerprint: 'observed-current-cart',
    vector: accepted.buckets,
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).status, 'APPLIED');
  const original = (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE quote_id=$1', [accepted.quoteId]))
    .rows[0];
  f.advance(86400000);
  const renewalKey = randomUUID();
  const renewedResponse = await f.http(`quotes/${accepted.quoteId}/renew`, { ...f.body, idempotencyKey: renewalKey });
  assert.equal(renewedResponse.status, 200, await renewedResponse.clone().text());
  const renewed = await renewedResponse.json();
  assert.equal(renewed.quoteId, accepted.quoteId);
  assert.notEqual(renewed.setId, accepted.setId);
  assert.equal(renewed.validThroughDay, accepted.validThroughDay + 1);
  assert.equal(f.signings(), 2);
  const renewalReplay = await f.http(`quotes/${accepted.quoteId}/renew`, { ...f.body, idempotencyKey: renewalKey });
  assert.equal(renewalReplay.status, 200);
  assert.equal((await renewalReplay.json()).setId, renewed.setId);
  assert.equal(f.signings(), 2);
  assert.deepEqual(
    (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE quote_id=$1', [accepted.quoteId])).rows[0],
    original,
  );
});

test('changed authoritative price requires review before signing or immutable acceptance', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  f.amount('11.00');
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'REVIEW_REQUIRED');
  assert.equal(f.signings(), 0);
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    0,
  );
});

test('HTTP rejects forged capability, tenant injection, oversize and foreign draft CAS; raw design retention follows asset deadline', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  assert.equal((await f.http('quote-proposals', { ...f.body, capability: 'forged.token' })).status, 401);
  assert.equal((await f.http('quote-proposals', { ...f.body, shopId: randomUUID() })).status, 400);
  assert.equal((await f.http('quote-proposals', 'x'.repeat(128001))).status, 400);
  const designId = randomUUID();
  const body = { capability: f.session.capability, expectedVersion: 0, group: f.group };
  const saved = await f.http(`designs/${designId}`, body, 'PUT');
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await saved.json()).version, 1);
  assert.equal((await f.http(`designs/${designId}`, body, 'PUT')).status, 409);
  const another = await (await f.http('sessions', {})).json();
  assert.equal(
    (await f.http(`designs/${designId}`, { ...body, capability: another.capability, expectedVersion: 1 }, 'PUT'))
      .status,
    409,
  );
  const stored = (await f.pool.query('SELECT expires_at FROM design_drafts WHERE design_id=$1', [designId])).rows[0];
  assert.equal(+stored.expires_at, +f.deadline);
  f.advance(4 * 86400000);
  await f.core.buyers.cleanupExpired(f.now());
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM design_drafts WHERE design_id=$1', [designId])).rows[0].n,
    0,
  );
});

test('completed acceptance replay does not require another catalog observation', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const firstResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  f.unavailable(true);
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(response.status, 200, await response.clone().text());
  const replay = await response.json();
  assert.equal(replay.quoteId, first.quoteId);
  assert.equal(replay.setId, first.setId);
  assert.deepEqual(replay.buckets, first.buckets);
  assert.equal(f.signings(), 1);
});
test('concurrent acceptance is one immutable quote/set and expired review permits only owned completed replay', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const responses = await Promise.all([
    f.http(`quote-proposals/${proposal.proposalId}/accept`, body),
    f.http(`quote-proposals/${proposal.proposalId}/accept`, body),
  ]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const [first, second] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(first.quoteId, second.quoteId);
  assert.equal(first.setId, second.setId);
  assert.equal(f.signings(), 1);
  f.advance(300001);
  f.unavailable(true);
  const replay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).setId, first.setId);
  f.unavailable(false);
  const unreviewed = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    ...body,
    idempotencyKey: randomUUID(),
  });
  assert.equal(unreviewed.status, 409);
  assert.equal(f.signings(), 1);
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    1,
  );
  const owner2 = await (await f.http('sessions', {})).json();
  const lines = first.buckets.map((b, index) => ({ ...b, key: `line${index}`, sellingPlan: null }));
  assert.equal((await f.http('cart-state', { capability: owner2.capability, lines })).status, 409);
  const ownedRestore = await f.http('cart-state', { capability: f.session.capability, lines });
  assert.equal(ownedRestore.status, 200);
  assert.deepEqual((await ownedRestore.json()).groups, [f.group]);
  await f.pool.query('UPDATE installation_generations SET deactivated_at=$2 WHERE shop_id=$1 AND generation=1', [
    f.shopId,
    new Date(Date.now() + 1000),
  ]);
  assert.equal((await f.http('cart-state', { capability: f.session.capability, lines })).status, 401);
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 401);
});

test('owned cart design restores from immutable historical revision after current publication changes', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(response.status, 200);
  const accepted = await response.json();
  const revisionId = randomUUID(),
    operationId = randomUUID();
  await f.repo.createRevision({
    shopId: f.shopId,
    configId: f.configId,
    revisionId,
    schemaVersion: 'm2-published-config-v1',
    publishedValue: {
      version: 'm2-published-config-v1',
      shopId: f.shopId,
      productId: f.productId,
      revisionId,
      shopCurrency: 'EUR',
      methods: [{ id: 'embroider' }],
      placements: [
        { id: 'front', allowedMethodIds: ['embroider'], allowedStepIds: ['large'], logoLaterAllowed: false },
      ],
      productionOptions: [],
      pricingRules: [],
    },
  });
  await f.db.transaction().execute((tx) =>
    createPublicationRepository(tx).request({
      shopId: f.shopId,
      configId: f.configId,
      operationId,
      revisionId,
      installationGeneration: '1',
      expectedProjection: { synthetic: 'new' },
    }),
  );
  await f.db
    .transaction()
    .execute((tx) => createPublicationRepository(tx).acknowledge(f.shopId, f.configId, operationId));
  await f.db.transaction().execute((tx) =>
    createPublicationRepository(tx).observe({
      shopId: f.shopId,
      configId: f.configId,
      operationId,
      projection: { synthetic: 'new' },
    }),
  );
  await f.db.transaction().execute((tx) => createPublicationRepository(tx).activate(f.shopId, f.configId, operationId));
  const restored = await f.http('cart-state', {
    capability: f.session.capability,
    lines: accepted.buckets.map((bucket, index) => ({ ...bucket, key: `line${index}`, sellingPlan: null })),
  });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.deepEqual((await restored.json()).groups, [f.group]);
  assert.equal(f.signings(), 1);
});

test('Lean HTTP and PostgreSQL retain non-metered unit-price offers and replay without duplicate signing', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  f.qualification(false);
  assert.notEqual((await f.http('quote-proposals', f.body)).status, 200);
  assert.equal(f.signings(), 0);
  f.qualification(true);
  const response = await f.http('quote-proposals', f.body);
  assert.equal(response.status, 200, await response.clone().text());
  const proposal = await response.json();
  assert.equal(proposal.totalMinor, '2200');
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const acceptedResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(acceptedResponse.status, 200, await acceptedResponse.clone().text());
  const accepted = await acceptedResponse.json();
  const facts = await f.pool.query('SELECT qualifying_usage_disposition FROM accepted_quotes WHERE shop_id=$1', [
    f.shopId,
  ]);
  assert.deepEqual(facts.rows, [{ qualifying_usage_disposition: 'NOT_METERED' }]);
  const repeated = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(repeated.status, 200, await repeated.clone().text());
  assert.equal((await repeated.json()).quoteId, accepted.quoteId);
  assert.equal(f.signings(), 1);
});
