/** Read-only relationship observations, independent of webhook routing headers.
 * https://shopify.dev/docs/api/partner/2026-07/queries/events
 */
export const PARTNER_RELATIONSHIP_QUERY = `query RelationshipHistory(
  $appId: ID!, $shopId: ID!, $from: DateTime!, $through: DateTime!, $after: String
) {
  events(filter: {
    subjectId: $appId, shopId: $shopId, occurredAtMin: $from, occurredAtMax: $through,
    eventTypes: [RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED]
  }, orderBy: OCCURRED_AT_ASC, first: 250, after: $after) {
    edges { cursor node {
      id occurredAt eventType shop { id } subject { ... on AppReference { id } }
      ... on Relationship { state }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;
