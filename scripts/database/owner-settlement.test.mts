import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256CanonicalJson } from '../../packages/database/dist/index.js';
import { readOwnerLifecycleSettlement, type SettlementLookup } from './owner-settlement.mts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'owner-settlement-'));
  await chmod(directory, 0o700);
  const decision = {
    version: 'm5-owner-lifecycle-v1',
    decisionId: '11111111-1111-4111-8111-111111111111',
    appClientId: '1443cf6d03d39edae7c101a943c5c684',
    shopDomain: 'stitchs-vat-verification-20261004.myshopify.com',
  };
  const raw = JSON.stringify({
    decision,
    ownerConnectionString: 'postgres://insignia_rewrite:local-fixture-only@localhost/insignia_fixture',
  });
  const plan = {
    version: 'm5-private-owner-lifecycle-v1',
    expectedDatabase: 'insignia_fixture',
    inputSha256: createHash('sha256').update(raw).digest('hex'),
    sources: { historical: 'retained-inert' },
  };
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan), { mode: 0o600 });
  await writeFile(join(directory, 'private-input.json'), raw, { mode: 0o600 });
  let closed = 0;
  const lookup: SettlementLookup = {
    identity: async () => ({ role: 'insignia_rewrite', database: 'insignia_fixture' }),
    decision: async (id) => {
      assert.equal(id, decision.decisionId);
      return { requestSha256: sha256CanonicalJson(decision), result: { outcome: 'OWNER_ALREADY_INACTIVE' } };
    },
    close: async () => {
      closed++;
    },
  };
  return { directory, raw, lookup, closed: () => closed };
}

test('historical settlement reads exact identity/digest without replaying obsolete source or dispatch', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  assert.deepEqual(await readOwnerLifecycleSettlement(f.directory, async () => f.lookup), {
    status: 'SETTLED_READ_ONLY',
    outcome: 'OWNER_ALREADY_INACTIVE',
    providerWrites: 0,
    fullPrivacyOrUnattendedUninstallQualified: false,
  });
  assert.equal(f.closed(), 1);
  f.lookup.decision = async () => undefined;
  assert.deepEqual(await readOwnerLifecycleSettlement(f.directory, async () => f.lookup), {
    status: 'NOT_ACKNOWLEDGED_NO_RETRY',
    providerWrites: 0,
  });
  f.lookup.decision = async () => ({ requestSha256: '0'.repeat(64), result: { outcome: 'OWNER_ALREADY_INACTIVE' } });
  await assert.rejects(
    readOwnerLifecycleSettlement(f.directory, async () => f.lookup),
    /decision_digest_changed/,
  );
  f.lookup.identity = async () => ({ role: 'wrong', database: 'insignia_fixture' });
  await assert.rejects(
    readOwnerLifecycleSettlement(f.directory, async () => f.lookup),
    /database_identity_changed/,
  );
  assert.equal(f.closed(), 4);
});

test('changed/private-file identities fail before connecting', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const neverConnect = async (): Promise<SettlementLookup> => {
    throw new Error('connection_must_not_open');
  };
  const input = join(f.directory, 'private-input.json');
  await writeFile(input, `${f.raw} `);
  await assert.rejects(readOwnerLifecycleSettlement(f.directory, neverConnect), /private_input_changed/);
  await writeFile(input, f.raw);
  await chmod(input, 0o644);
  await assert.rejects(readOwnerLifecycleSettlement(f.directory, neverConnect), /private_input_required/);
  await chmod(input, 0o600);
  await link(input, join(f.directory, 'hardlink'));
  await assert.rejects(readOwnerLifecycleSettlement(f.directory, neverConnect), /private_input_required/);
  await rm(join(f.directory, 'hardlink'));
  await symlink(f.directory, join(f.directory, 'alias'));
  await assert.rejects(
    readOwnerLifecycleSettlement(join(f.directory, 'alias'), neverConnect),
    /private_directory_symlink/,
  );
});
