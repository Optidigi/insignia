/** Local Methods presentation helpers; not production catalog commands. */
import {
  type MethodConfiguration,
  type MethodProduct,
  productReadiness,
  productsUsing,
} from './method-configuration.mts';
import { formatPrice, parsePrice } from './method-workflow-prices.mts';

export const methodPreviewLimit = 100;
export function methodPriceLabel(method: MethodConfiguration): string {
  if (method.pricing === 'product') return 'Product-specific prices';
  const price = parsePrice(method.amount);
  if (price.kind !== 'valid') return 'Price not set';
  return price.minor === 0n ? 'Free decoration' : `${formatPrice(price.minor)} per placement, per garment`;
}
export function duplicateConfiguration(
  source: MethodConfiguration,
  methods: readonly MethodConfiguration[],
  id: string,
): MethodConfiguration {
  const names = new Set(methods.map((method) => method.name.trim().toLocaleLowerCase()));
  let index = 1;
  let name: string;
  do {
    const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
    name = `${source.name
      .trim()
      .slice(0, 80 - suffix.length)
      .trimEnd()}${suffix}`;
    index++;
  } while (names.has(name.toLocaleLowerCase()));
  return {
    ...source,
    id,
    name,
    // A copy starts without the source's legacy assignment values.
    assignment: 'manual',
    productIds: [],
    tags: [],
    tagMatch: 'any',
  };
}
function csvCell(value: string): string {
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
/** Readable audit summary, not a restorable backup of product configurations. */
export function methodSummaryCsv(methods: readonly MethodConfiguration[], products: readonly MethodProduct[], currency = 'EUR', methodCurrencies: Record<string, string> = {}): string {
  const rows = [
    [
      'Method',
      'Description',
      'Default pricing',
      'Fixed price',
      'Currency',
      'Charging unit',
      'Available on',
      'Products using',
      'Products needing setup',
    ],
    ...methods.map((method) => {
      const scope = productsUsing(method, products);
      const price = parsePrice(method.amount);
      const amount =
        method.pricing === 'fixed' && price.kind === 'valid'
          ? `${price.minor / 100n}.${String(price.minor % 100n).padStart(2, '0')}`
          : '';
      return [
        method.name,
        method.explanation,
        method.pricing === 'fixed' ? 'Fixed price' : 'Product-specific prices',
        amount,
        method.pricing === 'fixed' ? methodCurrencies[method.id] ?? currency : '',
        method.pricing === 'fixed' ? 'Per location per item' : '',
        'All products',
        String(scope.length),
        String(scope.filter((product) => !productReadiness(method, product).ready).length),
      ];
    }),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
export function downloadMethodSummary(
  methods: readonly MethodConfiguration[],
  products: readonly MethodProduct[],
  currency = 'EUR',
  methodCurrencies: Record<string, string> = {},
): void {
  const url = URL.createObjectURL(new Blob([methodSummaryCsv(methods, products, currency, methodCurrencies)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `decoration-methods-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
