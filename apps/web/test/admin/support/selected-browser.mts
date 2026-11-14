import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { after, type TestContext } from 'node:test';
import {
  type MerchantDraft,
  MerchantDraftSchema,
  MerchantPreferencesViewSchema,
  MethodCatalogViewSchema,
  type SelectedProductSetup,
  SelectedProductSetupSchema,
} from '@insignia/contracts';
import { type Browser, chromium, type Page } from 'playwright';
import type { ConfigView } from '../../../src/shared/admin-view.ts';
import './browser-state.mts';

const authority = 'a'.repeat(64);
const methodId = 'cc756ade-f50a-4f5c-94b7-fd320a7a75e6';
const imageUrl = 'https://cdn.shopify.com/synthetic-selected/hoodie-front.jpg';
const polarisUrl = 'https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js';
const polarisSha = '89dd2052b7b8cc6b042900f5c044e1f5754e31bf769d205b6e2399992bdb0c7b';
const artifacts = new URL('../../../../../.m1-artifacts/selected-product-browser/', import.meta.url);
const rect = { centerX: 0.38, centerY: 0.315, width: 0.18, height: 0.15 };
const setup = SelectedProductSetupSchema.parse({
  version: 'selected-product-setup-v1',
  product: {
    id: 'gid://shopify/Product/111',
    title: 'Synthetic selected hoodie',
    images: [{ id: 'product_111', url: imageUrl, width: 1000, height: 1000, alt: 'Synthetic owned hoodie' }],
    methods: [{ id: methodId, name: 'Printing', explanation: 'Full colour', pricing: 'fixed', amount: '3.50' }],
    views: [
      {
        id: 'front',
        name: 'Front',
        imageUrl,
        imageWidth: 1000,
        imageHeight: 1000,
        calibration: {
          imageUrl,
          imageWidth: 1000,
          imageHeight: 1000,
          a: { x: 0, y: 0 },
          b: { x: 0.5, y: 0 },
          distanceCm: 50,
        },
        placements: [
          {
            id: 'chest',
            name: 'Right chest',
            rect,
            widthCm: '18',
            heightCm: '15',
            methodIds: [methodId],
            logoLaterAllowed: true,
            customPlacementAllowed: false,
            sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
          },
        ],
      },
    ],
  },
  methodBindings: {
    [methodId]: {
      catalogMethodId: methodId,
      observedVersion: '1',
      name: { source: 'catalog', value: 'Printing' },
      explanation: { source: 'catalog', value: 'Full colour' },
      translations: {},
      prices: {
        default: { source: 'catalog', value: '3.50' },
        '["chest","small"]': { source: 'catalog', value: '3.50' },
      },
      review: null,
    },
  },
});
const draft = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'required',
  shopCurrency: 'USD',
  methods: [{ id: methodId }],
  placements: [{ id: 'chest', allowedMethodIds: [methodId], allowedStepIds: ['chest:small'], logoLaterAllowed: true }],
  productionOptions: [],
  pricingRules: [
    {
      id: `price:chest:small:${methodId}`,
      scope: { kind: 'step', placementId: 'chest', stepId: 'chest:small', methodId },
      role: 'unit',
      rate: { kind: 'fixed', amount: { shopDecimal: '3.50', presentmentOverrides: [] } },
    },
  ],
  labels: {
    methods: { [methodId]: 'Printing' },
    placements: { chest: 'Right chest' },
    steps: { 'chest:small': 'Small' },
    views: { front: 'Front' },
  },
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'product_111', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'chest', rect }],
      },
    ],
    steps: [{ id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 90, height: 75 } }],
  },
  selectedSetup: setup,
});
const preferences = MerchantPreferencesViewSchema.parse({
  version: 'merchant-preferences-v1',
  authority,
  canEdit: true,
  shop: 'selected-browser.myshopify.com',
  guidanceVersion: '0',
  wordingVersion: '0',
  guidance: { dismissed: false, completedSteps: [] },
  overlays: { en: { locale: 'en', messages: {} } },
});
const catalog = MethodCatalogViewSchema.parse({
  canEdit: true,
  authority,
  currency: 'USD',
  shop: preferences.shop,
  methods: [
    {
      version: '1',
      currency: 'USD',
      configuration: {
        id: methodId,
        name: 'Printing',
        explanation: 'Full colour',
        pricing: 'fixed',
        amount: '3.50',
        assignment: 'manual',
        productIds: ['111'],
        tags: [],
        tagMatch: 'any',
      },
    },
  ],
});
const product: ConfigView['product'] = {
  id: setup.product.id,
  title: setup.product.title,
  status: 'ACTIVE',
  imageUrl,
  variants: [
    {
      id: 'gid://shopify/ProductVariant/11',
      title: 'Navy / M',
      imageUrl,
      selectedOptions: [{ name: 'Size', value: 'M' }],
    },
  ],
  variantsTruncated: false,
  images: setup.product.images,
  tags: [],
  collections: [],
  collectionsTruncated: false,
  methodSetup: [{ methodId, locations: 1, pricedLocations: 1 }],
  configurationSummary: { state: 'draft', methods: ['Printing'], locations: ['Right chest'] },
};
let browser: Browser;
let server: { base: string; child: ChildProcess; exited: Promise<unknown> };
let polaris: Buffer;
let photo: Buffer;

