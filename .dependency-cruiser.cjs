/** M1 boundaries over the actual source graph, including type imports. */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^packages/domain/src/' },
      to: { pathNot: '^packages/domain/src/' },
    },
    {
      name: 'browser-does-not-import-server',
      severity: 'error',
      from: { path: '^(apps/storefront/src/|apps/web/src/islands/|packages/contracts/src/)' },
      to: { path: '^(apps/worker/|packages/(shopify|artwork|database|observability|signer)/)' },
    },
    {
      name: 'browser-no-node-builtins',
      severity: 'error',
      from: { path: '^(apps/storefront/src/|apps/web/src/islands/|packages/contracts/src/)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'runtime-does-not-import-spikes',
      severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { path: '^spikes/' },
    },
    {
      name: 'database-internals-stay-in-adapter',
      severity: 'error',
      from: { path: '^(apps/|packages/(?!database/))' },
      to: { path: '^packages/database/(src|dist)/' },
    },
    {
      name: 'shopify-sdk-only-in-adapter',
      severity: 'error',
      from: { pathNot: '^packages/shopify/' },
      to: { path: '(^|/)@shopify/shopify-api(/|$)' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)(node_modules|\\.astro|test)(/|$)|\\.test\\.',
  },
};
