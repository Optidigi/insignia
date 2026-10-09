import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectInventory, sealAbandonedRun } from './collector.mjs';

const secret = 'synthetic-test-token';
const identity = {
  shop: { id: 'gid://shopify/Shop/123', myshopifyDomain: 'insignia-rewrite-dev.myshopify.com' },
  currentAppInstallation: {
    id: 'gid://shopify/AppInstallation/456',
    app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
    accessScopes: [{ handle: 'write_products' }],
  },
};
const node = (id = 1) => ({
  id: `gid://shopify/WebhookSubscription/${id}`,
  topic: 'APP_UNINSTALLED',
  uri: `https://receiver.invalid/private-capability-${id}`,
  format: 'JSON',
  apiVersion: { handle: '2026-07' },
});
const page = (nodes = [node()], next = false, cursor = null) => ({
  data: {
    ...structuredClone(identity),
    webhookSubscriptions: { nodes, pageInfo: { hasNextPage: next, endCursor: cursor } },
  },
});
function allocation(directory) {
  return {
    schema: 'insignia-native-inventory-allocation-v1',
    status: 'LOOPBACK_TEST',
    ownerApprovalReference: 'SYNTHETIC_TEST_ONLY',
    purpose: 'M5-027 existing shop subscription read',
    endpoint: 'https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json',
    expectedShopId: identity.shop.id,
    expectedInstallationId: identity.currentAppInstallation.id,
    expectedGrants: ['write_products'],
    requiredScopes: [],
    optionalScopes: ['write_products', 'read_publications', 'read_product_listings'],
    allowedOperations: ['M5027WebhookInventory', 'M5027InstallationBoundary'],
    allowedMutations: [],
    incidentalEffects: ['provider-access-audit'],
    privateCredentialChannel: 'inherited-file-descriptor',
    credentialCapability: 'EXISTING_SUPPORTED_EXACT_APP_ADMIN_TOKEN',
    privateEvidenceDirectory: directory,
    retentionOwner: 'synthetic-owner',
    retentionDeleteBy: new Date(Date.now() + 86400000).toISOString(),
    validUntil: new Date(Date.now() + 1800000).toISOString(),
    ceilings: {
      requests: 3,
      pages: 2,
      records: 500,
      responseBytes: 1048576,
      durationMs: 1800000,
      responseTimeoutMs: 1000,
    },
  };
}
async function harness(t, handler) {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-inventory-test-'));
  const directory = join(parent, 'private');
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    res.setHeader('x-shopify-api-version', '2026-07');
    res.setHeader('content-type', 'application/json');
    try {
      await handler({ input, req, res, requests, directory });
    } catch {
      res.writeHead(500);
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  });
  const options = {
    allocation: allocation(directory),
    token: secret,
    privateDirectory: directory,
    testEndpoint: `http://127.0.0.1:${server.address().port}/admin/api/2026-07/graphql.json`,
  };
  return { options, requests, directory };
}
const journal = async (directory) => JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8'));

test('complete one-page collection reserves every attempt durably and returns only opaque observations', async (t) => {
  const h = await harness(t, async ({ input, req, res, directory, requests }) => {
    const account = await journal(directory);
    assert.equal(account.attempts.at(-1).status, 'RESERVED');
    assert.equal(account.attempts.length, requests.length);
    assert.equal(req.headers['x-shopify-access-token'], secret);
    res.end(JSON.stringify(input.operationName === 'M5027InstallationBoundary' ? { data: identity } : page()));
  });
  const result = await collectInventory(h.options);
  assert.deepEqual(result, {
    outcome: 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED',
    requests: 2,
    pages: 1,
    records: 1,
    destinations: [
      { label: 'destination-001', topic: 'APP_UNINSTALLED', transport: 'HTTPS', format: 'JSON', apiVersion: '2026-07' },
    ],
    qualification: 'STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED',
  });
  assert.equal((await journal(h.directory)).sealed, true);
  assert.equal((await stat(h.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(h.directory, 'response-1.body'))).mode & 0o777, 0o600);
  assert.equal(h.requests[0].variables.after, null);
  assert.deepEqual(h.requests[1].variables, {});
  const fixed = await readFile(
    new URL('../../docs/delivery/evidence/m5-027/inventory.graphql', import.meta.url),
    'utf8',
  );
  assert.ok(fixed.includes(h.requests[0].query));
  assert.ok(fixed.includes(h.requests[1].query));
  const publicText = JSON.stringify(result);
  for (const privateValue of [secret, node().uri, identity.shop.id, identity.currentAppInstallation.id])
    assert.ok(!publicText.includes(privateValue));
  const raw = await readFile(join(h.directory, 'response-1.body'), 'utf8');
  assert.ok(raw.includes(node().uri));
  assert.ok(!(await readFile(join(h.directory, 'journal.json'), 'utf8')).includes(secret));
});

