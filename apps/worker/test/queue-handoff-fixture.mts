import type { DurableCore } from '@insignia/database';
/** Queue identity/permission fixtures deliberately have no application inbox.
 * This fixture is NOT a durability, retention or retry-budget proof. Real core
 * + PostgreSQL controls exercise that boundary in webhook-retention.test.mts. */
export const queueBoundaryHandoff: Pick<DurableCore['webhooks'], 'withQueueHandoff'> = {
  async withQueueHandoff(_id, confirm) {
    return confirm('unconfirmed');
  },
};
