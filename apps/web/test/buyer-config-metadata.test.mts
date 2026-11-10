import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuyerConfigSchema, MerchantPresentationSchema } from '@insignia/contracts';
import type { PublishedConfig } from '@insignia/domain';
import { createBuyerServices } from '../src/server/buyer/service.ts';
import { fixtureCore } from './admin/support/durable-core.mts';
import { fixtureTransaction } from './admin/support/fixtures.mts';
import { buyerFixture, effectiveRevision } from './http-fixtures.mts';

function fixture(
  capturedImages = true,
  gates: { catalog?(): Promise<void> } = {},
  clock: () => Date = () => new Date(),
) {
  const scope = { shopId: 'tenant', installationGeneration: '1', productId: '123' };
  const config: PublishedConfig = {
    ...effectiveRevision().config,
    methods: [{ id: 'print' }, { id: 'stitch' }],
    placements: [
      {
        id: 'front',
        allowedMethodIds: ['print', 'stitch'],
        allowedStepIds: ['small', 'large'],
        logoLaterAllowed: true,
      },
    ],
    productionOptions: [{ id: 'finish', allowedValueIds: ['fold', 'hang'] }],
    pricingRules: [
      {
        id: 'small-price',
        scope: { kind: 'step', placementId: 'front', stepId: 'small', methodId: 'print' },
        role: 'unit',
        rate: { kind: 'fixed', amount: { shopDecimal: '3.50', presentmentOverrides: [] } },
      },
      {
        id: 'large-price',
        scope: { kind: 'step', placementId: 'front', stepId: 'large', methodId: 'print' },
        role: 'unit',
        rate: { kind: 'fixed', amount: { shopDecimal: '0.00', presentmentOverrides: [] } },
      },
    ],
  };
  const presentation = MerchantPresentationSchema.parse({
    version: 'm5-presentation-v1',
    labels: {
      methods: { print: 'Actual print', stitch: 'Actual embroidery' },
      placements: { front: 'Actual front' },
      steps: { small: 'Actual small', large: 'Actual large' },
      options: { finish: 'Actual finish' },
      values: { finish: { fold: 'Folded', hang: 'Hanging' } },
    },
  });
  const geometry = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'photo', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
      },
    ],
    steps: [
      { id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } },
      { id: 'large', widthFraction: 1, heightFraction: 1, physicalMm: { width: 200, height: 200 } },
    ],
  };
  const catalog: Awaited<ReturnType<Parameters<typeof createBuyerServices>[0]['catalog']>> = {
    title: 'Actual catalogue title',
    currency: 'USD',
    variants: [
      {
        id: '222',
        label: 'Blue / M',
        available: true,
        selectedOptions: [
          { name: 'Color', value: 'Blue' },
          { name: 'Size', value: 'M' },
        ],
        baseUnitMinor: '1099',
      },
    ],
    imageUrls: { photo: 'https://cdn.shopify.com/live.jpg' },
  };
  const wording = {
    wordingVersion: '4',
    overlays: {
      en: { locale: 'en', messages: {} },
      nl: { locale: 'nl', messages: { 'customer:steps.done': { message: 'Gereed' } } },
    },
  };
  let wordingReads = 0,
    previews = 0;
  const contexts: ({ country: string } | undefined)[] = [];
  const core = fixtureCore({
    acceptedQuotes: {
      getEffective: async (shopId, productId) => {
        assert.equal(shopId, scope.shopId);
        assert.equal(productId, scope.productId);
        return { ...effectiveRevision(), config };
      },
    },
    configs: {
      getRevisionGeometry: async () => ({
        version: 'm5-geometry-v1',
        contentHash: 'a'.repeat(64),
        mode: 'required',
        value: geometry,
      }),
      getRevisionPresentation: async () => presentation,
    },
    preferences: {
      readWording: async (_tx, target) => {
        assert.equal(target.shopId, scope.shopId);
        assert.equal(target.installationGeneration, scope.installationGeneration);
        wordingReads++;
        return wording;
      },
    },
    transactions: { run: async (work) => work(fixtureTransaction) },
  });
  const service = createBuyerServices({
    core,
    guest: buyerFixture({ guest: { resolve: async () => scope } }).guest,
    ports: () => {
      throw new Error('Config metadata cannot authorize a quote');
    },
    catalog: async (target, productId, _phase, context) => {
      await gates.catalog?.();
      assert.deepEqual(target, scope);
      assert.equal(productId, scope.productId);
      contexts.push(context);
      return catalog;
    },
    clock,
    ...(capturedImages
      ? {
          previewImages: async () => {
            previews++;
            return { photo: `https://captured.example.test/frozen.png?signature=${previews}` };
          },
        }
      : {}),
  });
  return {
    service,
    core,
    config,
    catalog,
    wording,
    geometry,
    contexts,
    wordingReads: () => wordingReads,
    previews: () => previews,
  };
}

