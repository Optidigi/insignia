import type { APIRoute } from 'astro';
import { handleArtworkRequest } from '../../../server/artwork/http.js';
import { artworkServices } from '../../../server/artwork/runtime.js';
export const POST: APIRoute = async ({ request }) =>
  handleArtworkRequest(request, await artworkServices(), { kind: 'begin', audience: 'merchant' });