test('unallocated or broadened owner inputs stop before any HTTP request or evidence creation', async (t) => {
  const cases = [
    [
      'missing allocation',
      (o) => {
        o.allocation = undefined;
      },
    ],
    [
      'request template is not permission',
      (o) => {
        o.allocation.status = 'REQUEST_NOT_PERMISSION';
      },
    ],
    [
      'no approval reference',
      (o) => {
        o.allocation.ownerApprovalReference = '';
      },
    ],
    [
      'wrong endpoint',
      (o) => {
        o.allocation.endpoint = 'https://example.invalid/graphql';
      },
    ],
    [
      'wrong optional scopes',
      (o) => {
        o.allocation.optionalScopes.push('read_orders');
      },
    ],
    [
      'required scope expansion',
      (o) => {
        o.allocation.requiredScopes.push('read_orders');
      },
    ],
    [
      'grant expansion',
      (o) => {
        o.allocation.expectedGrants.push('read_orders');
      },
    ],
    [
      'mutations',
      (o) => {
        o.allocation.allowedMutations.push('install');
      },
    ],
    [
      'wrong operation',
      (o) => {
        o.allocation.allowedOperations.push('arbitrary');
      },
    ],
    [
      'too many requests',
      (o) => {
        o.allocation.ceilings.requests = 4;
      },
    ],
    [
      'too long retention',
      (o) => {
        o.allocation.retentionDeleteBy = new Date(Date.now() + 8 * 86400000).toISOString();
      },
    ],
    [
      'expired grant',
      (o) => {
        o.allocation.validUntil = new Date(Date.now() - 1000).toISOString();
      },
    ],
    [
      'wrong private destination',
      (o) => {
        o.allocation.privateEvidenceDirectory += '-different';
      },
    ],
    [
      'credential absent',
      (o) => {
        o.token = '';
      },
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page())));
      mutate(h.options);
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, 'STOP_INPUT_NOT_ALLOCATED');
      assert.equal(result.requests, 0);
      assert.equal(h.requests.length, 0);
      await assert.rejects(stat(h.directory), { code: 'ENOENT' });
    });
});

test('two pages follow the exact private cursor then final identity within three total requests', async (t) => {
  const h = await harness(t, async ({ input, res, requests }) => {
    res.end(
      JSON.stringify(
        input.operationName === 'M5027InstallationBoundary'
          ? { data: identity }
          : requests.length === 1
            ? page([node(1)], true, 'private-cursor-one')
            : page([node(2)], false, 'private-cursor-two'),
      ),
    );
  });
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(result.requests, 3);
  assert.equal(result.pages, 2);
  assert.equal(result.records, 2);
  assert.deepEqual(
    h.requests.map((request) => request.variables),
    [{ after: null }, { after: 'private-cursor-one' }, {}],
  );
  assert.ok(!JSON.stringify(result).includes('private-cursor'));
});

