import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectPrivatePhase, PRIVATE_DOCKER_COMMAND, runPrivateInventory } from './private-operator.mjs';

const SECRET = 'SYNTHETIC_PRIVATE_CLIENT_SECRET',
  TOKEN = 'SYNTHETIC_PRIVATE_ADMIN_TOKEN';
const identity = {
  shop: { id: 'gid://shopify/Shop/123', myshopifyDomain: 'insignia-rewrite-dev.myshopify.com' },
  currentAppInstallation: {
    id: 'gid://shopify/AppInstallation/456',
    app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
    accessScopes: [{ handle: 'write_products' }, { handle: 'read_publications' }, { handle: 'read_product_listings' }],
  },
};
const packet = {
  secret: SECRET,
  clientId: '1443cf6d03d39edae7c101a943c5c684',
  appUrl: 'https://insignia-app.optidigi.nl',
  image: 'sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5',
};
async function fixture(t, handler, wrongHost = false) {
  const root = await mkdtemp(join(tmpdir(), 'insignia-private-native-'));
  const key = join(root, 'key.pem'),
    cert = join(root, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      wrongHost ? 'subjectAltName=DNS:localhost' : 'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const ca = await readFile(cert);
  const calls = [];
  const server = createServer({ key: await readFile(key), cert: ca }, async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ path: req.url, body, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/admin/api/')) res.setHeader('x-shopify-api-version', '2026-07');
    if (handler) await handler({ req, res, body, calls, root });
    else if (req.url.includes('oauth'))
      res.end(
        JSON.stringify({
          access_token: TOKEN,
          scope: 'write_products,read_publications,read_product_listings',
          expires_in: 86399,
        }),
      );
    else {
      const doc = JSON.parse(body);
      res.end(
        JSON.stringify({
          data: {
            ...identity,
            ...(doc.operationName === 'M5027WebhookInventory'
              ? { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
              : {}),
          },
        }),
      );
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const gatePath = join(root, 'gate.json');
  const gate = {
    schema: 'insignia-private-inventory-gate-v1',
    status: 'LOOPBACK_TEST',
    tokenOperationalQualification: 'SUPPORTED_EXACT_STORE_ISSUANCE_OWNER_ALLOCATED',
    tokenLifecycleGuarantee: 'UNKNOWN_NOT_ASSERTED',
    expectedGrants: ['write_products', 'read_publications', 'read_product_listings'],
    validUntil: new Date(Date.now() + 1800000).toISOString(),
    retentionDeleteBy: new Date(Date.now() + 86400000).toISOString(),
  };
  await writeFile(gatePath, JSON.stringify(gate), { mode: 0o600 });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  const options = {
    gatePath,
    testFixture: {
      origin: `https://127.0.0.1:${server.address().port}`,
      ca,
      phaseDirectory: join(root, 'phase'),
      producer: [
        process.execPath,
        '-e',
        `process.stdout.write(${JSON.stringify(JSON.stringify([packet.image, `SHOPIFY_CLIENT_SECRET=${packet.secret}`, `SHOPIFY_CLIENT_ID=${packet.clientId}`, `APP_URL=${packet.appUrl}`]))})`,
      ],
    },
  };
  return { options, root, calls, gate, gatePath };
}
async function capturesContain(path, secret) {
  for (const name of await readdir(path, { withFileTypes: true })) {
    const p = join(path, name.name);
    if (name.isDirectory()) {
      if (await capturesContain(p, secret)) return true;
    } else if (name.name !== 'key.pem' && name.name !== 'cert.pem' && (await readFile(p)).includes(Buffer.from(secret)))
      return true;
  }
  return false;
}
test('one private producer and one OAuth acquisition feed fixed TLS inventory/boundary without credential capture', async (t) => {
  const h = await fixture(t);
  const r = await runPrivateInventory(h.options);
  assert.equal(r.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(r.oauthAttempts, 1);
  assert.equal(r.requests, 2);
  assert.deepEqual(
    h.calls.map((c) => c.path),
    ['/admin/oauth/access_token', '/admin/api/2026-07/graphql.json', '/admin/api/2026-07/graphql.json'],
  );
  const journal = JSON.parse(await readFile(join(h.root, 'phase/phase.json')));
  assert.deepEqual(
    journal.attempts.map((x) => x.kind),
    ['SSH', 'OAUTH', 'ADMIN', 'ADMIN'],
  );
  assert.equal(await capturesContain(h.root, SECRET), false);
  assert.equal(await capturesContain(h.root, TOKEN), false);
  const second = await runPrivateInventory(h.options);
  assert.equal(second.oauthAttempts, 1);
  assert.equal(second.requests, 2);
  assert.equal(second.outcome, 'STOP_PHASE_ALREADY_USED');
  assert.equal(h.calls.length, 3);
});
test('unresolved native gate is denied before private producer/network or phase creation', async (t) => {
  const h = await fixture(t);
  delete h.options.testFixture;
  const r = await runPrivateInventory(h.options);
  assert.equal(r.outcome, 'STOP_NATIVE_PREMISES_UNQUALIFIED');
  assert.equal(h.calls.length, 0);
});
test('untrusted TLS CA consumes OAuth reservation once and never proceeds to Admin', async (t) => {
  const h = await fixture(t);
  h.options.testFixture.ca = 'not a CA';
  const r = await runPrivateInventory(h.options);
  assert.equal(r.oauthAttempts, 1);
  assert.equal(r.requests, 0);
  assert.equal(h.calls.length, 0);
});
test('JSON-escaped reflection in a discarded duplicate value is withheld before response persistence', async (t) => {
  const h = await fixture(t, async ({ req, res }) => {
    if (req.url.includes('oauth'))
      res.end(
        JSON.stringify({
          access_token: TOKEN,
          scope: 'write_products,read_publications,read_product_listings',
          expires_in: 86399,
        }),
      );
    else
      res.end(
        `{"extensions":{"echo":"\\u0053YNTHETIC_PRIVATE_CLIENT_SECRET","echo":"safe"},"data":${JSON.stringify(identity)}}`,
      );
  });
  const r = await runPrivateInventory(h.options);
  assert.equal(r.outcome, 'STOP_SECRET_REFLECTION');
  assert.equal(r.requests, 1);
  assert.equal(h.calls.length, 2);
  assert.equal((await readFile(join(h.root, 'phase/admin/response-1.body'))).length, 0);
});
test('corrupt journal accounting is UNKNOWN and cannot report false zero or restart transport', async (t) => {
  const h = await fixture(t);
  await runPrivateInventory(h.options);
  await writeFile(join(h.root, 'phase/phase.json'), '{}', { mode: 0o600 });
  const r = await inspectPrivatePhase(join(h.root, 'phase'));
  assert.equal(r.requests, null);
  assert.equal(r.oauthAttempts, null);
  assert.equal(r.requestAccounting, 'UNKNOWN');
  assert.equal(h.calls.length, 3);
});
test('ambient HTTP and fetch escape transports deny locally', async () => {
  const https = await import('node:https');
  const http = await import('node:http');
  assert.throws(() => https.request('https://127.0.0.1:1'), /network_escape_denied/);
  assert.throws(() => http.request('http://127.0.0.1:1'), /network_escape_denied/);
  await assert.rejects(globalThis.fetch('https://127.0.0.1:1'), /network_escape_denied/);
});
test('trusted certificate for a different hostname cannot authenticate fixed loopback IP', async (t) => {
  const h = await fixture(t, undefined, true);
  const r = await runPrivateInventory(h.options);
  assert.equal(r.outcome, 'STOP_TRANSPORT_UNCERTAIN');
  assert.equal(r.oauthAttempts, 1);
  assert.equal(h.calls.length, 0);
});
test('test override cannot name a native or HTTP origin', async (t) => {
  for (const origin of [
    'https://insignia-rewrite-dev.myshopify.com',
    'http://127.0.0.1:1',
    'https://127.0.0.1:1/other',
  ]) {
    const h = await fixture(t);
    h.options.testFixture.origin = origin;
    const r = await runPrivateInventory(h.options);
    assert.equal(r.outcome, 'STOP_LOCAL_FIXTURE');
    assert.equal(h.calls.length, 0);
  }
});
test('private producer identity drift and overflow stop before OAuth', async (t) => {
  for (const output of [
    JSON.stringify([
      packet.image,
      `SHOPIFY_CLIENT_SECRET=${SECRET}`,
      'SHOPIFY_CLIENT_ID=different',
      `APP_URL=${packet.appUrl}`,
    ]),
    JSON.stringify([
      'different',
      `SHOPIFY_CLIENT_SECRET=${SECRET}`,
      `SHOPIFY_CLIENT_ID=${packet.clientId}`,
      `APP_URL=${packet.appUrl}`,
    ]),
    JSON.stringify([
      packet.image,
      `SHOPIFY_CLIENT_SECRET=${SECRET}`,
      `SHOPIFY_CLIENT_ID=${packet.clientId}`,
      'APP_URL=https://wrong.invalid',
    ]),
    'x'.repeat(17000),
  ]) {
    const h = await fixture(t);
    h.options.testFixture.producer = [process.execPath, '-e', `process.stdout.write(${JSON.stringify(output)})`];
    const r = await runPrivateInventory(h.options);
    assert.equal(r.oauthAttempts, 0);
    assert.equal(h.calls.length, 0);
  }
});
test('OAuth redirect, malformed scopes, drift and short expiry never enable Admin', async (t) => {
  for (const mutation of ['redirect', 'duplicate', 'whitespace', 'wrong', 'expiry', 'secret']) {
    const h = await fixture(t, async ({ req, res }) => {
      assert.ok(req.url.includes('oauth'));
      if (mutation === 'redirect') {
        res.writeHead(302, { location: 'https://127.0.0.1:1' });
        res.end('{}');
        return;
      }
      const value = {
        access_token: TOKEN,
        scope: 'write_products,read_publications,read_product_listings',
        expires_in: 86399,
      };
      if (mutation === 'duplicate') value.scope = 'write_products,write_products,read_product_listings';
      if (mutation === 'whitespace') value.scope = 'write_products read_publications read_product_listings';
      if (mutation === 'wrong') value.scope = 'read_orders';
      if (mutation === 'expiry') value.expires_in = 1;
      if (mutation === 'secret') value.access_token = SECRET;
      res.end(JSON.stringify(value));
    });
    const r = await runPrivateInventory(h.options);
    assert.equal(r.oauthAttempts, 1);
    assert.equal(r.requests, 0);
    assert.equal(h.calls.length, 1);
  }
});
test('literal and JSON-escaped token or secret keys/values cannot enter durable Admin bodies', async (t) => {
  for (const text of [
    `{"echo":"${TOKEN}"}`,
    `{"echo":"\\u0053YNTHETIC_PRIVATE_ADMIN_TOKEN"}`,
    `{"\\u0053YNTHETIC_PRIVATE_CLIENT_SECRET":"safe"}`,
    `{"echo":"${SECRET}"}`,
  ]) {
    const h = await fixture(t, async ({ req, res }) => {
      if (req.url.includes('oauth'))
        res.end(
          JSON.stringify({
            access_token: TOKEN,
            scope: 'write_products,read_publications,read_product_listings',
            expires_in: 86399,
          }),
        );
      else res.end(text);
    });
    const r = await runPrivateInventory(h.options);
    assert.equal(r.outcome, 'STOP_SECRET_REFLECTION');
    assert.equal(r.requests, 1);
    assert.equal((await readFile(join(h.root, 'phase/admin/response-1.body'))).length, 0);
  }
});
test('process SIGKILL after Admin dispatch retains consumed phase reservation and forbids restart', async (t) => {
  let observed;
  const dispatched = new Promise((r) => (observed = r));
  const h = await fixture(t, async ({ req, res }) => {
    if (req.url.includes('oauth'))
      res.end(
        JSON.stringify({
          access_token: TOKEN,
          scope: 'write_products,read_publications,read_product_listings',
          expires_in: 86399,
        }),
      );
    else observed();
  });
  const module = new URL('./private-operator.mjs', import.meta.url).href;
  const options = {
    ...h.options,
    testFixture: { ...h.options.testFixture, ca: h.options.testFixture.ca.toString('utf8') },
  };
  const script = `import {runPrivateInventory} from ${JSON.stringify(module)}; await runPrivateInventory(${JSON.stringify(options)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: {}, stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await dispatched;
  child.kill('SIGKILL');
  await new Promise((r) => child.once('close', r));
  const r = await inspectPrivatePhase(join(h.root, 'phase'));
  assert.equal(r.oauthAttempts, 1);
  assert.equal(r.requests, 1);
  assert.equal(r.requestAccounting, 'SHARED_DURABLE_RESERVED_ATTEMPTS');
  const repeat = await runPrivateInventory(h.options);
  assert.equal(repeat.requests, 1);
  assert.equal(h.calls.length, 2);
});

test('concurrent invocations cannot reset the single allocation phase', async (t) => {
  const h = await fixture(t);
  const results = await Promise.all([runPrivateInventory(h.options), runPrivateInventory(h.options)]);
  assert.equal(results.filter((r) => r.outcome === 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED').length, 1);
  assert.equal(h.calls.length, 3);
  assert.equal(results.filter((r) => r.outcome === 'STOP_PHASE_ALREADY_USED').length, 1);
});

test('fixed Docker-side projection packet works without exporting the full environment', async (t) => {
  const h = await fixture(t);
  const projection = [
    packet.image,
    `SHOPIFY_CLIENT_SECRET=${SECRET}`,
    `SHOPIFY_CLIENT_ID=${packet.clientId}`,
    `APP_URL=${packet.appUrl}`,
  ];
  h.options.testFixture.producer = [
    process.execPath,
    '-e',
    `process.stdout.write(${JSON.stringify(JSON.stringify(projection))})`,
  ];
  const r = await runPrivateInventory(h.options);
  assert.equal(r.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(h.calls.length, 3);
});

test('expired gate cannot report fresh zero after allocation reservations already exist', async (t) => {
  const h = await fixture(t);
  await runPrivateInventory(h.options);
  h.gate.validUntil = new Date(Date.now() - 1).toISOString();
  await writeFile(h.gatePath, JSON.stringify(h.gate), { mode: 0o600 });
  const r = await runPrivateInventory(h.options);
  assert.equal(r.oauthAttempts, 1);
  assert.equal(r.requests, 2);
  assert.equal(h.calls.length, 3);
});

test('missing operational assessment or an asserted universal token guarantee stops before any transport', async (t) => {
  for (const mutate of [
    (g) => delete g.tokenOperationalQualification,
    (g) => (g.tokenOperationalQualification = 'OWNER_ACCEPTED_UNKNOWN_RISK'),
    (g) => delete g.tokenLifecycleGuarantee,
    (g) => (g.tokenLifecycleGuarantee = 'UNIVERSAL_NO_REVOCATION'),
  ]) {
    const h = await fixture(t);
    mutate(h.gate);
    await writeFile(h.gatePath, JSON.stringify(h.gate), { mode: 0o600 });
    const r = await runPrivateInventory(h.options);
    assert.equal(r.outcome, 'STOP_GATE');
    assert.equal(r.oauthAttempts, 0);
    assert.equal(r.requests, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('hostile remote Docker defaults cannot redirect the fixed producer invocation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'insignia-producer-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const probe = join(root, 'probe.mjs'),
    docker = join(root, 'docker');
  await writeFile(
    probe,
    `const args=process.argv.slice(2); const hostIndex=args.indexOf('--host'), configIndex=args.indexOf('--config'); process.stdout.write(JSON.stringify({host:hostIndex<0?process.env.DOCKER_HOST:args[hostIndex+1],config:configIndex<0?process.env.DOCKER_CONFIG:args[configIndex+1],context:process.env.DOCKER_CONTEXT??null,path:process.env.PATH??null,args}));`,
  );
  await writeFile(docker, `#!/bin/sh\nexec '${process.execPath}' '${probe}' "$@"\n`, { mode: 0o700 });
  // Only substitute the executable in this equivalent local process control.
  // No Docker CLI or actual daemon is available; the native fixed invocation
  // must also have the independently specified absolute executable and flags.
  const command = PRIVATE_DOCKER_COMMAND.replace('/usr/bin/docker', `'${docker}'`);
  const hostile = {
    PATH: root,
    DOCKER_HOST: 'tcp://other-daemon.invalid:2375',
    DOCKER_CONTEXT: 'hostile-context',
    DOCKER_CONFIG: join(root, 'hostile-config'),
  };
  const bytes = await new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { env: hostile, stdio: ['ignore', 'pipe', 'pipe'] });
    let data = '';
    child.stdout.on('data', (chunk) => (data += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(data) : reject(Error('probe failed'))));
  });
  const observation = JSON.parse(bytes);
  assert.equal(observation.host, 'unix:///var/run/docker.sock');
  assert.equal(observation.config, '/nonexistent');
  assert.equal(observation.context, null);
  assert.equal(observation.path, null);
  assert.equal(observation.args.at(-1), 'insignia-rewrite-m5-019-web');
  assert.ok(
    PRIVATE_DOCKER_COMMAND.startsWith(
      '/usr/bin/env -i /usr/bin/docker --host unix:///var/run/docker.sock --config /nonexistent inspect ',
    ),
  );
});
