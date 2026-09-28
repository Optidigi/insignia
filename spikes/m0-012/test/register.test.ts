import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RunRegister } from '../src/register.ts';

const ENDPOINT = 'https://api.shopify.com/app/2026-07/events';
const HASH = 'a'.repeat(64);
function body(key: string, timestamp = '2026-09-28T17:00:00.000Z') {
  return JSON.stringify({ shop_id: 'gid://shopify/Shop/105501393179',
    event_handle: 'customized_order_paid', timestamp,
    idempotency_key: key, attributes: { value: 1 } });
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'insignia-register-'));
  const register = new RunRegister(root);
  await register.initialize({ runId: 'm0-012-test', endpoint: ENDPOINT,
    sourceHash: HASH, createdAt: '2026-09-28T17:00:00.000Z' });
  return { root, register };
}

test('durable register survives restart; duplicate retains original bytes and consumes attempts', async () => {
  const { root, register } = await fixture();
  try {
    const original = body('aa11');
    assert.equal((await register.registerEvent(original)).kind, 'REGISTERED');
    const first = await register.reserveAcquisition('aa11', original);
    assert.equal(first.kind, 'RESERVED');
    if (first.kind !== 'RESERVED') return;
    assert.equal((await register.markMayDispatch('aa11', first.ordinal)).kind, 'MARKED');
    assert.equal((await register.recordOutcome('aa11', first.ordinal,
      { kind: 'HTTP', status: 202 })).kind, 'RECORDED');
    const restarted = new RunRegister(root);
    const state = await restarted.inspect();
    assert.equal(state.kind, 'READY');
    if (state.kind !== 'READY') return;
    assert.equal(state.state.tokenReservations, 1);
    assert.equal(state.state.postReservations, 1);
    assert.equal(state.state.events.aa11?.body, original);
    assert.equal((await restarted.registerEvent(original)).kind, 'EXISTING');
    const duplicate = await restarted.reserveAcquisition('aa11', original);
    assert.equal(duplicate.kind, 'RESERVED');
    assert.equal((await restarted.registerEvent(body('aa11', '2026-09-28T17:01:00.000Z'))).kind,
      'CONFLICT');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('lost or corrupt register cannot be initialized as a new run', async () => {
  const { root, register } = await fixture();
  try {
    assert.equal((await register.initialize({ runId: 'new-run', endpoint: ENDPOINT,
      sourceHash: HASH, createdAt: '2026-09-28T17:00:00.000Z' })).kind, 'CONFLICT');
    await unlink(join(root, 'register.json'));
    assert.equal((await register.inspect()).kind, 'CONFLICT');
    assert.equal((await register.initialize({ runId: 'new-run', endpoint: ENDPOINT,
      sourceHash: HASH, createdAt: '2026-09-28T17:00:00.000Z' })).kind, 'CONFLICT');
    await writeFile(join(root, 'register.json'), '{broken', { mode: 0o600 });
    assert.equal((await register.inspect()).kind, 'CONFLICT');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('three event keys, six acquisitions and six possible POSTs are independent ceilings', async () => {
  const { root, register } = await fixture();
  try {
    for (const key of ['aa11', 'bb22', 'cc33'])
      assert.equal((await register.registerEvent(body(key))).kind, 'REGISTERED');
    assert.equal((await register.registerEvent(body('dd44'))).kind, 'LIMIT');
    for (let i = 0; i < 6; i++) {
      const key = ['aa11', 'bb22', 'cc33'][i % 3]!;
      const reserved = await register.reserveAcquisition(key, body(key));
      assert.equal(reserved.kind, 'RESERVED');
      if (reserved.kind !== 'RESERVED') return;
      if (i % 2 === 0) {
        assert.equal((await register.markMayDispatch(key, reserved.ordinal)).kind, 'MARKED');
        assert.equal((await register.recordOutcome(key, reserved.ordinal,
          { kind: 'HTTP', status: 202 })).kind, 'RECORDED');
      } else assert.equal((await register.recordOutcome(key, reserved.ordinal,
        { kind: 'TOKEN_REJECTED' })).kind, 'RECORDED');
    }
    assert.equal((await register.reserveAcquisition('aa11', body('aa11'))).kind, 'LIMIT');
    const ready = await register.inspect();
    assert.equal(ready.kind, 'READY');
    if (ready.kind === 'READY') {
      assert.equal(ready.state.tokenReservations, 6);
      assert.equal(ready.state.postReservations, 3);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an uncertain dispatch stays counted across process restart and blocks invented outcome', async () => {
  const { root, register } = await fixture();
  try {
    const original = body('aa11');
    await register.registerEvent(original);
    const reserved = await register.reserveAcquisition('aa11', original);
    assert.equal(reserved.kind, 'RESERVED');
    if (reserved.kind !== 'RESERVED') return;
    await register.markMayDispatch('aa11', reserved.ordinal);
    const restarted = new RunRegister(root);
    const state = await restarted.inspect();
    assert.equal(state.kind, 'READY');
    if (state.kind !== 'READY') return;
    assert.equal(state.state.postReservations, 1);
    assert.equal(state.state.events.aa11?.attempts[0]?.state, 'MAY_HAVE_SENT');
    assert.equal((await restarted.recordOutcome('aa11', reserved.ordinal,
      { kind: 'HTTP', status: 202 })).kind, 'CONFLICT');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('held lock refuses concurrent mutation and leaves state intact', async () => {
  const { root, register } = await fixture();
  try {
    await writeFile(join(root, 'register.lock'), '', { flag: 'wx', mode: 0o600 });
    assert.equal((await register.registerEvent(body('aa11'))).kind, 'CONFLICT');
    const raw = JSON.parse(await readFile(join(root, 'register.json'), 'utf8'));
    assert.deepEqual(raw.events, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});