test('selection waits for complete catalogue facts and does not invoke purchase ports', async () => {
  let release!: () => void;
  const f = fixture(true, {
    catalog: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  let settled = false;
  const pending = f.service.config(new Request('https://app.example/config?country=US'));
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  assert.equal(BuyerConfigSchema.parse(await pending).ready, true);
});
test('selection fails closed when catalogue facts are unavailable', async () => {
  const f = fixture(true, {
    catalog: async () => {
      throw Error('Catalogue unavailable');
    },
  });
  await assert.rejects(f.service.config(new Request('https://app.example/config?country=US')), /Catalogue unavailable/);
  assert.equal(f.wordingReads(), 0);
});

test('a published Lean configuration without selected authoring state exports actual contextual metadata and exact available cells', async () => {
  const f = fixture();
  const result = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config?country=US')));
  assert.equal(result.selectedSetup, undefined);
  assert.equal(result.shopCurrency, 'USD');
  assert.equal(result.title, 'Actual catalogue title');
  assert.deepEqual(result.decorationPrices, [
    { placementId: 'front', methodId: 'print', stepId: 'small', minor: '350' },
    { placementId: 'front', methodId: 'print', stepId: 'large', minor: '0' },
  ]);
  assert.deepEqual(result.wording, f.wording);
  assert.deepEqual(result.variants, f.catalog.variants);
  assert.deepEqual(result.geometry, f.geometry);
  assert.deepEqual(result.imageUrls, { photo: 'https://captured.example.test/frozen.png?signature=1' });
  assert.deepEqual(result.options, [
    {
      id: 'finish',
      label: 'Actual finish',
      values: [
        { id: 'fold', label: 'Folded' },
        { id: 'hang', label: 'Hanging' },
      ],
    },
  ]);
  assert.deepEqual(f.contexts, [{ country: 'US' }]);
  assert.equal(f.wordingReads(), 1);
});

test('storefront eligibility reads only effective publication authority without catalogue, preview or wording work', async () => {
  const f = fixture();
  f.catalog.variants = [];
  f.core.preferences.readWording = async () => {
    throw new Error('Eligibility must not load customer wording');
  };
  const result = await f.service.eligibility(new Request('https://app.example/eligibility'));
  assert.deepEqual(result, { productId: '123', configured: true });
  assert.deepEqual(f.contexts, [], 'No Shopify catalogue call for button placement');
  const geometry = await f.core.configs.getRevisionGeometry('tenant', f.config.revisionId);
  assert(geometry);
  // Revision geometry is immutable; a newly effective revision with optional geometry is not eligible.
  f.core.configs.getRevisionGeometry = async (_shop, revisionId) =>
    revisionId === 'optional-revision' ? { ...geometry, mode: 'optional' } : geometry;
  f.config.revisionId = 'optional-revision';
  await assert.rejects(f.service.eligibility(new Request('https://app.example/eligibility')), /NOT_FOUND/);
  f.service.guest.resolve = async () => null;
  await assert.rejects(f.service.eligibility(new Request('https://app.example/eligibility')), /NOT_FOUND/);
});

test('new contextual UI never substitutes a current catalogue photo when immutable capture reading is unavailable', async () => {
  const f = fixture(false);
  const current = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config?country=US')));
  assert.deepEqual(current.imageUrls, {});
  assert.deepEqual(current.geometry, f.geometry, 'Known immutable production facts remain available');
  assert.equal(current.decorationPrices?.[0]?.minor, '350');
  const old = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config')));
  assert.deepEqual(old.imageUrls, f.catalog.imageUrls, 'Retained non-contextual reader contract is unchanged');
});

test('old configuration readers without country keep canonical choices and receive no invented context or financial defaults', async () => {
  const f = fixture();
  delete f.catalog.currency;
  for (const variant of f.catalog.variants) {
    delete variant.baseUnitMinor;
    delete variant.selectedOptions;
  }
  const result = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config')));
  assert.equal(result.ready, true);
  assert.equal(result.shopCurrency, undefined);
  assert.equal(result.title, undefined);
  assert.equal(result.decorationPrices, undefined);
  assert.equal(result.wording, undefined);
  assert.deepEqual(result.methods, [
    { id: 'print', label: 'Actual print' },
    { id: 'stitch', label: 'Actual embroidery' },
  ]);
  assert.deepEqual(result.options[0]?.values, [
    { id: 'fold', label: 'Folded' },
    { id: 'hang', label: 'Hanging' },
  ]);
  assert.deepEqual(f.contexts, [undefined]);
  assert.equal(f.wordingReads(), 0);
});

test('EUR metadata uses actual Netherlands catalogue context without converting or defaulting prices', async () => {
  const f = fixture();
  f.config.shopCurrency = 'EUR';
  f.catalog.currency = 'EUR';
  const result = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config?country=NL')));
  assert.equal(result.shopCurrency, 'EUR');
  assert.equal(result.decorationPrices?.[0]?.minor, '350');
  assert.equal(result.variants[0]?.baseUnitMinor, '1099');
  assert.deepEqual(f.contexts, [{ country: 'NL' }]);
});

test('unsupported historical economics and missing contextual facts remain readable but do not advertise editable financial metadata', async () => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      'unsupported shop currency',
      (f) => {
        f.config.shopCurrency = 'GBP';
        f.catalog.currency = 'GBP';
      },
    ],
    [
      'coarse price scope',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = { ...rule, scope: { kind: 'general' } };
      },
    ],
    [
      'unknown method price scope',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = { ...rule, scope: { kind: 'step', placementId: 'front', stepId: 'small' } };
      },
    ],
    [
      'setup fee',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = { ...rule, role: 'setup' };
      },
    ],
    [
      'quantity tiers',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = {
          ...rule,
          rate: {
            kind: 'allUnits',
            tiers: [{ minQuantity: 1, amount: { shopDecimal: '3.50', presentmentOverrides: [] } }],
          },
        };
      },
    ],
    [
      'presentment override',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = {
          ...rule,
          rate: {
            kind: 'fixed',
            amount: { shopDecimal: '3.50', presentmentOverrides: [{ currency: 'EUR', decimal: '2.00' }] },
          },
        };
      },
    ],
    [
      'negative rate',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = {
          ...rule,
          rate: { kind: 'fixed', amount: { shopDecimal: '-1.00', presentmentOverrides: [] } },
        };
      },
    ],
    [
      'excess precision',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = {
          ...rule,
          rate: { kind: 'fixed', amount: { shopDecimal: '3.501', presentmentOverrides: [] } },
        };
      },
    ],
    [
      'method multiplicity',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules[0] = { ...rule, methodUnitMultiplicity: 'perPlacement' };
      },
    ],
    [
      'ambiguous price cell',
      (f) => {
        const rule = f.config.pricingRules[0];
        assert(rule);
        f.config.pricingRules.push({ ...rule, id: 'second-final-price' });
      },
    ],
    [
      'currency drift',
      (f) => {
        f.catalog.currency = 'EUR';
      },
    ],
    [
      'unknown contextual price',
      (f) => {
        const variant = f.catalog.variants[0];
        assert(variant);
        delete variant.baseUnitMinor;
      },
    ],
    [
      'unknown variant options',
      (f) => {
        const variant = f.catalog.variants[0];
        assert(variant);
        delete variant.selectedOptions;
      },
    ],
    [
      'empty variant options',
      (f) => {
        const variant = f.catalog.variants[0];
        assert(variant);
        variant.selectedOptions = [];
      },
    ],
    [
      'inconsistent variant option names',
      (f) => {
        const variant = f.catalog.variants[0];
        assert(variant);
        f.catalog.variants.push({ ...variant, id: '223', selectedOptions: [{ name: 'Different', value: 'Other' }] });
      },
    ],
  ];
  for (const [name, change] of cases) {
    const f = fixture();
    change(f);
    const result = BuyerConfigSchema.parse(
      await f.service.config(new Request('https://app.example/config?country=US')),
    );
    assert.equal(result.ready, false, name);
    assert.equal(result.shopCurrency, undefined, name);
    assert.equal(result.decorationPrices, undefined, name);
    assert.deepEqual(result.wording, f.wording, name);
    assert.equal(result.title, 'Actual catalogue title', name);
    assert.deepEqual(result.geometry, f.geometry, name);
    assert.equal(f.wordingReads(), 1, name);
  }
});

