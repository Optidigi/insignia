import { createHash, createHmac } from 'node:crypto';
import type { DurableCore } from '@insignia/database';
import { createUninstallSubscriptionClient, type UninstallSubscriptionGrant } from '@insignia/shopify';

type Scope = {
  shopId: string;
  installationGeneration: string;
  externalInstallationId: string;
  providerShopId: string;
};

/** Automatic prospective enrollment. No failed API call establishes uninstall.
 * Capabilities must be excluded from proxy/request logs and never sent to UI. */
export function createAutomaticUninstallEnrollment(input: {
  core: Pick<DurableCore, 'uninstallLifecycle'>;
  appOrigin: string;
  appClientId: string;
  appSecret: string;
  client?: ReturnType<typeof createUninstallSubscriptionClient>;
}) {
  const origin = new URL(input.appOrigin).origin;
  const client = input.client ?? createUninstallSubscriptionClient({ expectedOrigin: origin });
  const pending = new Map<string, Promise<void>>();
  const enroll = async (grant: UninstallSubscriptionGrant, scope: Scope, repairs = 0): Promise<void> => {
    const repairVersion = await input.core.uninstallLifecycle.repairVersion(scope);
    const capability = createHmac('sha256', input.appSecret)
      .update(
        JSON.stringify([
          'insignia-uninstall-destination-v1',
          origin,
          input.appClientId,
          scope.shopId,
          scope.installationGeneration,
          scope.externalInstallationId,
          repairVersion,
        ]),
      )
      .digest('hex');
    const uri = `${origin}/api/webhooks/uninstall/${capability}`;
    const binding = {
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      externalInstallationId: scope.externalInstallationId,
      capabilityDigest: createHash('sha256').update(capability).digest('hex'),
    };
    const expected = {
      shopId: scope.providerShopId,
      installationId: scope.externalInstallationId,
      appClientId: input.appClientId,
    };
    const destination = await input.core.uninstallLifecycle.reserve(binding);
    if (destination.state === 'registered') {
      const current = await client.read(grant, expected, destination.subscriptionId!);
      if (current?.uri !== uri) {
        // read() proves the same positive current installation before/after.
        // Definite missing/drifted subscription gets a new immutable capability;
        // ambiguous reads throw before retirement and are never recreated.
        await input.core.uninstallLifecycle.retire(binding);
        if (repairs >= 1) throw new Error('Automatic lifecycle repair unavailable');
        return enroll(grant, scope, repairs + 1);
      }
      return;
    }
    if (destination.state === 'dispatched') {
      const found = await client.reconcile(grant, expected, uri);
      if (!found) throw new Error('Automatic lifecycle enrollment unresolved');
      await input.core.uninstallLifecycle.settle(binding, found.id);
      return;
    }
    if (destination.state !== 'prepared' || !(await input.core.uninstallLifecycle.dispatch(binding)))
      throw new Error('Automatic lifecycle enrollment unavailable');
    const result = await client.create(grant, expected, uri);
    if (result.kind === 'acknowledged') {
      const confirmed = await client.read(grant, expected, result.subscription.id);
      if (confirmed?.uri !== uri) throw new Error('Automatic lifecycle enrollment unresolved');
      await input.core.uninstallLifecycle.settle(binding, confirmed.id);
      return;
    }
    if (result.kind === 'rejected') await input.core.uninstallLifecycle.settle(binding, null);
    throw new Error('Automatic lifecycle enrollment unavailable');
  };
  return async (grant: UninstallSubscriptionGrant, scope: Scope): Promise<void> => {
    // Verified sessions for the same installation share in-flight enrollment.
    // Readiness still requires confirmed settlement; other processes retain the
    // durable dispatch fence and must reconcile rather than recreate a write.
    const key = JSON.stringify([
      grant.shop,
      scope.shopId,
      scope.installationGeneration,
      scope.externalInstallationId,
      scope.providerShopId,
    ]);
    const existing = pending.get(key);
    if (existing) return existing;
    const operation = enroll(grant, scope);
    pending.set(key, operation);
    try {
      await operation;
    } finally {
      pending.delete(key);
    }
  };
}

/** One tenant per pass; advance before IO so an unavailable shop cannot starve others. */
export function createUninstallEnrollmentReconciliation(input: {
  core: Pick<DurableCore, 'uninstallLifecycle'>;
  credentials: {
    acquire(scope: {
      shopId: string;
      installationGeneration: string;
    }): Promise<
      | { kind: 'usable'; shopDomain: string; accessToken: string; accessExpiresAt: Date }
      | { kind: 'inactive' | 'missing' | 'reauth_required' | 'temporarily_unavailable' }
    >;
  };
  enroll: ReturnType<typeof createAutomaticUninstallEnrollment>;
}) {
  let after: string | null = null;
  return {
    async runOnce() {
      let scopes = await input.core.uninstallLifecycle.listActive(after, 1);
      if (!scopes.length) {
        after = null;
        scopes = await input.core.uninstallLifecycle.listActive(null, 1);
      }
      const scope = scopes[0];
      if (!scope) return;
      after = scope.shopId;
      const acquired = await input.credentials.acquire(scope);
      if (
        acquired.kind !== 'usable' ||
        acquired.accessExpiresAt.getTime() <= Date.now() ||
        acquired.shopDomain !== scope.shopDomain
      )
        throw new Error('Automatic lifecycle credential unavailable');
      await input.enroll({ shop: acquired.shopDomain, accessToken: acquired.accessToken }, scope);
    },
  };
}
