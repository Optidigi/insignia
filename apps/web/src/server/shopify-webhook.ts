import {
  receiveVerifiedShopifyWebhook,
  ShopifyQueueHandoffError,
  type ShopifyWebhookIngressPort,
  type ShopifyWebhookQueuePort,
} from '@insignia/application';
import { InvalidShopifyWebhookError, MAX_SHOPIFY_WEBHOOK_BODY_BYTES, verifyShopifyWebhook } from '@insignia/shopify';

export class WebhookBodyTooLargeError extends Error {
  constructor() {
    super('Shopify webhook body exceeds the configured limit');
    this.name = 'WebhookBodyTooLargeError';
  }
}

/** Enforce the limit as the body streams; Content-Length is only a fast rejection. */
export async function readBoundedWebhookBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_SHOPIFY_WEBHOOK_BODY_BYTES) throw new WebhookBodyTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_SHOPIFY_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export async function handleShopifyWebhook(
  request: Request,
  dependencies: {
    secrets: readonly string[];
    ingress?: ShopifyWebhookIngressPort;
    queue?: ShopifyWebhookQueuePort;
    getHandoff?: () => Promise<{ ingress: ShopifyWebhookIngressPort; queue: ShopifyWebhookQueuePort }>;
    metrics?: { webhook(outcome: 'received' | 'duplicate' | 'rejected' | 'enqueue_failure'): void };
    onAccepted?: (input: { inboxId: string; kind: 'received' | 'duplicate' | 'processed' }) => Promise<void>;
  },
): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  try {
    const raw = await readBoundedWebhookBody(request);
    const verified = verifyShopifyWebhook(raw, request.headers, dependencies.secrets);
    const handoff = dependencies.getHandoff ? await dependencies.getHandoff() : dependencies;
    if (!handoff.ingress || !handoff.queue) throw new Error('Webhook handoff unavailable');
    const receipt = await receiveVerifiedShopifyWebhook(handoff.ingress, handoff.queue, verified);
    dependencies.metrics?.webhook(receipt.kind === 'received' ? 'received' : 'duplicate');
    if (dependencies.onAccepted)
      await dependencies.onAccepted({ inboxId: receipt.inboxId, kind: receipt.kind }).catch(() => {});
    return new Response(JSON.stringify({ inboxId: receipt.inboxId, status: receipt.kind }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    dependencies.metrics?.webhook(error instanceof ShopifyQueueHandoffError ? 'enqueue_failure' : 'rejected');
    const status =
      error instanceof WebhookBodyTooLargeError ? 413 : error instanceof InvalidShopifyWebhookError ? 401 : 503;
    return new Response(JSON.stringify({ error: status === 503 ? 'handoff_unavailable' : 'invalid_webhook' }), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
