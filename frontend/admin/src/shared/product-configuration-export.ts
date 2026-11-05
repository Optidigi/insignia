import type { CatalogProduct } from './admin-view.js';

const configurationLabels = {
  not_configured: 'Not configured',
  draft: 'Draft',
  published: 'Published',
  unavailable: 'Unavailable',
};

function cell(value: string): string {
  // Quoting alone does not stop spreadsheets from evaluating a formula.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Snapshot of the selected loaded products, not a complete configuration backup. */
export function productConfigurationCsv(products: readonly CatalogProduct[]): string {
  const rows = [
    [
      'Shopify product ID',
      'Title',
      'Configuration',
      'Methods',
      'Print locations',
      'Variant count',
      'Variants truncated',
    ],
    ...products.map((product) => {
      const summary = product.configurationSummary;
      return [
        product.id,
        product.title,
        summary && (summary.state === 'not_configured' || summary.state === 'draft' || summary.state === 'published')
          ? configurationLabels[summary.state]
          : 'Unavailable',
        summary?.methods?.join('; ') ?? 'Unavailable',
        summary?.locations?.join('; ') ?? 'Unavailable',
        String(product.variants.length),
        product.variantsTruncated ? 'Yes' : 'No',
      ];
    }),
  ];
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
