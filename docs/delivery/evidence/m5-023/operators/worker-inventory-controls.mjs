/** Filesystem/transport seam controls: no worker or dependency code executes. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collectWorkerInventory, workerInventoryMatches, workerProcessMatches } from './worker-inventory.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'insignia-worker-proof-'));
  const worker = join(root,'node_modules/@insignia/worker');
  const database = join(root,'node_modules/@insignia/database');
  const outside = join(root,'outside.js');
  for (const directory of [worker,database]) mkdirSync(join(directory,'dist'),{recursive:true});
  writeFileSync(join(worker,'package.json'),JSON.stringify({name:'@insignia/worker',version:'0.0.1',dependencies:{'@insignia/database':'0.0.1'}}));
  writeFileSync(join(database,'package.json'),JSON.stringify({name:'@insignia/database',version:'0.0.1',exports:'./dist/index.js'}));
  const sentinel = "throw new Error('Dependency execution is forbidden');\n";
  writeFileSync(join(worker,'dist/main.js'),sentinel);
  writeFileSync(join(worker,'dist/handlers.js'),sentinel);
  writeFileSync(join(database,'dist/index.js'),sentinel);
  writeFileSync(outside,sentinel);
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('External transport forbidden'); };
  try { run({root,worker,database,outside,entry:join(worker,'dist/main.js')}); assert.equal(requests,0); }
  finally { globalThis.fetch = previous; rmSync(root,{recursive:true,force:true}); }
}

test('complete inventory accepts exact dependencies without executing them',()=>fixture(({entry})=>{
  const inventory = collectWorkerInventory(entry);
  assert.deepEqual(inventory.packages.map(value=>value.name),['@insignia/worker','@insignia/database']);
  assert.equal(workerInventoryMatches(entry,inventory),true);
}));
test('changed database dependency fails despite identical entry and handler bytes',()=>fixture(({entry,worker,database})=>{
  const inventory = collectWorkerInventory(entry);
  const main = readFileSync(entry); const handlers = readFileSync(join(worker,'dist/handlers.js'));
  writeFileSync(join(database,'dist/index.js'),"throw new Error('Older resolver');\n");
  assert.equal(workerInventoryMatches(entry,inventory),false);
  assert.deepEqual(readFileSync(entry),main); assert.deepEqual(readFileSync(join(worker,'dist/handlers.js')),handlers);
}));
test('additional executable file fails exact inventory',()=>fixture(({entry,database})=>{
  const inventory = collectWorkerInventory(entry);
  writeFileSync(join(database,'dist/additional.js'),'export const drift = true;');
  assert.equal(workerInventoryMatches(entry,inventory),false);
}));
test('changed internal module path fails despite unchanged file bytes',()=>fixture(({entry,worker})=>{
  const inventory = collectWorkerInventory(entry);
  rmSync(entry); symlinkSync('handlers.js',entry);
  assert.deepEqual(readFileSync(entry),readFileSync(join(worker,'dist/handlers.js')));
  assert.equal(workerInventoryMatches(entry,inventory),false);
}));
test('escaping executable link is rejected before reading or executing it',()=>fixture(({entry,database,outside})=>{
  symlinkSync(outside,join(database,'dist/escape.js'));
  assert.throws(()=>collectWorkerInventory(entry),/link escape/);
}));
test('preload and lookup overrides cannot qualify',()=>fixture(({entry})=>{
  const inventory = collectWorkerInventory(entry);
  for (const key of ['NODE_OPTIONS','NODE_PATH']) {
    const before = process.env[key]; process.env[key] = 'unreviewed';
    try { assert.equal(workerInventoryMatches(entry,inventory),false); }
    finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
  }
}));
test('nearer dist dependency shadow cannot qualify the reviewed root package',()=>fixture(({entry,worker})=>{
  const expected = collectWorkerInventory(entry);
  const shadow = join(worker,'dist/node_modules/@insignia/database');
  mkdirSync(shadow,{recursive:true});
  writeFileSync(join(shadow,'package.json'),JSON.stringify({name:'@insignia/database',version:'0.0.0',main:'index.js'}));
  writeFileSync(join(shadow,'index.js'),"throw new Error('Obsolete resolver must never execute');");
  assert.equal(createRequire(entry).resolve('@insignia/database'),join(shadow,'index.js'));
  assert.equal(workerInventoryMatches(entry,expected),false);
}));
test('mislabeled nearer owned-root dependency is rejected at the Node lookup boundary',()=>fixture(({entry,worker})=>{
  const expected = collectWorkerInventory(entry);
  const shadow = join(worker,'node_modules/@insignia/database');
  mkdirSync(shadow,{recursive:true});
  writeFileSync(join(shadow,'package.json'),JSON.stringify({name:'shadow',version:'0.0.0',exports:'./index.js'}));
  writeFileSync(join(shadow,'index.js'),"throw new Error('Unreviewed shadow must never execute');");
  assert.equal(createRequire(entry).resolve('@insignia/database'),join(shadow,'index.js'));
  assert.throws(()=>workerInventoryMatches(entry,expected),/Unqualified dependency candidate/);
}));
test('nearer legacy directory without metadata cannot fall through to the outer package',()=>fixture(({entry,worker})=>{
  const expected = collectWorkerInventory(entry);
  const shadow = join(worker,'node_modules/@insignia/database');
  mkdirSync(shadow,{recursive:true});
  writeFileSync(join(shadow,'index.js'),"throw new Error('Legacy shadow must never execute');");
  assert.equal(createRequire(entry).resolve('@insignia/database'),join(shadow,'index.js'));
  assert.throws(()=>workerInventoryMatches(entry,expected),/Unqualified dependency candidate/);
}));
test('nearer CJS file cannot fall through to the outer package',()=>fixture(({entry,worker})=>{
  const expected = collectWorkerInventory(entry);
  const directory = join(worker,'node_modules/@insignia');
  mkdirSync(directory,{recursive:true});
  const shadow = join(directory,'database.js');
  writeFileSync(shadow,"throw new Error('CJS file shadow must never execute');");
  assert.equal(createRequire(entry).resolve('@insignia/database'),shadow);
  assert.throws(()=>workerInventoryMatches(entry,expected),/Unqualified dependency candidate/);
}));
test('qualified nested module files remain bound and any change fails',()=>fixture(({entry,worker})=>{
  const nested = join(worker,'dist/fixtures/node_modules/qualified');
  mkdirSync(nested,{recursive:true});
  const file = join(nested,'index.js');writeFileSync(file,"throw new Error('Never execute inventory fixtures');");
  const expected = collectWorkerInventory(entry);
  assert.equal(workerInventoryMatches(entry,expected),true);
  writeFileSync(file,"throw new Error('Changed nested bytes');");
  assert.equal(workerInventoryMatches(entry,expected),false);
}));
test('root alias into writable storage fails even with exact package bytes',()=>fixture(({root,entry,worker})=>{
  const expected = collectWorkerInventory(entry);
  const mutable = join(root,'mutable-worker');
  renameSync(worker,mutable); symlinkSync(mutable,worker);
  assert.throws(()=>workerInventoryMatches(entry,expected,[mutable]),/Writable executable overlap/);
}));
test('inventory alone cannot qualify a different actually running process',()=>fixture(({entry})=>{
  const inventory = collectWorkerInventory(entry);
  const value = JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./worker-inventory.mjs',import.meta.url))],{
    input:JSON.stringify({entry,inventory,command:['node',entry],writablePaths:[]}),encoding:'utf8',
  }));
  assert.equal(value.exact,false);
  assert.equal(value.dependencyCodeExecuted,false);
}));
test('effective process requires exact arguments, binary and absent preload flags',()=>{
  const command = ['node','/srv/worker/dist/main.js','--port=4301'];
  const exact = {argv:[...command],nodeMatches:true,preloadAbsent:true};
  assert.equal(workerProcessMatches(exact,command),true);
  for (const actual of [
    {...exact,argv:['node','--import=/opt/unreviewed.mjs',...command.slice(1)]},
    {...exact,nodeMatches:false}, {...exact,preloadAbsent:false},
  ]) assert.equal(workerProcessMatches(actual,command),false);
});
