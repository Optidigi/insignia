#!/usr/bin/env node
// Reproducible synthetic full-target capacity matrix. The public RFC 8032 seed is never a merchant key.
import assert from 'node:assert/strict';
import {createHash, createPrivateKey, sign} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allocateGroups} from '../../m0-004/ts/allocation.ts';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const root=path.join(repo,'spikes/m0-013');
const evidence=path.join(root,'evidence/measurements',process.env.M0_013_RUN_ID||'baseline');
mkdirSync(evidence,{recursive:true});
for(const name of readdirSync(evidence))if(/\.(?:input|expected|actual)\.json$|\.error\.txt$/.test(name))unlinkSync(path.join(evidence,name));
const sha=x=>createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(x);
const seed=Buffer.alloc(32,1);
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
const domain=Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0');
const baseline={};
for(const target of ['transform','validation']) baseline[target]=JSON.parse(readFileSync(path.join(repo,`spikes/m0-007/fixtures/${target}-valid.json`)));
const baseHeader=Buffer.from(baseline.transform.cart.quote.value,'base64url').subarray(0,92);
const runner=process.env.M0_013_RUNNER;assert.ok(runner,'M0_013_RUNNER must be the pinned project-local CLI runner');
const runnerBytes=readFileSync(runner);
const limits={binaryBytes:256000,instructions:11000000,inputBytes:128000,outputBytes:20000,linearMemoryBytes:10000000,stackBytes:512000,queryBytes:3000,queryCost:30};
const rows=[];
const clone=x=>structuredClone(x);
const money=(n,exp=2)=>`${n/10n**BigInt(exp)}.${String(n%10n**BigInt(exp)).padStart(exp,'0')}`;
const uuid=i=>`gid://shopify/CartLine/00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
const numeric=i=>`gid://shopify/CartLine/${9007199254740991n+BigInt(i)}`;
const record=(i,s)=>{const b=Buffer.alloc(22);b.writeUInt16BE(i,0);b.writeBigUInt64BE(BigInt(s.variant),2);b.writeUInt32BE(s.quantity,10);b.writeBigUInt64BE(BigInt(s.unitMinor),14);return b};
function issued(specs, opts={}){
  const h=Buffer.from(baseHeader);h.writeUInt16BE(specs.length,60);h.writeUInt32BE(opts.expiry??20804,76);
  const quantity=specs.reduce((n,s)=>n+s.quantity,0);
  const total=specs.reduce((n,s)=>n+BigInt(s.quantity)*BigInt(s.unitMinor),0n);
  h.writeUInt32BE(quantity,80);h.writeBigUInt64BE(total,84);
  if(opts.keyId!==undefined)h.writeUInt16BE(opts.keyId,6);
  if(opts.epoch!==undefined)h.writeUInt32BE(opts.epoch,24);
  const members=specs.map((s,i)=>record(i,s));const sig=sign(null,Buffer.concat([domain,h,...members]),key);
  return {envelope:Buffer.concat([h,sig]).toString('base64url'),members:members.map(b=>b.toString('base64url'))};
}
function make(target,specs,ordinary=0,opts={}){
 assert(specs.length+ordinary<=250);
 const x=clone(baseline[target]);
 const cfg=JSON.parse(x.shop.publicConfig.value);cfg.maxBuckets=Number(process.env.M0_013_MAX_BUCKETS||200);
 if(opts.rotation){cfg.keys.push({...cfg.keys[0],id:8});if(opts.rotation==='revoked-old')cfg.keys[0].revoked=true;}
 x.shop.publicConfig.value=stable(cfg);
 const signed=issued(specs,opts);x.cart.quote=specs.length?{value:signed.envelope}:null;x.cart.lines=[];
 const template=baseline[target].cart.lines[0];
 for(let i=0;i<specs.length+ordinary;i++){
   const l=clone(template);const s=specs[i];l.id=(opts.numericIds?numeric:uuid)(i);
   if(s){l.quantity=s.quantity;l.member={value:signed.members[i]};l.merchandise.id=`gid://shopify/ProductVariant/${s.variant}`;
     l.merchandise.product.id=`gid://shopify/Product/${s.product??42}`;
     if(target==='validation')l.cost.subtotalAmount.amount=money(BigInt(s.quantity)*BigInt(s.unitMinor));
   }else{l.quantity=1;l.member=null;l.merchandise.id=`gid://shopify/ProductVariant/${9007199254741100n+BigInt(i)}`;
     if(opts.unmanagedOrdinary){l.merchandise.product.policy=null;l.merchandise.product.registration=null;}
     else l.merchandise.product.policy.value='11111111111111111111111111111111:1:optional';
     if(target==='validation')l.cost.subtotalAmount.amount='10.00';}
   x.cart.lines.push(l);
 }
 if(opts.policyPending)x.cart.lines[0].merchandise.product.registration.value='11111111111111111111111111111111:1:pending';
 if(opts.reverseLines)x.cart.lines.reverse();
 return x;
}
const specs=(n,q=1)=>Array.from({length:n},(_,i)=>({variant:String(9007199254740993n+BigInt(i%3)),quantity:q,unitMinor:'3000',product:i%3+42}));
const valid=(target,input)=>target==='validation'?{operations:[]}:{operations:input.cart.lines.filter(l=>l.member).map(l=>({lineExpand:{cartLineId:l.id,expandedCartItems:[{merchandiseId:l.merchandise.id,quantity:1,attributes:[{key:'_insignia_member_v2',value:l.member.value}],price:{adjustment:{fixedPricePerUnit:{amount:money(BigInt(Buffer.from(l.member.value,'base64url').readBigUInt64BE(14)))}}}}]}}))};
const invalid=target=>target==='validation'?{operations:[{validationAdd:{errors:[{message:'Review your Insignia customization before checkout.',target:'$.cart'}]}}]}:{operations:[]};
const cases=[];
function add(name,n,ordinary=0,opts={}){cases.push({name,n,ordinary,opts});}
for(const n of [1,3,10,32,64]){add(`valid-${n}-alone`,n);add(`valid-${n}-mixed-200`,n,200-n);}
add('ordinary-200',0,200);add('unmanaged-200',0,200,{unmanagedOrdinary:true});add('ordinary-250-runner-stress',0,250,{unmanagedOrdinary:true});
add('valid-33-mixed-200',33,167);
add('max-width-money-and-ids',1,0,{customSpecs:[{variant:'18446744073709551615',product:42,quantity:1,unitMinor:'18446744073709551615'}]});add('physical-10000-five-buckets',5,0,{quantity:2000});
add('numeric-cartline-10-mixed-200',10,190,{numericIds:true});
const allocation=allocateGroups([
 {groupId:'shirts',setupMinor:'1',variants:[{variantId:'9007199254740993',quantity:3,acceptedBaseUnitMinor:'2300'}]},
 {groupId:'hoodies',setupMinor:'2',variants:[{variantId:'9007199254740994',quantity:4,acceptedBaseUnitMinor:'3500'}]},
]);
assert.equal(allocation.totalQuantity,7);assert.equal(allocation.totalMinor,'20903');
const allocatedSpecs=allocation.buckets.map(b=>({variant:b.variantId,product:b.groupId==='shirts'?42:43,quantity:b.quantity,unitMinor:b.unitMinor}));
add('allocation-two-groups-remainder',allocatedSpecs.length,0,{customSpecs:allocatedSpecs});
add('allocation-reordered',allocatedSpecs.length,0,{customSpecs:allocatedSpecs,reverseLines:true});
add('rotation-overlap-valid',3,0,{rotation:'overlap',keyId:8});
add('rotation-revoked-old-valid-new',3,0,{rotation:'revoked-old',keyId:8});
add('valid-policy-pending-signed',3,0,{policyPending:true});
for(const negative of ['missing','duplicate','malformed','oversized-member','tampered','price-edit','compensated-price','expired','future','revoked','unknown-key','stale-epoch','selling-plan','mixed-required-unsigned','oversized-cartline-id','oversized-variant-id','over-physical','over-config-buckets','oversized-envelope','malformed-envelope','oversized-config','policy-stale-generation'])add(`reject-${negative}`,10,0,{negative});
for(const target of ['transform','validation']){
 const src=path.join(root,`rust/${target}`);
 const wasmPath=path.join(src,`target/wasm32-unknown-unknown/release/m0-013-cart-${target}.wasm`);
 const wasm=readFileSync(wasmPath);copyFileSync(wasmPath,path.join(evidence,`${target}.wasm`));
 const rawWasm=readFileSync(path.join(evidence,`${target}.raw.wasm`));
 const queryPath=path.join(src,'src',target==='transform'?'cart_transform_run.graphql':'cart_validations_generate_run.graphql');
 const query=readFileSync(queryPath);const schemaPath=path.join(src,'schema.graphql');
 for(const c of cases){
  const s=c.opts.customSpecs??specs(c.n,c.opts.quantity??1);
  const x=make(target,s,c.ordinary,c.opts);const bad=c.opts.negative||(c.n>Number(process.env.M0_013_MAX_BUCKETS||200)?'candidate-bucket-bound':null);
  if(bad){
   const config=JSON.parse(x.shop.publicConfig.value);
   switch(bad){
   case 'missing': x.cart.lines.pop();break;
   case 'duplicate':x.cart.lines[1].member.value=x.cart.lines[0].member.value;break;
   case 'malformed':x.cart.lines.at(-1).member.value='+'+x.cart.lines.at(-1).member.value.slice(1);break;
   case 'oversized-member':x.cart.lines.at(-1).member.value+='A';break;
   case 'tampered':{const b=Buffer.from(x.cart.lines.at(-1).member.value,'base64url');b[21]^=1;x.cart.lines.at(-1).member.value=b.toString('base64url');break;}
   case 'price-edit':if(target==='validation')x.cart.lines[0].cost.subtotalAmount.amount='30.01';else x.cart.lines[0].quantity=2;break;
   case 'compensated-price':if(target==='validation'){x.cart.lines[0].cost.subtotalAmount.amount='30.01';x.cart.lines[1].cost.subtotalAmount.amount='29.99';}else{x.cart.lines[0].quantity=2;x.cart.lines[1].quantity=0;}break;
   case 'expired':x.shop.localTime.date='2026-12-18';break;
   case 'future':x.cart.quote.value=issued(s,{expiry:20808}).envelope;break;
   case 'revoked':config.keys[0].revoked=true;break;
   case 'unknown-key':x.cart.quote.value=issued(s,{keyId:8}).envelope;break;
   case 'stale-epoch':x.cart.quote.value=issued(s,{epoch:3}).envelope;break;
   case 'selling-plan':x.cart.lines[0].sellingPlanAllocation={sellingPlan:{id:'gid://shopify/SellingPlan/1'}};break;
   case 'mixed-required-unsigned':x.cart.lines[0].member=null;break;
   case 'oversized-cartline-id':x.cart.lines[0].id+='X';break;
   case 'oversized-variant-id':x.cart.lines[0].merchandise.id='gid://shopify/ProductVariant/18446744073709551616';break;
   case 'over-physical':config.maxPhysicalQuantity=9;break;
   case 'over-config-buckets':config.maxBuckets=9;break;
   case 'oversized-envelope':x.cart.quote.value+='A';break;
   case 'malformed-envelope':x.cart.quote.value='+'+x.cart.quote.value.slice(1);break;
   case 'oversized-config':config.padding='x'.repeat(1025);break;
   case 'policy-stale-generation':x.cart.lines[0].merchandise.product.policy.value='22222222222222222222222222222222:1:required';break;
   }
   x.shop.publicConfig.value=stable(config);
  }
  // Transform cannot observe a subtotal edit; its paired negative changes a signed quantity.
  const expected=bad?invalid(target):valid(target,x);
  const inputBytes=Buffer.from(stable(x));const expectedBytes=Buffer.from(stable(expected));
  const filename=`${target}-${c.name}`;writeFileSync(path.join(evidence,`${filename}.input.json`),inputBytes);
  writeFileSync(path.join(evidence,`${filename}.expected.json`),expectedBytes);
  const proc=spawnSync(runner,['-f',wasmPath,'--export',target==='transform'?'cart_transform_run':'cart_validations_generate_run','--query-path',queryPath,'--schema-path',schemaPath,'--json'],{input:inputBytes,encoding:'utf8',maxBuffer:5_000_000});
  let parsed=null,output=null,error=null;
  try{parsed=JSON.parse(proc.stdout);output=parsed.output??null;}catch{error=proc.stderr||proc.error?.message||proc.stdout;}
  if(proc.status!==0)error=proc.stderr||error||`runner exit ${proc.status}`;
  const outputBytes=output===null?null:Buffer.from(stable(output));
  if(outputBytes)writeFileSync(path.join(evidence,`${filename}.actual.json`),outputBytes);
  if(error)writeFileSync(path.join(evidence,`${filename}.error.txt`),String(error));
  rows.push({target,caseName:c.name,expectedBehavior:bad?'reject':'accept',rejectionKind:bad==='candidate-bucket-bound'?'guard':bad?'adversarial':null,actualBehavior:error?'runner-error':stable(output)===stable(expected)?bad?'reject':'accept':'wrong-output',
   signedBuckets:c.n,ordinaryLines:c.ordinary,physicalQuantity:s.reduce((a,b)=>a+b.quantity,0),
   wasmSha256:sha(wasm),binaryBytes:wasm.length,rawWasmSha256:sha(rawWasm),rawBinaryBytes:rawWasm.length,querySha256:sha(query),queryBytes:query.length,calculatedQueryCost:target==='transform'?20:23,
   inputSha256:sha(inputBytes),expectedOutputSha256:sha(expectedBytes),actualOutputSha256:outputBytes?sha(outputBytes):null,
   inputBytes:inputBytes.length,outputBytes:outputBytes?.length??null,instructions:parsed?.instructions??null,linearMemoryKiB:parsed?.memory_usage??null,
   stackBytes:null,stackMethod:'unmeasured',runnerExit:proc.status,runnerError:error,
   referenceApplies:c.n+c.ordinary<=200,withinMeasuredReference:c.n+c.ordinary>200?null:!error&&wasm.length<=limits.binaryBytes&&inputBytes.length<=limits.inputBytes&&outputBytes.length<=limits.outputBytes&&parsed?.instructions<=limits.instructions&&parsed?.memory_usage*1024<=limits.linearMemoryBytes&&query.length<=limits.queryBytes&&(target==='transform'?20:23)<=limits.queryCost,
   withinInstructionOutputHeadroom:!error&&parsed?.instructions<=8800000&&outputBytes.length<=16000});
 }
}
const sourceFiles=['rust/authorization/src/lib.rs','rust/authorization/src/whole.rs','rust/policy/projection.rs','rust/capacity.rs','rust/transform/src/main.rs','rust/validation/src/main.rs','rust/transform/src/cart_transform_run.graphql','rust/validation/src/cart_validations_generate_run.graphql','rust/transform/schema.graphql','rust/validation/schema.graphql','rust/transform/Cargo.lock','rust/validation/Cargo.lock','rust/transform/shopify.extension.toml','rust/validation/shopify.extension.toml','rust/shopify.app.toml'];
const sources=Object.fromEntries(sourceFiles.map(f=>[f,sha(readFileSync(path.join(root,f)))]));
const trampoline=process.env.M0_013_TRAMPOLINE;
const cli=process.env.M0_013_SHOPIFY_CLI;
const manifest={source:'M0-006 target + M0-007 policy + M0-005 verifier materialized under M0-013',sources,runnerName:path.basename(runner),runnerSha256:sha(runnerBytes),runnerVersion:spawnSync(runner,['--version'],{encoding:'utf8'}).stdout.trim(),trampolineName:trampoline?path.basename(trampoline):null,trampolineSha256:trampoline?sha(readFileSync(trampoline)):null,shopifyCliVersion:cli?spawnSync(cli,['version'],{encoding:'utf8'}).stdout.trim():null,cargoVersion:spawnSync('cargo',['--version'],{encoding:'utf8'}).stdout.trim(),rustcVersion:spawnSync('rustc',['--version'],{encoding:'utf8'}).stdout.trim(),nodeVersion:process.version,limits,rows};
writeFileSync(path.join(evidence,'matrix.json'),JSON.stringify(manifest,null,2)+'\n');
const failures=rows.filter(r=>r.actualBehavior!==r.expectedBehavior||(r.referenceApplies&&r.expectedBehavior==='accept'&&!r.withinMeasuredReference));
console.log(JSON.stringify({rows:rows.length,failures:failures.map(r=>({target:r.target,caseName:r.caseName,behavior:r.actualBehavior,instructions:r.instructions,outputBytes:r.outputBytes,error:r.runnerError?.slice(0,160)}))},null,2));

if(process.env.M0_013_RUN_ID==='candidate'&&failures.length)process.exitCode=1;
