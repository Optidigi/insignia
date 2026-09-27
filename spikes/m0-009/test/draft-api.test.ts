import { describe, expect, it } from 'vitest';
import { DraftStore, handleDraftPost, viewerTag } from '../src/server/draft-api.ts';
import type { AuthResult } from '../src/server/auth.ts';

const origin = 'https://app.example.test';
const shop = 'alpha.myshopify.com';
const context = {
  shop, staffId: '2', shopId: 'gid://shopify/Shop/1',
  installationId: 'gid://shopify/AppInstallation/99',
  grantedScopes: ['write_products'], canEdit: true
};
function gate(result: AuthResult = { ok: true, context }) {
  return {
    expectedOrigin: () => origin,
    authenticate: async (_request: Request, _edit: boolean) => result
  };
}
function post(body: unknown, options: { requestOrigin?: string; contentType?: string; requestUrl?: string } = {}) {
  const boundBody = body && typeof body === 'object' && !Array.isArray(body)
    ? { viewer: viewerTag(context), ...body } : body;
  return new Request(options.requestUrl ?? `${origin}/api/draft`, {
    method: 'POST',
    headers: {
      Origin: options.requestOrigin ?? origin,
      'Content-Type': options.contentType ?? 'application/json',
      Authorization: 'Bearer synthetic'
    },
    body: JSON.stringify(boundBody)
  });
}

describe('synthetic draft POST', () => {
  it('saves one validated local edit and rejects stale version without changing it', async () => {
    const store = new DraftStore();
    const saved = await handleDraftPost(post({ label: '  Sample draft  ', version: 0 }), gate(), store);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ label: 'Sample draft', version: 1 });
    expect(store.get(shop, '2')).toEqual({ label: 'Sample draft', version: 1 });
    const stale = await handleDraftPost(post({ label: 'Overwrite', version: 0 }), gate(), store);
    expect(stale.status).toBe(409);
    expect(store.get(shop, '2').label).toBe('Sample draft');
  });

  it('rejects cross-origin forms before authentication and leaves state unchanged', async () => {
    const store = new DraftStore();
    let authCalls = 0;
    const auth = { expectedOrigin: () => origin,
      authenticate: async () => { authCalls++; return { ok: true as const, context }; } };
    const response = await handleDraftPost(post({ label: 'Attack', version: 0 },
      { requestOrigin: 'https://attacker.example' }), auth, store);
    expect(response.status).toBe(403);
    expect(authCalls).toBe(0);
    expect(store.get(shop, '2').version).toBe(0);
  });

  it('accepts only the configured host behind an HTTPS-terminating tunnel', async () => {
    const store = new DraftStore();
    const forwarded = await handleDraftPost(post({ label: 'Forwarded', version: 0 },
      { requestUrl: 'http://app.example.test/api/draft' }), gate(), store);
    expect(forwarded.status).toBe(200);
    const wrongHost = await handleDraftPost(post({ label: 'Wrong host', version: 1 },
      { requestUrl: 'http://other.example.test/api/draft' }), gate(), store);
    expect(wrongHost.status).toBe(403);
    expect(store.get(shop, '2').label).toBe('Forwarded');
  });

  it('rejects malformed, cross-tenant and denied-user input', async () => {
    const store = new DraftStore();
    for (const body of [
      { label: '', version: 0 }, { label: 'x'.repeat(81), version: 0 },
      { label: 'line\nbreak', version: 0 }, { label: 'okay', version: 1 },
      { label: 'okay', version: 0, shop: 'beta.myshopify.com' }
    ]) {
      const response = await handleDraftPost(post(body), gate(), store);
      expect([403, 409, 422]).toContain(response.status);
    }
    const denied = await handleDraftPost(post({ label: 'No', version: 0 }),
      gate({ ok: false, response: new Response('Denied', { status: 403 }) }), store);
    expect(denied.status).toBe(403);
    expect(store.get(shop, '2').version).toBe(0);
  });

  it('keeps synthetic state separated by tenant and staff', async () => {
    const store = new DraftStore();
    store.save('alpha.myshopify.com', '2', 'Alpha', 0);
    expect(store.get('alpha.myshopify.com', '2').label).toBe('Alpha');
    expect(store.get('alpha.myshopify.com', '3').version).toBe(0);
    expect(store.get('beta.myshopify.com', '2').version).toBe(0);
  });

  it('rejects a stale editor after the authenticated staff identity changes', async () => {
    const store = new DraftStore();
    const other = { ...context, staffId: '3' };
    const response = await handleDraftPost(post({ label: 'Old editor', version: 0 }),
      gate({ ok: true, context: other }), store);
    expect(response.status).toBe(409);
    expect(store.get(shop, '3').version).toBe(0);
  });
});
