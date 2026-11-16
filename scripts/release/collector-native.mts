import type { DurableCore } from '../../packages/database/dist/index.js';
import { object, required, text as stringValue } from './validation.mts';
export interface OwnerPrivatePacket {
  appendPassword: string;
  clientSecret: string;
  /** Unwraps the store's stored offline token; the same wrapping key the web and worker hold. */
  credentialKeyBase64: string;
  credentialKeyId: string;
  databaseUrl: string;
  recordId: string;
}
export const OWNER_PACKET_FIELDS = [
  'appendPassword',
  'clientSecret',
  'credentialKeyBase64',
  'credentialKeyId',
  'databaseUrl',
  'recordId',
] as const;
/** Private fields cleared from memory after use; recordId is not secret. */
export const OWNER_PACKET_SECRETS = ['appendPassword', 'clientSecret', 'credentialKeyBase64', 'databaseUrl'] as const;
function packetShape(value: unknown): asserts value is OwnerPrivatePacket {
  const packet = object(value);
  for (const name of OWNER_PACKET_FIELDS) stringValue(packet[name]);
}

/** NOT_RUN source. One fixed private owner process, outside the ordinary web.
 * Root qualifies fixed private-container transport or local forwarding, producer, exact source/deps/runtime
 * and the outer 300s/1MiB process-group boundary before any future invocation. */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';
import { appendTrustedRelease } from './append.mts';
import { collectFreshTrustedRelease, recordPhaseName } from './collector.mts';
import { createManagementProcess } from './management-process.mts';
import { createOwnerHttps } from './owner-https.mts';
import { VERIFIER_STATE } from './paths.mts';
import { readPrivatePacket } from './private-pipe.mts';
import { releaseProfile } from './profiles.mts';
import { APP_CLIENT_ID, currentTenantBinding } from './tenant-binding.mts';

const NATIVE_PARENT = VERIFIER_STATE;
export const ownerPhaseForRecord = (recordId: string) => join(NATIVE_PARENT, recordPhaseName(recordId));
/** Import-safe private packet seam. Six flat string fields only; the textual
 * token count also rejects duplicate JSON properties before credentials are used. */
