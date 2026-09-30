import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', '--test-name-pattern=publication success preserves dirty', 'apps/web/test/admin/editor-browser.test.mjs'],
  {
    env: { ...process.env, M5_STRESS_BLOCK_VISUALIZER: '1', M5_PUBLICATION_STRESS_ITERATIONS: '1' },
    encoding: 'utf8',
    timeout: 20000,
  },
);
const output = result.stdout + result.stderr;
process.stdout.write(output);
assert.equal(result.status, 1, 'Missing renderer must fail the real stress path');
assert.match(output, /PUBLICATION_STRESS_FIRST_FAILURE/);
assert.match(output, /waiting for getByText\('Preview: ready'/);
assert.match(output, /"projectedGeometry":null/);
assert.ok(!output.includes('Web server did not start'), 'Server failure is not a renderer control');
console.log('EXPECTED NEGATIVE CONTROL: missing renderer rejected before canvas baseline.');
