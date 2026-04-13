/**
 * Webhook Idempotency Service
 * 
 * Ensures webhook handlers are idempotent by tracking processed events.
 * Uses X-Shopify-Event-Id for deduplication.
 */

import db from "../../db.server";

interface ProcessResult {
  processed: boolean;
  duplicate: boolean;
  eventId: string;
}

/**
 * Process a webhook idempotently
 * 
 * @param shopId - The shop ID (internal UUID)
 * @param eventId - X-Shopify-Event-Id header
 * @param topic - X-Shopify-Topic header
 * @param handler - The actual webhook handler function
 * @returns Result indicating if the event was processed or was a duplicate
 */
export async function processWebhookIdempotently(
  shopId: string,
  eventId: string,
  topic: string,
  handler: () => Promise<void>
): Promise<ProcessResult> {
  try {
    // Try to insert event record (will fail on duplicate due to unique constraint)
    await db.webhookEvent.create({
      data: {
        shopId,
        eventId,
        topic,
        receivedAt: new Date(),
        processedAt: null,
      },
    });
  } catch (error: unknown) {
    // Unique constraint violation = either duplicate or incomplete prior attempt
    if ((error as { code?: string }).code === "P2002") {
      const existing = await db.webhookEvent.findFirst({
        where: { eventId },
        select: { processedAt: true },
      });
      if (existing && !existing.processedAt) {
        // Previous handler crashed mid-execution — delete incomplete record and retry
        console.warn(`[Webhook] Retrying incomplete event ${eventId}`);
        await db.webhookEvent.deleteMany({ where: { eventId } });
        await db.webhookEvent.create({ data: { shopId, eventId, topic } });
        // Fall through to execute handler below
      } else {
        console.log(`[Webhook] Duplicate event ${eventId} for ${topic}, skipping`);
        return { processed: false, duplicate: true, eventId };
      }
    } else {
      throw error;
    }
  }

  try {
    // Execute the handler
    await handler();

    // Mark as processed
    await db.webhookEvent.update({
      where: { eventId },
      data: { processedAt: new Date() },
    });

    return { processed: true, duplicate: false, eventId };
  } catch (error) {
    // Log error but don't delete the event record
    // This prevents retries from being processed if we partially succeeded
    console.error(`[Webhook] Handler error for ${eventId}:`, error);
    
    // Re-throw to let the webhook handler return appropriate status
    throw error;
  }
}

/**
 * Get shop by Shopify domain
 * Creates the shop if it doesn't exist (for webhook processing)
 */
export async function getOrCreateShopByDomain(shopDomain: string): Promise<{ id: string }> {
  return db.shop.upsert({
    where: { shopifyDomain: shopDomain },
    update: {},
    create: {
      shopifyDomain: shopDomain,
      accessToken: "",
    },
    select: { id: true },
  });
}
