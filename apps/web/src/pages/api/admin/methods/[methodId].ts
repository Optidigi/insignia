import type { APIRoute } from 'astro';
import { handleAdminRequest } from '../../../../server/admin/http.js';
import { adminServices } from '../../../../server/admin/runtime.js';

const route: APIRoute = ({ request, params }) =>
  handleAdminRequest(request, adminServices(), { kind: 'method', methodId: params.methodId ?? '' });
export const PUT = route;
export const DELETE = route;
