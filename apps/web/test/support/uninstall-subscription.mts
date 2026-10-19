import assert from 'node:assert/strict';

/** Provider-boundary fixture only; never native enrollment evidence. */
export function uninstallSubscriptionFixture(
  identity: () => { shopId: string; shop: string; installationId: string; appClientId: string },
) {
  const subscriptions = new Map<string, { id: string; topic: string; uri: string }>();
  return (query: string, variables: Record<string, unknown> = {}) => {
    if (!/^(?:query|mutation) Lifecycle/.test(query)) return null;
    const current = identity();
    if (query.startsWith('query LifecycleIdentity'))
      return Response.json({
        data: {
          shop: { id: current.shopId, myshopifyDomain: current.shop },
          currentAppInstallation: { id: current.installationId, app: { apiKey: current.appClientId } },
        },
      });
    if (query.startsWith('mutation LifecycleSubscribe')) {
      assert.ok(typeof variables.uri === 'string');
      assert.match(variables.uri, /^https:\/\/[^/]+\/api\/webhooks\/uninstall\/[a-f0-9]{64}$/);
      const value = {
        id: `gid://shopify/WebhookSubscription/${subscriptions.size + 1}`,
        topic: 'APP_UNINSTALLED',
        uri: variables.uri,
      };
      subscriptions.set(value.id, value);
      return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: value, userErrors: [] } } });
    }
    if (query.startsWith('query LifecycleReadback')) {
      assert.ok(typeof variables.id === 'string');
      return Response.json({ data: { webhookSubscription: subscriptions.get(variables.id) ?? null } });
    }
    if (query.startsWith('query LifecycleSettle'))
      return Response.json({
        data: {
          webhookSubscriptions: {
            nodes: [...subscriptions.values()].filter((value) => value.uri === variables.uri),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    throw new Error('Unexpected lifecycle fixture query');
  };
}
