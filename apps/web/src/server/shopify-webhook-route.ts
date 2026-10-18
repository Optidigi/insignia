import { webObservability } from './observability.js';
import { webRuntime } from './runtime.js';
import { handleShopifyWebhook } from './shopify-webhook.js';

const observability = webObservability;

export async function productionShopifyWebhook(
  request: Request,
  uninstallCapabilityDigest?: string,
): Promise<Response> {
  try {
    const currentSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!currentSecret) throw new Error('Webhook verification secret is unavailable');
    const secrets = [currentSecret];
    if (process.env.SHOPIFY_WEBHOOK_PREVIOUS_SECRET) secrets.push(process.env.SHOPIFY_WEBHOOK_PREVIOUS_SECRET);
    return handleShopifyWebhook(request, {
      secrets,
      ...(uninstallCapabilityDigest ? { fixedTopic: 'app/uninstalled' } : {}),
      metrics: observability.metrics,
      async onAccepted(result) {
        const { core } = await webRuntime();
        const state = await core.webhooks.getById(result.inboxId);
        observability.metrics.resolution(
          state?.resolution === 'resolved'
            ? 'resolved'
            : state?.resolution === 'unresolved' || state?.resolution === 'unqualified'
              ? 'unresolved'
              : 'failed',
        );
        observability.metrics.unresolvedBacklog(await core.webhooks.unresolvedBacklogCount());
      },
      async getHandoff() {
        const { core, queue } = await webRuntime();
        return {
          ingress: {
            receive: (delivery) =>
              core.webhooks.receive({
                ...delivery,
                ...(uninstallCapabilityDigest ? { uninstallCapabilityDigest } : {}),
              }),
          },
          queue: {
            async ensureEnqueued(input) {
              const outcome = await queue.ensureWebhookEnqueued(input.inboxId);
              if (outcome.status !== 'enqueued' && outcome.status !== 'already_enqueued') {
                throw new Error('Queue disposition unavailable');
              }
              return outcome.status;
            },
          },
        };
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'handoff_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
