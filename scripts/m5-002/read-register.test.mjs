import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPreviewOperator } from './read-register.mjs';

const shop = 'insignia-rewrite-dev.myshopify.com';
const client = '1443cf6d03d39edae7c101a943c5c684';
function setup(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'insignia-m5002-register-'));
  const state = {
    appId: '429028933633',
    clientId: client,
    shop,
    limits: { adminRead: 30, adminAuth: 4, partnerRead: 4 },
    counts: { adminRead: 0, adminAuth: 0, partnerRead: 0 },
    events: [],
    ...overrides,
  };
  writeFileSync(join(directory, 'external-register.json'), JSON.stringify(state));
  return { directory, state, close: () => rmSync(directory, { recursive: true, force: true }) };
}
const read = { method: 'POST', body: JSON.stringify({ query: 'query SyntheticRead { shop { id } }' }) };
test('actual launcher register reserves durably before synthetic fetch, serializes and denies extra attempts', async () => {
  const item = setup();
  let concurrent = 0,
    peak = 0,
    sends = 0;
  try {
    const operator = createPreviewOperator({
      directory: item.directory,
      fetchImpl: async () => {
        const disk = JSON.parse(readFileSync(join(item.directory, 'external-register.json'), 'utf8'));
        assert.equal(disk.counts.adminRead, sends + 1);
        sends++;
        peak = Math.max(peak, ++concurrent);
        await new Promise((resolve) => setTimeout(resolve, 1));
        concurrent--;
        return Response.json({ data: { shop: { id: 'synthetic' } } });
      },
    });
    await Promise.all(
      Array.from({ length: 30 }, () => operator.fetch(`https://${shop}/admin/api/2026-07/graphql.json`, read)),
    );
    assert.equal(sends, 30);
    assert.equal(peak, 1);
    await assert.rejects(operator.fetch(`https://${shop}/admin/api/2026-07/graphql.json`, read), /ceiling/);
    assert.equal(sends, 30);
    assert.throws(() => createPreviewOperator({ directory: item.directory }), /EEXIST/, 'second operator cannot enter');
  } finally {
    item.close();
  }
});
test('exact SDK online exchange is counted per attempt; mutations, wrong targets and other token/event routes never send', async () => {
  const item = setup();
  let sends = 0;
  try {
    const operator = createPreviewOperator({
      directory: item.directory,
      fetchImpl: async () => {
        sends++;
        return Response.json({ synthetic: true });
      },
    });
    const auth = {
      method: 'POST',
      body: JSON.stringify({
        client_id: client,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requested_token_type: 'urn:shopify:params:oauth:token-type:online-access-token',
        subject_token: 'synthetic-no-credential',
      }),
    };
    for (let i = 0; i < 4; i++) await operator.fetch(`https://${shop}/admin/oauth/access_token`, auth);
    await assert.rejects(operator.fetch(`https://${shop}/admin/oauth/access_token`, auth), /ceiling/);
    for (const [url, input] of [
      [`http://${shop}/admin/api/2026-07/graphql.json`, read],
      ['https://other.myshopify.com/admin/api/2026-07/graphql.json', read],
      [
        `https://${shop}/admin/api/2026-07/graphql.json`,
        {
          method: 'POST',
          body: JSON.stringify({ query: 'mutation Synthetic { metafieldsSet { userErrors { message } } }' }),
        },
      ],
      [`https://${shop}/admin/api/2026-07/graphql.json?extra=1`, read],
      [
        `https://${shop}/admin/oauth/access_token`,
        { ...auth, body: JSON.stringify({ client_id: client, grant_type: 'client_credentials' }) },
      ],
      ['https://api.shopify.com/app-events/unstable/events', read],
    ])
      await assert.rejects(operator.fetch(url, input));
    assert.equal(sends, 4);
    assert.equal(operator.state.counts.adminRead, 0);
  } finally {
    item.close();
  }
});
test('ambiguous or inflated history stops before any send', () => {
  const item = setup({ counts: { adminRead: 1, adminAuth: 0, partnerRead: 0 } });
  try {
    assert.throws(() => createPreviewOperator({ directory: item.directory }), /history/);
  } finally {
    item.close();
  }
});
