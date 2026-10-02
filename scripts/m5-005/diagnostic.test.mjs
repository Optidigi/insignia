import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diagnoseSynthetic } from './diagnostic.mjs';

const target = {
  shop: 'gid://shopify/Shop/105501393179',
  domain: 'insignia-rewrite-dev.myshopify.com',
  app: 'gid://shopify/App/429028933633',
  client: '1443cf6d03d39edae7c101a943c5c684',
  installation: 'gid://shopify/AppInstallation/1054356963611',
};
function identity(scopes = []) {
  return {
    shop: {
      id: target.shop,
      myshopifyDomain: target.domain,
      plan: { partnerDevelopment: true, displayName: 'Basic App Development' },
    },
    currentAppInstallation: {
      id: target.installation,
      app: { id: target.app, apiKey: target.client },
      accessScopes: scopes,
    },
  };
}
test('one actual diagnostic sequence keeps empty installation distinct from nonempty token/REST/declarations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5005-'));
  let sends = 0;
  try {
    const result = await diagnoseSynthetic({
      directory,
      credentials: () => ({ secret: 'synthetic-secret' }),
      fetchImpl: async (url, init) => {
        sends++;
        assert.equal(init.redirect, 'error');
        if (url.endsWith('/access_token'))
          return Response.json({
            access_token: 'synthetic-bearer',
            expires_in: 86400,
            scope: 'read_products,write_products',
          });
        assert.equal(init.headers['x-shopify-access-token'], 'synthetic-bearer');
        if (url.endsWith('/access_scopes.json'))
          return Response.json({ access_scopes: [{ handle: 'write_products' }, { handle: 'read_products' }] });
        const { query } = JSON.parse(init.body);
        if (query.includes('M5005Identity')) return Response.json({ data: identity() });
        return Response.json({
          data: {
            currentAppInstallation: {
              id: target.installation,
              app: {
                id: target.app,
                apiKey: target.client,
                requestedAccessScopes: [{ handle: 'read_products' }],
                optionalAccessScopes: [],
              },
            },
          },
        });
      },
    });
    assert.equal(result.outcome, 'OBSERVATIONS_COMPLETE');
    assert.equal(sends, 4);
    assert.equal(result.observations.identity.scopes.state, 'EMPTY');
    assert.deepEqual(result.observations.auth.scopes.handles, ['read_products', 'write_products']);
    assert.deepEqual(result.observations.rest.scopes.handles, ['read_products', 'write_products']);
    assert.equal(result.comparison.tokenVsInstallation, 'DIFFERENT');
    const disk = readFileSync(join(directory, 'register.json'), 'utf8');
    assert.ok(!disk.includes('synthetic-secret') && !disk.includes('synthetic-bearer'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function sample(options = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), 'm5005-case-'));
  const sent = [];
  const result = await diagnoseSynthetic({
    directory,
    credentials: options.credentials ?? (() => ({ secret: 'synthetic-secret' })),
    deadlineMs: options.deadlineMs ?? 12000,
    requestTransform: options.requestTransform,
    validated: options.validated,
    fetchImpl: async (url, init) => {
      sent.push({ url, method: init.method });
      if (options.fetchImpl) return options.fetchImpl(url, init, sent);
      if (url.endsWith('/access_token'))
        return Response.json(options.auth ?? { access_token: 'synthetic-bearer', expires_in: 86400, scope: '' });
      if (url.endsWith('/access_scopes.json'))
        return Response.json(options.rest ?? { access_scopes: [] }, { status: options.restStatus ?? 200 });
      const b = JSON.parse(init.body);
      if (b.query.includes('Identity')) return Response.json(options.identity ?? { data: identity() });
      return Response.json(
        options.declared ?? {
          data: {
            currentAppInstallation: {
              id: target.installation,
              app: { id: target.app, apiKey: target.client, requestedAccessScopes: [], optionalAccessScopes: [] },
            },
          },
        },
        { status: options.declaredStatus ?? 200 },
      );
    },
  });
  return { directory, result, sent };
}
test('partial stream failure is UNKNOWN and cannot allow a later independent read', async () => {
  const { directory, result, sent } = await sample({
    fetchImpl: async (_url, _init, sends) => {
      if (sends.length === 1) return Response.json({ access_token: 'synthetic-bearer', expires_in: 86400 });
      if (sends.length === 2) return Response.json({ data: identity() });
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"data":'));
            c.error(new Error('synthetic failure'));
          },
        }),
      );
    },
  });
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(sent.length, 3);
    assert.equal(result.events[2].result, 'UNKNOWN');
    assert.equal(result.counts.rest, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('permission/shape metadata error does not become an empty grant agreement', async () => {
  const { directory, result, sent } = await sample({
    declared: { errors: [{ extensions: { code: 'ACCESS_DENIED' }, message: 'must not persist synthetic-bearer' }] },
    declaredStatus: 403,
    rest: { access_scopes: [] },
    restStatus: 403,
  });
  try {
    assert.equal(sent.length, 4);
    assert.equal(result.outcome, 'OBSERVATIONS_COMPLETE');
    assert.equal(result.comparison.restVsInstallation, 'UNKNOWN');
    assert.equal(result.observations.declared.requested.state, 'MISSING');
    assert.ok(!readFileSync(join(directory, 'register.json'), 'utf8').includes('synthetic-bearer'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('metadata shape failure still permits the independent REST read', async () => {
  const x = await sample({ declared: { data: { currentAppInstallation: { app: { requestedAccessScopes: null } } } } });
  try {
    assert.equal(x.sent.length, 4);
    assert.equal(x.result.observations.declared.requested.state, 'NULL');
    assert.equal(x.result.observations.declared.optional.state, 'MISSING');
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
for (const [name, value, state] of [
  ['missing', undefined, 'MISSING'],
  ['null', null, 'NULL'],
  ['empty', [], 'EMPTY'],
  ['wrong-type', {}, 'MALFORMED'],
  ['duplicates', [{ handle: 'read_products' }, { handle: 'read_products' }], 'MALFORMED'],
  ['bad-handle', [{ handle: 'synthetic-bearer' }], 'MALFORMED'],
]) {
  test(`public sequence preserves ${name} installation/REST scope semantics`, async () => {
    const i = identity();
    if (value === undefined) delete i.currentAppInstallation.accessScopes;
    else i.currentAppInstallation.accessScopes = value;
    const x = await sample({ identity: { data: i }, rest: value === undefined ? {} : { access_scopes: value } });
    try {
      assert.equal(x.sent.length, 4);
      assert.equal(x.result.observations.identity.scopes.state, state);
      assert.equal(x.result.observations.rest.scopes.state, state);
      assert.ok(!readFileSync(join(x.directory, 'register.json'), 'utf8').includes('synthetic-bearer'));
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
}
for (const [name, value, state] of [
  ['missing', undefined, 'MISSING'],
  ['null', null, 'NULL'],
  ['empty', '', 'EMPTY'],
  ['wrong-type', [], 'MALFORMED'],
  ['duplicate', 'read_products,read_products', 'MALFORMED'],
  ['bad-handle', 'not_a_scope', 'MALFORMED'],
]) {
  test(`token ${name} is recorded separately without preventing identity verification`, async () => {
    const auth = { access_token: 'synthetic-bearer', expires_in: 86400 };
    if (value !== undefined) auth.scope = value;
    const x = await sample({ auth });
    try {
      assert.equal(x.sent.length, 4);
      assert.equal(x.result.observations.auth.scopes.state, state);
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
}
for (const field of ['shop', 'domain', 'app', 'client', 'installation', 'development'])
  test(`wrong ${field} identity stops after exactly two attempts`, async () => {
    const i = identity();
    if (field === 'shop') i.shop.id = 'gid://shopify/Shop/1';
    if (field === 'domain') i.shop.myshopifyDomain = 'wrong.myshopify.com';
    if (field === 'app') i.currentAppInstallation.app.id = 'gid://shopify/App/1';
    if (field === 'client') i.currentAppInstallation.app.apiKey = 'wrong';
    if (field === 'installation') i.currentAppInstallation.id = 'gid://shopify/AppInstallation/1';
    if (field === 'development') i.shop.plan.partnerDevelopment = false;
    const x = await sample({ identity: { data: i } });
    try {
      assert.equal(x.sent.length, 2);
      assert.equal(x.result.stop, 'identity');
      assert.equal(x.result.counts.rest, 0);
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
test('explicit mismatched declared identity stops before REST', async () => {
  const x = await sample({ declared: { data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1' } } } });
  try {
    assert.equal(x.sent.length, 3);
    assert.equal(x.result.stop, 'declared_identity');
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test('token-invalid metadata response stops all later work', async () => {
  const x = await sample({ declared: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] } });
  try {
    assert.equal(x.sent.length, 3);
    assert.equal(x.result.stop, 'token_invalid');
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test('offline unvalidated metadata is NOT_RUN without live document fallback', async () => {
  const x = await sample({ validated: { identity: true, declared: false } });
  try {
    assert.equal(x.sent.length, 3);
    assert.equal(x.result.counts.declared, 0);
    assert.equal(x.result.observations.declared.outcome, 'NOT_RUN');
    assert.equal(x.result.counts.rest, 1);
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test('unvalidated identity document stops before credential access', async () => {
  let reads = 0;
  const x = await sample({
    validated: { identity: false, declared: true },
    credentials: () => {
      reads++;
      throw Error('unexpected');
    },
  });
  try {
    assert.equal(reads, 0);
    assert.equal(x.sent.length, 0);
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
for (const [name, change] of [
  ['host', (r) => ({ ...r, url: r.url.replace(target.domain, 'other.myshopify.com') })],
  ['API', (r) => ({ ...r, url: r.url.replace('2026-07', '2025-01') })],
  ['method', (r) => ({ ...r, init: { ...r.init, method: 'DELETE' } })],
  [
    'document',
    (r) => ({ ...r, init: { ...r.init, body: JSON.stringify({ query: 'query { shop { name } }', variables: {} }) } }),
  ],
  [
    'mutation',
    (r) => ({
      ...r,
      init: {
        ...r.init,
        body: JSON.stringify({ query: 'mutation { productDelete { deletedProductId } }', variables: {} }),
      },
    }),
  ],
  [
    'variables',
    (r) => ({
      ...r,
      init: { ...r.init, body: JSON.stringify({ ...JSON.parse(r.init.body), variables: { id: 'unexpected' } }) },
    }),
  ],
])
  test(`actual entrypoint prevents ${name} dispatch`, async () => {
    const x = await sample({ requestTransform: (r) => (r.url.endsWith('/graphql.json') ? change(r) : r) });
    try {
      assert.equal(x.sent.length, 1);
      assert.equal(x.result.events[1].result, 'NOT_SENT');
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
for (const [name, change] of [
  ['query', (r) => ({ ...r, url: `${r.url}?limit=1` })],
  ['body', (r) => ({ ...r, init: { ...r.init, body: '{}' } })],
])
  test(`fixed REST GET prevents ${name}`, async () => {
    const x = await sample({ requestTransform: (r) => (r.url.endsWith('/access_scopes.json') ? change(r) : r) });
    try {
      assert.equal(x.sent.length, 3);
      assert.equal(x.result.events[3].result, 'NOT_SENT');
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
test('canonical history cannot be reopened, exhausted, corrupted or reset after loss', async () => {
  const x = await sample();
  let reads = 0,
    sends = 0;
  const again = () =>
    diagnoseSynthetic({
      directory: x.directory,
      credentials: () => {
        reads++;
        return { secret: 'synthetic-secret' };
      },
      fetchImpl: () => {
        sends++;
        throw Error('forbidden');
      },
    });
  try {
    await assert.rejects(again);
    assert.equal(reads + sends, 0);
    const { writeFileSync, unlinkSync } = await import('node:fs');
    writeFileSync(join(x.directory, 'register.json'), '{corrupt');
    await assert.rejects(again);
    unlinkSync(join(x.directory, 'register.json'));
    await assert.rejects(again);
    assert.equal(reads + sends, 0);
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test('expired credential preparation never dispatches a late HTTP call and retains pending lock', async () => {
  let release;
  const delayed = new Promise((r) => {
    release = r;
  });
  const x = await sample({ deadlineMs: 15, credentials: () => delayed });
  try {
    assert.equal(x.sent.length, 0);
    assert.equal(x.result.events[0].result, 'NOT_SENT');
    assert.equal(x.result.pendingAtClose, 1);
    release({ secret: 'synthetic-secret' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(x.sent.length, 0);
    assert.ok(readFileSync(join(x.directory, 'register.json'), 'utf8').includes('NOT_SENT'));
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test('ignored abort and late HTTP completion remain UNKNOWN with no later request or evidence rewrite', async () => {
  let release;
  const delayed = new Promise((r) => {
    release = r;
  });
  const x = await sample({ deadlineMs: 15, fetchImpl: () => delayed });
  try {
    assert.equal(x.sent.length, 1);
    assert.equal(x.result.events[0].result, 'UNKNOWN');
    assert.equal(x.result.lockReleased, false);
    const before = readFileSync(join(x.directory, 'register.json'), 'utf8');
    release(Response.json({ access_token: 'synthetic-bearer', expires_in: 86400 }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(x.sent.length, 1);
    assert.equal(readFileSync(join(x.directory, 'register.json'), 'utf8'), before);
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
for (const [name, response, expected] of [
  ['oversized', () => new Response('a'.repeat(128 * 1024 + 1)), 'OVERSIZED_BODY'],
  ['invalid-UTF8', () => new Response(new Uint8Array([255])), 'INVALID_UTF8'],
  ['invalid-JSON', () => new Response('{'), 'INVALID_JSON'],
  ['missing-body', () => new Response(null), 'MISSING_BODY'],
])
  test(`metadata ${name} is shape evidence and allows independent REST`, async () => {
    const x = await sample({
      fetchImpl: async (_url, _init, sends) =>
        sends.length === 1
          ? Response.json({ access_token: 'synthetic-bearer', expires_in: 86400 })
          : sends.length === 2
            ? Response.json({ data: identity() })
            : sends.length === 3
              ? response()
              : Response.json({ access_scopes: [] }),
    });
    try {
      assert.equal(x.sent.length, 4);
      assert.equal(x.result.observations.declared.bodyState, expected);
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
for (const auth of [
  { access_token: 'synthetic-bearer', expires_in: 1 },
  { access_token: 'synthetic-bearer\n', expires_in: 86400 },
  { access_token: null, expires_in: 86400 },
])
  test('unusable authentication never authorizes a read', async () => {
    const x = await sample({ auth });
    try {
      assert.equal(x.sent.length, 1);
      assert.equal(x.result.stop, 'unusable_authentication');
    } finally {
      rmSync(x.directory, { recursive: true, force: true });
    }
  });
test('synthetic entry cannot override its mode to admit a nonsynthetic bearer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5005-mode-'));
  try {
    const x = await diagnoseSynthetic({
      directory,
      synthetic: false,
      credentials: () => ({ secret: 'synthetic-secret' }),
      fetchImpl: async () => Response.json({ access_token: 'non-test', expires_in: 86400 }),
    });
    assert.equal(x.stop, 'synthetic_bearer');
    assert.equal(x.mode, 'SYNTHETIC_OFF_STORE');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('pinned documented fields validate both exact documents and reject mutation/extra/unknown syntax', async () => {
  const { validateDocument, validatedDocuments, IDENTITY, DECLARED } = await import('./schema-contract.mjs');
  assert.deepEqual(validatedDocuments(), { identity: true, declared: true });
  assert.equal(validateDocument(IDENTITY), true);
  assert.equal(validateDocument(DECLARED), true);
  for (const q of [
    DECLARED.replace('requestedAccessScopes', 'availableAccessScopes'),
    IDENTITY.replace('query', 'mutation'),
    `${IDENTITY} query Extra { shop { id } }`,
    IDENTITY.replace('id myshopifyDomain', 'id id myshopifyDomain'),
  ])
    assert.throws(() => validateDocument(q));
});
test('live entrypoint rejects an unbound offline gate before owner credential metadata', async () => {
  const { diagnose } = await import('./diagnostic.mjs');
  await assert.rejects(
    () => diagnose({ binding: { source: 'not-this-source', modules: {} }, gate: {} }),
    /source_binding/,
  );
});
test('complete source/CI/review gate accepts exact receipts and rejects omitted/stale/altered evidence', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { freeze, digest, verifyGate, BASE, WORKFLOWS } = await import('./binding.mjs');
  const root = mkdtempSync(join(tmpdir(), 'm5005-gate-')),
    evidenceRoot = join(root, 'run');
  try {
    for (const dir of [
      '.github/workflows',
      'scripts/m5-005',
      'scripts/m5-004',
      'packages/shopify/src',
      'packages/shopify/dist',
      'packages/application/src',
      'packages/application/dist',
      'packages/domain/src',
      'packages/domain/dist',
      'packages/contracts/src',
      'packages/contracts/dist',
      'run',
    ])
      mkdirSync(join(root, dir), { recursive: true });
    for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(join(root, path), '{}');
    writeFileSync(join(root, '.gitignore'), 'run/\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic'],
      { cwd: root },
    );
    const binding = freeze(root),
      bindingDigest = digest(JSON.stringify(binding));
    const artifact = (name, content) => {
      const path = join(evidenceRoot, name);
      writeFileSync(path, content);
      return { path, sha256: digest(content) };
    };
    const gate = {
      source: binding.source,
      base: BASE,
      bindingDigest,
      offline: {
        source: binding.source,
        bindingDigest,
        exitCode: 0,
        report: artifact('offline.log', 'synthetic PASS'),
      },
      reviews: ['spec', 'security'].map((role, i) => {
        const thread = `00000000-0000-0000-0000-00000000000${i}`;
        return {
          role,
          thread,
          base: BASE,
          head: binding.source,
          bindingDigest,
          model: 'gpt-6.1-sol',
          effort: 'high',
          sandbox: 'read-only',
          verdict: 'no unresolved material finding',
          report: artifact(`${role}.md`, 'synthetic full-source report'),
          settings: artifact(
            `${role}.json`,
            JSON.stringify({
              role,
              thread,
              selectedSameLaunchContext: [
                {
                  cwd: root,
                  model: 'gpt-6.1-sol',
                  effort: 'high',
                  sandbox_policy: { type: 'read-only' },
                  approval_policy: 'never',
                },
              ],
            }),
          ),
        };
      }),
      ci: WORKFLOWS.map((workflowName, i) => ({
        workflowName,
        headSha: binding.source,
        status: 'completed',
        conclusion: 'success',
        databaseId: i + 9000,
        url: `https://github.com/Optidigi/insignia/actions/runs/${i + 9000}`,
      })),
    };
    const verify = (g) => verifyGate(root, g, binding, { evidenceRoot });
    verify(gate);
    for (const change of [
      (g) => g.ci.pop(),
      (g) => (g.ci[0].headSha = 'stale'),
      (g) => (g.ci[0].conclusion = 'failure'),
      (g) => (g.reviews[0].head = 'stale'),
      (g) => (g.reviews[0].model = 'other'),
      (g) => (g.reviews[1].thread = g.reviews[0].thread),
      (g) => (g.offline.exitCode = 1),
      (g) => (g.base = 'stale'),
    ]) {
      const bad = structuredClone(gate);
      change(bad);
      assert.throws(() => verify(bad), /offline_gate/);
    }
    writeFileSync(gate.reviews[0].report.path, 'altered');
    assert.throws(() => verify(gate), /gate_artifact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('captured four-surface empty scope result replays through the public sequence without authorizing repair', async () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../docs/delivery/evidence/m5-005/captured-scope-fixture.json', import.meta.url)),
  );
  const x = await sample({
    auth: { access_token: 'synthetic-captured-bearer', expires_in: 86400, scope: fixture.authScope },
    identity: { data: identity(fixture.installationScopes) },
    declared: {
      data: {
        currentAppInstallation: {
          id: target.installation,
          app: {
            id: target.app,
            apiKey: target.client,
            requestedAccessScopes: fixture.requestedScopes,
            optionalAccessScopes: fixture.optionalScopes,
          },
        },
      },
    },
    rest: { access_scopes: fixture.restScopes },
  });
  try {
    assert.equal(x.result.outcome, 'OBSERVATIONS_COMPLETE');
    assert.equal(x.sent.length, 4);
    assert.deepEqual(x.result.counts, { auth: 1, identity: 1, declared: 1, rest: 1 });
    for (const scope of [
      x.result.observations.auth.scopes,
      x.result.observations.identity.scopes,
      x.result.observations.declared.requested,
      x.result.observations.declared.optional,
      x.result.observations.rest.scopes,
    ]) {
      assert.equal(scope.state, 'EMPTY');
      assert.deepEqual(scope.handles, []);
    }
    assert.deepEqual(x.result.comparison, { tokenVsInstallation: 'SAME', restVsInstallation: 'SAME' });
    assert.equal(x.result.pendingAtClose, 0);
    assert.equal(x.result.lockReleased, true);
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
