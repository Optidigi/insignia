import type { CurrentCycleUsageHistoryInput, PurchaseUsageScope } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import {
  createActiveSubscriptionClient,
  createSubscriptionHistoryClient,
  type PartnerGraphqlTransport,
} from '@insignia/shopify';

type Window = NonNullable<Awaited<ReturnType<DurableCore['tenants']['getUsageInstallationWindow']>>>;
const unavailable = (): never => {
  throw new Error('USAGE_SOURCE_UNAVAILABLE');
};
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\s\p{Cc}]/u.test(v);
const instant = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function matches(row: Window | null, scope: PurchaseUsageScope): row is Window {
  return (
    !!row &&
    row.shopId === scope.shopId &&
    row.generation === scope.installationGeneration &&
    row.currentGeneration === scope.installationGeneration &&
    row.deactivatedAt === null &&
    instant(row.activatedAt) &&
    /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(row.providerShopId)
  );
}
/** Backend-only source composition. It performs reads, never billing dispatch or policy discovery. */
export function createWorkerUsageSource(input: {
  appId: string;
  binding: CurrentCycleUsageHistoryInput['binding'];
  tenants: Pick<DurableCore['tenants'], 'getUsageInstallationWindow'>;
  transport: PartnerGraphqlTransport;
  now?: () => Date;
}) {
  const appId = input.appId;
  const readInstallation = input.tenants.getUsageInstallationWindow.bind(input.tenants);
  const transport = { query: input.transport.query.bind(input.transport) };
  const now = input.now;
  const binding = input.binding ? { ...input.binding, policy: { ...input.binding.policy } } : null;
  const currentReader = createActiveSubscriptionClient({ transport, now });
  const historyReader = createSubscriptionHistoryClient({ transport, now });
  return {
    async load(caller: PurchaseUsageScope): Promise<CurrentCycleUsageHistoryInput> {
      try {
        const scope = { shopId: caller?.shopId, installationGeneration: caller?.installationGeneration };
        if (
          !text(scope.shopId) ||
          typeof scope.installationGeneration !== 'string' ||
          !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
          BigInt(scope.installationGeneration) > 9223372036854775807n ||
          !/^gid:\/\/shopify\/App\/[1-9][0-9]*$/.test(appId) ||
          !binding ||
          binding.appId !== appId ||
          !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(binding.shopId) ||
          !text(binding.planHandle) ||
          !text(binding.usageHandle) ||
          binding.planHandle === binding.usageHandle ||
          !text(binding.policy.id) ||
          !text(binding.policy.version)
        )
          return unavailable();
        const row = await readInstallation({ ...scope });
        if (!matches(row, scope) || row.providerShopId !== binding.shopId) return unavailable();
        // Copy the baseline before provider awaits; external collaborators cannot restamp it.
        const baseline = { ...row };
        const current = await currentReader.read({ appId, shopId: baseline.providerShopId });
        if (
          !current.currentBillingCycle ||
          !instant(current.observedAt) ||
          current.observedAt < baseline.activatedAt ||
          current.observedAt < current.currentBillingCycle.startTime ||
          current.observedAt >= current.currentBillingCycle.endTime
        )
          return unavailable();
        const range = await historyReader.readRange({
          appId,
          shopId: baseline.providerShopId,
          from: current.currentBillingCycle.startTime,
          through: current.observedAt,
        });
        const after = await readInstallation({ ...scope });
        if (
          !matches(after, scope) ||
          Object.keys(baseline).some((key) => baseline[key as keyof Window] !== after[key as keyof Window])
        )
          return unavailable();
        return {
          installation: {
            tenantShopId: baseline.shopId,
            providerShopId: baseline.providerShopId,
            appId,
            generation: baseline.generation,
            activatedAt: baseline.activatedAt,
            deactivatedAt: baseline.deactivatedAt,
          },
          binding: { ...binding, policy: { ...binding.policy } },
          current: { ...current, tenantShopId: scope.shopId, installationGeneration: scope.installationGeneration },
          range,
        };
      } catch {
        return unavailable();
      }
    },
  };
}
