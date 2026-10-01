import { randomUUID } from 'node:crypto';
import { SigningKeyLifecycle } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/postgres.js';

it('public publication factory ignores an extra admission property and exposes only scoped methods', async () => {
  const core = createDurableCore(new Pool());
  let admissionReads = 0;
  try {
    const input = {
      appId: '123',
      remote: {
        async read() {
          throw new Error('Factory must not perform provider reads');
        },
        async set() {
          throw new Error('Factory must not perform provider writes');
        },
      },
      get admission() {
        admissionReads++;
        return { established: async () => true };
      },
    };
    const publication = core.productionPublications.create(input);
    expect(admissionReads).toBe(0);
    expect(Reflect.ownKeys(publication).sort()).toEqual(['advance', 'prepare']);
  } finally {
    await core.close();
  }
});

describe.runIf(Boolean(process.env.DATABASE_URL))('PG18 public publication admission', () => {
  it.each([false, true])('first publication remains pending with spoofed admission = %s', async (spoof) => {
    // Enforce the actual integration runtime version; no database/provider mocks.
    const database = await openTestDatabase();
    await database.destroy();
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    let remoteWrites = 0;
    let admissionCalls = 0;
    try {
      const shopId = randomUUID();
      const configId = randomUUID();
      const revisionId = randomUUID();
      const operationId = randomUUID();
      await core.transactions.run(async (tx) => {
        await core.tenants.createShop(tx, {
          shopId,
          shopDomain: `${shopId}.test.example`,
          shopifyShopId: String(BigInt(`0x${shopId.replaceAll('-', '').slice(0, 12)}`) + 1n),
        });
        await core.configs.createConfig(tx, {
          shopId,
          configId,
          externalProductId: '42',
          draftSchemaVersion: 'm3-config-draft-v1',
          draftValue: {},
        });
        await core.configs.createValidatedRevision(tx, {
          shopId,
          configId,
          revisionId,
          mode: 'required',
          sourceDraftVersion: '1',
          sourceInstallationGeneration: '1',
          createdByRef: 'synthetic',
          publishedValue: {
            version: 'm2-published-config-v1',
            shopId,
            productId: '42',
            revisionId,
            shopCurrency: 'USD',
            methods: [],
            placements: [],
            productionOptions: [],
            pricingRules: [],
          },
          geometry: {
            version: 'm5-geometry-v1',
            value: {
              version: 'm5-geometry-v1',
              views: [{ id: 'front', variantImages: [], placements: [] }],
              steps: [],
            },
          },
          presentation: { version: 'm5-presentation-v1', labels: {} },
        });
      });
      const scope = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
      if (!scope) throw new Error('Synthetic installation missing');
      const lifecycle = new SigningKeyLifecycle(core.signingKeys, {
        currentKeyId: 'synthetic-wrap',
        keys: { 'synthetic-wrap': Buffer.alloc(32, 1) },
      });
      await lifecycle.createPending({ scope, keyId: 7, firstDay: 20000, lastDay: 30000, seed: Buffer.alloc(32, 2) });
      const input = {
        appId: '123',
        remote: {
          read: async () => null,
          async set() {
            remoteWrites++;
            throw new Error('Publication must not write without owned hold admission');
          },
        },
        ...(spoof
          ? {
              admission: {
                async established() {
                  admissionCalls++;
                  return true;
                },
              },
            }
          : {}),
      };
      const publication = core.productionPublications.create(input);
      await publication.prepare({ shopId, configId, revisionId, operationId, mode: 'required' });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await publication.advance(shopId, configId, operationId)).toEqual({
          kind: 'ADMISSION_PENDING',
          phase: 'prepared',
        });
      }
      expect(admissionCalls).toBe(0);
      expect(remoteWrites).toBe(0);
      expect((await core.configs.getConfig(shopId, configId))?.effectiveRevisionId).toBeNull();
      expect((await core.configs.getCurrentPublication(shopId, configId))?.phase).toBe('prepared');
    } finally {
      await core.close();
    }
  });
});