let startup: Promise<void> | undefined;
function ensureBrowser() {
  startup ??= startBrowser();
  return startup;
}
async function startBrowser() {
  polaris = await readFile(
    new URL('../../../../../frontend/admin/examples/fixtures/polaris-2.0-rc.snapshot', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(polaris).digest('hex'),
    polarisSha,
    'The selected browser contract uses pinned Polaris2 code',
  );
  photo = await readFile(
    new URL(
      '../../../../../frontend/admin/examples/admin/support/assets/legacy-catalog/hoodie-front.jpg',
      import.meta.url,
    ),
  );
  await mkdir(artifacts, { recursive: true });
  const child = spawn(process.execPath, [new URL('../../../dist/server/entry.mjs', import.meta.url).pathname], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SHOPIFY_CLIENT_ID: '11111111111111111111111111111111',
      // Private storage is configured, yet the product editor's connect-src must not name it (#434).
      ARTWORK_R2_ENDPOINT: 'https://private-storage.example',
    },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (data) => {
      output = (output + data.toString()).slice(-8192);
    });
  let base: string | undefined;
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base)
      try {
        if ((await fetch(`${base}/live`)).ok) break;
      } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!base || child.exitCode !== null) {
    child.kill('SIGTERM');
    await exited;
    throw new Error(`Built selected app did not start: ${output}`);
  }
  server = { base, child, exited };
  browser = await chromium.launch({ headless: true });
}
after(async () => {
  await browser?.close();
  server?.child.kill('SIGTERM');
  await server?.exited;
});

