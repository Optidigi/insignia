import { createHash, timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { webObservability } from '../../../server/observability.js';
import { webRuntime } from '../../../server/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const expected = process.env.INSIGNIA_METRICS_TOKEN;
  if (!expected) return new Response(null, { status: 404 });
  const supplied = request.headers.get('authorization');
  if (!supplied?.startsWith('Bearer ') || supplied.length > 512) return new Response(null, { status: 403 });
  const providedHash = createHash('sha256').update(supplied.slice(7)).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(providedHash, expectedHash)) return new Response(null, { status: 403 });
  try {
    const { core } = await webRuntime();
    webObservability.metrics.unresolvedBacklog(await core.webhooks.unresolvedBacklogCount());
    return new Response(await webObservability.registry.metrics(), {
      status: 200,
      headers: { 'content-type': webObservability.registry.contentType, 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
};
