import type { PurchaseServices } from './service.ts';

let configured: PurchaseServices | undefined;
let pending: Promise<PurchaseServices | undefined> | undefined;
export function configurePurchaseServices(services: PurchaseServices) {
  if (configured) throw new Error('Purchase services already configured');
  configured = services;
}
export async function purchaseServices(): Promise<PurchaseServices | undefined> {
  if (configured) return configured;
  if (!pending)
    pending = import('./production.ts')
      .then((module) => module.createProductionPurchaseServices())
      .then((value) => {
        configured = value;
        return value;
      })
      .catch(() => undefined);
  return pending;
}
