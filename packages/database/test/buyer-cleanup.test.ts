import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, test } from 'vitest';

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
