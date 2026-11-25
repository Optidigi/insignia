import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from 'vite';
import config from '../vite.config.ts';
import { serverPort } from './support.mts';

test('a server-rendered Customise button gets the unavailable notice when the theme entry cannot load', {
  timeout: 120_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-load-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    ...config,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { ...config.build, outDir: directory },
  });
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/cdn/insignia-storefront.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(join(directory, 'insignia-storefront.js')));
      return;
    }
    if (path.startsWith('/cdn/')) {
      // The element entry (and everything else) is unavailable, e.g. a CDN outage.
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html lang="en"><body><form action="/cart/add"><insignia-buyer product-id="111" style="display:contents"><button type="button" slot="trigger" class="button insignia-customise">Customise</button></insignia-buyer></form><script defer src="/cdn/insignia-storefront.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() =>
    window.addEventListener('insignia-load-error', () => Reflect.set(window, '__loadError', true), { once: true }),
  );
  await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt`);
  await page.waitForFunction(() => Reflect.get(window, '__loadError') === true);
  const notice = page.getByRole('alert');
  await notice.waitFor();
  assert.equal(await notice.textContent(), 'Customization unavailable');
  assert.equal(
    await notice.evaluate((element) => element.parentElement?.localName),
    'insignia-buyer',
    'the notice sits with its trigger',
  );
  assert.equal(await page.getByRole('alert').count(), 1, 'one notice per trigger');
});
