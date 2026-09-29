import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindCurrentFixture, type CurrentReads } from './live-context.ts';

const generation = 'a'.repeat(32);
const publicHex = 'b'.repeat(64);
const config = JSON.stringify({ generationHex: generation, epoch: 1,
  maxBuckets: 32, maxPhysicalQuantity: 10_000, allowNoMarket: false,
  keys: [{ id: 60014, publicHex, revoked: false, firstDay: 20724, lastDay: 20726 }] });
const field = (key: string, value: string, owner: string) => ({ id: 'gid://shopify/Metafield/1',
  namespace: 'app--429028933633', key, type: key === 'm0_007_public_config' ? 'json' : 'single_line_text_field',
  value, owner: { __typename: owner } });
const product = (id: string, policy: string, variants: Array<[string, string]>) => ({
  id, title: `M0-014 ${policy} fixture`, status: 'ACTIVE', tags: ['m0-014'],
  variants: { nodes: variants.map(([v, title]) => ({ id: `gid://shopify/ProductVariant/${v}`, title, price: '20.00' })) },
  registration: field('m0_007_registration', `${generation}:1:ready`, 'Product'),
  policy: field('m0_007_policy', `${generation}:1:${policy}`, 'Product'),
});
const ids = { productA: 'gid://shopify/Product/111', productB: 'gid://shopify/Product/222' };
const line = (id: number, q: number, target: 'transform' | 'validation') => ({
  id: `gid://shopify/CartLine/${id}`, quantity: q, member: null, sellingPlanAllocation: null,
  fixtureRole: id === 3 ? null : { value: id === 1 ? 'm0-014-small-custom-1' :
    'm0-014-small-custom-0' },
  merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/1001',
    product: { id: ids.productA, policy: { value: `${generation}:1:optional` },
      registration: { value: `${generation}:1:ready` } } },
  cost: target === 'transform' ? { amountPerQuantity: { currencyCode: 'USD' } } :
    { subtotalAmount: { amount: `${(q * 20).toFixed(2)}`, currencyCode: 'USD' } },
});
function reads(): CurrentReads {
  const admin = { shop: { id: 'gid://shopify/Shop/105501393179',
    myshopifyDomain: 'insignia-rewrite-dev.myshopify.com', currencyCode: 'USD',
    ianaTimezone: 'America/New_York', publicConfig: field('m0_007_public_config', config, 'Shop') },
  currentAppInstallation: { id: 'gid://shopify/AppInstallation/1054356963611',
    app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
    accessScopes: [{ handle: 'read_products' }] },
  nodes: [product(ids.productA, 'optional', [['1001', 'Small'], ['1002', 'Large']]),
    product(ids.productB, 'required', [['2001', 'Default Title']])] };
  const input = (target: 'transform' | 'validation') => ({
    shop: { localTime: { date: '2026-09-28' }, publicConfig: { value: config } },
    localization: { country: { isoCode: 'US' }, market: { id: 'gid://shopify/Market/123' } },
    cart: { quote: null, lines: [line(1, 2, target), line(2, 1, target), line(3, 1, target)] },
  });
  return { admin, transform: input('transform'), validation: input('validation'),
    transformInputBytes: 2_100, validationInputBytes: 2_300 };
}

test('current Admin policy, public key and both plain Function inputs bind one small decision', () => {
  const result = bindCurrentFixture('small', ids, reads(), 60014, publicHex,
    'c'.repeat(32), 'd'.repeat(32));
  assert.equal(result.context.marketId, '123');
  assert.equal(result.context.country, 'US');
  assert.equal(result.context.shopLocalDate, '2026-09-28');
  assert.equal(result.context.smallVariantGid, 'gid://shopify/ProductVariant/1001');
  assert.equal(result.projection.ordinaryLines, 1);
  assert.equal(result.projection.ordinaryPhysicalQuantity, 1);
  assert.equal(result.projection.transformInputUpperBytes, 2_100 + 2_048 + 2 * 128);
  assert.deepEqual(result.assignments.map(x => [x.cartLineId, x.quantity, x.memberIndex]), [
    ['gid://shopify/CartLine/1', 2, 1],
    ['gid://shopify/CartLine/2', 1, 0],
    ['gid://shopify/CartLine/3', 1, null],
  ]);
  assert.match(result.readDigest, /^[a-f0-9]{64}$/);
});

