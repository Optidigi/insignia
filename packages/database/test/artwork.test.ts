import { randomUUID } from 'node:crypto';
import {
  ARTWORK_POLICY,
  type ArtworkManifest,
  type ArtworkRecord,
  type ArtworkStorage,
  createArtworkService,
} from '@insignia/application';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createDurableCore } from '../src/index.js';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

const now = new Date('2026-10-12T12:00:00Z');
function record(shopId: string): ArtworkRecord {
  const assetId = randomUUID();
  return {
    assetId,
    shopId,
    installationGeneration: '1',
    ownerHash: 'a'.repeat(64),
    declaredMime: 'image/png',
    declaredBytes: 10,
    state: 'UPLOADING',
    quarantineKey: `quarantine/${assetId}`,
    originalKey: `original/${assetId}`,
    previewKey: `preview/${assetId}`,
    collectedAt: now,
    uploadUntil: new Date(+now + 300000),
    expiresAt: new Date(+now + 604800000),
    claimId: null,
    manifest: null,
    rejection: null,
  };
}
describe.runIf(Boolean(process.env.DATABASE_URL))('durable artwork ownership and inspection', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const store = createArtworkRepository(pool);
  const ownedShops: string[] = [];
  async function ownTestShop(db: Awaited<ReturnType<typeof openTestDatabase>>) {
    const result = await createTestShop(db);
    ownedShops.push(result.shopId);
    return result;
  }
  afterEach(async () => {
    await pool.query('DELETE FROM artwork_assets WHERE shop_id=ANY($1::text[])', [ownedShops]);
    ownedShops.length = 0;
  });
  afterAll(() => pool.end());
  it('queues once, fences guest ownership and serializes competing inspection leases', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const input = record(shopId);
      await store.create(input);
      const merchant = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      expect(await store.get({ ...merchant, kind: 'guest', ownerHash: 'b'.repeat(64) }, input.assetId)).toBeNull();
      expect((await store.complete(merchant, input.assetId, now)).state).toBe('QUEUED');
      expect((await store.complete(merchant, input.assetId, now)).state).toBe('QUEUED');
      const claims = await Promise.all([
        store.claim(input.assetId, randomUUID(), now, new Date(+now + 60000)),
        store.claim(input.assetId, randomUUID(), now, new Date(+now + 60000)),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    } finally {
      await db.destroy();
    }
  });
  it('persists retry admission across repository instances and keeps unrelated assets eligible', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const first = record(shopId),
        second = record(shopId);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      for (const row of [first, second]) {
        await store.create(row);
        await store.complete(scope, row.assetId, now);
      }
      const claimId = randomUUID();
      await store.claim(first.assetId, claimId, now, new Date(+now + 60000));
      const retryAt = new Date(+now + 30000);
      await store.release(first.assetId, claimId, retryAt);
      const resumed = createArtworkRepository(pool);
      expect(await resumed.selectPending(100, now)).not.toContain(first.assetId);
      expect(await resumed.selectPending(100, now)).toContain(second.assetId);
      expect(await resumed.claim(first.assetId, randomUUID(), now, new Date(+now + 60000))).toBeNull();
      expect(await resumed.selectPending(100, retryAt)).toContain(first.assetId);
      const later = new Date(+retryAt + 1000),
        third = record(shopId);
      await store.create({
        ...third,
        collectedAt: later,
        uploadUntil: new Date(+later + 300000),
        expiresAt: new Date(+later + 604800000),
      });
      await store.complete(scope, third.assetId, later);
      const due = await resumed.selectPending(100, later);
      expect(due.indexOf(first.assetId)).toBeLessThan(due.indexOf(third.assetId));
      expect((await resumed.get(scope, first.assetId))?.expiresAt).toEqual(first.expiresAt);
    } finally {
      await db.destroy();
    }
  });
  it('promotes only a frozen verified manifest under the current lease and retains original deadlines', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const input = record(shopId);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      await store.create(input);
      await store.complete(scope, input.assetId, now);
      const claimId = randomUUID();
      await store.claim(input.assetId, claimId, now, new Date(+now + 60000));
      const manifest: ArtworkManifest = {
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        byteLength: 10,
        sha256: 'c'.repeat(64),
        width: 2,
        height: 2,
        previewSha256: 'd'.repeat(64),
        previewByteLength: 15,
      };
      await expect(store.prepare(input.assetId, claimId, { ...manifest, width: 12001 }, now)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      await store.prepare(input.assetId, claimId, manifest, now);
      await store.release(input.assetId, claimId);
      const next = randomUUID();
      const reclaimed = await store.claim(input.assetId, next, now, new Date(+now + 60000));
      expect(reclaimed?.manifest).toEqual(manifest);
      await expect(
        store.prepare(input.assetId, next, { ...manifest, sha256: 'e'.repeat(64) }, now),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await store.settle(input.assetId, claimId, now)).toBe(false);
      expect(await store.settle(input.assetId, next, now)).toBe(true);
      const usable = await store.readUsability(
        { shopId, installationGeneration: '1', kind: 'merchant' },
        [input.assetId],
        now,
      );
      expect(usable[0]?.expiresAt).toEqual(input.expiresAt);
      expect(usable[0]?.collectedAt).toEqual(input.collectedAt);
      const guest = { ...scope, kind: 'guest' as const, ownerHash: 'b'.repeat(64) };
      expect(await store.get(guest, input.assetId)).toBeNull();
      expect(await store.readUsability(guest, [input.assetId], now)).toEqual([]);
      expect(await store.readUsability({ ...guest, ownerHash: input.ownerHash }, [input.assetId], now)).toHaveLength(1);

      expect(
        await store.readUsability(
          { shopId, installationGeneration: '1', kind: 'merchant' },
          Array.from({ length: 256 }, () => input.assetId),
          now,
        ),
      ).toHaveLength(1);
      await expect(
        store.readUsability(
          { shopId, installationGeneration: '1', kind: 'merchant' },
          Array.from({ length: 257 }, () => input.assetId),
          now,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(
        await store.readUsability(
          { shopId, installationGeneration: '1', kind: 'merchant' },
          [input.assetId],
          input.expiresAt,
        ),
      ).toEqual([]);
      expect(await store.markDeleting(input.assetId, now)).toBeNull();
      expect((await store.markDeleting(input.assetId, input.expiresAt))?.state).toBe('DELETING');
      await store.finishDeleting(input.assetId, input.expiresAt);
      const deleted = await store.get(scope, input.assetId);
      expect(deleted?.manifest).toBeNull();
      expect(deleted?.ownerHash).toBe('');
      expect(deleted?.collectedAt).toEqual(input.collectedAt);
      expect(deleted?.originalKey).toBe(input.originalKey);
    } finally {
      await db.destroy();
    }
  });
  it('fences unfinished inspections after a generation change and permits erasure without reactivation', async () => {
    const db = await openTestDatabase();
    const core = createDurableCore(pool);
    try {
      const { shopId } = await ownTestShop(db);
      const input = record(shopId);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      await store.create(input);
      await store.complete(scope, input.assetId, now);
      const claimId = randomUUID();
      await store.claim(input.assetId, claimId, now, new Date(+now + 60000));
      await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId));
      expect(await store.get(scope, input.assetId)).toBeNull();
      expect(await store.settle(input.assetId, claimId, now)).toBe(false);
      expect(await store.markDeleting(input.assetId, now)).toBeNull();
      const later = new Date(+now + 60001);
      expect((await store.markDeleting(input.assetId, later))?.state).toBe('DELETING');
      await store.finishDeleting(input.assetId, later);
      expect(await store.selectExpired(100, later)).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
    } finally {
      await db.destroy();
    }
  });
  it('atomically admits five unfinished uploads and rejects expired completion', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const inputs = Array.from({ length: 6 }, () => record(shopId));
      const admission = await Promise.allSettled(inputs.map((input) => store.create(input)));
      expect(admission.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      const accepted = admission.find((r) => r.status === 'fulfilled');
      if (accepted?.status !== 'fulfilled') throw new Error('Expected admission');
      await expect(
        store.complete(
          { shopId, installationGeneration: '1', kind: 'merchant' },
          accepted.value.assetId,
          accepted.value.uploadUntil,
        ),
      ).rejects.toMatchObject({ code: 'EXPIRED' });
      expect(await store.markDeleting(accepted.value.assetId, accepted.value.uploadUntil)).toBeNull();
      expect((await store.markDeleting(accepted.value.assetId, new Date(+now + 86400000)))?.state).toBe('DELETING');
    } finally {
      await db.destroy();
    }
  });
  it('stores a buyer-actionable rejection reason and reads it back; anything else is stored generically (#445)', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      for (const [reason, stored] of [
        ['DIMENSIONS_TOO_LARGE', 'DIMENSIONS_TOO_LARGE'],
        ['INSPECTION_REJECTED', 'INSPECTION_REJECTED'],
        ['not a code', 'INSPECTION_REJECTED'],
      ] as const) {
        const row = { ...record(shopId), declaredBytes: 1 };
        await store.create(row);
        await store.complete(scope, row.assetId, now);
        const claim = randomUUID();
        await store.claim(row.assetId, claim, now, new Date(+now + 60000));
        await store.reject(row.assetId, claim, reason, now);
        expect(await store.get(scope, row.assetId)).toMatchObject({ state: 'REJECTED', rejection: stored });
      }
    } finally {
      await db.destroy();
    }
  });
  it('bounds daily admissions per owner when one-byte uploads are rejected', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      for (let count = 0; count < 30; count++) {
        const row = { ...record(shopId), declaredBytes: 1 };
        await store.create(row);
        await store.complete(scope, row.assetId, now);
        const claim = randomUUID();
        await store.claim(row.assetId, claim, now, new Date(+now + 60000));
        await store.reject(row.assetId, claim, 'INSPECTION_REJECTED', now);
      }
      // The owner's quota is a buyer-visible 429 that clears when the oldest admission leaves the window (#336).
      await expect(store.create({ ...record(shopId), declaredBytes: 1 })).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterSeconds: 86400,
      });
      await expect(store.create({ ...record(shopId), ownerHash: 'b'.repeat(64) })).resolves.toMatchObject({
        ownerHash: 'b'.repeat(64),
      });
      const nextDay = new Date(+now + 86400000),
        next = record(shopId);
      await expect(
        store.create({
          ...next,
          collectedAt: nextDay,
          uploadUntil: new Date(+nextDay + 300000),
          expiresAt: new Date(+nextDay + 604800000),
        }),
      ).resolves.toMatchObject({ assetId: next.assetId });
    } finally {
      await db.destroy();
    }
  });
  it("one visitor's abandoned uploads block neither another visitor nor themselves once the links expire", async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const visitorA = 'a'.repeat(64),
        visitorB = 'b'.repeat(64);
      for (let count = 0; count < 5; count++) await store.create({ ...record(shopId), ownerHash: visitorA });
      await expect(store.create({ ...record(shopId), ownerHash: visitorA })).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterSeconds: ARTWORK_POLICY.uploadMs / 1000,
      });
      await expect(store.create({ ...record(shopId), ownerHash: visitorB })).resolves.toMatchObject({
        ownerHash: visitorB,
      });
      // The 5-minute upload link has expired: completion is refused, so the upload no longer counts.
      const linkExpired = new Date(+now + ARTWORK_POLICY.uploadMs);
      await expect(
        store.create({
          ...record(shopId),
          ownerHash: visitorA,
          collectedAt: linkExpired,
          uploadUntil: new Date(+linkExpired + ARTWORK_POLICY.uploadMs),
          expiresAt: new Date(+linkExpired + ARTWORK_POLICY.retainedMs),
        }),
      ).resolves.toMatchObject({ ownerHash: visitorA });
    } finally {
      await db.destroy();
    }
  });
  it('keeps shop-wide unfinished and daily ceilings across many visitors', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const seed = (rows: number, state: 'UPLOADING' | 'DELETED') =>
        pool.query(
          `INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at,owner_kind)
           SELECT id,$1,1,CASE WHEN $6='DELETED' THEN NULL ELSE lpad(to_hex(n),64,'0') END,'image/png',1,$6,'quarantine/'||id,'original/'||id,'preview/'||id,$2,$3,$4,'guest'
           FROM (SELECT n,gen_random_uuid() id FROM generate_series(1,$5::int) n) g`,
          [
            shopId,
            now,
            new Date(+now + ARTWORK_POLICY.uploadMs),
            new Date(+now + ARTWORK_POLICY.retainedMs),
            rows,
            state,
          ],
        );
      const fresh = () => ({ ...record(shopId), ownerHash: 'f'.repeat(64) });
      await seed(ARTWORK_POLICY.shop.unfinished, 'UPLOADING');
      await expect(store.create(fresh())).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      await pool.query('DELETE FROM artwork_assets WHERE shop_id=$1', [shopId]);
      // Rejected and erased uploads no longer carry an owner, but still count toward the shop's day.
      await seed(ARTWORK_POLICY.shop.dailyUploads - 1, 'DELETED');
      await expect(store.create(fresh())).resolves.toMatchObject({ ownerHash: 'f'.repeat(64) });
      await expect(store.create({ ...fresh(), ownerHash: 'e'.repeat(64) })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    } finally {
      await db.destroy();
    }
  }, 60_000);
  it('re-sweeps tombstones within the bounded late-write window without restoring owner identity', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const input = record(shopId);
      await store.create(input);
      const deadline = input.expiresAt;
      await store.markDeleting(input.assetId, deadline);
      await store.finishDeleting(input.assetId, deadline);
      expect(await store.selectExpired(100, new Date(+deadline + 1000))).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      const resweepAt = new Date(+deadline + 60000);
      expect(await store.selectExpired(100, resweepAt)).toContainEqual(
        expect.objectContaining({ assetId: input.assetId, state: 'DELETED' }),
      );
      expect((await store.markDeleting(input.assetId, resweepAt))?.state).toBe('DELETED');
      await store.finishDeleting(input.assetId, resweepAt);
      expect(await store.selectExpired(100, new Date(+deadline + 61000))).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      // Elapsed time alone does not settle it: one successful sweep issued after the window does (#465).
      const pastWindow = new Date(+deadline + ARTWORK_POLICY.leaseMs + 30001);
      expect((await store.markDeleting(input.assetId, pastWindow))?.state).toBe('DELETED');
      await store.finishDeleting(input.assetId, new Date(+pastWindow + 1000));
      const later = new Date(+pastWindow + 3600000);
      expect(await store.selectExpired(100, later)).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      expect(await store.markDeleting(input.assetId, later)).toBeNull();
    } finally {
      await db.destroy();
    }
  });
  it('rotates failed deletion obligations without acknowledging erasure or starving untouched rows', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const first = record(shopId),
        second = record(shopId);
      for (const row of [first, second]) await store.create(row);
      const deadline = first.expiresAt;
      expect((await store.markDeleting(first.assetId, deadline))?.state).toBe('DELETING');
      // A failed storage DELETE leaves the first row pending, but not hot-looping.
      expect(await store.selectExpired(100, deadline)).not.toContainEqual(
        expect.objectContaining({ assetId: first.assetId }),
      );
      expect(await store.selectExpired(100, deadline)).toContainEqual(
        expect.objectContaining({ assetId: second.assetId }),
      );
      expect(await store.markDeleting(first.assetId, deadline)).toBeNull();
      const retryAt = new Date(+deadline + 60000);
      const selected = await store.selectExpired(100, retryAt);
      expect(selected.findIndex((row) => row.assetId === second.assetId)).toBeLessThan(
        selected.findIndex((row) => row.assetId === first.assetId),
      );
      expect(
        (await store.get({ shopId, installationGeneration: '1', kind: 'merchant' }, first.assetId))?.ownerHash,
      ).toBe(first.ownerHash);
    } finally {
      await db.destroy();
    }
  });
  it('rotates quarantine attempts fairly even when the previous delete failed', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const first = record(shopId),
        second = record(shopId);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      for (const row of [first, second]) {
        await store.create(row);
        await store.complete(scope, row.assetId, now);
        const claim = randomUUID();
        await store.claim(row.assetId, claim, now, new Date(+now + ARTWORK_POLICY.leaseMs));
        await store.prepare(
          row.assetId,
          claim,
          {
            version: 'm6-inspection-v1',
            mimeType: 'image/png',
            byteLength: 10,
            sha256: 'c'.repeat(64),
            width: 2,
            height: 2,
            previewSha256: 'd'.repeat(64),
            previewByteLength: 15,
          },
          now,
        );
        await store.settle(row.assetId, claim, now);
      }
      const deadline = first.uploadUntil;
      expect(await store.markQuarantineCleanupAttempt(first.assetId, deadline)).toBe(true);
      expect(await store.markQuarantineCleanupAttempt(first.assetId, deadline)).toBe(false);
      expect((await store.selectQuarantineCleanup(100, deadline)).map((row) => row.assetId)).not.toContain(
        first.assetId,
      );
      expect((await store.selectQuarantineCleanup(100, deadline)).map((row) => row.assetId)).toContain(second.assetId);
      const selected = await store.selectQuarantineCleanup(100, new Date(+deadline + 60000));
      expect(selected.findIndex((row) => row.assetId === second.assetId)).toBeLessThan(
        selected.findIndex((row) => row.assetId === first.assetId),
      );
      expect(
        await store.readUsability({ shopId, installationGeneration: '1', kind: 'merchant' }, [first.assetId], deadline),
      ).toHaveLength(1);
    } finally {
      await db.destroy();
    }
  });
  it('reconciles reusable quarantine URLs only after upload authorization expires', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const input = record(shopId);
      await store.create(input);
      await store.complete({ shopId, installationGeneration: '1', kind: 'merchant' }, input.assetId, now);
      const claim = randomUUID();
      await store.claim(input.assetId, claim, now, new Date(+now + ARTWORK_POLICY.leaseMs));
      await store.prepare(
        input.assetId,
        claim,
        {
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          byteLength: 10,
          sha256: 'c'.repeat(64),
          width: 2,
          height: 2,
          previewSha256: 'd'.repeat(64),
          previewByteLength: 15,
        },
        now,
      );
      await store.settle(input.assetId, claim, now);
      await store.markQuarantineCleaned(input.assetId, now);
      expect(await store.selectQuarantineCleanup(100, now)).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      expect(await store.selectQuarantineCleanup(100, input.uploadUntil)).toContainEqual(
        expect.objectContaining({ assetId: input.assetId, state: 'USABLE' }),
      );
      await store.markQuarantineCleaned(input.assetId, input.uploadUntil);
      expect(await store.selectQuarantineCleanup(100, input.uploadUntil)).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      expect(
        await store.readUsability(
          { shopId, installationGeneration: '1', kind: 'merchant' },
          [input.assetId],
          input.uploadUntil,
        ),
      ).toHaveLength(1);
      expect(await store.selectQuarantineCleanup(100, new Date(+input.uploadUntil + 60000))).toContainEqual(
        expect.objectContaining({ assetId: input.assetId, state: 'USABLE' }),
      );
    } finally {
      await db.destroy();
    }
  });
  describe('cleanup settles instead of re-claiming every row forever (#465)', () => {
    // Late writes (an in-flight presigned PUT, a lapsed inspection lease) are bounded by this window.
    const lateWriteMs = ARTWORK_POLICY.leaseMs + 30000;
    const manifest: ArtworkManifest = {
      version: 'm6-inspection-v1',
      mimeType: 'image/png',
      byteLength: 10,
      sha256: 'c'.repeat(64),
      width: 2,
      height: 2,
      previewSha256: 'd'.repeat(64),
      previewByteLength: 15,
    };
    /** Drive the real service sweep as the inspector does: limit 20, every 30 seconds. */
    async function sweep(from: Date, durationMs: number, unavailable: (at: number) => boolean = () => false) {
      let clock = from;
      const removed: { key: string; at: number }[] = [];
      const storage = {
        remove: async ({ key }: { key: string }) => {
          if (unavailable(+clock)) throw new Error('storage unavailable');
          removed.push({ key, at: +clock });
        },
      } as unknown as ArtworkStorage;
      const failures: number[] = [];
      const service = createArtworkService({
        store,
        storage,
        clock: () => clock,
        inspect: () => Promise.reject(new Error('unused')),
        onCleanupError: () => failures.push(+clock),
      });
      for (let at = +from; at <= +from + durationMs; at += 30000) {
        clock = new Date(at);
        await service.cleanup(20);
      }
      const times = (key: string) => removed.filter((r) => r.key === key).map((r) => r.at);
      return { removed, failures, times };
    }
    async function usable(shopId: string) {
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      const input = record(shopId);
      await store.create(input);
      await store.complete(scope, input.assetId, now);
      const claim = randomUUID();
      await store.claim(input.assetId, claim, now, new Date(+now + ARTWORK_POLICY.leaseMs));
      await store.prepare(input.assetId, claim, manifest, now);
      await store.settle(input.assetId, claim, now);
      return input;
    }
    /** Rejected at `now`: deleted long before its seven-day retention expiry. */
    async function rejected(shopId: string) {
      const input = record(shopId);
      await store.create(input);
      await store.complete({ shopId, installationGeneration: '1', kind: 'merchant' }, input.assetId, now);
      const claim = randomUUID();
      await store.claim(input.assetId, claim, now, new Date(+now + 60000));
      await store.reject(input.assetId, claim, 'INSPECTION_REJECTED', now);
      return input;
    }
    async function expectSettledTombstone(input: ArtworkRecord, at: Date) {
      expect(await store.selectExpired(100, at)).not.toContainEqual(
        expect.objectContaining({ assetId: input.assetId }),
      );
      expect(await store.markDeleting(input.assetId, at)).toBeNull();
      expect(
        (await pool.query('SELECT state,owner_hash FROM artwork_assets WHERE asset_id=$1', [input.assetId])).rows[0],
      ).toEqual({ state: 'DELETED', owner_hash: null });
    }
    it('stops re-cleaning a USABLE quarantine key after a delete issued past its late-upload window', async () => {
      const db = await openTestDatabase();
      try {
        const { shopId } = await ownTestShop(db);
        const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
        const input = await usable(shopId);
        const { removed, times } = await sweep(input.uploadUntil, 3600000);
        const quarantine = times(input.quarantineKey);
        const windowEnd = +input.uploadUntil + lateWriteMs;
        // Reconciled through the window, once more after it, then settled: not once a minute until expiry.
        expect(Math.max(...quarantine)).toBeGreaterThanOrEqual(windowEnd);
        expect(Math.max(...quarantine)).toBeLessThanOrEqual(windowEnd + 90000);
        expect(quarantine.length).toBeLessThanOrEqual(Math.ceil(lateWriteMs / 60000) + 2);
        // Retained artwork is never touched and stays usable.
        expect(removed.filter((r) => r.key !== input.quarantineKey && r.key.endsWith(input.assetId))).toEqual([]);
        const after = new Date(+input.uploadUntil + 3600000);
        expect(await store.readUsability(scope, [input.assetId], after)).toHaveLength(1);
        expect(await store.markQuarantineCleanupAttempt(input.assetId, after)).toBe(false);
      } finally {
        await db.destroy();
      }
    });
    it('settles an early tombstone after a sweep issued past its late-write window, not at the original expiry', async () => {
      const db = await openTestDatabase();
      try {
        const { shopId } = await ownTestShop(db);
        const input = await rejected(shopId);
        const { times } = await sweep(now, 3600000);
        const original = times(input.originalKey);
        const windowEnd = +input.uploadUntil + lateWriteMs;
        expect(original[0]).toBe(+now);
        // A presigned PUT may still land until the upload link expires: re-sweep through and past that window.
        expect(Math.max(...original)).toBeGreaterThanOrEqual(windowEnd);
        expect(Math.max(...original)).toBeLessThanOrEqual(windowEnd + 90000);
        expect(original.length).toBeLessThanOrEqual(Math.ceil((windowEnd - +now) / 60000) + 2);
        await expectSettledTombstone(input, new Date(+now + 3600000));
      } finally {
        await db.destroy();
      }
    });
    it('keeps an early tombstone eligible behind a large deletion backlog until a sweep passes its window', async () => {
      const db = await openTestDatabase();
      try {
        const { shopId } = await ownTestShop(db);
        const input = await rejected(shopId);
        // The first sweep deletes the asset well before its upload link expires.
        expect((await sweep(now, 0)).times(input.originalKey)).toEqual([+now]);
        const earlier = new Date(+now - 1000);
        // Then a mass rejection/erasure lands ahead of its re-sweeps, beyond what limit 20 drains in its window.
        await pool.query(
          `INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,declared_mime,declared_bytes,state,rejection,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at,owner_kind)
           SELECT id,$1,1,'b'||repeat('0',63),'image/png',1,'REJECTED','INSPECTION_REJECTED','quarantine/'||id,'original/'||id,'preview/'||id,$2,$3,$4,'guest'
           FROM (SELECT gen_random_uuid() id FROM generate_series(1,400)) g`,
          [
            shopId,
            earlier,
            new Date(+earlier + ARTWORK_POLICY.uploadMs),
            new Date(+earlier + ARTWORK_POLICY.retainedMs),
          ],
        );
        const duration = 2 * 3600000;
        const { times } = await sweep(new Date(+now + 30000), duration);
        const quarantine = times(input.quarantineKey);
        expect(quarantine.length).toBeGreaterThan(0);
        expect(Math.max(...quarantine)).toBeGreaterThanOrEqual(+input.uploadUntil + lateWriteMs);
        const end = new Date(+now + 30000 + duration);
        await expectSettledTombstone(input, end);
        // The whole backlog settled too: nothing of this shop is still selected for cleanup.
        expect((await store.selectExpired(100, end)).filter((row) => row.shopId === shopId)).toEqual([]);
      } finally {
        await db.destroy();
      }
    }, 300_000);
    it('re-cleans after a storage outage that spans the late-write window', async () => {
      const db = await openTestDatabase();
      try {
        const { shopId } = await ownTestShop(db);
        const kept = await usable(shopId);
        const tombstone = await rejected(shopId);
        const windowEnd = +tombstone.uploadUntil + lateWriteMs;
        const outage = (at: number) => at >= +tombstone.uploadUntil - 60000 && at <= windowEnd + 120000;
        const { failures, times } = await sweep(now, 3600000, outage);
        expect(failures.length).toBeGreaterThan(0);
        // Each key's last successful delete was issued after the outage, past the window; then both settled.
        for (const key of [tombstone.quarantineKey, tombstone.originalKey, kept.quarantineKey])
          expect(Math.max(...times(key))).toBeGreaterThan(windowEnd + 120000);
        await expectSettledTombstone(tombstone, new Date(+now + 3600000));
        expect(await store.markQuarantineCleanupAttempt(kept.assetId, new Date(+now + 3600000))).toBe(false);
      } finally {
        await db.destroy();
      }
    });
  });
});
