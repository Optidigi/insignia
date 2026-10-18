import type { APIRoute } from 'astro';
import { productionShopifyWebhook } from '../../../server/shopify-webhook-route.js';

export const prerender = false;
export const POST: APIRoute = ({ request }) => productionShopifyWebhook(request);
