/** Run with Node 24 (or Node 22 --experimental-strip-types).
 * No network. Without an argument, executes the saved parser and exact guard-body excerpt.
 * With a repository path, runs complete PartnerClient -> AppEventsClient.send via synthetic fetch.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const repo = process.argv[2];
const parser = repo
 ? await import(pathToFileURL(join(resolve(repo),'spikes/m0-010/src/partner.ts')))
 : await import('./source/partner.ts');
let ExtractedGuard, PartnerClient, AppEventsClient, FileRunJournal;
if (repo) ({PartnerClient, AppEventsClient, FileRunJournal}=await import(pathToFileURL(join(resolve(repo),'spikes/m0-011/src/index.ts'))));
else ({ExtractedGuard}=await import('./source/guard-excerpt.ts'));
const appId='gid://shopify/App/202',shopId='gid://shopify/Shop/78935261342';
const now='2026-09-28T12:00:00.000Z';
const manifest={mode:'LIVE_ZERO_PRICE_TEST',appId,shopId,meterHandle:'customized_order_paid',
 planHandle:'private_test',runId:'principal-synthetic-only',approvedAt:now,observedAt:now,
 cycleFrom:'2026-09-20T00:00:00.000Z',cycleUntil:'2026-10-20T00:00:00.000Z',
 zeroPrice:true,appGidVerified:true,meterVerified:true,installationVerified:true};
const event={shop_id:shopId,event_handle:'customized_order_paid',timestamp:now,
 idempotency_key:'a'.repeat(64),attributes:{value:1}};
const initial={data:{activeSubscription:{app:{id:appId},shop:{id:shopId,myshopifyDomain:'fixture.myshopify.com'},
 billingPeriod:'EVERY_30_DAYS',cancelAtEndOfCycle:false,trialEndsAt:null,
 currentBillingCycle:{startTime:manifest.cycleFrom,endTime:manifest.cycleUntil},pendingUpdate:null,
 items:[
 {handle:'private_test',price:{__typename:'FlatRatePrice',active:true,currency:'USD',amount:'0.00'}},
 {handle:'customized_order_paid',price:{__typename:'TieredPrice',active:true,currency:'USD',tiersMode:'GRADUATED',tiers:[
 {upTo:1,amountPerUnit:'0.00',amount:'0.00'},{upTo:null,amountPerUnit:'0.00',amount:'0.00'}]},
 usage:{quantity:0,cost:{amount:'0.00',currencyCode:'USD'}}}]}}};
const scenarios=[
 ['canonical_control',x=>{},true],
 ['whole_seconds_Z',x=>{const c=x.data.activeSubscription.currentBillingCycle;c.startTime=c.startTime.replace('.000Z','Z');c.endTime=c.endTime.replace('.000Z','Z');},true],
 ['equivalent_offset',x=>{x.data.activeSubscription.currentBillingCycle={startTime:'2026-09-20T02:00:00+02:00',endTime:'2026-10-20T02:00:00+02:00'};},true],
 ['reversed_items',x=>{x.data.activeSubscription.items.reverse();},true],
 ['different_cycle',x=>{x.data.activeSubscription.currentBillingCycle.endTime='2026-10-21T00:00:00.000Z';},false],
 ['nonzero_unit',x=>{x.data.activeSubscription.items[1].price.tiers[1].amountPerUnit='0.01';},false],
 ['nonzero_flat',x=>{x.data.activeSubscription.items[1].price.tiers[0].amount='0.01';},false],
 ['wrong_app',x=>{x.data.activeSubscription.app.id='gid://shopify/App/999';},false]
];
const rows=[];
for (const [name,change,semanticallyAllowed] of scenarios) {
 const body=structuredClone(initial);change(body);
 const parsed=parser.parseActiveSubscription(200,body,{appId,shopId,observedAt:now});
 let accepted=false, sendResult=null, eventPosts=0;
 if (!repo) {
  accepted=parsed.kind==='ACTIVE' && new ExtractedGuard({appId,shopId,manifest,now:()=>now,journal:{},partner:{}}).allowed(event,body,now);
 } else {
  // Explicitly synthetic only. Actual tests should use Node's normal --test isolation.
  const dir=await mkdtemp(join(tmpdir(),'insignia-pr14-principal-'));
  const previous=process.env.NODE_TEST_CONTEXT;process.env.NODE_TEST_CONTEXT='child-v8';
  try {
   const credentials={partner:async()=> 'synthetic-partner',appEvents:async()=> 'synthetic-events'};
   const partner=new PartnerClient({appId,shopId,organizationId:'12345',credentials,now:()=>now,
    fetch:async()=>new Response(JSON.stringify(body),{status:200})});
   const client=new AppEventsClient({appId,shopId,credentials,now:()=>now,manifest,partner,
    journal:new FileRunJournal(join(dir,'journal.json')),
    fetch:async()=>{eventPosts++;return new Response('{"success":true}',{status:202});}});
   sendResult=await client.send(event);accepted=sendResult.kind==='RECEIVED';
  } finally {
   if(previous===undefined)delete process.env.NODE_TEST_CONTEXT;else process.env.NODE_TEST_CONTEXT=previous;
   await rm(dir,{recursive:true,force:true});
  }
 }
 rows.push({name,parser:parsed.kind,expectedGuard:semanticallyAllowed,observedGuard:accepted,sendResult,eventPosts:repo?eventPosts:null});
}
assert.equal(rows[0].observedGuard,true,'synthetic success control must work');
for(const row of rows.slice(4)) assert.equal(row.observedGuard,false,`${row.name} must reject`);
const defects=rows.filter(x=>x.expectedGuard!==x.observedGuard);
console.log(JSON.stringify({runtime:process.version,mode:repo?'complete_checkout_synthetic_clients':'exact_parser_plus_disclosed_guard_excerpt',
 networkCalls:0,scenarios:rows,failedEquivalentRepresentations:defects.map(x=>x.name)},null,2));
// Exit 0 denotes confirmed defects on the reviewed code, not passing production behavior.
assert.deepEqual(defects.map(x=>x.name),['whole_seconds_Z','equivalent_offset','reversed_items']);
