import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SignerUnavailableError } from '@insignia/application';
import { Client } from 'pg';
import { fixture } from './support/buyer-fixture.mts';

/**
 * A server-side dependency failing between a buyer's proposal and their signed set (spec §8.3, §8.4):
 * the signer, the shop signing fence and the web process itself. Each failure signs and stores
 * nothing, answers with a coded response, and the identical request then succeeds exactly once.
 */
const connectionString = process.env.DATABASE_URL;

async function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const { rows } = await f.pool.query<{ quotes: number; sets: number; renewals: number; declined: number }>(
    `SELECT
       (SELECT count(*)::int FROM accepted_quotes WHERE shop_id=$1) quotes,
       (SELECT count(*)::int FROM quote_authorization_sets WHERE shop_id=$1) sets,
       (SELECT count(*)::int FROM quote_authorization_renewals WHERE shop_id=$1) renewals,
       (SELECT count(*)::int FROM buyer_commands WHERE shop_id=$1 AND declined_at IS NOT NULL) declined`,
    [f.shopId],
  );
  return rows[0];
}

/** Its own connection: the fixture's pool would wait for a borrowed client while closing. */
async function fenceHolder(t: { after(fn: () => Promise<void>): void }) {
  const holder = new Client({ connectionString });
  await holder.connect();
  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
  });
  return holder;
}

async function failure(response: Response) {
  const body = await response.json();
  return {
    status: response.status,
    code: body.code,
    retryable: body.retryable,
    retryAfter: response.headers.get('Retry-After'),
    acceptanceOutcome: body.acceptanceOutcome,
  };
}

test('an unavailable or timed-out signer signs and stores nothing; the same acceptance and renewal keys then succeed once', {
  skip: !connectionString,
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const accept = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const route = `quote-proposals/${proposal.proposalId}/accept`;

  // A stopped signer and one that misses the client deadline both surface as TRANSPORT.
  f.signerFault(new SignerUnavailableError('TRANSPORT'));
  // Spec §8.3: the signer is not a listed transient condition, so it is "anything else": 503 UNAVAILABLE.
  // The Designer keeps the design and offers Retry, which resends the same acceptance key.
  assert.deepEqual(await failure(await f.http(route, accept)), {
    status: 503,
    code: 'UNAVAILABLE',
    retryable: undefined,
    retryAfter: null,
    acceptanceOutcome: undefined,
  });
  assert.equal(f.signAttempts(), 1);
  assert.deepEqual(await counts(f), { quotes: 0, sets: 0, renewals: 0, declined: 0 });

  f.signerFault(null);
  const accepted = await f.http(route, accept);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const original = await accepted.json();
  const replay = await f.http(route, accept);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).setId, original.setId);
  assert.equal(f.signings(), 1);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 1, renewals: 0, declined: 0 });

  f.advance(86400000);
  const renew = { ...f.body, idempotencyKey: randomUUID() };
  const renewRoute = `quotes/${original.quoteId}/renew`;
  f.signerFault(new SignerUnavailableError('UNAVAILABLE'));
  assert.equal((await failure(await f.http(renewRoute, renew))).code, 'UNAVAILABLE');
  assert.deepEqual(await counts(f), { quotes: 1, sets: 1, renewals: 0, declined: 0 });
  f.signerFault(null);
  const renewed = await f.http(renewRoute, renew);
  assert.equal(renewed.status, 200, await renewed.clone().text());
  const renewal = await renewed.json();
  assert.notEqual(renewal.setId, original.setId);
  const renewalReplay = await f.http(renewRoute, renew);
  assert.equal((await renewalReplay.json()).setId, renewal.setId);
  assert.equal(f.signings(), 2);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 2, renewals: 1, declined: 0 });
});

test('a signing fence held past lock_timeout is 409 BUSY with Retry-After; the same keys then succeed once', {
  skip: !connectionString,
  timeout: 30000,
}, async (t) => {
  // Readiness is observed after the buyer command is reserved and before the signing fence, so the
  // hold starts exactly where a concurrent rotation, epoch bump or uninstall would take the fence.
  let beforeFence: (() => Promise<void>) | undefined;
  const f = await fixture(t, {
    readiness: {
      assertReady: async () => {},
      async observe() {
        const hook = beforeFence;
        beforeFence = undefined;
        await hook?.();
        return { assertCurrent: async () => {} };
      },
    },
  });
  const holder = await fenceHolder(t);
  let started = 0;
  // The fence every signing-key writer, epoch bump and uninstall takes (FOR UPDATE OF s, i).
  const hold = async () => {
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM signing_key_scope($1, 1::bigint, true)', [f.shopId]);
    started = Date.now();
  };
  const release = () => holder.query('ROLLBACK');
  const busy = { status: 409, code: 'BUSY', retryable: true, retryAfter: '1', acceptanceOutcome: undefined };

  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const accept = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const route = `quote-proposals/${proposal.proposalId}/accept`;
  beforeFence = hold;
  assert.deepEqual(await failure(await f.http(route, accept)), busy);
  {
    const waited = Date.now() - started;
    // At least the lock_timeout elapsed (so this BUSY is the fence, not another cause) and no more than its bound.
    assert.ok(started && waited >= 1900 && waited < 6000, `the 2 s lock_timeout bounds the wait (${waited} ms)`);
  }
  await release();
  assert.equal(f.signAttempts(), 0);
  assert.deepEqual(await counts(f), { quotes: 0, sets: 0, renewals: 0, declined: 0 });
  const accepted = await f.http(route, accept);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const original = await accepted.json();
  assert.equal(f.signings(), 1);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 1, renewals: 0, declined: 0 });

  f.advance(86400000);
  const renew = { ...f.body, idempotencyKey: randomUUID() };
  const renewRoute = `quotes/${original.quoteId}/renew`;
  started = 0;
  beforeFence = hold;
  assert.deepEqual(await failure(await f.http(renewRoute, renew)), busy);
  {
    const waited = Date.now() - started;
    // At least the lock_timeout elapsed (so this BUSY is the fence, not another cause) and no more than its bound.
    assert.ok(started && waited >= 1900 && waited < 6000, `the 2 s lock_timeout bounds the wait (${waited} ms)`);
  }
  await release();
  assert.equal(f.signings(), 1);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 1, renewals: 0, declined: 0 });
  const renewed = await f.http(renewRoute, renew);
  assert.equal(renewed.status, 200, await renewed.clone().text());
  assert.equal(f.signings(), 2);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 2, renewals: 1, declined: 0 });
});

test('a web process restart between proposal and acceptance, or before a lost response, loses nothing', {
  skip: !connectionString,
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  await f.restart();
  const accept = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const route = `quote-proposals/${proposal.proposalId}/accept`;
  const accepted = await f.http(route, accept);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const original = await accepted.json();
  // The buyer never saw that answer (the process died); the retry on the next process replays it.
  await f.restart();
  const replay = await f.http(route, accept);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.deepEqual(await replay.json(), original);
  assert.equal(f.signings(), 1);
  f.advance(86400000);
  await f.restart();
  const renewed = await f.http(`quotes/${original.quoteId}/renew`, { ...f.body, idempotencyKey: randomUUID() });
  assert.equal(renewed.status, 200, await renewed.clone().text());
  assert.equal(f.signings(), 2);
  assert.deepEqual(await counts(f), { quotes: 1, sets: 2, renewals: 1, declined: 0 });
});
