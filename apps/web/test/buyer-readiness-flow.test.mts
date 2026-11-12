import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { BuyerDesired } from '@insignia/contracts';
import type { BuyerFailureDiagnostic } from '@insignia/observability';
import { Pool, type PoolClient } from 'pg';
import { fixture } from './support/buyer-fixture.mts';

const database = process.env.DATABASE_URL;
function gate() {
  let release: () => void = () => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Counts every readiness entry point; observation completes outside or inside the fence as recorded. */
function readinessProbe(inside: () => boolean, current: () => void = () => {}) {
  const calls = { observe: 0, assertReady: 0, assertCurrent: 0, observedInside: 0, currentOutside: 0 };
  return {
    calls,
    readiness: {
      async observe() {
        calls.observe++;
        if (inside()) calls.observedInside++;
        return {
          async assertCurrent() {
            calls.assertCurrent++;
            if (!inside()) calls.currentOutside++;
            current();
          },
        };
      },
      async assertReady() {
        calls.assertReady++;
      },
    },
  };
}

test('buyer proposal is display-only: stock overlaps pricing and no release or Function readiness runs', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  const hints: { shopId: string; activeUntil: number }[] = [];
  const probe = readinessProbe(() => false);
  const f = await fixture(t, {
    readiness: probe.readiness,
    releaseRefresh: (scope, activeUntil) => hints.push({ shopId: scope.shopId, activeUntil: +activeUntil }),
  });
  const entered = gate(),
    held = gate();
  f.availability(async () => {
    entered.release();
    await held.promise;
    return true;
  });
  const before = +f.now();
  const response = f.http('quote-proposals', f.body);
  try {
    await entered.promise;
    // Pricing persisted nothing yet, but stock already started beside it.
    held.release();
    assert.equal((await response).status, 200);
    assert.deepEqual(
      { observe: probe.calls.observe, assertReady: probe.calls.assertReady, signings: f.signings() },
      { observe: 0, assertReady: 0, signings: 0 },
    );
    assert.deepEqual(hints, [{ shopId: f.shopId, activeUntil: before + 300000 }]);
  } finally {
    held.release();
    await response;
  }
});

test('a throwing release-refresh hint never changes the proposal', { skip: !database, timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    releaseRefresh: () => {
      throw new Error('Synthetic refresher failure');
    },
  });
  assert.equal((await f.http('quote-proposals', f.body)).status, 200);
});

for (const narrow of [false, true])
  for (const failing of ['availability', 'preparation'] as const) {
    test(`buyer ${narrow ? 'narrow availability' : 'catalog fallback'} proposal drains its held sibling after ${failing} failure`, {
      skip: !database,
      timeout: 15000,
    }, async (t) => {
      const held = gate(),
        entered = gate();
      let settled = false;
      const seen: BuyerFailureDiagnostic[] = [];
      const f = await fixture(t, {
        diagnostic: (value) => seen.push(value),
        narrowAvailability: narrow
          ? async (productId, selectedIds, phase) => {
              assert.equal(productId, f.productId);
              assert.deepEqual(selectedIds, ['222']);
              assert.equal(phase, undefined);
              entered.release();
              await held.promise;
              return { variants: [{ id: '222', available: failing !== 'availability' }] };
            }
          : undefined,
      });
      f.availability(async () => {
        entered.release();
        await held.promise;
        return failing !== 'availability';
      });
      if (failing === 'preparation') f.unavailable(true);
      const response = f.http('quote-proposals', f.body).then((value) => {
        settled = true;
        return value;
      });
      try {
        await entered.promise;
        await setImmediate();
        await setImmediate();
        assert.equal(settled, false, 'a failed sibling cannot retire still-running stock work');
        held.release();
        const result = await response;
        const body = await result.json();
        if (failing === 'availability') {
          assert.equal(result.status, 409);
          assert.equal(seen[0]?.proposalStage, 'availability');
        } else {
          assert.equal(result.status, 503, 'a pricing failure retains precedence over stock');
          assert.equal(seen[0]?.correlationId, body.requestId);
        }
        assert.equal(f.signings(), 0);
        assert.equal((await f.pool.query('SELECT 1 FROM quote_proposals WHERE shop_id=$1', [f.shopId])).rowCount, 0);
      } finally {
        held.release();
        await response;
      }
    });
  }

