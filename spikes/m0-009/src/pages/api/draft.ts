import type { APIRoute } from 'astro';
import { handleDraftPost } from '../../server/draft-api.ts';
import { getRuntime } from '../../server/runtime.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    const runtime = getRuntime();
    return await handleDraftPost(request, runtime.auth, runtime.drafts);
  } catch {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
    });
  }
};
