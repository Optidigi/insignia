/** Local UI exploration only. These policies are not production catalog contracts. */
import { z } from 'zod';
import { parsePrice } from './method-workflow-prices.mts';

export const methodConfigurationSchema = z.object({
  id: z.string(),
  name: z.string(),
  explanation: z.string(),
  pricing: z.enum(['fixed', 'product']),
  amount: z.string(),
  assignment: z.enum(['manual', 'tags']),
  productIds: z.array(z.string()),
  tags: z.array(z.string()),
  tagMatch: z.enum(['any', 'all']),
});
export const methodProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  configurationProductId: z.string().optional(),
  image: z.string(),
  tags: z.array(z.string()),
  collections: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  setup: z.array(
    z.object({
      methodId: z.string(),
      locations: z.number().int().nonnegative(),
      pricedLocations: z.number().int().nonnegative(),
    }),
  ),
});
export const methodPreviewSchema = z.object({
  methods: z.array(methodConfigurationSchema).max(100),
  products: z.array(methodProductSchema),
});
export type MethodConfiguration = z.infer<typeof methodConfigurationSchema>;
export type MethodProduct = z.infer<typeof methodProductSchema>;
export type MethodValidationReason = 'invalid-name' | 'invalid-price' | 'missing-tags';
export type MethodErrors = Partial<Record<'name' | 'amount' | 'tags', MethodValidationReason>>;

export function newMethod(): MethodConfiguration {
  return {
    id: '',
    name: '',
    explanation: '',
    pricing: 'fixed',
    amount: '',
    assignment: 'manual',
    productIds: [],
    tags: [],
    tagMatch: 'any',
  };
}
export function methodErrors(method: MethodConfiguration): MethodErrors {
  const errors: MethodErrors = {};
  if (
    !method.name.trim() ||
    method.name.trim().length > 80 ||
    [...method.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    errors.name = 'invalid-name';
  if (method.pricing === 'fixed' && parsePrice(method.amount).kind !== 'valid') errors.amount = 'invalid-price';
  if (method.assignment === 'tags' && !method.tags.length) errors.tags = 'missing-tags';
  return errors;
}
export function assignedProducts(method: MethodConfiguration, products: readonly MethodProduct[]): MethodProduct[] {
  if (method.assignment === 'manual') {
    const ids = new Set(method.productIds);
    return products.filter((product) => ids.has(product.id));
  }
  if (!method.tags.length) return [];
  return products.filter((product) =>
    method.tagMatch === 'all'
      ? method.tags.every((tag) => product.tags.includes(tag))
      : method.tags.some((tag) => product.tags.includes(tag)),
  );
}
export function productReadiness(
  method: MethodConfiguration,
  product: MethodProduct,
): { ready: boolean; locations: number; reason: 'configure-locations' | 'add-product-prices' | 'ready' } {
  const setup = product.setup.find((item) => item.methodId === method.id);
  if (!setup?.locations) return { ready: false, locations: 0, reason: 'configure-locations' };
  if (setup.pricedLocations < setup.locations)
    return { ready: false, locations: setup.locations, reason: 'add-product-prices' };
  return { ready: true, locations: setup.locations, reason: 'ready' };
}
