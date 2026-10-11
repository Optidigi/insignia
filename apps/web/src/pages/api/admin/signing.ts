import type { APIRoute } from 'astro';
import { handleAdminRequest } from '../../../server/admin/http.js';
import { adminServices } from '../../../server/admin/runtime.js';

const route: APIRoute = ({ request }) => handleAdminRequest(request, adminServices(), { kind: 'signing' });
export const GET = route;
export const POST = route;
