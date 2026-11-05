import type { APIRoute } from 'astro';
import { handleMerchantArtworkLinkRequest } from '../../../../../server/customer-artwork/http.ts';
import { customerArtworkServices } from '../../../../../server/customer-artwork/runtime.ts';
export const POST: APIRoute = async ({ request, params }) =>
  handleMerchantArtworkLinkRequest(request, await customerArtworkServices(), params.purchaseId ?? '');
