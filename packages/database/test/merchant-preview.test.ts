import { randomUUID } from 'node:crypto';
import {
  ArtworkError,
  createMerchantPreviewCapture,
  type MerchantPreviewRecord,
  type MerchantPreviewScope,
} from '@insignia/application';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createDurableCore } from '../src/durable-core.js';
import { createMerchantPreviewRepository } from '../src/repositories/merchant-preview.js';

const now = new Date('2026-10-15T12:00:00Z');
const later = new Date(+now + 8 * 86400000);
describe.runIf(Boolean(process.env.DATABASE_URL))('merchant-owned preview lifecycle and revision binding', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(pool);
  const store = createMerchantPreviewRepository(pool);
  afterAll(() => pool.end());
  async function fixture() {
    const scope: MerchantPreviewScope = { shopId: randomUUID(), installationGeneration: '1', kind: 'merchant' };
    const configId = randomUUID();
    await core.transactions.run(async (tx) => {
      await core.tenants.createShop(tx, { shopId: scope.shopId, shopDomain: `${scope.shopId}.test.example` });
      await core.configs.createConfig(tx, {
        shopId: scope.shopId,
        configId,
        externalProductId: '42',
        draftSchemaVersion: 'm3-config-draft-v1',
        draftValue: {},
      });
    });
    const assetId = randomUUID();
    const row: MerchantPreviewRecord = {
      assetId,
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      productId: '42',
      imageRevisionId: 'product_42',
      originalKey: `originals/merchant-previews/${scope.shopId}/1/${assetId}`,
      previewKey: `previews/merchant-previews/${scope.shopId}/1/${assetId}.png`,
      manifest: {
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        byteLength: 10,
        sha256: 'a'.repeat(64),
        width: 100,
        height: 100,
        previewSha256: 'b'.repeat(64),
        previewByteLength: 9,
      },
      collectedAt: now,
      abandonAt: new Date(+now + 7 * 86400000),
      state: 'PREPARING',
      claimId: null,
    };
    return { scope, configId, row };
  }
  async function usable(f: Awaited<ReturnType<typeof fixture>>) {
    await store.prepare(f.scope, f.row);
    const claim = randomUUID();
    expect(await store.beginCapture(f.scope, f.row.assetId, claim, now)).toBe(true);
    return store.finishCapture(f.scope, f.row.assetId, claim, now);
  }
  function bind(f: Awaited<ReturnType<typeof fixture>>, assetId = f.row.assetId, imageRevisionId = 'product_42') {
    const revisionId = randomUUID();
    return core.transactions.run((tx) =>
      core.configs.createValidatedRevision(tx, {
        shopId: f.scope.shopId,
        configId: f.configId,
        revisionId,
        mode: 'optional',
        sourceDraftVersion: '1',
        sourceInstallationGeneration: '1',
        createdByRef: 'synthetic',
        publishedValue: {
          version: 'm2-published-config-v1',
          shopId: f.scope.shopId,
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
            views: [
              {
                id: 'front',
                image: { revisionId: 'product_42', width: 100, height: 100 },
                variantImages: [],
                placements: [],
              },
            ],
            steps: [],
          },
        },
        presentation: { version: 'm5-presentation-v1', labels: {} },
        previewAssets: [{ imageRevisionId, assetId }],
      }),
    );
  }
  it('captures through the application into the real durable store and binds the resulting immutable revision reference', async () => {
    const f = await fixture();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const digest = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
    // Provider decoding/storage are explicit local doubles; the application and PostgreSQL store are real.
    const objects = new Map<string, Uint8Array>();
    let writes = 0;
    const capture = createMerchantPreviewCapture({
      store: core.merchantPreviews,
      clock: () => now,
      readImage: async () => png,
      inspect: async () => ({
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalSha256: digest,
        preview: png,
        previewMimeType: 'image/png',
      }),
      storage: {
        async read({ key }) {
          const bytes = objects.get(key);
          if (!bytes) throw new ArtworkError('NOT_FOUND');
          return Uint8Array.from(bytes);
        },
        async putImmutable({ key, bytes }) {
          if (objects.has(key)) throw new ArtworkError('CONFLICT');
          objects.set(key, Uint8Array.from(bytes));
          writes++;
        },
        async remove({ key }) {
          objects.delete(key);
        },
      },
    });
    const result = await capture.capture(f.scope, {
      assetId: f.row.assetId,
      productId: '42',
      imageRevisionId: 'product_42',
    });
    expect(result?.state).toBe('USABLE');
    expect(result?.manifest?.sha256).toBe(digest);
    expect(writes).toBe(2);
    expect(objects.get(f.row.originalKey)).toEqual(png);
    expect(objects.get(f.row.previewKey)).toEqual(png);
    const differentDimensions = await fixture();
    if (!differentDimensions.row.manifest) throw Error('Synthetic manifest missing');
    differentDimensions.row.manifest.width = 101;
    await usable(differentDimensions);
    await expect(bind(differentDimensions)).rejects.toMatchObject({ code: '23514' });
    const revision = await bind(f);
    const refs = await pool.query(
      'SELECT asset_id,image_revision_id FROM config_revision_preview_assets WHERE shop_id=$1 AND revision_id=$2',
      [f.scope.shopId, revision.revisionId],
    );
    expect(refs.rows).toEqual([{ asset_id: f.row.assetId, image_revision_id: 'product_42' }]);
    expect(await store.markDeleting(f.row.assetId, later)).toBeNull();
  });
  it('removes both populated abandoned objects while preserving a bound historical preview', async () => {
    const bound = await fixture();
    const abandoned = await fixture();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const objects = new Map<string, Uint8Array>();
    const removals: string[] = [];
    let clock = now;
    // Real application and durable store; only catalog/inspection/storage ports are local doubles.
    const capture = createMerchantPreviewCapture({
      store,
      clock: () => clock,
      readImage: async () => png,
      inspect: async () => ({
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
        preview: png,
        previewMimeType: 'image/png',
      }),
      storage: {
        async read({ key }) {
          const bytes = objects.get(key);
          if (!bytes) throw new ArtworkError('NOT_FOUND');
          return Uint8Array.from(bytes);
        },
        async putImmutable({ key, bytes }) {
          if (objects.has(key)) throw new ArtworkError('CONFLICT');
          objects.set(key, Uint8Array.from(bytes));
        },
        async remove({ key }) {
          removals.push(key);
          objects.delete(key);
        },
      },
    });
    for (const f of [bound, abandoned])
      await capture.capture(f.scope, { assetId: f.row.assetId, productId: '42', imageRevisionId: 'product_42' });
    const revision = await bind(bound);
    expect(objects.size).toBe(4);
    expect(await store.markDeleting(abandoned.row.assetId, clock)).toBeNull();
    expect(removals).toEqual([]);
    clock = later;
    // Put this candidate first without touching other fixtures in the shared disposable database.
    await pool.query('UPDATE merchant_preview_assets SET updated_at=$2 WHERE asset_id=$1', [
      abandoned.row.assetId,
      new Date('1800-01-01T00:00:00Z'),
    ]);
    expect(await store.selectCleanup(1, clock)).toEqual([abandoned.row.assetId]);
    expect(await capture.cleanup(1)).toBe(1);
    expect(removals).toEqual([abandoned.row.originalKey, abandoned.row.previewKey]);
    expect(objects.has(abandoned.row.originalKey)).toBe(false);
    expect(objects.has(abandoned.row.previewKey)).toBe(false);
    expect(await store.get(abandoned.scope, abandoned.row.assetId)).toBeNull();
    expect(await store.readDeleting(abandoned.row.assetId)).toBeNull();
    const refs = await store.getForRevision(bound.scope, { productId: '42', revisionId: revision.revisionId });
    expect(refs.map((row) => row.assetId)).toEqual([bound.row.assetId]);
    expect(refs[0]?.state).toBe('USABLE');
    expect(objects.get(bound.row.originalKey)).toEqual(png);
    expect(objects.get(bound.row.previewKey)).toEqual(png);
  });
  it('reads only usable exact immutable revision bindings for the active shop, generation and product', async () => {
    const f = await fixture();
    await usable(f);
    const revision = await bind(f);
    const target = { productId: '42', revisionId: revision.revisionId };
    expect((await store.getForRevision(f.scope, target)).map((r) => r.assetId)).toEqual([f.row.assetId]);
    expect(await store.getForRevision({ ...f.scope, shopId: randomUUID() }, target)).toEqual([]);
    expect(await store.getForRevision({ ...f.scope, installationGeneration: '2' }, target)).toEqual([]);
    expect(await store.getForRevision(f.scope, { ...target, productId: '99' })).toEqual([]);
    expect(await store.getForRevision(f.scope, { ...target, revisionId: randomUUID() })).toEqual([]);
    const unbound = await fixture();
    await usable(unbound);
    expect(await store.getForRevision(unbound.scope, target)).toEqual([]);
    await pool.query('UPDATE installation_generations SET deactivated_at=$2 WHERE shop_id=$1', [f.scope.shopId, now]);
    expect(await store.getForRevision(f.scope, target)).toEqual([]);
  });
  it('rejects direct SQL inactive capture/settlement, manufactured state and malformed manifests/timestamps', async () => {
    const f = await fixture();
    async function insert(
      overrides: {
        state?: string;
        manifest?: unknown;
        collectedAt?: string;
        abandonAt?: string;
        updatedAt?: string;
      } = {},
    ) {
      const id = randomUUID();
      return pool.query(
        `INSERT INTO merchant_preview_assets(asset_id,shop_id,installation_generation,product_id,image_revision_id,
        original_key,preview_key,manifest,collected_at,abandon_at,state,updated_at)
        VALUES($1,$2,1,'42','product_42',$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          f.scope.shopId,
          `originals/merchant-previews/${f.scope.shopId}/1/${id}`,
          `previews/merchant-previews/${f.scope.shopId}/1/${id}.png`,
          JSON.stringify(overrides.manifest ?? f.row.manifest),
          overrides.collectedAt ?? now.toISOString(),
          overrides.abandonAt ?? f.row.abandonAt.toISOString(),
          overrides.state ?? 'PREPARING',
          overrides.updatedAt ?? now.toISOString(),
        ],
      );
    }
    await expect(insert({ state: 'USABLE' })).rejects.toMatchObject({ code: '23514' });
    for (const manifest of [
      { ...f.row.manifest, byteLength: '10' },
      { ...f.row.manifest, width: 1.5 },
      { ...f.row.manifest, sha256: 1e63 },
      { ...f.row.manifest, previewByteLength: 7 },
    ])
      await expect(insert({ manifest })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ collectedAt: 'infinity', abandonAt: 'infinity' })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ updatedAt: 'infinity' })).rejects.toMatchObject({ code: '23514' });
    await store.prepare(f.scope, f.row);
    const claim = randomUUID();
    await store.beginCapture(f.scope, f.row.assetId, claim, now);
    await expect(
      pool.query("UPDATE merchant_preview_assets SET state='RETIRED',claim_id=NULL WHERE asset_id=$1", [f.row.assetId]),
    ).rejects.toMatchObject({ code: '23514' });
    const pending = { ...f.row, assetId: randomUUID() };
    pending.originalKey = `originals/merchant-previews/${f.scope.shopId}/1/${pending.assetId}`;
    pending.previewKey = `previews/merchant-previews/${f.scope.shopId}/1/${pending.assetId}.png`;
    await store.prepare(f.scope, pending);
    await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.scope.shopId));
    await expect(insert()).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE merchant_preview_assets SET state='WRITING',claim_id=$2 WHERE asset_id=$1", [
        pending.assetId,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE merchant_preview_assets SET state='USABLE',claim_id=NULL WHERE asset_id=$1", [f.row.assetId]),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await store.finishCapture(f.scope, f.row.assetId, claim, now)).state).toBe('RETIRED');
  });
  it('fences tenant ownership, exact storage keys and one-use capture without an expiring writer lease', async () => {
    const f = await fixture();
    await expect(store.prepare(f.scope, { ...f.row, originalKey: 'originals/someone-else' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await store.prepare(f.scope, f.row);
    expect(await store.get({ ...f.scope, shopId: randomUUID() }, f.row.assetId)).toBeNull();
    const claims = await Promise.all(
      [randomUUID(), randomUUID()].map((claim) => store.beginCapture(f.scope, f.row.assetId, claim, now)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.selectCleanup(100, later)).not.toContain(f.row.assetId);
    expect(await store.markDeleting(f.row.assetId, later)).toBeNull();
    await pool.query('UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1', [
      f.scope.shopId,
    ]);
    expect(await store.selectCleanup(100, later)).not.toContain(f.row.assetId);
    expect(await store.markDeleting(f.row.assetId, later)).toBeNull();
    await expect(store.finishCapture(f.scope, f.row.assetId, randomUUID(), now)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('preserves immutable manifest/ownership/deadline and retires late completion after uninstall', async () => {
    const f = await fixture();
    await store.prepare(f.scope, f.row);
    const claim = randomUUID();
    await store.beginCapture(f.scope, f.row.assetId, claim, now);
    for (const update of [
      "shop_id='other'",
      "abandon_at=abandon_at+interval '1 day'",
      "manifest=jsonb_set(manifest,'{sha256}',to_jsonb(repeat('c',64)))",
    ]) {
      await expect(
        pool.query(`UPDATE merchant_preview_assets SET ${update} WHERE asset_id=$1`, [f.row.assetId]),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.scope.shopId));
    expect((await store.finishCapture(f.scope, f.row.assetId, claim, now)).state).toBe('RETIRED');
    expect(await store.get(f.scope, f.row.assetId)).toBeNull();
    expect((await store.markDeleting(f.row.assetId, now))?.state).toBe('DELETING');
  });
  it('binds only usable same-product/same-generation geometry references and never expires referenced assets', async () => {
    const f = await fixture();
    const other = await fixture();
    await store.prepare(f.scope, f.row);
    await expect(bind(f)).rejects.toMatchObject({ code: '23514' });
    await usable(f);
    await usable(other);
    await expect(bind(f, other.row.assetId)).rejects.toBeDefined();
    await expect(bind(f, f.row.assetId, 'variant_999')).rejects.toThrow('geometry reference');
    const differentDimensions = await fixture();
    if (!differentDimensions.row.manifest) throw Error('Synthetic manifest missing');
    differentDimensions.row.manifest.width = 101;
    await usable(differentDimensions);
    await expect(bind(differentDimensions)).rejects.toMatchObject({ code: '23514' });
    const revision = await bind(f);
    expect(await store.markDeleting(f.row.assetId, later)).toBeNull();
    expect(await store.selectCleanup(100, later)).not.toContain(f.row.assetId);
    await expect(
      pool.query('DELETE FROM config_revision_preview_assets WHERE shop_id=$1 AND revision_id=$2', [
        f.scope.shopId,
        revision.revisionId,
      ]),
    ).rejects.toMatchObject({ code: '23000' });
    await pool.query('UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1', [
      f.scope.shopId,
    ]);
    expect((await store.markDeleting(f.row.assetId, now))?.state).toBe('DELETING');
  });
  it('serializes revision binding against cleanup without a dangling usable reference', async () => {
    const f = await fixture();
    await usable(f);
    const [binding, deletion] = await Promise.allSettled([bind(f), store.markDeleting(f.row.assetId, later)]);
    expect(deletion.status).toBe('fulfilled');
    if (binding.status === 'fulfilled') {
      expect(deletion.status === 'fulfilled' && deletion.value).toBeNull();
      expect((await store.get(f.scope, f.row.assetId))?.state).toBe('USABLE');
    } else {
      expect(deletion.status === 'fulfilled' && deletion.value?.state).toBe('DELETING');
      expect(
        (await pool.query('SELECT 1 FROM config_revision_preview_assets WHERE asset_id=$1', [f.row.assetId])).rowCount,
      ).toBe(0);
    }
  });
  it('cleans abandoned unbound assets once and retains a nonresurrecting manifest-free tombstone', async () => {
    const f = await fixture();
    await store.prepare(f.scope, f.row);
    expect(await store.markDeleting(f.row.assetId, now)).toBeNull();
    expect((await store.markDeleting(f.row.assetId, later))?.manifest).toEqual(f.row.manifest);
    expect(await store.markDeleting(f.row.assetId, later)).toBeNull();
    expect((await store.readDeleting(f.row.assetId))?.state).toBe('DELETING');
    await store.finishDeleting(f.row.assetId, later);
    await store.finishDeleting(f.row.assetId, later);
    expect(await store.readDeleting(f.row.assetId)).toBeNull();
    expect(await store.get(f.scope, f.row.assetId)).toBeNull();
    const tombstone = (
      await pool.query('SELECT state,manifest FROM merchant_preview_assets WHERE asset_id=$1', [f.row.assetId])
    ).rows[0];
    expect(tombstone).toEqual({ state: 'DELETED', manifest: null });
    await expect(
      pool.query('DELETE FROM merchant_preview_assets WHERE asset_id=$1', [f.row.assetId]),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(
      pool.query("UPDATE merchant_preview_assets SET state='PREPARING',manifest=$2 WHERE asset_id=$1", [
        f.row.assetId,
        JSON.stringify(f.row.manifest),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('rotates more unresolved deletions than the batch limit without starving later absence reconciliation', async () => {
    const rows: MerchantPreviewRecord[] = [];
    for (let index = 0; index < 4; index++) {
      const f = await fixture();
      await store.prepare(f.scope, f.row);
      await store.markDeleting(f.row.assetId, later);
      rows.push(f.row);
    }
    const blocked = new Set(rows.slice(0, 3).map((r) => r.assetId));
    // Isolate deterministic queue ordering from other fixtures in this shared disposable test DB.
    for (let index = 0; index < rows.length; index++)
      await pool.query('UPDATE merchant_preview_assets SET updated_at=$2 WHERE asset_id=$1', [
        rows[index]?.assetId,
        new Date(index < 3 ? '1900-01-01T00:00:00Z' : '1901-01-01T00:00:00Z'),
      ]);
    const clock = () => new Date(+later + 10000);
    expect((await store.selectCleanup(2, clock())).every((id) => blocked.has(id))).toBe(true);
    let mutations = 0,
      reports = 0;
    const service = createMerchantPreviewCapture({
      store,
      clock,
      readImage: async () => {
        throw Error('not used');
      },
      inspect: async () => {
        throw Error('not used');
      },
      storage: {
        read: async ({ key }) => {
          if ([...blocked].some((id) => key.includes(id))) return new Uint8Array([1]);
          throw new ArtworkError('NOT_FOUND');
        },
        putImmutable: async () => {
          mutations++;
          throw Error('not used');
        },
        remove: async () => {
          mutations++;
          throw Error('must not retry');
        },
      },
      onCleanupError: () => {
        reports++;
      },
    });
    expect(await service.cleanup(2)).toBe(0);
    expect(await service.cleanup(2)).toBe(1);
    expect(
      (await pool.query('SELECT state FROM merchant_preview_assets WHERE asset_id=$1', [rows[3]?.assetId])).rows[0]
        .state,
    ).toBe('DELETED');
    expect(reports).toBe(3);
    expect(mutations).toBe(0);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM merchant_preview_assets WHERE asset_id=ANY($1::uuid[]) AND state='DELETING'",
            [[...blocked]],
          )
        ).rows[0].count,
      ),
    ).toBe(3);
  });
});
