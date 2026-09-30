import type { APIRoute } from 'astro';
import { adminJson, handleAdminRequest, productGid } from '../../../../../server/admin/http.js';
import { adminServices } from '../../../../../server/admin/runtime.js';

const route: APIRoute = ({ request, params }) => {
  const productId = productGid(params.productId ?? '');
  return productId
    ? handleAdminRequest(request, adminServices(), { kind: 'config', productId })
    : adminJson(404, { error: 'Product not found' });
};

export const GET = route;
export const POST = route;
export const PUT = route;
