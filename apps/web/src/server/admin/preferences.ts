import { executeCommand } from '@insignia/application';
import {
  type MerchantPreferencesCommand,
  MerchantPreferencesCommandSchema,
  type MerchantPreferencesView,
} from '@insignia/contracts';
import { type DurableCore, type DurableTransaction, sha256CanonicalJson } from '@insignia/database';
import { validateCustomerWordingOverlay } from '@insignia/ui-localization/customer';
import { canReadPurchaseRecords } from '../purchase/access.ts';
import type { AdminActor } from './contracts.js';

export class PreferencesAuthorizationError extends Error {}
export class PreferencesValidationError extends Error {}
export type PreferencesOutcome =
  | { kind: 'saved'; preferences: MerchantPreferencesView }
  | { kind: 'conflict'; message: string };
export interface MerchantPreferences {
  read(actor: AdminActor): Promise<MerchantPreferencesView>;
  save(actor: AdminActor, input: MerchantPreferencesCommand, key: string): Promise<PreferencesOutcome>;
}
const conflict = (): PreferencesOutcome => ({
  kind: 'conflict',
  message: 'Store preferences changed. Reload before saving again.',
});

export function createMerchantPreferences(core: DurableCore): MerchantPreferences {
  async function authorized(actor: AdminActor, tx: DurableTransaction) {
    if (!actor.canRead) throw new PreferencesAuthorizationError('Read permission required');
    const scope = await core.tenants.lockActiveAuthorizationScope(tx, {
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || `gid://shopify/Shop/${scope.shopifyShopId}` !== actor.shopId)
      throw new PreferencesAuthorizationError('Current tenant installation required');
    return scope;
  }
  return {
    read: (actor) =>
      core.transactions.run(async (tx) => {
        const scope = await authorized(actor, tx);
        return {
          ...(await core.preferences.read(tx, actor.tenantShopId, actor.shop, sha256CanonicalJson(scope))),
          canEdit: actor.canEdit,
          canReadPrivacy: canReadPurchaseRecords(actor),
        };
      }),
    async save(actor, input, key) {
      if (!actor.canEdit) throw new PreferencesAuthorizationError('Edit permission required');
      const parsed = MerchantPreferencesCommandSchema.safeParse(input);
      if (!parsed.success) throw new PreferencesValidationError('Invalid store preferences');
      const command = parsed.data;
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new PreferencesValidationError('Invalid command key');
      if (command.action === 'wording')
        for (const [locale, overlay] of Object.entries(command.overlays)) {
          const validation = validateCustomerWordingOverlay(overlay);
          if (validation.status !== 'valid' || validation.overlay.locale !== locale)
            throw new PreferencesValidationError('Invalid customer wording');
        }
      return core.transactions.run(async (tx) => {
        const scope = await authorized(actor, tx);
        const authority = sha256CanonicalJson(scope);
        if (command.authority !== authority)
          throw new PreferencesAuthorizationError('Current preferences authority required');
        const executed = await executeCommand(
          { run: <T>(work: (transaction: DurableTransaction) => Promise<T>) => work(tx) },
          core.commands,
          {
            shopId: actor.tenantShopId,
            namespace: `merchant-preferences-${command.action}:${scope.installationGeneration}:${scope.authorizationGeneration}`,
            key,
            requestDigest: sha256CanonicalJson({
              command,
              installationGeneration: scope.installationGeneration,
              authorizationGeneration: scope.authorizationGeneration,
              authorizationEpoch: scope.authorizationEpoch,
            }),
          },
          async () => {
            const saved = await core.preferences.save(tx, actor.tenantShopId, actor.shop, command);
            return JSON.stringify(
              saved
                ? {
                    kind: 'saved',
                    section: command.action,
                    version: command.action === 'guidance' ? saved.guidanceVersion : saved.wordingVersion,
                  }
                : conflict(),
            );
          },
        );
        const result = JSON.parse(executed.resultRef) as
          | { kind: 'saved'; section: 'guidance' | 'wording'; version: string }
          | { kind: 'conflict'; message: string };
        if (result.kind === 'conflict') return result;
        const current = await core.preferences.read(tx, actor.tenantShopId, actor.shop, authority);
        const version = result.section === 'guidance' ? current.guidanceVersion : current.wordingVersion;
        return version === result.version
          ? {
              kind: 'saved',
              preferences: { ...current, canEdit: actor.canEdit, canReadPrivacy: canReadPurchaseRecords(actor) },
            }
          : conflict();
      });
    },
  };
}