for (const invalid of ['position', 'artwork'] as const) {
  test(`buyer ${invalid} guard rejects without readiness or signing`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    let availability = 0;
    const probe = readinessProbe(() => false);
    const f = await fixture(t, { readiness: probe.readiness });
    f.availability(() => {
      availability++;
      return true;
    });
    const body: BuyerDesired & { capability: string } = structuredClone(f.body);
    const placement = body.groups[0]?.design.placements[0];
    assert(placement);
    if (invalid === 'position') placement.position = { xMicros: 500000, yMicros: 500000 };
    else placement.artwork = { kind: 'revision', revisionId: randomUUID() };
    assert.notEqual((await f.http('quote-proposals', body)).status, 200);
    assert.deepEqual(
      { observe: probe.calls.observe, assertReady: probe.calls.assertReady, signings: f.signings() },
      { observe: 0, assertReady: 0, signings: 0 },
    );
    // The position guard is checked before any provider read; stock may overlap artwork pricing.
    if (invalid === 'position') assert.equal(availability, 0);
  });
}

async function proposalWithFence(f: Awaited<ReturnType<typeof fixture>>) {
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  let insideFence = false;
  const accept = f.core.acceptedQuotes.accept.bind(f.core.acceptedQuotes);
  f.core.acceptedQuotes.accept = (input, commit) =>
    accept(input, async () => {
      insideFence = true;
      try {
        return await commit();
      } finally {
        insideFence = false;
      }
    });
  const submit = (idempotencyKey: string = randomUUID()) =>
    f.http(`quote-proposals/${proposal.proposalId}/accept`, {
      capability: f.session.capability,
      hash: proposal.hash,
      idempotencyKey,
    });
  return { proposal, submit, inside: () => insideFence };
}

for (const narrow of [false, true])
  test(`acceptance reads ${narrow ? 'narrow' : 'catalog'} stock and readiness before the fence and only stored facts inside it`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    let fence: () => boolean = () => false;
    const stockInside: boolean[] = [];
    const probe = readinessProbe(() => fence());
    const f = await fixture(t, {
      readiness: probe.readiness,
      narrowAvailability: narrow
        ? async (_productId, _selectedIds, phase) => {
            assert.equal(phase, undefined);
            stockInside.push(fence());
            return { variants: [{ id: '222', available: true }] };
          }
        : undefined,
    });
    f.availability((phase) => {
      assert.equal(phase, undefined);
      stockInside.push(fence());
      return true;
    });
    const accepted = await proposalWithFence(f);
    fence = accepted.inside;
    stockInside.length = 0;
    assert.equal((await accepted.submit()).status, 200);
    assert.deepEqual(stockInside, [false], 'one stock read, before the fence');
    assert.deepEqual(probe.calls, {
      observe: 1,
      assertReady: 0,
      assertCurrent: 1,
      observedInside: 0,
      currentOutside: 0,
    });
    assert.equal(f.signings(), 1);
  });

test('acceptance fails closed when readiness observed before the fence is no longer current at signing', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  const probe = readinessProbe(
    () => false,
    () => {
      throw new Error('Synthetic release evidence expired');
    },
  );
  const f = await fixture(t, { readiness: probe.readiness });
  const accepted = await proposalWithFence(f);
  assert.equal((await accepted.submit()).status, 503);
  assert.equal(probe.calls.assertCurrent, 1);
  assert.equal(f.signings(), 0);
  assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
});

test('a price change since the proposal stops acceptance before stock or readiness IO', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  let stock = 0;
  const probe = readinessProbe(() => false);
  const f = await fixture(t, { readiness: probe.readiness });
  const accepted = await proposalWithFence(f);
  f.availability(() => {
    stock++;
    return true;
  });
  f.amount('99.00');
  const result = await accepted.submit();
  assert.equal(result.status, 409);
  assert.equal((await result.json()).acceptanceOutcome, 'declined');
  assert.deepEqual(
    { stock, observe: probe.calls.observe, signings: f.signings() },
    { stock: 0, observe: 0, signings: 0 },
  );
});

for (const change of ['authorization epoch', 'effective publication'] as const)
  test(`a ${change} change between pre-fence reads and signing is caught by the stored fence`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    let mutate = async () => {};
    const f = await fixture(t, {
      readiness: {
        assertReady: async () => {},
        observe: async () => {
          await mutate();
          return { assertCurrent: async () => {} };
        },
      },
    });
    const accepted = await proposalWithFence(f);
    const owner = new Pool({ connectionString: database, max: 1 });
    t.after(() => owner.end());
    mutate = async () => {
      if (change === 'authorization epoch')
        await owner.query(
          `UPDATE installation_generations SET authorization_epoch = authorization_epoch + 1
           WHERE shop_id = $1`,
          [f.shopId],
        );
      else
        await owner.query(
          'UPDATE product_configs SET publication_sequence = publication_sequence + 1 WHERE shop_id = $1',
          [f.shopId],
        );
    };
    const result = await accepted.submit();
    assert.notEqual(result.status, 200);
    // A republished product needs the buyer's review (#336); the epoch change stays an outage.
    if (change === 'effective publication') {
      assert.equal(result.status, 409);
      assert.equal((await result.json()).code, 'REVIEW_REQUIRED');
    }
    assert.equal(f.signings(), 0);
    assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
  });

