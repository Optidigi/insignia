import type { APIRoute } from 'astro';
import { handleAdminRequest } from '../../../server/admin/http.js';
import { adminServices } from '../../../server/admin/runtime.js';

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, adminServices(), { kind: 'list' });
