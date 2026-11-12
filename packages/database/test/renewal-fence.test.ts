import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  acceptQuote,
  type QuoteAuthorityPorts,
  type QuoteRenewalStore,
  type QuoteRequest,
  renewQuote,
  SigningKeyLifecycle,
} from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQuoteAuthorityPorts } from '../../../apps/web/src/server/quote-composition.ts';
import { createDurableCore } from '../dist/durable-core.js';
import { type Database, withTransaction } from '../src/client/database.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { acceptance } from './support/acceptance.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

type Fixture = Awaited<ReturnType<typeof purchaseFixture>>;
type Core = ReturnType<typeof createDurableCore>;

// Lean pricing accepts one final nonnegative surcharge per method/placement/size.
const leanRule = {
  id: 'lean-unit',
  scope: { kind: 'step', placementId: 'front', methodId: 'method', stepId: 'step' },
  role: 'unit',
  rate: { kind: 'fixed', amount: { shopDecimal: '1.00', presentmentOverrides: [] } },
};
const ownerBinding = 'b'.repeat(64);

/** #386: renewal prices and observes readiness before its shop fence, like acceptance. */
describe.runIf(Boolean(process.env.DATABASE_URL))('renewal fence', () => {
  let database: Kysely<Database>;
  let observer: Pool;
  beforeAll(async () => {
    database = await openTestDatabase();
    observer = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });
  afterAll(async () => {
    await Promise.all([database?.destroy(), observer?.end()]);
  });

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
  const scopeOf = (fixture: Fixture) => ({
    shopId: fixture.shopId,
    installationGeneration: fixture.generation,
    authorizationGeneration: fixture.authorizationGeneration,
    authorizationEpoch: fixture.authorizationEpoch,
  });

  /**
   * Production buyer composition (stored reads on the shared pool) over a real accepted quote, with synthetic
   * provider reads. `beforeFence` runs after preparation, before the renewal takes the shop fence; `inFence`
   * runs first inside it. Provider reads made while the fence is held are recorded.
   */
  async function renewalFixture(core: Core) {
    const fixture = await purchaseFixture(database, { pricingRules: [leanRule] });
    const scope = scopeOf(fixture);
    const keys = new SigningKeyLifecycle(core.signingKeys);
    const selectedKeyId = 7;
    let fenced = false;
    const providerReadsInFence: string[] = [];
    const provider = async <T>(name: string, value: () => T): Promise<T> => {
      if (fenced) providerReadsInFence.push(name);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return value();
    };
    const observe: NonNullable<QuoteAuthorityPorts['readiness']['observe']> = async ({ quote }) => {
      // Production readiness: release evidence, public config and Function ownership from Shopify, and the
      // effective revisions from the store; inside the fence only the stored signing-key configuration.
      await provider('release-and-functions', () => undefined);
      const effective = await Promise.all(
        quote.effectiveRevisions.map((revision) => core.acceptedQuotes.getEffective(quote.shopId, revision.productId)),
      );
      if (effective.some((row) => !row)) throw new Error('effective revision unavailable');
      return {
        async assertCurrent() {
          await keys.desiredPublicConfig(scope, new Date());
          // Production readiness compares the key selected before the fence with the active durable key.
          const active = (await core.signingKeys.list(scope)).filter((key) => key.state === 'active');
          if (active.length !== 1 || active[0]?.keyId !== selectedKeyId) throw new Error('Buyer signing key changed');
        },
      };
    };
    let signatures = 0;
    const base = createQuoteAuthorityPorts({
      core,
      appId: 'gid://shopify/App/7',
      entitlementPolicy: { policyVersion: 'synthetic', maxAgeMs: 60000, plans: [] },
      readSubscription: async () => {
        throw new Error('synthetic entitlement is injected below');
      },
      credentials: {
        acquire: async () => {
          throw new Error('synthetic providers need no credential');
        },
      },
      catalogTransport: {
        execute: async () => {
          throw new Error('synthetic catalog is injected below');
        },
      },
      artwork: {
        replayBinding: () => ownerBinding,
        readUsability: (input) =>
          provider('artwork', () =>
            input.choices.map((choice) => ({
              ...choice,
              shopId: input.shopId,
              installationGeneration: input.installationGeneration,
              status: 'usable' as const,
              lastFullyUsableLocalDay: 99999,
              observedAt: new Date().toISOString(),
            })),
          ),
      },
      signing: {
        keyId: 7,
        signer: {
          async signWholeQuote(input) {
            signatures++;
            return {
              keyId: 7,
              publicKeyFingerprint: fixture.publicKeyFingerprint,
              firstValidDay: 20000,
              lastValidDay: 21000,
              signature: sign(null, input.message, fixture.keys.privateKey),
            };
          },
        },
      },
      readiness: {
        observe,
        assertReady: async (target) => (await observe(target)).assertCurrent(),
      },
    });
    const ports: QuoteAuthorityPorts = {
      ...base,
      leanContext: { assertSupported: () => provider('primary-market', () => undefined) },
      shop: {
        getContext: () =>
          provider('shop', () => ({
            shopId: fixture.shopId,
            installationGeneration: fixture.generation,
            shopifyShopGid: `gid://shopify/Shop/${fixture.shopifyShopId}`,
            currency: 'USD',
            timezone: 'UTC',
          })),
      },
      entitlement: {
        getFresh: () =>
          provider('subscription', () => ({
            active: true,
            freshness: 'fresh' as const,
            recognizedPolicyId: 'synthetic',
            policyVersion: 'synthetic',
            trial: false,
            qualifyingUsageDisposition: 'NOT_METERED' as const,
          })),
      },
      catalog: {
        resolveVariantContext: (target) =>
          provider('contextual-price', () =>
            target.variantIds.map((variantId) => ({
              shopId: fixture.shopId,
              installationGeneration: fixture.generation,
              productId: target.productId,
              variantId,
              productIdVerified: true as const,
              context: { country: 'US' },
              amount: '10.00',
              currencyCode: 'USD',
              sourceApiVersion: '2026-07',
              observedAt: new Date().toISOString(),
              freshUntil: new Date(Date.now() + 60000).toISOString(),
              correlation: { requestId: 'synthetic' },
            })),
          ),
      },
    };
    const request: QuoteRequest = {
      shopId: fixture.shopId,
      installationGeneration: fixture.generation,
      idempotencyKey: 'original',
      country: 'US',
      marketId: '42',
      groups: [
        {
          group: {
            version: 'm2-customization-group-v1',
            shopId: fixture.shopId,
            productId: fixture.productId,
            configRevisionId: fixture.revisionId,
            revisionContentHash: fixture.contentHash,
            design: {
              placements: [
                {
                  placementId: 'front',
                  methodId: 'method',
                  stepId: 'step',
                  artwork: { kind: 'revision', revisionId: 'art' },
                },
              ],
              options: [],
            },
            variants: [{ variantId: '1', quantity: 2 }],
          },
          sellingPlanId: null,
        },
      ],
      capacity: { ordinaryLineCount: 0, inputBytes: 100 },
    };
    const original = await acceptQuote(request, ports);
    await sql`INSERT INTO buyer_quote_ownership(shop_id,installation_generation,quote_id,proposal_id,owner_binding,request_digest,created_at)
      VALUES(${fixture.shopId},${fixture.generation}::bigint,${original.quote.quoteId}::uuid,${randomUUID()}::uuid,${ownerBinding},${'a'.repeat(64)},clock_timestamp())`.execute(
      database,
    );
    const hooks: { beforeFence: () => Promise<void>; inFence: () => Promise<void> } = {
      beforeFence: async () => {},
      inFence: async () => {},
    };
    const renewalStore: QuoteRenewalStore = {
      getOwned: (input) => core.renewalQuotes.getOwned(input),
      findCompleted: (input) => core.renewalQuotes.findCompleted(input),
      async renew(input, commit) {
        await hooks.beforeFence();
        return core.renewalQuotes.renew(input, async () => {
          fenced = true;
          try {
            await hooks.inFence();
            return await commit();
          } finally {
            fenced = false;
          }
        });
      },
    };
    const renew = (idempotencyKey: string) =>
      renewQuote(
        { quoteId: original.quote.quoteId, desired: { ...request, idempotencyKey } },
        { ...ports, renewalStore },
      );
    const renewals = async () =>
      Number(
        (
          await sql<{ n: string }>`SELECT count(*)::text n FROM quote_authorization_renewals
            WHERE quote_id=${original.quote.quoteId}::uuid`.execute(database)
        ).rows[0]?.n,
      );
    return {
      fixture,
      scope,
      original,
      hooks,
      renew,
      renewals,
      providerReadsInFence,
      signatures: () => signatures,
    };
  }

  it('lets ten concurrent acceptances in the shop through while a renewal holds the fence (production pool size)', async () => {
    // The buyer bootstrap's pool: ten connections shared by the fence holder and every waiting acceptance.
    const core = createDurableCore(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 }),
    );
    try {
      const f = await renewalFixture(core);
      let entered!: () => void;
      const holding = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.hooks.inFence = async () => {
        entered();
        await gate;
      };
      const renewal = f.renew('renewal-under-contention');
      void renewal.catch(() => {});
      await holding;
      const accepts = Array.from({ length: 10 }, (_, index) => {
        const command = acceptance(f.fixture, `contention-${index}-${randomUUID()}`);
        return core.acceptedQuotes.accept(command.input, async () => {
          await core.signingKeys.list(f.scope);
          return command.sign();
        });
      });
      for (const accept of accepts) void accept.catch(() => {});
      // The renewal holds one connection; nine acceptances wait on the shop row, the tenth for a connection.
      await lockWaiters(9);
      release();
      const settled = await Promise.allSettled([renewal, ...accepts]);
      expect(settled.map((result) => (result.status === 'rejected' ? String(result.reason) : 'ok'))).toEqual(
        Array(11).fill('ok'),
      );
      expect(f.providerReadsInFence).toEqual([]);
      expect(await f.renewals()).toBe(1);
    } finally {
      await core.close();
    }
  }, 20_000);

  it('rejects a renewal whose stored facts changed between preparation and the fence, without signing', async () => {
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
    try {
      // Epoch bump (suspected leak): the accepted quote's authorization identity is no longer current.
      const epoch = await renewalFixture(core);
      const before = epoch.signatures();
      epoch.hooks.beforeFence = async () => {
        await core.signingKeys.incrementEpoch({
          scope: epoch.scope,
          commandKey: 'renewal-epoch',
          requestDigest: 'c'.repeat(64),
        });
      };
      await expect(epoch.renew('after-epoch-bump')).rejects.toThrow('quote ownership unavailable');
      expect(epoch.signatures()).toBe(before);
      expect(await epoch.renewals()).toBe(0);

      // Republish: the effective publication operation the renewal priced against was replaced.
      const republished = await renewalFixture(core);
      republished.hooks.beforeFence = async () => {
        const { shopId, configId, revisionId, generation } = republished.fixture;
        const operationId = randomUUID();
        await withTransaction(database, (transaction) =>
          createPublicationRepository(transaction).request({
            shopId,
            configId,
            operationId,
            revisionId,
            installationGeneration: generation,
            expectedProjection: { synthetic: true },
          }),
        );
        await withTransaction(database, (transaction) =>
          createPublicationRepository(transaction).acknowledge(shopId, configId, operationId),
        );
        await withTransaction(database, (transaction) =>
          createPublicationRepository(transaction).observe({
            shopId,
            configId,
            operationId,
            projection: { synthetic: true },
          }),
        );
        expect(
          await withTransaction(database, (transaction) =>
            createPublicationRepository(transaction).activate(shopId, configId, operationId),
          ),
        ).toBe('activated');
      };
      const signed = republished.signatures();
      await expect(republished.renew('after-republish')).rejects.toMatchObject({
        name: 'BuyerRejectedError',
        code: 'REVIEW_REQUIRED',
      });
      expect(republished.signatures()).toBe(signed);
      expect(await republished.renewals()).toBe(0);

      // Key rotation: the key selected before the fence is no longer the active durable key.
      const rotated = await renewalFixture(core);
      rotated.hooks.beforeFence = async () => {
        const next = generateKeyPairSync('ed25519');
        const publicKey = next.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
        await core.signingKeys.createPending({
          scope: rotated.scope,
          keyId: 8,
          publicKey,
          publicKeyFingerprint: createHash('sha256').update(publicKey).digest('hex'),
          privateEnvelope: { v: 1, kid: 'synthetic' } as never,
          wrappingKeyId: 'synthetic',
          firstDay: 20000,
          lastDay: 21000,
        });
        await core.signingKeys.activate(rotated.scope, 8);
      };
      const beforeRotation = rotated.signatures();
      await expect(rotated.renew('after-rotation')).rejects.toThrow('Buyer signing key changed');
      expect(rotated.signatures()).toBe(beforeRotation);
      expect(await rotated.renewals()).toBe(0);

      // Uninstall: the installation the quote belongs to is deactivated.
      const uninstalled = await renewalFixture(core);
      uninstalled.hooks.beforeFence = async () => {
        expect(
          await database
            .transaction()
            .execute((transaction) =>
              createTenantRepository(transaction).deactivateCurrent(
                transaction,
                uninstalled.fixture.shopId,
                uninstalled.fixture.generation,
              ),
            ),
        ).toBe('deactivated');
      };
      const beforeUninstall = uninstalled.signatures();
      await expect(uninstalled.renew('after-uninstall')).rejects.toThrow('quote ownership unavailable');
      expect(uninstalled.signatures()).toBe(beforeUninstall);
      expect(await uninstalled.renewals()).toBe(0);
    } finally {
      await core.close();
    }
  }, 20_000);

  it('signs one renewal for concurrent requests with the same idempotency key', async () => {
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 6 }));
    try {
      const f = await renewalFixture(core);
      const before = f.signatures();
      const results = await Promise.all(Array.from({ length: 3 }, () => f.renew('same-renewal-key')));
      expect(f.signatures() - before).toBe(1);
      for (const result of results) expect(result).toEqual(results[0]);
      expect(await f.renewals()).toBe(1);
    } finally {
      await core.close();
    }
  }, 20_000);

  it('returns a retryable lock timeout within the 2 s bound while the shop fence is held', async () => {
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
    const holder = await observer.connect();
    let releaseTimer: NodeJS.Timeout | undefined;
    const holdFence = async (f: Awaited<ReturnType<typeof renewalFixture>>) => {
      await holder.query('BEGIN');
      // The fence every signing-key writer, epoch bump and uninstall takes (FOR UPDATE OF s, i).
      await holder.query('SELECT * FROM signing_key_scope($1, $2::bigint, true)', [
        f.fixture.shopId,
        f.fixture.generation,
      ]);
      // Without a bound, a waiting renewal would only finish once this holder lets go.
      releaseTimer = setTimeout(() => void holder.query('ROLLBACK').catch(() => {}), 8000);
    };
    const release = async () => {
      clearTimeout(releaseTimer);
      await holder.query('ROLLBACK').catch(() => {});
    };
    try {
      // Held before the renewal starts: the replay lookup is the first statement to wait.
      const early = await renewalFixture(core);
      await holdFence(early);
      let started = Date.now();
      await expect(early.renew('fence-held-early')).rejects.toMatchObject({ code: '55P03' });
      expect(Date.now() - started).toBeLessThan(6000);
      await release();
      // Taken after preparation: the renewal's own fence statement waits.
      const late = await renewalFixture(core);
      late.hooks.beforeFence = async () => {
        await holdFence(late);
        started = Date.now();
      };
      await expect(late.renew('fence-held-late')).rejects.toMatchObject({ code: '55P03' });
      expect(Date.now() - started).toBeLessThan(6000);
      expect(await late.renewals()).toBe(0);
    } finally {
      await release();
      holder.release();
      await core.close();
    }
  }, 30_000);
});
