import { createProductionBuyerServices, type ProductionBuyerInputs } from './production.ts';
import type { BuyerServices } from './service.ts';

let configured: BuyerServices | undefined;
/** Explicit trusted production composition. Missing keys/providers never imply a synthetic success. */
export function configureBuyerServices(value: BuyerServices) {
  if (configured) throw new Error('Buyer services already configured');
  configured = value;
}
export function buyerServices(): BuyerServices | undefined {
  return configured;
}
/** Owner-configured application startup calls this with its existing qualified resource authorities. */
export function configureProductionBuyerServices(input: ProductionBuyerInputs): void {
  configureBuyerServices(createProductionBuyerServices(input));
}
