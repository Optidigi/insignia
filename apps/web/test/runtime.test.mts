import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

async function startServer() {
  const port = 0;
  const child = spawn(process.execPath, [new URL('../dist/server/entry.mjs', import.meta.url).pathname], {
    env: {
      ...process.env,
      SHOPIFY_CLIENT_ID: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      ASTRO_NODE_LOGGING: 'enabled',
    },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout = (stdout + chunk).slice(-8192);
  });
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  let base: string | undefined;
  try {
    let live: Response | undefined;
    for (let i = 0; i < 100 && !live && child.exitCode === null && child.signalCode === null; i++) {
      try {
        const match = stripVTControlCharacters(stdout).match(/Server listening on (http:\/\/127\.0\.0\.1:(\d+))\r?\n/);
        if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error('No bound address yet');
        base = match[1];
        live = await fetch(`${base}/live`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(
      live,
      JSON.stringify({ requestedPort: port, stdout, stderr, exitCode: child.exitCode, signalCode: child.signalCode }),
    );
    assert.ok(base);
    assert.deepEqual(await live.json(), { status: 'live' });
    return { base, child, exited };
  } catch (error) {
    child.kill('SIGTERM');
    await exited;
    throw error;
  }
}

test('built SSR preserves embedded routing context and fails closed without Shopify configuration', async () => {
  const { base, child, exited } = await startServer();
  try {
    const query = '?shop=synthetic.myshopify.com&host=synthetic-host&embedded=1';
    const response = await fetch(base + query, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/admin/products${query}`);
    const unavailable = await fetch(new URL(`/admin/products${query}`, base));
    assert.equal(unavailable.status, 503);
    const shell = await unavailable.text();
    assert.doesNotMatch(shell, /shopify-api|access_token|private_key/i);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
