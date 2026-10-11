import type { AdminActor } from './contracts.js';
export interface SigningOwnerConfiguration {
  directory: string;
  plan: { keyId: number; firstDay: number; lastDay: number };
  binding: {
    shop: string;
    shopId: string;
    installationId: string;
    tenantShopId: string;
    installationGeneration: string;
    authorizationGeneration: string;
    authorizationEpoch: number;
  };
  ring: { currentKeyId: string; keys: Readonly<Record<string, Buffer>> };
}
export interface SigningOwnerStatus {
  version: 'm5-signing-owner-action-v1';
  state: 'READY' | 'WAITING_FOR_VERIFICATION' | 'PENDING' | 'PROVISIONED' | 'STOPPED' | 'UNCERTAIN';
  actionAvailable: boolean;
  retryAuthorized: false;
  quoteIssuanceAuthorized: false;
}
export interface SigningOwnerAction {
  start(actor: AdminActor, idToken: string): Promise<SigningOwnerStatus>;
  status(actor: AdminActor): Promise<SigningOwnerStatus>;
}
export function createSigningOwnerAction(config: SigningOwnerConfiguration, ports: object): SigningOwnerAction;
