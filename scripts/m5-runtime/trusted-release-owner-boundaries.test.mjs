import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as nativeEntry from './trusted-release-collector-native.mjs';
import { createManagementProcess } from './trusted-release-management-process.mjs';
import { runManagementReads } from './trusted-release-management-worker.mjs';
import { createOwnerHttps, INSTALLATION_BOUNDARY } from './trusted-release-owner-https.mjs';

const modules = JSON.parse(
  await readFile(new URL('../../deployment/m5-runtime/native-function-module-baseline.json', import.meta.url)),
);
const versions = [
  '1163229200385',
  '1162611916801',
  '1158986629121',
  '1158837927937',
  '1153019904001',
  '1152880803841',
  '1146748534785',
].map((id, i) => ({
  versionId: `gid://shopify/Version/${id}`,
  versionTag: i ? `synthetic-${i}` : 'm5-functions-9c2e56b42fbf',
  status: i ? 'inactive' : 'active',
}));
function sdkFixture() {
  const calls = [],
    sent = [];
  const client = {
    async activeAppVersionRawResult(key) {
      calls.push('root');
      assert.equal(key, '1443cf6d03d39edae7c101a943c5c684');
      return {
        app: {
          id: 'gid://shopify/App/429028933633',
          key,
          organizationId: 'gid://shopify/Organization/123',
          activeRoot: { clientCredentials: { secrets: [{ key: 'SYNTHETIC_PRIVATE_ROOT_SECRET' }] } },
          activeRelease: { id: 'opaque-release-with-no-version-id' },
        },
      };
    },
    async appVersions(remote) {
      calls.push('versions');
      assert.equal(remote.organizationId, '123');
      return { app: { id: remote.id, appVersions: { nodes: versions, pageInfo: { totalResults: 7 } } } };
    },
    async appVersionByTag(_remote, tag) {
      calls.push('modules');
      assert.equal(tag, 'm5-functions-9c2e56b42fbf');
      return {
        uuid: 'gid://shopify/Version/1163229200385',
        versionTag: tag,
        location: 'SYNTHETIC_PRIVATE_LOCATION',
        appModuleVersions: modules.map(({ handle, ...m }) => ({ ...m, registrationTitle: handle })),
      };
    },
  };
  return { client, calls, sent };
}

test('fixed SDK workflow keeps original four methods and omits root secrets and SDK location', async () => {
  const f = sdkFixture(),
    reservations = [];
  await runManagementReads({
    client: f.client,
    reserve: async (name) => {
      reservations.push(name);
      return { durable: true };
    },
    send: async (kind, value) => f.sent.push({ kind, value }),
    waitClose: async () => {},
    now: () => '2026-10-11T12:00:00.000Z',
  });
  assert.deepEqual(f.calls, ['root', 'versions', 'modules', 'versions']);
  assert.deepEqual(reservations, ['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag', 'AppVersions']);
  assert.ok(
    !JSON.stringify(f.sent).includes('SYNTHETIC_PRIVATE_ROOT_SECRET') &&
      !JSON.stringify(f.sent).includes('SYNTHETIC_PRIVATE_LOCATION'),
  );
  assert.equal(f.sent[0].value.totalResults, 7);
  assert.equal(f.sent[1].value.observedAt, '2026-10-11T12:00:00.000Z');
});

test('missing durable acknowledgement stops the SDK before its first read', async () => {
  const f = sdkFixture();
  await assert.rejects(
    runManagementReads({
      client: f.client,
      reserve: async () => ({ durable: false }),
      send: async () => {},
      waitClose: async () => {},
    }),
  );
  assert.equal(f.calls.length, 0);
});

