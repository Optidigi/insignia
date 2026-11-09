import assert from 'node:assert/strict';
import { array, method, number, object, text } from './validation.mts';

// Same required inventory fields and authenticated SDK transport as CLI4.8.2 AppVersions.
// Its fixed first:20 truncates the current inventory. Keep a finite request and
// require the provider's full count; the caller still checks every exact ID/status.
const query = `query AppVersions($appId: ID!) {
  app(id: $appId) {
    id
    activeRelease { version { id } }
    versions(first: 100) { edges { node { id metadata { versionTag } } } }
    versionsCount
  }
}`;

export async function readAppVersionInventory(client: unknown, remote: { id: string }) {
  const result = await method(client, 'appManagementRequest')({ query, variables: { appId: remote.id } });
  assert(Buffer.byteLength(JSON.stringify(result)) <= 1048576);
  assert(!('errors' in object(result)));
  const app = object(object(result).app);
  assert.equal(app.id, remote.id);
  const totalResults = number(app.versionsCount);
  assert(Number.isSafeInteger(totalResults) && totalResults > 0 && totalResults <= 100);
  const activeId = text(object(object(app.activeRelease).version).id);
  const nodes = array(object(app.versions).edges).map((value) => {
    const node = object(object(value).node);
    const versionId = text(node.id);
    assert.match(versionId, /^gid:\/\/shopify\/Version\/[1-9][0-9]*$/);
    return {
      versionId,
      versionTag: text(object(node.metadata).versionTag),
      status: versionId === activeId ? 'active' : 'inactive',
    };
  });
  assert.equal(nodes.length, totalResults, 'Complete version inventory required');
  assert.equal(new Set(nodes.map((node) => node.versionId)).size, totalResults);
  assert.equal(nodes.filter((node) => node.status === 'active').length, 1);
  return { app: { id: text(app.id), appVersions: { nodes, pageInfo: { totalResults } } } };
}
