import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { provider } from './provider.fixture.mjs';
import { runSynthetic } from './qualification.mjs';

// A missed adapter injection must fail locally, never contact a provider.
globalThis.fetch = async () => {
  throw new Error('Uninjected network transport');
};
test('zero ACTIVE effective membership is PARTIAL with one create and safe archive, without acquire or restore', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'insignia-m5-015-'));
  try {
    const fake = provider({ effective: false });
    const result = await runSynthetic({
      directory,
      phase: 'start',
      fetchImpl: fake.fetchImpl,
      credentialLoader: () => ({ secret: 'synthetic-secret' }),
    });
    assert.equal(result.outcome, 'PARTIAL');
    assert.equal(result.stop, 'ACTIVE_EFFECTIVE_VISIBILITY_NOT_OBSERVED');
    assert.equal(result.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    const register = JSON.parse(readFileSync(join(directory, 'register.json')));
    assert.equal(register.counts.create, 1);
    assert.equal(register.counts.directUpdate, 2);
    assert.equal(register.counts.adapterMutation, 0);
    assert.equal(register.pending, null);
    assert.equal(register.closed, true);
    assert.equal(fake.calls.filter((x) => x.body.query?.startsWith('mutation Insignia')).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { IDENTITY, productionDocuments, TARGET } from './documents.mjs';
import { createOperator, LIMITS } from './operator.mjs';
import { qualify, ROOT } from './qualification.mjs';

function directory() {
  return mkdtempSync(join(tmpdir(), 'insignia-m5-015-'));
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
    const proc = spawn(process.execPath, ['scripts/m5-015/process.fixture.mjs', path, phase, address], { cwd: ROOT });
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
test('production v2 core lifecycle survives an actual fresh process, with capability=true and exact persisted hold bytes', async () => {
  const fake = provider();
  const { start, resume, heldBytes, finalBytes, register } = await lifecycle(fake);
  assert.equal(start.outcome, 'AWAITING_FRESH_PROCESS');
  assert.equal(resume.outcome, 'PASS_V2_SYNTHETIC');
  assert.equal(resume.freshProcess.different, true);
  assert.equal(resume.futureCapability.flag, 'FUTURE_CAPABILITY_OBSERVED');
  assert.deepEqual(heldBytes, finalBytes);
  assert.deepEqual(register.calls, { acquire: 1, observe: 1, restore: 1, setup: 1, cleanup: 1, recovery: 0 });
  assert.deepEqual(register.counts, { auth: 2, graphql: 22, create: 1, directUpdate: 2, adapterMutation: 2 });
  assert.equal(resume.acquire.current.state, 'unavailable');
  assert.equal(resume.restore.current.state, 'available');
  assert.equal(resume.final.state, 'archived');
});
test('absence of future capability is recorded without weakening core qualification', async () => {
  const fake = provider({
    snapshot: (d) => {
      d.publications.nodes[0].supportsFuturePublishing = false;
    },
  });
  const { resume } = await lifecycle(fake);
  assert.equal(resume.outcome, 'PASS_V2_SYNTHETIC');
  assert.equal(resume.futureCapability.flag, 'FUTURE_CAPABILITY_NOT_OBSERVED');
});
for (const [name, change] of [
  [
    'shop',
    (d) => {
      d.shop.id = 'gid://shopify/Shop/999';
    },
  ],
  [
    'domain',
    (d) => {
      d.shop.myshopifyDomain = 'other.myshopify.com';
    },
  ],
  [
    'development',
    (d) => {
      d.shop.plan.partnerDevelopment = false;
    },
  ],
  [
    'app',
    (d) => {
      d.currentAppInstallation.app.id = 'gid://shopify/App/999';
    },
  ],
  [
    'client',
    (d) => {
      d.currentAppInstallation.app.apiKey = '0'.repeat(32);
    },
  ],
  [
    'installation',
    (d) => {
      d.currentAppInstallation.id = 'gid://shopify/AppInstallation/999';
    },
  ],
  [
    'grants',
    (d) => {
      d.currentAppInstallation.accessScopes = d.currentAppInstallation.accessScopes.filter(
        (s) => s.handle !== 'read_publications',
      );
    },
  ],
])
  test(`exact ${name} fence prevents creation`, async () => {
    const { result, path, register } = await runFake(provider({ identity: change }));
    try {
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(register.counts.create, 0);
      assert.equal(register.counts.directUpdate, 0);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
test('ownership drift stops before setup and denies archival cleanup', async () => {
  const { result, path, register } = await runFake(
    provider({
      owned: (p) => {
        p.tags.push('foreign');
      },
    }),
  );
  try {
    assert.equal(result.stop, 'ownership');
    assert.equal(register.counts.directUpdate, 0);
    assert.equal(register.counts.adapterMutation, 0);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('actual schedule stops setup; explicit archive cannot turn persistent schedule into PASS', async () => {
  const fake = provider({
    snapshot: (d) => {
      d.node.resourcePublications.nodes = [
        {
          publication: { id: 'gid://shopify/Publication/303' },
          isPublished: false,
          publishDate: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
    },
  });
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.stop, 'SCHEDULED_PRODUCT_UNQUALIFIED');
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(register.calls.setup, 0);
    assert.equal(register.calls.acquire, 0);
    assert.equal(register.calls.cleanup, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('configured intent drift after setup stops acquire and permits separately settled cleanup', async () => {
  const fake = provider({
    snapshot: (d, p) => {
      if (p.status === 'ACTIVE') d.publications.nodes[0].autoPublish = false;
    },
  });
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.stop, 'configured_intent_changed_after_setup');
    assert.equal(register.calls.acquire, 0);
    assert.equal(result.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('ambiguous create has one exact-marker recovery read and no further mutation', async () => {
  const fake = provider();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const response = await original(url, init);
    if (JSON.parse(init.body).query?.startsWith('mutation M5015Create')) throw new Error('Lost synthetic response');
    return response;
  };
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(register.counts.create, 1);
    assert.equal(register.calls.recovery, 1);
    assert.equal(register.counts.directUpdate, 0);
    assert.equal(register.events.filter((e) => e.operation === 'recovery').length, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('lost acquire acknowledgement never causes restore, replay or cleanup mutation', async () => {
  const fake = provider();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const response = await original(url, init);
    if (JSON.parse(init.body).query?.startsWith('mutation InsigniaAvailabilityV2Status'))
      throw new Error('Lost synthetic response');
    return response;
  };
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(register.counts.adapterMutation, 1);
    assert.equal(register.calls.restore, 0);
    assert.equal(register.calls.cleanup, 0);
    assert.equal(register.counts.directUpdate, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('closed register rejects reentry before loading even synthetic credentials', async () => {
  const fake = provider({ effective: false });
  const { path } = await runFake(fake);
  let loads = 0;
  try {
    await assert.rejects(
      runSynthetic({
        directory: path,
        phase: 'start',
        fetchImpl: fake.fetchImpl,
        credentialLoader: () => {
          loads++;
          return { secret: 'synthetic-secret' };
        },
      }),
      /reentry/,
    );
    assert.equal(loads, 0);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('unsafe synthetic directory and live gate reject before any request', async () => {
  let attempts = 0;
  await assert.rejects(
    runSynthetic({
      directory: '/home/serveradmin/insignia-m5-015-handoff/run',
      phase: 'start',
      fetchImpl: async () => {
        attempts++;
      },
      credentialLoader: () => ({ secret: 'synthetic-secret' }),
    }),
    /synthetic_boundaries/,
  );
  await assert.rejects(qualify({ root: '/tmp', binding: {}, gate: {}, phase: 'start' }), /live_root/);
  await assert.rejects(qualify({ phase: 'start' }), /STOPPED_PRE_CREDENTIAL_GATE_BREACH/);
  assert.equal(attempts, 0);
});
test('global attempts, document denial, token replacement and serial reservation are durable', async () => {
  const path = directory();
  const fake = provider();
  const op = createOperator({
    directory: path,
    phase: 'start',
    synthetic: true,
    binding: { synthetic: true },
    documents: productionDocuments(ROOT),
    fetchImpl: fake.fetchImpl,
    assertCurrent: () => {},
  });
  try {
    const auth = `https://${TARGET.domain}/admin/oauth/access_token`,
      url = `https://${TARGET.domain}/admin/api/2026-07/graphql.json`;
    await op.fetch(auth, {
      method: 'POST',
      body: JSON.stringify({
        client_id: TARGET.client,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    });
    await assert.rejects(
      op.fetch(auth, {
        method: 'POST',
        body: JSON.stringify({
          client_id: TARGET.client,
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      }),
      /auth_request/,
    );
    const token = { accessToken: 'synthetic-token', expiresAt: Date.now() + 7200000 };
    op.setToken(token);
    assert.throws(() => op.setToken(token), /token_replacement/);
    const init = (query) => ({
      method: 'POST',
      headers: { 'x-shopify-access-token': token.accessToken },
      body: JSON.stringify({ query, variables: {} }),
    });
    await assert.rejects(op.fetch(url, init('mutation { publish { id } }')), /document_denied/);
    for (let i = 0; i < LIMITS.graphql; i++) await op.fetch(url, init(IDENTITY));
    await assert.rejects(op.fetch(url, init(IDENTITY)), /ceiling/);
    assert.equal(fake.calls.length, 1 + LIMITS.graphql);
    assert.equal(op.state().counts.graphql, 96);
    op.reserve('restore');
    assert.throws(() => op.reserve('restore'), /call_reentry/);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('one-second ACK/readback difference is retained while v2 semantics complete in fresh process', async () => {
  const fake = provider();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const response = await original(url, init);
    if (JSON.parse(init.body).query?.startsWith('mutation InsigniaAvailabilityV2Status')) {
      const raw = await response.json();
      raw.data.productUpdate.product.updatedAt = new Date(
        Date.parse(raw.data.productUpdate.product.updatedAt) - 1000,
      ).toISOString();
      return Response.json(raw);
    }
    return response;
  };
  const { resume } = await lifecycle(fake);
  assert.equal(resume.outcome, 'PASS_V2_SYNTHETIC');
  assert.equal(resume.acquireTimestamps.deltaMilliseconds, 1000);
  assert.equal(resume.restoreTimestamps.deltaMilliseconds, 1000);
});
test('lost restore acknowledgement in fresh process never retries or archives', async () => {
  const fake = provider();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const response = await original(url, init);
    if (body.query?.startsWith('mutation InsigniaAvailabilityV2Status') && body.variables.product.status === 'ACTIVE')
      throw new Error('Lost synthetic restore response');
    return response;
  };
  const { resume, register } = await lifecycle(fake);
  assert.equal(resume.outcome, 'STOPPED');
  assert.equal(register.calls.restore, 1);
  assert.equal(register.calls.cleanup, 0);
  assert.equal(register.counts.adapterMutation, 2);
  assert.equal(register.counts.directUpdate, 1);
});
test('incomplete configured-intent connection stops lifecycle before setup', async () => {
  const { result, path, register } = await runFake(
    provider({
      snapshot: (d) => {
        d.publications.nodes[0].includedProducts.pageInfo.hasNextPage = true;
      },
    }),
  );
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(register.calls.setup, 0);
    assert.equal(register.calls.cleanup, 0);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('production pagination consumes global budget and repeated cursor stops without mutation', async () => {
  const { result, path, register } = await runFake(
    provider({
      snapshot: (d) => {
        d.publications.pageInfo = { hasNextPage: true, hasPreviousPage: false, endCursor: 'repeat' };
      },
    }),
  );
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.ok(register.counts.graphql > 4);
    assert.equal(register.calls.setup, 0);
    assert.equal(register.counts.adapterMutation, 0);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('fresh-process-only resume rejects same PID before credential load in live operator seam', async () => {
  const fake = provider();
  const { path } = await runFake(fake);
  try {
    assert.throws(
      () =>
        createOperator({
          directory: path,
          phase: 'resume',
          synthetic: false,
          binding: { synthetic: true },
          documents: productionDocuments(ROOT),
          fetchImpl: fake.fetchImpl,
          assertCurrent: () => {},
        }),
      /fresh_process_required/,
    );
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('non-quiescent fetch timeout retains pending reservation and forbids another request', async () => {
  const path = directory();
  const op = createOperator({
    directory: path,
    phase: 'start',
    synthetic: true,
    binding: { synthetic: true },
    documents: productionDocuments(ROOT),
    fetchImpl: async () => new Promise(() => {}),
    assertCurrent: () => {},
  });
  try {
    const init = {
      method: 'POST',
      body: JSON.stringify({
        client_id: TARGET.client,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    };
    const promise = op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, init);
    await assert.rejects(op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, init), /closed_or_parallel/);
    await assert.rejects(promise, /transport_timeout/);
    assert.equal(op.state().pending, 0);
    assert.equal(op.state().events[0].quarantined, true);
    assert.equal(op.allWritesSettled(), false);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('malformed production mutation acknowledgement is not considered settled for archival authority', async () => {
  const fake = provider();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const response = await original(url, init);
    if (JSON.parse(init.body).query?.startsWith('mutation InsigniaAvailabilityV2Status')) {
      const raw = await response.json();
      delete raw.data.productUpdate.product.resourcePublications;
      return Response.json(raw);
    }
    return response;
  };
  const { result, path, register } = await runFake(fake);
  try {
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(register.counts.adapterMutation, 1);
    assert.equal(register.calls.cleanup, 0);
    assert.equal(register.counts.directUpdate, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test('failed disposal of an oversized body quarantines the outbound attempt', async () => {
  const path = directory();
  const op = createOperator({
    directory: path,
    phase: 'start',
    synthetic: true,
    binding: { synthetic: true },
    documents: productionDocuments(ROOT),
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(129 * 1024));
          },
          cancel() {
            throw new Error('Synthetic disposal rejection');
          },
        }),
      ),
    assertCurrent: () => {},
  });
  try {
    const init = {
      method: 'POST',
      body: JSON.stringify({
        client_id: TARGET.client,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    };
    await assert.rejects(op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, init));
    assert.equal(op.state().pending, 0);
    assert.equal(op.state().events[0].quarantined, true);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('persisted hold tampering stops fresh-process resume before a second auth or cleanup request', async () => {
  const { resume, register } = await lifecycle(provider(), true);
  assert.equal(resume.outcome, 'STOPPED');
  assert.equal(resume.stop, 'persisted_hold_hash');
  assert.equal(register.counts.auth, 1);
  assert.equal(register.calls.observe, 0);
  assert.equal(register.calls.cleanup, 0);
});
