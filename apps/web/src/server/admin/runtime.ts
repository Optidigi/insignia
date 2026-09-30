import type { AdminServices } from './contracts.js';
import { createProductionAdminServices } from './production.js';

let services: AdminServices | undefined;

/** Composition root calls once at server startup; absent composition fails closed. */
export function configureAdminServices(value: AdminServices): void {
  if (services) throw new Error('Admin services already configured');
  services = value;
}

export function adminServices(): AdminServices | undefined {
  if (services) return services;
  try {
    services = createProductionAdminServices();
  } catch {
    return undefined;
  }
  return services;
}
