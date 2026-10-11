/** NOT_RUN source. One fixed private owner process, outside the ordinary web.
 * Root qualifies localhost-only forwarding, producer, exact source/deps/runtime
 * and the outer 300s/1MiB process-group boundary before any future invocation. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendTrustedRelease } from './release-append.mjs';
import { collectFreshTrustedRelease, recordPhaseName } from './trusted-release-collector.mjs';
import { createManagementProcess } from './trusted-release-management-process.mjs';
import { createOwnerHttps } from './trusted-release-owner-https.mjs';

const NATIVE_PARENT = '/home/serveradmin/insignia-milestone-autonomy-handoff';
export const ownerPhaseForRecord = (recordId) => join(NATIVE_PARENT, recordPhaseName(recordId));
const SHOP = 'insignia-rewrite-dev.myshopify.com';
const APP = '1443cf6d03d39edae7c101a943c5c684';
/** Import-safe private packet seam. Four flat string fields only; the textual
 * token count also rejects duplicate JSON properties before credentials are used. */
export function parseOwnerPrivatePacket(text) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  const packet = JSON.parse(text);
  assert.deepEqual(Object.keys(packet).sort(), ['appendPassword', 'clientSecret', 'databaseUrl', 'recordId']);
  assert.ok(Object.values(packet).every((value) => typeof value === 'string'));
  assert.equal(text.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length, 8);
  recordPhaseName(packet.recordId);
  assert.match(packet.appendPassword, /^[0-9a-f]{64}$/);
  assert.match(packet.clientSecret, /^[^\r\n\0]{1,4096}$/);
  const address = new URL(packet.databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(address.protocol) && address.hostname === '127.0.0.1');
  assert.equal(address.username, 'insignia_runtime');
  assert.ok(
    address.port &&
      /^[1-9][0-9]*$/.test(address.port) &&
      !address.hash &&
      address.password &&
      address.pathname.length > 1,
  );
  assert.deepEqual([...address.searchParams], [['sslmode', 'disable']]);
  return packet;
}
async function main() {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[name] = () => {};
  const privateHttpsRequest = https.request;
  const denied = () => {
    throw new Error('Owner network escape denied');
  };
  globalThis.fetch = () => Promise.reject(new Error('Owner network escape denied'));
  http.request = denied;
  http.get = denied;
  https.request = denied;
  https.get = denied;
  syncBuiltinESMExports();
  let core, management, packet;
  const chunks = [];
  try {
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      assert.ok(size <= 16384);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    try {
      packet = parseOwnerPrivatePacket(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
      for (const chunk of chunks) chunk.fill(0);
    }
    const deadline = Date.now() + 300000;
    const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
    const { Pool } = require('pg');
    const { createDurableCore, sha256CanonicalJson } = await import(
      pathToFileURL(require.resolve('@insignia/database'))
    );
    const { createFunctionOwnershipReconciler, FUNCTION_OWNERSHIP_QUERY } = await import(
      pathToFileURL(require.resolve('@insignia/shopify'))
    );
    core = createDurableCore(
      new Pool({
        connectionString: packet.databaseUrl,
        connectionTimeoutMillis: 30000,
        query_timeout: 30000,
        options: '-c statement_timeout=30000ms -c lock_timeout=30000ms',
      }),
    );
    management = createManagementProcess({ deadline });
    const provider = createOwnerHttps({
      request: privateHttpsRequest,
      functionQuery: FUNCTION_OWNERSHIP_QUERY,
      deadline,
    });
    const result = await collectFreshTrustedRelease(
      {
        directory: ownerPhaseForRecord(packet.recordId),
        recordId: packet.recordId,
        operator: { user: 'insignia_release_append', password: packet.appendPassword },
      },
      {
        now: Date.now,
        management,
        async readTenant() {
          const managed = await core.tenants.getManagedInstallationState(SHOP);
          assert.ok(managed?.active);
          const scope = await core.tenants.getActiveAuthorizationScope({
            shopId: managed.shopId,
            installationGeneration: managed.currentGeneration,
          });
          assert.ok(scope && scope.shopDomain === SHOP && scope.shopifyShopId === managed.shopifyShopId);
          return {
            shop: SHOP,
            tenantShopId: managed.shopId,
            installationGeneration: managed.currentGeneration,
            shopId: `gid://shopify/Shop/${managed.shopifyShopId}`,
            externalInstallationId: managed.externalInstallationId,
            authorizationGeneration: scope.authorizationGeneration,
            authorizationEpoch: scope.authorizationEpoch,
          };
        },
        acquireToken: () => provider.acquireToken(packet.clientSecret),
        readInstallation: (token) => provider.readInstallation(token),
        async readFunctions(token, binding) {
          const tenant = {
            shopId: binding.tenantShopId,
            installationGeneration: binding.installationGeneration,
            appId: '429028933633',
            shopifyShopId: binding.shopId,
          };
          return createFunctionOwnershipReconciler({
            transport: {
              execute: (input) => {
                assert.deepEqual(input.tenant, tenant);
                return provider.functions(token, input);
              },
            },
          }).read(tenant, {
            appKey: APP,
            transformInputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
            validationInputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
          });
        },
        append: (input) =>
          appendTrustedRelease(input, {
            Pool,
            createDurableCore,
            sha256CanonicalJson,
            databaseUrl: packet.databaseUrl,
            now: Date.now,
          }),
      },
    );
    emit(`${JSON.stringify(result)}\n`);
    if (result.classification !== 'TRUSTED_RELEASE_COLLECT_APPEND_ACK') process.exitCode = 1;
  } catch {
    emit(
      '{"version":"m5-owner-trusted-release-collector-v1","classification":"PRIVATE_OWNER_COLLECTION_UNQUALIFIED","retryAuthorized":false}\n',
    );
    process.exitCode = 1;
  } finally {
    if (packet) {
      packet.clientSecret = undefined;
      packet.appendPassword = undefined;
      packet.databaseUrl = undefined;
    }
    for (const chunk of chunks) chunk.fill(0);
    management?.shutdown();
    try {
      await core?.close();
    } catch {
      /* No error/credential output, no replay. */
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
