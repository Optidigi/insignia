import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuyerDraftGroupSchema, BuyerProposalRequestSchema } from '@insignia/contracts';
import { chromium, type FrameLocator, type Page } from 'playwright';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';
import {
  type AjaxItem,
  ajaxBody,
  createStorefrontTestServer as createServer,
  lineCarriers,
  record,
  required,
  selectedFrameAssets,
  serverPort,
} from './support.mts';

/**
 * A first Add to cart that Shopify refuses as sold out, followed by its HTML bot check on the next cart reads
 * (observed natively on 24 November 2026). Within the read retries the buyer is told about stock and can add again.
 * A refused add can still land in part ("Only 50 items were added"), so a cart that stays unreadable leaves the
 * write pending for repair, and the next readable cart without the line settles it.
 */
const config: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '111',
  title: 'Synthetic shirt',
  shopCurrency: 'EUR',
  decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '1000' }],
  revisionId: 'r1',
  contentHash: 'a'.repeat(64),
  methods: [{ id: 'print', label: 'Print' }],
  placements: [
    { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  steps: [{ id: 'small', label: 'Small' }],
  options: [],
  variants: [
    {
      id: '222',
      label: 'Blue / S',
      available: true,
      selectedOptions: [
        { name: 'Color', value: 'Blue' },
        { name: 'Size', value: 'S' },
      ],
      baseUnitMinor: '2000',
    },
  ],
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'photo', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } }],
  },
  imageUrls: { photo: 'https://preview.example/fixture.png' },
  ready: true,
};
/** Shopify's own explanation of the refusal, which the Designer shows in place of its generic stock wording. */
const soldOutCopy = "The product 'Synthetic shirt - S' is already sold out.";
const reviewCopy = 'Your customization needs review';
const botCheck = '<!doctype html><title>Verifying your connection…</title><p>Verifying your connection…</p>';

type Scenario = {
  page: Page;
  ui: FrameLocator;
  addCalls: () => number;
  /** Makes the variant available again and the cart readable. */
  restock: () => void;
  /** Makes the cart readable while the variant stays sold out. */
  unblock: () => void;
  cartItems: () => AjaxItem[];
  mount: () => Promise<void>;
};

