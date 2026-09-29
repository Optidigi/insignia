import { createHash, randomUUID } from 'node:crypto';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';
import { createTenantRepository } from './tenant.js';

const WEBHOOK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/;

/** The body must pass raw-byte HMAC at controlled ingress; bounded routing headers are trusted Shopify delivery metadata. */
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

export type ShopifyWebhookReceipt = {
  kind: 'received' | 'duplicate' | 'processed';
  id: string;
  shopId: string | null;
  installationGeneration: string | null;
};

export type ShopifyWebhookState = ShopifyWebhookReceipt & {
  topic: string;
  shopDomain: string;
  state: 'pending' | 'leased' | 'processed' | 'failed';
  resolution: 'resolved' | 'unresolved' | 'stale' | 'unverified';
};

export class ShopifyDeliveryConflictError extends Error {
  constructor() {
    super('Shopify delivery identity conflicts with a previously received delivery');
    this.name = 'ShopifyDeliveryConflictError';
  }
}

function validate(input: VerifiedShopifyDelivery): void {
  if (
    !SHOP_DOMAIN.test(input.shopDomain) ||
    input.deliveryId.length < 1 ||
    input.deliveryId.length > 256 ||
    input.topic.length < 1 ||
    input.topic.length > 128 ||
    input.apiVersion.length < 1 ||
    input.apiVersion.length > 32 ||
    (input.eventId !== null && (input.eventId.length < 1 || input.eventId.length > 256)) ||
    (input.name !== null && (input.name.length < 1 || input.name.length > 128)) ||
    !(input.triggeredAt instanceof Date) ||
    !Number.isFinite(input.triggeredAt.getTime()) ||
    !(input.rawBody instanceof Uint8Array) ||
    input.rawBody.byteLength > 8 * 1024 * 1024
  ) {
    throw new TypeError('Verified Shopify delivery has invalid bounded metadata');
  }
}

/** Shopify signs the body, not the routing headers. Require a signed Shop id
 * before an uninstall may affect an installation. Domain can be null in
 * Shopify's Shop payload, but when present it must agree with the header. */
function signedUninstallShop(body: Uint8Array, headerDomain: string): { id: string; domainMatches: boolean } {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Uninstall body is not a Shopify Shop object');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Uninstall body is not a Shopify Shop object');
  const shop = value as Record<string, unknown>;
  const id = typeof shop.id === 'number' && Number.isSafeInteger(shop.id) ? String(shop.id) : shop.id;
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(id))
    throw new TypeError('Uninstall body has no valid signed Shop id');
  if (
    !Object.hasOwn(shop, 'myshopify_domain') ||
    (shop.myshopify_domain !== null && typeof shop.myshopify_domain !== 'string')
  )
    throw new TypeError('Uninstall body has no valid Shop domain');
  return { id, domainMatches: shop.myshopify_domain === null || shop.myshopify_domain === headerDomain };
}

type Locked = {
  inbox: {
    id: string;
    payload: Buffer;
    payload_sha256: string;
    shop_id: string | null;
    installation_generation: string | null;
    state: 'pending' | 'leased' | 'processed' | 'failed';
  };
  routing: {
    shop_domain: string;
    delivery_id: string;
    topic: string;
    api_version: string;
    triggered_at: Date;
    event_id: string | null;
    webhook_name: string | null;
  };
};