type Mutation = { method: string; body: string; key: string | null; authority: string | null };
type Scenario = {
  initialDraft?: MerchantDraft;
  absent?: boolean;
  readOnly?: boolean;
  shopifyModal?: boolean;
  deferShopifyModalDismiss?: boolean;
  loseSaveReply?: boolean;
  holdSave?: boolean;
  publicationPending?: boolean;
};
async function fixture(t: TestContext, scenario: Scenario = {}) {
  await ensureBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 696 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  t.after(async () => {
    const name = t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100);
    await page.screenshot({ path: new URL(`${name}.png`, artifacts).pathname });
    await writeFile(new URL(`${name}.txt`, artifacts), await page.locator('body').innerText());
    await writeFile(new URL(`${name}.aria.txt`, artifacts), await page.locator('body').ariaSnapshot());
    await context.close();
  });
  page.setDefaultTimeout(10000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  t.after(() => assert.deepEqual(pageErrors, [], 'Selected route must not throw unhandled browser errors'));
  await page.addInitScript(
    ({ shopifyModal, deferShopifyModalDismiss }) => {
      window.saveBarEvents = [];
      const shopify: Window['shopify'] = {
        idToken: async () => 'synthetic-selected-token',
        saveBar: {
          show: async (id) => {
            window.saveBarEvents.push(['show', id]);
          },
          hide: async (id) => {
            window.saveBarEvents.push(['hide', id]);
          },
        },
      };
      if (shopifyModal) {
        const mounted = new Map<string, { scrim: HTMLElement; onDismiss?: () => void }>();
        const deferredDismissals: (() => void)[] = [];
        let deferNextDismiss = deferShopifyModalDismiss;
        function close(id: string) {
          const modal = mounted.get(id);
          if (!modal) return;
          mounted.delete(id);
          modal.scrim.remove();
          if (deferNextDismiss) {
            deferNextDismiss = false;
            deferredDismissals.push(() => modal.onDismiss?.());
          } else modal.onDismiss?.();
        }
        shopify._internal = {
          modal: {
            async show(id, options) {
              if (id && document.getElementById(id)) {
                if (mounted.has(id)) return;
                const scrim = document.createElement('div');
                scrim.dataset.shopifyHostModalScrim = '';
                document.body.append(scrim);
                mounted.set(id, { scrim, onDismiss: options?.onDismiss });
                return;
              }
              const scrim = document.createElement('div');
              scrim.dataset.shopifyHostModalScrim = '';
              document.body.append(scrim);
            },
            async hide(id) {
              close(id);
            },
          },
        };
        window.dismissShopifyModal = () => {
          const id = [...mounted.keys()].at(-1);
          if (id) close(id);
        };
        window.finishShopifyModalDismiss = () => deferredDismissals.shift()?.();
      } else {
        window.dismissShopifyModal = () => {};
        window.finishShopifyModalDismiss = () => {};
      }
      window.shopify = shopify;
    },
    {
      shopifyModal: scenario.shopifyModal ?? false,
      deferShopifyModalDismiss: scenario.deferShopifyModalDismiss ?? false,
    },
  );
  let currentDraft: MerchantDraft = structuredClone(scenario.initialDraft ?? draft);
  let version = '1';
  let exists = !scenario.absent;
  let state: 'DRAFT' | 'REMOTE_PENDING' | 'ACTIVE' = 'DRAFT';
  let published: SelectedProductSetup | null = null;
  const mutations: Mutation[] = [];
  const reconciliations: Mutation[] = [];
  let lost = false;
  let releaseSave: (() => void) | undefined;
  let announceSave: (() => void) | undefined;
  const saveReceived = new Promise<void>((resolve) => {
    announceSave = resolve;
  });
  function view() {
    return selectedConfigView(currentDraft, version, exists, state, published);
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.href === polarisUrl) return route.fulfill({ body: polaris, contentType: 'text/javascript' });
    if (url.href === imageUrl)
      return route.fulfill({ body: photo, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.href === 'https://cdn.shopify.com/shopifycloud/app-bridge.js')
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    if (url.hostname === 'cdn.shopify.com' && url.pathname.includes('/icons/'))
      return route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>',
        contentType: 'image/svg+xml',
      });
    if (url.hostname === 'cdn.shopify.com' && url.pathname.includes('/experimental/'))
      return route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>',
        contentType: 'image/svg+xml',
      });
    if (url.origin !== server.base) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-selected-token');
    if (url.pathname === '/api/admin/preferences')
      return route.fulfill({ json: { ...preferences, canEdit: !scenario.readOnly } });
    if (url.pathname === '/api/admin/methods') return route.fulfill({ json: catalog });
    if (url.pathname !== '/api/admin/products/111/config')
      return route.fulfill({ status: 404, json: { error: 'No synthetic endpoint' } });
    if (route.request().method() === 'GET') return route.fulfill({ json: view() });
    const mutation: Mutation = {
      method: route.request().method(),
      body: route.request().postData() ?? '',
      key: route.request().headers()['idempotency-key'] ?? null,
      authority: route.request().headers()['x-insignia-setup-authority'] ?? null,
    };
    assert.equal(mutation.authority, authority);
    if (scenario.readOnly) return route.fulfill({ status: 403, json: { error: 'Edit permission required' } });
    const body: unknown = JSON.parse(mutation.body);
    assert.ok(body && typeof body === 'object' && 'action' in body);
    if (body.action === 'reconcile') {
      assert.ok('operationKey' in body && typeof body.operationKey === 'string' && 'stage' in body);
      assert.equal(mutation.key, `${body.operationKey}:reconcile`);
      reconciliations.push(mutation);
      const publicationRecorded = mutations.some(
        (prior) => prior.key === `${body.operationKey}:publish` && JSON.parse(prior.body).action === 'publish',
      );
      return route.fulfill({
        json: { kind: 'resolved', ...(body.stage === 'publish' ? { publicationRecorded } : {}) },
      });
    }
    mutations.push(mutation);
    if (body.action === 'create') {
      exists = true;
      currentDraft = MerchantDraftSchema.parse({
        ...draft,
        methods: [],
        placements: [],
        pricingRules: [],
        labels: undefined,
        selectedSetup: undefined,
        geometry: { version: 'm5-geometry-v1', views: [{ id: 'front', placements: [], variantImages: [] }], steps: [] },
      });
      return route.fulfill({ status: 201, json: { kind: 'created', configId: 'cfg-selected-111' } });
    }
    if (body.action === 'save') {
      assert.ok('draft' in body);
      const next = MerchantDraftSchema.parse(body.draft);
      if (scenario.holdSave)
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
          assert.ok(announceSave);
          announceSave();
        });
      currentDraft = next;
      version = '2';
      if (scenario.loseSaveReply && !lost) {
        lost = true;
        return route.abort('failed');
      }
      return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
    }
    assert.equal(body.action, 'publish');
    state = scenario.publicationPending ? 'REMOTE_PENDING' : 'ACTIVE';
    if (state === 'ACTIVE') published = MerchantDraftSchema.parse(currentDraft).selectedSetup ?? null;
    return route.fulfill({ status: 202, json: { kind: 'accepted', state, revisionId: 'revision-selected-111' } });
  });
  async function open() {
    if (process.env.INSIGNIA_STRESS_BLOCK_VISUALIZER === '1') {
      const directory = new URL('../../../dist/client/_astro/', import.meta.url);
      const modules = [];
      for (const name of await readdir(directory))
        if (name.endsWith('.js') && /as createVisualizer[,}]/.test(await readFile(new URL(name, directory), 'utf8')))
          modules.push(name);
      assert.equal(modules.length, 1, 'Control must block exactly the actual built renderer module');
      await page.route(`**/_astro/${modules[0]}`, (route) => route.abort('failed'));
      t.diagnostic('STRESS_RENDERER_BLOCKED: actual built createVisualizer module');
    }
    await page.goto(`${server.base}/admin/products/111/config?locale=en&view=front&placement=chest`);
    try {
      await page.locator('.placement-editor').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
      if (!scenario.absent) {
        await page.locator('.placement-canvas canvas').first().waitFor({ state: 'visible' });
        await page.locator('.placement-canvas-status.is-ready').waitFor({ state: 'attached' });
      }
    } catch (error) {
      if (process.env.INSIGNIA_STRESS_BLOCK_VISUALIZER === '1')
        console.error(
          'STRESS_RENDERER_OBSERVATION',
          JSON.stringify({
            canvasCount: await page.locator('.placement-canvas canvas').count(),
            rendererReady: await page.locator('.placement-canvas-status.is-ready').count(),
          }),
        );
      await page.screenshot({ path: new URL('bootstrap-failure.png', artifacts).pathname });
      t.diagnostic(`Selected bootstrap body: ${await page.locator('body').innerText()}`);
      throw error;
    }
  }
  return {
    page,
    open,
    mutations,
    reconciliations,
    read: () => currentDraft,
    view,
    base: server.base,
    context,
    saveReceived,
    release: () => {
      assert.ok(releaseSave, 'A save must actually be held');
      releaseSave();
    },
    saved: () => !releaseSave || version === '2',
  };
}
async function editName(page: Page, value: string) {
  await page.getByRole('textbox', { name: /^Placement name/ }).fill(value);
}
async function hostSave(page: Page) {
  await page.locator('ui-save-bar button[variant="primary"]').evaluate((button: HTMLButtonElement) => button.click());
}
async function storedIntent(page: Page) {
  return page.evaluate(() =>
    sessionStorage.getItem(
      'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
    ),
  );
}

