import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IDENTITY, productionDocuments, TARGET } from './documents.mjs';
import { createGuardedOperator } from './guard.mjs';
import { createOperator, LIMITS, Stop } from './operator.mjs';
import { provider } from './provider.fixture.mjs';
import { ROOT, runSynthetic } from './qualification.mjs';

function directory() {
  return mkdtempSync(join(tmpdir(), 'insignia-m5-017-'));
}
async function runFake(fake, phase = 'start', path = directory()) {
  const result = await runSynthetic({
    directory: path,
    phase,
    fetchImpl: fake.fetchImpl,
    credentialLoader: () => ({ secret: 'synthetic-secret' }),
  });
  return { result, path, register: JSON.parse(readFileSync(join(path, 'register.json'))) };
}
function child(path, phase, address) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['scripts/m5-017/process.fixture.mjs', path, phase, address], { cwd: ROOT });
    let output = '',
      error = '';
    proc.stdout.on('data', (b) => (output += b));
    proc.stderr.on('data', (b) => (error += b));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error))));
  });
}
async function lifecycle(fake, tamperHold = false) {
  const path = directory();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    const call = JSON.parse(body);
    try {
      const response = await fake.fetchImpl(call.url, { body: JSON.stringify(call.body) });
      res.writeHead(response.status);
      res.end(await response.text());
    } catch {
      res.writeHead(502);
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const start = await child(path, 'start', address);
    const heldBytes = readFileSync(join(path, 'held.json'));
    if (tamperHold) writeFileSync(join(path, 'held.json'), Buffer.concat([heldBytes, Buffer.from(' ')]));
    const resume = await child(path, 'resume', address);
    return {
      start,
      resume,
      heldBytes,
      finalBytes: readFileSync(join(path, 'held.json')),
      register: JSON.parse(readFileSync(join(path, 'register.json'))),
    };
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(path, { recursive: true, force: true });
  }
}

