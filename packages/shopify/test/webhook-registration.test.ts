import '@shopify/shopify-api/adapters/node';
import { ApiVersion, DeliveryMethod, Session, shopifyApi } from '@shopify/shopify-api';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { describe, expect, test } from 'vitest';

// Actual pinned SDK, synthetic transport only. Success characterizes reconciliation,
// not provider acceptance, confidential delivery or production generation authority.
const uri = 'https://callback-control.invalid/uninstall/synthetic-not-a-live-capability';
const subscription = (id: string, topic = 'APP_UNINSTALLED', callbackUrl = uri) => ({
  node: {
    id,
    topic,
    includeFields: [],
    metafieldNamespaces: [],
    endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl },
  },
});

async function characterize(input: {
  existing: ReturnType<typeof subscription>[];
  desired?: string;
  secondPage?: ReturnType<typeof subscription>[];
  failMutation?: boolean;
  repeat?: boolean;
}) {
  const previousTransport = abstractFetch;
  const previousFetch = globalThis.fetch;
  const operations: string[] = [];
  let page = 0;
  let escapes = 0;
  globalThis.fetch = async () => {
    escapes++;
    throw new Error('network_escape_denied');
  };
  setAbstractFetchFunc(async (_url, options) => {
    const { query } = JSON.parse(String(options?.body)) as { query: string };
    operations.push(query);
    if (query.includes('query shopifyApiReadWebhookSubscriptions')) {
      const next = input.secondPage && page++ === 0;
      return Response.json({
        data: {
          webhookSubscriptions: {
            edges: next ? input.existing : (input.secondPage ?? input.existing),
            pageInfo: { hasNextPage: !!next, endCursor: next ? 'synthetic-next' : null },
          },
        },
      });
    }
    if (input.failMutation) throw new Error('synthetic_ack_unavailable');
    const operation = ['webhookSubscriptionCreate', 'webhookSubscriptionUpdate', 'webhookSubscriptionDelete'].find(
      (name) => query.includes(name),
    );
    if (!operation) throw new Error('unexpected_synthetic_operation');
    return Response.json({ data: { [operation]: { userErrors: [] } } });
  });
  try {
    const api = shopifyApi({
      apiKey: 'synthetic-m5-026-client',
      apiSecretKey: 'synthetic-m5-026-secret',
      hostName: 'callback-control.invalid',
      apiVersion: ApiVersion.July26,
      isEmbeddedApp: true,
      scopes: ['write_products', 'read_publications', 'read_product_listings'],
      logger: { log: () => {} },
    });
    if (input.desired)
      api.webhooks.addHandlers({
        APP_UNINSTALLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: input.desired },
      });
    const session = new Session({
      id: 'offline_synthetic.myshopify.com',
      shop: 'synthetic.myshopify.com',
      state: 'synthetic',
      isOnline: false,
      accessToken: 'synthetic-test-only-no-provider-credential',
    });
    let failed = false;
    try {
      await api.webhooks.register({ session });
      if (input.repeat) await api.webhooks.register({ session });
    } catch {
      failed = true;
    }
    return { operations, failed, escapes };
  } finally {
    setAbstractFetchFunc(previousTransport);
    globalThis.fetch = previousFetch;
  }
}

describe('M5-026 pinned SDK callback reconciliation characterization', () => {
  test('an empty desired registry deletes an independently registered callback', async () => {
    const result = await characterize({ existing: [subscription('gid://shopify/WebhookSubscription/101')] });
    expect(result.failed).toBe(false);
    expect(result.escapes).toBe(0);
    const mutations = result.operations.filter((query) => query.includes('webhookSubscriptionDelete('));
    if (process.env.M5_026_REQUIRE_CALLBACK_PRESERVATION === '1') expect(mutations).toHaveLength(0);
    else {
      expect(mutations).toHaveLength(1);
      expect(mutations[0]).toContain('101');
    }
  });

  test('an exact desired URI is locally idempotent across repeated reconciliation', async () => {
    const result = await characterize({
      existing: [subscription('gid://shopify/WebhookSubscription/101')],
      desired: uri,
      repeat: true,
    });
    expect(result).toMatchObject({ failed: false, escapes: 0 });
    expect(result.operations).toHaveLength(2);
    expect(result.operations.every((query) => query.includes('query shopifyApiReadWebhookSubscriptions'))).toBe(true);
  });

  test('a generic desired URI creates a replacement and deletes the generation-specific URI', async () => {
    const result = await characterize({
      existing: [subscription('gid://shopify/WebhookSubscription/101')],
      desired: 'https://callback-control.invalid/generic',
    });
    expect(result).toMatchObject({ failed: false, escapes: 0 });
    expect(result.operations).toHaveLength(3);
    expect(result.operations[1]).toContain('webhookSubscriptionCreate(');
    expect(result.operations[2]).toContain('webhookSubscriptionDelete(');
  });

  test('duplicate same-URI records are not eliminated by the SDK', async () => {
    const result = await characterize({
      existing: [
        subscription('gid://shopify/WebhookSubscription/101'),
        subscription('gid://shopify/WebhookSubscription/102'),
      ],
      desired: uri,
    });
    expect(result).toMatchObject({ failed: false, escapes: 0 });
    expect(result.operations).toHaveLength(1);
  });

  test('reconciliation visits a second page and deletes an unconfigured other topic', async () => {
    const result = await characterize({
      existing: [],
      secondPage: [subscription('gid://shopify/WebhookSubscription/103', 'PRODUCTS_UPDATE')],
    });
    expect(result).toMatchObject({ failed: false, escapes: 0 });
    expect(result.operations).toHaveLength(3);
    expect(result.operations[1]).toContain('synthetic-next');
    expect(result.operations[2]).toContain('103');
  });

  test('an unavailable mutation response stops without another mutation attempt', async () => {
    const result = await characterize({ existing: [], desired: uri, failMutation: true });
    expect(result).toMatchObject({ failed: true, escapes: 0 });
    expect(result.operations.filter((query) => query.includes('webhookSubscriptionCreate('))).toHaveLength(1);
  });
});
