import {
  PARTNER_API_VERSION,
  type PartnerGraphqlTransport,
  PartnerSubscriptionError,
  type PartnerSubscriptionFailureKind,
} from './active-subscription.js';
import { partnerHistoryVariables } from './partner-history-query.js';
import { partnerInstant } from './partner-instant.js';
import { PARTNER_RELATIONSHIP_QUERY } from './partner-relationship-query.js';

export { PARTNER_RELATIONSHIP_QUERY } from './partner-relationship-query.js';
export class PartnerRelationshipError extends Error {
  constructor(
    readonly kind: PartnerSubscriptionFailureKind | 'scope_mismatch' | 'incomplete_pagination' | 'ambiguous_chronology',
  ) {
    super(`Partner relationship observation unavailable: ${kind}`);
    this.name = 'PartnerRelationshipError';
  }
}
export interface PartnerRelationshipEvent {
  id: string;
  cursor: string;
  occurredAt: string;
  eventType: 'RELATIONSHIP_INSTALLED' | 'RELATIONSHIP_UNINSTALLED';
  state: 'INSTALLED' | 'UNINSTALLED';
}
export interface PartnerRelationshipRange {
  sourceApiVersion: typeof PARTNER_API_VERSION;
  appId: string;
  shopId: string;
  from: string;
  through: string;
  observedAt: string;
  events: PartnerRelationshipEvent[];
  pagesRead: number;
  pagination: 'EXHAUSTED';
  /** A fixed-range provider observation is not generation mapping or erasure authority. */
  installationAuthority: false;
}
const fail = (kind: PartnerRelationshipError['kind']): never => {
  throw new PartnerRelationshipError(kind);
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
/** At most four pages/1,000 events. No retries, generation inference or partial success. */
export function createPartnerRelationshipClient(config: { transport: PartnerGraphqlTransport; now?: () => Date }) {
  return {
    async readRange(input: {
      appId: string;
      shopId: string;
      from: string;
      through: string;
    }): Promise<PartnerRelationshipRange> {
      const scope = partnerHistoryVariables({ ...input, after: null });
      const at = (config.now ?? (() => new Date()))();
      if (!scope || !(at instanceof Date) || !Number.isFinite(+at) || Date.parse(scope.through) > +at)
        return fail('invalid_request');
      const ids = new Set<string>(),
        cursors = new Set<string>(),
        events: PartnerRelationshipEvent[] = [];
      let after: string | null = null;
      for (let pagesRead = 1; pagesRead <= 4; pagesRead++) {
        let body: string;
        try {
          body = await config.transport.query({ query: PARTNER_RELATIONSHIP_QUERY, variables: { ...scope, after } });
        } catch (error) {
          return fail(error instanceof PartnerSubscriptionError ? error.kind : 'network_or_timeout');
        }
        if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 262144) return fail('malformed_response');
        let root: Record<string, unknown>;
        try {
          root = record(JSON.parse(body));
        } catch {
          return fail('malformed_response');
        }
        if (root.errors != null)
          return fail(Array.isArray(root.errors) && root.errors.length ? 'provider_error' : 'malformed_response');
        const connection = record(record(root.data).events),
          info = record(connection.pageInfo);
        if (!Array.isArray(connection.edges) || connection.edges.length > 250 || typeof info.hasNextPage !== 'boolean')
          return fail('malformed_response');
        const end = info.endCursor === null ? null : text(info.endCursor, 2048);
        for (const raw of connection.edges) {
          const edge = record(raw),
            node = record(edge.node),
            id = text(node.id, 512),
            cursor = text(edge.cursor, 2048);
          if (!/^gid:\/\/partners\/Relationship\/.+/.test(id) || ids.has(id) || cursors.has(cursor) || cursor === after)
            return fail('malformed_response');
          if (record(node.shop).id !== scope.shopId || record(node.subject).id !== scope.appId)
            return fail('scope_mismatch');
          const occurredAt = partnerInstant(node.occurredAt),
            state = node.state;
          if (
            !occurredAt ||
            occurredAt < scope.from ||
            occurredAt > scope.through ||
            (state !== 'INSTALLED' && state !== 'UNINSTALLED') ||
            node.eventType !== `RELATIONSHIP_${state}`
          )
            return fail('malformed_response');
          const previous = events.at(-1);
          if (previous && occurredAt <= previous.occurredAt) return fail('ambiguous_chronology');
          ids.add(id);
          cursors.add(cursor);
          events.push({
            id,
            cursor,
            occurredAt,
            state,
            eventType: node.eventType as PartnerRelationshipEvent['eventType'],
          });
        }
        if (connection.edges.length ? end !== events.at(-1)?.cursor : end !== null || info.hasNextPage)
          return fail('malformed_response');
        if (!info.hasNextPage)
          return {
            sourceApiVersion: PARTNER_API_VERSION,
            appId: scope.appId,
            shopId: scope.shopId,
            from: scope.from,
            through: scope.through,
            observedAt: at.toISOString(),
            events,
            pagesRead,
            pagination: 'EXHAUSTED',
            installationAuthority: false,
          };
        after = end;
      }
      return fail('incomplete_pagination');
    },
  };
}
