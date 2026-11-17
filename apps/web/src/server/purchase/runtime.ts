import type { PurchaseHttpServices } from './http.ts';

let configured: PurchaseHttpServices | undefined;
let pending: Promise<PurchaseHttpServices | undefined> | undefined;
export function configurePurchaseServices(services: PurchaseHttpServices) {
  if (configured) throw new Error('Purchase services already configured');
  configured = services;
}
export async function purchaseServices(): Promise<PurchaseHttpServices | undefined> {
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
