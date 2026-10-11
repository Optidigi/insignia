import {
  FUNCTION_TRANSFORM_CREATE,
  FUNCTION_VALIDATION_CREATE,
  PublicationAdminError,
  type PublicationAdminTransport,
  type PublicationTenant,
} from './publication-admin.js';

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const fail = (kind: 'invalid_request' | 'not_dispatched' | 'user_error' | 'ambiguous_write'): never => {
  throw new PublicationAdminError(kind);
};
/** Internal operator capability only. Fresh prestate, durable admission and exact readback belong to the owner workflow.
 * One dispatched attempt per kind; no create retry or automatic compensation. */
export function createFunctionProvisioningPort(config: {
  transport: PublicationAdminTransport;
  appKey: string;
  functionIds: Readonly<{ transform: string; validation: string }>;
}) {
  if (
    !config?.transport ||
    typeof config.transport.execute !== 'function' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(config.appKey) ||
    !['transform', 'validation'].every(
      (kind) =>
        typeof config.functionIds?.[kind as 'transform' | 'validation'] === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(config.functionIds[kind as 'transform' | 'validation']),
    ) ||
    config.functionIds.transform === config.functionIds.validation
  )
    fail('invalid_request');
  const ids = Object.freeze({ ...config.functionIds });
  const appKey = config.appKey;
  const attempted = new Set<'transform' | 'validation'>();
  return {
    async create(
      kind: 'transform' | 'validation',
      tenant: PublicationTenant,
      beforeSend: () => boolean,
    ): Promise<{ id: string }> {
      if (!['transform', 'validation'].includes(kind) || typeof beforeSend !== 'function')
        return fail('invalid_request');
      if (attempted.has(kind)) return fail('not_dispatched');
      let dispatched = false;
      try {
        const response = await config.transport.execute(
          {
            operation: kind === 'transform' ? 'function_transform_create' : 'function_validation_create',
            tenant,
            query: kind === 'transform' ? FUNCTION_TRANSFORM_CREATE : FUNCTION_VALIDATION_CREATE,
            variables: {},
          },
          () => {
            if (attempted.has(kind) || beforeSend() !== true) return false;
            attempted.add(kind);
            dispatched = true;
            return true;
          },
        );
        if (!dispatched || response.status !== 200) return fail(dispatched ? 'ambiguous_write' : 'not_dispatched');
        const envelope = record(response.body);
        if (!envelope || envelope.errors !== undefined) return fail('ambiguous_write');
        const payload = record(
          record(envelope.data)?.[kind === 'transform' ? 'cartTransformCreate' : 'validationCreate'],
        );
        const errors = payload?.userErrors;
        const rawItem = payload?.[kind === 'transform' ? 'cartTransform' : 'validation'];
        const item = record(rawItem);
        if (!Array.isArray(errors)) return fail('ambiguous_write');
        if (errors.length) return fail(rawItem === null ? 'user_error' : 'ambiguous_write');
        const prefix = kind === 'transform' ? 'CartTransform' : 'Validation';
        if (
          !item ||
          typeof item.id !== 'string' ||
          !new RegExp(`^gid://shopify/${prefix}/[1-9][0-9]*$`).test(item.id) ||
          item.blockOnFailure !== true
        )
          return fail('ambiguous_write');
        if (kind === 'transform') {
          if (item.functionId !== ids.transform) return fail('ambiguous_write');
        } else {
          const ref = record(item.shopifyFunction);
          if (
            item.enabled !== true ||
            ref?.id !== ids.validation ||
            ref.appKey !== appKey ||
            ref.handle !== 'insignia-experimental-v2-validation'
          )
            return fail('ambiguous_write');
        }
        return Object.freeze({ id: item.id });
      } catch (error) {
        if (!dispatched) throw error;
        if (error instanceof PublicationAdminError && error.kind === 'user_error') throw error;
        return fail('ambiguous_write');
      }
    },
  };
}
