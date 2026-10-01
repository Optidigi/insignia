import { createHash } from 'node:crypto';
import {
  FUNCTION_OWNERSHIP_QUERY,
  PublicationAdminError,
  type PublicationAdminTransport,
  type PublicationTenant,
} from './publication-admin.js';

export type FunctionPresence = 'present' | 'missing' | 'duplicate' | 'drift' | 'unknown';
export type OwnedFunctionObjectIdentity = Readonly<{
  functionId: string;
  handle: string;
  apiType: 'cart_transform' | 'cart_checkout_validation';
  apiVersion: string;
  inputQuerySha256: string;
}>;
export type OwnedFunctionObjectObservation = Readonly<{
  shopId: string;
  installationGeneration: string;
  appClientId: string;
  observedAt: string;
  transform: OwnedFunctionObjectIdentity | null;
  validation: OwnedFunctionObjectIdentity | null;
}>;
export type FunctionOwnership = {
  transform: FunctionPresence;
  validation: FunctionPresence;
  /** Admin exposes no deployed Wasm hash or global propagation barrier. */
  runtimeIdentity: 'unverifiable';
  readiness: 'unknown';
  /** Owned objects exist independently of active Transform/Validation deployments; no Wasm claim. */
  observation: OwnedFunctionObjectObservation | null;
};
export type ExpectedFunctionOwnership = {
  /** The installed app's client ID, not an arbitrary merchant-supplied app key. */
  appKey: string;
  transformInputQuerySha256: string;
  validationInputQuerySha256: string;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const unknown: FunctionOwnership = {
  transform: 'unknown',
  validation: 'unknown',
  runtimeIdentity: 'unverifiable',
  readiness: 'unknown',
  observation: null,
};
const handles = {
  transform: 'insignia-experimental-v2-transform',
  validation: 'insignia-experimental-v2-validation',
} as const;
function nodes(value: unknown): Record<string, unknown>[] | null {
  const connection = record(value);
  const entries = connection?.nodes;
  if (
    !Array.isArray(entries) ||
    record(connection?.pageInfo)?.hasNextPage !== false ||
    entries.length > 25 ||
    !entries.every((entry: unknown) => record(entry))
  )
    return null;
  return entries as Record<string, unknown>[];
}
function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Read-only: an absent/partial/provider-uncertain observation never becomes READY. */
export function createFunctionOwnershipReconciler(config: {
  transport: PublicationAdminTransport;
  clock?: () => Date;
}) {
  return {
    async read(tenant: PublicationTenant, expected: ExpectedFunctionOwnership): Promise<FunctionOwnership> {
      if (
        !config?.transport ||
        !tenant ||
        !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(tenant.shopifyShopId) ||
        !expected ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(expected.appKey) ||
        !/^[a-f0-9]{64}$/.test(expected.transformInputQuerySha256) ||
        !/^[a-f0-9]{64}$/.test(expected.validationInputQuerySha256)
      )
        throw new PublicationAdminError('invalid_request');
      let response: Awaited<ReturnType<PublicationAdminTransport['execute']>>;
      try {
        response = await config.transport.execute({
          operation: 'function_ownership',
          tenant,
          query: FUNCTION_OWNERSHIP_QUERY,
          variables: {},
        });
      } catch (error) {
        if (error instanceof PublicationAdminError) throw error;
        throw new PublicationAdminError('network_or_timeout');
      }
      if (response.status === 401) throw new PublicationAdminError('unauthorized');
      if (response.status === 403) throw new PublicationAdminError('forbidden');
      if (response.status === 429) throw new PublicationAdminError('throttled');
      if (response.status >= 500) throw new PublicationAdminError('provider_unavailable');
      if (response.status !== 200) throw new PublicationAdminError('graphql_error');
      const envelope = record(response.body);
      if (!envelope) throw new PublicationAdminError('provider_shape');
      if (envelope.errors !== undefined) throw new PublicationAdminError('graphql_error');
      const data = record(envelope.data);
      if (!data || record(data.shop)?.id !== tenant.shopifyShopId) return unknown;
      const functions = nodes(data.shopifyFunctions);
      const transforms = nodes(data.cartTransforms);
      const validations = nodes(data.validations);
      if (!functions) return unknown;
      const owned = (handle: string) => functions.filter((item) => item.handle === handle);
      const objectIdentity = (kind: 'transform' | 'validation'): OwnedFunctionObjectIdentity | null => {
        const matches = owned(handles[kind]);
        const found = matches[0];
        if (
          matches.length !== 1 ||
          !found ||
          found.appKey !== expected.appKey ||
          typeof found.id !== 'string' ||
          !found.id ||
          typeof found.apiVersion !== 'string' ||
          typeof found.inputQuery !== 'string' ||
          (found.apiType !== 'cart_transform' && found.apiType !== 'cart_checkout_validation')
        )
          return null;
        return Object.freeze({
          functionId: found.id,
          handle: handles[kind],
          apiType: found.apiType,
          apiVersion: found.apiVersion,
          inputQuerySha256: hash(found.inputQuery),
        });
      };
      const observation = Object.freeze({
        shopId: tenant.shopId,
        installationGeneration: tenant.installationGeneration,
        appClientId: expected.appKey,
        observedAt: (config.clock ?? (() => new Date()))().toISOString(),
        transform: objectIdentity('transform'),
        validation: objectIdentity('validation'),
      });
      if (!transforms || !validations) return { ...unknown, observation };
      const status = (kind: 'transform' | 'validation'): FunctionPresence => {
        const matches = owned(handles[kind]);
        if (matches.length > 1) return 'duplicate';
        const found = matches[0];
        if (!found) return 'missing';
        if (
          found.appKey !== expected.appKey ||
          found.apiVersion !== '2026-07' ||
          typeof found.id !== 'string' ||
          !found.id ||
          typeof found.inputQuery !== 'string'
        )
          return 'unknown';
        if (found.apiType !== (kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation')) return 'drift';
        const expectedHash =
          kind === 'transform' ? expected.transformInputQuerySha256 : expected.validationInputQuerySha256;
        if (hash(found.inputQuery) !== expectedHash) return 'drift';
        const deployments =
          kind === 'transform'
            ? transforms.filter((item) => item.functionId === found.id)
            : validations.filter((item) => record(item.shopifyFunction)?.id === found.id);
        if (deployments.length > 1) return 'duplicate';
        const deployment = deployments[0];
        if (!deployment) return 'missing';
        if (kind === 'transform') {
          if (deployment.blockOnFailure !== true) return 'drift';
        } else {
          const functionRef = record(deployment.shopifyFunction);
          if (
            functionRef?.appKey !== expected.appKey ||
            functionRef.handle !== handles.validation ||
            deployment.enabled !== true ||
            deployment.blockOnFailure !== true
          )
            return 'drift';
        }
        return 'present';
      };
      return {
        transform: status('transform'),
        validation: status('validation'),
        runtimeIdentity: 'unverifiable',
        readiness: 'unknown',
        observation,
      };
    },
  };
}
