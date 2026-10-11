/** Private, one-attempt M5 operator. No browser endpoint, tenant seed, token
 * store, epoch/revocation change, quote issuance or publication activation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operations = new Set([
  'VERIFY_IDENTITY',
  'EXCHANGE_ONLINE',
  'READ_INSTALLATION_OPEN',
  'READ_CONFIG_BEFORE',
  'READ_FUNCTIONS_BEFORE',
  'CREATE_PENDING',
  'PUBLISH_CONFIG',
  'READ_INSTALLATION_CLOSE',
  'READ_FUNCTIONS_CLOSE',
  'READ_CONFIG_CLOSE',
  'ACTIVATE_KEY',
]);

export function qualifySigningProvisionPlan(plan) {
  assert.deepEqual(Object.keys(plan).sort(), ['firstDay', 'keyId', 'lastDay']);
  assert.ok(Number.isInteger(plan.keyId) && plan.keyId >= 1 && plan.keyId <= 65535);
  assert.ok(
    Number.isInteger(plan.firstDay) &&
      Number.isInteger(plan.lastDay) &&
      plan.firstDay >= 0 &&
      plan.lastDay <= 0xffffffff &&
      plan.firstDay <= plan.lastDay,
  );
  return Object.freeze({ ...plan });
}
async function writePrivate(directory, name, value) {
  const file = await open(join(directory, name), 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(directory, 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
export async function reserveSigningProvisionRun(directory, inputPlan) {
  const plan = qualifySigningProvisionPlan(inputPlan);
  assert.ok(isAbsolute(directory) && resolve(directory) === directory);
  const parent = dirname(directory);
  assert.equal(await realpath(parent), parent);
  const stat = await lstat(parent);
  assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  await mkdir(directory, { mode: 0o700 });
  const parentHandle = await open(parent, 'r');
  try {
    await parentHandle.sync();
  } finally {
    await parentHandle.close();
  }
  const planSha256 = hash(plan);
  await writePrivate(directory, '000-reservation.json', {
    version: 'm5-signing-provision-reservation-v1',
    plan,
    planSha256,
    attempt: 1,
  });
  let sequence = 0;
  const reserved = new Set();
  return {
    planSha256,
    async reserve(operation) {
      assert.ok(operations.has(operation) && !reserved.has(operation));
      reserved.add(operation);
      const index = ++sequence;
      await writePrivate(directory, `${String(index).padStart(3, '0')}-${operation}.json`, {
        operation,
        index,
        planSha256,
        attempt: 1,
      });
      return { durable: true, operation };
    },
    async settle(operation, outcome) {
      assert.ok(reserved.has(operation) && ['ACK', 'STOP'].includes(outcome));
      await writePrivate(directory, `${operation}-settled.json`, { operation, outcome, retryAuthorized: false });
    },
    async finish(result) {
      await writePrivate(directory, 'result.json', result);
    },
  };
}

const APP = '1443cf6d03d39edae7c101a943c5c684';
const APP_ID = '429028933633';
const SHOP = 'insignia-rewrite-dev.myshopify.com';
const VERSION = '1162611916801';
function sameScope(actual, expected) {
  assert.ok(actual);
  for (const field of ['shopId', 'installationGeneration', 'authorizationGeneration', 'authorizationEpoch'])
    assert.equal(actual[field], expected[field]);
}

/** Narrow system boundaries are supplied only by the fixed executable or tests.
 * Public-config observation allows key activation, not quote issuance, Function
 * propagation or ProductConfig activation. Those existing gates stay separate. */
