import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PurchaseListViewSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { browserFixture, preferences, routePolaris } from './support/selected-browser.mts';

/** Built Home and storefront-setup pages against synthetic Shopify theme and store reads. */

type Embed = 'active' | 'available' | 'unreadable';
type GuideStep = 'product' | 'storefront' | 'test';

const embedRead = {
  active: [
    {
      type: 'theme_app_extension',
      activations: [
        {
          handle: 'cart-repair',
          target: 'body',
          status: 'active',
          activations: [{ target: 'theme/123', themeId: 'gid://shopify/OnlineStoreTheme/123' }],
        },
      ],
    },
  ],
  available: [
    {
      type: 'theme_app_extension',
      activations: [{ handle: 'cart-repair', target: 'body', status: 'available', activations: [] }],
    },
  ],
  unreadable: null,
} as const;

const product = (state: 'not_configured' | 'draft' | 'published') => ({
  id: 'gid://shopify/Product/111',
  title: 'Organic cotton T-shirt',
  imageUrl: null,
  configurationSummary: { state },
});
const testOrder = {
  version: 'm8-purchase-v1',
  isTest: true,
  purchaseId: 'd841ee12-2075-4101-b3bc-429ad31a4059',
  orderId: 'gid://shopify/Order/1',
  orderName: '#1001',
  orderCreatedAt: '2026-11-13T12:00:00Z',
  currency: 'USD',
  exponent: 2,
  originalTotalMinor: '4500',
  firstPaidAt: null,
  financialStatus: 'PENDING',
  cancelledAt: null,
  exceptions: [],
  canUploadArtwork: true,
  canShareCustomerArtwork: false,
  artworkVersion: 0,
  artworkState: 'PENDING_ARTWORK',
  refunds: [],
  lines: [
    {
      orderLineId: 'line1',
      title: 'Purchased shirt',
      variantTitle: 'Blue / M',
      productId: '111',
      variantId: '11',
      quantity: 2,
      unitPriceMinor: '4500',
    },
  ],
  groups: [],
  artworkEvents: [],
};
const ordersPage = (items: unknown[]) =>
  PurchaseListViewSchema.parse({ version: 'm8-purchase-list-v1', items, nextCursor: null, timeZone: 'UTC' });
const statistics = {
  version: 'purchase-statistics-v1',
  timeZone: 'UTC',
  periodDays: 30,
  observedAt: '2026-11-14T10:00:00Z',
  available: true,
  series: [],
};

async function openMerchantPage(
  t: Parameters<typeof browserFixture>[0],
  path: string,
  scenario: {
    embed: Embed;
    product?: 'not_configured' | 'draft' | 'published';
    acknowledged?: GuideStep[];
    orders?: 'none' | 'test-only';
    locale?: string;
  },
): Promise<Page> {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'Merchant page must not throw unhandled browser errors'));
  await page.addInitScript((read) => {
    window.shopify = {
      config: { shop: 'example.myshopify.com' },
      idToken: async () => 'synthetic-home-guide',
      app: { extensions: async () => read },
    };
  }, embedRead[scenario.embed]);
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/admin/preferences', (route) =>
    route.fulfill({
      json: { ...preferences, guidance: { dismissed: false, completedSteps: scenario.acknowledged ?? [] } },
    }),
  );
  await page.route(/\/api\/admin\/products(\?.*)?$/, (route) =>
    route.fulfill({
      json: { products: [product(scenario.product ?? 'not_configured')], nextCursor: null },
    }),
  );
  await page.route(/\/api\/admin\/billing$/, (route) => route.fulfill({ json: { newActionsAllowed: true } }));
  await page.route(/\/api\/purchases\/v1\/statistics$/, (route) => route.fulfill({ json: statistics }));
  await page.route(/\/api\/purchases\/v1\?/, (route) =>
    route.fulfill({ json: ordersPage(scenario.orders === 'test-only' ? [testOrder] : []) }),
  );
  await page.goto(`${server.base}${path}${scenario.locale ? `?locale=${scenario.locale}` : ''}`);
  return page;
}

const stepCheckbox = (page: Page, label: string) => page.getByRole('checkbox', { name: label });