test('incomplete, drifting, duplicate or over-cap provider observations seal immediately without boundary claims', async (t) => {
  const cases = [
    [
      'GraphQL errors',
      (p) => {
        p.errors = [{ message: 'private-provider-error' }];
      },
      'STOP_PROVIDER_ERROR',
    ],
    [
      'missing shop',
      (p) => {
        delete p.data.shop;
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'wrong shop',
      (p) => {
        p.data.shop.myshopifyDomain = 'another.myshopify.com';
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'wrong client',
      (p) => {
        p.data.currentAppInstallation.app.apiKey = 'wrong';
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'wrong app',
      (p) => {
        p.data.currentAppInstallation.app.id = 'gid://shopify/App/1';
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'wrong installation',
      (p) => {
        p.data.currentAppInstallation.id = 'gid://shopify/AppInstallation/999';
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'grant drift',
      (p) => {
        p.data.currentAppInstallation.accessScopes = [];
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'grant duplicate',
      (p) => {
        p.data.currentAppInstallation.accessScopes.push({ handle: 'write_products' });
      },
      'STOP_IDENTITY_OR_GRANT_DRIFT',
    ],
    [
      'connection missing',
      (p) => {
        delete p.data.webhookSubscriptions;
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'page info missing',
      (p) => {
        delete p.data.webhookSubscriptions.pageInfo;
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'next cursor missing',
      (p) => {
        p.data.webhookSubscriptions.pageInfo.hasNextPage = true;
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'topic missing',
      (p) => {
        delete p.data.webhookSubscriptions.nodes[0].topic;
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'unsupported version',
      (p) => {
        p.data.webhookSubscriptions.nodes[0].apiVersion.handle = '2025-01';
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'unsupported format',
      (p) => {
        p.data.webhookSubscriptions.nodes[0].format = 'XML';
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'URI missing',
      (p) => {
        delete p.data.webhookSubscriptions.nodes[0].uri;
      },
      'STOP_INCOMPLETE_CONNECTION',
    ],
    [
      'duplicate ID',
      (p) => {
        p.data.webhookSubscriptions.nodes.push(node());
      },
      'STOP_DUPLICATE_OR_CONFLICT',
    ],
    [
      'URI conflict',
      (p) => {
        p.data.webhookSubscriptions.nodes.push({ ...node(2), uri: node().uri });
      },
      'STOP_DUPLICATE_OR_CONFLICT',
    ],
    [
      'page over 250',
      (p) => {
        p.data.webhookSubscriptions.nodes = Array.from({ length: 251 }, (_, i) => node(i));
      },
      'STOP_CEILING_EXHAUSTED',
    ],
  ];
  for (const [name, mutate, outcome] of cases)
    await t.test(name, async (st) => {
      const h = await harness(st, async ({ res }) => {
        const response = page();
        mutate(response);
        res.end(JSON.stringify(response));
      });
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, outcome);
      assert.equal(result.requests, 1);
      assert.equal(h.requests.length, 1);
      const account = await journal(h.directory);
      assert.equal(account.sealed, true);
      assert.equal(account.outcome, outcome);
      assert.ok(!JSON.stringify(result).includes('private-provider-error'));
    });
});

test('transport failures, redirects, API fallback, oversized bodies and absolute timeouts consume one attempt with no retry', async (t) => {
  const cases = [
    [
      'permission',
      ({ res }) => {
        res.writeHead(401);
        res.end('private-denied-body');
      },
      'STOP_HTTP_STATUS',
    ],
    [
      'throttle',
      ({ res }) => {
        res.setHeader('retry-after', '0');
        res.writeHead(429);
        res.end('private-throttle');
      },
      'STOP_HTTP_STATUS',
    ],
    [
      'redirect',
      ({ res }) => {
        res.setHeader('location', 'http://127.0.0.1:1/private-redirect');
        res.writeHead(302);
        res.end('private-redirect-body');
      },
      'STOP_HTTP_STATUS',
    ],
    [
      'API fallback',
      ({ res }) => {
        res.setHeader('x-shopify-api-version', '2026-10');
        res.end(JSON.stringify(page()));
      },
      'STOP_RESPONSE_CONTRACT',
    ],
    [
      'missing API header',
      ({ res }) => {
        res.removeHeader('x-shopify-api-version');
        res.end(JSON.stringify(page()));
      },
      'STOP_RESPONSE_CONTRACT',
    ],
    [
      'not JSON',
      ({ res }) => {
        res.setHeader('content-type', 'text/html');
        res.end('private HTML');
      },
      'STOP_RESPONSE_CONTRACT',
    ],
    [
      'encoding',
      ({ res }) => {
        res.setHeader('content-encoding', 'gzip');
        res.end('private compressed');
      },
      'STOP_RESPONSE_CONTRACT',
    ],
    ['malformed body', ({ res }) => res.end('{private-invalid-json'), 'STOP_PROVIDER_ERROR'],
    ['over 1 MiB', ({ res }) => res.end('x'.repeat(1048577)), 'STOP_RESPONSE_TOO_LARGE'],
    ['lost response', ({ req }) => req.socket.destroy(), 'STOP_TRANSPORT_UNCERTAIN'],
    [
      'absolute timeout',
      async ({ res }) => {
        res.write('{');
        await new Promise((resolve) => setTimeout(resolve, 80));
        res.end('}');
      },
      'STOP_RESPONSE_TIMEOUT',
    ],
  ];
  for (const [name, respond, outcome] of cases)
    await t.test(name, async (st) => {
      const h = await harness(st, respond);
      if (name === 'absolute timeout') h.options.allocation.ceilings.responseTimeoutMs = 20;
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, outcome);
      assert.equal(result.requests, 1);
      assert.equal(h.requests.length, 1);
      const account = await journal(h.directory);
      assert.equal(account.attempts.length, 1);
      assert.equal(account.sealed, true);
      assert.ok(!JSON.stringify(result).includes('private-'));
      assert.ok((await stat(join(h.directory, 'response-1.body'))).size <= 1048576);
    });
});

test('run deadline and expired allocation stop in flight and preserve consumed reservations', async (t) => {
  const h = await harness(t, async ({ res }) => {
    await new Promise((resolve) => setTimeout(resolve, 70));
    res.end(JSON.stringify(page()));
  });
  h.options.allocation.ceilings.durationMs = 25;
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'STOP_RUN_DEADLINE');
  assert.equal(result.requests, 1);
  assert.equal(h.requests.length, 1);
  assert.equal((await journal(h.directory)).sealed, true);
});

async function cli(h, extra = [], credential = secret) {
  const manifest = join(h.directory, '..', 'allocation.json');
  await writeFile(manifest, JSON.stringify(h.options.allocation), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [
      new URL('./cli.mjs', import.meta.url).pathname,
      '--allocation',
      manifest,
      '--private-directory',
      h.directory,
      '--token-fd',
      '3',
      '--test-endpoint',
      h.options.testEndpoint,
      ...extra,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
  );
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(`${credential}\n`);
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, stdout, stderr, result: JSON.parse(stdout) };
}

test('CLI reads one bounded existing token from inherited descriptor and prints only the public result', async (t) => {
  const h = await harness(t, async ({ input, res }) =>
    res.end(JSON.stringify(input.operationName === 'M5027InstallationBoundary' ? { data: identity } : page())),
  );
  const result = await cli(h);
  assert.equal(result.code, 0);
  assert.equal(result.result.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(result.stderr, '');
  for (const value of [secret, node().uri, h.directory, identity.shop.id]) assert.ok(!result.stdout.includes(value));
  const second = await cli(h);
  assert.equal(second.code, 1);
  assert.equal(second.result.outcome, 'STOP_EVIDENCE_UNAVAILABLE');
  assert.equal(h.requests.length, 2);
});

test('killed in-flight process leaves a consumed reservation; seal never resumes or retries it', async (t) => {
  let child;
  const h = await harness(t, async ({ directory }) => {
    assert.equal((await journal(directory)).attempts[0].status, 'RESERVED');
    child.kill('SIGKILL');
  });
  const manifest = join(h.directory, '..', 'allocation-crash.json');
  await writeFile(manifest, JSON.stringify(h.options.allocation), { mode: 0o600 });
  child = spawn(
    process.execPath,
    [
      new URL('./cli.mjs', import.meta.url).pathname,
      '--allocation',
      manifest,
      '--private-directory',
      h.directory,
      '--token-fd',
      '3',
      '--test-endpoint',
      h.options.testEndpoint,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
  );
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(secret);
  const signal = await new Promise((resolve) => child.on('close', (_code, signal) => resolve(signal)));
  assert.equal(signal, 'SIGKILL');
  const before = await journal(h.directory);
  assert.equal(before.sealed, false);
  assert.equal(before.attempts.length, 1);
  const result = await sealAbandonedRun({ privateDirectory: h.directory });
  assert.equal(result.outcome, 'STOP_ABANDONED_RUN_UNCERTAIN');
  assert.equal(result.requests, 1);
  const sealed = await journal(h.directory);
  assert.equal(sealed.sealed, true);
  assert.equal(sealed.attempts[0].status, 'UNCERTAIN');
  const retry = await collectInventory(h.options);
  assert.equal(retry.outcome, 'STOP_EVIDENCE_UNAVAILABLE');
  assert.equal(h.requests.length, 1);
});

test('unknown identity and connection shapes cannot silently qualify a partial provider response', async (t) => {
  const cases = [
    (p) => {
      p.data.shop.additionalPrivate = 'private-extra';
    },
    (p) => {
      p.data.currentAppInstallation.app.additionalPrivate = 'private-extra';
    },
    (p) => {
      p.data.webhookSubscriptions.nodes[0].extra = 'private-extra';
    },
    (p) => {
      p.data.webhookSubscriptions.edges = [];
    },
    (p) => {
      p.data.webhookSubscriptions.pageInfo.hasPreviousPage = true;
    },
  ];
  for (const mutate of cases)
    await t.test('unexpected queried object field', async (st) => {
      const h = await harness(st, async ({ res }) => {
        const p = page();
        mutate(p);
        res.end(JSON.stringify(p));
      });
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, 'STOP_RESPONSE_CONTRACT');
      assert.equal(result.requests, 1);
      assert.equal((await journal(h.directory)).sealed, true);
    });
});

test('credential reflection is withheld from disk and public errors while the attempted request remains consumed', async (t) => {
  const h = await harness(t, async ({ res }) => res.end(JSON.stringify({ errors: [{ message: secret }] })));
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'STOP_SECRET_REFLECTION');
  assert.equal(result.requests, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(await readFile(join(h.directory, 'response-1.body'), 'utf8'), '');
  assert.ok(!(await readFile(join(h.directory, 'journal.json'), 'utf8')).includes(secret));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('private response-write failure seals the acknowledged request as uncertain without another transport', async (t) => {
  const h = await harness(t, async ({ directory, res }) => {
    await writeFile(join(directory, 'response-1.body'), 'preexisting-private-file', { mode: 0o600 });
    res.end(JSON.stringify(page()));
  });
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'STOP_EVIDENCE_OR_TRANSPORT_UNCERTAIN');
  assert.equal(result.requests, 1);
  assert.equal(h.requests.length, 1);
  const account = await journal(h.directory);
  assert.equal(account.sealed, true);
  assert.equal(account.attempts[0].status, 'UNCERTAIN');
  assert.equal(await readFile(join(h.directory, 'response-1.body'), 'utf8'), 'preexisting-private-file');
});

test('full 500-record envelope needs exactly two pages and one final identity read', async (t) => {
  const h = await harness(t, async ({ input, requests, res }) =>
    res.end(
      JSON.stringify(
        input.operationName === 'M5027InstallationBoundary'
          ? { data: identity }
          : page(
              Array.from({ length: 250 }, (_, i) => node((requests.length - 1) * 250 + i + 1)),
              requests.length === 1,
              `private-cursor-${requests.length}`,
            ),
      ),
    ),
  );
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(result.records, 500);
  assert.equal(result.pages, 2);
  assert.equal(result.requests, 3);
  assert.equal(result.destinations.at(-1).label, 'destination-500');
});

test('third page, cursor cycle, cross-page duplicates and boundary drift never extend the request envelope', async (t) => {
  const cases = [
    [
      'third page',
      ({ requests }) => page([node(requests.length)], true, `cursor-${requests.length}`),
      'STOP_CEILING_EXHAUSTED',
      2,
    ],
    [
      'cursor cycle',
      ({ requests }) => page([node(requests.length)], requests.length === 1, 'same-private-cursor'),
      'STOP_CURSOR_CYCLE',
      2,
    ],
    [
      'cross-page duplicate',
      ({ requests }) => page([node()], true, `private-cursor-${requests.length}`),
      'STOP_DUPLICATE_OR_CONFLICT',
      2,
    ],
    [
      'boundary drift',
      ({ input }) =>
        input.operationName === 'M5027InstallationBoundary'
          ? {
              data: {
                ...identity,
                currentAppInstallation: { ...identity.currentAppInstallation, id: 'gid://shopify/AppInstallation/999' },
              },
            }
          : page(),
      'STOP_IDENTITY_OR_GRANT_DRIFT',
      2,
    ],
    [
      'boundary error',
      ({ input }) =>
        input.operationName === 'M5027InstallationBoundary'
          ? { errors: [{ message: 'private-boundary-error' }] }
          : page(),
      'STOP_PROVIDER_ERROR',
      2,
    ],
  ];
  for (const [name, respond, outcome, count] of cases)
    await t.test(name, async (st) => {
      const h = await harness(st, async (request) => request.res.end(JSON.stringify(respond(request))));
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, outcome);
      assert.equal(result.requests, count);
      assert.equal(h.requests.length, count);
      assert.equal((await journal(h.directory)).sealed, true);
    });
});

test('allocation may tighten ceilings and injected test endpoints cannot leave loopback', async (t) => {
  for (const [key, value] of [
    ['requests', 1],
    ['pages', 1],
    ['records', 1],
  ])
    await t.test(`tight ${key}`, async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page([node(1), node(2)], true, 'cursor'))));
      h.options.allocation.ceilings[key] = value;
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, 'STOP_CEILING_EXHAUSTED');
      assert.equal(result.requests, 1);
    });
  for (const endpoint of [
    'https://example.invalid/graphql',
    'http://localhost:12/admin/api/2026-07/graphql.json',
    'http://127.0.0.1:12/wrong',
    'http://user:pass@127.0.0.1:12/admin/api/2026-07/graphql.json',
    'http://127.0.0.1:12/admin/api/2026-07/graphql.json?extra=1',
  ])
    await t.test('invalid endpoint denied before transport', async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page())));
      h.options.testEndpoint = endpoint;
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, 'STOP_INPUT_NOT_ALLOCATED');
      assert.equal(result.requests, 0);
      assert.equal(h.requests.length, 0);
    });
});