test('a retained publication without required production dimensions stays readable but is not ready for customers', async () => {
  const f = fixture();
  const step = f.geometry.steps[0];
  assert(step);
  Reflect.deleteProperty(step, 'physicalMm');
  for (const query of ['', '?country=US']) {
    const result = BuyerConfigSchema.parse(await f.service.config(new Request(`https://app.example/config${query}`)));
    assert.equal(result.ready, false);
    assert.deepEqual(result.geometry, f.geometry, 'readiness never invents dimensions or rewrites retained geometry');
    assert.equal(result.revisionId, f.config.revisionId);
  }
});

test('missing current wording never becomes a fabricated default for a new UI caller while no-country readers remain compatible', async () => {
  const f = fixture();
  f.core.preferences.readWording = async () => null;
  await assert.rejects(
    f.service.config(new Request('https://app.example/config?country=US')),
    /Customer wording unavailable/,
  );
  const old = BuyerConfigSchema.parse(await f.service.config(new Request('https://app.example/config')));
  assert.equal(old.ready, true);
  assert.equal(old.wording, undefined);
  assert.equal(old.decorationPrices, undefined);
});

test('configuration reuses provider reads for 30 s per exact revision and country, re-presigning previews', async () => {
  let now = Date.parse('2026-11-10T12:00:00.000Z');
  const f = fixture(true, {}, () => new Date(now));
  const read = (country = 'US') =>
    f.service
      .config(new Request(`https://app.example/config?country=${country}`))
      .then((value) => BuyerConfigSchema.parse(value));
  const first = await read();
  const second = await read();
  assert.equal(f.contexts.length, 1, 'one catalogue read within 30 s');
  assert.equal(f.wordingReads(), 1);
  assert.equal(f.previews(), 2, 'short-lived preview URLs are issued per request');
  assert.notEqual(second.imageUrls.photo, first.imageUrls.photo);
  assert.deepEqual(
    { ...second, imageUrls: {}, selectedSetup: undefined },
    { ...first, imageUrls: {}, selectedSetup: undefined },
  );
  await read('NL');
  assert.equal(f.contexts.length, 2, 'another country is a separate entry');
  f.config.revisionId = 'republished';
  await read();
  assert.equal(f.contexts.length, 3, 'a new publication never reuses an older entry');
  now += 30_000;
  await read('NL');
  assert.equal(f.contexts.length, 4, 'entries expire after 30 s');
});

