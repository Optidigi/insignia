import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const emptySelection = spawnSync(
  process.execPath,
  ['--test', '--test-name-pattern=^__insignia_no_matching_case__$', 'apps/web/test/admin/editor-browser.test.mts'],
  { encoding: 'utf8', timeout: 10000 },
);
assert.equal(
  emptySelection.status,
  0,
  'A filtered-out browser file must exit without starting leaked browser/server resources',
);

const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-name-pattern=passive current publication observation',
    'apps/web/test/admin/selected-publication-stress-browser.test.mts',
  ],
  {
    env: { ...process.env, INSIGNIA_STRESS_BLOCK_VISUALIZER: '1', INSIGNIA_PUBLICATION_STRESS_ITERATIONS: '1' },
    encoding: 'utf8',
    timeout: 40000,
  },
);
const output = result.stdout + result.stderr;
process.stdout.write(output);
assert.equal(result.status, 1, 'Missing renderer must fail the real stress path');
assert.match(output, /PUBLICATION_STRESS_FIRST_FAILURE/);
assert.match(output, /STRESS_RENDERER_BLOCKED/);
assert.match(output, /STRESS_RENDERER_OBSERVATION.*"canvasCount":0,"rendererReady":0/);
assert.ok(!output.includes('Web server did not start'), 'Server failure is not a renderer control');
console.log('EXPECTED NEGATIVE CONTROL: missing renderer rejected before canvas baseline.');
