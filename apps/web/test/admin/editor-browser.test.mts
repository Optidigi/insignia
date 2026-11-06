import assert from 'node:assert/strict';
import { test } from 'node:test';
import { required } from './support/fixtures.mts';
import {
  browserFixture,
  polarisUrl,
  preferences,
  routePolaris,
  selectedConfigView,
} from './support/selected-browser.mts';

const id = 'gid://shopify/Product/111';
const variant = 'gid://shopify/ProductVariant/11';

test('every merchant route declares the same native Shopify sidebar before private data loads', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-sidebar-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: { error: 'forbidden' } }));
  for (const path of [
    '/admin/products',
    '/admin/products/111/config',
    '/admin/orders',
    '/admin/orders/d841ee12-2075-4101-b3bc-429ad31a4059',
    '/admin/settings/billing',
    '/admin/settings/privacy',
    '/admin/settings',
  ]) {
    const response = await page.goto(server.base + path);
    assert.equal(required(response).status(), 200);
    assert.equal(required(response).headers()['cache-control'], 'private, no-store');
    const navigation = page.locator('body > s-app-nav');
    assert.equal(await navigation.count(), 1, 'Shopify receives one app-level navigation declaration');
    assert.equal(await navigation.locator('s-link[rel="home"]').getAttribute('href'), '/admin/home');
    for (const [label, destination] of [
      ['Products', '/admin/products'],
      ['Orders', '/admin/orders'],
      ['Methods', '/admin/methods'],
      ['Settings', '/admin/settings'],
    ]) {
      assert.equal(
        await navigation
          .locator('s-link:not([rel="home"])')
          .filter({ hasText: new RegExp(`^${label}$`) })
          .getAttribute('href'),
        destination,
      );
    }
    assert.equal(
      await navigation.locator('s-link').count(),
      5,
      'Settings destinations stay outside the primary sidebar',
    );
    assert.equal(await page.locator('s-page .admin-navigation').count(), 0, 'No duplicate iframe navigation');
  }
});

test('merchant product screens expose no technical signing setup or setup requests', { timeout: 20000 }, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-signing-status' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products: [], nextCursor: null } }));
  const signingRequests: string[] = [];
  await page.route('**/api/admin/signing', (route) => {
    signingRequests.push(route.request().method());
    return route.fulfill({ status: 503 });
  });
  await page.goto(`${server.base}/admin/products`);
  await page.getByText('No products yet', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Check signing setup', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Set up signing', exact: true }).count(), 0);
  assert.deepEqual([...signingRequests], []);
});

test('built picker refreshes once on 401; second 401, 403 and 503 stop without another request', {
  timeout: 60000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const statuses of [[401, 200], [401, 401], [403], [503]]) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.syntheticTokenCount = 0;
      window.shopify = { idToken: async () => `synthetic-refresh-${++window.syntheticTokenCount}` };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let active = false;
    const tokens: string[] = [];
    await page.route('**/api/admin/products?*', (route) => {
      const request = route.request();
      assert.equal(request.method(), 'GET');
      assert.equal(request.headers().cookie, undefined);
      const status = active ? statuses[tokens.length] : 200;
      if (active) tokens.push(required(request.headers().authorization));
      assert.ok(status, 'no third retry request is allowed');
      return route.fulfill({
        status,
        headers: status === 401 ? { 'X-Shopify-Retry-Invalid-Session-Request': '1' } : {},
        json:
          status === 200 ? { products: [], nextCursor: null } : { error: `Synthetic authentication stopped ${status}` },
      });
    });
    await page.goto(`${server.base}/admin/products`);
    await page.getByText('No products yet').waitFor();
    await page.evaluate(() => {
      window.syntheticTokenCount = 0;
    });
    active = true;
    await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('Refresh');
    const finalStatus = statuses.at(-1);
    await page
      .getByText(
        finalStatus === 200
          ? 'No products found'
          : finalStatus === 503
            ? 'Products are unavailable. Try again.'
            : 'Your access could not be verified. Try again to reconnect with Shopify Admin.',
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.evaluate(() => window.syntheticTokenCount), statuses.length);
    assert.deepEqual(
      tokens,
      statuses.map((_, index) => `Bearer synthetic-refresh-${index + 1}`),
    );
    await page.close();
  }
});

