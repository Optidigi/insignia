#!/usr/bin/env node
// Same serialized candidate input, two exact executables. Resource deltas are source changes, not optimizer claims.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runner=process.env.M0_013_RUNNER;assert.ok(runner);
const sha=x=>createHash('sha256').update(x).digest('hex');
const cases=['valid-10-mixed-200','valid-32-mixed-200','ordinary-200','physical-10000-five-buckets'];
const rows=[];
for(const target of ['transform','validation']){
 const src=path.join(root,'rust',target);
 const query=path.join(src,'src',target==='transform'?'cart_transform_run.graphql':'cart_validations_generate_run.graphql');
 const schema=path.join(src,'schema.graphql');
 for(const name of cases){
  const input=readFileSync(path.join(root,'evidence/measurements/candidate',`${target}-${name}.input.json`));
  const pair=[];
  for(const run of ['baseline','candidate']){
   const wasm=path.join(root,'evidence/measurements',run,`${target}.wasm`);
   const p=spawnSync(runner,['-f',wasm,'--export',target==='transform'?'cart_transform_run':'cart_validations_generate_run','--query-path',query,'--schema-path',schema,'--json'],{input,encoding:'utf8',maxBuffer:5_000_000});
   assert.equal(p.status,0,`${run}/${target}/${name}: ${p.stderr}`);
   const result=JSON.parse(p.stdout);pair.push({run,wasmSha256:sha(readFileSync(wasm)),instructions:result.instructions,linearMemoryKiB:result.memory_usage,outputSha256:sha(JSON.stringify(result.output)),outputBytes:Buffer.byteLength(JSON.stringify(result.output))});
  }
  assert.equal(pair[0].outputSha256,pair[1].outputSha256,`${target}/${name} output differs`);
  rows.push({target,caseName:name,inputSha256:sha(input),inputBytes:input.length,querySha256:sha(readFileSync(query)),sameOutput:true,executions:pair});
 }
}
writeFileSync(path.join(root,'evidence/measurements','same-input-comparison.json'),JSON.stringify({runnerName:path.basename(runner),runnerSha256:sha(readFileSync(runner)),rows},null,2)+'\n');
console.log(JSON.stringify({compared:rows.length,sameInputAndOutput:true}));
