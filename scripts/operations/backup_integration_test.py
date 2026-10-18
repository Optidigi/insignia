"""Explicit disposable PostgreSQL18 qualification, never consumes ambient DB URLs."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TOOLS = os.environ.get('BACKUP_PG_TOOLS')

@unittest.skipUnless(TOOLS, 'Set BACKUP_PG_TOOLS to existing PostgreSQL18 tools for owned-cluster qualification')
class PostgreSQLRecovery(unittest.TestCase):
    def test_real_dump_encrypted_backup_restored_with_owner_privacy_import_and_mandatory_hold(self):
        tools = Path(TOOLS)
        with tempfile.TemporaryDirectory(prefix='insignia-restore-pg-') as temporary, tempfile.TemporaryDirectory(dir='/dev/shm', prefix='insignia-backup-') as memory:
            root, stage = Path(temporary), Path(memory)
            socket = root / 'socket'
            socket.mkdir(mode=0o700)
            env = {k: v for k, v in os.environ.items() if not k.startswith('PG') and k != 'DATABASE_URL'}
            env.update(PGHOST=str(socket), PGUSER='serveradmin', PGDATABASE='backup_source', PGPORT='5432')
            def run(argv, **kwargs):
                return subprocess.run([str(a) for a in argv], env=env, check=True, capture_output=True, **kwargs)
            share = tools.parents[3] / 'share/postgresql/18'
            run([tools/'initdb', '-D', root/'data', '-A', 'trust', '-U', 'serveradmin', '--no-locale', '-E', 'UTF8', '-L', share])
            run([tools/'pg_ctl', '-D', root/'data', '-l', root/'postgres.log', '-o', f"-k {socket} -h '' -p 5432", '-w', 'start'])
            try:
                run([tools/'createdb', 'backup_source'])
                run([tools/'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE schema_migrations(version varchar(255) PRIMARY KEY)'])
                for migration in sorted((ROOT/'packages/database/migrations').glob('*.sql')):
                    sql = migration.read_text().split('-- migrate:up', 1)[1].split('-- migrate:down', 1)[0]
                    sql += "\nINSERT INTO schema_migrations VALUES('" + migration.name.split('_')[0] + "');"
                    try:
                        run([tools/'psql', '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], input=sql.encode())
                    except subprocess.CalledProcessError as error:
                        raise AssertionError(migration.name + ': ' + error.stderr.decode()) from error
                # Populate genuine v3 activation evidence through the existing production repository seam.
                # The former empty dump could not exercise validators invoked by COPY during recovery.
                url = 'postgresql://serveradmin@localhost/backup_source?host=' + str(socket)
                activation_env = {**env, 'DATABASE_URL': url}
                activation = subprocess.run([str(ROOT/'packages/database/node_modules/.bin/vitest'), 'run',
                    'test/activation.test.ts', '-t', 'v3 hold/evidence/restoration audit JSONB roundtrips'],
                    cwd=ROOT/'packages/database', env=activation_env, capture_output=True)
                self.assertEqual(activation.returncode, 0, activation.stdout.decode()+activation.stderr.decode())
                historical_rows_sql = "SELECT jsonb_build_object('evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY shop_id,config_id,operation_id) FROM m5_activation_evidence e),'states',(SELECT jsonb_agg(to_jsonb(s) ORDER BY shop_id,config_id,operation_id) FROM m5_activation_state s))::text"
                historical_rows = run([tools/'psql', '-X', '-Atc', historical_rows_sql]).stdout
                helper_bodies_sql = "SELECT jsonb_object_agg(oid::regprocedure::text,md5(prosrc))::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%'"
                helper_bodies = run([tools/'psql','-X','-Atc',helper_bodies_sql]).stdout
                self.assertTrue(json.loads(historical_rows)['evidence'], 'populated activation evidence required')
                # Emulate an already sealed pre-fix snapshot even when this test runs on newer migrations.
                run([tools/'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', "DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%' LOOP EXECUTE format('ALTER FUNCTION %s RESET search_path',f.signature); END LOOP; END $$"])
                # Actual read-only snapshot producer queries against the full current PostgreSQL schema.
                module = (ROOT/'scripts/operations/backup-snapshot.mjs').as_uri()
                run(['node', '--input-type=module', '-e', f"import {{createRequire}} from 'node:module'; import {{databaseSnapshot}} from '{module}'; const {{Pool}}=createRequire('{ROOT}/apps/worker/package.json')('pg'); const pool=new Pool(); const c=await pool.connect();try{{const s=await databaseSnapshot(c);if(s.references.length)throw Error('expected empty fixture')}}finally{{c.release();await pool.end()}}"])
                exclusions = stage/'exclusions.json'
                url = 'postgresql://serveradmin@localhost/backup_source?host=' + str(socket)
                env['DATABASE_URL'] = url
                run(['node', ROOT/'scripts/privacy/restore-exclusions.mjs', 'export', exclusions])
                del env['DATABASE_URL']
                cert, key = stage/'recipient.pem', stage/'identity.pem'
                run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=isolated-backup-test', '-keyout', key, '-out', cert])
                objects = stage/'objects'; objects.mkdir(mode=0o700)
                manifest = stage/'manifest.json'
                now = dt.datetime.now(dt.timezone.utc)
                window=stage/'window.json'
                window.write_text(json.dumps({'id':'owned-empty-database-test','startedAt':now.isoformat(),'until':(now+dt.timedelta(hours=1)).isoformat()}));window.chmod(0o600)
                profile=stage/'storage-profile.json'
                profile.write_text(json.dumps({'accessKeyId':'local-fixture-access-key','secretAccessKey':'local-fixture-only'}));profile.chmod(0o600)
                promised=(now.replace(microsecond=(now.microsecond//1000)*1000)+dt.timedelta(days=4)).isoformat()
                env.update(ARTWORK_R2_ENDPOINT='https://'+'a'*32+'.r2.cloudflarestorage.com/',ARTWORK_R2_BUCKET='local-fixture-bucket',ARTWORK_R2_PREFIX='snapshot-fixture',ARTWORK_STORAGE_PROFILE=str(profile),BACKUP_PROMISED_CLEANUP_AT=promised)
                # Real CLI/signing/PG projection; provider fetch is explicitly replaced with an empty scoped listing.
                run(['node','--input-type=module','-e',f"""
