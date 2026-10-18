import { randomUUID } from 'node:crypto';
import { executeCommand } from '@insignia/application';
import { type DurableCore, type DurableTransaction, sha256CanonicalJson } from '@insignia/database';
import type { AdminActor, MethodLibrary, MethodOutcome } from './contracts.js';

export class MethodAuthorizationError extends Error {}

/** Names are copied into drafts by the editor; this library never updates products. */
export function createMethodLibrary(core: DurableCore): MethodLibrary {
  async function authorized(actor: AdminActor, tx: DurableTransaction) {
    const scope = await core.tenants.lockActiveAuthorizationScope(tx, {
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || `gid://shopify/Shop/${scope.shopifyShopId}` !== actor.shopId)
      throw new MethodAuthorizationError('Current tenant installation required');
    return scope;
  }
  async function command(
    actor: AdminActor,
    action: string,
    key: string,
    request: unknown,
    work: (tx: DurableTransaction) => Promise<MethodOutcome>,
  ): Promise<MethodOutcome> {
    if (!actor.canEdit || !actor.canRead) throw new Error('Edit permission required');
    return core.transactions.run(async (tx) => {
      // Lock before dedup's shop FK key-share, avoiding concurrent lock upgrades.
      const scope = await authorized(actor, tx);
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
  const conflict = (): MethodOutcome => ({
    kind: 'conflict',
    message: 'This method changed or was removed. Reload the method library before trying again.',
  });
  return {
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
      return command(actor, 'rename', key, { id, version, name: validName }, async (tx) => {
        const method = await core.methodCatalog.rename(tx, actor.tenantShopId, id, version, validName);
        return method ? { kind: 'saved', method } : conflict();
      });
    },
    async delete(actor, id, version, key) {
      identity(id, version);
      return command(actor, 'delete', key, { id, version }, async (tx) =>
        (await core.methodCatalog.delete(tx, actor.tenantShopId, id, version)) ? { kind: 'deleted' } : conflict(),
      );
    },
  };
}