export function parseOwnerPrivatePacket(text: string): OwnerPrivatePacket {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 16384);
  const packet: unknown = JSON.parse(text);
  packetShape(packet);
  assert.deepEqual(Object.keys(packet).sort(), [...OWNER_PACKET_FIELDS]);
  assert.ok(Object.values(packet).every((value) => typeof value === 'string'));
  assert.equal(text.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length, OWNER_PACKET_FIELDS.length * 2);
  recordPhaseName(packet.recordId);
  assert.match(packet.appendPassword, /^[0-9a-f]{64}$/);
  assert.match(packet.clientSecret, /^[^\r\n\0]{1,4096}$/);
  assert.match(packet.credentialKeyId, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);
  assert.match(packet.credentialKeyBase64, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(Buffer.from(packet.credentialKeyBase64, 'base64').toString('base64'), packet.credentialKeyBase64);
  const address = new URL(packet.databaseUrl);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(address.protocol) &&
      (address.hostname === '127.0.0.1' ||
        (address.hostname === 'insignia-rewrite-m5-019-database' &&
          address.port === '5432' &&
          address.pathname === '/insignia_rewrite')),
  );
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
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[name] = () => {};
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
  let core: DurableCore | undefined,
    management: ReturnType<typeof createManagementProcess> | undefined,
    packet: OwnerPrivatePacket | undefined,
    wrappingKey: Buffer | undefined;
  const chunks: Buffer[] = [];
  try {
    const profileName = process.argv[2];
    assert.ok(process.argv.length <= 3);
    const profile = releaseProfile(profileName);
    let size = 0;
    for await (const chunk of process.stdin) {
      assert.ok(Buffer.isBuffer(chunk));
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
    // The request names the store to verify; without one there is nothing to collect.
    assert.equal(process.env.INSIGNIA_RELEASE_VERIFICATION_FD, '3');
    const verificationRequest = parseReleaseVerificationRequest(
      JSON.parse((await readPrivatePacket(createReadStream('', { fd: 3, autoClose: true }))).toString('utf8')),
      profile.versionId,
    );
    const deadline = Math.min(Date.now() + 300000, verificationRequest.deadlineMs);
    const currentTime = () => {
      const time = Date.now();
      assert.ok(time < deadline);
      return time;
    };
    const require = createRequire(new URL('../../worker/package.json', import.meta.url));
    const { Pool }: typeof import('pg') = require('pg');
    const { createDurableCore, sha256CanonicalJson }: typeof import('../../packages/database/dist/index.js') =
      await import(pathToFileURL(require.resolve('@insignia/database')).href);
    const {
      createFunctionOwnershipReconciler,
      createShopifyOfflineRefreshTransport,
      FUNCTION_OWNERSHIP_QUERY,
    }: typeof import('../../packages/shopify/dist/index.js') = await import(
      pathToFileURL(require.resolve('@insignia/shopify')).href
    );
    const { createAdminReadCredentialSource }: typeof import('../../packages/application/dist/index.js') = await import(
      pathToFileURL(require.resolve('@insignia/application')).href
    );
    wrappingKey = Buffer.from(packet.credentialKeyBase64, 'base64');
    assert.equal(wrappingKey.length, 32);
    const database = createDurableCore(
      new Pool({
        connectionString: packet.databaseUrl,
        connectionTimeoutMillis: 30000,
        query_timeout: 30000,
        options: '-c statement_timeout=30000ms -c lock_timeout=30000ms',
      }),
      { credentialKeys: { currentKeyId: packet.credentialKeyId, keys: { [packet.credentialKeyId]: wrappingKey } } },
    );
    core = database;
    // The store comes from the request, its identity from the active installation records.
    const target = await currentTenantBinding(database.tenants, verificationRequest.binding);
    assert.deepEqual(target.binding, verificationRequest.binding);
    management = createManagementProcess({ deadline, profileName });
    const provider = createOwnerHttps({
      shop: target.shop,
      request: privateHttpsRequest,
      functionQuery: FUNCTION_OWNERSHIP_QUERY,
      deadline,
      profileName,
    });
    // The store's own offline token, through the same claim-fenced refresh lifecycle as the
    // worker, so a client store outside the app's organization verifies the same way.
    const offline = createAdminReadCredentialSource({
      tenants: database.tenants,
      // The token must outlive the whole collection, so it is refreshed up front when it would not.
      minimumRemainingMs: Math.min(600_000, Math.max(30_000, deadline - Date.now() + 10_000)),
      // Longer than the refresh request (at most 30 s) plus the time kept to store its result.
      claimLeaseMs: 90_000,
      credentials: {
        install: () => Promise.reject(new Error('Credential installation is not a verifier operation')),
        acquire: (input) => database.credentials.acquire(input),
        replaceClaim: (input) => database.credentials.replaceClaim(input),
        async releaseClaim(input) {
          await database.credentials.releaseClaim(input);
        },
        async markReauthRequired(input) {
          return (await database.credentials.markReauthRequired(input)) ? 'marked' : 'stale';
        },
      },
      refresh: createShopifyOfflineRefreshTransport({
        clientId: APP_CLIENT_ID,
        clientSecret: packet.clientSecret,
        fetchImpl: provider.refreshFetch,
        timeoutMs: 30000,
      }),
    });
    const result = await collectFreshTrustedRelease(
      {
        directory: ownerPhaseForRecord(packet.recordId),
        recordId: packet.recordId,
        operator: { user: 'insignia_release_append', password: packet.appendPassword },
      },
      {
        now: currentTime,
        management,
        async readTenant() {
          const current = await currentTenantBinding(database.tenants, verificationRequest.binding);
          assert.deepEqual(current.binding, verificationRequest.binding);
          assert.equal(current.shop, target.shop);
          return {
            shop: current.shop,
            tenantShopId: current.binding.shopId,
            installationGeneration: current.binding.installationGeneration,
            shopId: `gid://shopify/Shop/${current.shopifyShopId}`,
            externalInstallationId: current.binding.externalInstallationId,
            authorizationGeneration: current.binding.authorizationGeneration,
            authorizationEpoch: current.binding.authorizationEpoch,
          };
        },
        async acquireToken() {
          const credential = await offline.acquire({
            shopId: target.binding.shopId,
            installationGeneration: target.binding.installationGeneration,
          });
          assert.ok(
            credential.kind === 'usable' &&
              credential.shopDomain === target.shop &&
              credential.accessExpiresAt.getTime() > deadline,
          );
          return credential.accessToken;
        },
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
            appKey: APP_CLIENT_ID,
            observationVersion: 2,
            transformInputQuerySha256: profile.functions.transform.inputQuerySha256,
            validationInputQuerySha256: profile.functions.validation.inputQuerySha256,
          });
        },
        append: (input: unknown) =>
          appendTrustedRelease(input, {
            Pool,
            createDurableCore,
            sha256CanonicalJson,
            databaseUrl: required(packet).databaseUrl,
            now: currentTime,
            profileName,
          }),
      },
      profileName,
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
      for (const name of OWNER_PACKET_SECRETS) Reflect.set(packet, name, undefined);
    }
    for (const chunk of chunks) chunk.fill(0);
    management?.shutdown();
    try {
      await core?.close();
    } catch {
      /* No error/credential output, no replay. */
    }
    wrappingKey?.fill(0);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
