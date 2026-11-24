import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { fixture } from './support/buyer-fixture.mts';

/**
 * Acceptance and renewal first reserve their buyer command under a shared lock on the shop and
 * installation rows. A key rotation, epoch bump, uninstall or another acceptance's signing fence holds
 * those rows exclusively; spec §8.4 bounds the wait at lock_timeout 2 s and answers 409 BUSY (§8.3).
 * Proposals and drafts keep their unbounded wait (a buyer-visible change left to the owner).
 */
const connectionString = process.env.DATABASE_URL;

async function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const { rows } = await f.pool.query<{ commands: number; quotes: number; sets: number; renewals: number }>(
    `SELECT
       (SELECT count(*)::int FROM buyer_commands WHERE shop_id=$1) commands,
       (SELECT count(*)::int FROM accepted_quotes WHERE shop_id=$1) quotes,
       (SELECT count(*)::int FROM quote_authorization_sets WHERE shop_id=$1) sets,
       (SELECT count(*)::int FROM quote_authorization_renewals WHERE shop_id=$1) renewals`,
    [f.shopId],
  );
  return rows[0];
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

test('an acceptance or renewal that arrives while the shop fence is held is bounded by lock_timeout too', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  // Its own connection: the fixture's pool would wait for a borrowed client while closing.
  const holder = new Client({ connectionString });
  await holder.connect();
  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
  });
  // The fence every signing-key writer, epoch bump and uninstall takes (FOR UPDATE OF s, i).
  const hold = async () => {
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM signing_key_scope($1, 1::bigint, true)', [f.shopId]);
  };
  const release = () => holder.query('ROLLBACK');
  /** The request's answer, or 'still waiting' when the 2 s bound did not end the lock wait. */
  const whileHeld = async (route: string, body: unknown) => {
    await hold();
    const started = Date.now();
    const pending = f.http(route, body).then(failure);
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      pending,
      new Promise<'still waiting'>((resolve) => {
        timer = setTimeout(() => resolve('still waiting'), 5000);
      }),
    ]);
    const elapsed = Date.now() - started;
    clearTimeout(timer);
    await release();
    await pending;
    if (outcome !== 'still waiting') assert.ok(elapsed >= 1500, `waited the lock_timeout (${elapsed} ms)`);
    return outcome;
  };
  const busy = { status: 409, code: 'BUSY', retryable: true, retryAfter: '1', acceptanceOutcome: undefined };

  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const accept = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const route = `quote-proposals/${proposal.proposalId}/accept`;
  assert.deepEqual(await whileHeld(route, accept), busy);
  assert.equal(f.signings(), 0);
  assert.deepEqual(await counts(f), { commands: 0, quotes: 0, sets: 0, renewals: 0 });
  // The storefront retries the identical acceptance; it signs exactly once.
  const accepted = await f.http(route, accept);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const original = await accepted.json();
  const replay = await f.http(route, accept);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).setId, original.setId);
  assert.equal(f.signings(), 1);
  assert.deepEqual(await counts(f), { commands: 1, quotes: 1, sets: 1, renewals: 0 });

  f.advance(86400000);
  const renew = { ...f.body, idempotencyKey: randomUUID() };
  const renewRoute = `quotes/${original.quoteId}/renew`;
  assert.deepEqual(await whileHeld(renewRoute, renew), busy);
  assert.equal(f.signings(), 1);
  assert.deepEqual(await counts(f), { commands: 1, quotes: 1, sets: 1, renewals: 0 });
  const renewed = await f.http(renewRoute, renew);
  assert.equal(renewed.status, 200, await renewed.clone().text());
  const renewal = await renewed.json();
  const renewalReplay = await f.http(renewRoute, renew);
  assert.equal((await renewalReplay.json()).setId, renewal.setId);
  assert.equal(f.signings(), 2);
  assert.deepEqual(await counts(f), { commands: 2, quotes: 1, sets: 2, renewals: 1 });
});
