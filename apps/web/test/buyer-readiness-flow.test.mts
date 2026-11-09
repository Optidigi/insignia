import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { BuyerDesired } from '@insignia/contracts';
import type { BuyerFailureDiagnostic } from '@insignia/observability';
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

test('buyer proposal overlaps release preparation with stock, then checks current readiness exactly once', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  const availability = gate(),
    entered = gate(),
    preparation = gate();
  let preparationStarted = false,
    readyChecks = 0,
    stockComplete = false,
    settled = false;
  const f = await fixture(t, {
    readiness: {
      prepare: async () => {
        preparationStarted = true;
        await preparation.promise;
      },
      assertReady: async () => {
        assert.equal(stockComplete, true);
        readyChecks++;
      },
    },
  });
  f.availability(async () => {
    entered.release();
    await availability.promise;
    stockComplete = true;
    return true;
  });
  const response = f.http('quote-proposals', f.body).then((value) => {
    settled = true;
    return value;
  });
  try {
    await entered.promise;
    await setImmediate();
    assert.equal(preparationStarted, true, 'release preparation starts while availability is pending');
    assert.equal(readyChecks, 0, 'preparation does not approve a quote');
    availability.release();
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(readyChecks, 0, 'stock alone cannot approve a quote');
    preparation.release();
    assert.equal((await response).status, 200);
    assert.equal(readyChecks, 1);
    assert.equal(f.signings(), 0);
  } finally {
    availability.release();
    preparation.release();
    await response;
  }
});

for (const failing of ['availability', 'preparation'] as const) {
  test(`buyer proposal drains its held sibling after ${failing} failure and retains stock-error precedence`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    const held = gate(),
      entered = gate();
    let settled = false,
      preparationStarted = false,
      readyChecks = 0;
    const seen: BuyerFailureDiagnostic[] = [];
    const f = await fixture(t, {
      diagnostic: (value) => seen.push(value),
      readiness: {
        prepare: async () => {
          preparationStarted = true;
          if (failing === 'availability') await held.promise;
          throw new Error('Synthetic preparation unavailable');
        },
        assertReady: async () => {
          readyChecks++;
        },
      },
    });
    f.availability(async () => {
      entered.release();
      if (failing === 'preparation') await held.promise;
      return false;
    });
    const response = f.http('quote-proposals', f.body).then((value) => {
      settled = true;
      return value;
    });
    try {
      await entered.promise;
      await setImmediate();
      assert.equal(preparationStarted, true);
      assert.equal(settled, false, 'failure cannot retire still-running preparation or stock work');
      held.release();
      const result = await response;
      assert.equal(result.status, 409, 'stock denial retains REVIEW_REQUIRED if preparation also fails');
      const body = await result.json();
      assert.deepEqual(seen, [
        {
          correlationId: body.requestId,
          buyerStage: 'quote-proposals',
          errorClass: 'ReviewRequired',
          proposalStage: 'availability',
        },
      ]);
      assert.equal(readyChecks, 0);
      assert.equal(f.signings(), 0);
      assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
    } finally {
      held.release();
      await response;
    }
  });
}

for (const invalid of ['position', 'artwork'] as const) {
  test(`buyer ${invalid} guard rejects before starting availability or release preparation`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    let preparation = 0,
      readiness = 0,
      availability = 0;
    const f = await fixture(t, {
      readiness: {
        prepare: async () => {
          preparation++;
        },
        assertReady: async () => {
          readiness++;
        },
      },
    });
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
      { preparation, readiness, availability, signings: f.signings() },
      {
        preparation: 0,
        readiness: 0,
        availability: 0,
        signings: 0,
      },
    );
  });
}

test('serialized acceptance keeps stock then passive readiness serial without preparing under its fence', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  let insideFence = false,
    finalPreparations = 0,
    finalReadyChecks = 0;
  const entered = gate(),
    held = gate();
  const f = await fixture(t, {
    readiness: {
      prepare: async () => {
        if (insideFence) finalPreparations++;
      },
      assertReady: async () => {
        if (insideFence) {
          finalReadyChecks++;
          throw new Error('Synthetic passive readiness unavailable');
        }
      },
    },
  });
  const proposal = await (await f.http('quote-proposals', f.body)).json();
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
  f.availability(async (phase) => {
    if (phase !== 'final') return true;
    assert.equal(insideFence, true);
    entered.release();
    await held.promise;
    assert.equal(insideFence, true);
    return true;
  });
  const response = f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  try {
    await entered.promise;
    await setImmediate();
    assert.equal(finalPreparations, 0);
    assert.equal(finalReadyChecks, 0, 'passive readiness follows the final stock read');
    held.release();
    assert.equal((await response).status, 503);
    assert.equal(finalReadyChecks, 1);
    assert.equal(finalPreparations, 0);
    assert.equal(insideFence, false);
    assert.equal(f.signings(), 0);
    assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
  } finally {
    held.release();
    await response;
  }
});

