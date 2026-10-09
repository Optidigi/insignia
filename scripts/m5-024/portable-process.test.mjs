import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { installQueue } from './install-queue.mjs';

test('portable production entry boots in a fresh process, denies JS filesystem writes and stops cleanly', {
  skip:
    !process.env.M5_WORKER_PACKAGE_ENTRY ||
    (!process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1'),
  timeout: 30_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  await installQueue(process.env.DATABASE_URL);
  const entry = process.env.M5_WORKER_PACKAGE_ENTRY;
  const packageRoot = dirname(dirname(entry));
  const guard = resolve(import.meta.dirname, 'local-network-guard.mjs');
  const flags = ['--permission', `--allow-fs-read=${packageRoot}`, `--allow-fs-read=${guard}`, '--allow-addons'];
  // Node's JS filesystem control is not a container read-only-root proof (native addon access is separate).
  const write = spawn(
    process.execPath,
    [...flags, '-e', "require('node:fs').writeFileSync(process.argv[1],'bad')", `${packageRoot}/mutation-denied`],
    { stdio: 'pipe' },
  );
  let denied = '';
  write.stderr.on('data', (bytes) => {
    denied += bytes;
  });
  assert.notEqual((await once(write, 'exit'))[0], 0);
  assert.match(denied, /ERR_ACCESS_DENIED/);
  const child = spawn(process.execPath, [...flags, '--import', guard, entry, '--port=0'], {
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      SHOPIFY_CLIENT_ID: 'synthetic-client',
      SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
    },
    stdio: 'pipe',
  });
  let url;
  let buffer = '';
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    for (const line of buffer.split('\n')) {
      try {
        const value = JSON.parse(line);
        if (value.url) url = value.url;
      } catch {
        /* partial line */
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
  });
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  try {
    for (let i = 0; i < 100 && !url && child.exitCode === null; i++) await delay(100);
    assert.ok(url, stderr);
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal((await fetch(`${url}/ready`)).status, 200);
    assert.equal((await fetch(`${url}/live`)).status, 200);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([closed, delay(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  assert.equal(child.exitCode, 0, stderr);
});
