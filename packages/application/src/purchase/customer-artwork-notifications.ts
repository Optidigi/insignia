import type { PurchaseMerchant } from './artwork.js';
import { type createCustomerArtworkLinks, customerArtworkCapabilityHash } from './customer-artwork.js';

export type CustomerArtworkNotification = {
  notificationId: string;
  shopId: string;
  installationGeneration: string;
  purchaseId: string;
  orderId: string;
};
export type CustomerArtworkDeliveryOutcome =
  | { kind: 'sent'; receipt: string }
  | { kind: 'no-effect' }
  | { kind: 'uncertain' };
export interface CustomerArtworkNotificationStore {
  pendingNotifications(limit: number): Promise<CustomerArtworkNotification[]>;
  deferNotification(notificationId: string): Promise<void>;
  claimNotification(notificationId: string, capabilityHash: string): Promise<boolean>;
  settleNotification(
    notificationId: string,
    state: 'SENT' | 'NO_EFFECT' | 'UNCERTAIN',
    receipt?: string,
  ): Promise<void>;
}
/** A customer sender and independently authorized recipient reader must be explicitly supplied.
 * A thrown send is uncertain, never a reason to automatically send the same email again.
 */
export function createCustomerArtworkNotificationDelivery(input: {
  store: CustomerArtworkNotificationStore;
  links: ReturnType<typeof createCustomerArtworkLinks>;
  recipients: { read(scope: PurchaseMerchant, orderId: string): Promise<string | null> };
  sender: {
    send(message: {
      tenantScope: { shopId: string; installationGeneration: string };
      idempotencyKey: string;
      recipient: string;
      artworkUrl: string;
      expiresAt: string;
    }): Promise<CustomerArtworkDeliveryOutcome>;
  };
}) {
  return {
    async deliverPending(limit = 20) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_NOTIFICATION_LIMIT');
      const pending = await input.store.pendingNotifications(limit);
      let sent = 0,
        deferred = 0,
        uncertain = 0;
      for (const notice of pending) {
        const scope = {
          kind: 'merchant' as const,
          shopId: notice.shopId,
          installationGeneration: notice.installationGeneration,
        };
        // Recipient capability does not come from webhook/body/customer input and is never persisted here.
        let recipient: string | null = null;
        try {
          recipient = await input.recipients.read(scope, notice.orderId);
        } catch {
          /* No send occurred; leave authority pending with bounded retry. */
        }
        if (
          !recipient ||
          recipient.length > 254 ||
          /[\r\n\0]/.test(recipient) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
        ) {
          await input.store.deferNotification(notice.notificationId);
          deferred++;
          continue;
        }
        let link: Awaited<ReturnType<typeof input.links.issue>>;
        try {
          link = await input.links.issue(
            scope,
            { purchaseId: notice.purchaseId, requestId: notice.notificationId },
            'paid-email',
          );
        } catch {
          await input.store.deferNotification(notice.notificationId);
          deferred++;
          continue;
        }
        const capability = new URLSearchParams(new URL(link.url).hash.slice(1)).get('capability');
        if (!capability) throw new Error('CUSTOMER_ARTWORK_CONFIGURATION');
        if (!(await input.store.claimNotification(notice.notificationId, customerArtworkCapabilityHash(capability))))
          continue;
        let outcome: CustomerArtworkDeliveryOutcome;
        try {
          outcome = await input.sender.send({
            tenantScope: { shopId: notice.shopId, installationGeneration: notice.installationGeneration },
            idempotencyKey: notice.notificationId,
            recipient,
            artworkUrl: link.url,
            expiresAt: link.expiresAt,
          });
        } catch {
          outcome = { kind: 'uncertain' };
        }
        if (outcome.kind === 'sent') {
          if (!outcome.receipt || outcome.receipt.length > 512 || /[\r\n\0]/.test(outcome.receipt)) {
            await input.store.settleNotification(notice.notificationId, 'UNCERTAIN');
            uncertain++;
          } else {
            await input.store.settleNotification(notice.notificationId, 'SENT', outcome.receipt);
            sent++;
          }
        } else {
          await input.store.settleNotification(
            notice.notificationId,
            outcome.kind === 'no-effect' ? 'NO_EFFECT' : 'UNCERTAIN',
          );
          if (outcome.kind === 'no-effect') {
            await input.store.deferNotification(notice.notificationId);
            deferred++;
          } else uncertain++;
        }
      }
      return { sent, ...(deferred ? { deferred } : {}), ...(uncertain ? { uncertain } : {}) };
    },
  };
}
