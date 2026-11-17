import type { APIRoute } from 'astro';
import { handleGuestArtworkSession } from '../../../../server/artwork/guest-session.js';
import { artworkServices } from '../../../../server/artwork/runtime.js';
import { webObservability } from '../../../../server/observability.js';

export const GET: APIRoute = ({ request }) =>
  handleGuestArtworkSession(request, {
    services: artworkServices,
    recordBuyerFailure: (failure) => webObservability.logger.error('buyer_request_failed', failure),
  });
