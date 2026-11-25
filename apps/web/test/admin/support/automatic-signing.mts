import type { AdminActor } from '../../../src/server/admin/contracts.ts';
import { createAutomaticSigningProvision, NON_EXPIRING_LAST_DAY } from '../../../src/server/admin/signing-automatic.ts';

export const SIGNING_DAY = 20_000;
export type SigningKeyRow = { id: number; state: string; firstDay: number; lastDay: number };
export const activeSigningKey: SigningKeyRow = {
  id: 1,
  state: 'active',
  firstDay: SIGNING_DAY - 1,
  lastDay: NON_EXPIRING_LAST_DAY,
};

/** Automatic signing over fixed key rows. Provisioning would start by verifying the session token: the
 * identity port records that and refuses, so a run that used the token ends STOPPED and is visible. */
export function automaticSigning(rows: SigningKeyRow[], tenantShopId: AdminActor['tenantShopId'] = 'tenant-1') {
  const identityCalls: string[] = [];
  const refuse = (name: string) => async () => {
    identityCalls.push(name);
    throw new Error('Synthetic provisioning stops here');
  };
  const signing = createAutomaticSigningProvision({
    now: () => new Date(),
    app: { localDay: () => ({ ordinal: SIGNING_DAY }) },
    core: {
      signingKeys: {
        getActiveScope: async () => ({ shopId: tenantShopId }),
        list: async () => rows,
      },
    },
    identity: {
      verify: refuse('verify'),
      exchangeOnline: refuse('exchangeOnline'),
      readInstallation: refuse('readInstallation'),
    },
  } as never);
  return { signing, identityCalls };
}
