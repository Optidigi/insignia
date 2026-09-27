import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  const isSynthetic = process.env.INSIGNIA_M0_009_MODE === 'synthetic';
  headers.set('Content-Security-Policy', isSynthetic
    ? "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
    : "frame-ancestors https://admin.shopify.com https://insignia-staging.myshopify.com; base-uri 'none'; object-src 'none'; form-action 'self'");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Vary', 'Authorization, Origin');
  // No Access-Control-Allow-Origin is emitted for private or mutation routes.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
