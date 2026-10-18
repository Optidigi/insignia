import { expect, test, vi } from 'vitest';
import { createUninstallSubscriptionClient } from './uninstall-subscription.js';

const grant = { shop: 'fixture.myshopify.com', accessToken: 'synthetic' };
const context = {
  shopId: 'gid://shopify/Shop/1',
  installationId: 'gid://shopify/AppInstallation/2',
  appClientId: 'synthetic-client',
};
const uri = 'https://app.example/api/webhooks/uninstall/' + 'a'.repeat(64);
const identity = {
  shop: { id: context.shopId, myshopifyDomain: grant.shop },
  currentAppInstallation: { id: context.installationId, app: { apiKey: context.appClientId } },
};
const subscription = { id: 'gid://shopify/WebhookSubscription/3', topic: 'APP_UNINSTALLED', uri };
function fixture(responses: unknown[]) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const client = createUninstallSubscriptionClient({
    expectedOrigin: 'https://app.example',
    fetchImpl: async (url, init) => {
      expect(url).toBe('https://fixture.myshopify.com/admin/api/2026-07/graphql.json');
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next instanceof Response ? next : new Response(JSON.stringify({ data: next }));
    },
  });
  return { client, calls };
}
test('creates once between exact positive installation checks', async () => {
  const f = fixture([
    identity,
    { webhookSubscriptionCreate: { webhookSubscription: subscription, userErrors: [] } },
    identity,
  ]);
  expect(await f.client.create(grant, context, uri)).toEqual({ kind: 'acknowledged', subscription });
  expect(f.calls).toHaveLength(3);
  expect(f.calls[1]?.variables).toEqual({ uri });
});

test('foreign installation prevents dispatch; post-dispatch drift is unknown and never retried', async () => {
  const foreign = {
    ...identity,
    currentAppInstallation: { ...identity.currentAppInstallation, id: 'gid://shopify/AppInstallation/9' },
  };
  const before = fixture([foreign]);
  expect(await before.client.create(grant, context, uri)).toEqual({ kind: 'rejected', reason: 'not_dispatched' });
  expect(before.calls).toHaveLength(1);
  const after = fixture([
    identity,
    { webhookSubscriptionCreate: { webhookSubscription: subscription, userErrors: [] } },
    foreign,
  ]);
  expect(await after.client.create(grant, context, uri)).toEqual({ kind: 'unknown' });
  expect(after.calls.filter((call) => call.query.startsWith('mutation'))).toHaveLength(1);
});

test('lost response remains unknown; explicit null-subscription user error is rejected', async () => {
  const lost = fixture([identity, new Error('private URL/token must not escape')]);
  expect(await lost.client.create(grant, context, uri)).toEqual({ kind: 'unknown' });
  expect(lost.calls).toHaveLength(2);
  const rejected = fixture([
    identity,
    { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ message: 'private provider body' }] } },
    identity,
  ]);
  expect(await rejected.client.create(grant, context, uri)).toEqual({ kind: 'rejected', reason: 'provider_rejected' });
});

test('capability URLs are exact HTTPS same-origin paths and never dispatched otherwise', async () => {
  for (const bad of [
    uri + '?x=1',
    uri + '#secret',
    uri.replace('app.example', 'evil.example'),
    uri.replace('https:', 'http:'),
    uri.replace('/uninstall/', '/uninstall/../uninstall/'),
    uri.replace('a'.repeat(64), 'A'.repeat(64)),
    uri.replace('app.example', 'user@app.example'),
  ]) {
    const f = fixture([]);
    expect(await f.client.create(grant, context, bad)).toEqual({ kind: 'rejected', reason: 'not_dispatched' });
    expect(f.calls).toHaveLength(0);
  }
});

test('unknown-create reconciliation is read-only with exact topic/URI/identity and complete pagination', async () => {
  const f = fixture([
    identity,
    { webhookSubscriptions: { nodes: [subscription], pageInfo: { hasNextPage: true, endCursor: 'cursor1' } } },
    { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    identity,
  ]);
  expect(await f.client.reconcile(grant, context, uri)).toEqual(subscription);
  expect(f.calls.some((call) => call.query.includes('mutation'))).toBe(false);
  expect(f.calls[2]?.variables).toEqual({ uri, after: 'cursor1' });
  for (const nodes of [
    [subscription, subscription],
    [{ ...subscription, topic: 'SHOP_UPDATE' }],
    [{ ...subscription, uri: uri.replace(/a$/, 'b') }],
    [{ ...subscription, id: 'gid://shopify/WebhookSubscription/0' }],
  ]) {
    const mismatch = fixture([
      identity,
      { webhookSubscriptions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } },
    ]);
    await expect(mismatch.client.reconcile(grant, context, uri)).rejects.toThrow('Uninstall subscription unavailable');
  }
});

test('read checks returned subscription ID and rechecks owner after nullable absence', async () => {
  const f = fixture([identity, { webhookSubscription: null }, identity]);
  expect(await f.client.read(grant, context, subscription.id)).toBe(null);
  expect(f.calls).toHaveLength(3);
  const mismatch = fixture([
    identity,
    { webhookSubscription: { ...subscription, id: 'gid://shopify/WebhookSubscription/9' } },
  ]);
  await expect(mismatch.client.read(grant, context, subscription.id)).rejects.toThrow(
    'Uninstall subscription unavailable',
  );
});

test('read observes definitive destination drift only after a second positive installation check', async () => {
  const drifted = { ...subscription, uri: 'https://old-app.example/webhooks' };
  const f = fixture([identity, { webhookSubscription: drifted }, identity]);
  expect(await f.client.read(grant, context, subscription.id)).toEqual(drifted);
  expect(f.calls).toHaveLength(3);
  const uncertain = fixture([identity, { webhookSubscription: drifted }, new Error('provider unavailable')]);
  await expect(uncertain.client.read(grant, context, subscription.id)).rejects.toThrow(
    'Uninstall subscription unavailable',
  );
});

test('malformed/provider-error/oversized bodies cannot acknowledge a mutation or expose provider errors', async () => {
  for (const response of [
    new Response('secret malformed'),
    new Response(JSON.stringify({ errors: [{ message: 'secret' }] })),
    new Response('x'.repeat(262145)),
    new Response('secret', { status: 403 }),
  ]) {
    const f = fixture([identity, response]);
    expect(await f.client.create(grant, context, uri)).toEqual({ kind: 'unknown' });
  }
});

test('a transport ignoring cancellation cannot extend the mutation acknowledgement deadline', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const client = createUninstallSubscriptionClient({
      expectedOrigin: 'https://app.example',
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ data: identity }));
        return new Promise<Response>(() => {});
      },
    });
    const pending = client.create(grant, context, uri);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(calls).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test('malformed user errors cannot assert definite rejection after dispatch', async () => {
  const f = fixture([
    identity,
    { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [null] } },
    identity,
  ]);
  expect(await f.client.create(grant, context, uri)).toEqual({ kind: 'unknown' });
});
