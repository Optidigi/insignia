import type { APIRoute } from 'astro';
import { adminJson, productGid } from '../../../../../../server/admin/http.js';
import { handleMerchantMediaRequest } from '../../../../../../server/admin/merchant-media-http.js';
import { adminServices } from '../../../../../../server/admin/runtime.js';

const route: APIRoute = ({ request, params }) => {
  const productId = productGid(params.productId ?? '');
  return productId
    ? handleMerchantMediaRequest(request, adminServices(), productId)
    : adminJson(404, { error: 'Product not found' });
};
export const GET = route;
export const POST = route;