test('Home guide ticks the theme and published-product steps from the same store state the setup page reports', {
  timeout: 30000,
}, async (t) => {
  const page = await openMerchantPage(t, '/admin/home', { embed: 'active', product: 'published' });
  await page.getByText('2 of 3 complete', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Get started with Insignia' }).count(), 1);
  const test = stepCheckbox(page, 'Mark customer test as complete');
  await test.click({ trial: true }); // waits until the merchant's preferences are loaded and editable
  const product = stepCheckbox(page, 'Mark product setup as incomplete');
  const storefront = stepCheckbox(page, 'Mark storefront connection as incomplete');
  assert.equal(await product.isChecked(), true);
  assert.equal(await storefront.isChecked(), true);
  assert.equal(await product.isDisabled(), true, 'an observed fact is not a manual acknowledgement');
  assert.equal(await storefront.isDisabled(), true);
  assert.equal(await test.isChecked(), false, 'a customer test is only ever acknowledged by the merchant');
  assert.equal(await test.isDisabled(), false);
  assert.equal(await page.getByText('Connect your theme', { exact: true }).count(), 1, 'step title stays listed');
  assert.equal(await page.getByRole('link', { name: 'Open theme setup' }).count(), 0, 'no theme action when connected');
});

test('Home guide leaves the theme step open while the embed is disabled and the product step open until published', {
  timeout: 30000,
}, async (t) => {
  const page = await openMerchantPage(t, '/admin/home', { embed: 'available', product: 'draft' });
  await page.getByText('0 of 3 complete', { exact: true }).waitFor();
  const storefront = stepCheckbox(page, 'Mark storefront connection as complete');
  await storefront.click({ trial: true }); // enabled: the merchant can still acknowledge an open step
  assert.equal(await storefront.isChecked(), false);
  assert.equal(await stepCheckbox(page, 'Mark product setup as complete').isChecked(), false);
});

test('Home guide never ticks the theme step from an unreadable theme check and keeps manual acknowledgements', {
  timeout: 30000,
}, async (t) => {
  const page = await openMerchantPage(t, '/admin/home', {
    embed: 'unreadable',
    product: 'published',
    acknowledged: ['storefront'],
  });
  await page.getByText('2 of 3 complete', { exact: true }).waitFor();
  const storefront = stepCheckbox(page, 'Mark storefront connection as incomplete');
  assert.equal(await storefront.isChecked(), true);
  await storefront.click({ trial: true }); // enabled: a merchant-acknowledged step can be reopened
});

test('Home guide completes when every step is observed or acknowledged', { timeout: 30000 }, async (t) => {
  const page = await openMerchantPage(t, '/admin/home', {
    embed: 'active',
    product: 'published',
    acknowledged: ['test'],
  });
  await page.getByRole('heading', { name: 'Setup guide complete' }).waitFor();
  await page.getByText('3 of 3 complete', { exact: true }).waitFor();
});

test('storefront setup asks for a theme save only while a theme change is still needed', {
  timeout: 30000,
}, async (t) => {
  const save = 'Save theme changes in Shopify.';
  const needed = await openMerchantPage(t, '/admin/settings/storefront', { embed: 'available' });
  await needed.getByText('Not added', { exact: true }).first().waitFor();
  assert.equal(
    await needed.getByText(save, { exact: true }).count(),
    1,
    'adding the embed is saved in the theme editor',
  );

  const done = await openMerchantPage(t, '/admin/settings/storefront', { embed: 'active' });
  await done.getByText('Added', { exact: true }).first().waitFor();
  assert.equal(await done.getByText(save, { exact: true }).count(), 0, 'nothing to save when everything is enabled');

  const unknown = await openMerchantPage(t, '/admin/settings/storefront', { embed: 'unreadable' });
  await unknown.getByText('Theme setup needs a manual check', { exact: true }).waitFor();
  assert.equal(await unknown.getByText(save, { exact: true }).count(), 0, 'no save request from an unverified state');
});

test('Home order tiles say that test and cancelled orders are not counted, in every bundled language', {
  timeout: 60000,
}, async (t) => {
  const expected: Record<string, [string, string]> = {
    en: [
      'Orders containing at least one Insignia design. Test and cancelled orders are not counted.',
      'Total quantity of customized items ordered. Test and cancelled orders are not counted.',
    ],
    nl: [
      'Bestellingen met ten minste één Insignia-ontwerp. Testbestellingen en geannuleerde bestellingen worden niet meegeteld.',
      'Totaal aantal bestelde artikelen met personalisatie. Testbestellingen en geannuleerde bestellingen worden niet meegeteld.',
    ],
    de: [
      'Bestellungen mit mindestens einer Insignia-Gestaltung. Testbestellungen und stornierte Bestellungen werden nicht mitgezählt.',
      'Gesamtzahl der bestellten Artikel mit Produktanpassungen. Testbestellungen und stornierte Bestellungen werden nicht mitgezählt.',
    ],
    fr: [
      'Commandes contenant au moins une personnalisation Insignia. Les commandes de test et les commandes annulées ne sont pas comptées.',
      'Quantité totale d’articles personnalisés commandés. Les commandes de test et les commandes annulées ne sont pas comptées.',
    ],
    es: [
      'Pedidos que contienen al menos un diseño de Insignia. Los pedidos de prueba y los cancelados no se cuentan.',
      'Cantidad total de artículos personalizados pedidos. Los pedidos de prueba y los cancelados no se cuentan.',
    ],
    it: [
      'Ordini che contengono almeno una personalizzazione Insignia. Gli ordini di prova e quelli annullati non sono conteggiati.',
      'Quantità totale di articoli personalizzati ordinati. Gli ordini di prova e quelli annullati non sono conteggiati.',
    ],
  };
  for (const [locale, definitions] of Object.entries(expected)) {
    const page = await openMerchantPage(t, '/admin/home', {
      embed: 'active',
      product: 'published',
      orders: 'test-only',
      locale,
    });
    await page.locator('s-tooltip').first().waitFor({ state: 'attached' });
    const shown = (await page.locator('s-tooltip').allTextContents()).map((text) => text.trim());
    assert.deepEqual(shown.slice(0, 2), definitions, locale);
    await page.close();
  }
});
