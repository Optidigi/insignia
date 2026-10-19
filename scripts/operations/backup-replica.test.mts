import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  download,
  pruneReplica,
  pruneWithStatus,
  type ReplicaTransport,
  replicate,
  replicateStore,
  type TransportOptions,
} from './backup-replica.mts';

function remote() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>(),
    metadata = new Map<string, Record<string, string>>(),
    puts: string[] = [];
  return {
    identity: { endpoint: 'https://test.invalid/', bucket: 'encrypted-backups', prefix: 'backup' },
    objects,
    puts,
    list: async () => [...objects.keys()],
    request: async (method: string, key: string, options: TransportOptions = {}) => {
      if (method === 'HEAD')
        return objects.has(key)
          ? new Response(null, { headers: metadata.get(key) })
          : new Response(null, { status: 404 });
      if (method === 'GET')
        return objects.has(key)
          ? new Response(objects.get(key), { headers: metadata.get(key) })
          : new Response(null, { status: 404 });
      if (method === 'PUT') {
        puts.push(key);
        if (objects.has(key)) return new Response(null, { status: 412 });
        const bytes =
          options.body instanceof Uint8Array
            ? options.body
            : Buffer.from(await new Response(options.body).arrayBuffer());
        objects.set(key, new Uint8Array(bytes));
        metadata.set(key, options.headers ?? {});
        return new Response(null, { status: 200 });
      }
      if (method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      throw Error('unexpected transport method');
    },
  };
}
async function fixture(directory: string) {
  const id = '12345678-1234-1234-1234-123456789abc',
    bytes = Buffer.from('encrypted archive fixture');
  const receipt = {
    format: 'insignia-encrypted-backup-v1',
    id,
    createdAt: new Date(Date.now() - 2000).toISOString(),
    completedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    readiness: 'BACKUP_CREATED_RESTORE_UNQUALIFIED',
  };
  await writeFile(join(directory, id + '.cms'), bytes, { mode: 0o600 });
  return { receipt, bytes };
}