test('failed journal persistence keeps reservation durable and forbids reinvocation despite an unsealed run', async (t) => {
  const h = await harness(t, async ({ directory, res }) => {
    await writeFile(join(directory, 'journal.pending'), 'private-I/O-conflict', { mode: 0o600 });
    res.end(JSON.stringify(page()));
  });
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'STOP_EVIDENCE_OR_TRANSPORT_UNCERTAIN');
  assert.equal(result.requests, 1);
  const account = await journal(h.directory);
  assert.equal(account.sealed, false);
  assert.equal(account.attempts[0].status, 'RESERVED');
  assert.equal((await collectInventory(h.options)).outcome, 'STOP_EVIDENCE_UNAVAILABLE');
  assert.equal((await sealAbandonedRun({ privateDirectory: h.directory })).outcome, 'STOP_RUN_PROCESS_MAY_BE_ACTIVE');
  assert.equal(h.requests.length, 1);
});

test('CLI refuses arbitrary queries, environment credential switches and duplicate flags before transport', async (t) => {
  for (const extra of [
    ['--query', 'mutation forbidden'],
    ['--token-env', 'SECRET'],
    ['--token-fd', '3'],
  ])
    await t.test(extra[0], async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page())));
      const result = await cli(h, extra);
      assert.equal(result.code, 1);
      assert.equal(result.result.outcome, 'STOP_INPUT_NOT_ALLOCATED');
      assert.equal(result.stderr, '');
      assert.equal(h.requests.length, 0);
    });
});

