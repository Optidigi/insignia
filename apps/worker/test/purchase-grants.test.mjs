import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';

test('owner cleanup grant rejects privileged flags and inherited roles before granting cleanup-only execution', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const role = `m8_cleanup_${randomUUID().replaceAll('-', '')}`,
    parent = `m8_parent_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
    client = await pool.connect();
  const script = (
    await readFile(new URL('../../../scripts/m8-purchase/runtime-grants.sql', import.meta.url), 'utf8')
  ).replaceAll('insignia_queue_consume', role);
  try {
    await client.query(`CREATE ROLE ${role} NOLOGIN CREATEROLE`);
    await assert.rejects(client.query(script), /unqualified_purchase_cleanup_role/);
    await client.query('ROLLBACK');
    await client.query(`ALTER ROLE ${role} NOCREATEROLE`);
    await client.query(`CREATE ROLE ${parent} NOLOGIN`);
    await client.query(`GRANT ${parent} TO ${role}`);
    await assert.rejects(client.query(script), /unqualified_purchase_cleanup_membership/);
    await client.query('ROLLBACK');
    await client.query(`REVOKE ${parent} FROM ${role}`);
    await client.query(script);
    await client.query(`SET ROLE ${role}`);
    await assert.rejects(client.query('SELECT * FROM purchase_orders LIMIT 1'), /permission denied/);
    assert.equal(
      typeof (await client.query('SELECT public.cleanup_purchase_payloads(1) AS count')).rows[0].count,
      'number',
    );
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET ROLE');
    await client.query(`DROP OWNED BY ${role}`);
    await client.query(`DROP ROLE IF EXISTS ${role}`);
    await client.query(`DROP ROLE IF EXISTS ${parent}`);
    client.release();
    await pool.end();
  }
});