async function lockById(tx: Transaction<Database>, id: string): Promise<Locked | null> {
  const routing = await tx
    .selectFrom('shopify_webhook_deliveries')
    .selectAll()
    .where('inbox_id', '=', id)
    .executeTakeFirst();
  if (!routing) return null;
  const inbox = await tx
    .selectFrom('inbox_messages')
    .select(['id', 'payload', 'payload_sha256', 'shop_id', 'installation_generation', 'state'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return { routing, inbox };
}

async function resolveLocked(
  tx: Transaction<Database>,
  locked: Locked,
): Promise<{
  shopId: string | null;
  generation: string | null;
  resolution: 'resolved' | 'unresolved' | 'stale' | 'unverified';
}> {
  if (locked.inbox.shop_id !== null) {
    const current = await tx
      .selectFrom('shops')
      .innerJoin('installation_generations as i', (join) =>
        join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
      )
      .select(['shops.current_generation', 'i.deactivated_at'])
      .where('shops.shop_id', '=', locked.inbox.shop_id)
      .executeTakeFirst();
    const resolution =
      current?.current_generation === locked.inbox.installation_generation && current.deactivated_at === null
        ? 'resolved'
        : 'stale';
    return { shopId: locked.inbox.shop_id, generation: locked.inbox.installation_generation, resolution };
  }
  const current = await tx
    .selectFrom('shops')
    .innerJoin('installation_generations as i', (join) =>
      join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
    )
    .select([
      'shops.shop_id',
      'shops.shopify_shop_id',
      'shops.current_generation',
      'i.activated_at',
      'i.deactivated_at',
    ])
    .where('shops.shop_domain', '=', locked.routing.shop_domain)
    .forNoKeyUpdate('shops')
    .executeTakeFirst();
  if (!current) return { shopId: null, generation: null, resolution: 'unresolved' };
  if (current.deactivated_at !== null) return { shopId: null, generation: null, resolution: 'stale' };
  if (locked.routing.topic === 'app/uninstalled') {
    const signed = signedUninstallShop(locked.inbox.payload, locked.routing.shop_domain);
    if (current.shopify_shop_id === null || !signed.domainMatches || current.shopify_shop_id !== signed.id)
      return { shopId: null, generation: null, resolution: 'unverified' };
  }
  // First-install deliveries may precede local installation persistence. On
  // reinstall, a trigger timestamp before activation belongs to the old era.
  if (
    (current.current_generation !== '1' || locked.routing.topic === 'app/uninstalled') &&
    locked.routing.triggered_at < current.activated_at
  ) {
    return { shopId: null, generation: null, resolution: 'stale' };
  }
  await tx
    .updateTable('inbox_messages')
    .set({ shop_id: current.shop_id, installation_generation: current.current_generation })
    .where('id', '=', locked.inbox.id)
    .executeTakeFirstOrThrow();
  locked.inbox.shop_id = current.shop_id;
  locked.inbox.installation_generation = current.current_generation;
  return { shopId: current.shop_id, generation: current.current_generation, resolution: 'resolved' };
}

function assertSame(locked: Locked, input: VerifiedShopifyDelivery, hash: string, body: Buffer): void {
  if (
    locked.routing.shop_domain !== input.shopDomain ||
    locked.routing.delivery_id !== input.deliveryId ||
    locked.routing.topic !== input.topic ||
    locked.routing.api_version !== input.apiVersion ||
    locked.routing.triggered_at.getTime() !== input.triggeredAt.getTime() ||
    locked.routing.event_id !== input.eventId ||
    locked.routing.webhook_name !== input.name ||
    locked.inbox.payload_sha256 !== hash ||
    !locked.inbox.payload.equals(body)
  ) {
    throw new ShopifyDeliveryConflictError();
  }
}

export function createShopifyWebhookRepository(database: Kysely<Database>) {
  return {
    async unresolvedBacklogCount(): Promise<number> {
      const result = await database
        .selectFrom('inbox_messages')
        .select(sql<string>`count(*)`.as('count'))
        .where('source', '=', 'shopify')
        .where('shop_id', 'is', null)
        .where('state', 'in', ['pending', 'failed'])
        .executeTakeFirstOrThrow();
      const count = Number(result.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Unresolved inbox count is invalid');
      return count;
    },
    async pendingUninstallIds(limit: number): Promise<string[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid uninstall recovery limit');
      const rows = await database
        .selectFrom('shopify_webhook_deliveries as delivery')
        .innerJoin('inbox_messages as inbox', 'inbox.id', 'delivery.inbox_id')
        .innerJoin('shops as shop', 'shop.shop_domain', 'delivery.shop_domain')
        .select('delivery.inbox_id')
        .where('delivery.topic', '=', 'app/uninstalled')
        .where('inbox.state', '=', 'pending')
        .orderBy('inbox.received_at', 'asc')
        .limit(limit)
        .execute();
      return rows.map((row) => row.inbox_id);
    },
    async receive(input: VerifiedShopifyDelivery): Promise<ShopifyWebhookReceipt> {
      validate(input);
      if (input.topic === 'app/uninstalled') signedUninstallShop(input.rawBody, input.shopDomain);
      const body = Buffer.from(input.rawBody);
      const hash = createHash('sha256').update(body).digest('hex');
      const id = randomUUID();
      const now = new Date();
      return database.transaction().execute(async (tx) => {
        // The generic M3-001 key remains per generation. Shopify additionally
        // has a stable key that never changes when the inbox row is resolved.
        const inserted = await tx
          .insertInto('inbox_messages')
          .values({
            id,
            source: 'shopify',
            external_delivery_id: `${input.shopDomain}:${input.deliveryId}`,
            shop_id: null,
            installation_generation: null,
            payload: body,
            payload_sha256: hash,
            received_at: now,
            state: 'pending',
            attempts: 0,
            last_error_class: null,
            lease_owner: null,
            lease_until: null,
            retention_class: 'shopify-webhook',
            purge_after: new Date(now.getTime() + WEBHOOK_RETENTION_MS),
            erasure_state: 'retained',
          })
          .onConflict((conflict) => conflict.doNothing())
          .returning('id')
          .executeTakeFirst();
        if (inserted) {
          const indexed = await tx
            .insertInto('shopify_webhook_deliveries')
            .values({
              inbox_id: id,
              shop_domain: input.shopDomain,
              delivery_id: input.deliveryId,
              topic: input.topic,
              api_version: input.apiVersion,
              triggered_at: input.triggeredAt,
              event_id: input.eventId,
              webhook_name: input.name,
            })
            .onConflict((conflict) => conflict.doNothing())
            .returning('inbox_id')
            .executeTakeFirst();
          if (indexed) {
            const locked = await lockById(tx, id);
            if (!locked) throw new Error('Committed Shopify inbox row has no identity');
            const resolved = await resolveLocked(tx, locked);
            return {
              kind: 'received',
              id,
              shopId: resolved.shopId,
              installationGeneration: resolved.generation,
            };
          }
          await tx.deleteFrom('inbox_messages').where('id', '=', id).executeTakeFirstOrThrow();
        }
        const existing = await tx
          .selectFrom('shopify_webhook_deliveries')
          .select('inbox_id')
          .where('shop_domain', '=', input.shopDomain)
          .where('delivery_id', '=', input.deliveryId)
          .executeTakeFirst();
        if (!existing) throw new ShopifyDeliveryConflictError();
        const locked = await lockById(tx, existing.inbox_id);
        if (!locked) throw new Error('Shopify delivery identity lost its inbox row');
        assertSame(locked, input, hash, body);
        const resolved = await resolveLocked(tx, locked);
        return {
          kind: locked.inbox.state === 'processed' ? 'processed' : 'duplicate',
          id: locked.inbox.id,
          shopId: resolved.shopId,
          installationGeneration: resolved.generation,
        };
      });
    },

    async getById(id: string): Promise<ShopifyWebhookState | null> {
      return database.transaction().execute(async (tx) => {
        const locked = await lockById(tx, id);
        if (!locked) return null;
        const resolved = await resolveLocked(tx, locked);
        return {
          kind: locked.inbox.state === 'processed' ? 'processed' : 'duplicate',
          id,
          shopId: resolved.shopId,
          installationGeneration: resolved.generation,
          topic: locked.routing.topic,
          shopDomain: locked.routing.shop_domain,
          state: locked.inbox.state,
          resolution: resolved.resolution,
        };
      });
    },

    async processUninstall(
      id: string,
    ): Promise<'processed' | 'unverified' | 'already_processed' | 'unresolved' | 'stale' | 'not_found'> {
      return database.transaction().execute(async (tx) => {
        const locked = await lockById(tx, id);
        if (!locked) return 'not_found';
        if (locked.routing.topic !== 'app/uninstalled') throw new TypeError('Inbox is not an uninstall delivery');
        if (locked.inbox.state === 'processed') return 'already_processed';
        const resolved = await resolveLocked(tx, locked);
        if (resolved.resolution === 'unresolved') return 'unresolved';
        if (resolved.resolution === 'unverified') {
          await tx
            .updateTable('inbox_messages')
            .set({
              state: 'failed',
              last_error_class: 'unverified_shop_identity',
            })
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          return 'unverified';
        }
        if (resolved.resolution === 'stale') {
          await tx.updateTable('inbox_messages').set({ state: 'processed' }).where('id', '=', id).execute();
          return 'stale';
        }
        if (resolved.shopId === null || resolved.generation === null)
          throw new Error('Resolved uninstall has no installation identity');
        // The tenant row lock serializes deactivation with reinstall. Inbox
        // completion and all installation fences commit in this transaction.
        const deactivation = await createTenantRepository(tx).deactivateCurrent(
          tx,
          resolved.shopId,
          resolved.generation,
        );
        if (deactivation === 'stale') {
          await tx
            .updateTable('inbox_messages')
            .set({ state: 'processed' })
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          return 'stale';
        }
        await tx
          .updateTable('inbox_messages')
          .set((expression) => ({
            state: 'processed',
            last_error_class: null,
            attempts: expression('attempts', '+', 1),
          }))
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return 'processed';
      });
    },
  };
}