test('resource declaration must name an existing supported capability and cannot smuggle a second token store', async (t) => {
  for (const mutate of [
    (a) => {
      delete a.credentialCapability;
    },
    (a) => {
      a.extraSecretStore = secret;
    },
  ])
    await t.test('unsupported owner input', async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page())));
      mutate(h.options.allocation);
      const result = await collectInventory(h.options);
      assert.equal(result.outcome, 'STOP_INPUT_NOT_ALLOCATED');
      assert.equal(result.requests, 0);
      assert.equal(h.requests.length, 0);
    });
});

test('unexpected topic bytes remain private while the public observation uses an opaque category', async (t) => {
  const h = await harness(t, async ({ input, res }) =>
    res.end(
      JSON.stringify(
        input.operationName === 'M5027InstallationBoundary'
          ? { data: identity }
          : page([{ ...node(), topic: 'PRIVATE_CAPABILITY_AS_TOPIC' }]),
      ),
    ),
  );
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(result.destinations[0].topic, 'OTHER_TOPIC');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CAPABILITY_AS_TOPIC'));
});

test('distinct topics can share one coherent receiver while duplicate URI/topic bindings still stop', async (t) => {
  const h = await harness(t, async ({ input, res }) =>
    res.end(
      JSON.stringify(
        input.operationName === 'M5027InstallationBoundary'
          ? { data: identity }
          : page([node(1), { ...node(2), uri: node(1).uri, topic: 'APP_SCOPES_UPDATE' }]),
      ),
    ),
  );
  const result = await collectInventory(h.options);
  assert.equal(result.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(result.records, 2);
  assert.deepEqual(
    result.destinations.map(({ label, topic }) => ({ label, topic })),
    [
      { label: 'destination-001', topic: 'APP_UNINSTALLED' },
      { label: 'destination-002', topic: 'APP_SCOPES_UPDATE' },
    ],
  );
  assert.ok(!JSON.stringify(result).includes(node(1).uri));
});

test('CLI rejects missing, multiline and oversized descriptor tokens before creating a run or contacting HTTP', async (t) => {
  for (const credential of ['', `${secret}\nextra`, 'x'.repeat(4098)])
    await t.test('invalid private descriptor bytes', async (st) => {
      const h = await harness(st, async ({ res }) => res.end(JSON.stringify(page())));
      const result = await cli(h, [], credential);
      assert.equal(result.code, 1);
      assert.equal(result.result.outcome, 'STOP_INPUT_NOT_ALLOCATED');
      assert.equal(result.stderr, '');
      assert.equal(h.requests.length, 0);
      await assert.rejects(stat(h.directory), { code: 'ENOENT' });
    });
});
