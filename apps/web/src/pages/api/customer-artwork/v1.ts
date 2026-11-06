import type { APIRoute } from 'astro';
import { handleCustomerArtworkRequest } from '../../../server/customer-artwork/http.ts';
import { customerArtworkServices } from '../../../server/customer-artwork/runtime.ts';
export const POST: APIRoute = async ({ request }) =>
  handleCustomerArtworkRequest(request, await customerArtworkServices());
