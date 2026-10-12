import type { APIRoute } from 'astro';
import { handleArtworkRequest } from '../../../../server/artwork/http.js';
import { artworkServices } from '../../../../server/artwork/runtime.js';
export const GET: APIRoute = async ({ request, params }) =>
  handleArtworkRequest(request, await artworkServices(), {
    kind: 'status',
    assetId: params.assetId ?? '',
    audience: 'merchant',
  });
