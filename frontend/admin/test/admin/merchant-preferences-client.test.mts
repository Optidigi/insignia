import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type MerchantPreferencesView, MerchantPreferencesCommandSchema } from '@insignia/contracts';
import { createMerchantPreferencesClient } from '../../src/shared/merchant-preferences-client.ts';

const initial = (): MerchantPreferencesView => ({ version: 'merchant-preferences-v1', authority: 'a'.repeat(64), shop: 'example.myshopify.com', guidanceVersion: '0', wordingVersion: '0', guidance: { dismissed: false, completedSteps: [] }, overlays: { en: { locale: 'en', messages: {} } } });
function journal() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('a lost acknowledgement resumes the identical preference intent across a new page client', async () => {
  let view = initial();
  const storage = journal();
  const writes: { key: string | null; body: string }[] = [];
  let lose = true;
  const request = async (_path: string, init?: RequestInit): Promise<unknown> => {
    if (!init?.method) return structuredClone(view);
    const body = String(init.body), key = new Headers(init.headers).get('Idempotency-Key');
    writes.push({ key, body });
    const command = MerchantPreferencesCommandSchema.parse(JSON.parse(body));
    if (command.action !== 'guidance') throw new Error('Unexpected section');
    if (writes.length === 1) view = { ...view, guidanceVersion: '1', guidance: command.guidance };
    if (lose) { lose = false; throw new Error('Response lost after commit'); }
    return { kind: 'saved', preferences: structuredClone(view) };
  };
  const first = createMerchantPreferencesClient(request, storage, () => 'original-guidance-key');
  await first.read();
  await assert.rejects(() => first.saveGuidance({ dismissed: true, completedSteps: ['product'] }), /lost/);
  const reloaded = createMerchantPreferencesClient(request, storage, () => 'must-not-replace-original-key');
  assert.equal((await reloaded.read()).guidance.dismissed, true);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(storage.getItem('insignia:pending-preferences:v1:example.myshopify.com:guidance'), null);
});
test('a prior-installation pending write never dispatches with a new authority', async () => {
  const storage = journal();
  storage.setItem('insignia:pending-preferences:v1:example.myshopify.com:guidance', JSON.stringify({ key: 'old-authority-key', command: { action: 'guidance', authority: 'b'.repeat(64), expectedVersion: '0', guidance: { dismissed: true, completedSteps: [] } } }));
  let writes = 0;
  const client = createMerchantPreferencesClient(async (_path, init) => { if (init?.method) writes++; return initial(); }, storage);
  await assert.rejects(() => client.read(), /authority changed/);
  assert.equal(writes, 0);
});
test('unavailable pending-command custody refuses a write rather than losing its retry identity', async () => {
  let writes = 0;
  const client = createMerchantPreferencesClient(async (_path, init) => { if (init?.method) writes++; return initial(); }, null);
  await client.read();
  await assert.rejects(() => client.saveGuidance({ dismissed: true, completedSteps: [] }), /custody/);
  assert.equal(writes, 0);
});
test('a refresh cannot silently restamp a stale edited guidance snapshot with a newer CAS version', async () => {
  let view = initial();
  let release: (() => void) | undefined;
  let block = false;
  let sentVersion: string | undefined;
  const storage = journal();
  const request = async (_path: string, init?: RequestInit): Promise<unknown> => {
    if (!init?.method) {
      if (block) { block = false; await new Promise<void>((resolve) => { release = resolve; }); }
      return structuredClone(view);
    }
    const command = MerchantPreferencesCommandSchema.parse(JSON.parse(String(init.body)));
    sentVersion = command.expectedVersion;
    throw Object.assign(new Error('Changed'), { status: 409 });
  };
  const client = createMerchantPreferencesClient(request, storage, () => 'stale-guidance-key');
  await client.read();
  block = true;
  const refresh = client.read();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const edit = client.saveGuidance({ dismissed: true, completedSteps: [] });
  view = { ...view, guidanceVersion: '1', guidance: { dismissed: false, completedSteps: ['test'] } };
  release?.();
  await refresh;
  await assert.rejects(() => edit, /changed/i);
  assert.equal(sentVersion, '0', 'version belongs to the observed draft, not a later in-flight refresh');
});
