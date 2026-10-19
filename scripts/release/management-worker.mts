/** Fixed official SDK process. Auth/cache maintenance stays outside the denied-network owner process. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ReleaseAppendInput } from './append.mts';
import type { Reservation } from './collector.mts';
import { SESSION_CLIENT_SHA256, VERIFIER_SDK } from './paths.mts';
import { releaseProfile } from './profiles.mts';
import { array, callable, method, number, object, required, text } from './validation.mts';

const APP = '1443cf6d03d39edae7c101a943c5c684';
const pins = [
  ['package/dist/chunk-MJ3WNVMQ.js', '29df2593b46ba4b7162ef703dfdbea2175e2e55d6824df2ade708eff35432fea'],
  ['package/dist/chunk-NYHGIWKZ.js', 'a89873a128c3044b0870f2a82788a7e4d8f8642e9bb4bfcb0c0f0d4abc380d7a'],
  ['existing-session-qualification/client.mjs', SESSION_CLIENT_SHA256],
] as const;
export type RemoteApp = { id: string; organizationId: string; title: string };
export interface ManagementClient {
  activeAppVersionRawResult(key: string): Promise<unknown>;
  appVersions(remote: RemoteApp): Promise<unknown>;
  appVersionByTag(remote: RemoteApp, tag: string): Promise<unknown>;
}
export type ManagementObservation = {
  versions: ReleaseAppendInput['activeObservation']['versions'];
  totalResults: number;
  moduleObservation?: ReleaseAppendInput['moduleObservation'];
  observedAt?: string;
};
function selectedVersions(value: unknown, remote: RemoteApp, profile: ReturnType<typeof releaseProfile>) {
  const app = object(object(value).app),
    connection = object(app.appVersions);
  assert.equal(app.id, remote.id);
  const totalResults = number(object(connection.pageInfo).totalResults),
    versions = array(connection.nodes).map((value) => {
      const item = object(value);
      return { versionId: text(item.versionId), versionTag: text(item.versionTag), status: text(item.status) };
    });
  assert.equal(totalResults, profile.versionIds.length);
  assert.equal(versions.length, profile.versionIds.length);
  assert.deepEqual(
    new Set(versions.map((v) => v.versionId)),
    new Set(profile.versionIds.map((id) => `gid://shopify/Version/${id}`)),
  );
  for (const version of versions)
    assert.equal(
      version.status,
      version.versionId === `gid://shopify/Version/${profile.versionId}` ? 'active' : 'inactive',
    );
  assert.deepEqual(
    versions.filter((v) => v.status === 'active'),
    [{ versionId: `gid://shopify/Version/${profile.versionId}`, versionTag: profile.versionTag, status: 'active' }],
  );
  return { versions, totalResults };
}
export async function runManagementReads({
  client,
  reserve,
  send,
  waitClose,
  now = () => new Date().toISOString(),
  profileName,
}: {
  client: ManagementClient;
  reserve: Reservation;
  send(kind: 'OPEN' | 'CLOSE', value: ManagementObservation): Promise<unknown>;
  waitClose(): Promise<unknown>;
  now?: () => string;
  profileName?: string;
}) {
  const profile = releaseProfile(profileName);
  assert.equal((await reserve('ActiveAppReleaseFromApiKey')).durable, true);
  let raw: unknown = await client.activeAppVersionRawResult(APP);
  assert(Buffer.byteLength(JSON.stringify(raw)) <= 1048576);
  const remote = (() => {
    const app = object(object(raw).app);
    assert.equal(app.id, 'gid://shopify/App/429028933633');
    assert.equal(app.key, APP);
    const organizationId = required(text(app.organizationId).split('/').at(-1));
    assert.match(organizationId, /^[1-9][0-9]*$/);
    return { id: text(app.id), organizationId, title: 'Insignia' };
  })();
  raw = undefined;
  assert.equal((await reserve('AppVersions')).durable, true);
  const opening = selectedVersions(await client.appVersions(remote), remote, profile);
  assert.equal((await reserve('AppVersionByTag')).durable, true);
  const version = object(await client.appVersionByTag(remote, profile.versionTag)),
    observedAt = now();
  assert.equal(version.uuid, `gid://shopify/Version/${profile.versionId}`);
  assert.equal(version.versionTag, profile.versionTag);
  const rawModules = array(version.appModuleVersions);
  assert.equal(rawModules.length, profile.modules.length);
  const modules = rawModules.map((value) => {
    const item = object(value);
    return {
      registrationId: item.registrationId,
      registrationUuid: item.registrationUuid,
      handle: text(item.registrationTitle),
      type: item.type,
      config: item.config,
      target: item.target,
      specification: item.specification,
    };
  });
  await send('OPEN', {
    ...opening,
    moduleObservation: {
      appId: '429028933633',
      appClientId: APP,
      versionId: profile.versionId,
      versionTag: profile.versionTag,
      observedAt,
      modules,
    },
  });
  await waitClose();
  assert.equal((await reserve('AppVersions')).durable, true);
  const closing = selectedVersions(await client.appVersions(remote), remote, profile);
  await send('CLOSE', { ...closing, observedAt: now() });
}
function managementClient(value: unknown): ManagementClient {
  return {
    activeAppVersionRawResult: async (key) => method(value, 'activeAppVersionRawResult')(key),
    appVersions: async (remote) => method(value, 'appVersions')(remote),
    appVersionByTag: async (remote, tag) => method(value, 'appVersionByTag')(remote, tag),
  };
}
async function main() {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'] as const) console[name] = () => {};
  const lines = createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  const next = async (expected: string) => {
    const line = await lines.next();
    assert(!line.done && line.value === expected);
  };
  try {
    const profileName = process.argv[2];
    assert(process.argv.length <= 3);
    releaseProfile(profileName);
    await next('AUTHENTICATE');
    for (const [file, sha] of pins)
      assert.equal(
        createHash('sha256')
          .update(await readFile(`${VERIFIER_SDK}/${file}`))
          .digest('hex'),
        sha,
      );
    const sdk: unknown = await import(pathToFileURL(`${VERIFIER_SDK}/package/dist/chunk-MJ3WNVMQ.js`).href),
      auth: unknown = await import(pathToFileURL(`${VERIFIER_SDK}/package/dist/chunk-NYHGIWKZ.js`).href);
    const { existingClient }: typeof import('../../deployment/release-verifier/client.mts') = await import(
      pathToFileURL(`${VERIFIER_SDK}/existing-session-qualification/client.mjs`).href
    );
    const seeded = await existingClient({
      authenticate: async (options) => callable(object(auth).Q)(options),
      getClient: () => callable(object(sdk).z)(),
    });
    const client = managementClient(seeded);
    emit('AUTHENTICATED\n');
    await next('OPEN');
    await runManagementReads({
      client,
      profileName,
      reserve: async (operation) => {
        emit(`RESERVE ${operation}\n`);
        await next('DURABLE_ACK');
        return { durable: true };
      },
      send: async (kind, value) => {
        const line = JSON.stringify(value);
        assert(Buffer.byteLength(line) <= 1048576);
        emit(`${kind} ${line}\n`);
      },
      waitClose: () => next('CLOSE'),
    });
  } catch {
    emit('STOP\n');
    process.exitCode = 1;
  } finally {
    await lines.return?.();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
