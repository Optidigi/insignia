import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const requireFrom = createRequire(join(root, 'package.json'));
const library = join(root, 'dist-library');
const localizationRequire = createRequire(requireFrom.resolve('@insignia/ui-localization/package.json'));

test('ordinary build produces a source-free embeddable Designer with closed assets and usable public declarations', {
  timeout: 60_000,
}, async () => {
  assert.ok(existsSync(join(library, 'designer.js')), 'Run the ordinary workspace build first');
  assert.deepEqual(readdirSync(library).sort(), ['designer.css', 'designer.js', 'types']);
  const code = readFileSync(join(library, 'designer.js'), 'utf8');
  assert.doesNotMatch(code, /src\/demo|src\/scenarios|product-image-sources\.json|localhost:5173|127\.0\.0\.1:5173/);
  const css = readFileSync(join(library, 'designer.css'), 'utf8');
  assert.match(css, /@font-face/);
  assert.ok(css.length > 1000);
  for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
    const url = match[1]!.replace(/^["']|["']$/g, '');
    assert.ok(url.startsWith('data:'), `Embeddable library resource must be included: ${url}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'insignia-designer-artifact-'));
  try {
    const installed = join(scratch, 'node_modules/@insignia/designer');
    mkdirSync(installed, { recursive: true });
    cpSync(library, join(installed, 'dist-library'), { recursive: true });
    cpSync(join(root, 'package.json'), join(installed, 'package.json'));
    // Only the library's actual external runtime and declaration dependencies; no checkout links or demo entry.
    for (const name of ['preact', 'zod', '@insignia/ui-localization', 'i18next', '@fontsource-variable/inter']) {
      const resolver = name === 'i18next' ? localizationRequire : requireFrom;
      const source = (resolver.resolve.paths(name) ?? [])
        .map((path) => join(path, name))
        .find((path) => existsSync(join(path, 'package.json')));
      assert.ok(source, `Installed dependency missing: ${name}`);
      const realSource = realpathSync(source);
      const destination = join(scratch, 'node_modules', name);
      mkdirSync(dirname(destination), { recursive: true });
      if (name === '@insignia/ui-localization') {
        mkdirSync(destination);
        cpSync(join(realSource, 'package.json'), join(destination, 'package.json'));
        cpSync(join(realSource, 'dist'), join(destination, 'dist'), { recursive: true });
      } else
        cpSync(realSource, destination, {
          recursive: true,
          dereference: true,
          filter: (path) => !relative(realSource, path).split('/').includes('node_modules'),
        });
    }
    writeFileSync(join(scratch, 'package.json'), '{"type":"module"}');
    writeFileSync(
      join(scratch, 'consumer.ts'),
      'import {Designer, configSchema, type DesignerProps, type DesignerPorts} from "@insignia/designer"; const component: (props: DesignerProps) => unknown = Designer; const parse: (value: unknown) => unknown = configSchema.parse; export type Ports = DesignerPorts; export {component, parse};',
    );
    const checked = spawnSync(
      process.execPath,
      [
        requireFrom.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable',
        '--types',
        'preact',
        'consumer.ts',
      ],
      { cwd: scratch, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH } },
    );
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const importMap = {
      imports: {
        preact: '/node_modules/preact/dist/preact.module.js',
        'preact/hooks': '/node_modules/preact/hooks/dist/hooks.module.js',
        'preact/jsx-runtime': '/node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js',
      },
    };
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<script type="importmap">${JSON.stringify(importMap)}</script>`);
        return;
      }
      const file = resolve(scratch, `.${pathname}`);
      if (relative(scratch, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        'Content-Type',
        file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream',
      );
      response.end(readFileSync(file));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    let browser: import('playwright').Browser | undefined;
    try {
      const origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await page.goto(origin);
      const imported = await page.evaluate(async (entry) => {
        const module = await import(entry);
        return [typeof module.Designer, typeof module.configSchema.parse, typeof module.buildShopifyVariantMatrix];
      }, '/node_modules/@insignia/designer/dist-library/designer.js');
      assert.deepEqual(imported, ['function', 'function', 'function']);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
