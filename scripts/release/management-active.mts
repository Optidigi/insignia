import assert from 'node:assert/strict';
import { array, method, object, text } from './validation.mts';

const query = `query InsigniaFixedActive($apiKey: String!) {
  app: appByKey(key: $apiKey) {
    id key organizationId
    activeRelease { version {
      id metadata { versionTag }
      appModules { uuid userIdentifier handle config target specification {
        identifier externalIdentifier name experience managementExperience
      } }
    } }
  }
}`;

export async function readFixedActive(client: unknown, key: string) {
  const value = await method(client, 'appManagementRequest')({ query, variables: { apiKey: key } });
  assert(Buffer.byteLength(JSON.stringify(value)) <= 1048576);
  assert(!('errors' in object(value)));
  return value;
}

// CLI4.8.2 Hn/me projection, deliberately independent of private SDK runtime.
export function projectActiveModules(value: unknown) {
  return array(value).map((value) => {
    const item = object(value),
      spec = object(item.specification);
    for (const key of ['identifier', 'externalIdentifier', 'name', 'managementExperience']) text(spec[key]);
    if (spec.experience != null) text(spec.experience);
    const experience =
      spec.externalIdentifier === 'webhook_subscription'
        ? 'configuration'
        : ['extension', 'configuration', 'deprecated'].includes(String(spec.experience))
          ? spec.experience
          : 'extension';
    return {
      registrationId: item.userIdentifier === item.uuid ? '' : text(item.userIdentifier),
      registrationUuid: text(item.uuid),
      handle: text(item.handle),
      type: spec.externalIdentifier,
      config: object(item.config),
      target: item.target == null ? '' : text(item.target),
      specification: {
        ...spec,
        identifier: spec.identifier,
        options: { managementExperience: spec.managementExperience },
        experience,
      },
    };
  });
}
