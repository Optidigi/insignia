/** Local isolated PG18 only. Exact role SQL, genuine fresh role connections; no provider/production evidence. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../../../../apps/web/package.json',import.meta.url));
const {Pool}=require('pg');
const {createDurableCore,sha256CanonicalJson}=await import(pathToFileURL(require.resolve('@insignia/database')));
const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');
assert.match(url.pathname,/^\/insignia_m5_023_(connect_(red[0-9]*|green[0-9]*)|function_(clock_red|json_red|finite_red|green|green2))$/);
const pool=new Pool({connectionString:url.href});const core=createDurableCore(pool);
const roles=await readFile(new URL('./trusted-release-roles.sql',import.meta.url),'utf8');
try {
 assert.equal((await pool.query("SELECT has_database_privilege('public',current_database(),'CONNECT') AS allowed")).rows[0].allowed,false);
 if(url.pathname.includes('_function_')) {
  const signatures=url.pathname.endsWith('clock_red')?['pg_catalog.clock_timestamp()']
   :url.pathname.endsWith('json_red')?['pg_catalog.jsonb_typeof(jsonb)']
   :url.pathname.endsWith('finite_red')?['pg_catalog.isfinite(timestamp with time zone)']
   :['pg_catalog.clock_timestamp()','pg_catalog.jsonb_typeof(jsonb)','pg_catalog.isfinite(timestamp with time zone)'];
  for(const signature of signatures) await pool.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${signature} TO insignia_runtime;`);
 }
 await pool.query(roles);
 await pool.query('ALTER ROLE insignia_release_operator LOGIN; GRANT SELECT ON shops,installation_generations TO insignia_runtime');
 const freshUrl=new URL(url);freshUrl.username='insignia_release_operator';
 const fresh=new Pool({connectionString:freshUrl.href});
 try { assert.equal((await fresh.query('SELECT current_user AS role')).rows[0].role,'insignia_release_operator'); } finally { await fresh.end(); }
 console.log('Fresh operator connection passes with PUBLIC CONNECT revoked');
 const requiredFunctions=await pool.query("SELECT has_function_privilege('insignia_release_operator','pg_catalog.clock_timestamp()','EXECUTE') AS clock, has_function_privilege('insignia_release_operator','pg_catalog.jsonb_typeof(jsonb)','EXECUTE') AS shape, has_function_privilege('insignia_release_operator','pg_catalog.isfinite(timestamp with time zone)','EXECUTE') AS finite");
 console.log(JSON.stringify({operatorFunctions:requiredFunctions.rows[0],publicExecuteRevoked:url.pathname.includes('_function_')}));
 const shopId=randomUUID();await core.transactions.run(tx=>core.tenants.createShop(tx,{shopId,shopDomain:'m'+shopId.replaceAll('-','')+'.myshopify.com',shopifyShopId:(BigInt('0x'+shopId.replaceAll('-','').slice(0,12))+1n).toString(),externalInstallationId:'gid://shopify/AppInstallation/55'}));
 const observedAt=new Date().toISOString();
 const expected={schemaVersion:1,shopId,installationGeneration:'1',appClientId:'synthetic-role-client',appVersionRef:'1158986629121',devPreviewRef:null,sourceCommit:'a'.repeat(40),
 transform:{functionId:'synthetic-transform',handle:'insignia-experimental-v2-transform',apiType:'cart_transform',apiVersion:'2026-07',inputQuerySha256:'b'.repeat(64),wasmSha256:'c'.repeat(64)},
 validation:{functionId:'synthetic-validation',handle:'insignia-experimental-v2-validation',apiType:'cart_checkout_validation',apiVersion:'2026-07',inputQuerySha256:'d'.repeat(64),wasmSha256:'e'.repeat(64)}};
 const record={version:'m5-trusted-release-v1',recordId:randomUUID(),activeAppVersionRef:'1158986629121',attestation:{...expected,evidenceKind:'RELEASE_BOUND',observedAt,expiresAt:new Date(Date.parse(observedAt)+30000).toISOString()}};
 const proof='f'.repeat(64);const digest=sha256CanonicalJson({trustedRecord:record,expectedBuild:expected,activeVersionObservedAt:observedAt,activeVersionEvidenceSha256:proof});
 const operatorUrl=new URL(process.env.DATABASE_URL);operatorUrl.username='insignia_release_operator';const operatorPool=new Pool({connectionString:operatorUrl.href});
 const client=await operatorPool.connect();
 try {
  await client.query('INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',[record.recordId,shopId,expected.appClientId,expected.appVersionRef,expected,record,observedAt,proof,digest]);
 } finally {client.release();await operatorPool.end();}
 for(const role of ['insignia_runtime','insignia_release_operator']) {
  const address=new URL(process.env.DATABASE_URL);address.username=role;const scoped=new Pool({connectionString:address.href});
  try {
   for(const sql of ['UPDATE trusted_release_records SET record_id=record_id','DELETE FROM trusted_release_records','TRUNCATE trusted_release_records','CREATE TABLE public.forbidden_probe(id int)','SET ROLE insignia_release_owner']) await assert.rejects(scoped.query(sql),{code:'42501'});
   if(role==='insignia_runtime') {await assert.rejects(scoped.query("INSERT INTO trusted_release_records(record_id) VALUES('forbidden')"),{code:'42501'});await assert.rejects(scoped.query('SET ROLE insignia_release_operator'),{code:'42501'});assert.equal((await scoped.query('SELECT record_id FROM trusted_release_records WHERE record_id=$1',[record.recordId])).rows[0].record_id,record.recordId);}
  }finally{await scoped.end();}
 }
 const runtimeUrl=new URL(process.env.DATABASE_URL);runtimeUrl.username='insignia_runtime';
 const runtime=createDurableCore(new Pool({connectionString:runtimeUrl.href}));
 try {const value=await runtime.trustedReleaseRecords.read({scope:{shopId,installationGeneration:'1',appClientId:expected.appClientId},expectedActiveAppVersionRef:'1158986629121',now:new Date()});assert.equal(value.record.recordId,record.recordId);}finally{await runtime.close();}
 console.log(JSON.stringify({classification:'LOCAL_PG18_EXPLICIT_OPERATOR_CONNECT_APPEND_PASS',publicConnect:false,operatorConnect:true,exactRoleSql:true,operatorRequiredFunctions:requiredFunctions.rows[0],publicExecuteRevoked:url.pathname.includes('_function_'),operatorAppend:1,runtimeSelect:true,runtimeAppendDenied:true,rewriteDenied:true,schemaCreateDenied:true,ownerRoleDenied:true,exactRuntimeReaderQualified:true,productionMutations:0}));
}finally{await core.close();}
