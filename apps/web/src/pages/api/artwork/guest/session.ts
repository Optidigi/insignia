import type { APIRoute } from 'astro';
import { adminJson } from '../../../../server/admin/http.js';
import { artworkServices } from '../../../../server/artwork/runtime.js';
export const GET: APIRoute = async ({ request }) => {
  try {
    const services = await artworkServices();
    if (!services?.issueGuest) return adminJson(503, { error: 'Artwork session unavailable' });
    const result = await services.issueGuest(request);
    return result ? adminJson(200, result) : adminJson(401, { error: 'Artwork session denied' });
  } catch {
    return adminJson(503, { error: 'Artwork session unavailable' });
  }
};
