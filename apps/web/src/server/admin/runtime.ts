import { resolveRuntimeReleaseProfile } from '@insignia/shopify';
import type { AdminServices } from './contracts.js';
import { createProductionAdminServices } from './production.js';
import { createReleaseVerificationClient } from './release-verification.js';
import { signingOwnerConfiguration } from './signing-owner-configuration.js';

let services: AdminServices | undefined;

/** Composition root calls once at server startup; absent composition fails closed. */
export function configureAdminServices(value: AdminServices): void {
  if (services) throw new Error('Admin services already configured');
  services = value;
}

export function adminServices(): AdminServices | undefined {
  if (services) return services;
  try {
    services = createProductionAdminServices(
      process.env,
      undefined,
      undefined,
      undefined,
      signingOwnerConfiguration(process.env),
      createReleaseVerificationClient(
        undefined,
        resolveRuntimeReleaseProfile(process.env.INSIGNIA_RELEASE_PROFILE).activeVersionRef,
      ),
    );
  } catch {
    return undefined;
  }
  return services;
}
