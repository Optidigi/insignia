import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ARCHIVE, CATALOGS, DIRECT, FINAL, PRESTATE, PUBLICATIONS, TARGET } from './documents.mjs';
import { createGuardedOperator } from './guard.mjs';
import { provider } from './provider.fixture.mjs';
import { runSynthetic } from './qualification.mjs';

async function exercise(response, check, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'insignia-m5-016-test-'));
  const fake = provider({ response });
  try {
    const e = await runSynthetic({
      directory: dir,
      fetchImpl: fake.fetchImpl,
      credentialLoader: () => ({ secret: 'synthetic-secret' }),
      ...options,
    });
    await check(e, fake, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('complete explicit APP discovery and exact inclusion authorize only the fixed archival cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'insignia-m5-016-test-'));
  try {
    const fake = provider();
    const e = await runSynthetic({
      directory: dir,
      fetchImpl: fake.fetchImpl,
      credentialLoader: () => ({ secret: 'synthetic-secret' }),
    });
    assert.equal(e.classification, 'GENERIC_DISCOVERY_CONFIRMED');
    assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    assert.equal(fake.calls.length, 7);
    assert.deepEqual(e.accounting, { auth: 1, graphql: 6, directUpdate: 1, create: 0, adapterMutation: 0 });
    assert.deepEqual(e.transportAccounting, { reserved: 7, dispatched: 7, matches: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('direct inclusion without either generic discovery surface classifies DIRECT_ONLY and still cleans the disposable fixture', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) d.publications.nodes = [];
      if (b.query === CATALOGS) d.catalogs.nodes = [];
    },
    (e) => {
      assert.equal(e.classification, 'DIRECT_ONLY');
      assert.equal(e.provenSurface, null);
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    },
  ));

test('complete APP catalogs independently establish the generic surface when typed publications omit the target', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) d.publications.nodes = [];
    },
    (e) => {
      assert.equal(e.classification, 'GENERIC_DISCOVERY_CONFIRMED');
      assert.equal(e.provenSurface, 'catalogs(type:APP)');
    },
  ));

test('a denied second discovery surface is retained but cannot negate independently complete positive generic evidence', async () =>
  exercise(
    (_d, b) => {
      if (b.query === CATALOGS)
        return Response.json({
          errors: [{ message: 'provider account data omitted', extensions: { code: 'ACCESS_DENIED' } }],
        });
    },
    (e, _f, dir) => {
      assert.equal(e.classification, 'GENERIC_DISCOVERY_CONFIRMED');
      assert.equal(e.catalogs.failure, 'provider_error');
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
      assert.equal(readFileSync(join(dir, 'register.json'), 'utf8').includes('provider account data omitted'), false);
    },
  ));

test('denied generic reads without complete positive evidence classify UNRESOLVED without retries', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) d.publications.nodes = [];
      if (b.query === CATALOGS)
        return Response.json({ errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] });
    },
    (e, f) => {
      assert.equal(e.classification, 'UNRESOLVED');
      assert.equal(f.calls.filter((b) => b.query === CATALOGS).length, 1);
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    },
  ));

for (const scenario of ['null', 'not-included', 'incomplete', 'error'])
  test(`direct ${scenario} remains UNRESOLVED despite generic positives`, async () =>
    exercise(
      (d, b) => {
        if (b.query !== DIRECT) return;
        if (scenario === 'null') d.publication = null;
        if (scenario === 'not-included') d.publication.includedProducts.nodes = [];
        if (scenario === 'incomplete') d.publication.includedProducts.pageInfo.hasNextPage = true;
        if (scenario === 'error')
          return Response.json({ errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] });
      },
      (e) => {
        assert.equal(e.classification, 'UNRESOLVED');
        assert.equal(e.provenSurface, null);
        assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
      },
    ));

test('capability drift between direct and generic observations is coverage ambiguity', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) d.publications.nodes[0].supportsFuturePublishing = true;
    },
    (e) => {
      assert.equal(e.classification, 'UNRESOLVED');
      assert.equal(e.ambiguity, true);
    },
  ));

test('multiple APP catalogs claiming the target Publication are coverage ambiguity', async () =>
  exercise(
    (d, b) => {
      if (b.query === CATALOGS) d.catalogs.nodes.push({ ...d.catalogs.nodes[0], id: 'gid://shopify/AppCatalog/9' });
    },
    (e) => {
      assert.equal(e.classification, 'UNRESOLVED');
      assert.equal(e.ambiguity, true);
    },
  ));

test('duplicate generic IDs and repeated cursors fail closed with cleanup capacity preserved', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) {
        d.publications.nodes.push(d.publications.nodes[0]);
      }
      if (b.query === CATALOGS) {
        d.catalogs.nodes = [];
        d.catalogs.pageInfo = { hasNextPage: true, hasPreviousPage: b.variables.after !== null, endCursor: 'repeated' };
      }
    },
    (e) => {
      assert.equal(e.classification, 'UNRESOLVED');
      assert.equal(e.publications.failure, 'duplicate_discovery_id');
      assert.equal(e.catalogs.failure, 'discovery_cursor');
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
      assert.ok(e.accounting.graphql <= 16);
    },
  ));

