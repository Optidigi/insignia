import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from 'vite';
import config from '../vite.config.ts';
import { contentType, serverPort } from './support.mts';

/** Every Designer chunk is slow to arrive, as on a slow mobile connection. */
const CHUNK_DELAY_MS = 600;
const EAGER = new Set(['insignia-storefront.js', 'insignia-element.js']);

test('a cold click fetches the whole Designer open path in parallel instead of as an import chain', {
  timeout: 120_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-open-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    ...config,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { ...config.build, outDir: directory },
  });
  const element = await readFile(join(directory, 'insignia-element.js'), 'utf8');
  const literal = /"(\[(?:\\"insignia-[^\\"]+\\",?)+\])"/.exec(element)?.[1];
  assert.ok(literal, 'the build writes the open-path chunk list into the element');
  const listed = JSON.parse(JSON.parse(`"${literal}"`)) as string[];
  for (const prefix of ['insignia-modal-', 'insignia-buyer-', 'insignia-controller-', 'insignia-frame-host-'])
    assert.ok(
      listed.some((file) => file.startsWith(prefix)),
      `${prefix}* is on the open path`,
    );
  assert.ok(listed.includes('insignia-designer-frame.js'), 'the frame entry is on the open path');
  // The list is closed under static imports, so no chunk is left to a later round trip.
  for (const file of listed) {
    const code = await readFile(join(directory, file), 'utf8');
    for (const [, imported] of code.matchAll(/^import[^;]*?["']\.\/(insignia-[^"']+\.js)["']/gm))
      assert.ok(
        listed.includes(imported ?? '') || imported?.startsWith('insignia-buyer-session-'),
        `${file} imports ${imported}, which is listed`,
      );
  }

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/cdn/')) {
      const name = path.slice('/cdn/'.length);
      try {
        const body = await readFile(join(directory, name));
        if (!EAGER.has(name) && !name.startsWith('insignia-buyer-session-'))
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        response.setHeader('Content-Type', contentType(name));
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html lang="en"><body><insignia-buyer product-id="111" country="US" style="display:contents"><button type="button" slot="trigger" class="button insignia-customise">Customise</button></insignia-buyer><script defer src="/cdn/insignia-storefront.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  // The configuration read is not part of this check; it fails fast and the opening shows its retry state.
  await page.route('**/apps/insignia/**', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  const started = new Map<string, number>();
  const finished = new Map<string, number>();
  const name = (url: string) => new URL(url).pathname.split('/').at(-1) ?? '';
  page.on('request', (request) => {
    if (!started.has(name(request.url()))) started.set(name(request.url()), Date.now());
  });
  page.on('requestfinished', (request) => {
    if (!finished.has(name(request.url()))) finished.set(name(request.url()), Date.now());
  });
  await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt`);
  await page.waitForFunction(() => !!customElements.get('insignia-buyer'));
  assert.deepEqual(
    listed.filter((file) => started.has(file)),
    [],
    'nothing on the open path loads before the click',
  );
  // A programmatic click: no hover or focus intent came first.
  await page.locator('insignia-buyer button').evaluate((button: HTMLButtonElement) => button.click());
  await page.waitForFunction(
    (files) => files.every((file) => document.querySelector(`link[rel=modulepreload][href$="/${file}"]`)),
    listed,
  );
  const deadline = Date.now() + 30_000;
  while (listed.some((file) => !finished.has(file)) && Date.now() < deadline)
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const missing = listed.filter((file) => !finished.has(file));
  assert.deepEqual(missing, [], 'every open-path chunk is fetched');
  const lastStart = Math.max(...listed.map((file) => started.get(file) ?? Number.POSITIVE_INFINITY));
  const firstFinish = Math.min(...listed.map((file) => finished.get(file) ?? 0));
  t.diagnostic(
    `open path: ${listed.length} chunks; last request started ${lastStart - firstFinish}ms relative to the first chunk finishing`,
  );
  assert.ok(
    lastStart < firstFinish,
    `all ${listed.length} open-path chunks start before the first one arrives (${CHUNK_DELAY_MS} ms each)`,
  );
});
