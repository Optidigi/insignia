import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const entry = new URL('../dist/main.js', import.meta.url);

test('local listener serves liveness and closes on SIGTERM', async () => {
  const child = spawn(process.execPath, [entry.pathname, '--port=0']);
  const exited = new Promise(resolve => child.once('close', resolve));
  let address;
  let stderr = '';
  child.on('error', error => { stderr += error.message; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    if (address) return;
    try { address = JSON.parse(chunk).url; } catch { /* wait for complete line */ }
  });
  try {
    for (let i = 0; i < 25 && !address && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(address, stderr);
    const response = await fetch(`${address}/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'live', durableReady: false });
  } finally {
    child.kill('SIGTERM');
  }
  const code = await exited;
  assert.equal(code, 0, stderr);
  await assert.rejects(fetch(`${address}/live`));
});
