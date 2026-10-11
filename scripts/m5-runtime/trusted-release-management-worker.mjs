/** Fixed official SDK process. Its authorized HTTP/auth maintenance is separate
 * from the owner's denied-global-fetch Admin process. Never import in the web. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = '/home/serveradmin/insignia-milestone-autonomy-handoff/app-management-readonly-preparation-20261010';
const APP = '1443cf6d03d39edae7c101a943c5c684';
const VERSION = '1163229200385';
const TAG = 'm5-functions-9c2e56b42fbf';
const pins = [
  ['package/dist/chunk-MJ3WNVMQ.js', '29df2593b46ba4b7162ef703dfdbea2175e2e55d6824df2ade708eff35432fea'],
  ['package/dist/chunk-NYHGIWKZ.js', 'a89873a128c3044b0870f2a82788a7e4d8f8642e9bb4bfcb0c0f0d4abc380d7a'],
  ['existing-session-qualification/client.mjs', '0ef1b8bc8e073b7753d93ed2a912148d7c87de5c3804622607040cb414b4f641'],
];
function selectedVersions(value, remote) {
  assert.equal(value.app.id, remote.id);
  const totalResults = value.app.appVersions.pageInfo.totalResults;
  const versions = value.app.appVersions.nodes.map(({ versionId, versionTag, status }) => ({
    versionId,
    versionTag,
    status,
  }));
  assert.equal(totalResults, 7);
  assert.equal(versions.length, 7);
  assert.deepEqual(
    versions.filter((v) => v.status === 'active'),
    [{ versionId: `gid://shopify/Version/${VERSION}`, versionTag: TAG, status: 'active' }],
  );
  return { versions, totalResults };
}

/** Offline seam: fixed original method calls and closed selected projections. */
export async function runManagementReads({ client, reserve, send, waitClose, now = () => new Date().toISOString() }) {
  assert.equal((await reserve('ActiveAppReleaseFromApiKey')).durable, true);
  let raw = await client.activeAppVersionRawResult(APP);
  // Post-read private memory guard, not an HTTP/SDK allocation ceiling. The
  // original root necessarily contains secrets; never emit or capture it.
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) <= 1048576);
  assert.equal(raw.app.id, 'gid://shopify/App/429028933633');
  assert.equal(raw.app.key, APP);
  assert.equal(typeof raw.app.organizationId, 'string');
  const organizationId = raw.app.organizationId.split('/').at(-1);
  assert.match(organizationId, /^[1-9][0-9]*$/);
  const remote = { id: raw.app.id, organizationId, title: 'Insignia' };
  // Original root includes secrets. Do not copy/log/capture it or infer a
  // Version ID from opaque Release.id; original AppVersions binds Active.
  raw = undefined;
  assert.equal((await reserve('AppVersions')).durable, true);
  const opening = selectedVersions(await client.appVersions(remote), remote);
  assert.equal((await reserve('AppVersionByTag')).durable, true);
  const version = await client.appVersionByTag(remote, TAG);
  const observedAt = now();
  assert.equal(version.uuid, `gid://shopify/Version/${VERSION}`);
  assert.equal(version.versionTag, TAG);
  assert.ok(Array.isArray(version.appModuleVersions) && version.appModuleVersions.length === 6);
  const modules = version.appModuleVersions.map((m) => ({
    registrationId: m.registrationId,
    registrationUuid: m.registrationUuid,
    handle: m.registrationTitle,
    type: m.type,
    config: m.config,
    target: m.target,
    specification: m.specification,
  }));
  await send('OPEN', {
    ...opening,
    moduleObservation: {
      appId: '429028933633',
      appClientId: APP,
      versionId: VERSION,
      versionTag: TAG,
      observedAt,
      modules,
    },
  });
  await waitClose();
  assert.equal((await reserve('AppVersions')).durable, true);
  const closing = selectedVersions(await client.appVersions(remote), remote);
  await send('CLOSE', { ...closing, observedAt: now() });
}

async function main() {
  const emit = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[name] = () => {};
  const lines = createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  const next = async (expected) => {
    const line = await lines.next();
    assert.ok(!line.done && line.value === expected);
  };
  try {
    await next('AUTHENTICATE');
    for (const [file, sha] of pins)
      assert.equal(
        createHash('sha256')
          .update(await readFile(`${BASE}/${file}`))
          .digest('hex'),
        sha,
      );
    const sdk = await import(pathToFileURL(`${BASE}/package/dist/chunk-MJ3WNVMQ.js`));
    const auth = await import(pathToFileURL(`${BASE}/package/dist/chunk-NYHGIWKZ.js`));
    const { existingClient } = await import(pathToFileURL(`${BASE}/existing-session-qualification/client.mjs`));
    const client = await existingClient({ authenticate: (options) => auth.Q(options), getClient: sdk.z });
    emit('AUTHENTICATED\n');
    await next('OPEN');
    await runManagementReads({
      client,
      reserve: async (operation) => {
        emit(`RESERVE ${operation}\n`);
        await next('DURABLE_ACK');
        return { durable: true };
      },
      send: async (kind, value) => {
        const line = JSON.stringify(value);
        assert.ok(Buffer.byteLength(line) <= 1048576);
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