test('fixed Admin TLS capability cannot dispatch a foreign document or retry client credentials', async () => {
  const exactScopes =
    'write_products,read_publications,read_product_listings,read_cart_transforms,read_validations,write_cart_transforms,write_validations';
  // Actual post-consent OAuth readback compresses the read scopes covered by writes.
  const canonicalScopes =
    'read_product_listings,read_publications,write_cart_transforms,write_products,write_validations';
  for (const scope of [
    canonicalScopes,
    exactScopes,
    exactScopes.replace(',write_validations', ''),
    `${exactScopes},write_orders`,
  ]) {
    const requests = [],
      query = 'query SyntheticOriginalFunctionDocument { shop { id } }';
    const provider = createOwnerHttps({
      deadline: 300000,
      now: () => 0,
      functionQuery: query,
      request(endpoint, options, callback) {
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = (bytes) => {
          const body = bytes.toString();
          requests.push({ endpoint, options, body });
          queueMicrotask(() => {
            const response = new EventEmitter();
            response.statusCode = 200;
            response.headers = { 'content-type': 'application/json' };
            response.complete = true;
            response.destroy = () => {};
            callback(response);
            response.emit(
              'data',
              Buffer.from(
                JSON.stringify({
                  access_token: 'SYNTHETIC_OWNER_TOKEN',
                  scope,
                  expires_in: 3600,
                }),
              ),
            );
            response.emit('end');
          });
        };
        return request;
      },
    });
    if (scope === exactScopes || scope === canonicalScopes)
      assert.equal(await provider.acquireToken('SYNTHETIC_PRIVATE_CLIENT_SECRET'), 'SYNTHETIC_OWNER_TOKEN');
    else await assert.rejects(provider.acquireToken('SYNTHETIC_PRIVATE_CLIENT_SECRET'));
    await assert.rejects(provider.acquireToken('SYNTHETIC_PRIVATE_CLIENT_SECRET'));
    await assert.rejects(
      provider.functions('SYNTHETIC_OWNER_TOKEN', {
        operation: 'function_ownership',
        query: 'mutation Foreign { shop { id } }',
        variables: {},
      }),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].endpoint, 'https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token');
    assert.equal(requests[0].options.rejectUnauthorized, true);
    assert.equal(requests[0].options.minVersion, 'TLSv1.2');
    assert.ok(
      INSTALLATION_BOUNDARY.includes('currentAppInstallation { id app { id apiKey } accessScopes { handle } }'),
    );
  }
});

test('closed child protocol never acknowledges a refused reservation or exports inherited Node preloads', async () => {
  let writes = '',
    killed = 0,
    spawnOptions;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.exitCode = null;
  child.stdin = {
    write(value) {
      writes += value;
      queueMicrotask(() =>
        child.stdout.emit(
          'data',
          Buffer.from(value === 'AUTHENTICATE\n' ? 'AUTHENTICATED\n' : 'RESERVE ActiveAppReleaseFromApiKey\n'),
        ),
      );
    },
    end() {},
  };
  child.kill = () => {
    killed++;
    child.exitCode = 1;
    child.emit('close', 1, null);
  };
  const process = createManagementProcess({
    deadline: 300000,
    now: () => 0,
    environment: { HOME: '/synthetic/no-session', NODE_OPTIONS: '--require /synthetic/forbidden' },
    spawnChild(_node, args, options) {
      spawnOptions = options;
      assert.ok(args[0].endsWith('/trusted-release-management-worker.mjs'));
      return child;
    },
  });
  try {
    await process.authenticate();
    await assert.rejects(process.open(async () => ({ durable: false })));
    assert.ok(!writes.includes('DURABLE_ACK'));
    assert.ok(!Object.hasOwn(spawnOptions.env, 'NODE_OPTIONS'));
  } finally {
    process.shutdown();
  }
  assert.ok(killed > 0);
});

test('installation boundary accepts the original optional GraphQL envelope metadata but never error-bearing data', async () => {
  let envelope = {
    data: {
      shop: { id: 'gid://shopify/Shop/123', myshopifyDomain: 'insignia-rewrite-dev.myshopify.com' },
      currentAppInstallation: {
        id: 'gid://shopify/AppInstallation/321',
        app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
        accessScopes: [{ handle: 'read_products' }],
      },
    },
    extensions: { cost: { actualQueryCost: 1 } },
    errors: [],
  };
  const provider = createOwnerHttps({
    deadline: 300000,
    now: () => 0,
    functionQuery: 'query Synthetic {}',
    request(_endpoint, _options, callback) {
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () =>
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = { 'content-type': 'application/json' };
          response.complete = true;
          response.destroy = () => {};
          callback(response);
          response.emit('data', Buffer.from(JSON.stringify(envelope)));
          response.emit('end');
        });
      return request;
    },
  });
  const result = await provider.readInstallation('SYNTHETIC_TOKEN');
  assert.equal(result.installationId, 'gid://shopify/AppInstallation/321');
  assert.ok(!JSON.stringify(result).includes('actualQueryCost'));
  envelope = { ...envelope, errors: [{ message: 'SYNTHETIC_PRIVATE_ERROR' }] };
  await assert.rejects(provider.readInstallation('SYNTHETIC_TOKEN'));
  envelope = { ...envelope, errors: [], unexpected: true };
  await assert.rejects(provider.readInstallation('SYNTHETIC_TOKEN'));
});

