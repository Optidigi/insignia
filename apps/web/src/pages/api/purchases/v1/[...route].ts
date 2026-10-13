import type { APIRoute } from 'astro';
import { handlePurchaseRequest } from '../../../../server/purchase/http.ts';
import { purchaseServices } from '../../../../server/purchase/runtime.ts';

const handler: APIRoute = async ({ request, params }) =>
  handlePurchaseRequest(request, await purchaseServices(), params.route ?? '');
export const GET = handler;
export const POST = handler;
