import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { PgProductionPublication } from '../src/repositories/production-publication.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

type Field = 'public_config' | 'registration' | 'policy';
type Target = { field: Field; productId?: string; shopifyShopId: string; appId: string };
type Cell = { ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string };
const keys = {
  public_config: 'insignia_public_config_v2',
  registration: 'insignia_registration_v2',
  policy: 'insignia_policy_v2',
};
class FakeRemote {
  cells = new Map<Field, Cell>();
  writes: Field[] = [];
  ambiguousOnce = false;
  beforeSet?: () => Promise<void>;
  async read(target: Target): Promise<Cell | null> {
    const cell = this.cells.get(target.field) ?? null;
    if (!cell) return null;
    expect(cell.ownerId).toBe(target.field === 'public_config' ? target.shopifyShopId : target.productId);
    return { ...cell };
  }
  async set(input: Target & { value: string; compareDigest: string | null }): Promise<{ observed: Cell }> {
    await this.beforeSet?.();
    const current = this.cells.get(input.field) ?? null;
    if ((current?.compareDigest ?? null) !== input.compareDigest) throw { kind: 'cas_conflict' };
    if (input.field !== 'public_config' && !input.productId) throw new Error('missing product');
    const next = {
      ownerId: input.field === 'public_config' ? input.shopifyShopId : (input.productId ?? ''),
      namespace: `app--${input.appId}`,
      key: keys[input.field],
      type: input.field === 'public_config' ? 'json' : 'single_line_text_field',
      value: input.value,
      compareDigest: createHash('sha256').update(input.value).digest('hex'),
    };
    this.cells.set(input.field, next);
    this.writes.push(input.field);
    if (this.ambiguousOnce) {
      this.ambiguousOnce = false;
      throw { kind: 'ambiguous_write' };
    }
    return { observed: next };
  }
}

