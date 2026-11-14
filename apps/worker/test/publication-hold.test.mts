import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperatorCommandError } from '@insignia/database';
import { runPublicationHoldCommand } from '../dist/publication-hold.js';

type Deps = Parameters<typeof runPublicationHoldCommand>[1];
type Operator = Awaited<ReturnType<Deps['operator']>>;

function harness(operator: Partial<Operator> = {}) {
  const lines: Record<string, unknown>[] = [];
  const calls: unknown[] = [];
  let opened = 0;
  const run = (argv: string[]) =>
    runPublicationHoldCommand(argv, {
      now: () => new Date('2026-11-14T12:00:00.000Z'),
      write: (line) => {
        assert.ok(line.endsWith('\n') && !line.slice(0, -1).includes('\n'), 'one JSON line per run');
        lines.push(JSON.parse(line));
      },
      operator: () => {
        opened++;
        return {
          inspect: async (input) => {
            calls.push(['inspect', input]);
            return { shopId: input.shopId, configId: input.configId, holds: [] };
          },
          restore: async (input) => {
            calls.push(['restore', input]);
            return { outcome: 'restored', reasons: [], kind: 'ABANDON_RESTORED', phase: 'abandoned', status: 'failed' };
          },
          resolve: async (input) => {
            calls.push(['resolve', input]);
            return {
              kind: 'RESOLVED',
              resolution: { version: 'm5-availability-resolution-v3', createdAt: '2026-11-14T12:00:00.000Z' },
            } as Awaited<ReturnType<Operator['resolve']>>;
          },
          ...operator,
        } as Operator;
      },
    });
  return { run, lines, calls, opened: () => opened };
}
const base = ['--shop', 'shop-1', '--config', 'config-1'];

test('inspect is read only, needs no confirmation and writes one audit line with the findings', async () => {
  const h = harness();
  assert.equal(await h.run(['inspect', ...base]), 0);
  assert.deepEqual(h.calls, [['inspect', { shopId: 'shop-1', configId: 'config-1' }]]);
  assert.deepEqual(h.lines, [
    {
      event: 'publication_hold_command',
      at: '2026-11-14T12:00:00.000Z',
      command: 'inspect',
      shopId: 'shop-1',
      configId: 'config-1',
      outcome: 'inspected',
      reasons: [],
      holds: [],
    },
  ]);
  assert.equal(await h.run(['inspect', ...base, '--confirm']), 2);
  assert.equal(await h.run(['inspect', ...base, '--operation', 'op-1']), 2);
});

test('restore and resolve refuse without --confirm, before opening the database', async () => {
  const h = harness();
  const restore = [
    'restore',
    ...base,
    '--operation',
    'op-1',
    '--inspect-digest',
    `1763121600000.${'a'.repeat(64)}`,
    '--command-key',
    'k1',
  ];
  assert.equal(await h.run(restore), 2);
  assert.equal(await h.run(['resolve', ...base, '--operation', 'op-1', '--command-key', 'k1']), 2);
  assert.equal(h.opened(), 0);
  assert.deepEqual(
    h.lines.map((line) => line.reasons),
    [['confirmation_required'], ['confirmation_required']],
  );
  assert.equal(await h.run([...restore, '--confirm']), 0);
  assert.deepEqual(h.calls, [
    [
      'restore',
      {
        shopId: 'shop-1',
        configId: 'config-1',
        operationId: 'op-1',
        inspectDigest: `1763121600000.${'a'.repeat(64)}`,
        commandKey: 'k1',
      },
    ],
  ]);
  assert.deepEqual(h.lines.at(-1), {
    event: 'publication_hold_command',
    at: '2026-11-14T12:00:00.000Z',
    command: 'restore',
    shopId: 'shop-1',
    configId: 'config-1',
    operationId: 'op-1',
    commandKey: 'k1',
    inspectDigest: `1763121600000.${'a'.repeat(64)}`,
    confirmed: true,
    outcome: 'restored',
    reasons: [],
    kind: 'ABANDON_RESTORED',
    phase: 'abandoned',
    status: 'failed',
  });
});

test('usage errors: unknown commands, flags, duplicates, missing values and unsafe characters', async () => {
  const h = harness();
  for (const argv of [
    [],
    ['delete', ...base],
    ['inspect', '--shop', 'shop-1'],
    ['inspect', ...base, '--shop', 'shop-2'],
    ['inspect', ...base, '--verbose'],
    ['inspect', '--shop', '--config', 'config-1'],
    ['inspect', '--shop', 'shop 1', '--config', 'config-1'],
    ['inspect', '--shop', "shop'1", '--config', 'config-1'],
    ['resolve', ...base, '--command-key', 'k', '--confirm'],
    ['resolve', ...base, '--operation', 'op', '--command-key', 'k', '--inspect-digest', 'x', '--confirm'],
  ])
    assert.equal(await h.run(argv), 2, argv.join(' '));
  assert.equal(h.opened(), 0);
  assert.ok(h.lines.every((line) => line.outcome === 'refused'));
});

test('a refusal or failure exits 1 with a bounded reason and never the error text', async () => {
  const refused = harness({
    restore: async () => ({
      outcome: 'refused',
      reasons: ['product_changed'],
      kind: 'OPERATOR_HOLD',
      phase: 'prepared',
      status: 'requested',
    }),
    resolve: async () => {
      throw new OperatorCommandError('command_key_used');
    },
  });
  const restore = [
    'restore',
    ...base,
    '--operation',
    'op-1',
    '--inspect-digest',
    'x',
    '--command-key',
    'k',
    '--confirm',
  ];
  assert.equal(await refused.run(restore), 1);
  assert.deepEqual(refused.lines.at(-1)?.reasons, ['product_changed']);
  assert.equal(await refused.run(['resolve', ...base, '--operation', 'op-1', '--command-key', 'k', '--confirm']), 1);
  assert.deepEqual(refused.lines.at(-1)?.reasons, ['command_key_used']);

  const failing = harness({
    resolve: async () => {
      throw new Error('Original v3 availability not observed; operator hold retained');
    },
    inspect: async () => {
      throw new Error('connect ECONNREFUSED postgres://secret@db');
    },
  });
  assert.equal(await failing.run(['resolve', ...base, '--operation', 'op-1', '--command-key', 'k', '--confirm']), 1);
  assert.deepEqual(failing.lines.at(-1)?.reasons, ['original_not_observed']);
  assert.equal(await failing.run(['inspect', ...base]), 1);
  assert.deepEqual(failing.lines.at(-1)?.reasons, ['error']);
  assert.ok(!JSON.stringify(failing.lines).includes('secret'));
});
