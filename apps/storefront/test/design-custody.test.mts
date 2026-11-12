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
  // Besides the UUID hint, only the SHA-256 of the cart quantities the draft is based on (#341).
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
    'storage holds only the UUID hint and a quantity hash, never a snapshot',
  );
});
test('a cancelled draft save that still reached the server never blocks the next save (#371)', async () => {
  const storage = memoryStorage();
  let stored: { version: number; value: DesiredGroup } | undefined;
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage,
    api: {
      async private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
        if (path.endsWith('/restore')) {
          if (!stored) throw Object.assign(new Error('missing'), { status: 404 });
          return { id, ...stored, expiresAt: '2027-01-01T00:00:00Z', compatibility: 'current', retained: null } as T;
        }
        if (body.expectedVersion !== (stored?.version ?? 0))
          throw Object.assign(new Error('Draft changed'), { status: 409 });
        stored = { version: (stored?.version ?? 0) + 1, value: body.group as DesiredGroup };
        // The server applied the write, but the buyer's next edit cancelled the request before its answer.
        signal?.throwIfAborted();
        return { id, ...stored } as T;
      },
    },
  });
  const at = (quantity: number): DesiredGroup => ({ ...group, variants: [{ variantId: '101', quantity }] });
  // The eager review saves the cart line's 3; the buyer types 4, which cancels that preparation.
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(custody.save(id, at(3), at(3), cancelled.signal));
  assert.equal(stored?.version, 1, 'the cancelled save reached the server');
  // The explicit Review saves the buyer's 4: it replaces this tab's own earlier write.
  await custody.save(id, at(4), at(3));
  assert.deepEqual(stored?.value.variants, at(4).variants);
  const restored = await custody.restore(at(3));
  assert.deepEqual(restored?.value.variants, at(4).variants, 'reopening resumes the edit');
  assert.equal(restored?.cartQuantitiesChanged, false, 'the cart still holds the base');
  // A draft this tab never sent (another tab's) is still never overwritten.
  stored = { version: stored.version + 1, value: at(7) };
  await assert.rejects(custody.save(id, at(5), at(3)));
  assert.deepEqual(stored.value.variants, at(7).variants);
});
test('forgetting a draft without a recorded base writes no storage (#341)', async () => {
  const writes: string[] = [];
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: {
      getItem: () => null,
      setItem: (key) => {
        writes.push(key);
      },
    },
    api: {
      async private<T>(): Promise<T> {
        throw new Error('no network');
      },
    },
  });
  await custody.forget(id, group);
  assert.deepEqual(writes, []);
});

