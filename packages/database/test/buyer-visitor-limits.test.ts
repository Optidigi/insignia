import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUYER_SESSION_POLICY, createBuyerRepository } from '../src/repositories/buyer.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

const day = 86_400_000;
const week = 7 * day;
const owner = (n: number) => n.toString(16).padStart(64, '0');

describe.runIf(Boolean(process.env.DATABASE_URL))('buyer visitor limits', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('lets other visitors start sessions after one client issues far more than the old shop-wide minute budget', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-10T12:00:00Z');
    // The previous shop-wide budget was 60 per minute: a single scripted client locked every buyer out.
    for (let i = 1; i <= 120; i++)
      await repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: owner(i) },
        sessionId: randomUUID(),
        now,
        expiresAt: new Date(+now + week),
      });
    await expect(
      repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: 'f'.repeat(64) },
        sessionId: randomUUID(),
        now,
        expiresAt: new Date(+now + week),
      }),
    ).resolves.toHaveProperty('sessionId');
  }, 30_000);

  it('limits one visitor address to 60 new sessions in any rolling hour without affecting other addresses', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-11T12:00:00Z');
    const flood = Buffer.alloc(32, 1),
      other = Buffer.alloc(32, 2);
    const issue = (n: number, visitorKey: Uint8Array | null, at = now) =>
      repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: owner(n) },
        sessionId: randomUUID(),
        now: at,
        expiresAt: new Date(+at + week),
        visitorKey,
      });
    expect(BUYER_SESSION_POLICY.visitorSessionsPerHour).toBe(60);
    for (let i = 1; i <= 60; i++) await issue(i, flood);
    await expect(issue(61, flood)).rejects.toMatchObject({ code: 'SESSION_RATE_LIMITED', retryAfterSeconds: 3600 });
    // A rejected attempt neither creates a session nor consumes the window.
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_sessions WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    ).toBe('60');
    await expect(issue(62, other)).resolves.toHaveProperty('sessionId');
    // No trusted address: only the shop ceilings apply (fail open).
    await expect(issue(63, null)).resolves.toHaveProperty('sessionId');
    await expect(issue(64, flood, new Date(+now + 3_599_000))).rejects.toMatchObject({
      code: 'SESSION_RATE_LIMITED',
      retryAfterSeconds: 1,
    });
    await expect(issue(65, flood, new Date(+now + 3_600_000))).resolves.toHaveProperty('sessionId');
    await expect(issue(66, Buffer.alloc(16, 3))).rejects.toMatchObject({ code: 'INVALID' });
  }, 30_000);

  it('slides the visitor window: each session stops counting exactly one hour after it was issued', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const start = new Date('2026-11-12T02:00:00Z');
    const half = new Date(+start + 1_800_000);
    const visitor = Buffer.alloc(32, 4);
    let n = 0;
    const issue = (at: Date) =>
      repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: owner(++n) },
        sessionId: randomUUID(),
        now: at,
        expiresAt: new Date(+at + week),
        visitorKey: visitor,
      });
    for (let i = 0; i < 30; i++) await issue(start);
    for (let i = 0; i < 30; i++) await issue(half);
    // Retry-After points at the moment the oldest counted session leaves the window.
    await expect(issue(half)).rejects.toMatchObject({ code: 'SESSION_RATE_LIMITED', retryAfterSeconds: 1800 });
    await expect(issue(new Date(+start + 3_599_500))).rejects.toMatchObject({ retryAfterSeconds: 1 });
    // A fixed window would reopen fully at start+1h; the sliding window frees only the 30 from start.
    const hour = new Date(+start + 3_600_000);
    for (let i = 0; i < 30; i++) await issue(hour);
    await expect(issue(hour)).rejects.toMatchObject({ code: 'SESSION_RATE_LIMITED', retryAfterSeconds: 1800 });
    await expect(issue(new Date(+half + 3_600_000))).resolves.toHaveProperty('sessionId');
  }, 30_000);

  it('admits exactly the hourly limit when one visitor starts many sessions concurrently', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-12T03:00:00Z');
    const visitor = Buffer.alloc(32, 5);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 75 }, (_, i) =>
        repo.issueSession({
          scope: { shopId, installationGeneration: '1', ownerHash: owner(1000 + i) },
          sessionId: randomUUID(),
          now,
          expiresAt: new Date(+now + week),
          visitorKey: visitor,
        }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(60);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason?.code === 'SESSION_RATE_LIMITED'),
    ).toHaveLength(15);
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_sessions WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    ).toBe('60');
  }, 30_000);

  it('purges a visitor window an hour after its latest session and keeps only keyed hashes', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const first = new Date('2026-11-11T11:30:00Z');
    const now = new Date('2026-11-11T12:00:00Z');
    for (const [n, at] of [
      [1, first],
      [2, now],
    ] as const)
      await repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: owner(n) },
        sessionId: randomUUID(),
        now: at,
        expiresAt: new Date(+at + week),
        visitorKey: Buffer.alloc(32, 9),
      });
    const columns = await sql<{
      column_name: string;
    }>`SELECT column_name FROM information_schema.columns WHERE table_name='buyer_visitor_admission' ORDER BY ordinal_position`.execute(
      db,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'shop_id',
      'installation_generation',
      'visitor_key',
      'window_at',
      'issued',
      'issued_at',
    ]);
    const rows = () =>
      sql<{ n: string }>`SELECT count(*)::text n FROM buyer_visitor_admission WHERE shop_id=${shopId}`.execute(db);
    await repo.purgeVisitorAdmission(new Date(+now + 3_599_000));
    expect((await rows()).rows[0]?.n).toBe('1');
    await repo.purgeVisitorAdmission(new Date(+now + 3_600_000));
    expect((await rows()).rows[0]?.n).toBe('0');
  });

  it('keeps a visitor window until an hour after its latest session when a lagging web clock issues after it', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const latest = new Date('2026-11-12T12:00:00Z');
    // A second web instance whose clock runs five minutes behind issues the next session.
    const lagging = new Date(+latest - 300_000);
    for (const [n, at] of [
      [1, latest],
      [2, lagging],
    ] as const)
      await repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash: owner(n) },
        sessionId: randomUUID(),
        now: at,
        expiresAt: new Date(+at + week),
        visitorKey: Buffer.alloc(32, 10),
      });
    const rows = () =>
      sql<{ n: string }>`SELECT count(*)::text n FROM buyer_visitor_admission WHERE shop_id=${shopId}`.execute(db);
    await repo.purgeVisitorAdmission(new Date(+latest + 3_599_000));
    expect((await rows()).rows[0]?.n).toBe('1');
    await repo.purgeVisitorAdmission(new Date(+latest + 3_600_000));
    expect((await rows()).rows[0]?.n).toBe('0');
  });

  it('still enforces the shop-wide issuance and active-session safety ceilings', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-10T12:00:00Z');
    const issue = (ownerHash: string, at: Date) =>
      repo.issueSession({
        scope: { shopId, installationGeneration: '1', ownerHash },
        sessionId: randomUUID(),
        now: at,
        expiresAt: new Date(+at + week),
      });
    await sql`INSERT INTO buyer_admission VALUES(${shopId},1,${now},600)`.execute(db);
    await expect(issue('e'.repeat(64), now)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const nextMinute = new Date(+now + 60_000);
    await expect(issue('e'.repeat(64), nextMinute)).resolves.toHaveProperty('sessionId');

    // 99,999 more unused sessions created now fill the 100,000 active-session ceiling.
    await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,grant_expires_at,write_window)
      SELECT gen_random_uuid(),${shopId},1,lpad(to_hex(n),64,'0'),${nextMinute},${new Date(+nextMinute + day)},${new Date(+nextMinute + week)},${nextMinute}
      FROM generate_series(1,99999) n`.execute(db);
    const later = new Date(+nextMinute + 120_000);
    await expect(issue('d'.repeat(64), later)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Unused sessions stop counting after 24 hours, so a flood cannot hold the ceiling for the 7-day grant.
    await expect(issue('d'.repeat(64), new Date(+nextMinute + day))).resolves.toHaveProperty('sessionId');
    await sql`DELETE FROM buyer_sessions WHERE shop_id=${shopId}`.execute(db);
  }, 60_000);

  it('expires a session never used for a design or proposal after 24 hours while a used session keeps its 7-day grant', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-10T12:00:00Z');
    const grant = new Date(+now + week);
    const unused = { shopId, installationGeneration: '1', ownerHash: 'a'.repeat(64) };
    const used = { ...unused, ownerHash: 'b'.repeat(64) };
    for (const scope of [unused, used])
      expect(await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: grant })).toMatchObject({
        expiresAt: grant,
      });
    // Private state may use the full grant; the first stored design extends the session to it.
    expect(await repo.getSession(unused, now)).toMatchObject({ expiresAt: grant });
    const design = randomUUID();
    await repo.saveDesign(used, { id: design, expectedVersion: 0, value: {}, now: new Date(+now + 60_000) });
    expect((await repo.getDesign(used, design, now))?.expiresAt).toEqual(grant);

    const almostDay = new Date(+now + day - 1);
    expect(await repo.getSession(unused, almostDay)).not.toBeNull();
    await repo.admitRequest(unused, almostDay);
    const afterDay = new Date(+now + day);
    expect(await repo.getSession(unused, afterDay)).toBeNull();
    await expect(repo.admitRequest(unused, afterDay)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repo.saveDesign(unused, { id: randomUUID(), expectedVersion: 0, value: {}, now: afterDay }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The same expired owner token never revives with a new session.
    await expect(
      repo.issueSession({ scope: unused, sessionId: randomUUID(), now: afterDay, expiresAt: grant }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const sixDays = new Date(+now + 6 * day);
    expect(await repo.getSession(used, sixDays)).toMatchObject({ expiresAt: grant });
    expect(await repo.getDesign(used, design, sixDays)).not.toBeNull();
    expect(await repo.getSession(used, grant)).toBeNull();

    // Cleanup removes the unused session at 24 hours and the used one only at its grant.
    const remaining = async () =>
      (
        await sql<{
          owner_hash: string;
        }>`SELECT owner_hash FROM buyer_sessions WHERE shop_id=${shopId} ORDER BY owner_hash`.execute(db)
      ).rows.map((row) => row.owner_hash);
    const cleanup = async (at: Date) => {
      while ((await repo.cleanupExpired(at, 1000)) === 1000);
    };
    await cleanup(afterDay);
    expect(await remaining()).toEqual([used.ownerHash]);
    await cleanup(grant);
    expect(await remaining()).toEqual([]);
  });

  it('extends an unused session only once and only to its capability grant', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-10T12:00:00Z');
    const scope = { shopId, installationGeneration: '1', ownerHash: 'c'.repeat(64) };
    const { sessionId } = await repo.issueSession({
      scope,
      sessionId: randomUUID(),
      now,
      expiresAt: new Date(+now + 2 * day),
    });
    const extend = (to: Date) =>
      sql`UPDATE buyer_sessions SET expires_at=${to} WHERE session_id=${sessionId}::uuid`.execute(db);
    await expect(extend(new Date(+now + week))).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`UPDATE buyer_sessions SET grant_expires_at=${new Date(+now + week)} WHERE session_id=${sessionId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await extend(new Date(+now + 2 * day));
    await expect(extend(new Date(+now + day))).rejects.toMatchObject({ code: '23514' });
  });

  it('admits per-session requests while another transaction holds the shop row lock', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const now = new Date('2026-11-10T12:00:00Z');
    const scope = { shopId, installationGeneration: '1', ownerHash: '9'.repeat(64) };
    await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + week) });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Acceptance holds this lock across provider work for seconds.
    const acceptance = db.transaction().execute(async (tx) => {
      await sql`SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
        WHERE s.shop_id=${shopId} FOR UPDATE OF s,i`.execute(tx);
      locked();
      await held;
    });
    try {
      await acquired;
      const outcomes = await Promise.race([
        Promise.allSettled(Array.from({ length: 70 }, () => repo.admitRequest(scope, new Date(+now + 1000)))),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('admission waited for the shop row lock')), 5000),
        ),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(60);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason?.code === 'RATE_LIMITED'),
      ).toHaveLength(10);
      await expect(repo.admitRequest(scope, new Date(+now + 61_000))).resolves.toBeUndefined();
    } finally {
      release();
      await acceptance;
    }
  });
});