describe.runIf(Boolean(process.env.DATABASE_URL))('M4 production publication journal', () => {
  let database: Kysely<Database>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });

  async function fixture() {
    const { shopId, generation } = await createTestShop(database);
    const shopifyShopId = (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString();
    await sql`UPDATE shops SET shopify_shop_id=${shopifyShopId} WHERE shop_id=${shopId}`.execute(database);
    const configId = randomUUID();
    const revisionId = randomUUID();
    const productId = '42';
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    await repo.createRevision({
      shopId,
      configId,
      revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: {
        version: 'm2-published-config-v1',
        shopId,
        productId,
        revisionId,
        shopCurrency: 'USD',
        methods: [{ id: 'm' }],
        placements: [{ id: 'front', allowedMethodIds: ['m'], allowedStepIds: ['s'], logoLaterAllowed: false }],
        productionOptions: [],
        pricingRules: [],
      },
    });
    const identity = await sql<{ authorization_generation: string }>`SELECT authorization_generation::text
      FROM installation_generations WHERE shop_id=${shopId} AND generation=${generation}::bigint`.execute(database);
    const authorizationGeneration = identity.rows[0]?.authorization_generation;
    if (!authorizationGeneration) throw new Error('missing authorization generation');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
      public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
      VALUES (${shopId}, ${generation}::bigint, ${authorizationGeneration}::uuid, 7,
        ${publicKey}, ${createHash('sha256').update(publicKey).digest('hex')}, '{"v":1}'::jsonb,
        'synthetic', 'pending', 20000, 21000)`.execute(database);
    return { shopId, configId, revisionId, generation, authorizationGeneration, productId };
  }

  it('rejects an M4-shaped legacy journal activation without M4 progress evidence', async () => {
    const f = await fixture();
    const operationId = randomUUID();
    const projection = { version: 'm4-publication-v1', synthetic: true };
    await database.transaction().execute(async (tx) => {
      const journal = createPublicationRepository(tx);
      await journal.request({
        shopId: f.shopId,
        configId: f.configId,
        operationId,
        revisionId: f.revisionId,
        installationGeneration: f.generation,
        expectedProjection: projection,
      });
      expect(await journal.acknowledge(f.shopId, f.configId, operationId)).toBe('acknowledged');
      expect(await journal.observe({ shopId: f.shopId, configId: f.configId, operationId, projection })).toBe(
        'observed',
      );
      expect(await journal.activate(f.shopId, f.configId, operationId)).toBe('stale');
    });
  });

  it('journals before writes, resumes ambiguous writes and stops after exact remote ready', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const operationId = randomUUID();
    const noAdmission = new PgProductionPublication(database, remote, '101');
    expect(await noAdmission.prepare({ ...f, operationId, mode: 'required' })).toMatchObject({ phase: 'prepared' });
    expect(await noAdmission.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'ADMISSION_PENDING',
      phase: 'prepared',
    });
    expect(remote.writes).toEqual([]);
    const before = await sql<{ expected_projection: unknown }>`SELECT expected_projection FROM publication_operations
      WHERE shop_id=${f.shopId} AND operation_id=${operationId}`.execute(database);
    expect(before.rows[0]?.expected_projection).toMatchObject({ mode: 'required', productId: '42' });
    const outbox = await sql<{ id: string }>`SELECT id FROM outbox_events WHERE shop_id=${f.shopId}
      AND business_key=${operationId}`.execute(database);
    expect(outbox.rows).toHaveLength(1);

    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }), // Synthetic admission premise; no production adapter exists.
    });
    remote.ambiguousOnce = true;
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({ kind: 'PENDING', phase: 'prepared' });
    expect(remote.writes).toEqual(['public_config']);
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'PENDING',
      phase: 'shop-config-written',
    });
    expect(remote.writes).toEqual(['public_config']);
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'PENDING',
      phase: 'pending-written',
    });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'PENDING',
      phase: 'policy-written',
    });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'PENDING',
      phase: 'ready-written',
    });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'REMOTE_READY_ACTIVATION_PENDING',
      phase: 'activation-pending',
    });
    expect(remote.writes).toEqual(['public_config', 'registration', 'policy', 'registration']);
    expect(remote.cells.get('registration')?.value.endsWith(':ready')).toBe(true);
    expect(remote.cells.get('policy')?.value.endsWith(':required')).toBe(true);
    const state = await sql<{ status: string; effective_revision_id: string | null; phase: string }>`
      SELECT o.status, c.effective_revision_id, p.phase FROM publication_operations o
      JOIN product_configs c USING (shop_id, config_id)
      JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
      WHERE o.shop_id=${f.shopId} AND o.operation_id=${operationId}`.execute(database);
    expect(state.rows[0]).toMatchObject({
      status: 'observed',
      effective_revision_id: null,
      phase: 'activation-pending',
    });
    expect(await publisher.prepare({ ...f, operationId, mode: 'required' })).toMatchObject({
      phase: 'activation-pending',
    });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'REMOTE_READY_ACTIVATION_PENDING',
      phase: 'activation-pending',
    });
  });

  it('holds on stale CAS without replacing a surviving enforcement anchor', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    const operationId = randomUUID();
    await publisher.prepare({ ...f, operationId, mode: 'optional' });
    await publisher.advance(f.shopId, f.configId, operationId);
    remote.cells.set('registration', {
      ownerId: 'gid://shopify/Product/42',
      namespace: 'app--101',
      key: keys.registration,
      type: 'single_line_text_field',
      value: 'other',
      compareDigest: 'a'.repeat(64),
    });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({ kind: 'CONFLICT', phase: 'conflict' });
    expect(remote.cells.get('registration')?.value).toBe('other');
    expect(remote.writes).toEqual(['public_config']);
  });

  it('does not promote a competing or deleted pending registration to ready', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    const operationId = randomUUID();
    await publisher.prepare({ ...f, operationId, mode: 'required' });
    for (let i = 0; i < 3; i++) await publisher.advance(f.shopId, f.configId, operationId);
    expect(remote.writes).toEqual(['public_config', 'registration', 'policy']);
    const pending = remote.cells.get('registration');
    if (!pending) throw new Error('pending registration missing');
    remote.cells.set('registration', { ...pending, value: 'competing-publication', compareDigest: 'b'.repeat(64) });
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'OPERATOR_HOLD',
      phase: 'operator-hold',
    });
    expect(remote.cells.get('registration')?.value).toBe('competing-publication');
    expect(remote.writes).toEqual(['public_config', 'registration', 'policy']);
  });

  it('holds when durable key revocation makes the prepared public config stale', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    const operationId = randomUUID();
    await publisher.prepare({ ...f, operationId, mode: 'optional' });
    await sql`UPDATE signing_keys SET state='revoked', revoked_at=clock_timestamp(),
      revocation_command_key='emergency-test', revocation_reason='test'
      WHERE shop_id=${f.shopId} AND key_id=7`.execute(database);
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'OPERATOR_HOLD',
      phase: 'operator-hold',
    });
    expect(remote.writes).toEqual([]);
    const held = await sql<{ phase: string }>`SELECT phase FROM m4_publication_progress
      WHERE shop_id=${f.shopId} AND operation_id=${operationId}`.execute(database);
    expect(held.rows[0]?.phase).toBe('operator-hold');
    const replacement = randomUUID();
    expect(await publisher.prepare({ ...f, operationId: replacement, mode: 'optional' })).toMatchObject({
      operationId: replacement,
      phase: 'prepared',
    });
  });

  it('returns one journal when the same publication command races', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101');
    const operationId = randomUUID();
    const commands = await Promise.all([
      publisher.prepare({ ...f, operationId, mode: 'required' }),
      publisher.prepare({ ...f, operationId, mode: 'required' }),
    ]);
    expect(commands).toEqual([
      { operationId, phase: 'prepared' },
      { operationId, phase: 'prepared' },
    ]);
    const rows = await sql<{ operation_id: string }>`SELECT operation_id FROM publication_operations
      WHERE shop_id=${f.shopId} AND operation_id=${operationId}`.execute(database);
    expect(rows.rows).toHaveLength(1);
  });

  it('allows a new installation intent without deleting the old prepared journal', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101');
    const oldOperation = randomUUID();
    await publisher.prepare({ ...f, operationId: oldOperation, mode: 'required' });
    const generation = await database
      .transaction()
      .execute((tx) => createTenantRepository(tx).startInstallation(tx, f.shopId, 'synthetic-reinstalled'));
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation,
      key_id, public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state,
      first_valid_day, last_valid_day)
      SELECT key.shop_id, ${generation}::bigint, installation.authorization_generation,
        key.key_id, key.public_key, key.public_key_fingerprint, key.private_envelope,
        key.wrapping_key_id, 'pending', key.first_valid_day, key.last_valid_day
      FROM signing_keys key JOIN installation_generations installation ON installation.shop_id=key.shop_id
      WHERE key.shop_id=${f.shopId} AND key.installation_generation=${f.generation}::bigint
        AND installation.generation=${generation}::bigint`.execute(database);
    const newOperation = randomUUID();
    expect(await publisher.prepare({ ...f, operationId: newOperation, mode: 'required' })).toEqual({
      operationId: newOperation,
      phase: 'prepared',
    });
    await expect(publisher.prepare({ ...f, operationId: randomUUID(), mode: 'required' })).rejects.toThrow(
      'Another publication is pending',
    );
    expect(await publisher.advance(f.shopId, f.configId, newOperation)).toEqual({
      kind: 'ADMISSION_PENDING',
      phase: 'prepared',
    });
    expect(remote.writes).toEqual([]);
    const preserved = await sql<{ generation: string; phase: string; status: string }>`
      SELECT operation.installation_generation::text AS generation, progress.phase, operation.status
      FROM publication_operations operation JOIN m4_publication_progress progress
        USING (shop_id, config_id, operation_id)
      WHERE operation.shop_id=${f.shopId} AND operation.operation_id=${oldOperation}`.execute(database);
    expect(preserved.rows[0]).toEqual({ generation: f.generation, phase: 'prepared', status: 'superseded' });
  });

  it('recovers after a write timeout at every durable remote stage', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const operationId = randomUUID();
    const restart = () =>
      new PgProductionPublication(database, remote, '101', { established: async () => ({ isFresh: () => true }) });
    await restart().prepare({ ...f, operationId, mode: 'required' });
    const phases = ['prepared', 'shop-config-written', 'pending-written', 'policy-written'] as const;
    const next = ['shop-config-written', 'pending-written', 'policy-written', 'ready-written'] as const;
    for (let i = 0; i < phases.length; i++) {
      remote.ambiguousOnce = true;
      expect(await restart().advance(f.shopId, f.configId, operationId)).toEqual({ kind: 'PENDING', phase: phases[i] });
      expect(await restart().advance(f.shopId, f.configId, operationId)).toEqual({ kind: 'PENDING', phase: next[i] });
    }
    expect(remote.writes).toEqual(['public_config', 'registration', 'policy', 'registration']);
    expect(await restart().advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'REMOTE_READY_ACTIVATION_PENDING',
      phase: 'activation-pending',
    });
  });

  it('rejects coherent rollback of a prior effective required policy', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    const publishAndActivate = async (mode: 'required' | 'optional') => {
      const operationId = randomUUID();
      await publisher.prepare({ ...f, operationId, mode });
      for (let i = 0; i < 5; i++) await publisher.advance(f.shopId, f.configId, operationId);
      await database.transaction().execute(async (tx) => {
        expect(await createPublicationRepository(tx).activate(f.shopId, f.configId, operationId)).toBe('stale');
        await sql`UPDATE m4_publication_progress SET phase='active', version=version+1,
          activation_evidence='synthetic-admission-only'
          WHERE shop_id=${f.shopId} AND config_id=${f.configId} AND operation_id=${operationId}`.execute(tx);
      });
      expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
        kind: 'OPERATOR_HOLD',
        phase: 'active',
      });
      await database.transaction().execute(async (tx) => {
        expect(await createPublicationRepository(tx).activate(f.shopId, f.configId, operationId)).toBe('activated');
      });
      expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({ kind: 'ACTIVE', phase: 'active' });
    };
    await publishAndActivate('optional');
    const registration = remote.cells.get('registration');
    const policy = remote.cells.get('policy');
    if (!registration || !policy) throw new Error('first publication incomplete');
    const oldRegistration = { ...registration };
    const oldPolicy = { ...policy };
    await publishAndActivate('required');
    remote.cells.set('registration', oldRegistration);
    remote.cells.set('policy', oldPolicy);
    await expect(publisher.prepare({ ...f, operationId: randomUUID(), mode: 'optional' })).rejects.toThrow(
      /differs from durable effective publication/,
    );
  });

  it('serializes a paused Admin write against emergency key revocation', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    const operationId = randomUUID();
    await publisher.prepare({ ...f, operationId, mode: 'optional' });
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const atWrite = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const continueWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    remote.beforeSet = async () => {
      entered?.();
      await continueWrite;
    };
    const advancing = publisher.advance(f.shopId, f.configId, operationId);
    await atWrite;
    const keys = new PgSigningKeyRepository(database);
    const scope = await keys.getActiveScope(f.shopId, f.generation);
    if (!scope) throw new Error('missing signing scope');
    let revoked = false;
    const revoking = keys.revoke(scope, 7, 'paused-write-revocation', 'emergency test').then(() => {
      revoked = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(revoked).toBe(false);
    release?.();
    expect(await advancing).toEqual({ kind: 'PENDING', phase: 'shop-config-written' });
    await revoking;
    expect(revoked).toBe(true);
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'OPERATOR_HOLD',
      phase: 'operator-hold',
    });
    expect(remote.writes).toEqual(['public_config']);
  });
});
