/** Private one-shot operator. NOT_RUN. The source-bound release baseline must first
 * contain the qualified Function-write scopes. Never invoked from merchant screens. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import baseline from '../../deployment/m5-runtime/native-module-baseline.json' with { type: 'json' };
import release from '../../deployment/m5-runtime/native-module-binding.json' with { type: 'json' };
import { reserveFunctionSetupRun } from './function-setup-journal.mjs';
import { installFunctionSetupNetwork } from './function-setup-network.mjs';
import { createManagementProcess } from './trusted-release-management-process.mjs';

const SHOP = 'insignia-rewrite-dev.myshopify.com';
const RUN = '/home/serveradmin/insignia-milestone-autonomy-handoff/m5-function-setup-native-run-20261011';
const writeScopes = ['write_cart_transforms', 'write_validations'];
export function qualifyFunctionSetupBaseline() {
  const access = baseline.find((m) => m.handle === 'app_access')?.config;
  assert.ok(
    writeScopes.every((scope) => access?.optional_scopes?.includes(scope)),
    'function_write_release_not_bound',
  );
  assert.equal(access.scopes, '');
  assert.deepEqual(access.optional_scopes, [
    'write_products',
    'read_publications',
    'read_product_listings',
    'read_cart_transforms',
    'read_validations',
    ...writeScopes,
  ]);
}
export function parseFunctionSetupPacket(text) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  const value = JSON.parse(text);
  assert.deepEqual(Object.keys(value).sort(), ['clientSecret', 'databaseUrl', 'idToken']);
  assert.equal(text.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length, 6);
  assert.ok(Object.values(value).every((v) => typeof v === 'string' && v.length > 0 && !/[\r\n\0]/.test(v)));
  assert.ok(value.idToken.length <= 8192 && value.clientSecret.length <= 4096);
  const url = new URL(value.databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port);
  assert.ok(url.username === 'insignia_runtime' && url.password && !url.hash && url.pathname.length > 1);
  assert.deepEqual([...url.searchParams], [['sslmode', 'disable']]);
  return value;
}
async function main() {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[name] = () => {};
  let core, management, journal, packet;
  let result = {
    classification: 'FUNCTION_SETUP_STOPPED',
    receiptDurable: false,
    retryAuthorized: false,
    publicationReady: false,
  };
  const chunks = [];
  try {
    // Fail before accepting credentials until the actual reviewed release tuple is bound.
    qualifyFunctionSetupBaseline();
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      assert.ok(size <= 16384);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    try {
      packet = parseFunctionSetupPacket(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
      for (const chunk of chunks) chunk.fill(0);
    }
    const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
    const { Pool } = require('pg');
    const database = await import(pathToFileURL(require.resolve('@insignia/database')));
    const shopify = await import(pathToFileURL(require.resolve('@insignia/shopify')));
    core = database.createDurableCore(
      new Pool({
        connectionString: packet.databaseUrl,
        connectionTimeoutMillis: 8000,
        query_timeout: 8000,
        options: '-c statement_timeout=8000ms -c lock_timeout=8000ms',
      }),
    );
    const managed = await core.tenants.getManagedInstallationState(SHOP);
    assert.ok(managed?.active);
    const authorization = await core.tenants.getActiveAuthorizationScope({
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
    });
    assert.ok(authorization);
    journal = reserveFunctionSetupRun(RUN, {
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
      externalInstallationId: managed.externalInstallationId,
      appVersionRef: release.versionId,
      sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
    });
    const deadline = Date.now() + 30000;
    const network = installFunctionSetupNetwork({
      journal,
      deadline,
      auth: packet,
      documents: {
        installation: shopify.ADMIN_STAFF_INSTALLATION_QUERY,
        ownership: shopify.FUNCTION_OWNERSHIP_QUERY,
        transform: shopify.FUNCTION_TRANSFORM_CREATE,
        validation: shopify.FUNCTION_VALIDATION_CREATE,
      },
    });
    const identity = shopify.createAdminOnlineIdentity({
      apiKey: release.appClientId,
      apiSecret: packet.clientSecret,
      hostName: 'insignia-app.optidigi.nl',
      fetchImpl: network.fetch,
    });
    const staff = await identity.verify(packet.idToken);
    assert.equal(staff.shop, SHOP);
    const grant = await identity.exchangeOnline(packet.idToken, staff);
    assert.equal(grant.staffId, staff.staffId);
    assert.equal(grant.shop, SHOP);
    for (const scope of [...writeScopes, 'write_products'])
      assert.ok(grant.appScopes.includes(scope) && grant.userScopes.includes(scope));
    network.bindToken(grant.accessToken);
    management = createManagementProcess({ deadline });
    await management.authenticate();
    const reserveSdk = async (operation) => {
      const name = operation === 'AppVersions' && closing ? 'AppVersions_CLOSE' : operation;
      journal.reserve(name);
      journal.dispatch(name);
      return { durable: true };
    };
    let closing = false;
    const opening = await management.open(reserveSdk);
    const module = opening.moduleObservation;
    assert.equal(module.appClientId, release.appClientId);
    assert.equal(module.appId, release.appId);
    assert.equal(module.versionId, release.versionId);
    assert.equal(module.versionTag, release.versionTag);
    assert.deepEqual(
      [...module.modules].sort((a, b) => a.handle.localeCompare(b.handle)),
      baseline,
    );
    const active = [
      { versionId: `gid://shopify/Version/${release.versionId}`, versionTag: release.versionTag, status: 'active' },
    ];
    assert.deepEqual(
      opening.versions.filter((v) => v.status === 'active'),
      active,
    );
    assert.equal(opening.versions.length, opening.totalResults);
    for (const operation of ['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag'])
      journal.settle(operation, 'ACK');
    const expires = Math.min(
      deadline,
      Date.parse(module.observedAt) + 30000,
      staff.expiresAtMs,
      grant.expiresAtMs - 30000,
    );
    const tenant = {
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
      shopifyShopId: `gid://shopify/Shop/${managed.shopifyShopId}`,
      appId: release.appId,
    };
    async function verifyAuthority() {
      network.assertNoEscape();
      assert.ok(Date.now() < expires);
      assert.deepEqual(await core.tenants.getManagedInstallationState(SHOP), managed);
      assert.deepEqual(await core.tenants.getActiveAuthorizationScope(tenant), authorization);
      const installed = await identity.readInstallation(grant);
      assert.equal(installed.shop, SHOP);
      assert.equal(installed.shopId, tenant.shopifyShopId);
      assert.equal(installed.installationId, managed.externalInstallationId);
      for (const scope of [...writeScopes, 'read_cart_transforms', 'read_validations'])
        assert.ok(installed.grantedScopes.includes(scope));
      return new Date(expires);
    }
    const functions = (kind) => baseline.find((m) => m.handle === `insignia-experimental-v2-${kind}`);
    result = await shopify.provisionOwnedFunctions({
      tenant,
      clock: () => new Date(),
      journal,
      functionIds: {
        transform: functions('transform').registrationUuid,
        validation: functions('validation').registrationUuid,
      },
      expected: {
        appKey: release.appClientId,
        observationVersion: 2,
        transformInputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
        validationInputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
      },
      verifyAuthority,
      async verifyClosingAuthority() {
        await verifyAuthority();
        closing = true;
        const observed = await management.close(reserveSdk);
        assert.deepEqual(observed.versions, opening.versions);
        assert.equal(observed.totalResults, opening.totalResults);
        journal.settle('AppVersions_CLOSE', 'ACK');
        network.assertNoEscape();
        return new Date(expires);
      },
      transport: shopify.createPublicationAdminHttpTransport({
        fetchImpl: network.fetch,
        credentials: {
          async acquire(requested) {
            assert.deepEqual(requested, {
              shopId: tenant.shopId,
              installationGeneration: tenant.installationGeneration,
            });
            assert.deepEqual(await core.tenants.getManagedInstallationState(SHOP), managed);
            assert.deepEqual(await core.tenants.getActiveAuthorizationScope(tenant), authorization);
            return {
              kind: 'usable',
              shopDomain: SHOP,
              accessToken: grant.accessToken,
              accessExpiresAt: new Date(grant.expiresAtMs),
            };
          },
        },
      }),
    });
  } catch {
    try {
      journal?.finish('FUNCTION_SETUP_STOPPED');
      result.receiptDurable = Boolean(journal);
    } catch {
      /* No retry. */
    }
  } finally {
    management?.shutdown();
    try {
      await core?.close();
    } catch {
      /* Never print private database errors or retry. */
    }
    packet = undefined;
    for (const chunk of chunks) chunk.fill(0);
  }
  emit(`${JSON.stringify(result)}\n`);
  if (result.classification !== 'FUNCTIONS_VERIFIED') process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
