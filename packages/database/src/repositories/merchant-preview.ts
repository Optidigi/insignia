import {
  MerchantPreviewError,
  type MerchantPreviewRecord,
  type MerchantPreviewScope,
  type MerchantPreviewStore,
} from '@insignia/application';
import type { Pool, PoolClient } from 'pg';
import { sha256CanonicalJson } from '../hash/canonical.js';

type Row = {
  asset_id: string;
  shop_id: string;
  installation_generation: string;
  product_id: string;
  image_revision_id: string;
  original_key: string;
  preview_key: string;
  manifest: MerchantPreviewRecord['manifest'];
  collected_at: Date;
  abandon_at: Date;
  state: MerchantPreviewRecord['state'];
  claim_id: string | null;
};
const active = `EXISTS (SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL)`;
const referenced = `EXISTS (SELECT 1 FROM config_revision_preview_assets r WHERE r.asset_id=a.asset_id)`;
const eligible = `a.state NOT IN ('WRITING','DELETED') AND (a.state IN ('RETIRED','DELETING') OR NOT (${active}) OR (a.abandon_at <= $1 AND NOT (${referenced})))`;
const map = (r: Row): MerchantPreviewRecord => ({
  assetId: r.asset_id,
  shopId: r.shop_id,
  installationGeneration: r.installation_generation,
  productId: r.product_id,
  imageRevisionId: r.image_revision_id,
  originalKey: r.original_key,
  previewKey: r.preview_key,
  manifest: r.manifest,
  collectedAt: r.collected_at,
  abandonAt: r.abandon_at,
  state: r.state,
  claimId: r.claim_id,
});
function fail(code: ConstructorParameters<typeof MerchantPreviewError>[0]): never {
  throw new MerchantPreviewError(code);
}
const owned = (r: Row, s: MerchantPreviewScope) =>
  s.kind === 'merchant' && r.shop_id === s.shopId && r.installation_generation === s.installationGeneration;
