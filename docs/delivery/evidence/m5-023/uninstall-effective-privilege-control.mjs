import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createDurableCore } from '/home/serveradmin/insignia-m5-023-worktree/packages/database/dist/index.js';
import { createDatabase } from '/home/serveradmin/insignia-m5-023-worktree/packages/database/dist/client/database.js';
import { createConfigRepositoryInternal } from '/home/serveradmin/insignia-m5-023-worktree/packages/database/dist/repositories/config.js';
import { createPublicationRepository } from '/home/serveradmin/insignia-m5-023-worktree/packages/database/dist/repositories/publication.js';
import { createTenantRepository } from '/home/serveradmin/insignia-m5-023-worktree/packages/database/dist/repositories/tenant.js';
const require = createRequire('/home/serveradmin/insignia-m5-023-worktree/packages/database/package.json');
const { Pool } = require('pg'); const { sql } = require('kysely');
const connectionString = 'postgres://serveradmin@127.0.0.1:55424/insignia_m5_023?sslmode=disable';
const pool = new Pool({connectionString});const db = createDatabase(pool);
const core = createDurableCore(new Pool({connectionString}),{credentialKeys:{currentKeyId:'synthetic-k1',keys:{'synthetic-k1':Buffer.alloc(32,41)}}});
const shopId=randomUUID(),configId=randomUUID(),productId=randomUUID(),revisionId=randomUUID(),operationId=randomUUID();
try {
 await core.transactions.run(tx=>core.tenants.createShop(tx,{shopId,shopDomain:'m'+shopId.replaceAll('-','')+'.myshopify.com'}));
 await core.credentials.install({shopId,installationGeneration:'1',pair:{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',accessExpiresAt:new Date(Date.now()+60000),refreshExpiresAt:new Date(Date.now()+86400000),scopes:'write_products'}});
 const config=createConfigRepositoryInternal(db);
 await config.createConfig({shopId,configId,externalProductId:productId,draftSchemaVersion:'m3-config-draft-v1',draftValue:{}});
 await config.createRevision({shopId,configId,revisionId,schemaVersion:'m2-published-config-v1',publishedValue:{version:'m2-published-config-v1',shopId,productId,revisionId,shopCurrency:'USD',methods:[],placements:[],productionOptions:[],pricingRules:[]}});
 await db.transaction().execute(async tx=>{const p=createPublicationRepository(tx),projection={policy:'required',readiness:'ready'};await p.request({shopId,configId,operationId,revisionId,installationGeneration:'1',expectedProjection:projection});assert.equal(await p.acknowledge(shopId,configId,operationId),'acknowledged');assert.equal(await p.observe({shopId,configId,operationId,projection}),'observed');assert.equal(await p.activate(shopId,configId,operationId),'activated');});
 await db.transaction().execute(async tx=>{
   await sql.raw('GRANT SELECT,INSERT,UPDATE,DELETE ON shops,installation_generations,shop_credentials,product_configs,inbox_messages,shopify_webhook_deliveries TO insignia_runtime; GRANT USAGE ON SCHEMA public TO insignia_runtime; REVOKE SELECT ON publication_operations FROM insignia_runtime').execute(tx);
   const query=readFileSync(process.argv[2],'utf8');
   const preflight=(await sql.raw(query).execute(tx)).rows[0].json_build_object;
   assert.equal(preflight.uninstallRuntimeUsable,process.argv[3]==='old');
   // Credentials use installation_generation, so read each exact fixture separately.
   const state=async()=>({i:(await tx.selectFrom('installation_generations').selectAll().where('shop_id','=',shopId).execute()),c:(await tx.selectFrom('shop_credentials').selectAll().where('shop_id','=',shopId).execute()),p:await createConfigRepositoryInternal(tx).getConfig(shopId,configId)});
   const before=await state();assert.equal(before.p.effectiveRevisionId,revisionId);
   await sql.raw('SET LOCAL ROLE insignia_runtime; SAVEPOINT uninstall_control').execute(tx);
   await assert.rejects(createTenantRepository(tx).deactivateCurrent(tx,shopId,'1'),e=>e.code==='42501');
   await sql.raw('ROLLBACK TO SAVEPOINT uninstall_control; RESET ROLE').execute(tx);
   assert.deepEqual(await state(),before);
   await sql.raw('GRANT SELECT ON publication_operations TO insignia_runtime; SET LOCAL ROLE insignia_runtime').execute(tx);
   assert.equal(await createTenantRepository(tx).deactivateCurrent(tx,shopId,'1'),'deactivated');
   await sql.raw('RESET ROLE').execute(tx);
   const after=await state();assert.equal(after.p.effectiveRevisionId,null);assert.ok(after.i[0].deactivated_at);assert.equal(after.c[0].state,'revoked');
   // Roll back this privilege and lifecycle rehearsal without deleting the immutable published fixture.
   throw Object.assign(new Error('rehearsal_rollback'),{control:true});
 }).catch(e=>{if(!e.control)throw e});
 console.log('PASS local PG18 effective-publication uninstall: publication_operations SELECT preflight checked against explicit old/corrected expectation; actual deactivation fails 42501 and all installation/credential/effective pointer bytes survive; restoring SELECT permits atomic deactivation. Rehearsal rolled back, no production/provider access.');
} finally {await db.destroy();await core.close()}
