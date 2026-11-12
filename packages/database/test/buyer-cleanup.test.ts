import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import type { Database } from '../src/client/database.js';
import { BUYER_SESSION_POLICY, createBuyerRepository } from '../src/repositories/buyer.js';

test('restricted worker erases only due buyer payloads without private-data or future-clock authority', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume'");
    if (!role.rowCount) await client.query('CREATE ROLE insignia_queue_consume NOLOGIN');
    await client.query(
      await readFile(new URL('../../../scripts/database/buyer-cleanup-grants.sql', import.meta.url), 'utf8'),
    );
    const shopId = randomUUID(),
      live = randomUUID(),
      expired = randomUUID(),
      draft = randomUUID();
    await client.query('BEGIN');
    await client.query('INSERT INTO shops(shop_id,shop_domain,current_generation) VALUES($1,$2,1)', [
      shopId,
      `${shopId}.cleanup.test`,
    ]);
    await client.query('INSERT INTO installation_generations(shop_id,generation) VALUES($1,1)', [shopId]);
    await client.query('COMMIT');
    await client.query(
      "INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window) VALUES($1,$3,1,$4,now(),now()+interval '7 days',now()),($2,$3,1,$5,now()-interval '8 days',now()-interval '1 day',now()-interval '8 days')",
      [live, expired, shopId, '1'.repeat(64), '2'.repeat(64)],
    );
    await client.query("INSERT INTO design_drafts VALUES($1,$2,1,$3,1,'{}',now()-interval '1 minute')", [
      draft,
      shopId,
      live,
    ]);
    await client.query('SET ROLE insignia_queue_consume');
    await expect(client.query('SELECT payload FROM design_drafts')).rejects.toThrow(/permission denied/);
    await expect(client.query('DELETE FROM buyer_sessions')).rejects.toThrow(/permission denied/);
    await expect(client.query("SELECT public.cleanup_buyer_payloads(now()+interval '1 year',100)")).rejects.toThrow(
      /does not exist/,
    );
    await expect(client.query('SELECT public.cleanup_buyer_payloads(1001)')).rejects.toThrow(
      /invalid buyer cleanup budget/,
    );
    await client.query('SELECT public.cleanup_buyer_payloads(100)');
    await client.query('RESET ROLE');
    expect((await client.query('SELECT 1 FROM design_drafts WHERE design_id=$1', [draft])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM buyer_sessions WHERE session_id=$1', [expired])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM buyer_sessions WHERE session_id=$1', [live])).rowCount).toBe(1);
  } finally {
    await client.query('RESET ROLE');
    client.release();
    await pool.end();
  }
});

test('a worker erasure pass keeps its budget but erases at most a few full sessions per statement (#371)', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const budgets: unknown[] = [];
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      if (event.query.sql.includes('cleanup_buyer_payloads')) budgets.push(event.query.parameters[0]);
    },
  });
  try {
    const shopId = randomUUID();
    await pool.query(
      `WITH shop AS (INSERT INTO shops(shop_id,shop_domain,current_generation) VALUES($1,$1||'.cleanup.test',1))
       INSERT INTO installation_generations(shop_id,generation) VALUES($1,1)`,
      [shopId],
    );
    // One session holds up to 1,600 rows, so a statement may take only ten of them.
    expect(BUYER_SESSION_POLICY.cleanupSessionsPerStatement).toBe(10);
    // Expired long before any other test's sessions, so this pass takes them first.
    await pool.query(
      `INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window)
       SELECT gen_random_uuid(),$1,1,lpad(to_hex(n),64,'0'),'2000-01-01Z','2000-01-02Z','2000-01-01Z'
       FROM generate_series(1,25) n`,
      [shopId],
    );
    expect(await createBuyerRepository(db).cleanupDue(25)).toBe(25);
    expect(budgets).toEqual([10, 10, 5]);
    expect((await pool.query('SELECT 1 FROM buyer_sessions WHERE shop_id=$1', [shopId])).rowCount).toBe(0);
  } finally {
    await db.destroy();
  }
});