test('a held signing fence makes another acceptance fail fast with a retryable error, then retry succeeds', {
  skip: !database,
  timeout: 20000,
}, async (t) => {
  let hold = false;
  const holder = new Pool({ connectionString: database, max: 1 });
  t.after(() => holder.end());
  const held: { client?: PoolClient } = {};
  const f = await fixture(t, {
    readiness: {
      assertReady: async () => {},
      // Simulates a concurrent acceptance owning the fence when this one reaches it. The command
      // was reserved earlier, so only the signing fence itself waits for this lock.
      observe: async () => {
        if (hold) {
          const client = await holder.connect();
          held.client = client;
          await client.query('BEGIN');
          await client.query('SELECT 1 FROM shops WHERE shop_id = $1 FOR UPDATE', [f.shopId]);
        }
        return { assertCurrent: async () => {} };
      },
    },
  });
  const accepted = await proposalWithFence(f);
  const key = randomUUID();
  hold = true;
  let elapsed = 0;
  try {
    const started = Date.now();
    const result = await accepted.submit(key);
    elapsed = Date.now() - started;
    // 4xx so Shopify's app proxy passes the code and Retry-After through (#336).
    assert.equal(result.status, 409);
    assert.equal(result.headers.get('Retry-After'), '1');
    const body = await result.json();
    assert.equal(body.code, 'BUSY');
    assert.equal(body.retryable, true);
  } finally {
    hold = false;
    await held.client?.query('ROLLBACK');
    held.client?.release();
  }
  assert.ok(elapsed >= 1900 && elapsed < 6000, `lock wait bounded near 2 s, observed ${elapsed} ms`);
  assert.equal(f.signings(), 0);
  assert.equal((await accepted.submit(key)).status, 200, 'the same command retries cleanly');
  assert.equal(f.signings(), 1);
});

test('completed buyer acceptance replay repeats neither stock nor readiness work', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  let availability = 0;
  const probe = readinessProbe(() => false);
  const f = await fixture(t, { readiness: probe.readiness });
  f.availability(() => {
    availability++;
    return true;
  });
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 200);
  const before = { ...probe.calls, availability, signings: f.signings() };
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 200);
  assert.deepEqual({ ...probe.calls, availability, signings: f.signings() }, before);
});

for (const stage of ['persistence', 'owned-history'] as const) {
  test(`proposal ${stage} failure is request-local and preserves proposal facts without issuing acceptance`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    const seen: BuyerFailureDiagnostic[] = [];
    const error = Object.assign(new Error('SECRET-provider-body'), { cause: new Error('SECRET-capability') });
    const f = await fixture(t, { diagnostic: (value) => seen.push(value) });
    if (stage === 'persistence')
      f.core.buyers.putProposal = async () => {
        throw error;
      };
    if (stage === 'owned-history')
      f.core.buyers.getLatestOwnedQuote = async () => {
        throw error;
      };
    const result = await f.http('quote-proposals', f.body);
    const body = await result.json();
    assert.equal(result.status, 503);
    assert.equal(body.code, 'UNAVAILABLE');
    assert.equal(body.acceptanceOutcome, undefined);
    assert.deepEqual(seen, [
      {
        correlationId: body.requestId,
        buyerStage: 'quote-proposals',
        errorClass: 'UnexpectedFailure',
        proposalStage: stage,
      },
    ]);
    assert.doesNotMatch(JSON.stringify({ body, seen }), /SECRET|cause|stack/);
    assert.equal(f.signings(), 0);
    assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
    const proposals = await f.pool.query('SELECT 1 FROM quote_proposals WHERE shop_id=$1', [f.shopId]);
    assert.equal(proposals.rowCount, stage === 'owned-history' ? 1 : 0);
    // Reusing the exact provider error in another request must not retain its
    // previous attribution or correlate it to the previous response.
    f.core.buyers.admitRequest = async () => {
      throw error;
    };
    const second = await f.http('quote-proposals', f.body);
    const secondBody = await second.json();
    assert.equal(second.status, 503);
    assert.notEqual(secondBody.requestId, body.requestId);
    assert.deepEqual(seen[1], {
      correlationId: secondBody.requestId,
      buyerStage: 'quote-proposals',
      errorClass: 'UnexpectedFailure',
      proposalStage: 'request-setup',
    });
  });
}
