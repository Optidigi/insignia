import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type TestContext, test } from 'node:test';
import { Client } from 'pg';
import { fixture } from './support/buyer-fixture.mts';

/**
 * Acceptance and renewal reserve their buyer command, and after signing link the quote and fill the
 * cart application, under a shared lock on the shop and installation rows. A key rotation, epoch bump,
 * uninstall or another acceptance's signing fence holds those rows exclusively; spec §8.4 bounds the
 * wait at lock_timeout 2 s and answers 409 BUSY (§8.3). Proposals and drafts keep their current wait.
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

/** Holds the shop fence on its own connection and answers what a request does while it is held. */
async function fence(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
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
  /**
   * The request's answer, or 'still waiting' when the 2 s bound did not end the lock wait. `holdFirst`
   * false: the request itself takes the fence at a later step.
   */
  return async (route: string, body: unknown, method = 'POST', holdFirst = true) => {
    if (holdFirst) await hold();
    const started = Date.now();
    const pending = f.http(route, body, method).then(failure);
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
    // The race above already ends at 5 s, well before the 10 s statement timeout.
    if (outcome !== 'still waiting') assert.ok(elapsed >= 1900, `waited the lock_timeout (${elapsed} ms)`);
    return outcome;
  };
}

/** Holds the fence just before the named buyer store step runs, once. */
async function fenceBefore(
  t: TestContext,
  f: Awaited<ReturnType<typeof fixture>>,
  step: 'linkQuote' | 'finishApplication',
) {
  const holder = new Client({ connectionString });
  await holder.connect();
  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
  });
  const buyers = f.core.buyers as unknown as Record<typeof step, (...args: unknown[]) => Promise<unknown>>;
  const original = buyers[step];
  buyers[step] = async (...args) => {
    buyers[step] = original;
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM signing_key_scope($1, 1::bigint, true)', [f.shopId]);
    return original(...args);
  };
  return () => holder.query('ROLLBACK');
}

const busy = { status: 409, code: 'BUSY', retryable: true, retryAfter: '1', acceptanceOutcome: undefined };

test('an acceptance or renewal that arrives while the shop fence is held is bounded by lock_timeout too', {
  skip: !connectionString,
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const whileHeld = await fence(t, f);

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

// After signing, the acceptance links its quote and fills the cart application. A fence taken in
// between answers BUSY there too; the automatic retry of the same key replays the signed set.
for (const step of ['linkQuote', 'finishApplication'] as const)
  test(`an acceptance whose ${step} meets a held shop fence is 409 BUSY and replays the signed set`, {
    skip: !connectionString,
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t);
    const proposal = await (await f.http('quote-proposals', f.body)).json();
    const accept = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
    const route = `quote-proposals/${proposal.proposalId}/accept`;
    const release = await fenceBefore(t, f, step);
    const started = Date.now();
    const pending = f.http(route, accept).then(failure);
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
    assert.deepEqual(outcome, busy);
    assert.ok(elapsed >= 1900, `waited the lock_timeout (${elapsed} ms)`);
    // Signed once; the refused step wrote nothing, so the command has no application yet.
    assert.equal(f.signings(), 1);
    assert.deepEqual(await counts(f), { commands: 1, quotes: 1, sets: 1, renewals: 0 });
    const { rows } = await f.pool.query('SELECT count(*)::int n FROM cart_applications WHERE shop_id=$1', [f.shopId]);
    assert.equal(rows[0].n, 0);
    const accepted = await f.http(route, accept);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.ok((await accepted.json()).applicationId);
    assert.equal(f.signings(), 1);
    assert.deepEqual(await counts(f), { commands: 1, quotes: 1, sets: 1, renewals: 0 });
  });
