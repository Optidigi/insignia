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
    const next = reconcileMethodBinding(original, current);
    expect(next.name.value).toBe('Printing');
    expect(next.explanation.value).toBe('Product instructions');
    expect(next.translations.nl?.name?.value).toBe('Nieuwe naam');
    expect(next.prices.chest?.value).toBe('4.00');
    expect(next.prices.back?.value).toBe('3.50');
    expect(original.prices.chest?.value).toBe('3.50');
  });
  it('library Methods need no assignment review, and a stored legacy unassigned review resolves', () => {
    expect(reconcileMethodBinding(binding(), current).review).toBeNull();
    const legacy = {
      ...binding(),
      review: { reason: 'unassigned' as const, catalogVersion: '1', decision: 'pending' as const, assignmentKey: 'a' },
    };
    const next = reconcileMethodBinding(legacy, current);
    expect(next.review).toBeNull();
    expect(next.name.value).toBe('Printing');
    // A legacy review on a since-deleted Method becomes the ordinary deletion review.
    expect(reconcileMethodBinding(legacy, null).review).toEqual({
      reason: 'deleted',
      catalogVersion: '1',
      decision: 'pending',
    });
  });
  it('retains independently usable values when the catalog entry is deleted, and does not delete explicit cell prices', () => {
    const next = reconcileMethodBinding(binding(), null);
    expect(next.name.value).toBe('Print');
    expect(next.prices.back?.value).toBe('3.50');
    expect(next.review).toEqual({ reason: 'deleted', catalogVersion: '1', decision: 'pending' });
  });
});

it('a kept deleted copy is independent even if a catalog identity is reused', () => {
  const removed = reconcileMethodBinding(binding(), null);
  const kept = reviewMethodBinding(removed, 'keep');
  if (!kept) throw new Error('Keep must preserve the binding');
  expect(kept.name.source).toBe('product');
  expect(reconcileMethodBinding(kept, current).name.value).toBe('Print');
  expect(reconcileMethodBinding(kept, current).review?.decision).toBe('keep');
});

it('a deletion review asks once and keeps the decision', () => {
  const removed = reconcileMethodBinding(binding(), null);
  expect(removed.review?.decision).toBe('pending');
  expect(reviewMethodBinding(removed, 'remove')).toBeNull();
  const kept = reviewMethodBinding(removed, 'keep');
  if (!kept) throw new Error('Keep must preserve the binding');
  expect(reconcileMethodBinding(kept, null).review?.decision).toBe('keep');
  // Stored decisions that carry a legacy assignment key keep it.
  const stored = { ...kept, review: { ...kept.review!, assignmentKey: 'b'.repeat(64) } };
  expect(reconcileMethodBinding(stored, null).review).toEqual(stored.review);
});

it('missing inherited translations fall back to the product default override, while deleted copies retain translated snapshots', () => {
  const original = binding();
  original.name = { source: 'product', value: 'Product label' };
  const withoutDutch = { ...current, configuration: { ...current.configuration, translations: {} } };
  expect(reconcileMethodBinding(original, withoutDutch).translations.nl?.name?.value).toBe('Product label');
  expect(reconcileMethodBinding(original, null).translations.nl?.name?.value).toBe('Bedrukking');
});
