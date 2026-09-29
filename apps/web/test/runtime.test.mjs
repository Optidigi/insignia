import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('built SSR serves public shell and hydrates local Polaris/Preact interaction', async () => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [new URL('../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }
  });
  const exited = new Promise(resolve => child.once('close', resolve));
  let stderr = '';
  child.on('error', error => { stderr += error.message; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  let browser;
  const base = `http://127.0.0.1:${port}`;
  try {
    let live;
    for (let i = 0; i < 100 && !live && child.exitCode === null; i++) {
      try { live = await fetch(`${base}/live`); } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(live, stderr);
    assert.deepEqual(await live.json(), { status: 'live' });
    const shell = await (await fetch(base)).text();
    assert.match(shell, /Merchant access is not available/);
    assert.doesNotMatch(shell, /shopify-api|access_token|private_key/i);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const interaction = await page.goto(`${base}/local-test/interaction`);
    assert.equal(interaction?.status(), 200);
    await page.locator('s-button').click();
    await page.getByText('Local count: 1').waitFor();
    assert.equal(await page.getByText('Local count: 1').count(), 1);
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
    await exited;
  }
});
