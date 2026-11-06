import { describe, expect, it } from 'vitest';
import {
  type CustomerArtworkGrant,
  type CustomerArtworkStore,
  createCustomerArtworkLinks,
} from './customer-artwork.js';
import {
  type CustomerArtworkNotificationStore,
  createCustomerArtworkNotificationDelivery,
} from './customer-artwork-notifications.js';

const purchaseId = '4ae66163-79b4-48fa-a8c6-f84b22c30f01';
const notificationId = '4ae66163-79b4-48fa-a8c6-f84b22c30f02';
function fixture() {
  let state = 'PENDING';
  let saved: CustomerArtworkGrant | null = null;
  const grants: CustomerArtworkStore = {
    async epoch() {
      return '4ae66163-79b4-48fa-a8c6-f84b22c30f03';
    },
    async issue(scope, input) {
      saved = {
        ...input,
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        artworkVersion: 0,
        slots: [
          {
            groupIndex: 0,
            placementId: 'front',
            productId: '11',
            revisionId: purchaseId,
            methodId: 'print',
            stepId: 'small',
          },
        ],
      };
      return saved;
    },
    async resolve(hash) {
      return saved?.capabilityHash === hash ? saved : null;
    },
    async attach() {
      throw new Error('unused');
    },
    async revoke() {},
  };
  const store: CustomerArtworkNotificationStore = {
    async pendingNotifications() {
      return state === 'PENDING'
        ? [
            {
              notificationId,
              shopId: 'shop-one',
              installationGeneration: '1',
              purchaseId,
              orderId: 'gid://shopify/Order/1',
            },
          ]
        : [];
    },
    async deferNotification() {},
    async claimNotification() {
      if (state !== 'PENDING') return false;
      state = 'DISPATCHING';
      return true;
    },
    async settleNotification(_id, next) {
      state = next;
    },
  };
  return {
    store,
    links: createCustomerArtworkLinks({
      store: grants,
      secret: 'test-only-customer-link-secret-at-least-32',
      appOrigin: 'https://insignia.test',
    }),
    state: () => state,
  };
}
describe('customer artwork notification delivery', () => {
  it('a thrown send remains uncertain and is not automatically dispatched again', async () => {
    const f = fixture();
    let attempts = 0;
    const delivery = createCustomerArtworkNotificationDelivery({
      ...f,
      recipients: { read: async () => 'customer@example.test' },
      sender: {
        async send() {
          attempts++;
          throw new Error('lost provider acknowledgement');
        },
      },
    });
    expect(await delivery.deliverPending()).toEqual({ sent: 0, uncertain: 1 });
    expect(f.state()).toBe('UNCERTAIN');
    expect(await delivery.deliverPending()).toEqual({ sent: 0 });
    expect(attempts).toBe(1);
  });
  it('does not claim or send when an authorized customer recipient is unavailable', async () => {
    const f = fixture();
    const delivery = createCustomerArtworkNotificationDelivery({
      ...f,
      recipients: { read: async () => null },
      sender: {
        async send() {
          throw new Error('must not dispatch');
        },
      },
    });
    expect(await delivery.deliverPending()).toEqual({ sent: 0, deferred: 1 });
    expect(f.state()).toBe('PENDING');
  });
  it('sends a link with stable notification identity and settles only explicit provider receipt', async () => {
    const f = fixture();
    const delivery = createCustomerArtworkNotificationDelivery({
      ...f,
      recipients: { read: async () => 'customer@example.test' },
      sender: {
        async send(message) {
          expect(message.idempotencyKey).toBe(notificationId);
          expect(message.artworkUrl).toContain('/artwork-upload#capability=');
          return { kind: 'sent', receipt: 'provider-message-1' };
        },
      },
    });
    expect(await delivery.deliverPending()).toEqual({ sent: 1 });
    expect(f.state()).toBe('SENT');
  });
  it('defers an unavailable recipient without claiming a send and continues other eligible notices', async () => {
    const f = fixture();
    let reads = 0,
      sends = 0;
    const deferred: string[] = [];
    f.store.pendingNotifications = async () =>
      [notificationId, '4ae66163-79b4-48fa-a8c6-f84b22c30f04'].map((id, index) => ({
        notificationId: id,
        shopId: 'shop-one',
        installationGeneration: '1',
        purchaseId: index ? '4ae66163-79b4-48fa-a8c6-f84b22c30f05' : purchaseId,
        orderId: `gid://shopify/Order/${index + 1}`,
      }));
    f.store.deferNotification = async (id) => {
      deferred.push(id);
    };
    const delivery = createCustomerArtworkNotificationDelivery({
      ...f,
      recipients: {
        read: async () => {
          if (++reads === 1) throw new Error('protected recipient unavailable');
          return 'buyer@example.test';
        },
      },
      sender: {
        send: async () => {
          sends++;
          return { kind: 'sent', receipt: 'actual-test-receipt' };
        },
      },
    });
    expect(await delivery.deliverPending()).toEqual({ sent: 1, deferred: 1 });
    expect(deferred).toEqual([notificationId]);
    expect(sends).toBe(1);
  });
});
