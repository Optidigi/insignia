import type { APIRoute } from 'astro';
import { adminJson, productGid } from '../../../../../../../server/admin/http.js';
import { handleMerchantMediaPreviewRequest } from '../../../../../../../server/admin/merchant-media-http.js';
import { adminServices } from '../../../../../../../server/admin/runtime.js';
export const GET: APIRoute = ({ request, params }) => {
  const productId = productGid(params.productId ?? '');
  return productId
    ? handleMerchantMediaPreviewRequest(request, adminServices(), productId, params.imageId ?? '')
    : adminJson(404, { error: 'Product not found' });
};