/** `landed`: units Shopify adds before refusing the rest, as it does for a quantity above the stock. */
async function withRefusedAdd(
  botChecks: number,
  run: (scenario: Scenario) => Promise<void>,
  { landed = 0 }: { landed?: number } = {},
) {
  const server = await createServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(30_000);
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
    );
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(origin);
    let items: AjaxItem[] = [];
    let soldOut = true;
    let checksLeft = 0;
    let adds = 0;
    let proposals = 0;
    let lastProposal: ReturnType<typeof BuyerProposalRequestSchema.parse> | undefined;
    await page.route('**/cart.js', (route) => {
      if (soldOut && checksLeft !== 0) {
        checksLeft--;
        return route.fulfill({ status: 429, contentType: 'text/html', body: botCheck });
      }
      return route.fulfill({ json: { items, attributes: {}, currency: 'EUR' } });
    });
    await page.route('**/cart/update.js', (route) => {
      const body = ajaxBody(route.request().postDataJSON());
      if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
      return route.fulfill({ json: { items, attributes: {}, currency: 'EUR' } });
    });
    await page.route('**/cart/add.js', (route) => {
      adds++;
      if (soldOut) {
        checksLeft = botChecks;
        const line = required(ajaxBody(route.request().postDataJSON()).items)[0];
        if (landed && line) {
          items = [
            ...items,
            { key: `landed${adds}`, variant_id: line.id, quantity: landed, properties: line.properties },
          ];
          const copy = `Only ${landed} items were added to your cart due to availability.`;
          return route.fulfill({ status: 422, json: { status: 422, message: copy, description: copy } });
        }
        return route.fulfill({
          status: 422,
          json: {
            status: 422,
            message: soldOutCopy,
            description: soldOutCopy,
          },
        });
      }
      const body = ajaxBody(route.request().postDataJSON());
      items = [
        ...items,
        ...required(body.items).map((item, index) => ({
          key: `new${adds}-${index}`,
          variant_id: item.id,
          quantity: item.quantity,
          properties: item.properties,
        })),
      ];
      return route.fulfill({ json: { items } });
    });
    const drafts = new Map<string, { id: string; version: number; value: DesiredGroup }>();
    await page.route('**/apps/insignia/v1/designs/**', (route) => {
      const match = /\/designs\/([a-f0-9-]+)(\/restore)?$/.exec(new URL(route.request().url()).pathname);
      const id = required(required(match)[1]);
      const body = record(route.request().postDataJSON());
      const previous = drafts.get(id);
      if (match?.[2])
        return previous
          ? route.fulfill({
              json: {
                ...previous,
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                compatibility: 'current',
                retained: null,
              },
            })
          : route.fulfill({ status: 404, json: { error: 'Owned draft not found' } });
      if (body.expectedVersion !== (previous?.version ?? 0))
        return route.fulfill({ status: 409, json: { error: 'Draft changed' } });
      const draft = { id, version: (previous?.version ?? 0) + 1, value: BuyerDraftGroupSchema.parse(body.group) };
      drafts.set(id, draft);
      return route.fulfill({ json: draft });
    });
    await page.route('**/apps/insignia/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/designs/')) return route.fallback();
      const body = record(route.request().postData() ? route.request().postDataJSON() : {});
      if (path.endsWith('/config')) return route.fulfill({ json: config });
      if (path.endsWith('/sessions'))
        return route.fulfill({
          json: {
            capability: 'abc.def',
            sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      if (path.endsWith('/quote-proposals')) {
        proposals++;
        const proposal = BuyerProposalRequestSchema.parse(body);
        lastProposal = proposal;
        const quantity = required(proposal.groups[0]).variants.reduce((sum, variant) => sum + variant.quantity, 0);
        return route.fulfill({
          json: {
            proposalId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(proposals).padStart(12, '0')}`,
            hash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            currency: 'EUR',
            exponent: 2,
            customizedQuantity: quantity,
            totalMinor: String(3000 * quantity + 100),
            groups: [
              {
                productId: '111',
                quantity,
                setupMinor: '100',
                customizationUnitMinor: '1000',
                baseTotalMinor: String(2000 * quantity),
                totalMinor: String(3000 * quantity + 100),
              },
            ],
            changedGroups: [],
          },
        });
      }
      if (path.endsWith('/accept')) {
        // Each acceptance signs a fresh set, as the server does.
        const carrier = required(
          lineCarriers([{ variantId: '222', unitMinor: '1000' }], { set: proposals }).carriers[0],
        );
        return route.fulfill({
          json: {
            quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            setId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            validThroughDay: 22000,
            applicationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            buckets: [{ variantId: '222', quantity: 2, properties: { _insignia_line_v3: carrier } }],
            desired: required(lastProposal).groups,
          },
        });
      }
      return route.fulfill({ json: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPLIED' } });
    });
    await page.route('**/cart', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main><h1>Native cart</h1></main>' }),
    );
    const mount = async () => {
      await page.evaluate(() => {
        const host = document.createElement('insignia-buyer');
        host.setAttribute('product-id', '111');
        host.setAttribute('cart-root', '/');
        host.setAttribute('country', 'NL');
        host.setAttribute('market-id', '1');
        document.body.append(host);
      });
      await page.locator('insignia-buyer').getByRole('button', { name: 'Customize this product' }).click();
      await page.frameLocator('iframe').locator('.app').waitFor({ timeout: 30_000 });
    };
    await mount();
    await run({
      page,
      ui: page.frameLocator('iframe'),
      addCalls: () => adds,
      restock: () => {
        soldOut = false;
      },
      unblock: () => {
        checksLeft = 0;
      },
      cartItems: () => items,
      mount,
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function designTwo(ui: FrameLocator) {
  await ui.getByRole('button', { name: 'Add artwork', exact: true }).first().click();
  const card = ui.locator('article.print-card').first();
  const heading = card.locator('.print-card-heading');
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
  await card.locator('.artwork-choice').click();
  await ui.getByRole('button', { name: 'Provide artwork later', exact: true }).click();
}
async function reviewTwo(ui: FrameLocator) {
  await ui.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  await ui.locator('input[inputmode=numeric]:enabled').first().fill('2');
  await ui.getByRole('button', { name: 'Review', exact: true }).last().click();
  await ui.getByText('€61.00', { exact: true }).filter({ visible: true }).first().waitFor();
}
const addToCart = (ui: FrameLocator) =>
  ui.getByRole('button', { name: 'Add to cart', exact: true }).filter({ visible: true }).last();
async function assertStockRefusal(page: Page, ui: FrameLocator) {
  await ui.getByText(soldOutCopy, { exact: true }).filter({ visible: true }).first().waitFor();
  assert.equal(await ui.getByText(reviewCopy).filter({ visible: true }).count(), 0, 'no review of absent items');
  assert.equal(
    await ui.getByRole('button', { name: 'Review removing all customized items' }).count(),
    0,
    'nothing to remove is offered',
  );
  assert.equal(new URL(page.url()).pathname, '/');
}

test('a sold-out add followed by two bot-checked cart reads is a stock refusal; Add again by keyboard', async () => {
  await withRefusedAdd(2, async ({ page, ui, addCalls, restock }) => {
    await designTwo(ui);
    await reviewTwo(ui);
    await addToCart(ui).click();
    await assertStockRefusal(page, ui);
    assert.equal(addCalls(), 1);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem('insignia-cart-intent-v1')),
      'null',
      'no write is left pending in this tab',
    );
    restock();
    // After a refusal the accepted set is dropped: the first Add prepares a fresh review, the next one adds it.
    await addToCart(ui).focus();
    await page.keyboard.press('Enter');
    await ui.getByText('€61.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(addCalls(), 1);
    await addToCart(ui).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/cart', { timeout: 15_000 });
    assert.equal(addCalls(), 2, 'the next Add to cart dispatches the add again');
  });
});

async function assertPendingRepair(page: Page, ui: FrameLocator) {
  await ui.getByText(reviewCopy).filter({ visible: true }).first().waitFor();
  await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).waitFor();
  assert.equal(await ui.getByText(soldOutCopy).filter({ visible: true }).count(), 0, 'never told it was refused');
  const intent = await page.evaluate(() => sessionStorage.getItem('insignia-cart-intent-v1'));
  assert.equal(JSON.parse(intent ?? 'null')?.phase, 'pending', 'the write stays pending for repair');
  assert.equal(new URL(page.url()).pathname, '/');
}

test('a sold-out add whose cart stays bot-checked waits for repair; Retry with a readable empty cart lets Add proceed', async () => {
  await withRefusedAdd(-1, async ({ page, ui, addCalls, restock }) => {
    await designTwo(ui);
    await reviewTwo(ui);
    await addToCart(ui).click();
    await assertPendingRepair(page, ui);
    assert.equal(addCalls(), 1);
    restock();
    // The cart reads back empty: Retry clears the panel and the next Add settles the refusal and adds again.
    await ui.getByRole('button', { name: 'Retry', exact: true }).click();
    await ui.getByText(reviewCopy).filter({ visible: true }).first().waitFor({ state: 'detached' });
    // The unresolved accepted set was dropped: the first Add prepares a fresh review, the next one adds it.
    await addToCart(ui).click();
    await ui.getByText('€61.00', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(addCalls(), 1);
    await addToCart(ui).click();
    await page.waitForURL('**/cart', { timeout: 15_000 });
    assert.equal(addCalls(), 2, 'the next Add to cart dispatches the add again');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('insignia-cart-intent-v1')), 'null');
  });
});

test('a sold-out add whose cart stays bot-checked lets Add proceed after a reload once the cart reads back empty', async () => {
  await withRefusedAdd(-1, async ({ page, ui, addCalls, restock, mount }) => {
    await designTwo(ui);
    await reviewTwo(ui);
    await addToCart(ui).click();
    await assertPendingRepair(page, ui);
    restock();
    await page.reload();
    await mount();
    const resumed = page.frameLocator('iframe');
    const continueButton = resumed.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor();
    await continueButton.focus();
    await page.keyboard.press('Enter');
    await reviewTwo(resumed);
    await addToCart(resumed).click();
    await page.waitForURL('**/cart', { timeout: 15_000 });
    assert.equal(addCalls(), 2, 'after the reload Add to cart dispatches the add again');
  });
});

test('a refused add that landed in part while the cart is bot-checked is repaired, never reported as refused', async () => {
  await withRefusedAdd(
    -1,
    async ({ page, ui, addCalls, unblock, cartItems }) => {
      await designTwo(ui);
      await reviewTwo(ui);
      await addToCart(ui).click();
      await assertPendingRepair(page, ui);
      assert.equal(cartItems()[0]?.quantity, 1, 'one signed unit sits in the cart');
      assert.equal(await ui.getByText('Only 1 items were added').count(), 0);
      // Once the cart can be read, the repair review finds the landed line and removes it.
      unblock();
      await ui.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
      await ui.getByRole('button', { name: 'Confirm cart update', exact: true }).click();
      await page.waitForURL('**/cart', { timeout: 15_000 });
      assert.deepEqual(cartItems(), []);
      assert.equal(addCalls(), 1, 'the refused set is never added again');
    },
    { landed: 1 },
  );
});
