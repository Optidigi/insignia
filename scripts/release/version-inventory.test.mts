import assert from 'node:assert/strict';
import test from 'node:test';
import { readAppVersionInventory } from './version-inventory.mts';

const remote = { id: 'gid://shopify/App/429028933633', organizationId: '200969036', title: 'Insignia' };
function response(count: number, returned = count) {
  return {
    app: {
      id: remote.id,
      activeRelease: { version: { id: 'gid://shopify/Version/1' } },
      versionsCount: count,
      versions: {
        edges: Array.from({ length: returned }, (_, index) => ({
          node: {
            id: `gid://shopify/Version/${index + 1}`,
            metadata: { versionTag: `version-${index + 1}` },
          },
        })),
      },
    },
  };
}

test('the reviewed SDK transport reads a complete 21-version inventory in one bounded request', async () => {
  let calls = 0;
  const client = {
    async appManagementRequest(input: { query: string; variables: { appId: string } }) {
      calls++;
      assert.match(input.query, /versions\(first: 100\)/);
      assert.doesNotMatch(input.query, /mutation|token|session/);
      assert.deepEqual(input.variables, { appId: remote.id });
      return response(21);
    },
  };
  const result = await readAppVersionInventory(client, remote);
  assert.equal(calls, 1);
  assert.equal(result.app.appVersions.pageInfo.totalResults, 21);
  assert.equal(result.app.appVersions.nodes.length, 21);
  assert.equal(result.app.appVersions.nodes[20]?.versionId, 'gid://shopify/Version/21');
  assert.equal(result.app.appVersions.nodes[0]?.status, 'active');
  assert.equal(result.app.appVersions.nodes.filter((item) => item.status === 'active').length, 1);
});

test('partial, over-capacity, foreign and malformed inventory responses remain unavailable', async () => {
  const foreign = response(21);
  foreign.app.id = 'gid://shopify/App/999';
  for (const value of [response(21, 20), response(101, 100), foreign, { app: null }])
    await assert.rejects(readAppVersionInventory({ appManagementRequest: async () => value }, remote));
});
