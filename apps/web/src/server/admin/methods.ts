import { randomUUID } from 'node:crypto';
import { executeCommand } from '@insignia/application';
import { type MethodConfiguration, MethodConfigurationSchema } from '@insignia/contracts';
import {
  type ActiveAuthorizationScope,
  type DurableCore,
  type DurableTransaction,
  sha256CanonicalJson,
} from '@insignia/database';
import { type MethodProductTags, reconcileSelectedMethodDrafts } from '../selected-method-reconciliation.ts';
import type { AdminActor, MethodConfigurationOutcome, MethodLibrary, MethodOutcome } from './contracts.js';

export class MethodAuthorizationError extends Error {}
export class MethodCurrencyConflictError extends Error {}

/** Mutable defaults propagate only through explicit selected-draft inheritance. */
export function createMethodLibrary(
  core: DurableCore,
  options: {
    productTags?: (actor: AdminActor, productIds: string[]) => Promise<MethodProductTags>;
    currency?: (actor: AdminActor) => Promise<string>;
  } = {},
): MethodLibrary {
  async function authorized(actor: AdminActor, tx: DurableTransaction) {
    const scope = await core.tenants.lockActiveAuthorizationScope(tx, {
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || `gid://shopify/Shop/${scope.shopifyShopId}` !== actor.shopId)
      throw new MethodAuthorizationError('Current tenant installation required');
    return scope;
  }
  async function prepareProductTags(
    actor: AdminActor,
    methodId: string,
    expectedVersion: string | null,
    next?: MethodConfiguration,
  ): Promise<MethodProductTags> {
    const products = await core.transactions.run(async (tx) => {
      if (!actor.canRead || !actor.canEdit) throw new Error('Edit permission required');
      await authorized(actor, tx);
      const current = (await core.methodCatalog.listConfigurations(tx, actor.tenantShopId)).find(
        (entry) => entry.configuration.id === methodId,
      );
      // Replays/stale commands must reach durable dedup without depending on a fresh provider read.
      if (!current || current.version !== expectedVersion || (next ?? current.configuration).assignment !== 'tags')
        return [];
      return (await core.configs.listSelectedForMethod(tx, actor.tenantShopId, methodId)).map(
        (record) => record.externalProductId,
      );
    });
    if (!products.length) return {};
    if (!options.productTags) throw new Error('Current product assignment tags unavailable');
    return options.productTags(actor, [...new Set(products)]);
  }
  function authority(scope: ActiveAuthorizationScope) {
    return sha256CanonicalJson(scope);
  }
  async function command(
    actor: AdminActor,
    action: string,
    key: string,
    request: unknown,
    work: (tx: DurableTransaction) => Promise<MethodOutcome>,
    expectedAuthority?: string,
  ): Promise<MethodOutcome> {
    if (!actor.canEdit || !actor.canRead) throw new Error('Edit permission required');
    return core.transactions.run(async (tx) => {
      // Lock before dedup's shop FK key-share, avoiding concurrent lock upgrades.
      const scope = await authorized(actor, tx);
      if (expectedAuthority !== undefined && authority(scope) !== expectedAuthority)
        throw new MethodAuthorizationError('Method authorization changed');
      const result = await executeCommand(
        { run: <T>(run: (transaction: DurableTransaction) => Promise<T>) => run(tx) },
        core.commands,
        {
          shopId: actor.tenantShopId,
          namespace: `merchant-method-${action}:${scope.installationGeneration}:${scope.authorizationGeneration}`,
          key,
          requestDigest: sha256CanonicalJson({
            request,
            installationGeneration: scope.installationGeneration,
            authorizationGeneration: scope.authorizationGeneration,
            authorizationEpoch: scope.authorizationEpoch,
          }),
        },
        async () => {
          const outcome = await work(tx);
          // Dedup persists identity/version only, never a second private name copy.
          return JSON.stringify(
            outcome.kind === 'created' || outcome.kind === 'saved'
              ? { kind: outcome.kind, id: outcome.method.id, version: outcome.method.version }
              : outcome,
          );
        },
      );
      const stored = JSON.parse(result.resultRef) as
        | Exclude<MethodOutcome, { method: unknown }>
        | { kind: 'created' | 'saved'; id: string; version: string };
      if (!('id' in stored)) return stored;
      const method = (await core.methodCatalog.list(tx, actor.tenantShopId)).find(
        (item) => item.id === stored.id && item.version === stored.version,
      );
      // A replay must not invent a success for a subsequently changed/deleted row.
      return method ? { kind: stored.kind, method } : conflict();
    });
  }

  function name(value: string) {
    if (
      !value ||
      value !== value.trim() ||
      value.length > 80 ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new Error('Invalid method name');
    return value;
  }
  function identity(id: string, version: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
      !/^[1-9][0-9]{0,17}$/.test(version)
    )
      throw new Error('Invalid method identity');
  }
  const conflict = (): Extract<MethodOutcome, { kind: 'conflict' }> => ({
    kind: 'conflict',
    message: 'This method changed or was removed. Reload the method library before trying again.',
  });
  return {
    catalog: async (actor) => {
      const currency = options.currency ? await options.currency(actor) : undefined;
      return core.transactions.run(async (tx) => {
        if (!actor.canRead) throw new Error('Read permission required');
        const scope = await authorized(actor, tx);
        return {
          methods: await core.methodCatalog.listConfigurations(tx, actor.tenantShopId),
          shop: actor.shop,
          canEdit: actor.canEdit,
          authority: authority(scope),
          ...(currency ? { currency } : {}),
        };
      });
    },
    async saveConfiguration(
      actor,
      input,
      expectedVersion,
      key,
      expectedAuthority,
      expectedCurrency,
    ): Promise<MethodConfigurationOutcome> {
      const value: MethodConfiguration = MethodConfigurationSchema.parse(input);
      if (expectedVersion !== null) identity(value.id, expectedVersion);
      if (!actor.canEdit || !actor.canRead) throw new Error('Edit permission required');
      const currency = options.currency ? await options.currency(actor) : undefined;
      if (expectedCurrency !== undefined && currency !== expectedCurrency)
        throw new MethodCurrencyConflictError('Shop currency changed. Review the Method price before saving.');
      if (value.pricing === 'fixed' && currency !== 'USD' && currency !== 'EUR')
        throw new Error('Current Method currency unavailable');
      const productTags = await prepareProductTags(actor, value.id, expectedVersion, value);
      return core.transactions.run(async (tx) => {
        const scope = await authorized(actor, tx);
        if (expectedAuthority !== undefined && authority(scope) !== expectedAuthority)
          throw new MethodAuthorizationError('Method authorization changed');
        const outcome = await executeCommand(
          { run: <T>(run: (transaction: DurableTransaction) => Promise<T>) => run(tx) },
          core.commands,
          {
            shopId: actor.tenantShopId,
            namespace: `merchant-method-configure:${scope.installationGeneration}:${scope.authorizationGeneration}`,
            key,
            requestDigest: sha256CanonicalJson({
              value,
              currency,
              expectedVersion,
              generation: scope.installationGeneration,
              authorizationGeneration: scope.authorizationGeneration,
              authorizationEpoch: scope.authorizationEpoch,
            }),
          },
          async () => {
            const method = await core.methodCatalog.saveConfiguration(
              tx,
              actor.tenantShopId,
              value,
              expectedVersion,
              currency,
            );
            if (method)
              await reconcileSelectedMethodDrafts({
                core,
                transaction: tx,
                shopId: actor.tenantShopId,
                methodId: value.id,
                current: method,
                productTags,
              });
            return JSON.stringify(
              method
                ? {
                    kind: expectedVersion === null ? 'created' : 'saved',
                    id: method.configuration.id,
                    version: method.version,
                  }
                : conflict(),
            );
          },
        );
        const receipt: { kind: 'created' | 'saved' | 'conflict'; id?: string; version?: string; message?: string } =
          JSON.parse(outcome.resultRef);
        if (receipt.kind === 'conflict') return conflict();
        const method = (await core.methodCatalog.listConfigurations(tx, actor.tenantShopId)).find(
          (entry) => entry.configuration.id === receipt.id && entry.version === receipt.version,
        );
        return method ? { kind: receipt.kind, method } : conflict();
      });
    },
    list: (actor) =>
      core.transactions.run(async (tx) => {
        if (!actor.canRead) throw new Error('Read permission required');
        await authorized(actor, tx);
        return { methods: await core.methodCatalog.list(tx, actor.tenantShopId) };
      }),
    async create(actor, value, key) {
      const validName = name(value);
      return command(actor, 'create', key, { name: validName }, async (tx) => {
        const method = await core.methodCatalog.create(tx, actor.tenantShopId, randomUUID(), validName);
        return method
          ? { kind: 'created', method }
          : {
              kind: 'conflict',
              message: 'The library holds up to 100 methods. Remove an unused template before adding another.',
            };
      });
    },
    async rename(actor, id, version, value, key) {
      identity(id, version);
      const validName = name(value);
      const productTags = await prepareProductTags(actor, id, version);
      return command(actor, 'rename', key, { id, version, name: validName }, async (tx) => {
        const method = await core.methodCatalog.rename(tx, actor.tenantShopId, id, version, validName);
        if (method) {
          const current = (await core.methodCatalog.listConfigurations(tx, actor.tenantShopId)).find(
            (entry) => entry.configuration.id === id,
          );
          if (!current) throw new Error('Saved Method configuration unavailable');
          await reconcileSelectedMethodDrafts({
            core,
            transaction: tx,
            shopId: actor.tenantShopId,
            methodId: id,
            current,
            productTags,
          });
        }
        return method ? { kind: 'saved', method } : conflict();
      });
    },
    async delete(actor, id, version, key, expectedAuthority) {
      identity(id, version);
      return command(
        actor,
        'delete',
        key,
        { id, version },
        async (tx) => {
          if (!(await core.methodCatalog.delete(tx, actor.tenantShopId, id, version))) return conflict();
          await reconcileSelectedMethodDrafts({
            core,
            transaction: tx,
            shopId: actor.tenantShopId,
            methodId: id,
            current: null,
            productTags: {},
          });
          return { kind: 'deleted' };
        },
        expectedAuthority,
      );
    },
  };
}
