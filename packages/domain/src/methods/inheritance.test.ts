import { describe, expect, it } from 'vitest';
import { type MethodDraftBinding, reconcileMethodBinding, reviewMethodBinding } from './inheritance.js';

function binding(): MethodDraftBinding {
  return {
    catalogMethodId: 'method-1',
    observedVersion: '1',
    name: { source: 'catalog', value: 'Print' },
    explanation: { source: 'product', value: 'Product instructions' },
    translations: { nl: { name: { source: 'catalog', value: 'Bedrukking' } } },
    prices: { chest: { source: 'catalog', value: '3.50' }, back: { source: 'product', value: '3.50' } },
    review: null,
  };
}
const current = {
  configuration: {
    id: 'method-1',
    name: 'Printing',
    explanation: 'New instructions',
    pricing: 'fixed' as const,
    amount: '4.00',
    translations: { nl: { name: 'Nieuwe naam' } },
  },
  version: '2',
};
describe('global Method draft inheritance', () => {
  it('refreshes inherited values and keeps explicit overrides even when their previous values match', () => {
    const original = binding();
    const next = reconcileMethodBinding(original, current, true);
    expect(next.name.value).toBe('Printing');
    expect(next.explanation.value).toBe('Product instructions');
    expect(next.translations.nl?.name?.value).toBe('Nieuwe naam');
    expect(next.prices.chest?.value).toBe('4.00');
    expect(next.prices.back?.value).toBe('3.50');
    expect(original.prices.chest?.value).toBe('3.50');
  });
  it('retains unassigned copies but requires a review and keeps an acknowledgement until the source changes', () => {
    const next = reconcileMethodBinding(binding(), current, false);
    expect(next.review?.decision).toBe('pending');
    const kept = reviewMethodBinding(next, 'keep');
    if (!kept) throw new Error('Keep must preserve the binding');
    expect(kept.review?.decision).toBe('keep');
    expect(reconcileMethodBinding(kept, current, false).review?.decision).toBe('keep');
    expect(reconcileMethodBinding(kept, { ...current, version: '3' }, false).review?.decision).toBe('pending');
    expect(reviewMethodBinding(next, 'remove')).toBeNull();
  });
  it('retains independently usable values when the catalog entry is deleted, and does not delete explicit cell prices', () => {
    const next = reconcileMethodBinding(binding(), null, false);
    expect(next.name.value).toBe('Print');
    expect(next.prices.back?.value).toBe('3.50');
    expect(next.review).toEqual({ reason: 'deleted', catalogVersion: '1', decision: 'pending' });
  });
});

it('a kept deleted copy is independent even if a catalog identity is reused', () => {
  const removed = reconcileMethodBinding(binding(), null, false);
  const kept = reviewMethodBinding(removed, 'keep');
  if (!kept) throw new Error('Keep must preserve the binding');
  expect(kept.name.source).toBe('product');
  expect(reconcileMethodBinding(kept, current, true).name.value).toBe('Print');
  expect(reconcileMethodBinding(kept, current, true).review?.decision).toBe('keep');
});

it('kept mismatches survive unrelated catalog edits but require review when assignment semantics change', () => {
  const first = reconcileMethodBinding(binding(), current, false, 'assignment-one');
  const kept = reviewMethodBinding(first, 'keep');
  if (!kept) throw new Error('Keep must preserve the binding');
  expect(reconcileMethodBinding(kept, { ...current, version: '3' }, false, 'assignment-one').review?.decision).toBe(
    'keep',
  );
  expect(reconcileMethodBinding(kept, { ...current, version: '3' }, false, 'assignment-two').review?.decision).toBe(
    'pending',
  );
});

it('missing inherited translations fall back to the product default override, while deleted copies retain translated snapshots', () => {
  const original = binding();
  original.name = { source: 'product', value: 'Product label' };
  const withoutDutch = { ...current, configuration: { ...current.configuration, translations: {} } };
  expect(reconcileMethodBinding(original, withoutDutch, true).translations.nl?.name?.value).toBe('Product label');
  expect(reconcileMethodBinding(original, null, false).translations.nl?.name?.value).toBe('Bedrukking');
});
