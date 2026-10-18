import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';

type DestinationScope = {
  shopId: string;
  installationGeneration: string;
  externalInstallationId: string;
  capabilityDigest: string;
};
type Destination = { state: 'prepared' | 'dispatched' | 'registered' | 'rejected'; subscriptionId: string | null };

/** Private server orchestration only. A digest is never accepted from merchant input. */
export function createUninstallLifecycleRepository(database: Kysely<Database>) {
  function validate(scope: DestinationScope) {
    if (
      !/^[a-f0-9]{64}$/.test(scope.capabilityDigest) ||
      !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
      !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(scope.externalInstallationId)
    )
      throw new Error('Invalid uninstall destination');
  }
  return {
    async coverGenericCleanup(limit = 100): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid cleanup accounting budget');
      return (
        await sql<{ count: number }>`SELECT public.cover_generic_uninstall_cleanup(${limit}) AS count`.execute(database)
      ).rows[0]!.count;
    },
    async repairVersion(scope: Omit<DestinationScope, 'capabilityDigest'>): Promise<string> {
      return (
        await sql<{ version: string }>`SELECT count(*)::text AS version FROM uninstall_destinations
        WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
        AND external_installation_id=${scope.externalInstallationId} AND state='retired'`.execute(database)
      ).rows[0]!.version;
    },
    async retire(scope: DestinationScope): Promise<void> {
      validate(scope);
      await sql`UPDATE uninstall_destinations SET state='retired'
        WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
        AND installation_generation=${scope.installationGeneration}::bigint
        AND external_installation_id=${scope.externalInstallationId} AND state='registered'`.execute(database);
    },
    async listActive(
      after: string | null,
      limit = 10,
    ): Promise<
      Array<{
        shopId: string;
        installationGeneration: string;
        externalInstallationId: string;
        providerShopId: string;
        shopDomain: string;
      }>
    > {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error('Invalid lifecycle reconciliation budget');
      const rows = (
        await sql<{
          shopId: string;
          installationGeneration: string;
          externalInstallationId: string;
          providerShopId: string;
          shopDomain: string;
        }>`SELECT s.shop_id AS "shopId",i.generation::text AS "installationGeneration",i.external_installation_id AS "externalInstallationId",
        'gid://shopify/Shop/'||s.shopify_shop_id AS "providerShopId",s.shop_domain AS "shopDomain"
        FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
        WHERE i.deactivated_at IS NULL AND i.external_installation_id IS NOT NULL AND s.shopify_shop_id IS NOT NULL
        AND (${after}::text IS NULL OR s.shop_id>${after}) ORDER BY s.shop_id LIMIT ${limit}`.execute(database)
      ).rows;
      return rows;
    },
    async reserve(scope: DestinationScope): Promise<Destination> {
      validate(scope);
      return database.transaction().execute(async (tx) => {
        const active = await sql`SELECT s.shop_id FROM shops s JOIN installation_generations i
          ON i.shop_id=s.shop_id AND i.generation=s.current_generation
          WHERE s.shop_id=${scope.shopId} AND s.current_generation=${scope.installationGeneration}::bigint
          AND i.external_installation_id=${scope.externalInstallationId} AND i.deactivated_at IS NULL
          FOR UPDATE OF s,i`.execute(tx);
        if (active.rows.length !== 1) throw new Error('Current installation required');
        await sql`INSERT INTO uninstall_destinations(capability_digest,shop_id,installation_generation,external_installation_id,state)
          VALUES(${scope.capabilityDigest},${scope.shopId},${scope.installationGeneration}::bigint,${scope.externalInstallationId},'prepared')
          ON CONFLICT DO NOTHING`.execute(tx);
        // A definitively rejected/no-dispatch operation may retry. Ambiguous
        // dispatches never enter this branch. The trigger appends both states.
        await sql`UPDATE uninstall_destinations SET state='prepared',dispatched_at=NULL
          WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
          AND installation_generation=${scope.installationGeneration}::bigint AND external_installation_id=${scope.externalInstallationId}
          AND state='rejected' AND NOT EXISTS(SELECT 1 FROM uninstall_delivery_authority a
            WHERE a.capability_digest=uninstall_destinations.capability_digest)`.execute(tx);
        const row = (
          await sql<Destination>`SELECT state,subscription_id AS "subscriptionId" FROM uninstall_destinations
          WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
          AND installation_generation=${scope.installationGeneration}::bigint AND external_installation_id=${scope.externalInstallationId}`.execute(
            tx,
          )
        ).rows[0];
        if (!row) throw new Error('Destination identity conflict');
        return row;
      });
    },
    async dispatch(scope: DestinationScope): Promise<boolean> {
      validate(scope);
      return database.transaction().execute(async (tx) => {
        const active = await sql`SELECT s.shop_id FROM shops s JOIN installation_generations i
          ON i.shop_id=s.shop_id AND i.generation=s.current_generation
          WHERE s.shop_id=${scope.shopId} AND s.current_generation=${scope.installationGeneration}::bigint
          AND i.external_installation_id=${scope.externalInstallationId} AND i.deactivated_at IS NULL FOR UPDATE OF s,i`.execute(
          tx,
        );
        if (!active.rows.length) return false;
        const result = await sql`UPDATE uninstall_destinations SET state='dispatched',dispatched_at=clock_timestamp()
          WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
          AND installation_generation=${scope.installationGeneration}::bigint AND external_installation_id=${scope.externalInstallationId}
          AND state='prepared' RETURNING capability_digest`.execute(tx);
        return result.rows.length === 1;
      });
    },
    async settle(scope: DestinationScope, subscriptionId: string | null): Promise<void> {
      validate(scope);
      if (subscriptionId !== null && !/^gid:\/\/shopify\/WebhookSubscription\/[1-9][0-9]*$/.test(subscriptionId))
        throw new Error('Invalid subscription identity');
      const result =
        await sql`UPDATE uninstall_destinations SET state=${subscriptionId === null ? 'rejected' : 'registered'},
        subscription_id=${subscriptionId},registered_at=${subscriptionId === null ? null : new Date()}
        WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
        AND installation_generation=${scope.installationGeneration}::bigint AND external_installation_id=${scope.externalInstallationId}
        AND state='dispatched' RETURNING capability_digest`.execute(database);
      if (!result.rows.length) {
        const existing = (
          await sql<{ state: string; subscription_id: string | null }>`SELECT state,subscription_id
          FROM uninstall_destinations WHERE capability_digest=${scope.capabilityDigest} AND shop_id=${scope.shopId}
          AND installation_generation=${scope.installationGeneration}::bigint AND external_installation_id=${scope.externalInstallationId}`.execute(
            database,
          )
        ).rows[0];
        if (
          !existing ||
          existing.state !== (subscriptionId === null ? 'rejected' : 'registered') ||
          existing.subscription_id !== subscriptionId
        )
          throw new Error('Lifecycle settlement identity changed');
      }
    },
  };
}
