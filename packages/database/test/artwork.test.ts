import { randomUUID } from 'node:crypto';
import { ARTWORK_POLICY, type ArtworkManifest, type ArtworkRecord } from '@insignia/application';
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
      const usable = await store.readUsability(shopId, '1', [input.assetId], now);
      expect(usable[0]?.expiresAt).toEqual(input.expiresAt);
      expect(usable[0]?.collectedAt).toEqual(input.collectedAt);
      expect(
        await store.readUsability(
          shopId,
          '1',
          Array.from({ length: 256 }, () => input.assetId),
          now,
        ),
      ).toHaveLength(1);
      await expect(
        store.readUsability(
          shopId,
          '1',
          Array.from({ length: 257 }, () => input.assetId),
          now,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await store.readUsability(shopId, '1', [input.assetId], input.expiresAt)).toEqual([]);
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
  it('bounds daily admissions even when one-byte uploads are rejected and erased', async () => {
    const db = await openTestDatabase();
    try {
      const { shopId } = await ownTestShop(db);
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      for (let count = 0; count < 100; count++) {
        const row = { ...record(shopId), declaredBytes: 1 };
        await store.create(row);
        await store.complete(scope, row.assetId, now);
        const claim = randomUUID();
        await store.claim(row.assetId, claim, now, new Date(+now + 60000));
        await store.reject(row.assetId, claim, 'INSPECTION_REJECTED', now);
        await store.markDeleting(row.assetId, now);
        await store.finishDeleting(row.assetId, now);
      }
      await expect(store.create({ ...record(shopId), declaredBytes: 1 })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
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
      expect(await store.markDeleting(input.assetId, new Date(+deadline + ARTWORK_POLICY.leaseMs + 30001))).toBeNull();
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
      expect(await store.readUsability(shopId, '1', [first.assetId], deadline)).toHaveLength(1);
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
      expect(await store.readUsability(shopId, '1', [input.assetId], input.uploadUntil)).toHaveLength(1);
      expect(await store.selectQuarantineCleanup(100, new Date(+input.uploadUntil + 60000))).toContainEqual(
        expect.objectContaining({ assetId: input.assetId, state: 'USABLE' }),
      );
    } finally {
      await db.destroy();
    }
  });
});
