import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('server helper body preserves every original operator byte and excludes executable main', async () => {
  const original = await readFile(new URL('./signing-provision.mjs', import.meta.url), 'utf8');
  const core = await readFile(new URL('./signing-provision-core.mjs', import.meta.url), 'utf8');
  assert.equal(
    core.slice(core.indexOf('const hash =')).trimEnd(),
    original.slice(original.indexOf('const hash ='), original.indexOf('if (process.argv[1]')).trimEnd(),
  );
  assert.ok(!core.includes('process.stdin') && !core.includes('console.log') && !core.includes('process.env'));
});