test('private owner packet accepts only qualified runtime loopback or fixed container transport without duplicate fields', () => {
  const packet = {
    databaseUrl: 'postgresql://insignia_runtime:SYNTHETIC_PASSWORD@127.0.0.1:55484/synthetic_rewrite?sslmode=disable',
    clientSecret: 'SYNTHETIC_PRIVATE_SECRET',
    appendPassword: 'b'.repeat(64),
    recordId: '11111111-1111-4111-8111-111111111111',
  };
  assert.deepEqual(nativeEntry.parseOwnerPrivatePacket(JSON.stringify(packet)), packet);
  const containerUrl =
    'postgresql://insignia_runtime:SYNTHETIC_PASSWORD@insignia-rewrite-m5-019-database:5432/insignia_rewrite?sslmode=disable';
  assert.equal(
    nativeEntry.parseOwnerPrivatePacket(JSON.stringify({ ...packet, databaseUrl: containerUrl })).databaseUrl,
    containerUrl,
  );
  for (const databaseUrl of [
    containerUrl.replace(':5432/', ':5433/'),
    containerUrl.replace('/insignia_rewrite?', '/other?'),
    packet.databaseUrl.replace('127.0.0.1', '0.0.0.0'),
    packet.databaseUrl.replace('insignia_runtime', 'insignia_release_append'),
    packet.databaseUrl.replace('?sslmode=disable', ''),
    `${packet.databaseUrl}&sslmode=disable`,
    packet.databaseUrl.replace('disable', 'require'),
    `${packet.databaseUrl}&options=-c%20role%3Dpostgres`,
  ]) {
    assert.throws(() => nativeEntry.parseOwnerPrivatePacket(JSON.stringify({ ...packet, databaseUrl })));
  }
  assert.throws(() =>
    nativeEntry.parseOwnerPrivatePacket(JSON.stringify(packet).replace('{', '{"clientSecret":"DUPLICATE",')),
  );
  assert.throws(() => nativeEntry.parseOwnerPrivatePacket(JSON.stringify({ ...packet, clientSecret: undefined })));
  assert.equal(
    nativeEntry.ownerPhaseForRecord(packet.recordId),
    '/var/lib/insignia/verifier/m5-trusted-release-collector-native-run-20261011-11111111-1111-4111-8111-111111111111',
  );
  for (const recordId of [
    '../escape',
    '11111111-1111-4111-8111-111111111111/escape',
    '11111111-1111-4111-8111-11111111111A',
    '00000000-0000-0000-0000-000000000000',
  ]) {
    assert.throws(() => nativeEntry.parseOwnerPrivatePacket(JSON.stringify({ ...packet, recordId })));
    assert.throws(() => nativeEntry.ownerPhaseForRecord(recordId));
  }
});

test('management child timeout, oversized output and hostile protocol stop without accepting observations', async () => {
  for (const mode of ['timeout', 'oversized', 'hostile']) {
    let killed = false;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.exitCode = null;
    child.stdin = {
      write() {
        if (mode !== 'timeout')
          queueMicrotask(() =>
            child.stdout.emit(
              'data',
              Buffer.from(mode === 'oversized' ? 'X'.repeat(1048577) : 'HOSTILE_FIELD SYNTHETIC_PRIVATE_ERROR\n'),
            ),
          );
      },
      end() {},
    };
    child.kill = () => {
      killed = true;
      child.exitCode = 1;
      child.emit('close', 1, null);
    };
    const management = createManagementProcess({
      deadline: mode === 'timeout' ? 10 : 300000,
      now: () => 0,
      environment: {},
      spawnChild: () => child,
    });
    try {
      await assert.rejects(management.authenticate());
    } finally {
      management.shutdown();
    }
    assert.equal(killed, true);
  }
});