test('completed buyer acceptance replay repeats neither preparation nor authority work', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  let preparations = 0,
    proofs = 0,
    availability = 0;
  const f = await fixture(t, {
    readiness: {
      prepare: async () => {
        preparations++;
      },
      assertReady: async () => {
        proofs++;
      },
    },
  });
  f.availability(() => {
    availability++;
    return true;
  });
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 200);
  const before = { preparations, proofs, availability, signings: f.signings() };
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 200);
  assert.deepEqual({ preparations, proofs, availability, signings: f.signings() }, before);
});

for (const stage of ['proposal', 'final acceptance'] as const) {
  test(`buyer ${stage} checks current readiness after stock if evidence expired during preparation`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    const entered = gate(),
      held = gate();
    let checking = stage === 'proposal',
      preparations = 0,
      proofReads = 0;
    const f = await fixture(t, {
      readiness: {
        prepare: async () => {
          if (checking) preparations++;
        },
        assertReady: async () => {
          if (!checking) return;
          proofReads++;
          if (+f.now() >= expiresAt) throw new Error('Synthetic release evidence expired');
        },
      },
    });
    const expiresAt = +f.now() + 30000;
    f.availability(async () => {
      if (!checking) return true;
      entered.release();
      await held.promise;
      return true;
    });
    let response: Promise<Response>;
    if (stage === 'proposal') response = f.http('quote-proposals', f.body);
    else {
      const proposal = await (await f.http('quote-proposals', f.body)).json();
      const accept = f.core.acceptedQuotes.accept.bind(f.core.acceptedQuotes);
      f.core.acceptedQuotes.accept = (input, commit) =>
        accept(input, async () => {
          checking = true;
          try {
            return await commit();
          } finally {
            checking = false;
          }
        });
      response = f.http(`quote-proposals/${proposal.proposalId}/accept`, {
        capability: f.session.capability,
        hash: proposal.hash,
        idempotencyKey: randomUUID(),
      });
    }
    try {
      await entered.promise;
      await setImmediate();
      assert.equal(preparations, stage === 'proposal' ? 1 : 0);
      assert.equal(proofReads, 0, 'authority is checked after stock, not cached from preparation');
      f.advance(31000);
      held.release();
      assert.equal((await response).status, 503);
      assert.equal(proofReads, 1);
      assert.equal(f.signings(), 0);
      assert.equal((await f.pool.query('SELECT 1 FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rowCount, 0);
    } finally {
      held.release();
      await response;
    }
  });
}

test('readiness without preparation preserves the original serial availability fallback', {
  skip: !database,
  timeout: 15000,
}, async (t) => {
  const entered = gate(),
    held = gate();
  let proofReads = 0;
  const f = await fixture(t, {
    readiness: {
      assertReady: async () => {
        proofReads++;
      },
    },
  });
  f.availability(async () => {
    entered.release();
    await held.promise;
    return true;
  });
  const response = f.http('quote-proposals', f.body);
  try {
    await entered.promise;
    await setImmediate();
    assert.equal(proofReads, 0);
    held.release();
    assert.equal((await response).status, 200);
    assert.equal(proofReads, 1);
  } finally {
    held.release();
    await response;
  }
});

for (const stage of ['release-prepare', 'current-readiness', 'persistence', 'owned-history'] as const) {
  test(`proposal ${stage} failure is request-local and preserves proposal facts without issuing acceptance`, {
    skip: !database,
    timeout: 15000,
  }, async (t) => {
    const seen: BuyerFailureDiagnostic[] = [];
    const error = Object.assign(new Error('SECRET-provider-body'), { cause: new Error('SECRET-capability') });
    const f = await fixture(t, {
      diagnostic: (value) => seen.push(value),
      readiness: {
        prepare: async () => {
          if (stage === 'release-prepare') throw error;
        },
        assertReady: async () => {
          if (stage === 'current-readiness') throw error;
        },
      },
    });
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
