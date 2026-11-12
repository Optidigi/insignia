import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { materialHash } from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { createDurableCore } from '../src/index.js';
import { acceptance } from './support/acceptance.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

/** #381: what the acceptance fence protects, exercised at the real lock boundary. */
describe.runIf(Boolean(process.env.DATABASE_URL))('acceptance fence', () => {
  let database: Kysely<Database>;
  let observer: Pool;
  beforeAll(async () => {
    database = await openTestDatabase();
    observer = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });
  afterAll(async () => {
    await Promise.all([database?.destroy(), observer?.end()]);
  });

  /** Resolves once `count` other backends wait on a heavyweight lock (tuple or transaction). */
  async function lockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await observer.query<{ n: string }>(
        `SELECT count(*)::text n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,
      );
      if (Number(rows[0]?.n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${count} lock waiter(s)`);
  }
  const scopeOf = (fixture: Awaited<ReturnType<typeof purchaseFixture>>) => ({
    shopId: fixture.shopId,
    installationGeneration: fixture.generation,
    authorizationGeneration: fixture.authorizationGeneration,
    authorizationEpoch: fixture.authorizationEpoch,
  });

  /**
   * Two pool connections: `hold` takes the shop fence on one, then a queued acceptance waits for the
   * fence on the other. The holder's stored-fact reads (production: readiness and the signer's key
   * re-selection) must not need the second connection, or both wait until the acceptance lock timeout.
   */
  async function holderWithQueuedAcceptance(
    hold: (core: ReturnType<typeof createDurableCore>, inside: () => Promise<void>) => Promise<unknown>,
    fixture: Awaited<ReturnType<typeof purchaseFixture>>,
  ) {
    const scope = scopeOf(fixture);
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }));
    try {
      let entered!: () => void;
      const holding = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const holder = hold(core, async () => {
        entered();
        await lockWaiters(1);
        await core.tenants.getActiveAuthorizationScope(scope);
        await core.signingKeys.list(scope);
      });
      void holder.catch(() => {});
      await holding;
      const queued = acceptance(fixture, `queued-${randomUUID()}`);
      const started = Date.now();
      const waiter = core.acceptedQuotes.accept(queued.input, async () => {
        await core.signingKeys.list(scope);
        return queued.sign();
      });
      const settled = await Promise.allSettled([holder, waiter]);
      return { settled, elapsedMs: Date.now() - started };
    } finally {
      await core.close();
    }
  }

  it('reads stored signing facts on the acceptance fence connection, so a queued acceptance cannot starve it of the pool', async () => {
    const fixture = await purchaseFixture(database);
    const first = acceptance(fixture, 'pool-first');
    const { settled, elapsedMs } = await holderWithQueuedAcceptance(
      (core, inside) =>
        core.acceptedQuotes.accept(first.input, async () => {
          await inside();
          return first.sign();
        }),
      fixture,
    );
    expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('reads stored signing facts on the renewal fence connection too', async () => {
    const fixture = await purchaseFixture(database);
    const ownerBinding = 'b'.repeat(64);
    await sql`INSERT INTO buyer_quote_ownership(shop_id,installation_generation,quote_id,proposal_id,owner_binding,request_digest,created_at)
      VALUES(${fixture.shopId},${fixture.generation}::bigint,${fixture.quote.quoteId}::uuid,${randomUUID()}::uuid,${ownerBinding},${'a'.repeat(64)},clock_timestamp())`.execute(
      database,
    );
    const { settled, elapsedMs } = await holderWithQueuedAcceptance(
      (core, inside) =>
        core.renewalQuotes.renew(
          {
            ...scopeOf(fixture),
            effectiveRevisions: fixture.quote.effectiveRevisions,
            quoteId: fixture.quote.quoteId,
            ownerBinding,
            idempotencyKey: 'renewal-pool',
            requestDigest: 'c'.repeat(64),
            materialHash: materialHash(fixture.quote),
          },
          async () => {
            await inside();
            // Only the fence's pool use is under test; stop before issuing a renewal.
            throw new Error('renewal stopped after stored reads');
          },
        ),
      fixture,
    );
    expect(settled[0]).toMatchObject({ status: 'rejected', reason: { message: 'renewal stopped after stored reads' } });
    expect(settled[1].status).toBe('fulfilled');
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('serializes duplicate acceptance of one command: one signature, one row, identical replays', async () => {
    const fixture = await purchaseFixture(database);
    const command = acceptance(fixture, 'duplicate-command');
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 8 }));
    try {
      let signed = 0;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          core.acceptedQuotes.accept(command.input, async () => {
            signed++;
            await new Promise((resolve) => setTimeout(resolve, 50));
            return command.sign();
          }),
        ),
      );
      expect(signed).toBe(1);
      for (const result of results) expect(result).toEqual(results[0]);
      const rows = await sql<{ n: string }>`SELECT count(*)::text n FROM accepted_quotes
        WHERE shop_id=${fixture.shopId} AND idempotency_key='duplicate-command'`.execute(database);
      expect(rows.rows[0]?.n).toBe('1');
      // Replay after commit returns the stored result without signing; a changed request conflicts.
      await expect(
        core.acceptedQuotes.accept(command.input, async () => {
          throw new Error('replay must not sign');
        }),
      ).resolves.toEqual(results[0]);
      expect(await core.acceptedQuotes.findCompleted(command.input)).toEqual(results[0]);
      await expect(
        core.acceptedQuotes.accept({ ...command.input, requestDigest: 'b'.repeat(64) }, async () => {
          throw new Error('conflict must not sign');
        }),
      ).rejects.toThrow(/idempotency digest conflict/);
    } finally {
      await core.close();
    }
  });

  it('holds an epoch bump until the acceptance commits; the stored quote then no longer replays', async () => {
    const fixture = await purchaseFixture(database);
    const scope = scopeOf(fixture);
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
    try {
      const command = acceptance(fixture, 'epoch-race');
      let bump: Promise<number> | undefined;
      let bumped = false;
      await core.acceptedQuotes.accept(command.input, async () => {
        bump = core.signingKeys.incrementEpoch({ scope, commandKey: 'epoch-race', requestDigest: 'c'.repeat(64) });
        void bump.then(() => {
          bumped = true;
        });
        await lockWaiters(1);
        expect(bumped).toBe(false);
        return command.sign();
      });
      expect(await bump).toBe(fixture.authorizationEpoch + 1);
      await expect(core.acceptedQuotes.findCompleted(command.input)).rejects.toThrow(/revoked authorization identity/);
    } finally {
      await core.close();
    }
  });

  it('rejects an acceptance that waited behind a committed epoch bump', async () => {
    const fixture = await purchaseFixture(database);
    const blocker = await observer.connect();
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT * FROM signing_key_scope($1, $2::bigint, true)', [
        fixture.shopId,
        fixture.generation,
      ]);
      await blocker.query(
        'UPDATE installation_generations SET authorization_epoch=authorization_epoch+1 WHERE shop_id=$1 AND generation=$2::bigint',
        [fixture.shopId, fixture.generation],
      );
      let signed = false;
      const command = acceptance(fixture, 'waited-epoch');
      const accepted = core.acceptedQuotes.accept(command.input, async () => {
        signed = true;
        return command.sign();
      });
      void accepted.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      await blocker.query('COMMIT');
      await expect(accepted).rejects.toThrow(/inactive tenant or installation authorization fence/);
      expect(signed).toBe(false);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await core.close();
    }
  });

  it('holds key rotation until the acceptance commits, and refuses a key retired by a rotation it waited behind', async () => {
    const fixture = await purchaseFixture(database);
    const scope = scopeOf(fixture);
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
    try {
      const next = generateKeyPairSync('ed25519');
      const publicKey = next.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      await core.signingKeys.createPending({
        scope,
        keyId: 8,
        publicKey,
        publicKeyFingerprint: createHash('sha256').update(publicKey).digest('hex'),
        privateEnvelope: { v: 1, kid: 'synthetic' } as never,
        wrappingKeyId: 'synthetic',
        firstDay: 20000,
        lastDay: 21000,
      });
      // Rotation that starts while an acceptance signs with key 7 waits for that acceptance to commit.
      const during = acceptance(fixture, 'rotation-during');
      let rotation: Promise<void> | undefined;
      let rotated = false;
      await core.acceptedQuotes.accept(during.input, async () => {
        rotation = core.signingKeys.activate(scope, 8);
        void rotation.then(() => {
          rotated = true;
        });
        await lockWaiters(1);
        expect(rotated).toBe(false);
        return during.sign();
      });
      await rotation;
      // Key 7 is now retiring: its committed quote still replays, a new signature with it is refused.
      expect(await core.acceptedQuotes.findCompleted(during.input)).toMatchObject({
        authorization: { keyId: 7 },
      });
      const after = acceptance(fixture, 'rotation-after');
      await expect(core.acceptedQuotes.accept(after.input, async () => after.sign())).rejects.toThrow(
        /signer does not match active durable key/,
      );
    } finally {
      await core.close();
    }
  });

  it('lets revocation, rotation and epoch writers in while acceptances keep arriving', async () => {
    const fixture = await purchaseFixture(database);
    const loopCount = 8;
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: loopCount + 2 }));
    const stopAt = Date.now() + 6000;
    let running = true;
    let completed = 0;
    try {
      // Overlapping acceptances: an exclusive fence queues the writer behind at most the acceptances already
      // holding or waiting (one per loop); a shared fence lets every new acceptance overtake it until the stream ends.
      const loops = Array.from({ length: loopCount }, async () => {
        while (running && Date.now() < stopAt) {
          const command = acceptance(fixture, `stream-${randomUUID()}`);
          await core.acceptedQuotes.accept(command.input, async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return command.sign();
          });
          completed++;
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const writer = await observer.connect();
      let overtaken: number;
      try {
        await writer.query('BEGIN');
        // Each wait behind a shared locker is short, so lock_timeout alone would never end a starved writer.
        await writer.query("SET LOCAL statement_timeout = '10s'");
        const before = completed;
        // The fence every signing key writer and epoch bump takes (signing_key_scope with lock).
        await writer.query('SELECT * FROM signing_key_scope($1, $2::bigint, true)', [
          fixture.shopId,
          fixture.generation,
        ]);
        overtaken = completed - before;
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
      running = false;
      await Promise.all(loops);
      expect(overtaken).toBeLessThanOrEqual(2 * loopCount);
    } finally {
      running = false;
      await core.close();
    }
  }, 20_000);
});
