import { describe, expect, test, vi } from 'vitest';
import { createPartnerGraphqlTransport } from '../src/active-subscription.js';
import { createPartnerRelationshipClient, PARTNER_RELATIONSHIP_QUERY } from '../src/partner-relationship.js';
import { graphqlRequest, required } from './fixture-assertions.js';

const input = {
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/456',
  from: '2026-09-01T00:00:00.000Z',
  through: '2026-10-01T00:00:00.000Z',
};
const event = (id = 'a', at = '2026-09-02T00:00:00Z', state = 'INSTALLED') => ({
  id: `gid://partners/Relationship/${id}`,
  occurredAt: at,
  eventType: `RELATIONSHIP_${state}`,
  state,
  shop: { id: input.shopId },
  subject: { id: input.appId },
});
const page = (nodes: Record<string, unknown>[], next = false) =>
  JSON.stringify({
    data: {
      events: {
        edges: nodes.map((node) => ({ cursor: node.id, node })),
        pageInfo: { hasNextPage: next, endCursor: nodes.at(-1)?.id ?? null },
      },
    },
  });
const client = (bodies: string[]) => {
  const query = vi.fn(async (_request: { query: string; variables: Record<string, unknown> }) => {
    const body = bodies.shift();
    if (body === undefined) throw new Error('unexpected extra read');
    return body;
  });
  return {
    query,
    read: createPartnerRelationshipClient({ transport: { query }, now: () => new Date(input.through) }).readRange,
  };
};
describe('bounded exact Partner relationship observations', () => {
  test('reads all pages in order without asserting installation or deletion authority', async () => {
    const c = client([page([event()], true), page([event('b', '2026-09-03T00:00:00Z', 'UNINSTALLED')])]);
    const r = await c.read(input);
    expect(r.events.map((e) => e.state)).toEqual(['INSTALLED', 'UNINSTALLED']);
    expect(r.pagination).toBe('EXHAUSTED');
    expect(r.pagesRead).toBe(2);
    expect(r.installationAuthority).toBe(false);
    expect(required(required(c.query.mock.calls[1])[0]).variables.after).toBe('gid://partners/Relationship/a');
  });
  test('rejects incomplete pages, repeats, wrong scope and ambiguous chronology', async () => {
    const cases: [string[], string][] = [
      [[page([event()], true), page([event()])], 'malformed_response'],
      [[page([event(), event('b')])], 'ambiguous_chronology'],
      [[page([{ ...event(), shop: { id: 'gid://shopify/Shop/999' } }])], 'scope_mismatch'],
      [[page([{ ...event(), subject: { id: 'gid://shopify/App/999' } }])], 'scope_mismatch'],
      [[page([event('b', '2026-09-03T00:00:00Z'), event()])], 'ambiguous_chronology'],
      [
        Array.from({ length: 4 }, (_, i) => page([event(String(i), `2026-09-0${i + 2}T00:00:00Z`)], true)),
        'incomplete_pagination',
      ],
      [[JSON.stringify({ errors: [{ message: 'private' }] })], 'provider_error'],
      [[page([{ ...event(), state: 'UNINSTALLED' }])], 'malformed_response'],
      [[page([event('a', '2026-08-31T00:00:00Z')])], 'malformed_response'],
      [[page([event('a', '2026-09-02T00:00:00.000001Z')])], 'malformed_response'],
      [
        [JSON.stringify({ data: { events: { edges: [], pageInfo: { hasNextPage: true, endCursor: null } } } })],
        'malformed_response',
      ],
    ];
    for (const [bodies, kind] of cases) await expect(client(bodies).read(input)).rejects.toMatchObject({ kind });
  });
  test('empty exhausted range is an observation, not proof of absence', async () => {
    expect((await client([page([])]).read(input)).events).toEqual([]);
  });
  test('transport admits only the exact read with bounded variables, retains existing query restrictions', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, _request) => new Response(page([event()])));
    const transport = createPartnerGraphqlTransport({
      organizationId: '789',
      accessToken: 'synthetic-not-a-token',
      fetchImpl,
    });
    await createPartnerRelationshipClient({ transport, now: () => new Date(input.through) }).readRange(input);
    expect(graphqlRequest(String(required(fetchImpl.mock.calls[0])?.[1]?.body)).query).toBe(PARTNER_RELATIONSHIP_QUERY);
    for (const request of [
      { query: PARTNER_RELATIONSHIP_QUERY, variables: { ...input, appId: 'bad' } },
      { query: `${PARTNER_RELATIONSHIP_QUERY} `, variables: input },
      { query: 'mutation Unsafe { x }', variables: input },
    ])
      await expect(transport.query(request)).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
