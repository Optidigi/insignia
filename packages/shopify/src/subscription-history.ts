import {
  PARTNER_API_VERSION,
  type PartnerGraphqlTransport,
  PartnerSubscriptionError,
  type PartnerSubscriptionFailureKind,
} from './active-subscription.js';
import { PARTNER_HISTORY_QUERY, partnerHistoryVariables } from './partner-history-query.js';
import { partnerInstant } from './partner-instant.js';

export { PARTNER_HISTORY_QUERY } from './partner-history-query.js';

export class SubscriptionHistoryError extends Error {
  constructor(readonly kind: PartnerSubscriptionFailureKind | 'scope_mismatch') {
    super(`Partner subscription history page read failed: ${kind}`);
    this.name = 'SubscriptionHistoryError';
  }
}
export interface SubscriptionHistoryPageInput {
  appId: string;
  shopId: string;
  from: string;
  through: string;
  after?: string | null;
}
export interface SubscriptionHistoryEvent {
  id: string;
  cursor: string;
  occurredAt: string;
  eventType: string;
  state: string;
  cancelEffectiveOn: string | null;
  plan: {
    handle: string;
    billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS';
    trialDays: number | null;
    trialDaysRemaining: number | null;
  } | null;
}
export interface SubscriptionHistoryPage {
  sourceApiVersion: typeof PARTNER_API_VERSION;
  appId: string;
  shopId: string;
  from: string;
  through: string;
  after: string | null;
  observedAt: string;
  events: SubscriptionHistoryEvent[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  /** A page, even without a next cursor, proves neither installation coverage nor exact entitlement/trial/cycle intervals. */
  trustedEntitlementIntervals: false;
}
const fail = (kind: SubscriptionHistoryError['kind']): never => {
  throw new SubscriptionHistoryError(kind);
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('malformed_response');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\s\p{Cc}]/u.test(value))
    return fail('malformed_response');
  return value;
}
function trialDays(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647)
    return fail('malformed_response');
  return value;
}
function plan(value: unknown): SubscriptionHistoryEvent['plan'] {
  if (value === null) return null;
  const raw = record(value);
  if (raw.billingPeriod !== 'ANNUAL' && raw.billingPeriod !== 'EVERY_30_DAYS') return fail('malformed_response');
  return {
    handle: text(raw.handle, 256),
    billingPeriod: raw.billingPeriod,
    trialDays: trialDays(raw.trialDays),
    trialDaysRemaining: trialDays(raw.trialDaysRemaining),
  };
}
const eventTypes = new Set([
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELLATION_SCHEDULED',
  'SUBSCRIPTION_CANCELED',
  'SUBSCRIPTION_FROZEN',
  'SUBSCRIPTION_UNFROZEN',
]);

/** One bounded read only. Pagination and source words are observations, not trusted billing history. */
export function createSubscriptionHistoryClient(config: { transport: PartnerGraphqlTransport; now?: () => Date }) {
  return {
    async readPage(input: SubscriptionHistoryPageInput): Promise<SubscriptionHistoryPage> {
      const variables = partnerHistoryVariables(input);
      const observedAt = (config.now ?? (() => new Date()))();
      if (!variables || !(observedAt instanceof Date) || !Number.isFinite(+observedAt)) return fail('invalid_request');
      let body: string;
      try {
        body = await config.transport.query({ query: PARTNER_HISTORY_QUERY, variables });
      } catch (error) {
        return fail(error instanceof PartnerSubscriptionError ? error.kind : 'network_or_timeout');
      }
      if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 262144) return fail('malformed_response');
      let root: Record<string, unknown>;
      try {
        root = record(
          JSON.parse(body, (key: string, value: unknown, context?: { source?: string }) => {
            if (
              (key === 'trialDays' || key === 'trialDaysRemaining') &&
              value !== null &&
              (!context?.source || !/^(?:0|[1-9][0-9]*)$/.test(context.source))
            )
              return fail('malformed_response');
            return value;
          }),
        );
      } catch {
        return fail('malformed_response');
      }
      if (root.errors != null)
        return fail(Array.isArray(root.errors) && root.errors.length ? 'provider_error' : 'malformed_response');
      const connection = record(record(root.data).events),
        pageInfo = record(connection.pageInfo);
      if (
        !Array.isArray(connection.edges) ||
        connection.edges.length > 250 ||
        typeof pageInfo.hasNextPage !== 'boolean'
      )
        return fail('malformed_response');
      const endCursor = pageInfo.endCursor === null ? null : text(pageInfo.endCursor, 2048);
      const ids = new Set<string>(),
        cursors = new Set<string>();
      const events: SubscriptionHistoryEvent[] = connection.edges.map((raw) => {
        const edge = record(raw),
          node = record(edge.node),
          cursor = text(edge.cursor, 2048),
          id = text(node.id, 512);
        if (
          !id.startsWith('gid://partners/SubscriptionStatus/') ||
          id.length === 'gid://partners/SubscriptionStatus/'.length ||
          ids.has(id) ||
          cursors.has(cursor) ||
          cursor === variables.after
        )
          return fail('malformed_response');
        ids.add(id);
        cursors.add(cursor);
        if (record(node.shop).id !== variables.shopId || record(node.subject).id !== variables.appId)
          return fail('scope_mismatch');
        const occurredAt = partnerInstant(node.occurredAt),
          eventType = text(node.eventType, 64),
          state = text(node.state, 64);
        if (!occurredAt || occurredAt < variables.from || occurredAt > variables.through || !eventTypes.has(eventType))
          return fail('malformed_response');
        const cancelEffectiveOn = node.cancelEffectiveOn;
        if (
          cancelEffectiveOn !== null &&
          (typeof cancelEffectiveOn !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(cancelEffectiveOn) ||
            !partnerInstant(`${cancelEffectiveOn}T00:00:00.000Z`))
        )
          return fail('malformed_response');
        return { id, cursor, occurredAt, eventType, state, cancelEffectiveOn, plan: plan(node.plan) };
      });
      if (events.length ? endCursor !== events.at(-1)?.cursor : endCursor !== null || pageInfo.hasNextPage)
        return fail('malformed_response');
      return {
        sourceApiVersion: PARTNER_API_VERSION,
        ...variables,
        observedAt: observedAt.toISOString(),
        events,
        pageInfo: { hasNextPage: pageInfo.hasNextPage, endCursor },
        trustedEntitlementIntervals: false,
      };
    },
  };
}
