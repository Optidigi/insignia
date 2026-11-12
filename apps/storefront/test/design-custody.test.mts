import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesiredGroup } from '../src/buyer.ts';
import { createSelectedDesignCustody } from '../src/designer/design-custody.ts';
import { restorableDesign } from '../src/designer/group-key.ts';

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
  // Besides the UUID hint, only the opaque fingerprint of the cart quantities the draft is based on (#341).
  assert([...data.values()].every((value) => value === id || /^[a-f0-9]{64}$/.test(value)));
  assert.equal([...data.values()].filter((value) => value !== id).length, 1);
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

test('reopening a cart line keeps saved draft choices but cart-edited quantities', () => {
  const cart: DesiredGroup = { ...structuredClone(group), variants: [{ variantId: '22', quantity: 2 }] };
  const draft: DesiredGroup = {
    ...structuredClone(group),
    design: { ...structuredClone(group.design), options: [{ optionId: 'pack', valueId: 'gift' }] },
    variants: [{ variantId: '22', quantity: 1 }],
  };
  assert.deepEqual(restorableDesign(cart, undefined, true), cart);
  assert.deepEqual(restorableDesign(cart, draft, false), draft, 'unchanged cart keeps the draft quantities');
  const repaired = restorableDesign(cart, draft, true);
  assert.deepEqual(repaired.variants, cart.variants);
  assert.deepEqual(repaired.design, draft.design);
});

test('a draft resumes its own quantities until the cart quantities it was based on change (#341)', async () => {
  const data = new Map<string, string>();
  let saved: unknown;
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    api: {
      async private<T>(path: string, body: Record<string, unknown>): Promise<T> {
        if (path.endsWith('/restore'))
          return {
            ...(saved as object),
            expiresAt: '2027-01-01T00:00:00Z',
            compatibility: 'current',
            retained: null,
          } as T;
        saved = { id, version: 1, value: body.group };
        return saved as T;
      },
    },
  });
  const at = (quantity: number): DesiredGroup => ({ ...group, variants: [{ variantId: '101', quantity }] });
  // An unsent Designer edit (2 -> 4) of the cart line at 2.
  await custody.save(id, at(4), at(2));
  assert.equal((await custody.restore(at(2)))?.cartQuantitiesChanged, false, 'the cart still holds the base');
  assert.equal((await custody.restore(at(3)))?.cartQuantitiesChanged, true, 'a native cart edit is newer');
  // After Update cart the accepted line is the base: a later native return to 2 is a change, not the old base.
  await custody.rebase(id, at(4));
  assert.equal((await custody.restore(at(4)))?.cartQuantitiesChanged, false);
  assert.equal((await custody.restore(at(2)))?.cartQuantitiesChanged, true);
  await custody.forget(id, at(4));
  assert.equal(data.get(`insignia:selected-design-cart:v1:/apps/insignia:${id}`), '', 'abandoned drafts drop the base');
  assert(
    [...data.values()].every((value) => value === id || value === '' || /^[a-f0-9]{64}$/.test(value)),
    'storage holds only the UUID hint and an opaque quantity fingerprint, never a snapshot',
  );
});
