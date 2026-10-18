import { createHash } from 'node:crypto';
import type { APIRoute } from 'astro';
import { productionShopifyWebhook } from '../../../../server/shopify-webhook-route.js';

export const prerender = false;
export const POST: APIRoute = ({ request, params }) => {
  const capability = params.capability ?? '';
  if (!/^[a-f0-9]{64}$/.test(capability)) return new Response(null, { status: 401 });
  return productionShopifyWebhook(request, createHash('sha256').update(capability).digest('hex'));
};
