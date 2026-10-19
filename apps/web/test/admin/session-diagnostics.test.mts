import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { adminActor, adminServices } from './support/fixtures.mts';

test('HTTP rejects absent/malformed bearer before authentication and records only bounded stage', async () => {
  for (const [authorization, stage] of [
    [null, 'BEARER_MISSING'],
    ['Basic private', 'BEARER_MALFORMED'],
    [`Bearer ${'a'.repeat(8193)}`, 'BEARER_MALFORMED'],
  ] as const) {
    const stages: string[] = [];
    const response = await handleAdminRequest(
      new Request('https://app.example/api/admin/products?id_token=private', {
        headers: authorization === null ? {} : { Authorization: authorization },
      }),
      adminServices({
        authenticate: async () => {
          assert.fail('invalid bearer reached authentication');
        },
        recordAuthenticationRejection: (value) => stages.push(value),
      }),
      { kind: 'list' },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required' });
    assert.equal(response.headers.get('X-Shopify-Retry-Invalid-Session-Request'), null);
    assert.deepEqual(stages, [stage]);
  }
});

test('HTTP records rejected non-null actor without leaking identity or allowing catalog access', async () => {
  const stages: string[] = [];
  const response = await handleAdminRequest(
    new Request('https://app.example/api/admin/products', {
      headers: { Authorization: 'Bearer synthetic' },
    }),
    adminServices({
      authenticate: async () => adminActor({ shop: 'private-invalid' }),
      recordAuthenticationRejection: (stage) => stages.push(stage),
      catalog: {
        list: async () => {
          assert.fail('rejected actor reached catalog');
        },
      },
    }),
    { kind: 'list' },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(stages, ['AUTHENTICATED_ACTOR_REJECTED']);
});

test('production composition and HTTP preserve 401 while real SDK diagnostics expose only fixed stages', async () => {
  const output = new URL('../../.astro/m5-session-diagnostics.mjs', import.meta.url);
  await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
  await build({
    entryPoints: [new URL('../../src/server/admin/production.ts', import.meta.url).pathname],
    outfile: output.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const script = `
    import assert from 'node:assert/strict';
    import { createHmac } from 'node:crypto';
    import { createProductionAdminServices } from ${JSON.stringify(output.href)};
    import { handleAdminRequest } from ${JSON.stringify(new URL('../../src/server/admin/http.ts', import.meta.url).href)};
    globalThis.fetch = async () => { assert.fail('early rejection attempted provider access'); };
    const services = createProductionAdminServices({
      DATABASE_URL: 'postgresql://synthetic-unused', SHOPIFY_CLIENT_ID: 'synthetic-client',
      SHOPIFY_CLIENT_SECRET: 'synthetic-current-secret', APP_URL: 'https://app.example',
    }, { query: async () => { assert.fail('early rejection attempted database access'); } });
    function token(overrides = {}, signingSecret = 'synthetic-current-secret') {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: 'https://alpha.myshopify.com/admin', dest: 'https://alpha.myshopify.com',
        aud: 'synthetic-client', sub: '23', sid: 'synthetic-session', iat: now, nbf: now - 1, exp: now + 60, ...overrides })).toString('base64url');
      const unsigned = header + '.' + payload;
      return unsigned + '.' + createHmac('sha256', signingSecret).update(unsigned).digest('base64url');
    }
    for (const authorization of [null, 'Basic synthetic-private', 'Bearer malformed',
      'Bearer ' + token({}, 'synthetic-prior-secret'), 'Bearer ' + token({ aud: 'wrong-client' }),
      'Bearer ' + token({ exp: 1 }), 'Bearer ' + token({ nbf: Math.floor(Date.now()/1000) + 60 }),
      'Bearer ' + token({ sub: '0' })]) {
      const response = await handleAdminRequest(new Request('https://app.example/api/admin/products?id_token=synthetic-private', {
        headers: authorization === null ? {} : { Authorization: authorization },
      }), services, { kind: 'list' });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Authentication required' });
      assert.equal(response.headers.get('X-Shopify-Retry-Invalid-Session-Request'), null);
    }
  `;
  const logged = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const records = logged
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((record) => record.authStage),
    [
      'BEARER_MISSING',
      'BEARER_MALFORMED',
      'SESSION_TOKEN_FORMAT_REJECTED',
      'SESSION_TOKEN_SIGNATURE_REJECTED',
      'SESSION_TOKEN_AUDIENCE_REJECTED',
      'SESSION_TOKEN_TIME_REJECTED',
      'SESSION_TOKEN_TIME_REJECTED',
      'SESSION_IDENTITY_REJECTED',
    ],
  );
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), [
      'authStage',
      'correlationId',
      'event',
      'level',
      'statusClass',
      'time',
    ]);
    assert.equal(record.event, 'admin_authentication');
    assert.equal(record.statusClass, 'failure');
    assert.match(record.correlationId, /^[0-9a-f-]{36}$/);
  }
  assert.equal(new Set(records.map((record) => record.correlationId)).size, records.length);
  assert.doesNotMatch(logged, /synthetic|Bearer|staffId|sessionId|id_token|shop=|host=|cause|error/);
});
