import type { APIRoute } from 'astro';
import { handleDraftPost } from '../../server/draft-api.ts';
import { getRuntime } from '../../server/runtime.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const response = await handleDraftPost(request, runtime.auth, runtime.drafts);
    const traceId = request.headers.get('X-Insignia-Trace');
    if (runtime.mode === 'public-bootstrap' && process.env.INSIGNIA_PUBLIC_AUTH_TRACE === '1' &&
        response.status === 200 && traceId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(traceId)) {
      try { console.info(JSON.stringify({
        kind: 'insignia-public-local-save', at: new Date().toISOString(),
        traceId, status: response.status
      })); } catch { /* Observation cannot change the saved result. */ }
    }
    return response;
  } catch {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
    });
  }
};
