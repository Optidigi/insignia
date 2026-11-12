import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SigningKeyLifecycle } from '@insignia/application';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDurableCore, createSignerKeyStore } from '../src/index.js';
import { acceptance } from './support/acceptance.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

/**
 * Opt-in local benchmark for #381 (INSIGNIA_ACCEPT_BENCHMARK=1 inside the isolated database runner).
 * It reproduces the buyer acceptance shape: a ten-connection buyer pool shared by the fence
 * transaction and the reads production makes inside it (desired public config, then the signer's
 * key re-selection), a separate four-connection signer pool, and real Ed25519 line-set signing.
 * A probe takes the rotation/epoch/revocation fence (signing_key_scope with lock) every 250 ms.
 */
const enabled = Boolean(process.env.DATABASE_URL) && process.env.INSIGNIA_ACCEPT_BENCHMARK === '1';
const seconds = Number(process.env.INSIGNIA_ACCEPT_BENCHMARK_SECONDS ?? 20);
const levels = (process.env.INSIGNIA_ACCEPT_BENCHMARK_LEVELS ?? '1,5,10,20').split(',').map(Number);

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0);
};

describe.runIf(enabled)('concurrent accept benchmark (#381)', () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });

  it(
    'measures accepts per minute, lock timeouts and latency per concurrency level',
    async () => {
      const connectionString = process.env.DATABASE_URL;
      const fixture = await purchaseFixture(database);
      // Same shape as apps/web/src/server/buyer/bootstrap.ts and apps/worker/src/signer-main.ts.
      const buyerPool = new Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      });
      const core = createDurableCore(buyerPool);
      const signer = createSignerKeyStore(
        new Pool({ connectionString, max: 4, options: '-c statement_timeout=5000ms -c lock_timeout=3000ms' }),
      );
      const probePool = new Pool({ connectionString, max: 1 });
      const lifecycle = new SigningKeyLifecycle(core.signingKeys);
      const scope = {
        shopId: fixture.shopId,
        installationGeneration: fixture.generation,
        authorizationGeneration: fixture.authorizationGeneration,
        authorizationEpoch: fixture.authorizationEpoch,
      };
      const results: Record<string, unknown>[] = [];
      try {
        for (const concurrency of levels) {
          const latencies: number[] = [];
          const failures: Record<string, number> = {};
          let accepted = 0;
          let lockTimeouts = 0;
          const deadline = Date.now() + seconds * 1000;
          const probes: number[] = [];
          let probeFailures = 0;
          let running = true;
          const probe = (async () => {
            while (running) {
              const client = await probePool.connect();
              const started = performance.now();
              try {
                await client.query('BEGIN');
                await client.query("SET LOCAL lock_timeout = '5s'");
                await client.query('SELECT * FROM signing_key_scope($1, $2::bigint, true)', [
                  scope.shopId,
                  scope.installationGeneration,
                ]);
                probes.push(performance.now() - started);
              } catch {
                probeFailures++;
              } finally {
                await client.query('ROLLBACK').catch(() => {});
                client.release();
              }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          })();
          const worker = async () => {
            while (Date.now() < deadline) {
              const next = acceptance(fixture, `bench-${randomUUID()}`);
              const started = performance.now();
              try {
                await core.acceptedQuotes.accept(next.input, async () => {
                  // assertCurrent: stored signing-key configuration at the signing instant.
                  await lifecycle.desiredPublicConfig(scope);
                  // beforeSign: the web re-confirms its key selection.
                  await core.tenants.getActiveAuthorizationScope(scope);
                  await core.signingKeys.list(scope);
                  // The signer process reads the key through its own pool, then signs.
                  await signer.store.list(scope);
                  return next.sign();
                });
                accepted++;
                latencies.push(performance.now() - started);
              } catch (error) {
                const code = (error as { code?: string }).code;
                if (code === '55P03') lockTimeouts++;
                else {
                  const key = code ?? (error instanceof Error ? error.message.slice(0, 80) : String(error));
                  failures[key] = (failures[key] ?? 0) + 1;
                }
              }
            }
          };
          const started = Date.now();
          await Promise.all(Array.from({ length: concurrency }, worker));
          const elapsedMinutes = (Date.now() - started) / 60000;
          running = false;
          await probe;
          const attempts = accepted + lockTimeouts + Object.values(failures).reduce((a, b) => a + b, 0);
          results.push({
            concurrency,
            acceptsPerMinute: Math.round(accepted / elapsedMinutes),
            attempts,
            accepted,
            lockTimeoutRate: attempts ? Number((lockTimeouts / attempts).toFixed(4)) : 0,
            lockTimeouts,
            failures,
            p50Ms: percentile(latencies, 50),
            p95Ms: percentile(latencies, 95),
            exclusiveFenceWaitP50Ms: percentile(probes, 50),
            exclusiveFenceWaitP95Ms: percentile(probes, 95),
            exclusiveFenceWaitMaxMs: probes.length ? Math.round(Math.max(...probes)) : null,
            exclusiveFenceFailures: probeFailures,
          });
        }
      } finally {
        await Promise.all([core.close(), signer.close(), probePool.end()]);
      }
      console.table(results);
      if (process.env.INSIGNIA_ACCEPT_BENCHMARK_OUT)
        writeFileSync(process.env.INSIGNIA_ACCEPT_BENCHMARK_OUT, `${JSON.stringify(results, null, 2)}\n`);
      expect(results.length).toBe(levels.length);
    },
    (seconds * levels.length + 120) * 1000,
  );
});
