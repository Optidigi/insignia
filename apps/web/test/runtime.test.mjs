import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

async function startServer() {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [new URL('../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let live;
    for (let i = 0; i < 100 && !live && child.exitCode === null; i++) {
      try {
        live = await fetch(`${base}/live`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(live, stderr);
    assert.deepEqual(await live.json(), { status: 'live' });
    return { base, child, exited };
  } catch (error) {
    child.kill('SIGTERM');
    await exited;
    throw error;
  }
}

test('built SSR serves the unauthenticated public shell', async () => {
  const { base, child, exited } = await startServer();
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const shell = await response.text();
    assert.match(shell, /Merchant access is not available/);
    assert.doesNotMatch(shell, /shopify-api|access_token|private_key/i);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
