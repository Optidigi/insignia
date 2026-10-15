import { partnerInstant } from './partner-instant.js';

/** Exact reviewed Partner 2026-07 history read; kept separate to avoid a transport/client import cycle. */
export const PARTNER_HISTORY_QUERY = `query SubscriptionHistory(
  $appId: ID!, $shopId: ID!, $from: DateTime!, $through: DateTime!, $after: String
) {
  events(
    filter: {
      subjectId: $appId, shopId: $shopId, occurredAtMin: $from, occurredAtMax: $through,
      eventTypes: [SUBSCRIPTION_CREATED, SUBSCRIPTION_UPDATED,
        SUBSCRIPTION_CANCELLATION_SCHEDULED, SUBSCRIPTION_CANCELED,
        SUBSCRIPTION_FROZEN, SUBSCRIPTION_UNFROZEN]
    }
    first: 250, after: $after
  ) {
    edges { cursor node {
      id occurredAt eventType shop { id }
      subject { ... on AppReference { id } }
      ... on SubscriptionStatus {
        state cancelEffectiveOn
        plan { handle billingPeriod trialDays trialDaysRemaining }
      }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface PartnerHistoryVariables {
  appId: string;
  shopId: string;
  from: string;
  through: string;
  after: string | null;
}
/** Shared by the exact-query transport guard and page client; no current-contract inference. */
export function partnerHistoryVariables(input: unknown): PartnerHistoryVariables | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.appId !== 'string' ||
    !/^gid:\/\/shopify\/App\/[1-9][0-9]*$/.test(value.appId) ||
    value.appId.length > 128 ||
    typeof value.shopId !== 'string' ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(value.shopId) ||
    value.shopId.length > 128
  )
    return null;
  const from = partnerInstant(value.from),
    through = partnerInstant(value.through);
  if (!from || !through || from > through || Date.parse(through) - Date.parse(from) > 365 * 86400000) return null;
  const after = value.after === undefined ? null : value.after;
  if (after !== null && (typeof after !== 'string' || !after || after.length > 2048 || /[\s\p{Cc}]/u.test(after)))
    return null;
  return { appId: value.appId, shopId: value.shopId, from, through, after };
}
