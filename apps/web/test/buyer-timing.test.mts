import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleBuyerRequest } from '../src/server/buyer/http.ts';
import { buyerFixture, coreFixture } from './http-fixtures.mts';

test('proposal failures emit one bounded timing summary with the existing HTTP correlation', async () => {
  const seen: unknown[] = [];
  const response = await handleBuyerRequest(
    new Request('https://app.invalid/private?SECRET', { method: 'POST' }),
    undefined,
    'quote-proposals',
    () => {},
    (value) => seen.push(value),
  );
  const body = await response.json();
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { correlationId: string }).correlationId, body.requestId);
  assert.equal(response.headers.get('X-Insignia-Request-Id'), body.requestId);
  assert.match(response.headers.get('Server-Timing') ?? '', /^insignia;dur=\d+;desc="[a-f0-9-]{36}"$/);
  assert.equal((seen[0] as { outcome: string }).outcome, 'failure');
  assert.doesNotMatch(JSON.stringify(seen), /SECRET|private|https/);
});

import {
  proposalDiagnostics,
  proposalFailureStage,
  proposalStage,
  proposalTiming,
} from '../src/server/buyer/diagnostics.ts';

test('timings retain nested and parallel relationships with deterministic elapsed offsets and original failures', async () => {
  let now = 100;
  const error = new Error('SECRET');
  await proposalDiagnostics(
    async () => {
      await proposalStage('prepare', async () => {
        now = 105;
        const a = proposalStage('availability', async () => {
          now = 108;
          throw error;
        });
        const b = proposalStage('release-prepare', async () => {
          now = 112;
        });
        await Promise.allSettled([a, b]);
        now = 120;
      });
      assert.equal(proposalFailureStage(error), 'availability');
      assert.deepEqual(proposalTiming('id', 'proposal', 'success'), {
        correlationId: 'id',
        operation: 'proposal',
        outcome: 'success',
        totalMs: 20,
        truncated: false,
        spans: [
          { id: 1, parentId: null, stage: 'prepare', offsetMs: 0, durationMs: 20, outcome: 'success' },
          { id: 2, parentId: 1, stage: 'availability', offsetMs: 5, durationMs: 7, outcome: 'failure' },
          { id: 3, parentId: 1, stage: 'release-prepare', offsetMs: 8, durationMs: 4, outcome: 'success' },
        ],
      });
    },
    () => now,
  );
  assert.equal(proposalTiming('id', 'proposal', 'success'), undefined);
});

test('reused errors stay ambiguous and summaries cap spans without changing execution', async () => {
  const error = new Error('SECRET');
  await proposalDiagnostics(async () => {
    const outcomes = await Promise.allSettled(
      ['tenant', 'shop'].map((stage) =>
        proposalStage(stage as 'tenant' | 'shop', () => {
          throw error;
        }),
      ),
    );
    for (const result of outcomes) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') assert.equal(result.reason, error);
    }
    assert.equal(proposalFailureStage(error), 'ambiguous');
    for (let i = 0; i < 100; i++) await proposalStage('revision', () => {});
    const summary = proposalTiming('id', 'acceptance', 'success');
    assert.ok(summary);
    assert.equal(summary.spans.length, 64);
    assert.equal(summary.truncated, true);
    await proposalDiagnostics(async () => {
      assert.equal(proposalFailureStage(error), undefined);
      assert.equal(proposalTiming('id', 'proposal', 'success')?.spans.length, 0);
    });
  });
});

test('cancelled requests and throwing telemetry preserve HTTP settlement', async () => {
  const controller = new AbortController();
  controller.abort();
  let outcome = '';
  const response = await handleBuyerRequest(
    new Request('https://app.invalid', { method: 'POST', signal: controller.signal }),
    undefined,
    'quote-proposals/id/accept',
    () => {
      throw new Error('SECRET');
    },
    (value) => {
      outcome = value.outcome;
      throw new Error('SECRET');
    },
  );
  assert.equal(response.status, 503);
  assert.equal(outcome, 'cancelled');
});

