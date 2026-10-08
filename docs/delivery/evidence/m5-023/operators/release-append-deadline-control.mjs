/** Isolated local PG18 only: actual operator, table/FK lock delays and fresh positive control. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root=new URL('../../../../../',import.meta.url).pathname;
const require=createRequire(root+'/apps/web/package.json');
const {Pool}=require('pg');
const {createDurableCore}=await import(pathToFileURL(require.resolve('@insignia/database')));
const url=process.env.DATABASE_URL;const address=new URL(url);assert.equal(address.hostname,'127.0.0.1');assert.match(address.pathname,/^\/insignia_m5_023_deadline_(red|green[0-9]*)$/);
const pool=new Pool({connectionString:url});const core=createDurableCore(pool);
try {
 await pool.query(await readFile(new URL('./trusted-release-roles.sql',import.meta.url),'utf8'));
 await pool.query('ALTER ROLE insignia_release_operator LOGIN; GRANT SELECT ON shops,installation_generations TO insignia_runtime');
 const created=await core.transactions.run(tx=>core.tenants.ensureManagedInstallation(tx,{
  shopDomain:'insignia-rewrite-dev.myshopify.com',shopifyShopId:'987654321',externalInstallationId:'gid://shopify/AppInstallation/987654321',expected:null,observationStartedAt:new Date()}));
 assert.equal(created.outcome,'CREATED');
 const state=created.state;
 for(const blocked of ['table','foreign-key','none']) {
 const now=Date.now();
 const activeObservation={observedAt:new Date(now).toISOString(),versions:[
  {versionId:'gid://shopify/Version/1158986629121',versionTag:'m5-019r-9b94149272d1',status:'active'},
  ...['1158837927937','1153019904001','1152880803841','1146748534785'].map(id=>({versionId:'gid://shopify/Version/'+id,status:'inactive'}))]};
 const functionObservation={shopId:state.shopId,installationGeneration:'1',appClientId:'1443cf6d03d39edae7c101a943c5c684',observedAt:new Date(now-(blocked==='none'?1000:28000)).toISOString(),
  transform:{functionId:'gid://shopify/ShopifyFunction/987654321',handle:'insignia-experimental-v2-transform',apiType:'cart_transform',apiVersion:'2026-07',inputQuerySha256:'8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053'},
  validation:{functionId:'gid://shopify/ShopifyFunction/987654322',handle:'insignia-experimental-v2-validation',apiType:'cart_checkout_validation',apiVersion:'2026-07',inputQuerySha256:'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5'}};
 const input={recordId:randomUUID(),operator:{user:'insignia_release_operator',password:'A'.repeat(64)},activeObservation,
  readiness:{version:'m5-admin-technical-readiness-v1',shop:state.shopDomain,tenantShopId:state.shopId,shopId:'gid://shopify/Shop/'+state.shopifyShopId,installationGeneration:'1',externalInstallationId:state.externalInstallationId,functions:{observation:functionObservation}}};
 const source=readFileSync(root+'/docs/delivery/evidence/m5-023/operators/release-append.mjs','utf8');
 const lock=await pool.connect();
 await lock.query('BEGIN');
 if(blocked==='table')await lock.query('LOCK TABLE trusted_release_records IN ACCESS EXCLUSIVE MODE');
 if(blocked==='foreign-key')await lock.query('SELECT 1 FROM installation_generations WHERE shop_id=$1 AND generation=1 FOR UPDATE',[state.shopId]);
 const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:root+'/apps/web',
  env:{PATH:process.env.PATH,DATABASE_URL:url.replace('serveradmin@','insignia_runtime@')}});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',()=>{});
 const done=new Promise(resolve=>child.once('close',resolve));child.stdin.end(JSON.stringify(input));
 let lockObserved=false;
 try {
  if(blocked!=='none') {
   for(let i=0;i<100;i++) {
    const waiting=await pool.query("SELECT 1 FROM pg_stat_activity WHERE usename='insignia_release_operator' AND wait_event_type='Lock' AND query LIKE 'INSERT INTO trusted_release_records%' LIMIT 1");
    if(waiting.rowCount===1) {lockObserved=true;break;}await delay(20);
   }
   assert.equal(lockObserved,true,'Actual INSERT lock wait must be observed');
   await delay(2500);
  }
 } finally {await lock.query('ROLLBACK');lock.release();}
 const exit=await done;const result=JSON.parse(output);
 const row=(await pool.query('SELECT trusted_record,evidence_digest,active_version_evidence_sha256 FROM trusted_release_records WHERE record_id=$1',[input.recordId])).rows[0];
 console.log(JSON.stringify({control:blocked,lockObserved,exit,classification:result.classification,writeAttempted:result.writeAttempted,writeAcknowledged:result.writeAcknowledged,commitAttempted:result.commitAttempted,rollbackAcknowledged:result.rollbackAcknowledged,ambiguousWrite:result.ambiguousWrite,rows:row?1:0,providerRequests:0,productionWrites:0}));
 if(blocked!=='none') {assert.equal(exit,1);assert.equal(row,undefined,'Expired original authority must append zero rows');assert.equal(result.rollbackAcknowledged,true);assert.equal(result.writeSettledNoAppend,true);assert.equal(result.ambiguousWrite,false);assert.equal(result.retryAuthorized,false);}
 else {
  assert.equal(exit,0);assert.equal(result.classification,'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED');
  assert.equal(result.functionObservedAt,functionObservation.observedAt);
  assert.equal(result.authorityExpiresAt,new Date(now-1000+30000).toISOString());
  assert.deepEqual(row.trusted_record,result.trustedRecord);assert.equal(row.evidence_digest,result.evidenceDigest);
 }
 }
 console.log(JSON.stringify({classification:'LOCAL_SYNTHETIC_PG18_DEADLINE_TABLE_FK_AND_FRESH_PASS',fixtureProvenance:'Synthetic local bootstrap/Function/Active; not native/provider/owner evidence',providerRequests:0,productionWrites:0}));
}finally{await core.close();}
