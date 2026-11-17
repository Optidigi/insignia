import type { APIRoute } from 'astro';
import { handleInternalMetrics } from '../../../server/internal-metrics.js';
import { logSystemFailure, webObservability } from '../../../server/observability.js';
import { webRuntime } from '../../../server/runtime.js';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  handleInternalMetrics(request, {
    token: process.env.INSIGNIA_METRICS_TOKEN,
    unresolvedBacklog: async () => (await webRuntime()).core.webhooks.unresolvedBacklogCount(),
    observability: webObservability,
    recordSystemFailure: logSystemFailure,
  });
