#!/usr/bin/env node
// Verify every retained row against its exact binary and serialized input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
let checked=0;
for(const run of ['baseline','candidate']){
 const dir=path.join(root,'evidence/measurements',run);
 const manifest=JSON.parse(readFileSync(path.join(dir,'matrix.json')));
 const runner=process.env.M0_013_RUNNER;assert.ok(runner,'M0_013_RUNNER must be the pinned project-local CLI runner');
 if(manifest.runnerSha256)assert.equal(sha(readFileSync(runner)),manifest.runnerSha256,`${run} runner changed`);
 for(const target of ['transform','validation']){
  const wasm=path.join(dir,`${target}.wasm`);
  const query=path.join(root,'rust',target,'src',target==='transform'?'cart_transform_run.graphql':'cart_validations_generate_run.graphql');
  const schema=path.join(root,'rust',target,'schema.graphql');
  for(const row of manifest.rows.filter(r=>r.target===target)){
   const prefix=path.join(dir,`${target}-${row.caseName}`);
   const input=readFileSync(`${prefix}.input.json`),expected=readFileSync(`${prefix}.expected.json`);
   assert.equal(sha(input),row.inputSha256,`${run}/${target}/${row.caseName} input`);
   assert.equal(sha(expected),row.expectedOutputSha256,`${run}/${target}/${row.caseName} expected`);
   assert.equal(input.length,row.inputBytes);
   assert.equal(sha(readFileSync(wasm)),row.wasmSha256);
   if(row.rawWasmSha256)assert.equal(sha(readFileSync(path.join(dir,`${target}.raw.wasm`))),row.rawWasmSha256);
   assert.equal(sha(readFileSync(query)),row.querySha256);
   const result=spawnSync(runner,['-f',wasm,'--export',target==='transform'?'cart_transform_run':'cart_validations_generate_run','--query-path',query,'--schema-path',schema,'--json'],{input,encoding:'utf8',maxBuffer:5_000_000});
   assert.equal(result.status,row.runnerExit,`${run}/${target}/${row.caseName} runner exit`);
   if(result.status!==0){
    assert.equal(result.stderr,row.runnerError);
   }else{
    const actual=JSON.parse(result.stdout);
    const output=Buffer.from(JSON.stringify(actual.output));
    assert.equal(sha(output),row.actualOutputSha256,`${run}/${target}/${row.caseName} output`);
    assert.equal(sha(readFileSync(`${prefix}.actual.json`)),row.actualOutputSha256);
    assert.equal(actual.instructions,row.instructions,`${run}/${target}/${row.caseName} instructions`);
    assert.equal(actual.memory_usage,row.linearMemoryKiB,`${run}/${target}/${row.caseName} linear memory`);
   }
   checked++;
  }
 }
 if(manifest.sources){for(const [name,hash] of Object.entries(manifest.sources))assert.equal(sha(readFileSync(path.join(root,name))),hash,`${run} source ${name}`);}
}
console.log(JSON.stringify({verifiedRows:checked,runs:['baseline','candidate']}));
