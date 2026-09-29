/** M1 boundaries over the actual source graph, including type imports. */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure', severity: 'error',
      from: { path: '^packages/domain/src/' },
      to: { pathNot: '^packages/domain/src/' },
    },
    {
      name: 'browser-does-not-import-server', severity: 'error',
      from: { path: '^(apps/storefront/src/|apps/web/src/islands/|packages/contracts/src/)' },
      to: { path: '^(apps/worker/|packages/(shopify|artwork|database|observability|signer)/|(?:node:)?(?:fs|http|https|net|crypto|child_process)$)' },
    },
    {
      name: 'runtime-does-not-import-spikes', severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { path: '^spikes/' },
    },
    {
      name: 'shopify-sdk-only-in-adapter', severity: 'error',
      from: { pathNot: '^packages/shopify/' },
      to: { path: '(^|/)@shopify/shopify-api(/|$)' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)(node_modules|dist|\\.astro|test)(/|$)|\\.test\\.',
  },
};
