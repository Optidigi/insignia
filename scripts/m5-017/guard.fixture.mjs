// Offline proof: the captured transport can only reach the parent loopback server.
const [variant, address] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) throw new Error('Loopback only');
const loopback = globalThis.fetch;
let nativeCalls = 0;
globalThis.fetch = async (url, init) => {
  nativeCalls++;
  return loopback(address, { method: 'POST', body: JSON.stringify({ url, body: JSON.parse(init.body) }) });
};
await import('./guard.mjs');
if (variant === 'imports') {
  await import('./entry.mjs');
  await import('./qualification.mjs');
  await import('./provider.fixture.mjs');
  process.stdout.write(
    JSON.stringify({ nativeCalls, immutable: Object.getOwnPropertyDescriptor(globalThis, 'fetch').writable === false }),
  );
  process.exit(0);
}
const { createShopifyAvailabilityHoldV3Port } = await import('../../packages/shopify/dist/index.js');
const { SCOPE, TARGET } = await import('./documents.mjs');
const config = {
  isCurrent: () => true,
  credentials: {
    acquire: async () => ({
      kind: 'usable',
      shopDomain: TARGET.domain,
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date(Date.now() + 3600000),
    }),
  },
};
if (variant === 'correct') {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createGuardedOperator } = await import('./guard.mjs');
  const { IDENTITY, OWNED, CREATE, STATUS, productionDocuments } = await import('./documents.mjs');
  const { ROOT } = await import('./qualification.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'insignia-m5-017-native-proof-'));
  try {
    const op = createGuardedOperator({
      directory,
      phase: 'start',
      binding: { loopbackProof: true },
      documents: productionDocuments(ROOT),
      assertCurrent: () => {},
    });
    const auth = await (
      await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: TARGET.client,
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      })
    ).json();
    op.setToken({ accessToken: auth.access_token, expiresAt: Date.now() + auth.expires_in * 1000 });
    const request = async (query, variables = {}) =>
      (
        await (
          await op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'x-shopify-access-token': auth.access_token },
            body: JSON.stringify({ query, variables }),
          })
        ).json()
      ).data;
    await request(IDENTITY);
    op.mode('create');
    const marker = op.state().marker;
    const product = (
      await request(CREATE, { product: { title: marker, handle: marker, tags: [marker], status: 'DRAFT' } })
    ).productCreate.product;
    await request(OWNED, { id: product.id });
    const port = createShopifyAvailabilityHoldV3Port({
      ...config,
      fetchImpl: op.fetch,
      isCurrent: (scope) => op.isCurrent(scope),
    });
    op.mode('draft');
    await port.snapshot(SCOPE, product.id, 'v3');
    op.reserve('setup');
    op.mode('setup');
    await request(STATUS, { product: { id: product.id, status: 'ACTIVE' } });
    await request(OWNED, { id: product.id });
    op.mode('before');
    await port.snapshot(SCOPE, product.id, 'v3');
    op.close();
    process.stdout.write(
      JSON.stringify({
        nativeCalls,
        immutable: Object.getOwnPropertyDescriptor(globalThis, 'fetch').writable === false,
        audit: op.transportAudit(),
        events: op.state().events.length,
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  process.exit(0);
}
if (variant === 'misspelled')
  config.fetch = async () => {
    throw new Error('unused');
  };
let denial;
try {
  await createShopifyAvailabilityHoldV3Port(config).snapshot(SCOPE, 'gid://shopify/Product/202', 'v3');
} catch (error) {
  denial = error.code ?? error.kind ?? error.message;
}
process.stdout.write(
  JSON.stringify({
    denial,
    nativeCalls,
    immutable: Object.getOwnPropertyDescriptor(globalThis, 'fetch').writable === false,
  }),
);