for (const cancelAfterSettlement of [false, true])
  test(`successful proposal preserves settlement when transport cancellation is ${cancelAfterSettlement}`, async () => {
    const controller = new AbortController();
    let businessSettled = false;
    const seen: import('@insignia/observability').BuyerTimingDiagnostic[] = [];
    const post = (body: unknown) =>
      new Request('https://app.invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    const services = buyerFixture({
      guest: {
        verify: async () => ({
          kind: 'guest',
          shopId: 'tenant',
          installationGeneration: '1',
          ownerHash: 'f'.repeat(64),
        }),
      },
      store: coreFixture({
        buyers: {
          getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }),
          admitRequest: async () => {},
        },
      }).buyers,
      propose: async (_scope, body) => {
        const selection = body.groups[0];
        assert.ok(selection);
        businessSettled = true;
        if (cancelAfterSettlement) controller.abort();
        return {
          proposalId: '01234567-89ab-4cde-8123-456789abcdef',
          hash: 'a'.repeat(64),
          expiresAt: '2099-01-01T00:00:00Z',
          currency: 'USD',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: '100',
          groups: [
            {
              canonicalIdentitySha256: 'b'.repeat(64),
              selection,
              productId: '111',
              quantity: 1,
              setupMinor: '0',
              customizationUnitMinor: '0',
              baseTotalMinor: '100',
              totalMinor: '100',
            },
          ],
          changedGroups: [],
        };
      },
    });
    const response = await handleBuyerRequest(
      post({
        capability: 'synthetic.signature',
        country: 'US',
        marketId: '42',
        capacity: { ordinaryLineCount: 0, inputBytes: 100 },
        groups: [
          {
            productId: '111',
            configRevisionId: 'revision',
            revisionContentHash: 'a'.repeat(64),
            design: {
              placements: [
                {
                  placementId: 'front',
                  methodId: 'print',
                  stepId: 'small',
                  artwork: { kind: 'deferred', intentId: 'later' },
                },
              ],
              options: [],
            },
            variants: [{ variantId: '222', quantity: 1 }],
          },
        ],
      }),
      services,
      'quote-proposals',
      () => {},
      (value) => seen.push(value),
    );
    assert.equal(response.status, 200);
    assert.equal(businessSettled, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.outcome, cancelAfterSettlement ? 'cancelled' : 'success');
    assert.equal(response.headers.get('X-Insignia-Request-Id'), seen[0]?.correlationId);
    assert.deepEqual(
      seen[0]?.spans.map((s) => [s.stage, s.outcome]),
      [
        ['prepare', 'success'],
        ['response-validation', 'success'],
      ],
    );
  });

test('acceptance timing preserves terminal decline and malformed-success response handling', async () => {
  const { BuyerAcceptanceDeclinedError } = await import('@insignia/application');
  for (const suffix of ['', '/', '/extra'])
    for (const decline of [true, false]) {
      const seen: import('@insignia/observability').BuyerTimingDiagnostic[] = [];
      const failures: import('@insignia/observability').BuyerFailureDiagnostic[] = [];
      const services = buyerFixture({
        guest: {
          verify: async () => ({
            kind: 'guest',
            shopId: 'tenant',
            installationGeneration: '1',
            ownerHash: 'f'.repeat(64),
          }),
        },
        store: coreFixture({
          buyers: { getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }) },
        }).buyers,
        accept: async () => {
          if (decline) throw new BuyerAcceptanceDeclinedError();
          return { secret: 'SECRET' } as never;
        },
      });
      const response = await handleBuyerRequest(
        new Request('https://app.invalid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            capability: 'synthetic.signature',
            hash: 'a'.repeat(64),
            idempotencyKey: '01234567-89ab-4cde-8123-456789abcdee',
          }),
        }),
        services,
        `quote-proposals/01234567-89ab-4cde-8123-456789abcdef/accept${suffix}`,
        (value) => failures.push(value),
        (value) => seen.push(value),
      );
      assert.equal(response.status, decline ? 409 : 503);
      const body = await response.json();
      assert.equal(body.acceptanceOutcome, decline ? 'declined' : undefined);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.operation, 'acceptance');
      assert.equal(seen[0]?.correlationId, body.requestId);
      assert.equal(seen[0]?.outcome, 'failure');
      assert.equal(failures[0]?.proposalStage, decline ? 'prepare' : 'response-validation');
      assert.doesNotMatch(JSON.stringify({ body, seen, failures }), /SECRET|synthetic-key/);
    }
});

test('failure summaries distinguish an unfinished sibling from completed successful work', async () => {
  let now = 100;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await proposalDiagnostics(
    async () => {
      const sibling = proposalStage('release-prepare', () => held);
      try {
        await assert.rejects(
          proposalStage('availability', () => {
            throw new Error('stock unavailable');
          }),
        );
        now = 112;
        const summary = proposalTiming('id', 'proposal', 'failure');
        assert.equal(summary?.spans[0]?.outcome, 'unfinished');
        assert.equal(summary?.spans[0]?.durationMs, 12);
        assert.equal(summary?.spans[1]?.outcome, 'failure');
        release();
        await sibling;
        assert.equal(summary?.spans[0]?.outcome, 'unfinished', 'an emitted snapshot cannot change later');
        assert.equal(proposalTiming('id', 'proposal', 'failure')?.spans[0]?.outcome, 'success');
      } finally {
        release();
        await sibling;
      }
    },
    () => now,
  );
});

test('presentation reads do not emit proposal timings or diagnostic response headers', async () => {
  let summaries = 0;
  const response = await handleBuyerRequest(
    new Request('https://app.invalid/v1/config'),
    undefined,
    'config',
    () => {},
    () => {
      summaries++;
    },
  );
  assert.equal(response.status, 503);
  assert.equal(summaries, 0);
  assert.equal(response.headers.get('Server-Timing'), null);
  assert.equal(response.headers.get('X-Insignia-Request-Id'), null);
});
