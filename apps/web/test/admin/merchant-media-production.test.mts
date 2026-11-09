import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ArtworkStorage } from '@insignia/application';
import { CONFIG_DRAFT_STORAGE_VERSION, createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantMediaService } from '../../src/server/admin/merchant-media.ts';
import { createMerchantPublicationCapture } from '../../src/server/admin/merchant-previews.ts';
import { isolatedDatabase } from '../support/isolated-database.mts';
import { adminActor, unexpected } from './support/fixtures.mts';

const database = process.env.DATABASE_URL;
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(connectionString = database) {
  const pool = new Pool({ connectionString });
  const core = createDurableCore(pool);
  const tenant = randomUUID();
  const configId = randomUUID();
  const productId = 'gid://shopify/Product/111';
  const now = new Date();
  const actor = adminActor({
    tenantShopId: tenant,
    shop: `media-${tenant}.myshopify.com`,
    shopId: `gid://shopify/Shop/${BigInt(`0x${tenant.replaceAll('-', '').slice(0, 12)}`)}`,
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
    expiresAtMs: +now + 3600000,
  });
  await core.transactions.run(async (tx) => {
    await core.tenants.createShop(tx, {
      shopId: tenant,
      shopDomain: actor.shop,
      shopifyShopId: actor.shopId.split('/').at(-1),
    });
    await core.configs.createConfig(tx, {
      shopId: tenant,
      configId,
      externalProductId: '111',
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
  });
  const objects = new Map<string, Uint8Array>();
  const storage: ArtworkStorage = {
    presignUpload: unexpected,
    presignRead: async ({ key }) => `https://storage.example/${encodeURIComponent(key)}`,
    putImmutable: async ({ key, bytes }) => {
      const old = objects.get(key);
      if (old && sha(old) !== sha(bytes)) throw new Error('Immutable collision');
      objects.set(key, Uint8Array.from(bytes));
    },
    read: async ({ key }) => {
      const data = objects.get(key);
      assert.ok(data);
      return data;
    },
    remove: async ({ key }) => {
      objects.delete(key);
    },
  };
  const service = createMerchantMediaService({
    appOrigin: 'https://app.example',
    store: core.merchantPreviews,
    storage: async () => storage,
    current: async (current) => {
      const scope = await core.tenants.getActiveAuthorizationScope({
        shopId: current.tenantShopId,
        installationGeneration: current.installationGeneration,
      });
      if (!scope) throw new Error('Scope changed');
    },
    product: async (_actor, id) => ({ id }),
    draftImages: async () => {
      const rows = await pool.query<{ asset_id: string }>(
        'SELECT asset_id::text FROM merchant_preview_draft_references WHERE asset_id IN (SELECT asset_id FROM merchant_preview_assets WHERE shop_id=$1 AND product_id=$2)',
        [tenant, '111'],
      );
      return rows.rows.map((row) => `upload_${row.asset_id}`);
    },
    inspect: async (bytes) => ({
      version: 'm6-inspection-v1',
      mimeType: 'image/png',
      originalSha256: sha(bytes),
      width: 100,
      height: 120,
      previewMimeType: 'image/png',
      preview: png,
    }),
  });
  async function save(images: { id: string; url: string; width: number; height: number; alt: string }[]) {
    return core.transactions.run(async (tx) => {
      await core.tenants.lockActiveAuthorizationScope(tx, { shopId: tenant, installationGeneration: '1' });
      const record = await core.configs.getConfigForUpdate(tx, tenant, configId);
      assert.ok(record);
      return core.configs.updateDraft(tx, {
        shopId: tenant,
        configId,
        expectedVersion: record.draftVersion,
        schemaVersion: record.draftSchemaVersion,
        draftValue: { selectedSetup: { product: { images } } },
      });
    });
  }
  return { pool, core, tenant, actor, configId, productId, now, service, storage, objects, save };
}

test('private upload references roundtrip an isolated PostgreSQL archive without losing source identity or constraints', {
  skip: !database || !process.env.INSIGNIA_PG_BIN,
}, async (t) => {
  // A whole-database snapshot must not consume other tests' expired/in-flight rows.
  const isolated = await isolatedDatabase('media_archive');
  t.after(() => isolated.close());
  const database = isolated.connectionString;
  const f = await fixture(database);
  const directory = await mkdtemp(join(tmpdir(), 'insignia-media-restore-'));
  const name = `insignia_recovery_media_${randomUUID().replaceAll('-', '')}`;
  let restored: Pool | undefined;
  let created = false;
  const bin = process.env.INSIGNIA_PG_BIN;
  assert.ok(bin);
  assert.ok(database);
  try {
    const id = randomUUID();
    const media = await f.service.upload(f.actor, f.productId, id, png);
    await f.save([media.image]);
    // Seed a historically saved library upload beyond its original abandonment deadline.
    // Restore is allowed to retain this original creation time; normal app writes cannot restamp it.
    const past = new Date(+f.now - 8 * 86400000);
    const historicalId = randomUUID();
    const historicalConfig = randomUUID();
    const historicalService = createMerchantMediaService({
      appOrigin: 'https://app.example',
      store: f.core.merchantPreviews,
      storage: async () => f.storage,
      now: () => past,
      current: async () => {
        assert.ok(await f.core.tenants.getActiveAuthorizationScope({ shopId: f.tenant, installationGeneration: '1' }));
      },
      product: async (_actor, id) => ({ id }),
      draftImages: async () => [],
      inspect: async (bytes) => ({
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        originalSha256: sha(bytes),
        width: 100,
        height: 120,
        previewMimeType: 'image/png',
        preview: png,
      }),
    });
    const historical = await historicalService.upload(f.actor, 'gid://shopify/Product/222', historicalId, png);
    await f.pool.query(
      "INSERT INTO product_configs(shop_id,config_id,external_product_id,draft_schema_version,draft_value,created_at) VALUES($1,$2,'222',$3,$4::jsonb,$5)",
      [
        f.tenant,
        historicalConfig,
        CONFIG_DRAFT_STORAGE_VERSION,
        JSON.stringify({ selectedSetup: { product: { images: [historical.image] } } }),
        past,
      ],
    );
    const snapshotModule = new URL('../../../../scripts/operations/backup-snapshot.mts', import.meta.url).href;
    const references: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      const { Pool } = await import('pg');
      const { databaseSnapshot } = await import(${JSON.stringify(snapshotModule)});
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      try { console.log(JSON.stringify((await databaseSnapshot(client)).references)); }
      finally { client.release(); await pool.end(); }
    `,
        ],
        {
          env: { PATH: process.env.PATH, DATABASE_URL: database },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    );
    assert.ok(Array.isArray(references));
    const sourceRow = await f.core.merchantPreviews.get(
      { shopId: f.tenant, installationGeneration: '1', kind: 'merchant' },
      historicalId,
    );
    assert.ok(sourceRow);
    assert.ok(
      references.some(
        (reference: unknown) =>
          reference &&
          typeof reference === 'object' &&
          'key' in reference &&
          reference.key === sourceRow.originalKey &&
          'required' in reference &&
          reference.required === true &&
          'expiresAt' in reference &&
          typeof reference.expiresAt === 'string' &&
          Date.parse(reference.expiresAt) > Date.now(),
      ),
    );
    const file = join(directory, 'snapshot.dump');
    execFileSync(join(bin, 'pg_dump'), ['--format=custom', '--no-owner', '--file', file, '--dbname', database], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await f.pool.query(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(database);
    url.pathname = `/${name}`;
    execFileSync(
      join(bin, 'pg_restore'),
      ['--clean', '--if-exists', '--single-transaction', '--no-owner', '--dbname', url.href, file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    restored = new Pool({ connectionString: url.href });
    assert.deepEqual(
      (
        await restored.query<{ asset_id: string }>(
          'SELECT asset_id::text FROM merchant_preview_draft_references WHERE asset_id=$1',
          [id],
        )
      ).rows,
      [{ asset_id: id }],
    );
    const rows = await restored.query<{ image_revision_id: string; state: string }>(
      'SELECT image_revision_id,state FROM merchant_preview_assets WHERE asset_id=$1',
      [id],
    );
    assert.deepEqual(rows.rows, [{ image_revision_id: media.image.id, state: 'USABLE' }]);
    const { replayExpiry } = await import('../../../../scripts/operations/backup-expiry.mts');
    const expiryClient = await restored.connect();
    try {
      await replayExpiry(expiryClient);
    } finally {
      expiryClient.release();
    }
    assert.equal(
      (
        await restored.query<{ state: string }>('SELECT state FROM merchant_preview_assets WHERE asset_id=$1', [
          historicalId,
        ])
      ).rows[0]?.state,
      'USABLE',
    );

    await assert.rejects(
      restored.query("UPDATE merchant_preview_assets SET state='DELETING' WHERE asset_id=$1", [id]),
      { code: '23514' },
    );
    assert.equal(
      (
        await restored.query<{ public_read: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='merchant_preview_draft_references'::regclass AND a.grantee=0 AND a.privilege_type='SELECT') public_read",
        )
      ).rows[0]?.public_read,
      false,
    );
  } finally {
    await restored?.end();
    if (created) await f.pool.query(`DROP DATABASE ${name}`);
    await rm(directory, { recursive: true, force: true });
    await f.core.close();
  }
});

test('saved upload references survive abandonment cleanup and block forged dimensions/product binding at commit', {
  skip: !database,
}, async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const media = await f.service.upload(f.actor, f.productId, id, png);
    assert.equal((await f.save([media.image])).kind, 'updated');
    const later = new Date(+f.now + 8 * 86400000);
    assert.equal((await f.core.merchantPreviews.selectCleanup(100, later)).includes(id), false);
    assert.equal(await f.core.merchantPreviews.markDeleting(id, later), null);
    await assert.rejects(f.pool.query("UPDATE merchant_preview_assets SET state='DELETING' WHERE asset_id=$1", [id]), {
      code: '23514',
    });
    await assert.rejects(f.save([{ ...media.image, width: 101 }]), { code: '23514' });
    await assert.rejects(f.save([{ ...media.image, url: media.previewUrl }]), { code: '23514' });
    const foreign = await f.service.upload(f.actor, 'gid://shopify/Product/222', randomUUID(), png);
    await assert.rejects(f.save([foreign.image]), { code: '23514' });
    assert.deepEqual(await f.service.readOriginal(f.actor, f.productId, media.image.id), png);
    await f.save([]);
    assert.equal((await f.core.merchantPreviews.selectCleanup(100, later)).includes(id), true);
    assert.ok(await f.core.merchantPreviews.markDeleting(id, later));
    await assert.rejects(f.save([media.image]), { code: '23514' });
  } finally {
    await f.core.close();
  }
});

test('cleanup inspection reads referenced asset UUIDs without acquiring merchant draft access', {
  skip: !database,
}, async () => {
  const f = await fixture();
  const role = `media_read_${randomUUID().replaceAll('-', '')}`;
  let restricted: Pool | undefined;
  try {
    const id = randomUUID();
    const media = await f.service.upload(f.actor, f.productId, id, png);
    await f.save([media.image]);
    await f.pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await f.pool.query(
      `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON merchant_preview_assets,config_revision_preview_assets,shops,installation_generations,merchant_preview_draft_references TO ${role}`,
    );
    restricted = new Pool({ connectionString: database, options: `-c role=${role}` });
    await assert.rejects(restricted.query('SELECT draft_value FROM product_configs'), { code: '42501' });
    assert.deepEqual(
      (
        await restricted.query<{ asset_id: string }>(
          'SELECT asset_id::text FROM merchant_preview_draft_references WHERE asset_id=$1',
          [id],
        )
      ).rows,
      [{ asset_id: id }],
    );
    const eligible = await restricted.query<{ asset_id: string }>(
      'SELECT a.asset_id::text FROM merchant_preview_assets a WHERE a.asset_id=$1 AND NOT EXISTS(SELECT 1 FROM merchant_preview_draft_references d WHERE d.asset_id=a.asset_id)',
      [id],
    );
    assert.deepEqual(eligible.rows, []);
  } finally {
    await restricted?.end();
    await f.pool.query(`DROP OWNED BY ${role}`).catch(() => {});
    await f.pool.query(`DROP ROLE IF EXISTS ${role}`);
    await f.core.close();
  }
});

test('uploaded originals are privately recaptured into separate immutable publication assets', {
  skip: !database,
}, async () => {
  const f = await fixture();
  try {
    const sourceId = randomUUID();
    const descriptor = await f.service.upload(f.actor, f.productId, sourceId, png);
    await f.save([descriptor.image]);
    const capture = createMerchantPublicationCapture({
      store: f.core.merchantPreviews,
      storage: async () => f.storage,
      current: async () => {
        assert.ok(await f.core.tenants.getActiveAuthorizationScope({ shopId: f.tenant, installationGeneration: '1' }));
      },
      readProduct: unexpected,
      readImage: unexpected,
      readUploadedImage: (actor, productId, reference) => f.service.readOriginal(actor, productId, reference),
      inspect: async (bytes) => ({
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        originalSha256: sha(bytes),
        width: 100,
        height: 120,
        previewMimeType: 'image/png',
        preview: png,
      }),
    });
    const geometry = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: descriptor.image.id, width: 100, height: 120 },
          placements: [],
          variantImages: [],
        },
      ],
      steps: [],
    };
    const bindings = await capture(f.actor, {
      productId: f.productId,
      configId: f.configId,
      draftVersion: '2',
      idempotencyKey: 'upload-publication',
      draft: {
        version: 'm5-merchant-draft-v1',
        mode: 'required',
        shopCurrency: 'USD',
        methods: [],
        placements: [],
        productionOptions: [],
        pricingRules: [],
        geometry,
      },
    });
    assert.equal(bindings.length, 1);
    const binding = bindings[0];
    assert.ok(binding);
    assert.equal(binding.imageRevisionId, descriptor.image.id);
    assert.notEqual(binding.assetId, sourceId);
    const revisionId = randomUUID();
    await f.core.transactions.run((tx) =>
      f.core.configs.createValidatedRevision(tx, {
        shopId: f.tenant,
        configId: f.configId,
        revisionId,
        publishedValue: {
          version: 'm2-published-config-v1',
          shopId: f.tenant,
          productId: '111',
          revisionId,
          shopCurrency: 'USD',
          methods: [],
          placements: [],
          productionOptions: [],
          pricingRules: [],
        },
        geometry: { version: 'm5-geometry-v1', value: geometry },
        presentation: { version: 'm5-presentation-v1', labels: {} },
        sourceDraftVersion: '2',
        sourceInstallationGeneration: '1',
        mode: 'required',
        createdByRef: 'synthetic',
        previewAssets: bindings,
      }),
    );
    const owned = await f.core.merchantPreviews.getForRevision(
      { shopId: f.tenant, installationGeneration: '1' },
      { productId: '111', revisionId },
    );
    assert.equal(owned[0]?.assetId, binding.assetId);
    await f.save([]);
    const later = new Date(+f.now + 8 * 86400000);
    const cleanup = await f.core.merchantPreviews.selectCleanup(100, later);
    assert.ok(cleanup.includes(sourceId));
    assert.equal(cleanup.includes(binding.assetId), false);
    assert.deepEqual(
      await capture(f.actor, {
        productId: f.productId,
        configId: f.configId,
        draftVersion: '2',
        idempotencyKey: 'upload-publication',
        draft: {
          version: 'm5-merchant-draft-v1',
          mode: 'required',
          shopCurrency: 'USD',
          methods: [],
          placements: [],
          productionOptions: [],
          pricingRules: [],
          geometry,
        },
      }),
      bindings,
    );
  } finally {
    await f.core.close();
  }
});
