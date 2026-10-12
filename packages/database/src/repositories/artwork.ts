import {
  ARTWORK_POLICY,
  ArtworkError,
  type ArtworkManifest,
  type ArtworkRecord,
  type ArtworkScope,
  type ArtworkStore,
} from '@insignia/application';
import type { Pool, PoolClient } from 'pg';

type Row = {
  asset_id: string;
  shop_id: string;
  installation_generation: string;
  owner_hash: string | null;
  declared_mime: ArtworkRecord['declaredMime'];
  declared_bytes: number;
  state: ArtworkRecord['state'];
  quarantine_key: string;
  original_key: string;
  preview_key: string;
  collected_at: Date;
  upload_until: Date;
  expires_at: Date;
  claim_id: string | null;
  claim_until: Date | null;
  manifest: ArtworkManifest | null;
  rejection: string | null;
  updated_at: Date;
};
const active = `EXISTS (SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL)`;
const expired = `(a.expires_at <= $1 OR (a.state='UPLOADING' AND a.collected_at <= $1::timestamptz - interval '24 hours') OR a.state IN ('REJECTED','DELETING') OR NOT (${active}))`;
const map = (r: Row): ArtworkRecord => ({
  assetId: r.asset_id,
  shopId: r.shop_id,
  installationGeneration: r.installation_generation,
  ownerHash: r.owner_hash ?? '',
  declaredMime: r.declared_mime,
  declaredBytes: r.declared_bytes,
  state: r.state,
  quarantineKey: r.quarantine_key,
  originalKey: r.original_key,
  previewKey: r.preview_key,
  collectedAt: r.collected_at,
  uploadUntil: r.upload_until,
  expiresAt: r.expires_at,
  claimId: r.claim_id,
  manifest: r.manifest,
  rejection: r.rejection,
});
const fail = (code: ConstructorParameters<typeof ArtworkError>[0]): never => {
  throw new ArtworkError(code);
};
function validManifest(m: ArtworkManifest, row: Row) {
  return (
    m.version === 'm6-inspection-v1' &&
    m.mimeType === row.declared_mime &&
    m.byteLength === row.declared_bytes &&
    /^[a-f0-9]{64}$/.test(m.sha256) &&
    /^[a-f0-9]{64}$/.test(m.previewSha256) &&
    Number.isSafeInteger(m.previewByteLength) &&
    m.previewByteLength > 0 &&
    m.previewByteLength <= ARTWORK_POLICY.previewMaxBytes &&
    Number.isSafeInteger(m.width) &&
    Number.isSafeInteger(m.height) &&
    m.width > 0 &&
    m.height > 0 &&
    m.width <= 12000 &&
    m.height <= 12000 &&
    m.width * m.height <= 40000000
  );
}
function sameManifest(a: ArtworkManifest, b: ArtworkManifest) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => b[key as keyof ArtworkManifest] === value)
  );
}