/** A Storage stand-in that records every key it holds. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}
function draftServer(owner: { session: string }) {
  const drafts = new Map<string, { session: string; value: unknown }>();
  const calls: string[] = [];
  return {
    drafts,
    calls,
    api: {
      async private<T>(path: string, body: Record<string, unknown>): Promise<T> {
        calls.push(path);
        const draftId = path.split('/')[1] ?? '';
        if (path.endsWith('/restore')) {
          const saved = drafts.get(draftId);
          if (!saved || saved.session !== owner.session) throw Object.assign(new Error('missing'), { status: 404 });
          return {
            id: draftId,
            version: 1,
            value: saved.value,
            expiresAt: '2027-01-01T00:00:00Z',
            compatibility: 'current',
            retained: null,
          } as T;
        }
        drafts.set(draftId, { session: owner.session, value: body.group });
        return { id: draftId, version: 1, value: body.group } as T;
      },
    },
  };
}
const LATEST = 'insignia:selected-design-latest:v1:/apps/insignia:11';

test('the latest unfinished new design is kept per product and buyer session in shared storage (#347)', async () => {
  const tab = memoryStorage();
  const shared = memoryStorage();
  const owner = { session: 'session-1' };
  const server = draftServer(owner);
  const custody = createSelectedDesignCustody({
    namespace: '/fr/apps/insignia',
    storage: tab,
    shared,
    session: () => owner.session,
    api: server.api,
  });
  assert.equal(custody.hasLatest('11'), false);
  await custody.save(id, group, undefined);
  assert.deepEqual(JSON.parse(shared.data.get(LATEST) ?? 'null'), { session: 'session-1', id });
  assert.equal(custody.hasLatest('11'), true);
  assert.equal(custody.hasLatest('12'), false, 'one pointer per product');
  // The pointer is independent of the group contents a fresh page load starts from.
  const resumed = await custody.latest('11');
  assert.equal(resumed?.id, id);
  assert.deepEqual(resumed?.value, group);
  // Only IDs and hashes: a new design has no cart base, so nothing else is written to shared storage.
  assert.deepEqual([...shared.data.keys()], [LATEST]);

  // A cart-line edit is not an unfinished new design. Its quantity base stays in this tab, beside the hints that read it.
  const edit = '22222222-2222-4222-8222-222222222222';
  await custody.save(edit, { ...group, variants: [{ variantId: '101', quantity: 4 }] }, group);
  assert.equal(JSON.parse(shared.data.get(LATEST) ?? 'null').id, id);
  assert.match(tab.data.get(`insignia:selected-design-cart:v1:/fr/apps/insignia:${edit}`) ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual([...shared.data.keys()], [LATEST], 'shared storage holds only the latest pointer');

  // Adding it to the cart finishes the design; another design's completion leaves the pointer alone.
  custody.forgetLatest('11', edit);
  assert.equal(custody.hasLatest('11'), true);
  custody.forgetLatest('11', id);
  assert.equal(custody.hasLatest('11'), false);
  assert.equal(await custody.latest('11'), null);
});

test('discarding the latest draft forgets its pointer (#347)', async () => {
  const shared = memoryStorage();
  const owner = { session: 'session-1' };
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: memoryStorage(),
    shared,
    session: () => owner.session,
    api: draftServer(owner).api,
  });
  await custody.save(id, group, undefined);
  assert.equal(custody.hasLatest('11'), true);
  await custody.forget(id, group);
  assert.equal(shared.data.has(LATEST), false);
  assert.equal(custody.hasLatest('11'), false);
});

test('pointers of a session that is no longer current are swept for every product of the mount (#347)', async () => {
  const shared = memoryStorage();
  const other = 'insignia:selected-design-latest:v1:/apps/other:11';
  shared.setItem(LATEST, JSON.stringify({ session: 'session-1', id }));
  shared.setItem('insignia:selected-design-latest:v1:/apps/insignia:12', JSON.stringify({ session: 'session-1', id }));
  shared.setItem('insignia:selected-design-latest:v1:/apps/insignia:13', JSON.stringify({ session: 'session-2', id }));
  shared.setItem(other, JSON.stringify({ session: 'session-1', id }));
  shared.setItem('unrelated', 'kept');
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: memoryStorage(),
    shared,
    session: () => 'session-2',
    api: draftServer({ session: 'session-2' }).api,
  });
  // Opening product 11 also clears product 12's stale pointer, which may never be reopened.
  assert.equal(custody.hasLatest('11'), false);
  assert.deepEqual(
    [...shared.data.keys()].sort(),
    [other, 'insignia:selected-design-latest:v1:/apps/insignia:13', 'unrelated'].sort(),
  );
});

test('a latest pointer from another or expired session is dropped without a server read (#347)', async () => {
  const shared = memoryStorage();
  const owner = { session: 'session-1' };
  const server = draftServer(owner);
  let current: string | undefined = 'session-1';
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: memoryStorage(),
    shared,
    session: () => current,
    api: server.api,
  });
  await custody.save(id, group, undefined);
  server.calls.length = 0;
  current = 'session-2';
  assert.equal(custody.hasLatest('11'), false);
  assert.equal(await custody.latest('11'), null);
  assert.deepEqual(server.calls, [], 'a foreign pointer never reaches the server');
  assert.equal(shared.data.has(LATEST), false);

  current = undefined;
  shared.setItem(LATEST, JSON.stringify({ session: 'session-1', id }));
  assert.equal(await custody.latest('11'), null, 'no session: nothing to restore');
  assert.equal(shared.data.has(LATEST), false);
});

test('a latest draft the server no longer has falls back to a clean start and drops its pointer (#347)', async () => {
  const shared = memoryStorage();
  const owner = { session: 'session-1' };
  const server = draftServer(owner);
  const custody = createSelectedDesignCustody({
    namespace: '/apps/insignia',
    storage: memoryStorage(),
    shared,
    session: () => owner.session,
    api: server.api,
  });
  await custody.save(id, group, undefined);
  server.drafts.clear();
  assert.equal(await custody.latest('11'), null);
  assert.equal(shared.data.has(LATEST), false);
  shared.setItem(LATEST, 'not json');
  assert.equal(custody.hasLatest('11'), false);
  assert.equal(await custody.latest('11'), null);
});
