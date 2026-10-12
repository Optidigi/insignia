import type { APIRoute } from 'astro';
import { handleBuyerRequest } from '../../../../server/buyer/http.ts';
import { buyerServices } from '../../../../server/buyer/runtime.ts';

/** Versioned buyer flow behind the existing configured artwork App Proxy upstream. */
export const ALL: APIRoute = async ({ request, params }) =>
  handleBuyerRequest(request, await buyerServices(), params.route ?? '');