test('production v3 hidden-anchor lifecycle survives a genuinely fresh process and exact hold bytes', async () => {
  const fake = provider();
  const { start, resume, heldBytes, finalBytes, register } = await lifecycle(fake);
  assert.equal(start.outcome, 'AWAITING_FRESH_PROCESS');
  assert.equal(resume.outcome, 'PASS_V3_SYNTHETIC');
  assert.equal(resume.freshProcess.different, true);
  assert.deepEqual(heldBytes, finalBytes);
  assert.equal(register.closed, true);
  assert.equal(register.pending, null);
  assert.deepEqual(register.calls, { acquire: 1, observe: 1, restore: 1, setup: 1, cleanup: 1, compensation: 1 });
  assert.equal(register.counts.auth, 2);
  assert.equal(register.counts.create, 1);
  assert.equal(register.counts.directUpdate, 2);
  assert.equal(register.counts.adapterMutation, 2);
  assert.ok(register.counts.graphql <= 128);
  assert.equal(register.transport.invocations, register.events.length);
  assert.equal(fake.calls.length, register.events.length);
  assert.ok(fake.calls.every((c) => !c.body.query?.includes('publications(') && !c.body.query?.includes('catalogs(')));
  assert.equal(resume.before.effectiveAnchors[0].supportsFuturePublishing, true);
  assert.equal(resume.final.state, 'archived');
});
test('naturally mismatched settled restore invokes only production compensation, is STOPPED and safely archived', async () => {
  let restored = false;
  const fake = provider({
    status: (p, b) => {
      if (b.query.startsWith('mutation Insignia') && p.status === 'ACTIVE') restored = true;
    },
    snapshot: (d, p) => {
      if (restored && p.status === 'ACTIVE' && d.node) d.node.resourcePublications.nodes = [];
    },
  });
  const { resume, register } = await lifecycle(fake);
  assert.equal(resume.outcome, 'STOPPED');
  assert.equal(resume.stop, 'REHELD_CONFLICT');
  assert.equal(resume.operatorHandling, 'OPERATOR_HOLD');
  assert.equal(resume.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
  assert.equal(resume.restore.kind, 'REHELD_CONFLICT');
  assert.deepEqual(resume.restore.compensation.mismatch, ['effective_publication_ids']);
  assert.equal(register.counts.adapterMutation, 3);
  assert.equal(register.events.filter((e) => e.operation === 'compensation' && e.mutation).length, 1);
});
test('lost restore response never compensates, retries, or cleans up an unsettled transition', async () => {
  const fake = provider();
  const ordinary = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const response = await ordinary(url, init);
    if (body.query?.startsWith('mutation Insignia') && body.variables.product.status === 'ACTIVE')
      throw new Error('lost response');
    return response;
  };
  const { resume, register } = await lifecycle(fake);
  assert.equal(resume.outcome, 'STOPPED');
  assert.equal(resume.restore.kind, 'RESTORATION_PENDING');
  assert.equal(register.counts.adapterMutation, 2);
  assert.equal(register.calls.cleanup, 0);
  assert.equal(register.events.filter((e) => e.operation === 'compensation' && e.mutation).length, 0);
  assert.equal(register.counts.directUpdate, 1);
});
test('visible schedule stops before acquire; known settled setup may receive one archival cleanup', async () => {
  const fake = provider({
    snapshot: (d, p) => {
      if (d.node && p.status === 'ACTIVE')
        d.node.resourcePublications.nodes.push({
          isPublished: false,
          publishDate: '2099-01-01T00:00:00Z',
          publication: { id: 'gid://shopify/Publication/304' },
        });
    },
  });
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(result.stop, 'SCHEDULED_PRODUCT_UNQUALIFIED');
    assert.equal(register.counts.adapterMutation, 0);
    assert.equal(result.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('tampered persisted hold stops the fresh process before its credential exchange or mutation', async () => {
  const fake = provider();
  const { resume, register } = await lifecycle(fake, true);
  assert.equal(resume.outcome, 'STOPPED');
  assert.equal(resume.stop, 'persisted_hold_hash');
  assert.equal(register.counts.auth, 1);
  assert.equal(register.counts.adapterMutation, 1);
});
test('fresh register cannot be started twice even without provider access', () => {
  const path = directory(),
    fake = provider(),
    options = {
      directory: path,
      binding: { synthetic: true },
      documents: productionDocuments(ROOT),
      phase: 'start',
      synthetic: true,
      fetchImpl: fake.fetchImpl,
      monotonicNow: () => performance.now(),
      assertCurrent: () => {},
    };
  try {
    createOperator(options);
    assert.throws(() => createOperator(options), /reentry/);
    assert.equal(fake.calls.length, 0);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('zero effective ACTIVE membership is partial with one create, one cleanup and no adapter write', async () => {
  const { result, path, register } = await runFake(provider({ effective: false }));
  try {
    assert.equal(result.outcome, 'PARTIAL');
    assert.equal(result.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    assert.equal(register.counts.adapterMutation, 0);
    assert.equal(register.counts.create, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('global GraphQL ceiling and closed register reject before another injected transport invocation', async () => {
  const path = directory(),
    fake = provider();
  const op = createOperator({
    directory: path,
    binding: { synthetic: true },
    documents: productionDocuments(ROOT),
    phase: 'start',
    synthetic: true,
    fetchImpl: fake.fetchImpl,
    monotonicNow: () => performance.now(),
    assertCurrent: () => {},
  });
  try {
    const auth = await (
      await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: TARGET.client,
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      })
    ).json();
    op.setToken({ accessToken: auth.access_token, expiresAt: Date.now() + auth.expires_in * 1000 });
    const request = () =>
      op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        headers: { 'x-shopify-access-token': auth.access_token },
        body: JSON.stringify({ query: IDENTITY, variables: {} }),
      });
    for (let i = 0; i < LIMITS.graphql; i++) await request();
    await assert.rejects(request(), /ceiling/);
    assert.equal(fake.calls.length, LIMITS.graphql + 1);
    assert.equal(op.state().events.length, LIMITS.graphql + 1);
    op.close();
    await assert.rejects(request(), /closed_or_parallel/);
    assert.equal(fake.calls.length, LIMITS.graphql + 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

for (const fault of [
  'freshness-at-dispatch',
  'transport-expiry',
  'elapsed-freshness',
  'backward-clock',
  'slow-identity',
  'source-gate-denial',
]) {
  test(`guarded dispatch denies ${fault} without a native create and preserves known unsent accounting`, async () => {
    const path = directory(),
      originalNow = Date.now,
      base = originalNow();
    let wall = base,
      elapsed = 0;
    Date.now = () => wall;
    const fake = provider();
    try {
      const result = await runSynthetic({
        directory: path,
        phase: 'start',
        fetchImpl: async (url, init) => {
          const response = await fake.fetchImpl(url, init);
          if (fault === 'slow-identity' && JSON.parse(init.body).query === IDENTITY) {
            wall += 35000;
            elapsed += 35000;
          }
          return response;
        },
        credentialLoader: () => ({ secret: 'synthetic-secret' }),
        monotonicNow: () => elapsed,
        assertCurrent: () => {
          let state;
          try {
            state = JSON.parse(readFileSync(join(path, 'register.json')));
          } catch {
            return;
          }
          const e = state.events.at(-1);
          if (e?.operation === 'identity' && e.settlement === 'SETTLED' && !state.fixture) {
            if (fault === 'elapsed-freshness') {
              elapsed = 35000;
              wall = base + 20000;
            }
            if (fault === 'backward-clock') wall = base - 1000;
          }
          if (e?.operation === 'create' && e.invoked) {
            if (fault === 'freshness-at-dispatch') {
              wall = base + 30050;
              elapsed = 30050;
            }
            if (fault === 'transport-expiry') {
              wall = base + 8050;
              elapsed = 8050;
            }
            if (fault === 'source-gate-denial') throw new Stop('source_binding');
          }
        },
      });
      const state = JSON.parse(readFileSync(join(path, 'register.json')));
      assert.equal(fake.calls.filter((c) => c.body.query?.includes('productCreate(')).length, 0);
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(state.events.filter((e) => e.mutation && e.settlement === 'UNKNOWN').length, 0);
      assert.equal(result.transportAccounting.matches, true);
      assert.equal(result.transportAccounting.dispatched, fake.calls.length);
      assert.equal(
        result.transportAccounting.reserved,
        result.transportAccounting.dispatched + result.transportAccounting.denied,
      );
      if (['freshness-at-dispatch', 'transport-expiry', 'source-gate-denial'].includes(fault)) {
        assert.equal(state.events.find((e) => e.operation === 'create').settlement, 'NOT_DISPATCHED');
        assert.equal(result.transportAccounting.denied, 1);
      }
    } finally {
      Date.now = originalNow;
      rmSync(path, { recursive: true, force: true });
    }
  });
}

for (const variant of ['freshness', 'operation-deadline']) {
  test(`final transport fence rejects ${variant} crossing 29950 to 30050ms independently of the eight-second request timer`, async () => {
    const path = directory(),
      originalNow = Date.now,
      base = originalNow();
    let wall = base,
      elapsed = 0,
      crossing = false;
    Date.now = () => wall;
    const fake = provider();
    let op;
    try {
      op = createGuardedOperator({
        directory: path,
        phase: 'start',
        synthetic: true,
        binding: { synthetic: true },
        documents: productionDocuments(ROOT),
        fetchImpl: fake.fetchImpl,
        monotonicNow: () => elapsed,
        assertCurrent: () => {
          const pending = op?.state();
          const e = pending?.events.at(-1);
          if (
            crossing &&
            e?.invoked &&
            pending.pending === e.index &&
            e.operation === (variant === 'freshness' ? 'create' : 'before-read')
          ) {
            wall = base + 30050;
            elapsed = 30050;
          }
        },
      });
      const auth = await (
        await op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
          method: 'POST',
          body: JSON.stringify({
            client_id: TARGET.client,
            client_secret: 'synthetic-secret',
            grant_type: 'client_credentials',
          }),
        })
      ).json();
      op.setToken({ accessToken: auth.access_token, expiresAt: wall + auth.expires_in * 1000 });
      const request = (query, variables = {}) =>
        op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
          method: 'POST',
          headers: { 'x-shopify-access-token': auth.access_token },
          body: JSON.stringify({ query, variables }),
        });
      await request(IDENTITY);
      op.mode('create');
      if (variant === 'freshness') {
        wall = base + 29950;
        elapsed = 29950;
        crossing = true;
        const marker = op.state().marker;
        await assert.rejects(
          request((await import('./documents.mjs')).CREATE, {
            product: { title: marker, handle: marker, tags: [marker], status: 'DRAFT' },
          }),
          /stale_identity/,
        );
        assert.equal(fake.calls.filter((c) => c.body.query?.includes('productCreate(')).length, 0);
      } else {
        const marker = op.state().marker;
        await request((await import('./documents.mjs')).CREATE, {
          product: { title: marker, handle: marker, tags: [marker], status: 'DRAFT' },
        });
        op.mode('before');
        wall = base + 29950;
        elapsed = 29950;
        await request((await import('./documents.mjs')).OWNED, { id: op.state().fixture.id });
        crossing = true;
        await assert.rejects(
          request(productionDocuments(ROOT).read, { productId: op.state().fixture.id }),
          /operation_deadline/,
        );
        assert.equal(fake.calls.filter((c) => c.body.query?.startsWith('query InsigniaAvailabilityV3')).length, 0);
      }
      const state = op.state();
      assert.equal(state.events.at(-1).settlement, variant === 'freshness' ? 'NOT_DISPATCHED' : 'FAILED');
      assert.equal(op.transportAudit().denied, 1);
      assert.equal(op.transportAudit().matches, true);
      await assert.rejects(request(IDENTITY), /closed_or_poisoned/);
    } finally {
      Date.now = originalNow;
      rmSync(path, { recursive: true, force: true });
    }
  });
}
for (const variant of ['malformed-product', 'http-error']) {
  test(`reported identity drift with ${variant} stops before cleanup without renewing old ownership`, async () => {
    const fake = provider({
      snapshot: (d) => {
        d.shop.id = 'gid://shopify/Shop/999';
        d.node = null;
      },
    });
    const path = directory();
    try {
      const result = await runSynthetic({
        directory: path,
        phase: 'start',
        credentialLoader: () => ({ secret: 'synthetic-secret' }),
        fetchImpl: async (url, init) => {
          const response = await fake.fetchImpl(url, init);
          if (variant === 'http-error' && JSON.parse(init.body).query?.startsWith('query InsigniaAvailabilityV3'))
            return new Response(
              JSON.stringify({
                data: await response.json().then((r) => r.data),
                errors: [{ message: 'synthetic denied' }],
              }),
              { status: 500 },
            );
          return response;
        },
      });
      const state = JSON.parse(readFileSync(join(path, 'register.json')));
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(state.counts.directUpdate, 0);
      assert.equal(state.poisoned, true);
      const badRead = fake.calls.findIndex((c) => c.body.query?.startsWith('query InsigniaAvailabilityV3'));
      assert.equal(fake.calls.length, badRead + 1, 'identity contradiction permits no subsequent provider request');
      assert.equal(result.cleanup.outcome, 'NOT_AUTHORIZED_UNSETTLED_OR_NO_FIXTURE');
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
}
