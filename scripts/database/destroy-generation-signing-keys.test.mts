import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createDurableCore } from '../../packages/database/dist/index.js';
import {
  destroyGenerationSigningKeys,
  type GenerationKeyInspection,
  type GenerationSigningKeyPort,
} from './destroy-generation-signing-keys.mts';

const shopId = '0b5e7a8c-1d2e-4f30-8a41-5b6c7d8e9f01';
function port(inspection: GenerationKeyInspection | null) {
  const calls: string[] = [];
  const value: GenerationSigningKeyPort = {
    async inspect(shop, generation) {
      calls.push(`inspect:${shop}:${generation}`);
      return inspection;
    },
    async destroy(shop, generation) {
      calls.push(`destroy:${shop}:${generation}`);
      return inspection?.keys.filter((key) => key.state !== 'destroyed').length ?? 0;
    },
    async close() {
      calls.push('close');
    },
  };
  return { value, calls };
}
async function run(args: string[], inspection: GenerationKeyInspection | null) {
  const p = port(inspection);
  const lines: string[] = [];
  const code = await destroyGenerationSigningKeys(args, { connect: async () => p.value, write: (l) => lines.push(l) });
  return { code, calls: p.calls, output: lines.map((line) => JSON.parse(line)) };
}
const deactivated: GenerationKeyInspection = {
  deactivatedAt: '2026-11-17T02:14:00.000Z',
  keys: [
    { keyId: 1, state: 'active', holdsPrivateHalf: true },
    { keyId: 2, state: 'destroyed', holdsPrivateHalf: false },
  ],
};

test('dry run is the default: it reports the keys and destroys nothing', async () => {
  const result = await run(['--shop', shopId, '--generation', '1'], deactivated);
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [`inspect:${shopId}:1`, 'close']);
  assert.deepEqual(result.output, [
    {
      mode: 'dry-run',
      shopId,
      generation: '1',
      deactivatedAt: deactivated.deactivatedAt,
      keys: deactivated.keys,
      wouldDestroy: [1],
    },
  ]);
});

test('--apply destroys the named deactivated generation only', async () => {
  const result = await run(['--shop', shopId, '--generation', '1', '--apply'], deactivated);
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [`inspect:${shopId}:1`, `destroy:${shopId}:1`, 'close']);
  assert.deepEqual(result.output.at(-1), { mode: 'apply', shopId, generation: '1', destroyed: 1 });
});

test('an active or unknown generation is refused, also on a dry run', async () => {
  for (const inspection of [{ ...deactivated, deactivatedAt: null }, null])
    for (const apply of [[], ['--apply']]) {
      const result = await run(['--shop', shopId, '--generation', '1', ...apply], inspection);
      assert.equal(result.code, 1);
      assert.ok(!result.calls.some((call) => call.startsWith('destroy')));
      assert.equal(result.output.length, 1);
      assert.match(result.output[0].refused, /^[A-Z_]+$/);
    }
});

test('the shop and generation must be named explicitly', async () => {
  for (const args of [
    [],
    ['--shop', shopId],
    ['--generation', '1'],
    ['--shop', 'not-a-shop', '--generation', '1'],
    ['--shop', shopId, '--generation', '0'],
    ['--shop', shopId, '--generation', '1', '--force'],
    ['--shop', shopId, '--shop', randomUUID(), '--generation', '1'],
  ]) {
    const result = await run(args, deactivated);
    assert.equal(result.code, 2, args.join(' '));
    assert.deepEqual(result.calls, []);
  }
});

test('against PostgreSQL: a generation deactivated before migration 71 is destroyed only on --apply', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(pool);
  const cli = (...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./destroy-generation-signing-keys.mts', import.meta.url)), ...args],
      { encoding: 'utf8', env: process.env },
    );
    return { code: result.status, output: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  const shops = [randomUUID(), randomUUID()] as const;
  try {
    for (const [index, shop] of shops.entries()) {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId: shop, shopDomain: `${shop}.myshopify.com` }),
      );
      const publicKey = createHash('sha256').update(shop).digest();
      await pool.query(
        `INSERT INTO signing_keys(shop_id, installation_generation, authorization_generation, key_id, public_key,
          public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day, activated_at)
         SELECT $1, 1, authorization_generation, 1, $2, $3, '{"kid":"synthetic-wrap"}', 'synthetic-wrap', 'active', 100,
          2147483647, clock_timestamp() FROM installation_generations WHERE shop_id=$1 AND generation=1`,
        [shop, publicKey, createHash('sha256').update(publicKey).digest('hex')],
      );
      if (index === 1) continue;
      // The first shop was uninstalled before deactivation destroyed keys: replay that without the trigger.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'ALTER TABLE installation_generations DISABLE TRIGGER installation_deactivation_destroys_signing_keys',
        );
        await client.query(
          'UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1 AND generation=1',
          [shop],
        );
        await client.query(
          'ALTER TABLE installation_generations ENABLE TRIGGER installation_deactivation_destroys_signing_keys',
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
    const [legacy, active] = shops;
    const state = async (shop: string) =>
      (
        await pool.query<{ state: string; private_envelope: unknown; public_key: Buffer }>(
          'SELECT state, private_envelope, public_key FROM signing_keys WHERE shop_id=$1',
          [shop],
        )
      ).rows[0];
    const dryRun = cli('--shop', legacy, '--generation', '1');
    assert.equal(dryRun.code, 0);
    assert.deepEqual(dryRun.output.wouldDestroy, [1]);
    assert.deepEqual(dryRun.output.keys, [{ keyId: 1, state: 'active', holdsPrivateHalf: true }]);
    assert.equal((await state(legacy))?.state, 'active');
    assert.deepEqual(cli('--shop', active, '--generation', '1', '--apply'), {
      code: 1,
      output: { refused: 'GENERATION_ACTIVE', shopId: active, generation: '1' },
    });
    assert.equal((await state(active))?.state, 'active');
    assert.deepEqual(cli('--shop', legacy, '--generation', '1', '--apply'), {
      code: 0,
      output: { mode: 'apply', shopId: legacy, generation: '1', destroyed: 1 },
    });
    const destroyed = await state(legacy);
    assert.equal(destroyed?.state, 'destroyed');
    assert.equal(destroyed?.private_envelope, null);
    assert.ok(destroyed?.public_key.equals(createHash('sha256').update(legacy).digest()));
    assert.equal((await state(active))?.state, 'active');
  } finally {
    await core.close();
  }
});
