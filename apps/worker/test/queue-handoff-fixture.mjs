/** Queue identity/permission fixtures deliberately have no application inbox.
 * This fixture is NOT a durability, retention or retry-budget proof. Real core
 * + PostgreSQL controls exercise that boundary in webhook-retention.test.mjs. */
export const queueBoundaryHandoff = {
  async withQueueHandoff(_id, confirm) {
    return confirm('unconfirmed');
  },
};
