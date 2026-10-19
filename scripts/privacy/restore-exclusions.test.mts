import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ExclusionData, type ExclusionEnvelope, readExclusions, writeExclusions } from './restore-exclusions.mts';

function bundle(
  data: ExclusionData = {
    schemaIdentity: 'a'.repeat(64),
    exportedAt: '2026-10-19T00:00:00Z',
    receipts: [],
    inboxes: [],
    links: [],
    shopFences: [],
    orderFences: [],
    quoteFences: [],
    assetFences: [],
    shops: [],
    generations: [],
    uninstallScopes: [],
    uninstallRecoveries: [],
  },
): ExclusionEnvelope {
  const serialized = JSON.stringify(data, (_key: string, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
  return {
    format: 'insignia-privacy-erasure-exclusions-v2',
    sha256: createHash('sha256').update(serialized).digest('hex'),
    data,
  };
}

test('private exclusion roundtrip preserves v2 identity and never replaces an existing artifact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-exclusions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'exclusions.json');
  const input = bundle();
  await writeExclusions(path, input);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readExclusions(path), input);
  await assert.rejects(writeExclusions(path, input), { code: 'EEXIST' });
  const persisted: unknown = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(persisted, input);
  // Older v2 copies may omit these two collections; absence retains that historical meaning.
  Reflect.deleteProperty(input.data, 'uninstallScopes');
  Reflect.deleteProperty(input.data, 'uninstallRecoveries');
  const earlier = bundle(input.data);
  const earlierPath = join(directory, 'earlier-v2.json');
  await writeExclusions(earlierPath, earlier);
  assert.deepEqual(await readExclusions(earlierPath), earlier);
});

test('private read rejects permission drift, symlink substitution and oversized copies', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-exclusions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'exclusions.json');
  await writeExclusions(path, bundle());
  await chmod(path, 0o644);
  await assert.rejects(readExclusions(path), /private owner exclusion file required/);
  await chmod(path, 0o600);
  const alias = join(directory, 'alias.json');
  await symlink(path, alias);
  await assert.rejects(readExclusions(alias), { code: 'ELOOP' });
  const oversized = join(directory, 'oversized.json');
  const file = await open(oversized, 'wx', 0o600);
  await file.truncate(64 * 1024 * 1024 + 1);
  await file.close();
  await assert.rejects(readExclusions(oversized), /private owner exclusion file required/);
});

test('checksum, missing collections and malformed SQL scalar identities stay on HOLD before output creation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-exclusions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'invalid.json');
  await assert.rejects(writeExclusions(path, { ...bundle(), sha256: '0'.repeat(64) }), /HOLD/);
  const missing = bundle();
  Reflect.deleteProperty(missing.data, 'inboxes'); // Deliberately model an incomplete external file.
  await assert.rejects(writeExclusions(path, bundle(missing.data)), /HOLD/);
  const invalid = bundle();
  const shop = { shop_id: 'shop', shopify_shop_id: '123', current_generation: '1' };
  invalid.data.shops.push(shop);
  Reflect.set(shop, 'current_generation', 1); // Malformed external JSON, not a valid SQL text identity.
  await assert.rejects(writeExclusions(path, bundle(invalid.data)), /invalid record scalar/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});

test('retained payload bytes and incomplete erasure authority cannot become restore exclusions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-exclusions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'invalid.json');
  const input = bundle();
  input.data.shops.push({ shop_id: 'shop', shopify_shop_id: '123', current_generation: '1' });
  input.data.inboxes.push({
    id: 'inbox',
    source: 'shopify',
    external_delivery_id: 'delivery',
    shop_id: 'shop',
    installation_generation: '1',
    payload: '\\x',
    payload_sha256: 'b'.repeat(64),
    received_at: '2026-10-18T00:00:00Z',
    collected_at: '2026-10-18T00:00:00Z',
    state: 'processed',
    attempts: 0,
    last_error_class: null,
    lease_owner: null,
    lease_until: null,
    retention_class: 'shopify-webhook',
    purge_after: '2026-10-19T00:00:00Z',
    erasure_state: 'erased',
  });
  const inbox = input.data.inboxes[0];
  assert(inbox);
  Reflect.set(inbox, 'payload', '\\x1234'); // Deliberately corrupt the copied external tombstone.
  await assert.rejects(writeExclusions(path, bundle(input.data)), /actual erased inbox tombstone/);
  Reflect.set(inbox, 'payload', '\\x');
  input.data.receipts.push({
    inbox_id: 'inbox',
    shop_id: 'shop',
    raw_body_sha256: 'b'.repeat(64),
    operation: 'ERASURE_STAGED',
    request_id: null,
    requested_order_count: 1,
    matched_purchase_count: 1,
    staged_at: '2026-10-18T00:00:00Z',
  });
  await assert.rejects(writeExclusions(path, bundle(input.data)), /incomplete order exclusions/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});

test('corrupt on-disk data is rejected even when the file itself remains private', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-exclusions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'exclusions.json');
  await writeFile(path, JSON.stringify({ ...bundle(), sha256: '0'.repeat(64) }), { mode: 0o600 });
  await assert.rejects(readExclusions(path), /HOLD/);
});