const uuid = (v: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export function createMerchantPreviewRepository(pool: Pool): MerchantPreviewStore {
  async function transaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
  async function lockTenant(c: PoolClient, shopId: string, generation: string): Promise<boolean> {
    // Lock even inactive/obsolete identities: deletion and late capture settlement still need serialization.
    const shop = await c.query<{ current_generation: string }>(
      'SELECT current_generation FROM shops WHERE shop_id=$1 FOR UPDATE',
      [shopId],
    );
    const installation = await c.query<{ deactivated_at: Date | null }>(
      'SELECT deactivated_at FROM installation_generations WHERE shop_id=$1 AND generation=$2 FOR UPDATE',
      [shopId, generation],
    );
    return shop.rows[0]?.current_generation === generation && installation.rows[0]?.deactivated_at === null;
  }
  async function locked<T>(
    id: string,
    work: (c: PoolClient, row: Row, live: boolean) => Promise<T>,
    missing: T,
  ): Promise<T> {
    if (!uuid(id)) return missing;
    return transaction(async (c) => {
      const identity = (await c.query<Row>('SELECT * FROM merchant_preview_assets WHERE asset_id=$1', [id])).rows[0];
      if (!identity) return missing;
      const live = await lockTenant(c, identity.shop_id, identity.installation_generation);
      const row = (await c.query<Row>('SELECT * FROM merchant_preview_assets WHERE asset_id=$1 FOR UPDATE', [id]))
        .rows[0];
      return row ? work(c, row, live) : missing;
    });
  }
  return {
    async get(scope, id) {
      return locked(
        id,
        async (_c, row, live) => (live && owned(row, scope) && row.state !== 'DELETED' ? map(row) : null),
        null,
      );
    },
    async prepare(scope, row) {
      if (
        scope.kind !== 'merchant' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(row.shopId) ||
        row.shopId !== scope.shopId ||
        row.installationGeneration !== scope.installationGeneration ||
        !uuid(row.assetId) ||
        !/^[1-9][0-9]*$/.test(row.installationGeneration) ||
        row.state !== 'PREPARING' ||
        row.claimId !== null ||
        !row.manifest ||
        !Number.isFinite(+row.collectedAt) ||
        +row.abandonAt !== +row.collectedAt + 7 * 86400000 ||
        !/^[1-9][0-9]{0,19}$/.test(row.productId) ||
        !/^(product|variant)_[1-9][0-9]{0,19}$/.test(row.imageRevisionId) ||
        row.originalKey !== `originals/merchant-previews/${row.shopId}/${row.installationGeneration}/${row.assetId}` ||
        row.previewKey !== `previews/merchant-previews/${row.shopId}/${row.installationGeneration}/${row.assetId}.png`
      )
        fail('INVALID_INPUT');
      return transaction(async (c) => {
        if (!(await lockTenant(c, scope.shopId, scope.installationGeneration))) fail('UNAVAILABLE');
        await c.query(
          `INSERT INTO merchant_preview_assets(asset_id,shop_id,installation_generation,product_id,image_revision_id,original_key,preview_key,manifest,collected_at,abandon_at,state)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PREPARING') ON CONFLICT(asset_id) DO NOTHING`,
          [
            row.assetId,
            row.shopId,
            row.installationGeneration,
            row.productId,
            row.imageRevisionId,
            row.originalKey,
            row.previewKey,
            JSON.stringify(row.manifest),
            row.collectedAt,
            row.abandonAt,
          ],
        );
        const actual = (
          await c.query<Row>('SELECT * FROM merchant_preview_assets WHERE asset_id=$1 FOR UPDATE', [row.assetId])
        ).rows[0];
        if (!actual || !owned(actual, scope)) fail('CONFLICT');
        const actualValue = map(actual);
        if (
          sha256CanonicalJson({
            ...actualValue,
            state: 'PREPARING',
            claimId: null,
            collectedAt: actualValue.collectedAt.toISOString(),
            abandonAt: actualValue.abandonAt.toISOString(),
          }) !==
          sha256CanonicalJson({
            ...row,
            collectedAt: row.collectedAt.toISOString(),
            abandonAt: row.abandonAt.toISOString(),
          })
        )
          fail('CONFLICT');
        return actualValue;
      });
    },
    async beginCapture(scope, id, claimId, now) {
      if (!uuid(claimId) || !Number.isFinite(+now)) fail('INVALID_INPUT');
      return locked(
        id,
        async (c, row, live) => {
          if (!live || !owned(row, scope) || row.state !== 'PREPARING' || row.abandon_at <= now) return false;
          await c.query(
            "UPDATE merchant_preview_assets SET state='WRITING',claim_id=$2,updated_at=$3 WHERE asset_id=$1",
            [id, claimId, now],
          );
          return true;
        },
        false,
      );
    },
    async finishCapture(scope, id, claimId, now) {
      return locked(
        id,
        async (c, row, live) => {
          if (!owned(row, scope) || row.state !== 'WRITING' || row.claim_id !== claimId) fail('CONFLICT');
          return map(
            (
              await c.query<Row>(
                'UPDATE merchant_preview_assets SET state=$2,claim_id=NULL,updated_at=$3 WHERE asset_id=$1 RETURNING *',
                [id, live ? 'USABLE' : 'RETIRED', now],
              )
            ).rows[0] ?? fail('CONFLICT'),
          );
        },
        null,
      ).then((row) => row ?? fail('NOT_FOUND'));
    },
    async selectCleanup(limit, now) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(+now)) fail('INVALID_INPUT');
      return (
        await pool.query<{ asset_id: string }>(
          `SELECT a.asset_id FROM merchant_preview_assets a WHERE ${eligible} ORDER BY updated_at,asset_id LIMIT $2`,
          [now, limit],
        )
      ).rows.map((r) => r.asset_id);
    },
    async markDeleting(id, now) {
      return locked(
        id,
        async (c, row) => {
          const candidate = (
            await c.query<Row>(`SELECT a.* FROM merchant_preview_assets a WHERE a.asset_id=$2 AND ${eligible}`, [
              now,
              id,
            ])
          ).rows[0];
          if (!candidate) return null;
          if (row.state === 'DELETING') return null;
          return map(
            (
              await c.query<Row>(
                "UPDATE merchant_preview_assets SET state='DELETING',updated_at=$2 WHERE asset_id=$1 RETURNING *",
                [id, now],
              )
            ).rows[0] ?? fail('CONFLICT'),
          );
        },
        null,
      );
    },
    async readDeleting(id) {
      return locked(id, async (_c, row) => (row.state === 'DELETING' ? map(row) : null), null);
    },
    async finishDeleting(id, now) {
      await locked(
        id,
        async (c, row) => {
          if (row.state === 'DELETED') return;
          if (row.state !== 'DELETING') fail('CONFLICT');
          await c.query(
            "UPDATE merchant_preview_assets SET state='DELETED',manifest=NULL,updated_at=$2 WHERE asset_id=$1",
            [id, now],
          );
        },
        undefined,
      );
    },
  };
}
