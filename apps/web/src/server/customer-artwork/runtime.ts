import { createCustomerArtworkLinks } from '@insignia/application';
import { adminServices } from '../admin/runtime.ts';
import { artworkServices } from '../artwork/runtime.ts';
import { webRuntime } from '../runtime.ts';
import type { CustomerArtworkHttpServices } from './http.ts';
import { createCustomerArtworkRuntimeView } from './view.ts';

let configured: CustomerArtworkHttpServices | undefined;
let pending: Promise<CustomerArtworkHttpServices | undefined> | undefined;
export function configureCustomerArtworkServices(services: CustomerArtworkHttpServices) {
  if (configured) throw new Error('Customer artwork services already configured');
  configured = services;
}
export async function customerArtworkServices(): Promise<CustomerArtworkHttpServices | undefined> {
  if (configured) return configured;
  if (!pending)
    pending = (async () => {
      const appOrigin = process.env.APP_URL;
      const secret = process.env.SHOPIFY_CLIENT_SECRET;
      if (!appOrigin || !secret) return undefined;
      const { core } = await webRuntime();
      const upload = await artworkServices();
      const links = createCustomerArtworkLinks({ store: core.customerArtwork, secret, appOrigin });
      const view =
        (await createCustomerArtworkRuntimeView({ core, links, env: process.env })) ??
        (async () => {
          throw new Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
        });
      return {
        appOrigin,
        links,
        view,
        artwork: upload?.artwork,
        authenticate: async (request: Request, options?: { fresh?: boolean }) =>
          (await adminServices()?.authenticate(request, options)) ?? null,
        async assertMerchantAccess(actor) {
          const assertAccess = adminServices()?.assertPurchaseAccess;
          if (!assertAccess) throw new Error('Current merchant authority unavailable');
          await assertAccess(actor);
        },
        async ensureInspectionReady() {
          if (!upload?.ensureInspectionReady) throw new Error('Artwork inspection unavailable');
          await upload.ensureInspectionReady();
        },
      } satisfies CustomerArtworkHttpServices;
    })()
      .then((services) => {
        configured = services;
        return services;
      })
      .catch(() => {
        pending = undefined;
        return undefined;
      });
  return pending;
}