test('infinite unique discovery pages reserve one catalog attempt and exact cleanup/final read within sixteen GraphQL attempts', async () =>
  exercise(
    (d, b) => {
      if (b.query === PUBLICATIONS) {
        d.publications.nodes = [];
        d.publications.pageInfo = {
          hasNextPage: true,
          hasPreviousPage: b.variables.after !== null,
          endCursor: `next-${b.variables.after ?? 'start'}`,
        };
      }
      if (b.query === CATALOGS) d.catalogs.nodes = [];
    },
    (e) => {
      assert.equal(e.classification, 'UNRESOLVED');
      assert.equal(e.publications.failure, 'discovery_budget');
      assert.equal(e.accounting.graphql, 16);
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
    },
  ));

for (const scenario of ['identity', 'ownership', 'status', 'target-effective', 'connection'])
  test(`prestate ${scenario} drift stops before discovery or mutation`, async () =>
    exercise(
      (d, b) => {
        if (b.query !== PRESTATE) return;
        if (scenario === 'identity') d.shop.id = 'gid://shopify/Shop/9';
        if (scenario === 'ownership') d.product.tags = ['another-owner'];
        if (scenario === 'status') d.product.status = 'ARCHIVED';
        if (scenario === 'target-effective') d.product.publishedOnPublication = false;
        if (scenario === 'connection') d.product.resourcePublications.pageInfo.hasNextPage = true;
      },
      (e, f) => {
        assert.equal(e.outcome, 'STOPPED');
        assert.equal(e.accounting.directUpdate, 0);
        assert.equal(f.calls.length, 2);
      },
    ));

test('identity drift in discovery revokes cleanup before any mutation', async () =>
  exercise(
    (d, b) => {
      if (b.query === DIRECT) d.currentAppInstallation.app.apiKey = '0'.repeat(32);
    },
    (e, f) => {
      assert.equal(e.outcome, 'STOPPED');
      assert.equal(e.accounting.directUpdate, 0);
      assert.equal(f.calls.filter((b) => b.query === ARCHIVE).length, 0);
    },
  ));

test('lost archive acknowledgement gets exactly one final classification read and never a resend', async () =>
  exercise(
    (_d, b) => {
      if (b.query === ARCHIVE) throw new Error('lost ACK');
    },
    (e, f) => {
      assert.equal(e.outcome, 'STOPPED');
      assert.equal(e.cleanup.outcome, 'UNKNOWN_ARCHIVE_WRITE');
      assert.equal(e.cleanup.finalExactArchived, true);
      assert.equal(e.unknownMutations, 1);
      assert.equal(f.calls.filter((b) => b.query === ARCHIVE).length, 1);
      assert.equal(f.calls.filter((b) => b.query === FINAL).length, 1);
    },
  ));

test('final exact state settlement records updatedAt difference without timestamp equality', async () =>
  exercise(
    (d, b) => {
      if (b.query === FINAL) d.product.updatedAt = '2026-10-06T21:28:00Z';
    },
    (e) => {
      assert.equal(e.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
      assert.equal(e.cleanup.deltaMilliseconds, 1000);
    },
  ));

test('a failed final publication predicate closes STOPPED without another mutation or read', async () =>
  exercise(
    (d, b) => {
      if (b.query === FINAL) d.product.publishedOnPublication = true;
    },
    (e, f) => {
      assert.equal(e.outcome, 'STOPPED');
      assert.equal(e.stop, 'final_state');
      assert.equal(f.calls.filter((b) => b.query === FINAL).length, 1);
      assert.equal(e.accounting.directUpdate, 1);
    },
  ));

test('source drift before credentials produces no provider request', async () => {
  let credentials = 0;
  await assert.rejects(
    exercise(undefined, () => {}, {
      assertCurrent: () => {
        throw new Error('source drift');
      },
      credentialLoader: () => {
        credentials++;
        return { secret: 'synthetic-secret' };
      },
    }),
    /source drift/,
  );
  assert.equal(credentials, 0);
});

test('corrupt reservation accounting denies the captured transport before its first native call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'insignia-m5-016-corrupt-'));
  let outbound = 0;
  try {
    const op = createGuardedOperator({
      directory: dir,
      binding: { synthetic: true },
      synthetic: true,
      fetchImpl: async () => {
        outbound++;
        return Response.json({});
      },
      assertCurrent: () => {},
    });
    op.patch((s) => {
      s.transport.invocations = 4;
    });
    await assert.rejects(
      op.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: TARGET.client,
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      }),
      /transport_accounting_mismatch/,
    );
    assert.equal(outbound, 0);
    assert.equal(op.state().transport.mismatch, true);
    assert.equal(op.transportAudit().matches, false);
    op.close({ synthetic: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('canonical entry exposes no resume phase and a closed synthetic register cannot be reopened', async () =>
  exercise(undefined, async (_e, f, dir) => {
    assert.equal(JSON.parse(readFileSync(join(dir, 'register.json'), 'utf8')).closed, true);
    await assert.rejects(
      runSynthetic({
        directory: dir,
        fetchImpl: f.fetchImpl,
        credentialLoader: () => ({ secret: 'synthetic-secret' }),
      }),
      /reentry/,
    );
    assert.equal(f.calls.length, 7);
  }));
