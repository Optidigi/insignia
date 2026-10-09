import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';

const entry = new URL('../dist/main.js', import.meta.url);

test('configured worker serves liveness and durable readiness, then closes on SIGTERM', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 30_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the worker startup test');
  await installQueue(process.env.DATABASE_URL);
  const child = spawn(process.execPath, [entry.pathname, '--port=0'], {
    env: {
      ...process.env,
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      SHOPIFY_CLIENT_ID: 'synthetic-client-id',
      SHOPIFY_CLIENT_SECRET: 'synthetic-client-secret',
    },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let address;
  let stderr = '';
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    if (address) return;
    try {
      address = JSON.parse(chunk).url;
    } catch {
      /* wait for complete line */
    }
  });
  try {
    for (let i = 0; i < 100 && !address && child.exitCode === null; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(address, stderr);
    const response = await fetch(`${address}/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'live', durableReady: true });
    assert.equal((await fetch(`${address}/ready`)).status, 200);
    const metrics = await (await fetch(`${address}/metrics`)).text();
    assert.match(metrics, /insignia_/);
  } finally {
    child.kill('SIGTERM');
  }
  const code = await exited;
  assert.equal(code, 0, stderr);
  await assert.rejects(fetch(`${address}/live`));
});
