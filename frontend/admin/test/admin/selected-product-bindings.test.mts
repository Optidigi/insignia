import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MethodDraftBindingSchema,
  placementProductSchema,
  VersionedMethodConfigurationSchema,
} from '@insignia/contracts';
import {
  applyMethodImport,
  currentProductMethodReviews,
  overrideProductPrice,
  reviewProductMethod,
} from '../../src/islands/selected-product-bindings.ts';
import {
  createPlacementHistory,
  commitPlacementDraftChange,
  undoPlacementHistory,
} from '../../examples/admin/support/placement-history.mts';
const methodId = '11111111-1111-4111-8111-111111111111';
const product = placementProductSchema.parse({ id: '111', title: 'T-shirt', images: [], views: [], methods: [] });
const record = VersionedMethodConfigurationSchema.parse({
  currency: 'EUR',
  version: '1',
  configuration: {
    id: methodId,
    name: 'Print',
    explanation: 'Full colour',
    pricing: 'fixed',
    amount: '3.50',
    assignment: 'manual',
    productIds: ['111'],
    tags: [],
    tagMatch: 'any',
  },
});
const change = { methodIds: [methodId], sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: {} }] };
test('only explicit new catalogue import inherits defaults; an existing equal-valued independent method stays independent', () => {
  const args = {
    bindings: {},
    product,
    placementId: 'chest',
    change,
    choices: [{ id: methodId, name: 'Print', pricing: 'fixed' as const, amount: '3.50' }],
    editedIds: [],
    editedCells: [],
    catalog: [record],
    currency: 'EUR',
  };
  const bindings = applyMethodImport(args);
  assert.equal(bindings[methodId]?.prices.default?.source, 'catalog');
  assert.equal(bindings[methodId]?.prices['["chest","small"]']?.source, 'catalog');
  assert.deepEqual(applyMethodImport({ ...args, product: { ...product, methods: args.choices } }), {});
  assert.throws(() => applyMethodImport({ ...args, currency: 'USD' }));
});
test('equal-valued explicit price overrides survive undo with their provenance, without changing visible values', () => {
  const binding = MethodDraftBindingSchema.parse({
    catalogMethodId: methodId,
    observedVersion: '1',
    name: { source: 'catalog', value: 'Print' },
    explanation: { source: 'catalog', value: '' },
    translations: {},
    prices: { '["chest","small"]': { source: 'catalog', value: '3.50' } },
    review: null,
  });
  const initial = { product, bindings: { [methodId]: binding } };
  const next = { product, bindings: overrideProductPrice(initial.bindings, 'chest', 'small', methodId, '3.50') };
  const history = createPlacementHistory<typeof initial>();
  assert.equal(commitPlacementDraftChange(history, initial, next), true);
  assert.equal(next.bindings[methodId]?.prices['["chest","small"]']?.source, 'product');
  assert.deepEqual(undoPlacementHistory(history, next).state, initial);
  const pending = {
    ...binding,
    review: { reason: 'deleted' as const, catalogVersion: '2', decision: 'pending' as const },
  };
  assert.equal(
    reviewProductMethod(product, { [methodId]: pending }, methodId, 'keep').bindings[methodId]?.review?.decision,
    'keep',
  );
});

test('library methods need no assignment review; only a deletion asks keep/remove before save', () => {
  const original = MethodDraftBindingSchema.parse({
    catalogMethodId: methodId,
    observedVersion: '1',
    name: { source: 'catalog', value: 'Print' },
    explanation: { source: 'catalog', value: 'Full colour' },
    translations: {},
    prices: { default: { source: 'catalog', value: '3.50' } },
    review: null,
  });
  // A legacy tag rule the product does not match no longer limits availability.
  const tagged = VersionedMethodConfigurationSchema.parse({
    ...record,
    configuration: { ...record.configuration, assignment: 'tags', productIds: [], tags: ['shirts'], tagMatch: 'any' },
  });
  const bindings = { [methodId]: original };
  assert.equal(currentProductMethodReviews(bindings, [tagged]), bindings);
  // A stored legacy unassigned review resolves without touching prices or text.
  const legacy = {
    ...original,
    review: { reason: 'unassigned' as const, catalogVersion: '1', decision: 'pending' as const },
  };
  const resolved = currentProductMethodReviews({ [methodId]: legacy }, [tagged]);
  assert.equal(resolved[methodId]?.review, null);
  assert.deepEqual(resolved[methodId]?.prices, original.prices);
  assert.equal(legacy.review.decision, 'pending');
  // Deleting the library method still asks keep/remove.
  const deleted = currentProductMethodReviews(bindings, []);
  assert.equal(deleted[methodId]?.review?.reason, 'deleted');
  assert.equal(deleted[methodId]?.review?.decision, 'pending');
  const kept = reviewProductMethod(product, deleted, methodId, 'keep').bindings;
  assert.equal(currentProductMethodReviews(kept, [])[methodId]?.review?.decision, 'keep');
});

test('every library method is offered on every product, whatever its legacy assignment values', async () => {
  const { availablePlacementMethods } = await import('../../src/islands/selected-method-choices.ts');
  const other = placementProductSchema.parse({
    id: 'gid://shopify/Product/222',
    title: 'Cap',
    images: [],
    views: [],
    methods: [],
  });
  const unassigned = { ...record.configuration, productIds: [] };
  const tagged = {
    ...record.configuration,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Embroidery',
    assignment: 'tags' as const,
    productIds: [],
    tags: ['shirts'],
  };
  assert.deepEqual(
    availablePlacementMethods(other, { methods: [unassigned, tagged] }).map((method) => method.name),
    ['Print', 'Embroidery'],
  );
  // Existing product snapshots still win over a library method of the same name.
  const withSnapshot = {
    ...other,
    methods: [{ id: 'local', name: 'print', pricing: 'product' as const, amount: '' }],
  };
  assert.deepEqual(
    availablePlacementMethods(withSnapshot, { methods: [unassigned, tagged] }).map((method) => method.id),
    ['local', tagged.id],
  );
});