test('readiness permissions require an explicit gesture and refresh server identity after one exact read-scope grant', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  assert.equal(
    (await fetch(`${server.base}/api/admin/readiness`)).status,
    503,
    'Real readiness route fails closed without runtime services',
  );
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    let granted = ['write_products', 'read_publications'];
    window.scopeQueries = 0;
    window.scopeRequests = [];
    window.syntheticTokenCount = 0;
    window.shopify = {
      idToken: async () => `synthetic-ready-${++window.syntheticTokenCount}`,
      scopes: {
        query: async () => {
          window.scopeQueries++;
          return { granted, required: [], optional: ['read_cart_transforms', 'read_validations'] };
        },
        request: async (scopes) => {
          window.scopeRequests.push(scopes);
          granted = [...granted, ...scopes];
          return { result: 'granted-all', detail: { granted, required: [], optional: scopes } };
        },
      },
    };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  const tokens: string[] = [];
  await page.route('**/api/admin/readiness', (route) => {
    tokens.push(required(route.request().headers().authorization));
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().cookie, undefined);
    return route.fulfill({ json: { version: 'm5-admin-technical-readiness-v1', canRead: true, canEdit: true } });
  });
  await page.goto(`${server.base}/admin/settings/permissions`);
  await page.getByRole('button', { name: 'Check access', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.scopeQueries), 0);
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), []);
  assert.deepEqual(tokens, []);
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await page.getByRole('button', { name: 'Allow setup checks', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.scopeQueries), 1);
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), []);
  const previous = await page.evaluate(() => window.syntheticTokenCount);
  await page.getByRole('button', { name: 'Allow setup checks', exact: true }).click();
  await page.getByText('Product access and checkout setup permissions checked.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), [['read_cart_transforms', 'read_validations']]);
  assert.equal(
    await page.evaluate(() => window.scopeQueries),
    2,
    'Provider grants are reread after consent, not inferred from the result',
  );
  assert.deepEqual(tokens, [`Bearer synthetic-ready-${previous + 1}`]);
  await page.getByText('You can edit product configurations.', { exact: true }).waitFor();
});

