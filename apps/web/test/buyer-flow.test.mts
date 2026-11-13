import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeHeaderV3, encodeHeaderV3, HEADER_V3_BYTES, type HeaderV3 } from '@insignia/cart-authorization';
import { BuyerAcceptedCartSchema } from '@insignia/contracts';
import { BUYER_SESSION_POLICY } from '../../../packages/database/dist/repositories/buyer.js';
import { createPublicationRepository } from '../../../packages/database/dist/repositories/publication.js';
import { fixture } from './support/buyer-fixture.mts';

/** Replaces the final character with a different one, so the tamper can never be a no-op. */
function alterLastChar(value: string): string {
  const altered = `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
  assert.notEqual(altered, value);
  return altered;
}

const connectionString = process.env.DATABASE_URL;

test('durable admission rejects saturated commands before signing and completed replay retains its application', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const rate = (count: number) =>
    f.pool.query('UPDATE buyer_sessions SET write_count=$2 WHERE session_id=$1', [f.session.sessionId, count]);
  await rate(60);
  // The per-minute write limit passes within a minute: the plain RATE_LIMITED, with no reason.
  const perMinute = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(perMinute.status, 429);
  assert.equal(perMinute.headers.get('Retry-After'), null);
  assert.deepEqual(
    { ...(await perMinute.json()), requestId: 'request' },
    { code: 'RATE_LIMITED', message: 'Customization request could not be completed.', requestId: 'request' },
  );
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
  // Pending reservations fill the rest of the session's cart-application slots (#371).
  const slots = BUYER_SESSION_POLICY.sessionCartApplications;
  for (let i = 1; i < slots; i++) {
    if (i % 50 === 0) f.advance(61000);
    await f.core.buyers.reserveCommand(f.scope, {
      kind: 'renew',
      key: randomUUID(),
      requestDigest: 'a'.repeat(64),
      now: f.now(),
    });
  }
  f.advance(61000);
  // An exhausted lifetime quota is RATE_LIMITED without Retry-After, marked SESSION_QUOTA: no retry helps
  // until the session expires, so the Designer says so and offers only Close (#371). Never the per-visitor
  // SESSION_RATE_LIMITED.
  const exhausted = await f.http(`quotes/${result.quoteId}/renew`, { ...f.body, idempotencyKey: randomUUID() });
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.headers.get('Retry-After'), null);
  assert.deepEqual(
    { ...(await exhausted.json()), requestId: 'request' },
    {
      code: 'RATE_LIMITED',
      message: 'This customization session has reached its limit. Come back later to continue.',
      details: { reason: 'SESSION_QUOTA' },
      requestId: 'request',
    },
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
  let stockReads = 0;
  // Acceptance re-reads stock once, before its signing fence.
  f.availability(() => {
    stockReads++;
    return false;
  });
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 409);
  assert.equal(stockReads, 1, 'stock was rechecked before signing');
  assert.equal(f.signings(), 0);
  assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
  f.availability(true);
  const declinedReplay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(declinedReplay.status, 409);
  assert.equal((await declinedReplay.json()).acceptanceOutcome, 'declined');
  assert.equal(f.signings(), 0, 'Recovered stock cannot revive a terminally declined command');
  const replacement = await (await f.http('quote-proposals', f.body)).json();
  const replacementBody = { capability: f.session.capability, hash: replacement.hash, idempotencyKey: randomUUID() };
  const accepted = await f.http(`quote-proposals/${replacement.proposalId}/accept`, replacementBody);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const result = await accepted.json();
  assert.equal(f.signings(), 1);
  f.availability(false);
  const replay = await f.http(`quote-proposals/${replacement.proposalId}/accept`, replacementBody);
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
  const accepted = BuyerAcceptedCartSchema.parse(await acceptedResponse.json());
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
  assert.equal(restored.repairRequired, false);
  assert.equal(restored.renewable, false);
  const paid = await f.http('cart-state', {
    capability: f.session.capability,
    lines: lines.map((line) => ({ ...line, sellingPlan: '99' })),
  });
  assert.equal(paid.status, 409);
  assert.equal((await paid.json()).details, undefined, 'only an unowned set is reported as another session');
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
  const f = await fixture(t, { isolated: true });
  let preparations = 0,
    proofs = 0,
    availability = 0;
  const victim = await fixture(t, {
    readiness: {
      observe: async () => {
        preparations++;
        return {
          assertCurrent: async () => {
            proofs++;
          },
        };
      },
      assertReady: async () => {
        proofs++;
      },
    },
  });
  victim.availability(() => {
    availability++;
    return true;
  });
  const proposalResponse = await victim.http('quote-proposals', victim.body);
  assert.equal(proposalResponse.status, 200);
  const victimProposal = await proposalResponse.json();
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
  const victimBody = { capability: victim.session.capability, hash: victimProposal.hash, idempotencyKey: randomUUID() };
  const first = await victim.http(`quote-proposals/${victimProposal.proposalId}/accept`, victimBody);
  assert.equal(first.status, 200, await first.clone().text());
  assert.ok(
    await victim.core.buyers.getProposal(victim.scope, victimProposal.proposalId, victim.now(), true),
    'Another fixture cleanup cannot delete the victim proposal',
  );
  const before = { preparations, proofs, availability, signings: victim.signings() };
  assert.equal((await victim.http(`quote-proposals/${victimProposal.proposalId}/accept`, victimBody)).status, 200);
  assert.deepEqual({ preparations, proofs, availability, signings: victim.signings() }, before);
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
  const [first, second] = await Promise.all(responses.map(async (r) => BuyerAcceptedCartSchema.parse(await r.json())));
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.quoteId, second.quoteId);
  assert.equal(first.setId, second.setId);
  assert.equal(f.signings(), 1);
  f.advance(300001);
  f.unavailable(true);
  const replay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).setId, first.setId);
  f.unavailable(false);
  const expiredBody = { ...body, idempotencyKey: randomUUID() };
  const unreviewed = await f.http(`quote-proposals/${proposal.proposalId}/accept`, expiredBody);
  assert.equal(unreviewed.status, 409);
  assert.equal((await unreviewed.json()).acceptanceOutcome, 'declined');
  const marker = await f.pool.query('SELECT declined_at FROM buyer_commands WHERE shop_id=$1 AND idempotency_key=$2', [
    f.shopId,
    `m7:${proposal.proposalId}:${expiredBody.idempotencyKey}`,
  ]);
  assert.ok(marker.rows[0]?.declined_at, 'Expired reviewed terms commit terminal authority');
  f.unavailable(true);
  const expiredReplay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, expiredBody);
  assert.equal(expiredReplay.status, 409);
  assert.equal((await expiredReplay.json()).acceptanceOutcome, 'declined');
  f.unavailable(false);
  assert.equal(f.signings(), 1, 'Expired command and its replay create no additional signature');
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    1,
  );
  const owner2 = await (await f.http('sessions', {})).json();
  const lines = first.buckets.map((b, index) => ({ ...b, key: `line${index}`, sellingPlan: null }));
  // #340: another session's set stays unrestorable; only the reason is reported, never its design.
  const foreign = await f.http('cart-state', { capability: owner2.capability, lines });
  assert.equal(foreign.status, 409);
  const foreignBody = await foreign.json();
  assert.equal(foreignBody.code, 'REVIEW_REQUIRED');
  assert.deepEqual(foreignBody.details, { reason: 'NOT_OWNED' });
  assert.equal(foreignBody.groups, undefined);
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
  const accepted = BuyerAcceptedCartSchema.parse(await response.json());
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
  const accepted = BuyerAcceptedCartSchema.parse(await acceptedResponse.json());
  const facts = await f.pool.query('SELECT qualifying_usage_disposition FROM accepted_quotes WHERE shop_id=$1', [
    f.shopId,
  ]);
  assert.deepEqual(facts.rows, [{ qualifying_usage_disposition: 'NOT_METERED' }]);
  const repeated = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(repeated.status, 200, await repeated.clone().text());
  assert.equal((await repeated.json()).quoteId, accepted.quoteId);
  assert.equal(f.signings(), 1);
});

for (const stage of ['retained-read', 'settlement', 'finish'] as const) {
  test(`acceptance ${stage} failure retains uncertainty and never claims terminal decline`, {
    skip: !connectionString,
  }, async (t) => {
    const f = await fixture(t);
    const proposal = await (await f.http('quote-proposals', f.body)).json();
    const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
    const retainedRead = f.core.buyers.getProposal;
    const settlement = f.core.acceptedQuotes.resolveBuyerAcceptance;
    const finish = f.core.buyers.finishApplication;
    const unavailable = async (): Promise<never> => {
      throw new Error('Synthetic boundary unavailable');
    };
    if (stage === 'retained-read') f.core.buyers.getProposal = unavailable;
    if (stage === 'settlement') {
      f.amount('11.00');
      f.core.acceptedQuotes.resolveBuyerAcceptance = unavailable;
    }
    if (stage === 'finish') f.core.buyers.finishApplication = unavailable;
    try {
      const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
      assert.equal(response.status, 503, await response.clone().text());
      assert.equal((await response.json()).acceptanceOutcome, undefined);
      assert.equal(
        (
          await f.pool.query(
            'SELECT count(*)::int n FROM buyer_commands WHERE shop_id=$1 AND declined_at IS NOT NULL',
            [f.shopId],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(f.signings(), stage === 'finish' ? 1 : 0);
    } finally {
      f.core.buyers.getProposal = retainedRead;
      f.core.acceptedQuotes.resolveBuyerAcceptance = settlement;
      f.core.buyers.finishApplication = finish;
    }
    if (stage === 'finish') {
      const original = (await f.pool.query('SELECT quote_id FROM accepted_quotes WHERE shop_id=$1', [f.shopId]))
        .rows[0];
      const replay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
      assert.equal(replay.status, 200, await replay.clone().text());
      assert.equal((await replay.json()).quoteId, original.quote_id);
      assert.equal(f.signings(), 1, 'Postcommit failure replays the original acceptance');
    }
  });
}

test('overlapping known rejection recovers the winning acceptance through service linking', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const original = f.core.acceptedQuotes.accept.bind(f.core.acceptedQuotes);
  let enter: () => void = () => {},
    release: () => void = () => {},
    calls = 0;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.core.acceptedQuotes.accept = async (input, commit) => {
    if (++calls > 1) throw new Error('A known rejection must not reach the signing fence');
    return original(input, async () => {
      enter();
      await gate;
      return commit();
    });
  };
  const winner = f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  await entered;
  // The overlapping request observes a changed price before the fence: a known review rejection.
  f.amount('99.00');
  const rejecting = f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  try {
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await f.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM shops s JOIN installation_generations%' LIMIT 1",
      );
      if (state.rows.length) {
        blocked = true;
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(blocked, true, 'Known-rejection settlement waits on the winning issuance lock');
  } finally {
    release();
  }
  const responses = await Promise.all([winner, rejecting]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const [first, second] = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(second, first, 'Settlement winner completes the original application path');
  assert.equal(f.signings(), 1);
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    1,
  );
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM cart_applications WHERE shop_id=$1', [f.shopId])).rows[0].n,
    1,
  );
  assert.equal(
    (
      await f.pool.query('SELECT count(*)::int n FROM buyer_commands WHERE shop_id=$1 AND declined_at IS NOT NULL', [
        f.shopId,
      ])
    ).rows[0].n,
    0,
  );
});

test('cart-state ignores native quantity and removal edits, and renewal re-signs the stored accepted request', {
  skip: !connectionString,
}, async (t) => {
  // Retained artwork must cover the renewed window (D+3..D+5), as with production's 7-day retention.
  const f = await fixture(t, { artworkRetentionDays: 7 });
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const accepted = BuyerAcceptedCartSchema.parse(
    await (
      await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
        capability: f.session.capability,
        hash: proposal.hash,
        idempotencyKey: randomUUID(),
      })
    ).json(),
  );
  assert.ok(accepted.buckets.every((bucket) => Object.keys(bucket.properties).join() === '_insignia_line_v3'));
  const lines = accepted.buckets.map((bucket, index) => ({ ...bucket, key: `key${index}`, sellingPlan: null }));
  const state = async (body: typeof lines) => f.http('cart-state', { capability: f.session.capability, lines: body });
  // Quantity is not signed: a native theme quantity change or a removed line needs no review.
  const edited = await (await state(lines.map((line) => ({ ...line, quantity: line.quantity + 2 })))).json();
  assert.equal(edited.repairRequired, false);
  assert.equal(edited.renewable, false);
  assert.equal(
    edited.groups
      .flatMap((group: { variants: { quantity: number }[] }) => group.variants)
      .reduce((sum: number, variant: { quantity: number }) => sum + variant.quantity, 0),
    lines.reduce((sum, line) => sum + line.quantity + 2, 0),
    'observed quantities feed Designer repair and editing',
  );
  const subset = await (await state(lines.slice(0, 1))).json();
  assert.equal(subset.repairRequired, false);
  // Tampered, duplicated, foreign-set and historical v2 carriers still need review.
  const first = lines[0];
  assert.ok(first);
  const carrier = String(first.properties._insignia_line_v3);
  assert.equal((await state([first, { ...first, key: 'copy' }])).status, 409, 'duplicate index');
  assert.equal(
    (await state([{ ...first, properties: { _insignia_line_v3: alterLastChar(carrier) } }])).status,
    409,
    'altered carrier',
  );
  assert.equal(
    (
      await state([
        { ...first, properties: { _insignia_quote_v2: 'x'.repeat(208), _insignia_member_v2: 'y'.repeat(30) } },
      ])
    ).status,
    409,
    'historical v2 leftovers',
  );
  assert.equal((await state([{ ...first, variantId: '999' }])).status, 409, 'other variant');
  // Shop-local day D+3: the set lapsed; quantity edits keep it renewable.
  f.advance(3 * 86400000);
  const lapsed = await (await state(lines.map((line) => ({ ...line, quantity: line.quantity + 1 })))).json();
  assert.equal(lapsed.repairRequired, true);
  assert.equal(lapsed.renewable, true);
  assert.equal(lapsed.quoteId, accepted.quoteId);
  // Renewal prices the stored accepted request; client groups are accepted but not authority.
  const renewal = await f.http(`quotes/${lapsed.quoteId}/renew`, {
    ...f.body,
    groups: lapsed.groups,
    idempotencyKey: randomUUID(),
  });
  assert.equal(renewal.status, 200, await renewal.clone().text());
  const renewed = BuyerAcceptedCartSchema.parse(await renewal.json());
  assert.equal(renewed.quoteId, accepted.quoteId);
  assert.notEqual(renewed.setId, accepted.setId);
  assert.deepEqual(
    renewed.buckets.map(({ variantId, quantity }) => ({ variantId, quantity })),
    accepted.buckets.map(({ variantId, quantity }) => ({ variantId, quantity })),
  );
  // The storefront applies the renewed carriers to the cart's current quantities; that confirms.
  const confirm = await f.http(`cart-applications/${renewed.applicationId}/confirm`, {
    capability: f.session.capability,
    fingerprint: 'observed-current-cart',
    vector: renewed.buckets.map((bucket) => ({ ...bucket, quantity: bucket.quantity + 1 })),
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).status, 'APPLIED');
  // A cart may hold only one signed set: a renewed line beside a line of the old set needs review.
  const renewedLine = { ...first, key: 'renewed', properties: { ...renewed.buckets[0]?.properties } };
  assert.equal((await state([renewedLine, first])).status, 409, 'two sets');
  assert.equal((await state([renewedLine])).status, 200, 'the renewed set alone is owned');
  // #340: another session learns only whether the lines can still be checked out. D+4 is past the
  // original set's D+2 in every shop time zone; the renewed set (issued D+3) is valid through D+5.
  f.advance(86400000);
  const other = await (await f.http('sessions', {})).json();
  const foreign = async (body: typeof lines) =>
    (await f.http('cart-state', { capability: other.capability, lines: body })).json();
  assert.deepEqual((await foreign([first])).details, { reason: 'NOT_OWNED_EXPIRED' });
  assert.deepEqual((await foreign([renewedLine])).details, { reason: 'NOT_OWNED' });
});

test('buyer-actionable conditions reach the storefront as specific 4xx responses (#336)', {
  skip: !connectionString,
}, async (t) => {
  // A variant deleted from the product: the stock read takes precedence over a failing price read.
  const f = await fixture(t, { narrowAvailability: async () => ({ variants: [] }) });
  f.unavailable(true);
  const deleted = await f.http('quote-proposals', f.body);
  assert.equal(deleted.status, 410, await deleted.clone().text());
  assert.equal((await deleted.json()).code, 'PRODUCT_UNAVAILABLE');
  assert.equal(f.signings(), 0);
  // A design kept from before the product configuration was republished needs review.
  const design = await f.http(
    `designs/${randomUUID()}`,
    { capability: f.session.capability, expectedVersion: 0, group: { ...f.group, configRevisionId: randomUUID() } },
    'PUT',
  );
  assert.equal(design.status, 409, await design.clone().text());
  assert.equal((await design.json()).code, 'REVIEW_REQUIRED');
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
type CartLine = {
  key: string;
  variantId: string;
  quantity: number;
  properties: Record<string, string>;
  sellingPlan: null;
};
/** The cart lines of one accepted set, as an earlier buyer session left them in the cart. */
async function earlierSessionLines(f: Fixture): Promise<CartLine[]> {
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const accepted = BuyerAcceptedCartSchema.parse(await response.json());
  return accepted.buckets.map((b, index) => ({ ...b, key: `line${index}`, sellingPlan: null }));
}
/** What a new session's cart-state reports for lines it does not own: only the reason, never the design. */
async function notOwnedReason(f: Fixture, lines: CartLine[]): Promise<unknown> {
  const other = await (await f.http('sessions', {})).json();
  const response = await f.http('cart-state', { capability: other.capability, lines });
  assert.equal(response.status, 409, await response.clone().text());
  const body = await response.json();
  assert.equal(body.code, 'REVIEW_REQUIRED');
  assert.equal(body.groups, undefined);
  return body.details?.reason;
}
const headerOf = (lines: CartLine[]) =>
  decodeHeaderV3(Buffer.from(String(lines[0]?.properties._insignia_line_v3), 'base64url').subarray(0, HEADER_V3_BYTES));
/** A carrier whose header claims other values; its signature, record and proof are kept (never valid). */
function forged(lines: CartLine[], change: Partial<HeaderV3>): CartLine[] {
  return lines.map((line) => {
    const raw = Buffer.from(String(line.properties._insignia_line_v3), 'base64url');
    const header = decodeHeaderV3(raw.subarray(0, HEADER_V3_BYTES));
    const carrier = Buffer.concat([encodeHeaderV3({ ...header, ...change }), raw.subarray(HEADER_V3_BYTES)]);
    return { ...line, properties: { _insignia_line_v3: carrier.toString('base64url') } };
  });
}
const otherSet = () => ({ setHex: randomUUID().replaceAll('-', '') });

test('an earlier session keeps lines checkout still accepts; a forged or unknown set answers from its header alone (#371)', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const lines = await earlierSessionLines(f);
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED');
  // No set with this ID exists: the same answer as the real set, so the reason never reveals existence.
  assert.equal(await notOwnedReason(f, forged(lines, otherSet())), 'NOT_OWNED');
  const header = headerOf(lines);
  assert.equal(
    await notOwnedReason(f, forged(lines, { ...otherSet(), validThroughDay: header.validThroughDay - 3 })),
    'NOT_OWNED_EXPIRED',
  );
});

test('earlier-session lines under a revoked or unknown key, an older epoch or another generation are removal only (#371)', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const lines = await earlierSessionLines(f);
  const header = headerOf(lines);
  // Header claims checkout no longer admits, whether or not such a set exists.
  assert.equal(await notOwnedReason(f, forged(lines, { ...otherSet(), keyId: 8 })), 'NOT_OWNED_EXPIRED', 'unknown key');
  assert.equal(
    await notOwnedReason(f, forged(lines, { ...otherSet(), generationHex: randomUUID().replaceAll('-', '') })),
    'NOT_OWNED_EXPIRED',
    'other authorization generation',
  );
  assert.equal(
    await notOwnedReason(f, forged(lines, { ...otherSet(), epoch: header.epoch + 1 })),
    'NOT_OWNED_EXPIRED',
    'other epoch',
  );
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED');
  await f.core.signingKeys.revoke(f.authorizationScope, 7, randomUUID(), 'synthetic leak');
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED_EXPIRED', 'revoked key');
  assert.equal(await notOwnedReason(f, forged(lines, otherSet())), 'NOT_OWNED_EXPIRED', 'revoked key, unknown set');
});

test('earlier-session lines whose signing key window ended before the shop day are removal only (#371)', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const lines = await earlierSessionLines(f);
  const day = Math.floor(+f.now() / 86400000);
  await f.pool.query('UPDATE signing_keys SET last_valid_day=$2 WHERE shop_id=$1 AND key_id=7', [f.shopId, day - 1]);
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED_EXPIRED');
});

test('earlier-session lines signed under an older authorization epoch are removal only (#371)', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const lines = await earlierSessionLines(f);
  await f.core.signingKeys.incrementEpoch({
    scope: f.authorizationScope,
    commandKey: randomUUID(),
    requestDigest: 'a'.repeat(64),
  });
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED_EXPIRED');
});

test('earlier-session lines expired in the shop time zone are removal only before UTC-12 catches up (#371)', {
  skip: !connectionString,
}, async (t) => {
  // UTC+14: accepted 2026-10-13 local (12:00Z on the 12th), valid through the 15th local.
  const f = await fixture(t, { timezone: 'Pacific/Kiritimati' });
  const lines = await earlierSessionLines(f);
  f.advance(2 * 86400000); // 15th, 02:00 local: the last valid day.
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED');
  f.advance(86400000); // 16th, 02:00 local; still the 15th at UTC-12.
  assert.equal(await notOwnedReason(f, lines), 'NOT_OWNED_EXPIRED');
});
