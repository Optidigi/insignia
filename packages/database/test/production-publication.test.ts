import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { PgProductionPublication, PublicationAnchorConflictError } from '../src/repositories/production-publication.js';
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

function publishedValue(shopId: string, productId: string, revisionId: string) {
  return {
    version: 'm2-published-config-v1',
    shopId,
    productId,
    revisionId,
    shopCurrency: 'USD',
    methods: [{ id: 'm' }],
    placements: [{ id: 'front', allowedMethodIds: ['m'], allowedStepIds: ['s'], logoLaterAllowed: false }],
    productionOptions: [],
    pricingRules: [],
  };
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
      publishedValue: publishedValue(shopId, productId, revisionId),
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

  async function publishAndActivateWith(
    publisher: PgProductionPublication,
    f: Awaited<ReturnType<typeof fixture>>,
    mode: 'required' | 'optional',
  ) {
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
    return operationId;
  }

  /** Reinstall as the next generation with its own pending key (the copied public key is synthetic). */
  async function reinstall(f: Awaited<ReturnType<typeof fixture>>) {
    const generation = await database
      .transaction()
      .execute((tx) => createTenantRepository(tx).startInstallation(tx, f.shopId, 'synthetic-reinstalled'));
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation,
      key_id, public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state,
      first_valid_day, last_valid_day)
      SELECT key.shop_id, ${generation}::bigint, installation.authorization_generation,
        key.key_id, key.public_key, key.public_key_fingerprint, '{"kid":"synthetic-reinstall"}'::jsonb,
        'synthetic-reinstall', 'pending', key.first_valid_day, key.last_valid_day
      FROM signing_keys key JOIN installation_generations installation ON installation.shop_id=key.shop_id
      WHERE key.shop_id=${f.shopId} AND key.installation_generation=${f.generation}::bigint
        AND installation.generation=${generation}::bigint`.execute(database);
    const identity = await sql<{ authorization_generation: string }>`SELECT authorization_generation::text
      FROM installation_generations WHERE shop_id=${f.shopId} AND generation=${generation}::bigint`.execute(database);
    const authorizationGeneration = identity.rows[0]?.authorization_generation;
    if (!authorizationGeneration) throw new Error('missing reinstalled authorization generation');
    return { generation, authorizationGeneration };
  }

  function cell(remote: FakeRemote, field: Field): Cell {
    const found = remote.cells.get(field);
    if (!found) throw new Error(`missing ${field}`);
    return found;
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
      private_envelope=NULL, wrapping_key_id=NULL,
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
    // Deactivation destroyed the old generation's private halves; the new one has its own (synthetic) envelope.
    await reinstall(f);
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

  it('publishes after reinstall by replacing the earlier generation product anchors by compare-and-set', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    await publishAndActivateWith(publisher, f, 'required');
    const oldHex = f.authorizationGeneration.replaceAll('-', '');
    const old = {
      registration: cell(remote, 'registration'),
      policy: cell(remote, 'policy'),
      public_config: cell(remote, 'public_config'),
    };
    expect(old.policy.value).toBe(`${oldHex}:1:required`);
    const next = await reinstall(f);
    const newHex = next.authorizationGeneration.replaceAll('-', '');
    const operationId = randomUUID();
    // Before the fix: 'Product enforcement anchors drifted or belong to another installation'.
    expect(await publisher.prepare({ ...f, operationId, mode: 'required' })).toEqual({
      operationId,
      phase: 'prepared',
    });
    const progress = await sql<{
      prior_mode: string | null;
      prior_registration_digest: string | null;
      prior_policy_digest: string | null;
      prior_public_config_digest: string | null;
    }>`SELECT prior_mode, prior_registration_digest, prior_policy_digest, prior_public_config_digest
      FROM m4_publication_progress WHERE shop_id=${f.shopId} AND operation_id=${operationId}`.execute(database);
    // The earlier generation's policy is no prior policy of this one: first publication (owned hold).
    expect(progress.rows[0]).toEqual({
      prior_mode: null,
      prior_registration_digest: old.registration.compareDigest,
      prior_policy_digest: old.policy.compareDigest,
      prior_public_config_digest: old.public_config.compareDigest,
    });
    for (let i = 0; i < 4; i++)
      expect((await publisher.advance(f.shopId, f.configId, operationId)).kind).toBe('PENDING');
    expect(await publisher.advance(f.shopId, f.configId, operationId)).toEqual({
      kind: 'REMOTE_READY_ACTIVATION_PENDING',
      phase: 'activation-pending',
    });
    expect(cell(remote, 'policy').value).toBe(`${newHex}:2:required`);
    expect(cell(remote, 'registration').value).toBe(`${newHex}:2:ready`);
    expect(JSON.parse(cell(remote, 'public_config').value).generationHex).toBe(newHex);
  });

  it('still stops on product anchors bound to an authorization generation the shop never deactivated', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', {
      established: async () => ({ isFresh: () => true }),
    });
    await publishAndActivateWith(publisher, f, 'required');
    const foreign = randomUUID().replaceAll('-', '');
    for (const field of ['registration', 'policy'] as const) {
      const anchor = cell(remote, field);
      const value = anchor.value.replace(/^[0-9a-f]{32}/, foreign);
      remote.cells.set(field, { ...anchor, value, compareDigest: createHash('sha256').update(value).digest('hex') });
    }
    await reinstall(f);
    await expect(publisher.prepare({ ...f, operationId: randomUUID(), mode: 'required' })).rejects.toThrow(
      'Product enforcement anchors drifted or belong to another installation',
    );
  });

  /** Prepare a publication and advance it `steps` times: a publication stopped mid-way (uninstall). */
  async function publishUntil(
    publisher: PgProductionPublication,
    f: Awaited<ReturnType<typeof fixture>>,
    steps: number,
  ) {
    const operationId = randomUUID();
    await publisher.prepare({ ...f, operationId, mode: 'required' });
    for (let i = 0; i < steps; i++) await publisher.advance(f.shopId, f.configId, operationId);
  }
  function setCell(remote: FakeRemote, field: Field, value: string) {
    const anchor = cell(remote, field);
    remote.cells.set(field, { ...anchor, value, compareDigest: createHash('sha256').update(value).digest('hex') });
  }
  const admitted = () => ({ established: async () => ({ isFresh: () => true }) });

  it.each([
    ['a first publication stopped after its pending registration', 0, 2, /^[0-9a-f]{32}:1:pending$/, null],
    ['a first publication stopped after its policy', 0, 3, /^[0-9a-f]{32}:1:pending$/, /:1:required$/],
    ['a later publication stopped after its pending registration', 1, 2, /:2:pending$/, /:1:required$/],
  ] as const)(
    'replaces the anchors of %s in an earlier generation',
    async (_name, completed, steps, registration, policy) => {
      const f = await fixture();
      const remote = new FakeRemote();
      const publisher = new PgProductionPublication(database, remote, '101', admitted());
      for (let i = 0; i < completed; i++) await publishAndActivateWith(publisher, f, 'required');
      await publishUntil(publisher, f, steps);
      expect(remote.cells.get('registration')?.value).toMatch(registration);
      if (policy) expect(remote.cells.get('policy')?.value).toMatch(policy);
      else expect(remote.cells.get('policy')).toBeUndefined();
      const next = await reinstall(f);
      const operationId = randomUUID();
      // Before: 'Product enforcement anchors drifted …' or 'Partial product enforcement anchors …' (a 503).
      expect(await publisher.prepare({ ...f, operationId, mode: 'required' })).toEqual({
        operationId,
        phase: 'prepared',
      });
      let result = await publisher.advance(f.shopId, f.configId, operationId);
      for (let i = 0; i < 5 && result.kind === 'PENDING'; i++)
        result = await publisher.advance(f.shopId, f.configId, operationId);
      expect(result).toEqual({ kind: 'REMOTE_READY_ACTIVATION_PENDING', phase: 'activation-pending' });
      const hex = next.authorizationGeneration.replaceAll('-', '');
      expect(cell(remote, 'registration').value).toMatch(new RegExp(`^${hex}:\\d+:ready$`));
      expect(cell(remote, 'policy').value).toMatch(new RegExp(`^${hex}:\\d+:required$`));
    },
  );

  it('still stops on earlier-generation anchors once the current generation has an effective publication', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', admitted());
    await publishAndActivateWith(publisher, f, 'required');
    const earlier = { registration: cell(remote, 'registration'), policy: cell(remote, 'policy') };
    await reinstall(f);
    await publishAndActivateWith(publisher, f, 'required');
    remote.cells.set('registration', earlier.registration);
    remote.cells.set('policy', earlier.policy);
    await expect(publisher.prepare({ ...f, operationId: randomUUID(), mode: 'required' })).rejects.toThrow(
      PublicationAnchorConflictError,
    );
  });

  it('still stops on deactivated-generation anchors no publication can leave', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101', admitted());
    await publishAndActivateWith(publisher, f, 'required');
    const firstPolicy = cell(remote, 'policy');
    await reinstall(f);
    await publishAndActivateWith(publisher, f, 'required');
    const second = { registration: cell(remote, 'registration'), policy: cell(remote, 'policy') };
    const secondHex = second.registration.value.split(':')[0];
    await reinstall(f);
    const refuses = () =>
      expect(publisher.prepare({ ...f, operationId: randomUUID(), mode: 'required' })).rejects.toThrow(
        PublicationAnchorConflictError,
      );
    // A ready registration over another deactivated generation's policy.
    remote.cells.set('policy', firstPolicy);
    await refuses();
    // Same deactivated generation, but a ready registration never differs from its policy's sequence.
    remote.cells.set('policy', second.policy);
    setCell(remote, 'policy', `${secondHex}:1:required`);
    await refuses();
    // A pending registration is never older than the policy it is written over.
    setCell(remote, 'registration', `${secondHex}:1:pending`);
    setCell(remote, 'policy', `${secondHex}:2:required`);
    await refuses();
    // A policy without any registration.
    remote.cells.delete('registration');
    await refuses();
  });

  it('orders prepare after a publish command holding the config lock: a superseded request never prepares', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101');
    const newer = randomUUID();
    await createConfigRepositoryInternal(database).createRevision({
      shopId: f.shopId,
      configId: f.configId,
      revisionId: newer,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: publishedValue(f.shopId, f.productId, newer),
    });
    let commit: (() => void) | undefined;
    let locked: (() => void) | undefined;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      commit = resolve;
    });
    // The publish command: config row lock, then the pointer moves to its newer revision.
    const command = database.transaction().execute(async (tx) => {
      await sql`SELECT config_id FROM product_configs WHERE shop_id=${f.shopId} AND config_id=${f.configId}
        FOR UPDATE`.execute(tx);
      await sql`INSERT INTO m5_current_publication_pointer (shop_id, config_id, revision_id,
        installation_generation, source_draft_version, idempotency_key)
        VALUES (${f.shopId}, ${f.configId}, ${newer}, ${f.generation}::bigint, 2, 'newer-request-key')`.execute(tx);
      locked?.();
      await released;
    });
    await holding;
    const preparing = publisher.prepare({ ...f, operationId: f.revisionId, mode: 'required' });
    const outcome = preparing.then(
      () => 'prepared',
      (error: Error) => error.message,
    );
    await waitForLockWait();
    commit?.();
    await command;
    expect(await outcome).toBe('A newer publication request exists');
    const operations = await sql<{ count: string }>`SELECT count(*)::text AS count FROM publication_operations
      WHERE shop_id=${f.shopId} AND config_id=${f.configId}`.execute(database);
    expect(operations.rows[0]?.count).toBe('0');
  });

  async function waitForLockWait() {
    for (let i = 0; i < 200; i++) {
      const waiting = await sql<{ count: string }>`SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'`.execute(database);
      if (waiting.rows[0]?.count !== '0') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('prepare never waited for the config lock');
  }

  it('never prepares a request whose current-publication pointer moved to a newer request', async () => {
    const f = await fixture();
    const remote = new FakeRemote();
    const publisher = new PgProductionPublication(database, remote, '101');
    const newer = randomUUID();
    await createConfigRepositoryInternal(database).createRevision({
      shopId: f.shopId,
      configId: f.configId,
      revisionId: newer,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: publishedValue(f.shopId, f.productId, newer),
    });
    await sql`INSERT INTO m5_current_publication_pointer (shop_id, config_id, revision_id,
      installation_generation, source_draft_version, idempotency_key)
      VALUES (${f.shopId}, ${f.configId}, ${newer}, ${f.generation}::bigint, 2, 'newer-request-key')`.execute(database);
    await expect(publisher.prepare({ ...f, operationId: f.revisionId, mode: 'required' })).rejects.toThrow(
      'A newer publication request exists',
    );
    expect(await publisher.prepare({ ...f, revisionId: newer, operationId: newer, mode: 'required' })).toEqual({
      operationId: newer,
      phase: 'prepared',
    });
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
    const publishAndActivate = (mode: 'required' | 'optional') => publishAndActivateWith(publisher, f, mode);
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
