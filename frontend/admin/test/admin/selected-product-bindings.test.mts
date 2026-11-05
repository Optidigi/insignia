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

test('current tag mismatch is visible before save while prices/text and original draft stay untouched',()=>{
 const original=MethodDraftBindingSchema.parse({catalogMethodId:methodId,observedVersion:'1',name:{source:'catalog',value:'Print'},explanation:{source:'catalog',value:'Full colour'},translations:{},prices:{default:{source:'catalog',value:'3.50'}},review:null});
 const current=VersionedMethodConfigurationSchema.parse({...record,configuration:{...record.configuration,assignment:'tags',productIds:[],tags:['shirts'],tagMatch:'any'}});
 const flagged=currentProductMethodReviews({[methodId]:original},[current],{id:product.id,tags:[]});
 assert.equal(flagged[methodId]?.review?.reason,'unassigned');assert.equal(flagged[methodId]?.review?.decision,'pending');assert.equal(original.review,null);
 assert.deepEqual(flagged[methodId]?.prices,original.prices);assert.deepEqual(flagged[methodId]?.name,original.name);
 const kept=reviewProductMethod(product,flagged,methodId,'keep').bindings;
 assert.equal(currentProductMethodReviews(kept,[{...current,version:'2',configuration:{...current.configuration,name:'New name',amount:'9.00'}}],{id:product.id,tags:[]})[methodId]?.review?.decision,'keep');
 assert.equal(currentProductMethodReviews(kept,[{...current,configuration:{...current.configuration,tags:['other']}}],{id:product.id,tags:[]})[methodId]?.review?.decision,'pending');
 assert.throws(()=>currentProductMethodReviews({[methodId]:original},[current],{id:product.id}),/tags unavailable/);
});
