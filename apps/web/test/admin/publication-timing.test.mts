import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicationTimingDiagnostic } from '@insignia/observability';
import { publicationStage, timePublication } from '../../src/server/admin/publication-timing.ts';

function clock() {
  let at = 1000;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test('publish timing nests spans in call order and reports integer milliseconds once', async () => {
  const time = clock();
  const reports: PublicationTimingDiagnostic[] = [];
  const result = await timePublication(
    async () => {
      time.advance(5);
      await publicationStage('preparation', async () => {
        time.advance(2);
        await publicationStage('release-collect', async () => time.advance(4.7));
      });
      await publicationStage('command', async () => time.advance(1));
      return 'done';
    },
    () => ({ outcome: 'accepted', state: 'ACTIVE' }),
    (timing) => reports.push(timing),
    time.now,
  );
  assert.equal(result, 'done');
  assert.equal(reports.length, 1);
  const [timing] = reports;
  assert.match(timing?.correlationId ?? '', /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...timing, correlationId: undefined },
    {
      correlationId: undefined,
      outcome: 'accepted',
      state: 'ACTIVE',
      totalMs: 12,
      truncated: false,
      spans: [
        { id: 1, parentId: null, stage: 'preparation', offsetMs: 5, durationMs: 6, outcome: 'success' },
        { id: 2, parentId: 1, stage: 'release-collect', offsetMs: 7, durationMs: 4, outcome: 'success' },
        { id: 3, parentId: null, stage: 'command', offsetMs: 11, durationMs: 1, outcome: 'success' },
      ],
    },
  );
});

test('a failing publish rethrows its own error; a throwing report never changes the result', async () => {
  const time = clock();
  const failure = new Error('provider unavailable');
  const reports: PublicationTimingDiagnostic[] = [];
  let pending: Promise<unknown> | undefined;
  await assert.rejects(
    timePublication(
      async () => {
        // A started sibling still running when the request fails is reported as unfinished.
        pending = publicationStage('eligibility', () => new Promise((resolve) => setTimeout(resolve, 5)));
        time.advance(3);
        await publicationStage('command', async () => {
          throw failure;
        });
      },
      (settled) => {
        assert.equal('error' in settled && settled.error, failure);
        return { outcome: 'failure' };
      },
      (timing) => reports.push(timing),
      time.now,
    ),
    (error) => error === failure,
  );
  await pending;
  assert.deepEqual(
    reports[0]?.spans.map((span) => [span.stage, span.outcome, span.durationMs]),
    [
      ['eligibility', 'unfinished', 3],
      ['command', 'failure', 0],
    ],
  );
  const value = await timePublication(
    async () => 'kept',
    () => ({ outcome: 'accepted' }),
    () => {
      throw new Error('logger down');
    },
  );
  assert.equal(value, 'kept');
});

test('without a reporter, or outside a publish request, stages only run their work', async () => {
  assert.equal(await publicationStage('command', async () => 7), 7);
  assert.equal(
    await timePublication(
      async () => publicationStage('command', async () => 8),
      () => ({ outcome: 'accepted' }),
      undefined,
    ),
    8,
  );
});

test('more than 64 spans are dropped and flagged as truncated', async () => {
  const reports: PublicationTimingDiagnostic[] = [];
  await timePublication(
    async () => {
      for (let i = 0; i < 70; i++) await publicationStage('publication-advance', async () => undefined);
    },
    () => ({ outcome: 'accepted' }),
    (timing) => reports.push(timing),
  );
  assert.equal(reports[0]?.spans.length, 64);
  assert.equal(reports[0]?.truncated, true);
});
