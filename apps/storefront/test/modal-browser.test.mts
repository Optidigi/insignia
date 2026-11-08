import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

for (const engine of [chromium, firefox])
  test(`${engine.name()}: selected loading styles contain focus and restore the host`, async (t) => {
    const output = await build({
      stdin: {
        contents: `import {createDesignerModal} from './src/designer/modal'; window.openModal=()=>{window.modal=createDesignerModal({locale:'en',onCancel(){window.cancelled=true;window.modal.destroy();}});};`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      format: 'iife',
    });
    const script = output.outputFiles[0];
    assert(script);
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html');
      response.end(
        request.url === '/entry.js'
          ? script.text
          : '<style>body{font-family:serif}</style><button id="trigger" onclick="openModal()">Customize</button><button id="underneath">Underlying theme</button><script src="/entry.js"></script>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await engine.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    await page.getByRole('status').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
    assert.equal(await page.locator('dialog:modal').count(), 1);
    const close = page.getByRole('button', { name: 'Close customizer', exact: true });
    assert.deepEqual(
      await close.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          radius: style.borderRadius,
          fontSize: style.fontSize,
          height: style.minHeight,
          background: style.backgroundColor,
        };
      }),
      { radius: '8px', fontSize: '14px', height: '44px', background: 'rgb(255, 255, 255)' },
    );
    assert.equal(await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily), 'serif');
    await page.evaluate(() => document.getElementById('underneath')?.focus());
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'underneath');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog:modal').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'trigger');
    await page.evaluate(() => localStorage.setItem('insignia-theme', 'dark'));
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Close customizer', exact: true })
        .evaluate((button) => getComputedStyle(button).backgroundColor),
      'rgb(33, 33, 33)',
    );
    await page.keyboard.press('Escape');
  });

declare global {
  interface Window {
    openModal(): void;
    modal: { destroy(): void };
    cancelled?: boolean;
  }
}

for (const engine of [chromium, firefox])
  test(`${engine.name()}: selected controls preserve original demo selectors and cascade`, async (t) => {
    const baseline = execFileSync('git', ['show', 'd490e4d:frontend/designer/src/style.css'], { encoding: 'utf8' });
    const styles = await readFile(new URL('../../../frontend/designer/src/style.css', import.meta.url), 'utf8');
    const primitives = await readFile(
      new URL('../../../frontend/designer/src/primitives.css', import.meta.url),
      'utf8',
    );
    const theme = await readFile(new URL('../../../frontend/designer/src/theme.css', import.meta.url), 'utf8');
    const sheets: Record<string, string> = {
      '/baseline.css': baseline,
      '/baseline-host.css': execFileSync('git', ['show', 'd490e4d:frontend/designer/src/storefront-host-preview.css'], {
        encoding: 'utf8',
      }),
      '/design-switch.css': await readFile(
        new URL('../../../frontend/designer/src/design-switch.css', import.meta.url),
        'utf8',
      ),
      '/style.css': styles,
      '/primitives.css': primitives,
      '/theme.css': theme,
    };
    const server = createServer((request, response) => {
      const path = request.url ?? '/';
      if (sheets[path]) {
        response.setHeader('Content-Type', 'text/css');
        response.end(sheets[path]);
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="${path === '/before' ? '/baseline.css' : '/style.css'}"><style>button{transition:none!important}</style><button id="normal" class="primary-button">Continue</button><section class="empty-state"><button id="empty" class="primary-button">Add artwork</button></section><footer class="panel-footer"><button id="cart" class="primary-button cart-button">Add to cart</button></footer><link rel="stylesheet" href="${path === '/before' ? '/baseline-host.css' : '/design-switch.css'}"><main class="${path === '/before' ? 'storefront-host-preview' : ''}"><dialog class="host-preview-switch" open><h2 id="switch-title">Discard changes?</h2><p id="switch-help">Items already in your cart will not change.</p></dialog></main>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await engine.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const readControls = () =>
      page.evaluate(() =>
        Object.fromEntries(
          ['normal', 'empty', 'cart', 'switch-title', 'switch-help'].map((id) => {
            const node = document.getElementById(id);
            if (!node) throw Error('Missing selected control');
            const style = getComputedStyle(node);
            return [
              id,
              {
                background: style.backgroundColor,
                radius: style.borderRadius,
                weight: style.fontWeight,
                size: style.fontSize,
                height: style.minHeight,
                display: style.display,
                wrap: style.overflowWrap,
                padding: style.padding,
                lineHeight: style.lineHeight,
                color: style.color,
                margin: style.margin,
              },
            ];
          }),
        ),
      );
    await page.goto(`http://127.0.0.1:${serverPort(server)}/before`);
    await page.mouse.move(1279, 719);
    const original = await readControls();
    const hovered: Record<string, unknown> = {};
    for (const id of ['normal', 'empty', 'cart']) {
      await page.locator(`#${id}`).hover({ position: { x: 12, y: 12 } });
      hovered[id] = await page.locator(`#${id}`).evaluate(async (node) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return getComputedStyle(node).getPropertyValue('background-color');
      });
    }

    assert.equal(original['cart']?.background, 'rgb(40, 116, 88)');
    assert.equal(original['normal']?.radius, '8px');
    assert.equal(original['empty']?.radius, '9px');
    await page.goto(`http://127.0.0.1:${serverPort(server)}/after`);
    await page.mouse.move(1279, 719);
    assert.deepEqual(await readControls(), original);
    for (const id of ['normal', 'empty', 'cart']) {
      await page.locator(`#${id}`).hover({ position: { x: 12, y: 12 } });
      assert.equal(
        await page.locator(`#${id}`).evaluate((node) => getComputedStyle(node).backgroundColor),
        hovered[id],
      );
    }
  });
