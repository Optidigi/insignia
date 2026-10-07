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
const { createShopifyAvailabilityHoldV2Port } = await import('../../packages/shopify/dist/index.js');
const { TARGET } = await import('./documents.mjs');
const { SCOPE } = await import('../m5-015r/documents.mjs');
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
  const { PRESTATE, DIRECT, PUBLICATIONS, CATALOGS, ARCHIVE, FINAL, FIXTURE } = await import('./documents.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'insignia-m5-016-native-proof-'));
  try {
    const op = createGuardedOperator({ directory, binding: { loopbackProof: true }, assertCurrent: () => {} });
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
    for (const [mode, query, variables] of [
      ['prestate', PRESTATE, {}],
      ['direct', DIRECT, {}],
      ['publications', PUBLICATIONS, { after: null }],
      ['catalogs', CATALOGS, { after: null }],
    ]) {
      op.mode(mode);
      await request(query, variables);
    }
    op.patch((s) => {
      s.adjudicated = true;
    });
    op.mode('archive');
    await request(ARCHIVE, { product: { id: FIXTURE, status: 'ARCHIVED' } });
    op.mode('final');
    await request(FINAL);
    op.close({ synthetic: true });
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
  await createShopifyAvailabilityHoldV2Port(config).snapshot(SCOPE, 'gid://shopify/Product/202', 'v2');
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