test('readiness permission decline, failure and existing grants never broaden or automatically retry the permission request', {
  timeout: 30000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const scenario of [
    {
      granted: ['read_validations'],
      result: 'declined-all',
      requests: [['read_cart_transforms']],
      status: 'Checkout setup access was declined. Check access again to verify current permissions.',
      reads: 0,
    },
    {
      granted: [],
      result: 'throw',
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'The permission request result is unknown. Check access to verify current permissions.',
      reads: 0,
    },
    {
      granted: ['read_cart_transforms', 'read_validations'],
      requests: [],
      status: 'Product access and checkout setup permissions checked.',
      reads: 1,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 403,
      requests: [['read_cart_transforms', 'read_validations']],
      denied: true,
      status: 'Product access unavailable',
      reads: 1,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 401,
      requests: [['read_cart_transforms', 'read_validations']],
      denied: true,
      status: 'Shopify session unavailable',
      reads: 2,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 503,
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'The permission request result is unknown. Check access to verify current permissions.',
      reads: 1,
    },
    {
      granted: [],
      optional: ['read_cart_transforms'],
      requests: [],
      status: 'Access could not be checked. Try again.',
      reads: 0,
    },
  ]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.addInitScript((scenario) => {
      let granted = ['write_products', 'read_publications', ...scenario.granted];
      window.scopeRequests = [];
      window.syntheticTokenCount = 0;
      window.shopify = {
        idToken: async () => `synthetic-ready-${++window.syntheticTokenCount}`,
        scopes: {
          query: async () => ({
            granted,
            required: [],
            optional: scenario.optional ?? ['read_cart_transforms', 'read_validations'],
          }),
          request: async (scopes) => {
            window.scopeRequests.push(scopes);
            if (scenario.result === 'throw') throw new Error('Synthetic provider failure');
            if (scenario.result === 'granted-all') granted = [...granted, ...scopes];
            return { result: scenario.result, detail: { granted, required: [], optional: scopes } };
          },
        },
      };
    }, scenario);
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    const tokens: string[] = [];
    await page.route('**/api/admin/readiness', (route) => {
      tokens.push(required(route.request().headers().authorization));
      assert.equal(route.request().method(), 'GET');
      assert.equal(route.request().headers().cookie, undefined);
      return route.fulfill({
        status: scenario.serverStatus ?? 200,
        headers: scenario.serverStatus === 401 ? { 'X-Shopify-Retry-Invalid-Session-Request': '1' } : {},
        json: scenario.serverStatus
          ? { error: 'Synthetic current authorization refused' }
          : { version: 'm5-admin-technical-readiness-v1', canRead: true, canEdit: true },
      });
    });
    await page.goto(`${server.base}/admin/settings/permissions`);
    await page.getByRole('button', { name: 'Check access', exact: true }).waitFor();
    assert.deepEqual(tokens, [], 'No readiness request on page boot');
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    if (scenario.requests.length) await page.getByRole('button', { name: 'Allow setup checks', exact: true }).click();
    if (scenario.denied) await page.locator(`s-banner[heading="${scenario.status}"]`).waitFor();
    else await page.getByText(scenario.status, { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.scopeRequests), scenario.requests);
    assert.equal(tokens.length, scenario.reads);
    assert.equal(new Set(tokens).size, scenario.reads, 'Each server attempt gets a fresh ID token');
    assert.equal(await page.getByText('Synthetic private catalog', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Check signing setup', exact: true }).count(), 0);
    if (scenario.denied) {
      assert.equal(await page.getByText('You can edit product configurations.', { exact: true }).count(), 0);
      assert.equal(
        await page.getByRole('button', { name: 'Check access', exact: true }).count(),
        scenario.serverStatus === 401 ? 0 : 1,
        'An expired session stops checks; denied product access retains only explicit access recheck',
      );
    } else if (scenario.requests.length) {
      await page.getByRole('button', { name: 'Check access', exact: true }).click();
      await page
        .getByText(
          scenario.serverStatus
            ? 'Access could not be checked. Try again.'
            : 'Allow read-only checkout setup checks before product access can be checked.',
          { exact: true },
        )
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() => window.scopeRequests),
        scenario.requests,
        'An explicit check only observes; it cannot repeat consent',
      );
    }
    await page.close();
  }
});

test('both admin pages admit the pinned Polaris CDN font without broadening other CSP sources', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const path of ['/admin/products', '/admin/products/111/config']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-font-token' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let fontRequests = 0;
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => {
      fontRequests++;
      return route.fulfill({
        body: '',
        contentType: new URL(route.request().url()).pathname.endsWith('.css') ? 'text/css' : 'font/woff2',
      });
    });
    await page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products: [], nextCursor: null } }));
    await page.route('**/api/admin/products/111/config', (route) => route.fulfill({ json: selectedConfigView() }));
    const document = await page.goto(server.base + path);
    const appBridge = page.locator('script').first();
    assert.equal(await appBridge.getAttribute('src'), 'https://cdn.shopify.com/shopifycloud/app-bridge.js');
    for (const forbidden of ['defer', 'async', 'type']) {
      assert.equal(await appBridge.getAttribute(forbidden), null, `App Bridge forbids ${forbidden}`);
    }
    const directives: Record<string, string[]> = Object.fromEntries(
      required(required(document).headers()['content-security-policy'])
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...values]) => [name, values]),
    );
    assert.deepEqual(directives['font-src'], ['https://cdn.shopify.com']);
    assert.deepEqual(directives['connect-src'], [
      "'self'",
      'https://cdn.shopify.com/shopifycloud/admin-ui-foundations/icons/',
      'https://cdn.shopify.com/shopifycloud/admin-ui-foundations/experimental/',
    ]);
    assert.deepEqual(directives['frame-ancestors'], ['https://admin.shopify.com', 'https://*.myshopify.com']);
    assert.ok(!required(directives['script-src']).some((value) => value.includes('cloudflare')));
    assert.ok(!required(directives['script-src']).includes("'unsafe-inline'"));
    assert.ok(
      await page.locator('script[src^="/_astro/"]').count(),
      'compiled navigation bootstrap stays external under CSP',
    );
    if (path.endsWith('/config')) await page.locator('.placement-editor').waitFor();
    else await page.getByText('No products yet', { exact: true }).waitFor();
    await page.evaluate(() => {
      const _required = <T,>(value: T | null | undefined): T => {
        if (value === null || value === undefined) throw new Error('Required browser fixture value missing');
        return value;
      };
      return globalThis.document.fonts.ready;
    });
    assert.ok(fontRequests > 0, 'Polaris font request reaches the CDN boundary instead of being blocked by CSP');
    await page.close();
  }
});

