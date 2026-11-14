import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { createWorkerPublicationAbandonment } from '../dist/publication-abandonment.js';

type Input = Parameters<typeof createWorkerPublicationAbandonment>[0];
type Options = Parameters<Input['core']['publicationAbandonment']['create']>[0];

function setup(env: Record<string, string | undefined>) {
  const lines: Record<string, unknown>[] = [];
  const observability = createObservability({
    stream: new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  });
  let options: Options | undefined;
  const core: Input['core'] = {
    publicationAbandonment: {
      create(value) {
        options = value;
        return {
          async runPass() {
            value.onEvent?.({
              shopId: 'shop-1',
              configId: 'config-1',
              operationId: 'op-1',
              outcome: 'restored',
              reasons: [],
            });
            value.onEvent?.({
              shopId: 'shop-1',
              configId: 'config-1',
              operationId: 'op-2',
              outcome: 'flagged',
              reasons: ['fields_written'],
            });
            return { restored: 1, finalized: 1, flagged: 1, flaggedHolds: 3 };
          },
        };
      },
    },
  };
  const created = createWorkerPublicationAbandonment({
    core,
    env,
    appClientId: 'a'.repeat(32),
    credentials: { acquire: async () => ({ kind: 'missing' }) },
    observability,
  });
  return { created, lines, observability, options: () => options };
}

test('#466 B: the worker pass is off by default and validates its bounds at startup', () => {
  assert.equal(setup({}).created, undefined);
  assert.throws(() =>
    setup({ INSIGNIA_PUBLICATION_ABANDONMENT: 'restore', INSIGNIA_PUBLICATION_ABANDON_AFTER_MS: '60000' }),
  );
  assert.throws(() => setup({ INSIGNIA_PUBLICATION_ABANDONMENT: 'yes' }));
  const flag = setup({ INSIGNIA_PUBLICATION_ABANDONMENT: 'flag' });
  assert.equal(flag.created?.mode, 'flag');
  assert.equal(flag.options()?.mode, 'flag');
  assert.equal(flag.options()?.abandonAfterMs, 600_000);
});

test('#466 B: restored logs at info, flagged at warn, with bounded labels and the flagged gauge', async () => {
  const s = setup({ INSIGNIA_PUBLICATION_ABANDONMENT: 'restore', INSIGNIA_PUBLICATION_ABANDON_AFTER_MS: '300000' });
  assert.equal(s.options()?.abandonAfterMs, 300_000);
  await s.created?.runOnce();
  assert.deepEqual(
    s.lines.map((line) => [line.level, line.event, line.outcome, line.reasons, line.operationId]),
    [
      [30, 'publication_abandonment', 'restored', [], 'op-1'],
      [40, 'publication_abandonment', 'flagged', ['fields_written'], 'op-2'],
    ],
  );
  const metrics = await s.observability.registry.metrics();
  assert.match(metrics, /insignia_publication_abandonment_total\{outcome="restored"\} 1/);
  assert.match(metrics, /insignia_publication_abandonment_total\{outcome="flagged"\} 1/);
  assert.match(metrics, /insignia_publication_holds_flagged 3/);
  assert.doesNotMatch(metrics, /shop-1/);
});
