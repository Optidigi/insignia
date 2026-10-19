import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

test('local preview uses synthetic reads and never forwards commands or production credentials', {
  timeout: 15000,
}, async (t) => {
  const child = spawn(process.execPath, [new URL('./preview.mts', import.meta.url).pathname], {
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://must-not-connect.invalid/production',
      SHOPIFY_CLIENT_SECRET: 'synthetic-poison-selector',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill('SIGTERM');
    await exited;
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  let origin: string | undefined;
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (origin) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(origin, 'built local preview starts without any production connection');
  const products = await fetch(`${origin}/api/admin/products`);
  assert.equal(products.status, 200);
  assert.match(await products.text(), /Cotton crewneck — local sample/);
  assert.equal((await fetch(`${origin}/api/admin/products/111/config`, { method: 'PUT', body: '{}' })).status, 405);
  assert.equal((await fetch(`${origin}/api/webhooks/orders`, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(`${origin}/proxy/v1/config`)).status, 404);
  const page = await fetch(`${origin}/admin/products`);
  const html = await page.text();
  assert.match(html, /\/__preview\/bridge.js/);
  assert.doesNotMatch(html, /synthetic-poison-selector|must-not-connect/);
});