function selectedConfigView(
  currentDraft: MerchantDraft = structuredClone(draft),
  version = '1',
  exists = true,
  state: 'DRAFT' | 'REMOTE_PENDING' | 'ACTIVE' = 'DRAFT',
  published: SelectedProductSetup | null = null,
): ConfigView {
  return {
    product,
    config: exists
      ? {
          configId: 'cfg-selected-111',
          installationGeneration: '1',
          draftVersion: version,
          draft: currentDraft,
          currentShopCurrency: 'USD',
          publishedSetup: published,
          publication: {
            state,
            revisionId: state === 'DRAFT' ? null : 'revision-selected-111',
            sourceDraftVersion: state === 'DRAFT' ? null : version,
            requestKey: state === 'DRAFT' ? null : 'm5pub_cfg-selected-111_2_1',
            activeRevisionId: state === 'ACTIVE' ? 'revision-selected-111' : null,
            reason: null,
            requiresAllChannelHold: false,
            functionReadiness: 'ready',
          },
          publishEligibility: { allowed: true, reason: null },
        }
      : null,
  };
}

/** Shared real-artifact harness for selected and still-mounted merchant surfaces. */
async function browserFixture(t: TestContext) {
  await ensureBrowser();
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  t.after(() => context.close());
  return { source: polaris, server, browser: context };
}
async function routePolaris(target: Page | import('playwright').BrowserContext, source: Buffer) {
  await target.route(imageUrl, (route) =>
    route.fulfill({ body: photo, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await target.route('**/api/admin/preferences', (route) => route.fulfill({ json: preferences }));
  await target.route('**/api/admin/methods?view=catalog', (route) => route.fulfill({ json: catalog }));
  await target.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
  for (const pattern of ['https://cdn.shopify.com/**/icons/**', 'https://cdn.shopify.com/**/experimental/**'])
    await target.route(pattern, (route) =>
      route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>',
        contentType: 'image/svg+xml',
      }),
    );
}

export {
  artifacts,
  authority,
  browserFixture,
  catalog,
  draft,
  editName,
  fixture,
  hostSave,
  imageUrl,
  methodId,
  polarisUrl,
  preferences,
  product,
  routePolaris,
  selectedConfigView,
  setup,
  storedIntent,
};