test('replicates exact ciphertext with durable remote deadline before bytes and downloads only a matching live completed archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-test-'));
  try {
    const { receipt, bytes } = await fixture(directory),
      transport = remote();
    await replicate({
      receipt,
      artifact: join(directory, receipt.id + '.cms'),
      journalDirectory: directory,
      transport,
    });
    assert.deepEqual(transport.puts, [
      receipt.id + '/intent.json',
      receipt.id + '/archive.cms',
      receipt.id + '/receipt.json',
    ]);
    const marker = JSON.parse(await readFile(join(directory, receipt.id + '.complete.json'), 'utf8'));
    assert.equal(marker.sha256, receipt.sha256);
    assert.equal(marker.sourceCompletedAt, receipt.completedAt);
    assert.deepEqual(marker.remoteIdentity, transport.identity);
    const staging = join(directory, 'download');
    await download({ id: receipt.id, directory: staging, transport, maxBytes: 1024 });
    assert.deepEqual(await readFile(join(staging, receipt.id + '.cms')), bytes);
    assert.deepEqual(JSON.parse(await readFile(join(staging, receipt.id + '.json'), 'utf8')), receipt);
    await pruneReplica({ transport, now: Date.now() + 7200_000, maxBytes: 1024 });
    assert.equal(transport.objects.size, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('lost archive-write response retains owned deadline and forbids a second dispatch; foreign inventory is held', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-test-'));
  try {
    const { receipt } = await fixture(directory),
      transport = remote(),
      request = transport.request;
    transport.request = async (method, key, options) => {
      const response = await request(method, key, options);
      if (method === 'PUT' && key.endsWith('/archive.cms')) throw Error('lost response');
      return response;
    };
    const options = { receipt, artifact: join(directory, receipt.id + '.cms'), journalDirectory: directory, transport };
    await assert.rejects(replicate(options));
    await assert.rejects(replicate(options));
    assert.equal(transport.puts.filter((k) => k.endsWith('/archive.cms')).length, 1);
    assert.ok(transport.objects.has(receipt.id + '/intent.json'));
    transport.objects.set('foreign/file', Buffer.from('unowned'));
    await assert.rejects(pruneReplica({ transport, now: Date.now(), maxBytes: 1024 }));
    assert.ok(transport.objects.has('foreign/file'));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('expired local receipts and conflicting remote intent never dispatch ciphertext; corrupt or expired downloads stay HOLD', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-test-'));
  try {
    const { receipt } = await fixture(directory),
      transport = remote();
    const options = { receipt, artifact: join(directory, receipt.id + '.cms'), journalDirectory: directory, transport };
    await assert.rejects(replicate({ ...options, now: Date.now() + 7200_000 }));
    assert.equal(transport.puts.length, 0);
    transport.objects.set(receipt.id + '/intent.json', Buffer.from('{"foreign":true}'));
    await assert.rejects(replicate(options));
    assert.equal(transport.puts.filter((k) => k.endsWith('/archive.cms')).length, 0);
    assert.equal(Buffer.from(transport.objects.get(receipt.id + '/intent.json') ?? []).toString(), '{"foreign":true}');
    transport.objects.clear();
    // A new immutable identity is required after that conflicting attempt.
    const next = { ...receipt, id: '22345678-1234-1234-1234-123456789abc' };
    await writeFile(join(directory, next.id + '.cms'), await readFile(options.artifact), { mode: 0o600 });
    await replicate({ ...options, receipt: next, artifact: join(directory, next.id + '.cms') });
    transport.objects.set(next.id + '/archive.cms', Buffer.from('corrupt ciphertext'));
    await assert.rejects(download({ id: next.id, directory: join(directory, 'corrupt'), transport, maxBytes: 1024 }));
    assert.ok(await readFile(join(directory, 'corrupt/HOLD.json')));
    await assert.rejects(
      download({
        id: next.id,
        directory: join(directory, 'expired'),
        transport,
        maxBytes: 1024,
        now: Date.now() + 7200_000,
      }),
    );
    await pruneReplica({ transport, now: Date.now() + 7200_000, maxBytes: 1024 });
    assert.equal(transport.objects.has(next.id + '/archive.cms'), false); // corruption never extends known-owned retention
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('remote retention HOLD replaces any prior healthy aggregate with unknown; only fully qualified success publishes zero', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-test-'));
  try {
    const transport = remote();
    await pruneWithStatus({ transport, journalDirectory: directory, maxBytes: 1024 });
    assert.equal(JSON.parse(await readFile(join(directory, 'retention.json'), 'utf8')).overdueCount, 0);
    transport.objects.set('foreign/orphan', Buffer.from('unowned'));
    await assert.rejects(pruneWithStatus({ transport, journalDirectory: directory, maxBytes: 1024 }));
    const state = JSON.parse(await readFile(join(directory, 'retention.json'), 'utf8'));
    assert.equal(state.overdueCount, null);
    assert.deepEqual(state.remoteIdentity, transport.identity);
    assert.ok(Number.isSafeInteger(state.observedAt));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('unsettled prior copy stays HOLD without retry while a later independent completed snapshot still replicates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'replica-test-'));
  try {
    const { receipt, bytes } = await fixture(directory),
      transport = remote(),
      request = transport.request;
    await writeFile(join(directory, receipt.id + '.json'), JSON.stringify(receipt), { mode: 0o600 });
    transport.request = async (method, key, options) => {
      const response = await request(method, key, options);
      if (method === 'PUT' && key === receipt.id + '/archive.cms') throw Error('lost response');
      return response;
    };
    await assert.rejects(
      replicate({ receipt, artifact: join(directory, receipt.id + '.cms'), journalDirectory: directory, transport }),
    );
    const next = { ...receipt, id: '22345678-1234-1234-1234-123456789abc' };
    await writeFile(join(directory, next.id + '.json'), JSON.stringify(next), { mode: 0o600 });
    await writeFile(join(directory, next.id + '.cms'), bytes, { mode: 0o600 });
    await assert.rejects(replicateStore({ store: directory, journalDirectory: directory, transport, maxBytes: 1024 }));
    assert.ok(transport.objects.has(next.id + '/receipt.json'));
    assert.equal(transport.puts.filter((key) => key === receipt.id + '/archive.cms').length, 1);
    assert.equal(JSON.parse(await readFile(join(directory, next.id + '.complete.json'), 'utf8')).sha256, next.sha256);
  } finally {
    await rm(directory, { recursive: true });
  }
});