test('product search uses the responsive Polaris table with actionable rows and no technical IDs', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-picker-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const queries: (string | undefined)[] = [];
  await page.route('**/api/admin/products?*', (route) => {
    const request = route.request();
    assert.equal(request.method(), 'GET');
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().authorization, 'Bearer synthetic-picker-token');
    const query = new URL(request.url()).searchParams.get('q');
    queries.push(query ?? '');
    return route.fulfill({
      json: {
        products:
          query === 'absent'
            ? []
            : [
                {
                  id,
                  title: 'Historical archived shirt with a long catalog title',
                  status: 'ARCHIVED',
                  imageUrl: null,
                  tags: [],
                  collections: [],
                  collectionsTruncated: false,
                  methodSetup: [],
                  configurationSummary: { state: 'not_configured', methods: [], locations: [] },
                  variants: [{ id: variant, title: 'Blue / Large' }],
                },
              ],
        nextCursor: null,
      },
    });
  });
  await page.goto(`${server.base}/admin/products`);
  await page.getByRole('link', { name: 'Historical archived shirt with a long catalog title' }).waitFor();
  const navigation = page.locator('s-app-nav');
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Products$/ })
      .getAttribute('href'),
    '/admin/products',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Orders$/ })
      .getAttribute('href'),
    '/admin/orders',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Settings$/ })
      .getAttribute('href'),
    '/admin/settings',
  );
  const search = page.getByRole('searchbox', { name: 'Search products', exact: true });
  assert.ok(await search.isVisible());
  await search.focus();
  assert.ok(await search.evaluate((element) => element.matches(':focus')));
  const card = page.locator('#admin-route-content tbody tr');
  assert.equal(await page.getByRole('table', { name: 'Products', exact: true }).count(), 1);
  await card.getByText('Not configured', { exact: true }).waitFor();
  assert.equal((await card.locator('s-number').innerText()).trim(), '1');
  assert.equal(await page.getByText(/gid:\/\/shopify\//).count(), 0);
  assert.equal(
    await card
      .getByRole('link', { name: 'Historical archived shirt with a long catalog title', exact: true })
      .getAttribute('href'),
    '/admin/products/111/config',
  );
  const searched = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/products' &&
      new URL(response.url()).searchParams.get('q') === 'archived & blue',
  );
  await search.fill('archived & blue');
  assert.equal((await searched).status(), 200);
  await page.getByRole('link', { name: 'Historical archived shirt with a long catalog title' }).waitFor();
  assert.deepEqual(queries, ['', 'archived & blue'], 'Typing does not introduce extra requests');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (process.env.M5_CAPTURE_BROWSER === '1')
      await page.screenshot({ path: `/tmp/m5-admin-picker-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Picker must fit a ${width}px viewport`,
    );

    const configure = card.getByRole('link', {
      name: 'Historical archived shirt with a long catalog title',
      exact: true,
    });
    await configure.scrollIntoViewIfNeeded();
    assert.ok(await configure.isVisible());
    const actionBox = await configure.boundingBox();
    assert.ok(actionBox && actionBox.x >= 0 && actionBox.x + actionBox.width <= width);
  }
  await search.fill('absent');
  await page.getByText('No products found', { exact: true }).waitFor();
  assert.equal(await page.locator('#admin-route-content tbody tr').count(), 0);
  assert.deepEqual(queries, ['', 'archived & blue', 'absent']);
});