globalThis.fetch=async request=>{{if(request.method!=='GET'||!request.headers.has('authorization'))throw Error('unexpected source dispatch');return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')}};
process.argv=[process.execPath,{str(ROOT/'scripts/operations/backup-snapshot.mjs')!r},{str(objects)!r},{str(manifest)!r},{str(window)!r}];
await import('{module}');
"""])
                produced=json.loads(manifest.read_text())
                self.assertEqual(dt.datetime.fromisoformat(produced['promisedCleanupAt'].replace('Z','+00:00')),dt.datetime.fromisoformat(promised))
                self.assertGreater(dt.datetime.fromisoformat(produced['absoluteExpiresAt'].replace('Z','+00:00')),now+dt.timedelta(days=7))
                result = json.loads(run(['python3', '-B', ROOT/'scripts/operations/backup.py', 'create', '--store', stage/'store', '--scratch', stage/'scratch', '--objects', objects, '--object-manifest', manifest, '--recipient', cert, '--pg-dump', tools/'pg_dump']).stdout)
                # The sealed dump remains historical; new ordinary backups should also work without a recovery patch.
                namespace_fix = (ROOT/'packages/database/migrations/20261018000500_restore_validation_namespace.sql').read_text().split('-- migrate:up', 1)[1].split('-- migrate:down', 1)[0]
                run([tools/'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', namespace_fix])
                # Recovery requires independently fresh source exclusions exported after backup completion.
                exclusions.unlink()
                env['DATABASE_URL'] = url
                run(['node', ROOT/'scripts/privacy/restore-exclusions.mjs', 'export', exclusions])
                del env['DATABASE_URL']
                env['PGDATABASE'] = 'insignia_recovery_qualification'
                restored = json.loads(run(['python3', '-B', ROOT/'scripts/operations/backup.py', 'restore', '--artifact', stage/'store'/(result['id']+'.cms'), '--receipt', stage/'store'/(result['id']+'.json'), '--identity', key, '--destination', stage/'restored', '--exclusions', exclusions, '--createdb', tools/'createdb', '--pg-restore', tools/'pg_restore', '--psql', tools/'psql']).stdout)
                self.assertEqual(restored['readiness'], 'HOLD_STORAGE_ERASURE_AND_AUTHORITY_REQUALIFICATION')
                self.assertTrue(restored['erasureImportCompleted'])
                self.assertTrue(restored['databaseExpiryReplayed'])
                self.assertEqual(run([tools/'psql', '-X', '-Atc', historical_rows_sql]).stdout, historical_rows)
                # Resolution remains correct under the restore caller's deliberately empty global namespace.
                validation = run([tools/'psql', '-X', '-Atc', "SET search_path=''; SELECT bool_and(public.m5_v3_held(evidence#>'{hold,held}',evidence#>'{hold,before}')) FROM public.m5_activation_evidence WHERE evidence->'hold'<>'null'; SELECT public.m5_v3_held('{}','{}')"]).stdout.decode().splitlines()
                self.assertEqual(validation[-2:], ['t', 'f'])
                configured = run([tools/'psql', '-X', '-Atc', "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']"]).stdout
                self.assertEqual(int(configured), 12)
                self.assertEqual(run([tools/'psql','-X','-Atc',helper_bodies_sql]).stdout,helper_bodies)
                malformed_sql = "INSERT INTO public.m5_activation_evidence SELECT (jsonb_populate_record(NULL::public.m5_activation_evidence, to_jsonb(e) || jsonb_build_object('evidence',jsonb_set(e.evidence,'{hold,held,anchorDigest}',to_jsonb(repeat('0',64)))))).* FROM public.m5_activation_evidence e WHERE evidence->'hold'<>'null' LIMIT 1"
                malformed = subprocess.run([str(tools/'psql'),'-X','-v','ON_ERROR_STOP=1','-c',malformed_sql],env=env,capture_output=True)
                self.assertNotEqual(malformed.returncode,0)
                self.assertIn('m5_017_evidence_v3_hold',malformed.stderr.decode())

                for name in ['restore-pre.sql','restore-data.sql','restore-post.sql','restore-fix.sql']:
                    self.assertFalse((stage/'restored'/name).exists())
                # A real psql failure after all four restore inputs must roll back schema AND data,
                # erase decrypted scratch and retain only the isolated recovery HOLD.
                env['PGDATABASE'] = 'insignia_recovery_rollback'
                failing_psql = stage/'failing-psql.py'
                failing_psql.write_text('#!/usr/bin/env python3\nimport subprocess,sys\nraise SystemExit(subprocess.run(['+repr(str(tools/'psql'))+']+sys.argv[1:]+["--command","SELECT 1/0"]).returncode)\n')
                failing_psql.chmod(0o700)
                failed = subprocess.run(['python3','-B',str(ROOT/'scripts/operations/backup.py'),'restore',
                    '--artifact',str(stage/'store'/(result['id']+'.cms')),'--receipt',str(stage/'store'/(result['id']+'.json')),
                    '--identity',str(key),'--destination',str(stage/'failed-restore'),'--exclusions',str(exclusions),
                    '--createdb',str(tools/'createdb'),'--pg-restore',str(tools/'pg_restore'),'--psql',str(failing_psql)],env=env,capture_output=True)
                self.assertEqual(failed.returncode,1)
                self.assertEqual(int(run([tools/'psql','-X','-Atc',"SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace"]).stdout),0)
                self.assertEqual(sorted(path.name for path in (stage/'failed-restore').iterdir()), ['HOLD.json'])
                env['PGDATABASE'] = 'insignia_recovery_qualification'

                self.assertFalse((stage/'restored/snapshot.tar').exists())
                self.assertFalse((stage/'restored/database.dump').exists())
                count = int(run([tools/'psql', '-X', '-Atc', 'SELECT count(*) FROM schema_migrations']).stdout)
                self.assertEqual(count, len(list((ROOT/'packages/database/migrations').glob('*.sql'))))
                # Keep rich restore fixtures separate from telemetry's deliberate privacy HOLD.
                run([tools/'createdb','--template','backup_source','privacy_restore_source'])
                # Qualify the alert agent's real aggregate SQL, including a naturally expired synthetic inbox.
                heartbeat = (ROOT/'scripts/operations/heartbeat-snapshot.mjs').as_uri()
                env['PGDATABASE'] = 'backup_source'
                telemetry = subprocess.run(['node', '--input-type=module', '-e', f"""
import {{createRequire}} from 'node:module';
import {{collectDatabaseSnapshot}} from '{heartbeat}';
const {{Pool}}=createRequire('{ROOT}/apps/worker/package.json')('pg');
const pool=new Pool();const c=await pool.connect();
try{{
const empty=await collectDatabaseSnapshot(c,Date.now(),900);
if(empty.processing.stalledCount!==0||empty.deletion.overdueCount!==0)throw Error('empty aggregate mismatch');
await c.query(`INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after)
VALUES(gen_random_uuid(),'synthetic-heartbeat','fixture'::bytea,encode(sha256('fixture'::bytea),'hex'),clock_timestamp()-interval '1 hour','failed','synthetic-heartbeat',clock_timestamp()+interval '0.1 seconds')`);
await new Promise(resolve=>setTimeout(resolve,200));
const populated=await collectDatabaseSnapshot(c,Date.now(),900);
if(populated.processing.stalledCount!==1||populated.deletion.overdueCount!==1)throw Error('populated aggregate mismatch');
await c.query(`INSERT INTO public.shops(shop_id,shop_domain,current_generation) VALUES('heartbeat-artwork','heartbeat-artwork.myshopify.com',1),('heartbeat-inactive','heartbeat-inactive.myshopify.com',1);
INSERT INTO public.installation_generations(shop_id,generation) VALUES('heartbeat-artwork',1),('heartbeat-inactive',1);
INSERT INTO public.artwork_assets(asset_id,shop_id,installation_generation,owner_hash,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at,manifest)
SELECT gen_random_uuid(),'heartbeat-artwork',1,repeat('a',64),'image/png',1,state,'q/'||state,'o/'||state,'p/'||state,clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'+interval '1 minute',clock_timestamp()+interval '4 days',CASE WHEN state='USABLE' THEN '{{}}'::jsonb ELSE NULL END FROM unnest(ARRAY['UPLOADING','REJECTED','USABLE'])state;
INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after)
VALUES('11111111-1111-1111-1111-111111111111','synthetic-facts','fixture'::bytea,encode(sha256('fixture'::bytea),'hex'),clock_timestamp(),'processed','synthetic-facts',clock_timestamp()+interval '1 hour');
INSERT INTO public.webhook_obligation_facts(inbox_id,raw_body_sha256,collected_at,fulfill_by,forget_after,captured_fields)
VALUES('11111111-1111-1111-1111-111111111111',encode(sha256('fixture'::bytea),'hex'),transaction_timestamp()-interval '2 days',transaction_timestamp()+interval '28 days',transaction_timestamp()-interval '1 day','{{"customer_id":"synthetic"}}');
INSERT INTO public.buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window)
VALUES(gen_random_uuid(),'heartbeat-inactive',1,repeat('b',64),clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp());
UPDATE public.installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id='heartbeat-inactive';`);
await c.query(`INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after,erasure_state)
VALUES('33333333-3333-3333-3333-333333333333','shopify',''::bytea,encode(sha256(''::bytea),'hex'),clock_timestamp(),'processed','shopify-webhook',clock_timestamp()+interval '1 day','erased');
INSERT INTO public.customer_privacy_receipts(inbox_id,shop_id,raw_body_sha256,operation,requested_order_count,matched_purchase_count)
VALUES('33333333-3333-3333-3333-333333333333','heartbeat-artwork',encode(sha256(''::bytea),'hex'),'SHOP_ERASURE_BLOCKED',0,0);`);
const review=await collectDatabaseSnapshot(c,Date.now(),900);
if(review.processing.stalledCount!==2)throw Error('unresolved privacy hold absent from processing signal');
if(review.deletion.overdueCount!==6)throw Error('review cleanup mismatch: '+review.deletion.overdueCount);
await c.query('CREATE ROLE heartbeat_monitor NOLOGIN');
const {{readFile}}=await import('node:fs/promises');
const grants=(await readFile('{ROOT}/deployment/alerts/monitor-grants.sql','utf8')).replaceAll(':"monitor_role"','"heartbeat_monitor"');
await c.query(grants);await c.query('SET ROLE heartbeat_monitor');
const restricted=await collectDatabaseSnapshot(c,Date.now(),900);
if(restricted.processing.stalledCount!==2||restricted.deletion.overdueCount!==6)throw Error('restricted aggregate mismatch');
for(const sql of ['SELECT payload FROM public.inbox_messages LIMIT 0','UPDATE public.inbox_messages SET state=state WHERE false']){{
let denied=false;try{{await c.query(sql)}}catch(error){{denied=error.code==='42501'}}if(!denied)throw Error('monitor privilege boundary failed');
}}
await c.query('RESET ROLE');
console.log(JSON.stringify({{empty,populated,review,restricted}}));
}}finally{{c.release();await pool.end()}}
"""], env=env, capture_output=True)
                self.assertEqual(telemetry.returncode, 0, telemetry.stderr.decode())
                print('Actual PostgreSQL heartbeat aggregates:', telemetry.stdout.decode().strip())
                # Existing rich erasure-replay regression now runs on this same owned cluster/source.
                restore_source_url=url.replace('/backup_source?', '/privacy_restore_source?')
                env.update(DATABASE_URL=restore_source_url, PRIVACY_RESTORE_TEST_URL=restore_source_url, PRIVACY_PG_TOOLS=str(tools))
                subprocess.run([str(ROOT/'packages/database/node_modules/.bin/vitest'), 'run', 'test/privacy-restore.test.ts'], cwd=ROOT/'packages/database', env=env, check=True)
                # Actual expiry execution against a new offline clone preserves purchased economics/history.
                env.pop('DATABASE_URL',None)
                run([tools/'createdb','--template','privacy_restore_source','insignia_recovery_expiry_fixture'])
                env['PGDATABASE']='insignia_recovery_expiry_fixture'
                expiry_module=(ROOT/'scripts/operations/backup-expiry.mjs').as_uri()
                replay=run(['node','--input-type=module','-e',f"""
import {{createRequire}} from 'node:module';import {{replayExpiry}} from '{expiry_module}';
const {{Pool}}=createRequire('{ROOT}/apps/worker/package.json')('pg');const pool=new Pool();const c=await pool.connect();
try{{
const economics=async()=> (await c.query(`SELECT encode(sha256(convert_to(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_orders p),'bindings',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_bindings p),'paid',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_paid_facts p))::text,'UTF8')),'hex') AS hash`)).rows[0].hash;
const history=async()=> (await c.query(`SELECT asset_id::text,collected_at::text,expires_at::text,upload_until::text FROM artwork_assets ORDER BY asset_id`)).rows;
const before=await economics(),dates=JSON.stringify(await history());
const result=await replayExpiry(c);
if(!result.databaseExpiryReplayed||result.keys.length<1)throw Error('actual expired exclusions missing');
if(await economics()!==before||JSON.stringify(await history())!==dates)throw Error('historical purchase/expiry changed');
if((await c.query(`SELECT count(*) AS n FROM buyer_sessions b WHERE expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL)`)).rows[0].n!=='0')throw Error('expiry replay incomplete');
console.log(JSON.stringify({{databaseExpiryReplayed:true,excludedObjects:result.keys.length,financialHistoryPreserved:true,originalDatesPreserved:true}}));
}}finally{{c.release();await pool.end()}}
"""])
                print('Actual isolated expiry replay:',replay.stdout.decode().strip())
            finally:
                run([tools/'pg_ctl', '-D', root/'data', '-m', 'immediate', '-w', 'stop'])

if __name__ == '__main__':
    unittest.main()
