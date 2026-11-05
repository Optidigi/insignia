import { expect, it } from 'vitest';
import { MethodConfigurationSchema, methodAssignedToProduct, methodAssignmentReviewKey } from './method-catalog.js';

const method = {
  id: 'cc756ade-f50a-4f5c-94b7-fd320a7a75e6',
  name: 'Print',
  explanation: 'Full colour',
  pricing: 'fixed',
  amount: '3.50',
  assignment: 'tags',
  productIds: [],
  tags: ['shirts'],
  tagMatch: 'any',
  translations: { nl: { name: 'Bedrukking' } },
};
it('validates rich Methods, exact decimal prices and assignment references', () => {
  const value = MethodConfigurationSchema.parse(method);
  expect(MethodConfigurationSchema.parse({ ...method, amount: '3,50' }).amount).toBe('3.50');
  expect(methodAssignedToProduct(value, { id: '111', tags: ['shirts'] })).toBe(true);
  expect(methodAssignedToProduct(value, { id: '111', tags: [] })).toBe(false);
  for (const amount of ['', '-1', '3.001', 'NaN'])
    expect(MethodConfigurationSchema.safeParse({ ...method, amount }).success).toBe(false);
  expect(MethodConfigurationSchema.safeParse({ ...method, tags: [] }).success).toBe(false);
  expect(MethodConfigurationSchema.safeParse({ ...method, tenantShopId: 'other' }).success).toBe(false);
  expect(MethodConfigurationSchema.safeParse({ ...method, explanation: 'x'.repeat(241) }).success).toBe(false);
});

it('assignment review identity preserves canonical rule bytes and ignores unrelated text/default edits', () => {
  const current = MethodConfigurationSchema.parse({ ...method, tags: ['B', 'A'], tagMatch: 'all' });
  expect(methodAssignmentReviewKey(current, false)).toBe(
    '13f49f916d0e9ecaa81bf76d595c5af9f3b8ed428b83060a2e7ae60533d21114',
  );
  expect(methodAssignmentReviewKey({ ...current, name: 'Another label', amount: '8.00' }, false)).toBe(
    methodAssignmentReviewKey(current, false),
  );
  expect(methodAssignmentReviewKey(current, true)).not.toBe(methodAssignmentReviewKey(current, false));
});
