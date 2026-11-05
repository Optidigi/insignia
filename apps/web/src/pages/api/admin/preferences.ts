import type { APIRoute } from 'astro';
import { handlePreferencesRequest } from '../../../server/admin/preferences-http.js';
import { adminServices } from '../../../server/admin/runtime.js';

const route: APIRoute = ({ request }) => handlePreferencesRequest(request, adminServices());
export const GET = route;
export const POST = route;
