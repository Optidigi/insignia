import { createHash, createHmac } from 'node:crypto';
import type { PurchaseMerchant } from './artwork.js';

export type CustomerArtworkSlot = {
  groupIndex: number;
  placementId: string;
  productId: string;
  revisionId: string;
  methodId: string;
  stepId: string;
};
export type CustomerArtworkGrant = {
  shopId: string;
  installationGeneration: string;
  purchaseId: string;
  capabilityHash: string;
  requestId: string;
  purpose: 'merchant' | 'paid-email';
  expiresAt: string;
  artworkVersion: number;
  slots: CustomerArtworkSlot[];
};
export type CustomerArtworkView = Pick<CustomerArtworkGrant, 'purchaseId' | 'expiresAt' | 'artworkVersion' | 'slots'>;
export type CustomerArtworkAttach = {
  requestId: string;
  groupIndex: number;
  placementId: string;
  expectedVersion: number;
  assetId: string;
};
export interface CustomerArtworkStore {
  epoch(): Promise<string>;
  issue(
    scope: PurchaseMerchant,
    input: {
      purchaseId: string;
      requestId: string;
      purpose: CustomerArtworkGrant['purpose'];
      capabilityHash: string;
    },
  ): Promise<CustomerArtworkGrant | null>;
  resolve(capabilityHash: string): Promise<CustomerArtworkGrant | null>;
  attach(capabilityHash: string, input: CustomerArtworkAttach): Promise<CustomerArtworkGrant>;
  revoke(scope: PurchaseMerchant, purchaseId: string): Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function unavailable(): never {
  throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
}
export const customerArtworkCapabilityHash = (capability: string) =>
  createHash('sha256').update(capability).digest('hex');
function authority(scope: PurchaseMerchant) {
  if (scope.kind !== 'merchant' || !scope.shopId || !/^[1-9][0-9]*$/.test(scope.installationGeneration)) unavailable();
}
/** An opaque, purpose-separated link is distinct from guest sessions and quote authorization. */
export function createCustomerArtworkLinks(input: {
  store: CustomerArtworkStore;
  secret: string;
  appOrigin: string;
  clock?: () => Date;
}) {
  if (input.secret.length < 32) throw new Error('CUSTOMER_ARTWORK_CONFIGURATION');
  const origin = new URL(input.appOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw new Error('CUSTOMER_ARTWORK_CONFIGURATION');
  const clock = input.clock ?? (() => new Date());
  function live(grant: CustomerArtworkGrant | null) {
    if (!grant || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= +clock())
      unavailable();
    return grant;
  }
  function view(grant: CustomerArtworkGrant): CustomerArtworkView {
    return {
      purchaseId: grant.purchaseId,
      expiresAt: grant.expiresAt,
      artworkVersion: grant.artworkVersion,
      slots: grant.slots,
    };
  }
  function token(
    scope: PurchaseMerchant,
    purchaseId: string,
    requestId: string,
    purpose: CustomerArtworkGrant['purpose'],
    epoch: string,
  ) {
    return createHmac('sha256', input.secret)
      .update(
        JSON.stringify([
          'insignia:customer-artwork-link:v1',
          epoch,
          purpose,
          scope.shopId,
          scope.installationGeneration,
          purchaseId,
          requestId,
        ]),
      )
      .digest('hex');
  }
  function hash(capability: string) {
    if (!/^[a-f0-9]{64}$/.test(capability)) unavailable();
    return customerArtworkCapabilityHash(capability);
  }
  return {
    async issue(
      scope: PurchaseMerchant,
      command: { purchaseId: string; requestId: string },
      purpose: CustomerArtworkGrant['purpose'] = 'merchant',
    ) {
      authority(scope);
      if (!uuid.test(command.purchaseId) || !uuid.test(command.requestId)) unavailable();
      const epoch = await input.store.epoch();
      if (!uuid.test(epoch)) throw new Error('CUSTOMER_ARTWORK_CONFIGURATION');
      const capability = token(scope, command.purchaseId, command.requestId, purpose, epoch);
      const grant = live(await input.store.issue(scope, { ...command, purpose, capabilityHash: hash(capability) }));
      if (
        grant.capabilityHash !== hash(capability) ||
        grant.shopId !== scope.shopId ||
        grant.installationGeneration !== scope.installationGeneration ||
        grant.purchaseId !== command.purchaseId
      )
        unavailable();
      return { ...view(grant), url: `${origin.origin}/artwork-upload#capability=${capability}` };
    },
    async resolve(capability: string) {
      return view(live(await input.store.resolve(hash(capability))));
    },
    async scope(capability: string) {
      const grant = live(await input.store.resolve(hash(capability)));
      return {
        shopId: grant.shopId,
        installationGeneration: grant.installationGeneration,
        kind: 'guest' as const,
        authorityExpiresAt: new Date(grant.expiresAt),
        ownerHash: grant.capabilityHash,
      };
    },
    async attach(capability: string, command: CustomerArtworkAttach) {
      if (
        !uuid.test(command.requestId) ||
        !uuid.test(command.assetId) ||
        !Number.isInteger(command.groupIndex) ||
        command.groupIndex < 0 ||
        command.groupIndex > 31 ||
        !command.placementId ||
        command.placementId.length > 128 ||
        !Number.isSafeInteger(command.expectedVersion) ||
        command.expectedVersion < 0
      )
        unavailable();
      return view(live(await input.store.attach(hash(capability), command)));
    },
    async revoke(scope: PurchaseMerchant, purchaseId: string) {
      authority(scope);
      if (!uuid.test(purchaseId)) unavailable();
      await input.store.revoke(scope, purchaseId);
    },
  };
}
