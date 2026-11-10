import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QuoteContextChangedError } from '@insignia/application';
import { BuyerAcceptedCartSchema } from '@insignia/contracts';
import { createPublicationRepository } from '../../../packages/database/dist/repositories/publication.js';
import { fixture } from './support/buyer-fixture.mts';

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
  const availabilityPhases: (string | undefined)[] = [];
  // Availability must fail at the actual serialized signing boundary, regardless
  // of how many preparation reads the adapter needs.
  f.availability((phase) => {
    availabilityPhases.push(phase);
    return phase !== 'final';
  });
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 409);
  assert.ok(availabilityPhases.includes('final'), 'stock was rechecked inside serialized acceptance');
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
      prepare: async () => {
        preparations++;
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
    if (++calls > 1) throw new QuoteContextChangedError('catalog');
    return original(input, async () => {
      enter();
      await gate;
      return commit();
    });
  };
  const winner = f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  await entered;
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

test('cart-state marks a lapsed unchanged set renewable and renewal accepts the restored cart groups', {
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
  const lines = accepted.buckets.map((bucket, index) => ({ ...bucket, key: `key${index}`, sellingPlan: null }));
  // Shop-local day D+3: the cart's set lapsed while its signed vector is unchanged.
  f.advance(3 * 86400000);
  const lapsedResponse = await f.http('cart-state', { capability: f.session.capability, lines });
  assert.equal(lapsedResponse.status, 200, await lapsedResponse.clone().text());
  const lapsed = await lapsedResponse.json();
  assert.equal(lapsed.repairRequired, true);
  assert.equal(lapsed.renewable, true);
  assert.equal(lapsed.quoteId, accepted.quoteId);
  const drifted = await (
    await f.http('cart-state', {
      capability: f.session.capability,
      lines: lines.map((line) => ({ ...line, quantity: line.quantity + 1 })),
    })
  ).json();
  assert.equal(drifted.repairRequired, true);
  assert.equal(drifted.renewable, false);
  // The storefront renews with the observed cart's restored groups, not a client-held request.
  const fromCart = await f.http(`quotes/${lapsed.quoteId}/renew`, {
    ...f.body,
    groups: lapsed.groups,
    idempotencyKey: randomUUID(),
  });
  assert.equal(fromCart.status, 200, await fromCart.clone().text());
  const cartRenewal = BuyerAcceptedCartSchema.parse(await fromCart.json());
  assert.equal(cartRenewal.quoteId, accepted.quoteId);
  assert.deepEqual(
    cartRenewal.buckets.map(({ variantId, quantity }) => ({ variantId, quantity })),
    accepted.buckets.map(({ variantId, quantity }) => ({ variantId, quantity })),
  );
});