/** The pool remains private; callers receive only the scoped artwork port. */
export function createArtworkRepository(pool: Pool): ArtworkStore {
  async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const result = await run(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function lockTenant(c: PoolClient, shopId: string, generation: string) {
    const r = await c.query(
      `SELECT s.shop_id FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=$1 AND s.current_generation=$2 AND i.deactivated_at IS NULL FOR UPDATE OF s,i`,
      [shopId, generation],
    );
    return r.rowCount === 1;
  }
  async function locked<T>(
    id: string,
    run: (c: PoolClient, row: Row, live: boolean) => Promise<T>,
    missing: T,
  ): Promise<T> {
    return transaction(async (c) => {
      const identity = await c.query<Row>('SELECT * FROM artwork_assets WHERE asset_id=$1', [id]);
      if (!identity.rows[0]) return missing;
      const r = identity.rows[0];
      const live = await lockTenant(c, r.shop_id, r.installation_generation);
      const row = (await c.query<Row>('SELECT * FROM artwork_assets WHERE asset_id=$1 FOR UPDATE', [id])).rows[0];
      return row ? run(c, row, live) : missing;
    });
  }
  const owned = (r: Row, s: ArtworkScope) =>
    r.shop_id === s.shopId &&
    r.installation_generation === s.installationGeneration &&
    (s.kind === 'merchant' || s.ownerHash === r.owner_hash);
  const claimed = (r: Row, id: string, now: Date) => r.claim_id === id && r.claim_until !== null && r.claim_until > now;
  async function change(c: PoolClient, id: string, set: string, values: unknown[]) {
    return (
      (
        await c.query<Row>(
          `UPDATE artwork_assets SET ${set},updated_at=clock_timestamp() WHERE asset_id=$1 RETURNING *`,
          [id, ...values],
        )
      ).rows[0] ?? fail('CONFLICT')
    );
  }
  return {
    async create(input) {
      if (
        ![input.collectedAt, input.uploadUntil, input.expiresAt].every(
          (date) => date instanceof Date && Number.isFinite(+date),
        ) ||
        input.state !== 'UPLOADING' ||
        input.manifest !== null ||
        input.claimId !== null ||
        input.rejection !== null ||
        !['image/png', 'image/jpeg', 'image/svg+xml'].includes(input.declaredMime) ||
        !Number.isSafeInteger(input.declaredBytes) ||
        input.declaredBytes < 1 ||
        input.declaredBytes > ARTWORK_POLICY.maxBytes ||
        !/^[a-f0-9]{64}$/.test(input.ownerHash) ||
        input.uploadUntil <= input.collectedAt ||
        +input.uploadUntil > +input.collectedAt + ARTWORK_POLICY.uploadMs ||
        input.expiresAt <= input.collectedAt ||
        +input.expiresAt > +input.collectedAt + ARTWORK_POLICY.retainedMs
      )
        fail('INVALID_INPUT');
      return transaction(async (c) => {
        if (!(await lockTenant(c, input.shopId, input.installationGeneration))) fail('NOT_FOUND');
        const totals =
          (
            await c.query<{ unfinished: string; daily: string; retained: string }>(
              `SELECT count(*) FILTER(WHERE state IN ('UPLOADING','QUEUED','INSPECTING','PROMOTING') AND expires_at>$2 AND collected_at>$2::timestamptz-interval '24 hours') AS unfinished,coalesce(sum(declared_bytes) FILTER(WHERE collected_at>$2::timestamptz-interval '24 hours'),0) AS daily,coalesce(sum(declared_bytes) FILTER(WHERE state!='DELETED'),0) AS retained FROM artwork_assets WHERE shop_id=$1`,
              [input.shopId, input.collectedAt],
            )
          ).rows[0] ?? fail('CONFLICT');
        if (
          Number(totals.unfinished) >= 5 ||
          Number(totals.daily) + input.declaredBytes > 100 * 1024 * 1024 ||
          Number(totals.retained) + input.declaredBytes > 500 * 1024 * 1024
        )
          fail('UNAVAILABLE');
        const r = await c.query<Row>(
          `INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES($1,$2,$3,$4,$5,$6,'UPLOADING',$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            input.assetId,
            input.shopId,
            input.installationGeneration,
            input.ownerHash,
            input.declaredMime,
            input.declaredBytes,
            input.quarantineKey,
            input.originalKey,
            input.previewKey,
            input.collectedAt,
            input.uploadUntil,
            input.expiresAt,
          ],
        );
        return map(r.rows[0] ?? fail('CONFLICT'));
      });
    },
    async get(scope, id) {
      const r = await pool.query<Row>(
        `SELECT a.* FROM artwork_assets a WHERE asset_id=$1 AND shop_id=$2 AND installation_generation=$3 AND ($4='merchant' OR owner_hash=$5) AND ${active}`,
        [id, scope.shopId, scope.installationGeneration, scope.kind, scope.ownerHash ?? null],
      );
      return r.rows[0] ? map(r.rows[0]) : null;
    },
    async complete(scope, id, now) {
      const result = await locked(
        id,
        async (c, r, live) => {
          if (!live || !owned(r, scope)) fail('NOT_FOUND');
          if (r.expires_at <= now || ['REJECTED', 'DELETING', 'DELETED'].includes(r.state)) fail('EXPIRED');
          if (r.state !== 'UPLOADING') return map(r);
          if (r.upload_until <= now) fail('EXPIRED');
          return map(await change(c, id, "state='QUEUED'", []));
        },
        null,
      );
      return result ?? fail('NOT_FOUND');
    },
    async claim(id, claimId, now, until) {
      if (until <= now || +until > +now + ARTWORK_POLICY.leaseMs) fail('INVALID_INPUT');
      return locked(
        id,
        async (c, r, live) => {
          if (
            !live ||
            r.expires_at <= now ||
            !['QUEUED', 'INSPECTING', 'PROMOTING'].includes(r.state) ||
            (r.claim_until && r.claim_until > now)
          )
            return null;
          return map(
            await change(
              c,
              id,
              "state=CASE WHEN manifest IS NULL THEN 'INSPECTING' ELSE 'PROMOTING' END,claim_id=$2,claim_until=$3",
              [claimId, until],
            ),
          );
        },
        null,
      );
    },
    async prepare(id, claimId, manifest, now) {
      const result = await locked(
        id,
        async (c, r, live) => {
          if (
            !live ||
            !claimed(r, claimId, now) ||
            r.expires_at <= now ||
            !['INSPECTING', 'PROMOTING'].includes(r.state)
          )
            fail('CONFLICT');
          if (!validManifest(manifest, r)) fail('INVALID_INPUT');
          if (r.manifest && !sameManifest(r.manifest, manifest)) fail('CONFLICT');
          return map(await change(c, id, "state='PROMOTING',manifest=$2", [JSON.stringify(manifest)]));
        },
        null,
      );
      return result ?? fail('NOT_FOUND');
    },
    async settle(id, claimId, now) {
      return locked(
        id,
        async (c, r, live) => {
          if (!live || !claimed(r, claimId, now) || r.state !== 'PROMOTING' || !r.manifest || r.expires_at <= now)
            return false;
          await change(c, id, "state='USABLE',claim_id=NULL,claim_until=NULL", []);
          return true;
        },
        false,
      );
    },
    async reject(id, claimId, reason, now) {
      await locked(
        id,
        async (c, r, live) => {
          if (live && claimed(r, claimId, now) && ['INSPECTING', 'PROMOTING'].includes(r.state))
            await change(c, id, "state='REJECTED',rejection=$2,claim_id=NULL,claim_until=NULL", [
              /^[A-Z_]{1,64}$/.test(reason) ? reason : 'INSPECTION_REJECTED',
            ]);
        },
        undefined,
      );
    },
    async release(id, claimId) {
      await locked(
        id,
        async (c, r) => {
          if (r.claim_id === claimId && ['INSPECTING', 'PROMOTING'].includes(r.state))
            await change(
              c,
              id,
              "state=CASE WHEN manifest IS NULL THEN 'QUEUED' ELSE 'PROMOTING' END,claim_id=NULL,claim_until=NULL",
              [],
            );
        },
        undefined,
      );
    },
    async selectPending(limit, now) {
      const r = await pool.query<{ asset_id: string }>(
        `SELECT a.asset_id FROM artwork_assets a WHERE state IN ('QUEUED','INSPECTING','PROMOTING') AND expires_at>$1 AND (claim_until IS NULL OR claim_until<=$1) AND ${active} ORDER BY collected_at,asset_id LIMIT $2`,
        [now, Math.max(1, Math.min(100, Math.trunc(limit)))],
      );
      return r.rows.map((r) => r.asset_id);
    },
    async selectExpired(limit, now) {
      const r = await pool.query<Row>(
        `SELECT a.* FROM artwork_assets a WHERE ((state!='DELETED' AND ${expired}) OR (state='DELETED' AND expires_at + ($3 + 30000) * interval '1 millisecond' >= $1 AND updated_at <= $1::timestamptz - interval '60 seconds')) AND (claim_until IS NULL OR claim_until<=$1) ORDER BY updated_at,collected_at,asset_id LIMIT $2`,
        [now, Math.max(1, Math.min(100, Math.trunc(limit))), ARTWORK_POLICY.leaseMs],
      );
      return r.rows.map(map);
    },
    async markDeleting(id, now) {
      return locked(
        id,
        async (c, r, live) => {
          if (r.claim_until && r.claim_until > now) return null;
          if (r.state === 'DELETED') {
            if (+now > +r.expires_at + ARTWORK_POLICY.leaseMs + 30000 || +r.updated_at > +now - 60000) return null;
            await c.query('UPDATE artwork_assets SET updated_at=$2 WHERE asset_id=$1', [id, now]);
            return map(r);
          }
          if (
            live &&
            r.expires_at > now &&
            !['REJECTED', 'DELETING'].includes(r.state) &&
            !(r.state === 'UPLOADING' && +r.collected_at <= +now - ARTWORK_POLICY.incompleteMs)
          )
            return null;
          return map(await change(c, id, "state='DELETING',claim_id=NULL,claim_until=NULL", []));
        },
        null,
      );
    },
    async finishDeleting(id, now) {
      await locked(
        id,
        async (c, r) => {
          if (r.state === 'DELETING' || r.state === 'DELETED')
            await c.query(
              "UPDATE artwork_assets SET state='DELETED',manifest=NULL,owner_hash=NULL,rejection=NULL,claim_id=NULL,claim_until=NULL,updated_at=$2 WHERE asset_id=$1",
              [id, now],
            );
        },
        undefined,
      );
    },
    async selectQuarantineCleanup(limit, now) {
      const rows = await pool.query<Row>(
        `SELECT a.* FROM artwork_assets a WHERE state='USABLE' AND (quarantine_cleaned_at IS NULL OR quarantine_cleaned_at<=$1::timestamptz-interval '60 seconds') AND upload_until<=$1 AND expires_at>$1 AND ${active} ORDER BY upload_until,asset_id LIMIT $2`,
        [now, Math.max(1, Math.min(100, Math.trunc(limit)))],
      );
      return rows.rows.map(map);
    },
    async markQuarantineCleaned(id, now) {
      await locked(
        id,
        async (c, r, live) => {
          if (live && r.state === 'USABLE' && r.upload_until <= now)
            await c.query('UPDATE artwork_assets SET quarantine_cleaned_at=$2,updated_at=$2 WHERE asset_id=$1', [
              id,
              now,
            ]);
        },
        undefined,
      );
    },
    async readUsability(shopId, generation, ids, now) {
      if (ids.length === 0) return [];
      if (ids.length > 100) fail('INVALID_INPUT');
      const r = await pool.query<Row>(
        `SELECT a.* FROM artwork_assets a WHERE shop_id=$1 AND installation_generation=$2 AND asset_id=ANY($3::uuid[]) AND state='USABLE' AND manifest IS NOT NULL AND expires_at>$4 AND ${active}`,
        [shopId, generation, ids, now],
      );
      return r.rows.map(map);
    },
  };
}
