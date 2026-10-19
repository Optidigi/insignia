import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';

test('owner purchase grant rejects privileged flags, inherited roles, ownership and excessive private/mutation access', {
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
    await assert.rejects(client.query(script), /unqualified_purchase_runtime_role/);
    await client.query('ROLLBACK');
    await client.query(`ALTER ROLE ${role} NOCREATEROLE`);
    await client.query(`CREATE ROLE ${parent} NOLOGIN`);
    await client.query(`GRANT ${parent} TO ${role}`);
    await assert.rejects(client.query(script), /unqualified_purchase_runtime_membership/);
    await client.query('ROLLBACK');
    await client.query(`REVOKE ${parent} FROM ${role}`);
    await client.query(`GRANT SELECT(private_envelope) ON signing_keys TO ${role}`);
    await assert.rejects(client.query(script), /unqualified_purchase_private_access/);
    await client.query('ROLLBACK');
    await client.query(`REVOKE SELECT(private_envelope) ON signing_keys FROM ${role}`);
    await client.query(`GRANT DELETE ON purchase_orders TO ${role}`);
    await assert.rejects(client.query(script), /unqualified_purchase_runtime_mutation/);
    await client.query('ROLLBACK');
    await client.query(`REVOKE DELETE ON purchase_orders FROM ${role}`);
    await client.query(`CREATE TABLE m8_role_owned_${role}(id integer)`);
    await client.query(`ALTER TABLE m8_role_owned_${role} OWNER TO ${role}`);
    await assert.rejects(client.query(script), /unqualified_purchase_runtime_ownership/);
    await client.query('ROLLBACK');
    await client.query(`ALTER TABLE m8_role_owned_${role} OWNER TO CURRENT_USER`);
    await client.query(`DROP TABLE m8_role_owned_${role}`);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'INSERT(record_id)', 'UPDATE(trusted_record)']) {
      await client.query(`GRANT ${privilege} ON trusted_release_records TO ${role}`);
      await assert.rejects(client.query(script), /unqualified_purchase_release_authority/);
      await client.query('ROLLBACK');
      await client.query(`REVOKE ${privilege} ON trusted_release_records FROM ${role}`);
    }
    await client.query('GRANT INSERT(record_id) ON trusted_release_records TO PUBLIC');
    await assert.rejects(client.query(script), /unqualified_purchase_release_authority/);
    await client.query('ROLLBACK');
    await client.query('REVOKE INSERT(record_id) ON trusted_release_records FROM PUBLIC');
    await client.query(script);
    await client.query(`SET ROLE ${role}`);
    await client.query('SELECT * FROM purchase_orders LIMIT 1');
    await assert.rejects(client.query('DELETE FROM purchase_orders'), /permission denied/);
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