test('same-count inactive replacement or duplicate cannot supply Function setup version authority', async () => {
  for (const replacement of ['gid://shopify/Version/999999999', 'gid://shopify/Version/1158986629121']) {
    const f = sdkFixture(),
      original = f.client.appVersions;
    f.client.appVersions = async (...args) => {
      const result = structuredClone(await original(...args));
      result.app.appVersions.nodes[1].versionId = replacement;
      return result;
    };
    await assert.rejects(
      runManagementReads({
        client: f.client,
        reserve: async () => ({ durable: true }),
        send: async (kind, value) => f.sent.push({ kind, value }),
        waitClose: async () => {},
      }),
    );
    assert.deepEqual(f.sent, []);
    assert.deepEqual(f.calls, ['root', 'versions']);
  }
});

test('private verification receiver independently fences generation and admits only closed metadata', async () => {
  const { createReleaseVerificationServer } = await import('./release-verification-server.mjs');
  const binding = {
    shopId: 'synthetic-tenant',
    installationGeneration: '1',
    appClientId: '1443cf6d03d39edae7c101a943c5c684',
    authorizationGeneration: '22222222-2222-4222-8222-222222222222',
    authorizationEpoch: 0,
    externalInstallationId: 'gid://shopify/AppInstallation/321',
  };
  let calls = 0;
  const request = {
    requestId: '11111111-1111-4111-8111-111111111111',
    binding,
    expectedActiveAppVersionRef: '1163229200385',
    deadlineMs: Date.now() + 60_000,
  };
  const server = createReleaseVerificationServer({
    readBinding: async () => binding,
    collect: async (input) => {
      calls++;
      return {
        classification: 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
        appendAttempted: true,
        appendAcknowledged: true,
        ambiguousWrite: false,
        retryAuthorized: false,
        recordId: input.requestId,
      };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [value, status] of [
      [{ ...request, binding: { ...binding, authorizationEpoch: 1 } }, 503],
      [{ ...request, token: 'SYNTHETIC_FORBIDDEN' }, 503],
      [request, 200],
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      assert.equal(response.status, status);
      const reply = await response.json();
      assert.equal(reply.state, status === 200 ? 'COMPLETE' : 'UNCERTAIN');
    }
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('collector transport awaits preparation beyond observation TTL within the authenticated deadline', async (t) => {
  const { createReleaseVerificationClient } = await import('../../apps/web/src/server/admin/release-verification.ts');
  const { createReleaseVerificationServer } = await import('./release-verification-server.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'm5-verification-wait-'));
  const socket = join(directory, 'collector.sock');
  const binding = {
    shopId: 'synthetic-tenant',
    installationGeneration: '1',
    appClientId: '1443cf6d03d39edae7c101a943c5c684',
    authorizationGeneration: '22222222-2222-4222-8222-222222222222',
    authorizationEpoch: 0,
    externalInstallationId: 'gid://shopify/AppInstallation/321',
  };
  let started, finish;
  const admitted = new Promise((resolve) => {
    started = resolve;
  });
  const preparation = new Promise((resolve) => {
    finish = resolve;
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-12T12:00:00Z') });
  const server = createReleaseVerificationServer({
    readBinding: async () => binding,
    async collect(input) {
      started();
      await preparation;
      return {
        classification: 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
        appendAttempted: true,
        appendAcknowledged: true,
        ambiguousWrite: false,
        retryAuthorized: false,
        recordId: input.requestId,
      };
    },
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  try {
    const result = createReleaseVerificationClient(socket).collect({
      requestId: '11111111-1111-4111-8111-111111111111',
      binding,
      expectedActiveAppVersionRef: '1163229200385',
      deadlineMs: Date.now() + 90_000,
    });
    const settled = result.then(
      (value) => value,
      () => ({ state: 'TRANSPORT_FAILED' }),
    );
    await admitted;
    t.mock.timers.tick(31_000); // Fresh provider observations are collected after preparation, not restamped.
    finish();
    assert.equal((await settled).state, 'COMPLETE');
  } finally {
    t.mock.timers.reset();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
