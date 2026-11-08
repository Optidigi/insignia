import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesiredGroup } from '../src/buyer.ts';
import { createSelectedDesignCustody } from '../src/designer/design-custody.ts';

const group: DesiredGroup = {
  productId: '11',
  configRevisionId: 'revision',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'later' } },
    ],
    options: [],
  },
  variants: [{ variantId: '101', quantity: 1 }],
};
const id = '11111111-1111-4111-8111-111111111111';
test('known draft saves reuse acknowledged CAS versions without restoring preview payloads', async () => {
  let reads = 0;
  let version = 0;
  let value = group;
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: { getItem: () => null, setItem: () => {} },
    api: {
      async private<T>(path: string, body: Record<string, unknown>): Promise<T> {
        if (path.endsWith('/restore')) {
          reads++;
          if (!version) throw Object.assign(new Error('missing'), { status: 404 });
          return {
            id,
            version,
            value,
            expiresAt: '2027-01-01T00:00:00Z',
            compatibility: 'current',
            retained: null,
          } as T;
        }
        assert.equal(body.expectedVersion, version);
        value = body.group as DesiredGroup;
        return { id, version: ++version, value: body.group } as T;
      },
    },
  });
  await custody.save(id, group, undefined);
  await custody.save(id, { ...group, variants: [{ variantId: '101', quantity: 2 }] }, undefined);
  assert.equal(version, 2);
  assert.equal(reads, 0, 'new UUIDs use atomic CAS creation; successful saves supply subsequent versions');
});
test('selected draft custody recovers a lost CAS acknowledgement through the same owned UUID and stores only a UUID hint', async () => {
  const data = new Map<string, string>();
  let saved: unknown;
  let writes = 0;
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    api: {
      async private<T>(
        path: string,
        body: Record<string, unknown>,
        _signal?: AbortSignal,
        method?: 'POST' | 'PUT',
      ): Promise<T> {
        if (path.endsWith('/restore')) {
          if (!saved) throw Object.assign(new Error('missing'), { status: 404 });
          return {
            ...(saved as object),
            expiresAt: '2027-01-01T00:00:00Z',
            compatibility: 'current',
            retained: null,
          } as T;
        }
        assert.equal(method, 'PUT');
        assert.equal(body.expectedVersion, 0);
        writes++;
        saved = { id, version: 1, value: body.group };
        throw new Error('Lost acknowledgement');
      },
    },
  });
  await custody.save(id, group, group);
  assert.equal(writes, 1);
  assert([...data.values()].every((value) => value === id));
  assert.equal((await custody.restore(group))?.id, id);
  await custody.save(id, group, group);
  assert.equal(writes, 1);
});
test('a foreign UUID hint does not supply ownership or trigger a replacement write', async () => {
  let writes = 0;
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: { getItem: () => id, setItem: () => {} },
    api: {
      async private<T>(
        _path: string,
        _body: Record<string, unknown>,
        _signal?: AbortSignal,
        method?: 'POST' | 'PUT',
      ): Promise<T> {
        if (method === 'PUT') writes++;
        throw Object.assign(new Error('missing'), { status: 404 });
      },
    },
  });
  assert.equal(await custody.restore(group), null);
  assert.equal(writes, 0);
});
