import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectPolarisPresentation } from './polaris.mts';

test('merchant closure resolves aliases, reexports, dynamic imports and shared factory calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-control-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@ui/*': ['src/*'] }, moduleResolution: 'Bundler', module: 'ESNext' },
      }),
    );
    await writeFile(join(root, 'src/page.astro'), '---\nimport "@ui/barrel";\n---\n<s-page />');
    await writeFile(join(root, 'src/barrel.ts'), 'export * from "./lazy";');
    await writeFile(join(root, 'src/lazy.ts'), 'export const load = () => import("./control");');
    await writeFile(
      join(root, 'src/control.ts'),
      'import {createElement as h} from "preact"; export const view = () => h("button", {}, "Save");',
    );
    const inspect = () =>
      inspectPolarisPresentation({
        root,
        tsconfig: 'tsconfig.json',
        merchantEntries: ['src/page.astro'],
        buyerEntries: [],
      });
    assert.ok((await inspect()).violations.some((v) => v.includes('button')));
    await writeFile(join(root, 'src/control.ts'), 'export const view = () => <custom-button />;');
    assert.ok((await inspect()).violations.some((v) => v.includes('custom-button')));
    await writeFile(join(root, 'src/control.ts'), 'export const view = () => <s-button />;');
    assert.deepEqual((await inspect()).violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('storefront closure rejects merchant runtime imports and pin mismatches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-buyer-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{}');
    await writeFile(join(root, 'buyer.ts'), 'export const load = () => import("@shopify/app-bridge");');
    await writeFile(
      join(root, 'layout.astro'),
      '<script src="https://cdn.shopify.com/shopifycloud/polaris-1.2.js"></script>',
    );
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ devDependencies: { '@shopify/polaris-types': '1.1.0' } }),
    );
    const result = await inspectPolarisPresentation({
      root,
      tsconfig: 'tsconfig.json',
      merchantEntries: ['layout.astro'],
      buyerEntries: ['buyer.ts'],
      versionManifest: 'package.json',
      runtimeLayout: 'layout.astro',
    });
    assert.ok(result.violations.some((v) => v.includes('buyer')));
    assert.ok(result.violations.some((v) => v.includes('runtime')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('only ephemeral Blob download anchors escape presentation controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-download-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{}');
    const valid = `export function download(value: string) {
      const url = URL.createObjectURL(new Blob([value]));
      const link = document.createElement('a');
      link.href = url; link.download = 'export.json';
      document.body.append(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    }`;
    const inspect = () =>
      inspectPolarisPresentation({ root, tsconfig: 'tsconfig.json', merchantEntries: ['view.ts'], buyerEntries: [] });
    await writeFile(join(root, 'view.ts'), valid);
    assert.deepEqual((await inspect()).violations, []);
    await writeFile(
      join(root, 'view.ts'),
      valid.replace('link.click();', 'link.textContent = "Download"; link.click();'),
    );
    assert.ok((await inspect()).violations.some((v) => v.includes(': a')));
    await writeFile(join(root, 'view.ts'), 'export const link = document.createElement("a");');
    assert.ok((await inspect()).violations.some((v) => v.includes(': a')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('App Bridge Save Bar buttons require direct factory ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-save-bar-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{}');
    const inspect = () =>
      inspectPolarisPresentation({ root, tsconfig: 'tsconfig.json', merchantEntries: ['view.ts'], buyerEntries: [] });
    await writeFile(
      join(root, 'view.ts'),
      'import {createElement} from "preact"; export const view = createElement("ui-save-bar", {}, createElement("button", {}, "Save"));',
    );
    assert.deepEqual((await inspect()).violations, []);
    await writeFile(
      join(root, 'view.ts'),
      'import {createElement} from "preact"; export const view = createElement("div", {}, createElement("button", {}, "Save"));',
    );
    assert.ok((await inspect()).violations.some((v) => v.includes('button')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace declaration exports cannot hide authored merchant or buyer presentation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-workspace-'));
  try {
    await mkdir(join(root, 'shared/src'), { recursive: true });
    await mkdir(join(root, 'shared/dist'), { recursive: true });
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@shared': ['shared/dist/index.d.ts'] },
          moduleResolution: 'Bundler',
          module: 'ESNext',
        },
      }),
    );
    await writeFile(
      join(root, 'shared/tsconfig.json'),
      JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' }, include: ['src'] }),
    );
    await writeFile(join(root, 'shared/dist/index.d.ts'), 'export declare const View: unknown;');
    await writeFile(join(root, 'shared/src/index.tsx'), 'export const View = () => <button>Raw</button>;');
    await writeFile(join(root, 'entry.ts'), 'export {View} from "@shared";');
    const merchant = await inspectPolarisPresentation({
      root,
      tsconfig: 'tsconfig.json',
      merchantEntries: ['entry.ts'],
      buyerEntries: [],
    });
    assert(merchant.violations.some((value) => value.includes('button')));
    await writeFile(join(root, 'shared/src/index.tsx'), 'export const View = () => <s-button>Merchant</s-button>;');
    const buyer = await inspectPolarisPresentation({
      root,
      tsconfig: 'tsconfig.json',
      merchantEntries: [],
      buyerEntries: ['entry.ts'],
    });
    assert(buyer.violations.some((value) => value.includes('buyer')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('merchant templates cannot bypass components through raw HTML sinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-html-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{}');
    for (const source of [
      'export const view = () => <div dangerouslySetInnerHTML={{__html: "<button>Save</button>"}} />;',
      'export const view = (element: HTMLElement) => { element.innerHTML = "<button>Save</button>"; };',
      'export const view = (element: HTMLElement) => element.insertAdjacentHTML("beforeend", "<button>Save</button>");',
      'export const view = () => createElement("div", {dangerouslySetInnerHTML: {__html: "<button>Save</button>"}});',
    ]) {
      await writeFile(join(root, 'view.tsx'), source);
      const result = await inspectPolarisPresentation({
        root,
        tsconfig: 'tsconfig.json',
        merchantEntries: ['view.tsx'],
        buyerEntries: [],
      });
      assert(
        result.violations.some((value) => value.includes('raw HTML')),
        source,
      );
    }
    await writeFile(join(root, 'view.astro'), '<div set:html={"<button>Save</button>"} />');
    const astro = await inspectPolarisPresentation({
      root,
      tsconfig: 'tsconfig.json',
      merchantEntries: ['view.astro'],
      buyerEntries: [],
    });
    assert(astro.violations.some((value) => value.includes('raw HTML')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('structural containers cannot become replacement merchant controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'polaris-structural-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{}');
    const inspect = () =>
      inspectPolarisPresentation({
        root,
        tsconfig: 'tsconfig.json',
        merchantEntries: ['view.tsx', 'page.astro'],
        buyerEntries: [],
      });
    await writeFile(join(root, 'page.astro'), '<div role="status"><s-text>Ready</s-text></div>');
    await writeFile(
      join(root, 'view.tsx'),
      'export const view = <div role="status" tabIndex={-1}><s-text>Ready</s-text></div>;',
    );
    assert.deepEqual((await inspect()).violations, []);
    for (const source of [
      'export const view = <div role="button" tabIndex={0} onClick={save}>Save</div>;',
      'export const view = createElement("section", { role: "checkbox", onKeyDown: save }, "Save");',
      'export const view = <div tabIndex={0}>Save</div>;',
      "export const view = <div role={'button'}>Save</div>;",
      'export const view = <div role={controlRole}>Save</div>;',
      'export const view = createElement("div", {role: controlRole}, "Save");',
      'export const view = <div onClick={save}>Save</div>;',
    ]) {
      await writeFile(join(root, 'view.tsx'), source);
      assert.ok(
        (await inspect()).violations.some((v) => v.includes('structural merchant control')),
        source,
      );
    }
    await writeFile(join(root, 'view.tsx'), 'export const view = <s-button onClick={save}>Save</s-button>;');
    await writeFile(join(root, 'page.astro'), '<section role="button" onclick="save()">Save</section>');
    assert.ok((await inspect()).violations.some((v) => v.includes('structural merchant control')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
