import { describe, expect, test, vi } from 'vitest';
import {
  receiveVerifiedShopifyWebhook,
  ShopifyQueueHandoffError,
  type ShopifyWebhookIngressPort,
  type ShopifyWebhookQueuePort,
  type VerifiedShopifyDelivery,
} from '../src/shopify/ingress.js';

const delivery: VerifiedShopifyDelivery = {
  shopDomain: 'test.myshopify.com',
  topic: 'app/uninstalled',
  apiVersion: '2026-07',
  deliveryId: 'provider-id',
  triggeredAt: new Date('2026-09-29T12:00:00Z'),
  eventId: null,
  name: null,
  rawBody: Uint8Array.from([1, 2, 3]),
};

describe('verified Shopify webhook handoff', () => {
  test('acknowledges only after durable inbox and confirmed job, including exact retry', async () => {
    const receive = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'received', id: 'stable-uuid', shopId: null, installationGeneration: null })
      .mockResolvedValueOnce({ kind: 'duplicate', id: 'stable-uuid', shopId: null, installationGeneration: null });
    const ensureEnqueued = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce('enqueued');
    const inbox: ShopifyWebhookIngressPort = { receive };
    const queue: ShopifyWebhookQueuePort = { ensureEnqueued };
    await expect(receiveVerifiedShopifyWebhook(inbox, queue, delivery)).rejects.toBeInstanceOf(
      ShopifyQueueHandoffError,
    );
    expect(await receiveVerifiedShopifyWebhook(inbox, queue, delivery)).toEqual({
      inboxId: 'stable-uuid',
      kind: 'duplicate',
      queue: 'enqueued',
    });
    expect(ensureEnqueued).toHaveBeenCalledTimes(2);
    expect(ensureEnqueued).toHaveBeenLastCalledWith({
      inboxId: 'stable-uuid',
      shopDomain: delivery.shopDomain,
      topic: delivery.topic,
    });
    expect(receive.mock.calls[0]?.[0]?.rawBody).not.toBe(delivery.rawBody);
  });

  test('processed duplicate needs no new job, but unknown queue outcome never acknowledges', async () => {
    const processed: ShopifyWebhookIngressPort = {
      receive: vi.fn(async () => ({
        kind: 'processed',
        id: 'stable-uuid',
        shopId: 'shop',
        installationGeneration: '1',
      })),
    };
    const ensureEnqueued = vi.fn();
    expect(await receiveVerifiedShopifyWebhook(processed, { ensureEnqueued }, delivery)).toMatchObject({
      queue: 'not_needed',
    });
    expect(ensureEnqueued).not.toHaveBeenCalled();
    await expect(
      receiveVerifiedShopifyWebhook(
        {
          receive: vi.fn(async () => ({
            kind: 'received',
            id: 'stable-uuid',
            shopId: null,
            installationGeneration: null,
          })),
        },
        { ensureEnqueued: vi.fn(async () => undefined as never) },
        delivery,
      ),
    ).rejects.toBeInstanceOf(ShopifyQueueHandoffError);
  });

  test('payload conflict cannot reach queue', async () => {
    const queue = { ensureEnqueued: vi.fn() };
    await expect(
      receiveVerifiedShopifyWebhook(
        {
          receive: vi.fn(async () => {
            throw new Error('payload conflict');
          }),
        },
        queue,
        delivery,
      ),
    ).rejects.toThrow('payload conflict');
    expect(queue.ensureEnqueued).not.toHaveBeenCalled();
  });
});
