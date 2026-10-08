import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { Client } = createRequire('/home/serveradmin/insignia-m5-023-worktree/packages/database/package.json')('pg');
const client = new Client({ connectionString: 'postgres://serveradmin@127.0.0.1:55424/insignia_m5_023?sslmode=disable' });
const functions = [
 ['pg_catalog.pg_advisory_xact_lock(bigint)', 'SELECT pg_advisory_xact_lock(5023::bigint)'],
 ['pg_catalog.hashtextextended(text,bigint)', "SELECT hashtextextended('synthetic',0::bigint)"],
 ['pg_catalog.gen_random_uuid()', 'SELECT gen_random_uuid()'],
 ['pg_catalog.now()', 'SELECT now()'],
 ['pg_catalog.clock_timestamp()', 'SELECT clock_timestamp()'],
 ['pg_catalog.jsonb_typeof(jsonb)', "SELECT jsonb_typeof('{}'::jsonb)"],
 ['pg_catalog.convert_from(bytea,name)', "SELECT convert_from('\\x7b7d'::bytea,'UTF8')"],
 ['pg_catalog.length(text)', "SELECT length('a'::text)"],
 ['pg_catalog.lower(text)', "SELECT lower('A'::text)"],
 ['pg_catalog.octet_length(text)', "SELECT octet_length('a'::text)"],
 ['pg_catalog.octet_length(bytea)', "SELECT octet_length('\\x01'::bytea)"],
 ['pg_catalog.count()', 'SELECT count(*) FROM (SELECT 1) AS fixture'],
];
const expected = process.argv[3] === 'old';const query=readFileSync(process.argv[2],'utf8');
await client.connect();
try {
 assert.equal((await client.query("SELECT rolsuper FROM pg_roles WHERE rolname='insignia_runtime'")).rows[0].rolsuper,false);
 for (const [signature,call] of functions) {
  await client.query('BEGIN');
  try {
   await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON shops,installation_generations,shop_credentials,product_configs,inbox_messages,shopify_webhook_deliveries TO insignia_runtime; GRANT SELECT ON publication_operations TO insignia_runtime; GRANT USAGE ON SCHEMA public TO insignia_runtime');
   for(const [fn] of functions) await client.query(`GRANT EXECUTE ON FUNCTION ${fn} TO insignia_runtime`);
   assert.equal((await client.query(query)).rows[0].json_build_object.uninstallRuntimeUsable,true);
   await client.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC,insignia_runtime`);
   assert.equal((await client.query(query)).rows[0].json_build_object.uninstallRuntimeUsable,expected);
   await client.query('SET LOCAL ROLE insignia_runtime; SAVEPOINT function_control');
   await assert.rejects(client.query(call),e=>e.code==='42501');
   await client.query('ROLLBACK TO SAVEPOINT function_control; RESET ROLE');
   await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO insignia_runtime`);
   assert.equal((await client.query(query)).rows[0].json_build_object.uninstallRuntimeUsable,true);
   console.log('PASS',signature,'revocation reproduced42501; preflight',expected?'OLD_FALSE_QUALIFICATION':'CORRECT_REJECTION','and restored permission qualifies');
  } finally { await client.query('ROLLBACK'); }
 }
 console.log('PASS all12 actual local PG18 function revocation controls; every ACL rehearsal rolled back; production/provider access=0');
} finally { await client.end(); }
