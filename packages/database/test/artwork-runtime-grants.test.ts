import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ARTWORK_POLICY, type ArtworkRecord } from '@insignia/application';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

// Explicit isolated-local qualification: role changes never run in routine CI/native databases.
it.runIf(process.env.M6_RUNTIME_GRANTS === '1')(
  'qualifies the host runner with restricted PostgreSQL privileges',
  async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '');
    if (
      connection.hostname !== '127.0.0.1' ||
      connection.port !== '58197' ||
      connection.username !== 'synthetic_m6_owner'
    )
      throw new Error('Dedicated synthetic M6 PostgreSQL qualification required');
    const owner = new Pool({ connectionString: connection.href });
    const runtime = new Pool({ connectionString: connection.href, options: '-c role=insignia_queue_consume' });
    const db = await openTestDatabase();
    let shopId: string | undefined;
    async function eraseShop(shopId: string) {
      const cleanup = await owner.connect();
      try {
        await cleanup.query('BEGIN');
        await cleanup.query('DELETE FROM artwork_assets WHERE shop_id=$1', [shopId]);
        await cleanup.query('DELETE FROM installation_generations WHERE shop_id=$1', [shopId]);
        await cleanup.query('DELETE FROM shops WHERE shop_id=$1', [shopId]);
        await cleanup.query('COMMIT');
      } catch (error) {
        await cleanup.query('ROLLBACK');
        throw error;
      } finally {
        cleanup.release();
      }
    }

    try {
      await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
      CREATE ROLE insignia_queue_consume NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF; END $$`);
      await owner.query('REVOKE ALL ON public.artwork_assets FROM insignia_queue_consume');
      const store = createArtworkRepository(runtime);
      const now = new Date();
      await expect(store.selectPending(100, now)).rejects.toMatchObject({ code: '42501' });
      // Simulate an obsolete column grant: the installer must close it too.
      await owner.query('GRANT UPDATE(expires_at) ON artwork_assets TO insignia_queue_consume');
      await owner.query(
        await readFile(new URL('../../../scripts/m6-artwork/runtime-grants.sql', import.meta.url), 'utf8'),
      );
      ({ shopId } = await createTestShop(db));
      const assetId = randomUUID();
      const input: ArtworkRecord = {
        assetId,
        shopId,
        installationGeneration: '1',
        ownerHash: 'a'.repeat(64),
        declaredMime: 'image/png',
        declaredBytes: 10,
        state: 'UPLOADING',
        quarantineKey: `quarantine/${assetId}`,
        originalKey: `originals/${assetId}`,
        previewKey: `previews/${assetId}`,
        collectedAt: now,
        uploadUntil: new Date(+now + ARTWORK_POLICY.uploadMs),
        expiresAt: new Date(+now + ARTWORK_POLICY.retainedMs),
        claimId: null,
        manifest: null,
        rejection: null,
      };
      const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
      const admissions = createArtworkRepository(owner);
      await admissions.create(input);
      await admissions.complete(scope, assetId, now);
      expect(await store.selectPending(100, now)).toContain(assetId);
      let claimId = randomUUID();
      expect((await store.claim(assetId, claimId, now, new Date(+now + ARTWORK_POLICY.leaseMs)))?.state).toBe(
        'INSPECTING',
      );
      await store.release(assetId, claimId, new Date(+now + 1000));
      expect(await store.selectPending(100, now)).not.toContain(assetId);
      claimId = randomUUID();
      const processingAt = new Date(+now + 1000);
      expect(
        await store.claim(assetId, claimId, processingAt, new Date(+processingAt + ARTWORK_POLICY.leaseMs)),
      ).not.toBeNull();
      await store.prepare(
        assetId,
        claimId,
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
        processingAt,
      );
      expect(await store.settle(assetId, claimId, processingAt)).toBe(true);
      expect(
        await store.readUsability({ shopId, installationGeneration: '1', kind: 'merchant' }, [assetId], now),
      ).toHaveLength(1);
      expect((await store.selectQuarantineCleanup(100, input.uploadUntil)).map((row) => row.assetId)).toContain(
        assetId,
      );
      expect(await store.markQuarantineCleanupAttempt(assetId, input.uploadUntil)).toBe(true);
      await store.markQuarantineCleaned(assetId, input.uploadUntil);
      expect((await store.selectExpired(100, input.expiresAt)).map((row) => row.assetId)).toContain(assetId);
      expect((await store.markDeleting(assetId, input.expiresAt))?.state).toBe('DELETING');
      await store.finishDeleting(assetId, input.expiresAt);
      expect((await store.get(scope, assetId))?.state).toBe('DELETED');
      for (const sql of [
        'DELETE FROM artwork_assets WHERE asset_id=$1',
        "UPDATE artwork_assets SET expires_at=expires_at+interval '1 day' WHERE asset_id=$1",
        'UPDATE artwork_assets SET shop_id=shop_id WHERE asset_id=$1',
        'UPDATE artwork_assets SET quarantine_key=quarantine_key WHERE asset_id=$1',
      ])
        await expect(runtime.query(sql, [assetId])).rejects.toMatchObject({ code: '42501' });
      await expect(store.create({ ...input, assetId: randomUUID() })).rejects.toMatchObject({ code: '42501' });
      const identity = await runtime.query('SELECT current_user, session_user');
      expect(identity.rows[0]).toEqual({ current_user: 'insignia_queue_consume', session_user: 'synthetic_m6_owner' });
    } finally {
      if (shopId) await eraseShop(shopId);
      await runtime.end();
      await owner.end();
      await db.destroy();
    }
  },
);