test('settings owns billing and privacy and storefront guidance opens exact unsaved Shopify theme links', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const section of ['billing', 'privacy']) {
    const response = await fetch(`${server.base}/admin/${section}?host=synthetic`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/admin/settings/${section}?host=synthetic`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const host = Buffer.from('admin.shopify.com/store/synthetic').toString('base64');
  const context = new URLSearchParams({
    host,
    shop: 'synthetic.myshopify.com',
    embedded: '1',
    locale: 'nl',
    id_token: 'synthetic-must-not-forward',
    apiKey: 'synthetic-must-not-forward',
  });
  const alias = await fetch(`${server.base}/admin/settings/methods?${context}`, { redirect: 'manual' });
  assert.equal(alias.status, 302);
  const canonical = new URL(required(alias.headers.get('location')), server.base);
  assert.equal(canonical.pathname, '/admin/methods');
  assert.deepEqual(Object.fromEntries(canonical.searchParams), {
    host,
    shop: 'synthetic.myshopify.com',
    embedded: '1',
    locale: 'nl',
  });
  assert.equal(alias.headers.get('cache-control'), 'private, no-store');
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.themeExtensionReads = 0;
    window.shopify = {
      config: { shop: 'example.myshopify.com' },
      idToken: async () => 'synthetic-theme-guidance',
      app: {
        extensions: async () => {
          window.themeExtensionReads++;
          return [
            {
              type: 'theme_app_extension',
              activations: [
                { handle: 'customize', target: 'section', status: 'available', activations: [] },
                { handle: 'cart-repair', target: 'body', status: 'available', activations: [] },
              ],
            },
          ];
        },
      },
    };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const requests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.method());
  });
  await page.goto(`${server.base}/admin/settings/storefront`);
  const button = page.getByRole('link', { name: 'Add to theme: customization button', exact: true });
  await button.waitFor();
  assert.equal(
    await page.locator('s-page > s-link[slot="breadcrumb-actions"]').getAttribute('href'),
    '/admin/settings',
  );
  assert.equal(
    await page.getByRole('navigation', { name: 'Settings sections' }).count(),
    0,
    'subpages retain one host breadcrumb rather than repeating settings navigation',
  );
  const link = new URL(required(await button.getAttribute('href')));
  assert.equal(link.origin, 'https://example.myshopify.com');
  assert.equal(link.pathname, '/admin/themes/current/editor');
  assert.deepEqual(Object.fromEntries(link.searchParams), {
    template: 'product',
    addAppBlockId: '11111111111111111111111111111111/customize',
    target: 'mainSection',
  });
  const repair = new URL(
    required(
      await page.getByRole('link', { name: 'Enable in Shopify: cart review', exact: true }).getAttribute('href'),
    ),
  );
  assert.deepEqual(Object.fromEntries(repair.searchParams), {
    context: 'apps',
    template: 'product',
    activateAppId: '11111111111111111111111111111111/cart-repair',
  });
  assert.deepEqual([...requests], [], 'Theme setup performs no API mutation');
  assert.equal(
    await page.evaluate(() => window.themeExtensionReads),
    1,
    'One read-only published-extension observation selects the correct unsaved editor links',
  );
});

test('every merchant route paints silent placeholders before Polaris and hydration, including static Settings', {
  timeout: 30000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-route-shell' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  await page.route(polarisUrl, async (r) => {
    await pending;
    return r.fulfill({ body: source, contentType: 'text/javascript' });
  });
  await page.route('**/api/**', (r) => r.fulfill({ status: 403, json: { error: 'Reopen from Shopify Admin' } }));
  for (const path of [
    '/admin/products',
    '/admin/orders',
    '/admin/settings',
    '/admin/settings/methods',
    '/admin/settings/storefront',
    '/admin/settings/billing',
    '/admin/settings/privacy',
    '/admin/products/111/config',
  ]) {
    pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await page.goto(server.base + path, { waitUntil: 'commit' });
      const skeleton = page.locator('#admin-route-skeleton [data-skeleton-container]');
      await skeleton.waitFor();
      assert.ok(required(await skeleton.boundingBox()).height > 200, path);
      assert.equal((await skeleton.innerText()).trim(), '', 'placeholders have no visible loading copy');
      assert.equal(await page.locator('s-app-nav').isVisible(), false, 'never flash raw sidebar links');
      required(release)();
      await skeleton.waitFor({ state: 'hidden', timeout: 10000 });
      assert.equal(await page.locator('s-page').last().isVisible(), true, path);
      assert.equal(await page.locator('s-page').count(), 1, 'Only the live view owns a Page instance');
    } finally {
      required(release)();
    }
  }
});

test('internal merchant navigation shows silent placeholders until destination data settles', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-transition' };
  });
  await routePolaris(page, source);
  await page.route('**/api/admin/preferences', (route) =>
    route.fulfill({ json: { ...preferences, canEdit: false, canReadPrivacy: true } }),
  );
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/purchases/v1/privacy', async (r) => {
    await pending;
    return r.fulfill({ json: { items: [] } });
  });
  try {
    await page.goto(`${server.base}/admin/settings`);
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    const shell = page.locator('#admin-route-skeleton [data-skeleton-container]');
    await shell.waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin/settings/privacy');
    assert.equal((await shell.innerText()).trim(), '');
    assert.equal(await page.getByRole('button', { name: 'Refresh requests', exact: true }).isVisible(), false);
    required(release)();
    await page.getByText('No data requests are currently available.', { exact: true }).waitFor({ timeout: 8000 });
    await shell.waitFor({ state: 'hidden' });
  } finally {
    required(release)();
  }
});

test('cancelled merchant navigation keeps the current page usable without a stuck skeleton', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(1800);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-cancel' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await page.goto(`${server.base}/admin/settings`);
  await page.getByRole('link', { name: 'Billing', exact: true }).waitFor();
  await page
    .locator('s-clickable[href="/admin/settings/billing"]')
    .evaluate((node) => node.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  await page.getByRole('link', { name: 'Billing', exact: true }).click();
  await page.getByRole('link', { name: 'Billing', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin/settings');
  assert.equal(await page.locator('#admin-route-skeleton [data-skeleton-container]').isVisible(), false);
});

test('late authenticated read replaces the bootstrap timeout notice with the settled page', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.clock.install();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-late-read' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let hydrate: (() => void) | undefined;
  const hydration = new Promise<void>((resolve) => {
    hydrate = resolve;
  });
  let signalComponent: (() => void) | undefined;
  const componentRequested = new Promise<void>((resolve) => {
    signalComponent = resolve;
  });
  await page.route('**/_astro/MerchantPrivacy.*.js', async (route) => {
    required(signalComponent)();
    await hydration;
    await route.continue();
  });
  let signalRead: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/purchases/v1/privacy', async (r) => {
    required(signalRead)();
    await pending;
    return r.fulfill({ json: { items: [] } });
  });
  try {
    await page.goto(`${server.base}/admin/settings/privacy`, { waitUntil: 'domcontentloaded' });
    await componentRequested;
    await page.locator('#admin-route-skeleton [data-skeleton-container]').waitFor();
    // Delay hydration first; the authenticated read remains inside its real10second deadline.
    await page.clock.fastForward(12000);
    required(hydrate)();
    await readStarted;
    await page.clock.fastForward(4000);
    await page.locator('#admin-route-failure').waitFor();
    required(release)();
    await page.getByText('No data requests are currently available.', { exact: true }).waitFor();
    await page.locator('#admin-route-failure').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#admin-route-content').evaluate((element: HTMLElement) => element.inert), false);
  } finally {
    required(hydrate)();
    required(release)();
  }
});

test('merchant navigation preserves the outgoing layout and reports host loading before the next document arrives', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.hostLoadingEvents = [];
    window.shopify = {
      idToken: async () => 'synthetic-navigation-layout',
      loading: (active) => window.hostLoadingEvents.push(active),
    };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/admin/products?*', (route) =>
    route.fulfill({ json: { products: [{ ...selectedConfigView().product, imageUrl: null }], nextCursor: null } }),
  );
  let configReads = 0;
  await page.route('**/api/admin/products/111/config', (route) => {
    configReads++;
    return route.fulfill({ json: selectedConfigView() });
  });
  await page.goto(`${server.base}/admin/products`);
  const configure = page.getByRole('link', { name: 'Synthetic selected hoodie', exact: true });
  await configure.waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
  const before = required(await page.locator('#admin-route-content').boundingBox());
  await page.evaluate(() => {
    window.hostLoadingEvents = [];
    window.navigation.addEventListener('navigate', (event) => {
      if (event.canIntercept) event.intercept({ handler: () => new Promise<void>(() => {}) });
    });
  });
  await configure.click();
  await page.waitForFunction(
    () => document.getElementById('admin-route-content')?.inert === true && window.hostLoadingEvents.at(-1) === true,
  );
  assert.equal(
    await page.locator('#admin-route-skeleton').isVisible(),
    false,
    'The outgoing document never substitutes a fake destination skeleton',
  );
  assert.deepEqual(
    required(await page.locator('#admin-route-content').boundingBox()),
    before,
    'Existing selected table reserves exactly the same layout until transport replaces the document',
  );
  assert.equal(
    (await page.locator('#admin-route-content .catalog-product-name').innerText()).trim(),
    'Synthetic selected hoodie',
  );
  assert.deepEqual(await page.evaluate(() => window.hostLoadingEvents), [true]);
  assert.equal(configReads, 0, 'Destination private data waits for the actual document lifecycle');
});

test('Settings exposes the standard Privacy row only after an authenticated privacy capability and clears it on denied or missing grants', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-settings-capability' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  let grant: boolean | undefined = true;
  let status = 200;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/purchases/v1/privacy')) privateRequests.push(request.method());
  });
  await page.route('**/api/admin/preferences', async (route) => {
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-settings-capability');
    assert.equal(route.request().headers().cookie, undefined);
    await gate;
    return route.fulfill({
      status,
      json:
        status === 200
          ? { ...preferences, canEdit: false, ...(grant === undefined ? {} : { canReadPrivacy: grant }) }
          : { error: 'Synthetic capability unavailable' },
    });
  });
  try {
    await page.goto(`${server.base}/admin/settings`);
    await page.getByRole('link', { name: 'Billing', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('link', { name: 'Privacy', exact: true }).count(),
      0,
      'No private destination before the capability observation',
    );
    required(release)();
    const privacy = page.getByRole('link', { name: 'Privacy', exact: true });
    await privacy.waitFor();
    assert.equal(await privacy.getAttribute('href'), '/admin/settings/privacy');
    assert.equal(
      await page.locator('s-clickable[href="/admin/settings/privacy"] s-heading').innerText(),
      'Privacy',
      'Privacy uses the same selected Settings row markup',
    );
    for (const denied of [false, undefined, 'forbidden'] as const) {
      grant = denied === 'forbidden' ? true : denied;
      status = denied === 'forbidden' ? 403 : 200;
      const observed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/admin/preferences',
      );
      await page.reload();
      await observed;
      await page.getByRole('link', { name: 'Billing', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Privacy', exact: true }).count(), 0);
    }
    assert.deepEqual(privateRequests, [], 'Opening Settings never reads customer requests or private order payloads');
  } finally {
    release?.();
  }
});
