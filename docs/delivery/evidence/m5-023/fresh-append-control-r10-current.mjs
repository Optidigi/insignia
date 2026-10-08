import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='/home/serveradmin/insignia-m5-023-worktree';
const require=createRequire(root+'/apps/web/package.json');
const {Pool}=require('pg');
const {createDurableCore}=await import(pathToFileURL(require.resolve('@insignia/database')));
const url='postgres://serveradmin@127.0.0.1:55424/insignia_m5_023_r10_append_current?sslmode=disable';
const pool=new Pool({connectionString:url});const core=createDurableCore(pool);
try {
 await pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC,insignia_runtime,insignia_release_operator;
 ALTER TABLE trusted_release_records OWNER TO insignia_release_owner;
 REVOKE ALL ON trusted_release_records FROM PUBLIC,insignia_runtime,insignia_release_operator;
 GRANT USAGE ON SCHEMA public TO insignia_runtime,insignia_release_operator;
 GRANT SELECT ON shops,installation_generations,trusted_release_records TO insignia_runtime;
 GRANT INSERT ON trusted_release_records TO insignia_release_operator;
 GRANT USAGE ON SEQUENCE trusted_release_records_record_seq_seq TO insignia_release_operator;`);
 const created=await core.transactions.run(tx=>core.tenants.ensureManagedInstallation(tx,{
  shopDomain:'insignia-rewrite-dev.myshopify.com',shopifyShopId:'987654321',externalInstallationId:'gid://shopify/AppInstallation/987654321',expected:null,observationStartedAt:new Date()}));
 assert.equal(created.outcome,'CREATED');
 const state=created.state;const now=Date.now();
 const activeObservation={observedAt:new Date(now).toISOString(),versions:[
  {versionId:'gid://shopify/Version/1158986629121',versionTag:'m5-019r-9b94149272d1',status:'active'},
  ...['1158837927937','1153019904001','1152880803841','1146748534785'].map(id=>({versionId:'gid://shopify/Version/'+id,status:'inactive'}))]};
 const functionObservation={shopId:state.shopId,installationGeneration:'1',appClientId:'1443cf6d03d39edae7c101a943c5c684',observedAt:new Date(now-1000).toISOString(),
  transform:{functionId:'gid://shopify/ShopifyFunction/987654321',handle:'insignia-experimental-v2-transform',apiType:'cart_transform',apiVersion:'2026-07',inputQuerySha256:'8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053'},
  validation:{functionId:'gid://shopify/ShopifyFunction/987654322',handle:'insignia-experimental-v2-validation',apiType:'cart_checkout_validation',apiVersion:'2026-07',inputQuerySha256:'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5'}};
 const input={recordId:randomUUID(),operator:{user:'insignia_release_operator',password:'A'.repeat(64)},activeObservation,
  readiness:{version:'m5-admin-technical-readiness-v1',shop:state.shopDomain,tenantShopId:state.shopId,shopId:'gid://shopify/Shop/'+state.shopifyShopId,installationGeneration:'1',externalInstallationId:state.externalInstallationId,functions:{observation:functionObservation}}};
 const source=readFileSync(root+'/docs/delivery/evidence/m5-023/operators/release-append.mjs','utf8');
 const child=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:root+'/apps/web',input:JSON.stringify(input),encoding:'utf8',timeout:10000,
  env:{PATH:process.env.PATH,DATABASE_URL:url.replace('serveradmin@','insignia_runtime@')}});
 assert.equal(child.status,0);const result=JSON.parse(child.stdout);
 assert.equal(result.classification,'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED');
 assert.equal(result.functionObservedAt,functionObservation.observedAt);
 assert.equal(result.trustedRecord.attestation.observedAt,activeObservation.observedAt);
 assert.equal(result.authorityExpiresAt,new Date(now-1000+30000).toISOString());
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 assert.equal(result.activeObservationEvidenceSha256,hash(activeObservation));
 assert.equal(result.functionObservationEvidenceSha256,hash(functionObservation));
 assert.equal(result.activeVersionEvidenceSha256,hash({version:'m5-release-observations-v1',activeObservation,functionObservation}));
 const row=(await pool.query('SELECT trusted_record,evidence_digest,active_version_evidence_sha256 FROM trusted_release_records WHERE record_id=$1',[input.recordId])).rows[0];
 assert.equal(row.evidence_digest,result.evidenceDigest);assert.deepEqual(row.trusted_record,result.trustedRecord);
 console.log(JSON.stringify({classification:'LOCAL_SYNTHETIC_APPEND_OPERATOR_PG18_PASS',database:'insignia_m5_023_r10_append_current',fixtureProvenance:'synthetic local bootstrap and observations; not provider/native/owner evidence',reviewedBootstrapCreated:true,operatorAppend:1,runtimeSelectQualified:true,originalTimesPreserved:true,bothReceiptsBound:true,earliestExact30sExpiry:true,providerRequests:0,productionWrites:0}));
}finally{await core.close();}
