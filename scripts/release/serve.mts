/** Privileged exact-app collector receiver. Launch only after frozen qualification;
 * private startup stdin is supplied by the operator, never the merchant runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DurableCore } from '../../packages/database/dist/index.js';
import { parseOwnerPrivatePacket } from './collector-native.mts';
import { launchQualifiedTrustedRelease } from './launch.mts';
import { VERIFIER_SOCKET_DIRECTORY } from './paths.mts';
import { readPrivatePacket } from './private-pipe.mts';
import { releaseProfile } from './profiles.mts';
import { createReleaseVerificationServer } from './server.mts';
import { required } from './validation.mts';

const DIRECTORY = VERIFIER_SOCKET_DIRECTORY;
const SOCKET = `${DIRECTORY}/collector.sock`;
async function main() {
  // Original SDK and append authority stay solely with this process and its
  // qualified child. No secret value is a command argument, log or disk packet.
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[name] = () => {};
  let privateInput: Buffer | undefined,
    core: DurableCore | undefined,
    server: ReturnType<typeof createReleaseVerificationServer> | undefined;
  try {
    assert.ok(process.argv.length <= 3);
    const profileName = process.argv[2];
    const profile = releaseProfile(profileName);
    const info = await lstat(DIRECTORY);
    assert.ok(
      info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700,
    );
    privateInput = await readPrivatePacket(process.stdin);
    const packet = parseOwnerPrivatePacket(new TextDecoder('utf-8', { fatal: true }).decode(privateInput));
    const require = createRequire(new URL('../../worker/package.json', import.meta.url));
    const { Pool }: typeof import('pg') = require('pg');
    const { createDurableCore }: typeof import('../../packages/database/dist/index.js') = await import(
      pathToFileURL(require.resolve('@insignia/database')).href
    );
    core = createDurableCore(
      new Pool({
        connectionString: packet.databaseUrl,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        options: '-c statement_timeout=5000ms -c lock_timeout=5000ms',
      }),
    );
    server = createReleaseVerificationServer({
      profileName,
      async readBinding() {
        const managed = await required(core).tenants.getManagedInstallationState('insignia-rewrite-dev.myshopify.com');
        assert.ok(managed?.active);
        const scope = await required(core).tenants.getActiveAuthorizationScope({
          shopId: managed.shopId,
          installationGeneration: managed.currentGeneration,
        });
        assert.ok(
          scope &&
            scope.shopDomain === 'insignia-rewrite-dev.myshopify.com' &&
            scope.shopifyShopId === managed.shopifyShopId,
        );
        return {
          shopId: managed.shopId,
          installationGeneration: managed.currentGeneration,
          appClientId: '1443cf6d03d39edae7c101a943c5c684',
          authorizationGeneration: scope.authorizationGeneration,
          authorizationEpoch: scope.authorizationEpoch,
          externalInstallationId: managed.externalInstallationId,
        };
      },
      async readRecord(binding) {
        const evidence = await required(core).trustedReleaseRecords.read({
          scope: binding,
          expectedActiveAppVersionRef: profile.versionId,
          now: new Date(),
        });
        return evidence?.record.recordId ?? null;
      },
      async collect(request) {
        // Fresh intent ID is independent of all prior sealed runs. The existing
        // launcher requalifies source and prior settlement before reserving IO.
        const recordId = randomUUID();
        const bytes = Buffer.from(JSON.stringify({ ...packet, recordId }));
        const result = await launchQualifiedTrustedRelease(bytes, request, profileName);
        return { ...result, recordId };
      },
    });
    await new Promise<void>((resolve, reject) => {
      required(server).once('error', reject);
      required(server).listen(SOCKET, () => resolve());
    });
    await chmod(SOCKET, 0o600);
    emit('{"classification":"PRIVATE_COLLECTOR_LISTENING_NOT_NATIVE_QUALIFICATION"}\n');
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', () => resolve());
      process.once('SIGINT', () => resolve());
    });
    await new Promise<void>((resolve, reject) =>
      required(server).close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
    for (const name of ['clientSecret', 'appendPassword', 'databaseUrl']) Reflect.set(packet, name, undefined);
  } catch {
    emit('{"classification":"PRIVATE_COLLECTOR_STOPPED"}\n');
    process.exitCode = 1;
  } finally {
    privateInput?.fill(0);
    if (server)
      await new Promise<void>((resolve, reject) =>
        required(server).close((error) => (error ? reject(error) : resolve())),
      );
    await core?.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
