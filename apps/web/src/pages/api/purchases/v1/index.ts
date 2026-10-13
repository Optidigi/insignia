import type { APIRoute } from 'astro';
import { handlePurchaseRequest } from '../../../../server/purchase/http.ts';
import { purchaseServices } from '../../../../server/purchase/runtime.ts';
export const GET: APIRoute = async ({ request }) => handlePurchaseRequest(request, await purchaseServices());
