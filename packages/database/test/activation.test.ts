import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type {
  ActivationReadinessPort,
  ExpectedFunctionBuild,
  FunctionObjectObservation,
  ProductAvailabilityHoldPort,
  ProductAvailabilitySnapshot,
} from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import type { DurableCore } from '../src/durable-core.js';
import { CONFIG_DRAFT_STORAGE_VERSION } from '../src/repositories/config.js';
import type { ProductionPublicationRemote } from '../src/repositories/production-publication.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { openTestDatabase, openTestDurableCore } from './support/postgres.js';

// No persisted production release record: these are injected synthetic premises only.
const now = new Date('2026-10-01T12:00:00.000Z');
const fieldKeys = {
  public_config: 'insignia_public_config_v2',
  registration: 'insignia_registration_v2',
  policy: 'insignia_policy_v2',
};
describe.runIf(Boolean(process.env.DATABASE_URL))('PG18 scoped production activation', () => {
  let database: Kysely<Database>;
  let core: DurableCore;
  beforeAll(async () => {
    database = await openTestDatabase();
    core = openTestDurableCore();
  });
  afterAll(async () => {
    await core?.close();
    await database?.destroy();
  });

  async function fixture() {
    const shopId = randomUUID();
    const providerShop = BigInt(`0x${shopId.replaceAll('-', '').slice(0, 12)}`).toString();
    const configId = randomUUID();
    const revisionId = randomUUID();
    const operationId = randomUUID();
    await core.transactions.run(async (tx) => {
      await core.tenants.createShop(tx, { shopId, shopDomain: `${shopId}.test.example`, shopifyShopId: providerShop });
      await core.configs.createConfig(tx, {
        shopId,
        configId,
        externalProductId: '42',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: {},
      });
    });
    const scope = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
    if (!scope) throw new Error('Synthetic shop missing');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
      public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
      VALUES (${shopId}, 1, ${scope.authorizationGeneration}::uuid, 7, ${publicKey},
        ${createHash('sha256').update(publicKey).digest('hex')}, '{"v":1}'::jsonb, 'synthetic', 'active', 20000, 30000)`.execute(
      database,
    );
    const createRevision = async (id: string, mode: 'required' | 'optional') =>
      core.transactions.run((tx) =>
        core.configs.createValidatedRevision(tx, {
          shopId,
          configId,
          revisionId: id,
          mode,
          sourceDraftVersion: '1',
          sourceInstallationGeneration: '1',
          createdByRef: 'synthetic',
          publishedValue: {
            version: 'm2-published-config-v1',
            shopId,
            productId: '42',
            revisionId: id,
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
        }),
      );
    await createRevision(revisionId, 'required');
    const cells = new Map<
      string,
      { ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string }
    >();
    let remoteReads = 0;
    let beforeRead: (() => Promise<void>) | undefined;
    const remote: ProductionPublicationRemote = {
      read: async (target) => {
        remoteReads++;
        await beforeRead?.();
        return cells.get(target.field) ?? null;
      },
      set: async (target) => {
        if ((cells.get(target.field)?.compareDigest ?? null) !== target.compareDigest)
          throw new Error('Synthetic CAS mismatch');
        const observed = {
          ownerId: target.productId ?? target.shopifyShopId,
          namespace: `app--${target.appId}`,
          key: fieldKeys[target.field],
          type: target.field === 'public_config' ? 'json' : 'single_line_text_field',
          value: target.value,
          compareDigest: createHash('sha256').update(target.value).digest('hex'),
        };
        cells.set(target.field, observed);
        return { observed };
      },
    };
    const artifactScope = { shopId, installationGeneration: '1', appClientId: 'synthetic-app' };
    const transform = {
      functionId: 'transform',
      handle: 'transform',
      apiType: 'cart_transform' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'a'.repeat(64),
      wasmSha256: 'b'.repeat(64),
    };
    const validation = {
      ...transform,
      functionId: 'validation',
      handle: 'validation',
      apiType: 'cart_checkout_validation' as const,
    };
    const build: ExpectedFunctionBuild = {
      ...artifactScope,
      schemaVersion: 1,
      sourceCommit: 'c'.repeat(40),
      appVersionRef: 'synthetic-release',
      devPreviewRef: null,
      transform,
      validation,
    };
    const { wasmSha256: _t, ...transformObject } = transform;
    const { wasmSha256: _v, ...validationObject } = validation;
    const observation: FunctionObjectObservation = {
      ...artifactScope,
      observedAt: now.toISOString(),
      transform: transformObject,
      validation: validationObject,
    };
    let releaseMissing = false;
    const readiness: Omit<ActivationReadinessPort, 'observeProjection'> = {
      expectedBuild: { read: async () => build },
      trustedEvidence: {
        read: async () =>
          releaseMissing
            ? null
            : {
                ...build,
                evidenceKind: 'RELEASE_BOUND',
                observedAt: now.toISOString(),
                expiresAt: '2026-10-02T12:00:00.000Z',
              },
      },
      observeFunctions: async () => ({ transform: 'present', validation: 'present', observation }),
      currentDay: async () => 20727,
    };
    const availabilityScope = { ...artifactScope, shopifyShopId: `gid://shopify/Shop/${providerShop}` };
    let current: ProductAvailabilitySnapshot = {
      scope: availabilityScope,
      productId: 'gid://shopify/Product/42',
      state: 'available',
      providerVersion: 'original',
      visibilityDigest: 'd'.repeat(64),
      observedAt: now.toISOString(),
    };
    let acquireNotSent = false;
    let acquireLost = false;
    let restoreLost = false;
    let acquisitions = 0;
    let restores = 0;
    const availability: ProductAvailabilityHoldPort = {
      snapshot: async () => current,
      acquire: async (_scope, hold) => {
        const receipt = await sql<{
          kind: string;
        }>`SELECT kind FROM m5_activation_state WHERE shop_id=${shopId} AND operation_id=${hold.operationId}`.execute(
          database,
        );
        expect(receipt.rows[0]?.kind).toBe('ACQUISITION_PENDING');
        if (acquireNotSent) {
          acquireNotSent = false;
          throw new Error('crash before provider dispatch');
        }
        acquisitions++;
        current = { ...current, state: 'unavailable', providerVersion: 'owned-hold' };
        if (acquireLost) {
          acquireLost = false;
          throw new Error('lost acquisition response');
        }
        return { kind: 'HELD', current, hold: { ...hold, held: current } };
      },
      observe: async (_scope, hold) =>
        current.providerVersion === 'owned-hold'
          ? { kind: 'HELD', current, hold: { ...hold, held: current } }
          : { kind: 'CONFLICT', current },
      restore: async (_scope, hold) => {
        const record = await core.productionActivations
          .create(options)
          .read({ ...identity, operationId: hold.operationId });
        expect(record?.state.kind).toBe('RESTORATION_PENDING');
        expect(record?.evidence).not.toBeNull();
        expect((await core.configs.getConfig(shopId, configId))?.effectiveRevisionId).not.toBeNull();
        restores++;
        current = { ...hold.before, providerVersion: 'restored' };
        if (restoreLost) {
          restoreLost = false;
          throw new Error('lost restore response');
        }
        return { kind: 'RESTORED', current };
      },
    };
    const options = {
      appId: '101',
      appClientId: 'synthetic-app',
      remote,
      availability,
      readiness,
      now: () => now,
      maxObservationAgeMs: 1000,
    };
    const identity = { shopId, configId, operationId };
    const restart = () => core.productionActivations.create(options);
    const activation = restart();
    await activation.publications.prepare({ ...identity, revisionId, mode: 'required' });
    const prepareHold = async () => {
      expect((await restart().advance(identity)).kind).toBe('WAITING_HOLD');
      expect((await restart().advance(identity)).kind).toBe('HELD');
    };
    const publish = async (id = identity) => {
      for (let i = 0; i < 5; i++) await restart().publications.advance(id.shopId, id.configId, id.operationId);
    };
    return {
      identity,
      scope,
      revisionId,
      restart,
      prepareHold,
      publish,
      createRevision,
      cells,
      set acquireNotSent(value: boolean) {
        acquireNotSent = value;
      },
      set acquireLost(value: boolean) {
        acquireLost = value;
      },
      set restoreLost(value: boolean) {
        restoreLost = value;
      },
      set releaseMissing(value: boolean) {
        releaseMissing = value;
      },
      set beforeRead(value: (() => Promise<void>) | undefined) {
        beforeRead = value;
      },
      get acquisitions() {
        return acquisitions;
      },
      get restores() {
        return restores;
      },
      get remoteReads() {
        return remoteReads;
      },
      drift: () => {
        current = { ...current, providerVersion: 'merchant-change' };
      },
    };
  }

  it('first publication stays pending until the owned hold is reobserved', async () => {
    const f = await fixture();
    expect(
      (await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId)).kind,
    ).toBe('ADMISSION_PENDING');
    expect(f.remoteReads).toBe(3); // Only prepare's reads; no policy dispatch without admission.
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    const record = await f.restart().read(f.identity);
    expect(record?.evidence).toMatchObject({
      admissionClass: 'FIRST_PUBLICATION',
      operationSequence: '1',
      selectedKeyId: 7,
      hold: { held: { state: 'unavailable' } },
    });
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.acquisitions).toBe(1);
    expect(f.restores).toBe(1);
  });
  it('immutable evidence refuses updates and deletes', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    for (const statement of [
      sql`UPDATE m5_activation_evidence SET evidence='{}'::jsonb WHERE shop_id=${f.identity.shopId}`,
      sql`DELETE FROM m5_activation_evidence WHERE shop_id=${f.identity.shopId}`,
    ])
      await expect(statement.execute(database)).rejects.toThrow('activation evidence is immutable');
  });
  it('concurrent attempts commit one evidence row and one effective operation', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    const attempts = await Promise.all([
      f.restart().advance(f.identity),
      f.restart().advance(f.identity),
      f.restart().advance(f.identity),
    ]);
    expect(attempts.every((attempt) => ['ACTIVATED_RESTORATION_PENDING', 'ACTIVE'].includes(attempt.kind))).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.evidenceDigest)).size).toBe(1);
    const evidence = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM m5_activation_evidence WHERE shop_id=${f.identity.shopId}`.execute(database);
    expect(evidence.rows[0]?.count).toBe('1');
    expect(f.restores).toBe(1);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveOperationId).toBe(
      f.identity.operationId,
    );
  });
  it('same-mode second revision activates without acquiring another hold', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const revisionId = randomUUID();
    const identity = { ...f.identity, operationId: randomUUID() };
    await f.createRevision(revisionId, 'required');
    await f.restart().publications.prepare({ ...identity, revisionId, mode: 'required' });
    await f.publish(identity);
    expect((await f.restart().advance(identity)).kind).toBe('ACTIVE');
    expect(f.acquisitions).toBe(1);
    expect((await f.restart().read(identity))?.evidence).toMatchObject({
      admissionClass: 'SAME_MODE',
      hold: null,
      operationSequence: '2',
    });
  });
  it.each(['required-to-optional', 'optional-to-required'])(
    'policy transition requires its own hold (%s)',
    async (transition) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      await f.restart().advance(f.identity);
      const publishMode = async (mode: 'optional' | 'required') => {
        const revisionId = randomUUID();
        const identity = { ...f.identity, operationId: randomUUID() };
        await f.createRevision(revisionId, mode);
        await f.restart().publications.prepare({ ...identity, revisionId, mode });
        expect(
          (await f.restart().publications.advance(identity.shopId, identity.configId, identity.operationId)).kind,
        ).toBe('ADMISSION_PENDING');
        expect((await f.restart().advance(identity)).kind).toBe('WAITING_HOLD');
        // Acquisition receipt checks the currently selected operation.
        await f.restart().advance(identity);
        await f.publish(identity);
        expect((await f.restart().advance(identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
        expect((await f.restart().read(identity))?.evidence?.admissionClass).toBe('MODE_CHANGE');
        await f.restart().advance(identity);
      };
      await publishMode('optional');
      if (transition === 'optional-to-required') await publishMode('required');
    },
  );
  it('a failure after evidence insert rolls evidence and effective activation back atomically', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    // Isolated synthetic fault, scoped by shop; other concurrent test fixtures cannot hit it.
    await sql`CREATE FUNCTION m5_test_activation_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.shop_id = ${sql.lit(f.identity.shopId)} AND NEW.status='activated' THEN
        RAISE EXCEPTION 'synthetic activation crash'; END IF; RETURN NEW; END $$`.execute(database);
    await sql`CREATE TRIGGER m5_test_activation_fail BEFORE UPDATE ON publication_operations FOR EACH ROW EXECUTE FUNCTION m5_test_activation_fail()`.execute(
      database,
    );
    try {
      await expect(f.restart().advance(f.identity)).rejects.toThrow('synthetic activation crash');
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
    } finally {
      await sql`DROP TRIGGER m5_test_activation_fail ON publication_operations`.execute(database);
      await sql`DROP FUNCTION m5_test_activation_fail()`.execute(database);
    }
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
  });
  it('persisted acquisition pending with an unsent mutation is observed and requires operator recovery', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireNotSent = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('crash before provider dispatch');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('ACQUISITION_PENDING');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.acquisitions).toBe(0);
  });
  it('lost acquisition is recovered from committed intent without a second mutation', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireLost = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('lost acquisition response');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('ACQUISITION_PENDING');
    expect((await f.restart().advance(f.identity)).kind).toBe('HELD');
    expect(f.acquisitions).toBe(1);
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
  });
  it('lost restore response and merchant drift retain effective activation and immutable evidence', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    const record = await f.restart().read(f.identity);
    f.restoreLost = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('lost restore response');
    f.drift();
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(1);
    expect((await f.restart().read(f.identity))?.evidence).toEqual(record?.evidence);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
  });
  it.each(['before commit', 'before restore'])(
    'fresh exact policy drift while held blocks unsafe progress (%s)',
    async (boundary) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      if (boundary === 'before restore') await f.restart().advance(f.identity);
      const policy = f.cells.get('policy');
      if (!policy) throw new Error('Synthetic policy missing');
      f.cells.set('policy', { ...policy, value: 'synthetic-drift', compareDigest: 'f'.repeat(64) });
      expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
      const record = await f.restart().read(f.identity);
      expect(record?.state.kind).toBe('OPERATOR_HOLD');
      expect(Boolean(record?.evidence)).toBe(boundary === 'before restore');
    },
  );
  it('revoked selected key cannot activate or restore a held product', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await core.signingKeys.revoke(f.scope, 7, 'synthetic-revocation', 'Synthetic emergency');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(0);
    expect((await f.restart().read(f.identity))?.evidence).toBeNull();
  });
  it('missing release evidence leaves the hold intact and never activates', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    f.releaseMissing = true;
    expect((await f.restart().advance(f.identity)).kind).toBe('WAITING_RELEASE');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('WAITING_RELEASE');
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
  });
  it.each(['reinstall', 'epoch', 'supersession'])(
    'fences %s before activation and preserves an operator hold',
    async (race) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      if (race === 'reinstall')
        await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.identity.shopId));
      if (race === 'epoch')
        await core.signingKeys.incrementEpoch({
          scope: f.scope,
          commandKey: 'synthetic-epoch',
          requestDigest: 'e'.repeat(64),
        });
      if (race === 'supersession')
        await database.transaction().execute((tx) =>
          createPublicationRepository(tx).request({
            ...f.identity,
            operationId: randomUUID(),
            revisionId: f.revisionId,
            installationGeneration: '1',
            expectedProjection: { synthetic: 'superseding' },
          }),
        );
      expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
      expect((await f.restart().read(f.identity))?.state.kind).toBe('OPERATOR_HOLD');
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toEqual({
        operationId: f.identity.operationId,
        kind: 'OPERATOR_HOLD',
        installationGeneration: '1',
      });
    },
  );
  it.each(['epoch', 'reinstall', 'supersession'])('locks the final read/commit against concurrent %s', async (race) => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    let entered!: () => void;
    let release!: () => void;
    const atRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const continueRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.beforeRead = async () => {
      entered();
      await continueRead;
    };
    const activating = f.restart().advance(f.identity);
    await atRead;
    let changed = false;
    const changing = (
      race === 'epoch'
        ? core.signingKeys.incrementEpoch({
            scope: f.scope,
            commandKey: 'synthetic-race',
            requestDigest: 'f'.repeat(64),
          })
        : race === 'reinstall'
          ? core.transactions.run((tx) => core.tenants.startInstallation(tx, f.identity.shopId))
          : database.transaction().execute((tx) =>
              createPublicationRepository(tx).request({
                ...f.identity,
                operationId: randomUUID(),
                revisionId: f.revisionId,
                installationGeneration: '1',
                expectedProjection: { synthetic: 'new' },
              }),
            )
    ).then(() => {
      changed = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(changed).toBe(false);
    } finally {
      release();
    }
    expect((await activating).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    await changing;
    expect(changed).toBe(true);
    f.beforeRead = undefined;
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(0);
  });
  it('a pending owned hold prevents another production publication from hiding recovery', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    await expect(
      f
        .restart()
        .publications.prepare({ ...f.identity, operationId: randomUUID(), revisionId: f.revisionId, mode: 'required' }),
    ).rejects.toThrow('Availability hold requires recovery');
  });
});
