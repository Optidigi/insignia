import { createBuyerBootstrap } from './bootstrap.ts';
import { createProductionBuyerServices, type ProductionBuyerInputs } from './production.ts';
import type { BuyerServices } from './service.ts';

let configured: BuyerServices | undefined;
/** Explicit trusted production composition. Missing keys/providers never imply a synthetic success. */
export function configureBuyerServices(value: BuyerServices) {
  if (configured) throw new Error('Buyer services already configured');
  configured = value;
}
let pending: Promise<BuyerServices | undefined> | undefined;
export async function buyerServices(): Promise<BuyerServices | undefined> {
  if (configured) return configured;
  pending ??= createBuyerBootstrap()
    .then((value) => {
      configured ??= value;
      return configured;
    })
    .catch(() => undefined);
  return pending;
}
/** Owner-configured application startup calls this with its existing qualified resource authorities. */
export function configureProductionBuyerServices(input: ProductionBuyerInputs): void {
  configureBuyerServices(createProductionBuyerServices(input));
}
