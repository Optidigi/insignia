/** This shape is produced only after raw-body HMAC verification by the Shopify adapter. */
/** Only rawBody is authenticated by Shopify's HMAC; headers are routing hints. */
export type VerifiedShopifyDelivery = {
  shopDomain: string;
  topic: string;
  apiVersion: string;
  deliveryId: string;
  triggeredAt: Date;
  eventId: string | null;
  name: string | null;
  rawBody: Uint8Array;
};

export type ShopifyInboxReceipt = {
  kind: 'received' | 'duplicate' | 'processed';
  id: string;
  shopId: string | null;
  installationGeneration: string | null;
};

export interface ShopifyWebhookIngressPort {
  /** Commits one identity-preserving delivery before returning. Conflicting bytes must reject. */
  receive(delivery: VerifiedShopifyDelivery): Promise<ShopifyInboxReceipt>;
}

export interface ShopifyWebhookQueuePort {
  /** Resolve only after enqueue or matching existing job ID/data is confirmed durably. */
  ensureEnqueued(input: {
    inboxId: string;
    shopDomain: string;
    topic: string;
  }): Promise<'enqueued' | 'already_enqueued'>;
}

export class ShopifyQueueHandoffError extends Error {
  constructor() {
    super('Shopify webhook queue handoff was not confirmed');
    this.name = 'ShopifyQueueHandoffError';
  }
}

export type ShopifyWebhookIngressResult = {
  inboxId: string;
  kind: 'received' | 'duplicate' | 'processed';
  queue: 'enqueued' | 'already_enqueued' | 'not_needed';
};

/** A 2xx may be returned only after this function resolves successfully. */
export async function receiveVerifiedShopifyWebhook(
  ingress: ShopifyWebhookIngressPort,
  queue: ShopifyWebhookQueuePort,
  delivery: VerifiedShopifyDelivery,
): Promise<ShopifyWebhookIngressResult> {
  if (
    !delivery.shopDomain ||
    !delivery.topic ||
    !delivery.deliveryId ||
    !Number.isFinite(delivery.triggeredAt.getTime()) ||
    !(delivery.rawBody instanceof Uint8Array) ||
    delivery.rawBody.byteLength > 8 * 1024 * 1024
  ) {
    throw new TypeError('Verified Shopify delivery is missing required fields');
  }
  const receipt = await ingress.receive({ ...delivery, rawBody: Uint8Array.from(delivery.rawBody) });
  if (!receipt.id || (receipt.kind !== 'received' && receipt.kind !== 'duplicate' && receipt.kind !== 'processed')) {
    throw new ShopifyQueueHandoffError();
  }
  if (receipt.kind === 'processed') {
    return { inboxId: receipt.id, kind: receipt.kind, queue: 'not_needed' };
  }
  let outcome: 'enqueued' | 'already_enqueued';
  try {
    outcome = await queue.ensureEnqueued({
      inboxId: receipt.id,
      shopDomain: delivery.shopDomain,
      topic: delivery.topic,
    });
  } catch {
    throw new ShopifyQueueHandoffError();
  }
  if (outcome !== 'enqueued' && outcome !== 'already_enqueued') throw new ShopifyQueueHandoffError();
  return { inboxId: receipt.id, kind: receipt.kind, queue: outcome };
}
