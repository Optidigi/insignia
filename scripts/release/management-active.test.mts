import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { type CollectorPorts, collectFreshTrustedRelease } from './collector.mts';
import { fixture } from './collector-fixture.mts';
import { projectActiveModules } from './management-active.mts';
import { managementClient, runManagementReads } from './management-worker.mts';
import { releaseProfile } from './profiles.mts';

const profile = releaseProfile();
const rawModules = profile.modules.map((m) => ({
  uuid: m.registrationUuid,
  userIdentifier: m.registrationId || m.registrationUuid,
  handle: m.handle,
  config: m.config,
  target: m.target,
  specification: m.specification,
}));
test('actual fixed transport completes three reads and invalid openings cannot pass OPEN', async () => {
  for (const fault of ['', 'identity', 'inventory', 'version', 'tag', 'modules', 'errors', 'nullable', 'size', 'ack']) {
    const trace: string[] = [];
    const active = {
      app: {
        id: 'gid://shopify/App/429028933633',
        key: '1443cf6d03d39edae7c101a943c5c684',
        organizationId: 'gid://shopify/Organization/123',
        activeRelease: {
          version: {
            id: `gid://shopify/Version/${profile.versionId}`,
            metadata: { versionTag: profile.versionTag },
            appModules: structuredClone(rawModules),
          },
        },
      },
    };
    const value: any = active;
    if (fault === 'identity') value.app.key = 'foreign';
    if (fault === 'version') value.app.activeRelease.version.id = 'gid://shopify/Version/99';
    if (fault === 'tag') value.app.activeRelease.version.metadata.versionTag = 'foreign';
    if (fault === 'modules') value.app.activeRelease.version.appModules[0].config = {};
    if (fault === 'errors') value.errors = [{ message: 'partial' }];
    if (fault === 'nullable') value.app.activeRelease.version = null;
    if (fault === 'size') value.padding = 'x'.repeat(1048576);
    const client = managementClient({
      async appManagementRequest(input: any) {
        assert.deepEqual(Object.keys(input).sort(), ['query', 'variables']);
        assert.doesNotMatch(input.query, /secrets|location|versionByTag/);
        if ('apiKey' in input.variables) {
          trace.push('active');
          return value;
        }
        trace.push('inventory');
        clock += 500;
        return {
          app: {
            id: active.app.id,
            activeRelease: { version: { id: `gid://shopify/Version/${profile.versionId}` } },
            versionsCount: profile.versionIds.length,
            versions: {
              edges: profile.versionIds.map((id, i) => ({
                node: {
                  id: `gid://shopify/Version/${fault === 'inventory' && i === 1 ? '999' : id}`,
                  metadata: { versionTag: id === profile.versionId ? profile.versionTag : `old-${i}` },
                },
              })),
            },
          },
        };
      },
    });
    let opened = false;
    let clock = Date.parse('2026-10-11T12:00:00.000Z');
    let moduleTime: string | undefined;
    const run = runManagementReads({
      client,
      reserve: async () => ({ durable: fault !== 'ack' }),
      now: () => new Date(clock).toISOString(),
      send: async (kind, observation) => {
        if (kind === 'OPEN') {
          opened = true;
          moduleTime = observation.moduleObservation?.observedAt;
        }
      },
      waitClose: async () => {},
    });
    if (!fault) {
      await run;
      assert.equal(opened, true);
      assert.deepEqual(trace, ['active', 'inventory', 'inventory']);
      assert.equal(moduleTime, '2026-10-11T12:00:00.000Z', 'inventory delay cannot restamp module observation');
    } else {
      await assert.rejects(run);
      assert.equal(opened, false);
      if (fault === 'identity') assert.deepEqual(trace, ['active']);
      const f = await fixture();
      try {
        const ports: CollectorPorts = {
          ...f.ports,
          management: {
            authenticate: async () => {},
            open: async (reserve) =>
              runManagementReads({
                client,
                reserve: async (operation) => (fault === 'ack' ? { durable: false } : reserve(operation)),
                send: async () => {
                  throw Error('Rejected transport must never emit OPEN');
                },
                waitClose: async () => {},
              }),
            close: async () => {
              throw Error('Closing read forbidden');
            },
          },
        };
        assert.equal(
          (await collectFreshTrustedRelease(f.config, ports)).classification,
          'TRUSTED_RELEASE_COLLECT_STOPPED',
        );
        assert.equal(f.acquisitions, 0, 'transport rejection must stop before OAuth');
        assert.equal(f.appends, 0, 'transport rejection must stop before append');
      } finally {
        await f.close();
      }
    }
  }
});
test('projection differentially matches pinned Hn and me without importing SDK runtime', async () => {
  // Verbatim Hn/me reference from Shopify CLI4.8.2, chunk-MJ3WNVMQ.js.
  // Pinned upstream: packages/app/src/cli/utilities/developer-platform-client/app-management-client.ts.
  const reference =
    'function me(n,e){if(e===ne)return"configuration";switch(n){case"extension":case"configuration":case"deprecated":return n;default:return G(`Unknown specification experience value "${n}", defaulting to "extension"`),"extension"}};function Hn(n){return{registrationId:n.userIdentifier===n.uuid?"":n.userIdentifier,registrationUuid:n.uuid,registrationTitle:n.handle,type:n.specification.externalIdentifier,config:n.config,target:n.target??"",specification:{...n.specification,identifier:n.specification.identifier,options:{managementExperience:n.specification.managementExperience},experience:me(n.specification.experience,n.specification.externalIdentifier)}}}';
  assert.equal(
    createHash('sha256').update(reference).digest('hex'),
    '9352d62155b466b728961935f2872fa35246864bca24090984cdcc30a6b9fecb',
  );
  const mapper = runInNewContext(`${reference};Hn`, { ne: 'webhook_subscription', G: () => {} });
  const fixtures = [
    ...rawModules,
    ...['extension', 'configuration', 'deprecated', 'unknown', null, undefined].flatMap((experience) =>
      [null, undefined, 'target'].map((target) => ({
        uuid: 'uuid',
        userIdentifier: 'uuid',
        handle: 'fixture',
        config: { a: 1 },
        target,
        specification: {
          identifier: 'id',
          externalIdentifier: target === 'target' ? 'webhook_subscription' : 'other',
          name: 'fixture',
          experience,
          managementExperience: 'cli',
        },
      })),
    ),
  ];
  for (const row of fixtures) {
    const expected = mapper(row);
    expected.handle = expected.registrationTitle;
    delete expected.registrationTitle;
    assert.deepEqual(JSON.parse(JSON.stringify(projectActiveModules([row])[0])), JSON.parse(JSON.stringify(expected)));
  }
});
