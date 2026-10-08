/** Filesystem/transport seam controls: no worker or dependency code executes. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { collectWorkerInventory, workerInventoryMatches } from './worker-inventory.mjs';

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
  try { run({worker,database,outside,entry:join(worker,'dist/main.js')}); assert.equal(requests,0); }
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
