import { expect, it } from 'vitest';
import { MethodConfigurationSchema, MethodDraftBindingSchema } from './method-catalog.js';

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
it('validates rich Methods and exact decimal prices, still accepting stored legacy assignment fields', () => {
  expect(MethodConfigurationSchema.parse(method).assignment).toBe('tags');
  expect(MethodConfigurationSchema.parse({ ...method, amount: '3,50' }).amount).toBe('3.50');
  expect(
    MethodConfigurationSchema.parse({ ...method, assignment: 'manual', productIds: ['gid://shopify/Product/12'] })
      .productIds,
  ).toEqual(['12']);
  for (const amount of ['', '-1', '3.001', 'NaN'])
    expect(MethodConfigurationSchema.safeParse({ ...method, amount }).success).toBe(false);
  expect(MethodConfigurationSchema.safeParse({ ...method, tenantShopId: 'other' }).success).toBe(false);
  expect(MethodConfigurationSchema.safeParse({ ...method, explanation: 'x'.repeat(241) }).success).toBe(false);
});

it('still parses stored drafts that carry a legacy unassigned review', () => {
  const field = { source: 'catalog', value: 'Print' };
  const binding = {
    catalogMethodId: method.id,
    observedVersion: '2',
    name: field,
    explanation: field,
    translations: {},
    prices: {},
    review: { reason: 'unassigned', catalogVersion: '2', decision: 'pending', assignmentKey: 'a'.repeat(64) },
  };
  expect(MethodDraftBindingSchema.parse(binding).review?.reason).toBe('unassigned');
});
