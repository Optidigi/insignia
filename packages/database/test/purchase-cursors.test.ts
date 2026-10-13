import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPurchaseCursorRepository } from '../src/repositories/purchase-cursors.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('durable missing-webhook discovery', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  it('failed pages preserve the window, completed pagination advances only at terminal page and old generation cannot advance', async () => {
    const { shopId, generation } = await createTestShop(db);
    await sql`INSERT INTO shop_credentials(shop_id,installation_generation,state,access_expires_at,refresh_expires_at,scopes,wrapping_key_id,access_envelope,refresh_envelope)
    VALUES(${shopId},${generation}::bigint,'active',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day','read_orders','synthetic','{}','{}')`.execute(
      db,
    );
    const repository = createPurchaseCursorRepository(db);
    const claim = (await repository.claimPurchaseDiscovery(20)).find((x) => x.shopId === shopId)!;
    expect(claim).toBeTruthy();
    expect(claim.cursor).toBeNull();
    expect((await repository.claimPurchaseDiscovery(20)).find((x) => x.shopId === shopId)).toBeUndefined();
    await repository.failPurchaseDiscovery(claim);
    await sql`UPDATE purchase_reconciliation_cursors SET next_attempt_at=clock_timestamp() WHERE shop_id=${shopId}`.execute(
      db,
    );
    const retry = (await repository.claimPurchaseDiscovery(20)).find((x) => x.shopId === shopId)!;
    expect(retry.since).toBe(claim.since);
    expect(retry.until).toBe(claim.until);
    expect(retry.claimToken).not.toBe(claim.claimToken);
    await expect(repository.completePurchaseDiscovery({ ...claim, nextCursor: 'next' })).rejects.toThrow(
      'STALE_DISCOVERY_CLAIM',
    );
    await repository.completePurchaseDiscovery({ ...retry, nextCursor: 'next' });
    const next = (await repository.claimPurchaseDiscovery(20)).find((x) => x.shopId === shopId)!;
    expect(next.cursor).toBe('next');
    expect(next.since).toBe(claim.since);
    expect(next.until).toBe(claim.until);
    await repository.completePurchaseDiscovery({ ...next, nextCursor: null });
    const state = await sql<{
      watermark: Date;
      window_until: Date | null;
    }>`SELECT watermark,window_until FROM purchase_reconciliation_cursors WHERE shop_id=${shopId}`.execute(db);
    expect(state.rows[0]!.watermark.toISOString()).toBe(claim.until);
    expect(state.rows[0]!.window_until).toBeNull();
    await sql`UPDATE purchase_reconciliation_cursors SET next_attempt_at=clock_timestamp() WHERE shop_id=${shopId}`.execute(
      db,
    );
    const stale = (await repository.claimPurchaseDiscovery(20)).find((x) => x.shopId === shopId)!;
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${shopId} AND generation=${generation}::bigint`.execute(
      db,
    );
    await expect(repository.completePurchaseDiscovery({ ...stale, nextCursor: null })).rejects.toThrow(
      'STALE_DISCOVERY_CLAIM',
    );
  });
});
