import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

async function inspect(corrected) {
  const entry = new URL('../../apps/web/dist/server/entry.mjs', import.meta.url).href;
  const helper = new URL('./built-runtime.mjs', import.meta.url).href;
  const script = `${corrected ? `import {prepareBuiltPreviewRuntime} from ${JSON.stringify(helper)}; prepareBuiltPreviewRuntime(process.env);` : ''} await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: '0',
      INSIGNIA_M5_002_DIAGNOSTIC: '0',
      SHOPIFY_CLIENT_ID: 'synthetic_built_runtime_key',
    },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output += chunk.toString();
    });
  try {
    let base;
    for (let n = 0; n < 100 && child.exitCode === null; n++) {
      base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (base) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(base, output);
    const observations = [];
    for (const path of ['/admin/products', '/admin/products/111/config']) {
      const response = await fetch(base + path);
      const html = await response.text();
      const csp = response.headers.get('content-security-policy');
      assert.equal(response.status, 200);
      assert.ok(html.includes('name="shopify-api-key" content="synthetic_built_runtime_key"'));
      assert.ok(!csp.split('style-src')[0].includes("'unsafe-inline'"));
      const hashes = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter((match) => match[2].trim())
        .map((match) => createHash('sha256').update(match[2]).digest('base64'));
      assert.equal(hashes.length, 2);
      observations.push({ path, rejected: hashes.filter((hash) => !csp.includes(`'sha256-${hash}'`)) });
    }
    return observations;
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
}

test('complete built server reproduces CLI development-mode CSP rejection', async () => {
  const rows = await inspect(false);
  assert.ok(rows.every((row) => row.rejected.length === 1));
});
test('actual launcher runtime preparation admits built hydration without widening CSP', async () => {
  const rows = await inspect(true);
  assert.deepEqual(
    rows.map((row) => row.rejected),
    [[], []],
  );
});
