import type { APIRoute } from 'astro';
import { handleArtworkRequest } from '../../../../../server/artwork/http.js';
import { artworkServices } from '../../../../../server/artwork/runtime.js';
export const POST: APIRoute = async ({ request, params }) =>
  handleArtworkRequest(request, await artworkServices(), {
    kind: 'preview',
    assetId: params.assetId ?? '',
    audience: 'guest',
  });