export async function provisionSigningKey(inputPlan, idToken, ports) {
  const flags = {
    pendingCreateAttempted: false,
    pendingCreateAcknowledged: false,
    publicConfigWriteAttempted: false,
    publicConfigWriteAcknowledged: false,
    ambiguousPublicationSettledByRead: false,
    activationAttempted: false,
    activationAcknowledged: false,
  };
  let uncertain = null,
    completed = false,
    keyId = null;
  async function operation(name, action) {
    const reserved = await ports.journal.reserve(name);
    assert.equal(reserved?.durable, true);
    try {
      const value = await action();
      await ports.journal.settle(name, 'ACK');
      return value;
    } catch (error) {
      try {
        await ports.journal.settle(name, 'STOP');
      } catch {
        /* Never retry. */
      }
      throw error;
    }
  }
  try {
    const plan = qualifySigningProvisionPlan(inputPlan);
    assert.equal(ports.journal.planSha256, hash(plan));
    keyId = plan.keyId;
    assert.ok(typeof idToken === 'string' && idToken.length > 0 && idToken.length <= 8192 && !/\s/.test(idToken));
    const start = ports.now().getTime();
    assert.ok(Number.isFinite(start));
    const identity = await operation('VERIFY_IDENTITY', () => ports.identity.verify(idToken));
    assert.equal(identity.shop, SHOP);
    assert.ok(identity.staffId && identity.sessionId && identity.expiresAtMs > start);
    const grant = await operation('EXCHANGE_ONLINE', () => ports.identity.exchangeOnline(idToken, identity));
    assert.equal(grant.shop, SHOP);
    assert.equal(grant.staffId, identity.staffId);
    assert.ok(grant.appScopes.includes('write_products') && grant.userScopes.includes('write_products'));
    for (const scope of ['read_cart_transforms', 'read_validations']) assert.ok(grant.appScopes.includes(scope));
    const deadline = Math.min(start + 30000, identity.expiresAtMs, grant.expiresAtMs - 30000);
    function live() {
      const now = ports.now().getTime();
      assert.ok(Number.isFinite(now) && now >= start && now < deadline);
    }
    live();
    const provider = await operation('READ_INSTALLATION_OPEN', () => ports.identity.readInstallation(grant));
    assert.equal(provider.shop, SHOP);
    for (const scope of ['write_products', 'read_cart_transforms', 'read_validations'])
      assert.ok(provider.grantedScopes.includes(scope));
    const managed = await ports.core.tenants.getManagedInstallationState(SHOP);
    assert.ok(managed?.active);
    assert.equal(`gid://shopify/Shop/${managed.shopifyShopId}`, provider.shopId);
    assert.equal(managed.externalInstallationId, provider.installationId);
    const active = await ports.core.tenants.getActiveAuthorizationScope({
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
    });
    assert.ok(active && active.shopDomain === SHOP && active.shopifyShopId === managed.shopifyShopId);
    const scope = {
      shopId: active.shopId,
      installationGeneration: active.installationGeneration,
      authorizationGeneration: active.authorizationGeneration,
      authorizationEpoch: active.authorizationEpoch,
    };
    const tenant = {
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      appId: APP_ID,
      shopifyShopId: provider.shopId,
    };
    async function currentScope() {
      live();
      const state = await ports.core.tenants.getManagedInstallationState(SHOP);
      assert.ok(
        state?.active &&
          state.shopId === managed.shopId &&
          state.currentGeneration === scope.installationGeneration &&
          state.shopifyShopId === managed.shopifyShopId &&
          state.externalInstallationId === provider.installationId,
      );
      sameScope(await ports.core.tenants.getActiveAuthorizationScope(scope), scope);
      sameScope(await ports.core.signingKeys.getActiveScope(scope.shopId, scope.installationGeneration), scope);
      live();
    }
    function dayCoverage() {
      live();
      const day = ports.app.localDay(ports.now(), provider.ianaTimezone).ordinal;
      assert.ok(plan.firstDay <= day && plan.lastDay >= day + 2);
    }
    dayCoverage();
    await currentScope();
    const { admin, observeFunctions } = ports.bindProvider(grant, currentScope, tenant);
    const lifecycle = new ports.app.SigningKeyLifecycle(ports.core.signingKeys, ports.ring);
    const rows = await ports.core.signingKeys.list(scope);
    assert.ok(rows.filter((row) => row.state !== 'destroyed').length < 4 && !rows.some((row) => row.id === plan.keyId));
    const prior = await operation('READ_CONFIG_BEFORE', () => admin.read({ ...tenant, field: 'public_config' }));
    if (rows.some((row) => row.state !== 'destroyed'))
      assert.equal(prior?.value, (await lifecycle.desiredPublicConfig(scope)).value);
    else assert.equal(prior, null);
    let ready;
    function assertCachedReadiness() {
      assert.ok(ready);
      ports.app.assertProductionFunctionArtifactReady({
        scope: ready.artifactScope,
        expectedBuild: ready.trusted.expectedBuild,
        attestation: ready.trusted.record.attestation,
        observation: ready.observed.observation,
        now: ports.now(),
        maxObservationAgeMs: 30000,
      });
    }
    async function readiness(name) {
      await currentScope();
      dayCoverage();
      const artifactScope = {
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        appClientId: APP,
      };
      const trusted = await ports.core.trustedReleaseRecords.read({
        scope: artifactScope,
        expectedActiveAppVersionRef: VERSION,
        now: ports.now(),
      });
      assert.ok(trusted);
      assert.equal(trusted.expectedBuild.appVersionRef, VERSION);
      assert.equal(trusted.expectedBuild.sourceCommit, '9b94149272d1b62c34f44dda3bde209e80b4ae22');
      const observed = await operation(name, () => observeFunctions(tenant, trusted.expectedBuild));
      await currentScope();
      dayCoverage();
      ready = { artifactScope, trusted, observed };
      assertCachedReadiness();
    }
    await readiness('READ_FUNCTIONS_BEFORE');
    await operation('CREATE_PENDING', async () => {
      await currentScope();
      dayCoverage();
      assertCachedReadiness();
      flags.pendingCreateAttempted = true;
      uncertain = 'CREATE_PENDING';
      await lifecycle.createPending({ scope, ...plan });
      flags.pendingCreateAcknowledged = true;
      uncertain = null;
    });
    const pending = (await ports.core.signingKeys.list(scope)).find((row) => row.id === plan.keyId);
    assert.ok(pending?.state === 'pending' && pending.privateEnvelope && pending.wrappingKeyId);
    const desired = await lifecycle.desiredPublicConfig(scope);
    await currentScope();
    dayCoverage();
    assertCachedReadiness();
    const publication = await operation('PUBLISH_CONFIG', async () => {
      assertCachedReadiness();
      flags.publicConfigWriteAttempted = true;
      uncertain = 'PUBLISH_CONFIG';
      try {
        const result = await admin.set(
          { ...tenant, field: 'public_config', value: desired.value, compareDigest: prior?.compareDigest ?? null },
          () => {
            try {
              dayCoverage();
              assertCachedReadiness();
              return true;
            } catch {
              return false;
            }
          },
        );
        assert.equal(result.observed.value, desired.value);
        flags.publicConfigWriteAcknowledged = true;
        flags.ambiguousPublicationSettledByRead = result.kind === 'applied_after_ambiguous_response';
        uncertain = null;
        return result;
      } catch (error) {
        if (['cas_conflict', 'not_dispatched'].includes(error?.kind)) uncertain = null;
        throw error;
      }
    });
    assert.equal(publication.observed.value, desired.value);
    const closing = await operation('READ_INSTALLATION_CLOSE', () => ports.identity.readInstallation(grant));
    assert.deepEqual(closing, provider);
    await readiness('READ_FUNCTIONS_CLOSE');
    const observed = await operation('READ_CONFIG_CLOSE', () => admin.read({ ...tenant, field: 'public_config' }));
    assert.equal(observed?.value, desired.value);
    await currentScope();
    dayCoverage();
    assertCachedReadiness();
    await operation('ACTIVATE_KEY', async () => {
      assertCachedReadiness();
      flags.activationAttempted = true;
      uncertain = 'ACTIVATE_KEY';
      await lifecycle.activate(scope, plan.keyId);
      flags.activationAcknowledged = true;
      uncertain = null;
    });
    await currentScope();
    dayCoverage();
    const activated = await lifecycle.desiredPublicConfig(scope);
    assert.equal(activated.value, desired.value);
    ports.app.requireIssuanceReady({
      config: activated,
      keyId: plan.keyId,
      acceptedDay: ports.app.localDay(ports.now(), provider.ianaTimezone).ordinal,
    });
    completed = true;
  } catch {
    /* Only closed facts survive; private provider/DB errors never do. */
  }
  const result = {
    classification: completed ? 'SIGNING_KEY_CONFIG_PROVISIONED' : 'SIGNING_KEY_CONFIG_STOPPED',
    keyId,
    ...flags,
    ambiguousOperation: uncertain,
    retryAuthorized: false,
    quoteIssuanceAuthorized: false,
    receiptDurable: true,
  };
  try {
    await ports.journal.finish(result);
  } catch {
    result.classification = 'SIGNING_KEY_CONFIG_STOPPED';
    result.receiptDurable = false;
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let core;
  const ringBuffers = [];
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length;
      assert.ok(size <= 32000);
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.deepEqual(Object.keys(input).sort(), ['directory', 'firstDay', 'idToken', 'keyId', 'lastDay', 'ring']);
    const plan = qualifySigningProvisionPlan({ keyId: input.keyId, firstDay: input.firstDay, lastDay: input.lastDay });
    assert.deepEqual(Object.keys(input.ring).sort(), ['currentKeyId', 'keys']);
    assert.match(input.ring.currentKeyId, /^[A-Za-z0-9_-]{1,128}$/);
    assert.ok(Object.keys(input.ring.keys).length > 0 && Object.keys(input.ring.keys).length <= 8);
    const keys = Object.create(null);
    for (const [id, hex] of Object.entries(input.ring.keys)) {
      assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
      assert.match(hex, /^[a-f0-9]{64}$/);
      keys[id] = Buffer.from(hex, 'hex');
      ringBuffers.push(keys[id]);
    }
    assert.ok(keys[input.ring.currentKeyId]);
    assert.equal(process.env.SHOPIFY_CLIENT_ID, APP);
    assert.equal(process.env.INSIGNIA_SHOPIFY_APP_ID, APP_ID);
    assert.equal(new URL(process.env.APP_URL).origin, 'https://insignia-app.optidigi.nl');
    const journal = await reserveSigningProvisionRun(input.directory, plan);
    const require = createRequire(new URL('package.json', pathToFileURL(`${process.cwd()}/`)));
    const app = await import(pathToFileURL(require.resolve('@insignia/application')));
    const db = await import(pathToFileURL(require.resolve('@insignia/database')));
    const shopify = await import(pathToFileURL(require.resolve('@insignia/shopify')));
    const { Pool } = require('pg');
    core = db.createDurableCore(
      new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        query_timeout: 8000,
        options: '-c statement_timeout=8000ms -c lock_timeout=8000ms',
      }),
    );
    const identity = shopify.createAdminOnlineIdentity({
      apiKey: APP,
      apiSecret: process.env.SHOPIFY_CLIENT_SECRET,
      hostName: 'insignia-app.optidigi.nl',
    });
    const result = await provisionSigningKey(plan, input.idToken, {
      app,
      core,
      identity,
      ring: { currentKeyId: input.ring.currentKeyId, keys },
      journal,
      now: () => new Date(),
      bindProvider(grant, isCurrent, tenant) {
        const transport = shopify.createPublicationAdminHttpTransport({
          credentials: {
            async acquire(scope) {
              if (scope.shopId !== tenant.shopId || scope.installationGeneration !== tenant.installationGeneration)
                return { kind: 'inactive' };
              try {
                await isCurrent();
              } catch {
                return { kind: 'inactive' };
              }
              return {
                kind: 'usable',
                shopDomain: SHOP,
                accessToken: grant.accessToken,
                accessExpiresAt: new Date(grant.expiresAtMs),
              };
            },
          },
        });
        const functions = shopify.createFunctionOwnershipReconciler({ transport });
        return {
          admin: shopify.createPublicationAdminAdapter({ transport }),
          observeFunctions: (scope, expected) =>
            functions.read(scope, {
              appKey: APP,
              transformInputQuerySha256: expected.transform.inputQuerySha256,
              validationInputQuerySha256: expected.validation.inputQuerySha256,
            }),
        };
      },
    });
    console.log(JSON.stringify(result));
    if (result.classification !== 'SIGNING_KEY_CONFIG_PROVISIONED') process.exitCode = 1;
  } catch {
    console.log(
      JSON.stringify({
        classification: 'SIGNING_KEY_CONFIG_STOPPED',
        retryAuthorized: false,
        quoteIssuanceAuthorized: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    for (const value of ringBuffers) value.fill(0);
    try {
      await core?.close();
    } catch {
      /* Never replace write settlement. */
    }
  }
}