test('uncached configuration reads are throttled per shop and failures are not reused', async () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  let fail = true;
  const f = fixture(
    false,
    {
      catalog: async () => {
        if (fail) throw new Error('Synthetic catalogue outage');
      },
    },
    () => new Date(now),
  );
  await assert.rejects(f.service.config(new Request('https://app.example/config?country=US')));
  fail = false;
  await f.service.config(new Request('https://app.example/config?country=US'));
  assert.equal(f.contexts.length, 1, 'the failed read was not cached');
  const countries = ['AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ'];
  let throttled = 0;
  for (let i = 0; i < 80; i++) {
    const country = `${countries[i % 16]}`;
    const url = `https://app.example/config?country=${country}&n=${i}`;
    await f.service
      .config(new Request(url))
      .catch((error: { code?: string }) => (error.code === 'RATE_LIMITED' ? throttled++ : Promise.reject(error)));
  }
  // 16 distinct countries are cached after their first read; the budget is not spent on hits.
  assert.equal(throttled, 0);
  assert.equal(f.contexts.length, 17);
});

test('a burst of distinct uncached configurations beyond the per-shop budget is rejected as throttled', async () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const f = fixture(false, {}, () => new Date(now));
  let throttled = 0;
  for (let i = 0; i < 70; i++) {
    f.config.revisionId = `revision-${i}`;
    await f.service
      .config(new Request('https://app.example/config?country=US'))
      .catch((error: { code?: string }) => (error.code === 'RATE_LIMITED' ? throttled++ : Promise.reject(error)));
  }
  assert.equal(f.contexts.length, 60);
  assert.equal(throttled, 10);
});