test('native Transform UUID and Validation zero-based IDs bind by explicit role across reordering', () => {
  const r = reads();
  const transformIds = [
    '0f8119dd-dedc-463b-9900-d9ce5306636c',
    '30737747-972d-439d-a3ea-6cdb83449572',
    'f07981bc-4b9d-48d3-a49e-4ad8de0355d1',
  ];
  for (let i = 0; i < 3; i++) {
    (r.transform.cart as any).lines[i].id = `gid://shopify/CartLine/${transformIds[i]}`;
    (r.validation.cart as any).lines[i].id = `gid://shopify/CartLine/${i}`;
    (r.validation.cart as any).lines[i].cost.subtotalAmount.amount = i === 0 ? '40.0' : '20.0';
  }
  (r.validation.cart as any).lines.reverse();
  const bound = bindCurrentFixture('small', ids, r, 60014, publicHex,
    'c'.repeat(32), 'd'.repeat(32));
  assert.deepEqual(bound.assignments.map(x => x.memberIndex), [1, 0, null]);
  assert.equal(bound.assignments[0]?.cartLineId, `gid://shopify/CartLine/${transformIds[0]}`);
});

test('changed key, price, projected policy, context, cart count or economic amount refuses signing', () => {
  const changes: Array<(r: CurrentReads) => void> = [
    r => { (r.admin.nodes as any[])[0].variants.nodes[0].price = '21.00'; },
    r => { (r.admin.shop as any).publicConfig.value = '{}'; },
    r => { (r.transform.localization as any).country.isoCode = 'CA'; },
    r => { (r.validation.cart as any).lines.pop(); },
    r => { (r.validation.cart as any).lines[0].cost.subtotalAmount.amount = '39.99'; },
    r => { (r.validation.cart as any).lines[0].id = 'gid://shopify/CartLine/not-an-id'; },
    r => { const lines = (r.validation.cart as any).lines; lines[0].quantity = 1; lines[0].cost.subtotalAmount.amount = '20.00'; lines[1].quantity = 2; lines[1].cost.subtotalAmount.amount = '40.00'; },
    r => { (r.validation.cart as any).lines[1].id = 'gid://shopify/CartLine/1'; },
    r => { (r.validation.cart as any).lines[1].fixtureRole.value = 'm0-014-small-custom-1'; },
    r => { (r.transform.cart as any).lines[1].fixtureRole = null; },
    r => { (r.transform.cart as any).lines[1].fixtureRole.value = 'm0-014-small-custom-1'; },
    r => { (r.admin.nodes as any[])[1].policy.value = `${generation}:1:optional`; },
  ];
  for (const change of changes) {
    const r = reads(); change(r);
    assert.throws(() => bindCurrentFixture('small', ids, r, 60014, publicHex,
      'c'.repeat(32), 'd'.repeat(32)));
  }
  assert.throws(() => bindCurrentFixture('small', ids, reads(), 60014, 'e'.repeat(64),
    'c'.repeat(32), 'd'.repeat(32)));
});

test('small fixture rejects role and quantity disagreement even with four physical units', () => {
  const r = reads();
  for (const [index, line] of (r.transform.cart as any).lines.entries()) {
    line.quantity = index === 0 ? 1 : index === 1 ? 1 : 2;
  }
  for (const [index, line] of (r.validation.cart as any).lines.entries()) {
    line.quantity = index === 0 ? 1 : index === 1 ? 1 : 2;
    line.cost.subtotalAmount.amount = `${(line.quantity * 20).toFixed(2)}`;
  }
  assert.throws(() => bindCurrentFixture('small', ids, r, 60014, publicHex,
    'c'.repeat(32), 'd'.repeat(32)));
});

test('stress fixture binds 32 explicit member roles across 200 reordered one-unit lines', () => {
  const r = reads();
  for (const target of ['transform', 'validation'] as const) {
    (r[target].cart as any).lines = Array.from({ length: 200 }, (_, index) => {
      const item = line(index + 1, 1, target) as any;
      item.merchandise.id = 'gid://shopify/ProductVariant/1002';
      item.fixtureRole = index < 32 ? { value: `m0-014-large-customized-${index + 1}` } : null;
      return item;
    });
  }
  (r.validation.cart as any).lines.reverse();
  const bound = bindCurrentFixture('stress32', ids, r, 60014, publicHex,
    'c'.repeat(32), 'd'.repeat(32));
  assert.equal(bound.assignments.length, 200);
  assert.deepEqual(bound.assignments.slice(0, 32).map(x => x.memberIndex),
    Array.from({ length: 32 }, (_, index) => index));
  assert.ok(bound.assignments.slice(32).every(x => x.memberIndex === null));
  (r.validation.cart as any).lines[0].fixtureRole = { value: 'm0-014-large-customized-1' };
  assert.throws(() => bindCurrentFixture('stress32', ids, r, 60014, publicHex,
    'c'.repeat(32), 'd'.repeat(32)));
});
