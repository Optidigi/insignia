import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Heartbeat, Signal, Signals } from '../../deployment/alerts/worker.mts';

const aggregateKinds = ['backup', 'processing', 'deletion'] as const;
type AggregateKind = (typeof aggregateKinds)[number];
function configFrom(value: unknown) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const record = Object.fromEntries(Object.entries(value));
  assert(
    typeof record.secretFile === 'string' &&
      typeof record.endpoint === 'string' &&
      typeof record.backupMaxAgeSeconds === 'number',
  );
  assert(record.availabilityProbe === undefined || typeof record.availabilityProbe === 'string');
  const aggregateFiles: Partial<Record<AggregateKind, string>> = {};
  if (record.aggregateFiles !== undefined) {
    assert(record.aggregateFiles && typeof record.aggregateFiles === 'object' && !Array.isArray(record.aggregateFiles));
    const paths = Object.fromEntries(Object.entries(record.aggregateFiles));
    for (const kind of aggregateKinds) {
      const path = paths[kind];
      assert(path === undefined || typeof path === 'string');
      if (path !== undefined) aggregateFiles[kind] = path;
    }
  }
  return {
    secretFile: record.secretFile,
    endpoint: record.endpoint,
    backupMaxAgeSeconds: record.backupMaxAgeSeconds,
    availabilityProbe: record.availabilityProbe,
    aggregateFiles,
  };
}

const knownCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const unknown = (): Signal => ({ status: 'unknown', count: 0 });

// Input files contain only aggregates. No database credentials/customer records cross this boundary.
export async function collectHeartbeat({
  now = Date.now(),
  eventId = randomUUID(),
  backupMaxAgeSeconds,
  probeAvailability,
  readAggregate,
}: {
  now?: number;
  eventId?: string;
  backupMaxAgeSeconds: number;
  probeAvailability(): Promise<unknown>;
  readAggregate(kind: AggregateKind): Promise<unknown>;
}): Promise<Heartbeat> {
  if (!Number.isSafeInteger(backupMaxAgeSeconds) || backupMaxAgeSeconds < 60 || backupMaxAgeSeconds > 604_800)
    throw new Error('Backup age policy required');
  const signals: Signals = { availability: unknown(), backup: unknown(), processing: unknown(), deletion: unknown() };
  try {
    const ready = await probeAvailability();
    if (typeof ready === 'boolean') signals.availability = { status: ready ? 'ok' : 'problem', count: ready ? 0 : 1 };
  } catch {
    /* An unavailable observation is unknown, never healthy. */
  }
  for (const kind of aggregateKinds) {
    try {
      const snapshot = await readAggregate(kind);
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
      const value = Object.fromEntries(Object.entries(snapshot));
      if (kind === 'backup') {
        const completed = value.completedAt;
        if (typeof completed === 'number' && Number.isSafeInteger(completed) && completed >= 0 && completed <= now) {
          const stale = now - completed > backupMaxAgeSeconds * 1000;
          signals.backup = { status: stale ? 'problem' : 'ok', count: stale ? 1 : 0 };
        }
      } else if (
        typeof value.observedAt === 'number' &&
        Number.isSafeInteger(value.observedAt) &&
        value.observedAt <= now &&
        now - value.observedAt <= 120_000
      ) {
        const count = value[kind === 'processing' ? 'stalledCount' : 'overdueCount'];
        if (knownCount(count)) signals[kind] = { status: count ? 'problem' : 'ok', count };
      }
    } catch {
      /* Missing/malformed/stale source stays explicit. */
    }
  }
  return { version: 1, eventId, timestamp: now, signals };
}

export async function sendHeartbeat({
  endpoint,
  secret,
  payload,
  fetch: request = globalThis.fetch,
}: {
  endpoint: string;
  secret: string;
  payload: Heartbeat;
  fetch?: typeof globalThis.fetch;
}) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('HTTPS relay origin required');
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 128 || !/^[!-~]+$/.test(secret))
    throw new Error('Invalid relay credential');
  const response = await request(`${base.origin}/v1/heartbeat`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ok = response.ok;
  await response.body?.cancel();
  if (!ok) throw new Error('Heartbeat not acknowledged');
}

async function readSmallJson(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > 4096) throw new Error('Oversized aggregate');
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead > 4096) throw new Error('Oversized aggregate');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}

async function run() {
  const config = configFrom(
    await readSmallJson(process.env.INSIGNIA_HEARTBEAT_CONFIG ?? '/run/insignia/heartbeat.json'),
  );
  const info = await lstat(config.secretFile);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > 128)
    throw new Error('Protected relay credential required');
  const file = await open(config.secretFile, 'r');
  let secret: string;
  try {
    secret = (await file.readFile('utf8')).trim();
  } finally {
    await file.close();
  }
  const probe = config.availabilityProbe;
  if (probe !== undefined) {
    const url = new URL(probe);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/ready' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Loopback /ready probe required');
  }
  const once = async () => {
    const payload = await collectHeartbeat({
      backupMaxAgeSeconds: config.backupMaxAgeSeconds,
      probeAvailability: async () => {
        if (!probe) return null;
        const response = await fetch(probe, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        const ready = response.status === 200;
        await response.body?.cancel();
        return ready;
      },
      readAggregate: async (kind) => {
        const path = config.aggregateFiles[kind];
        return path ? readSmallJson(path) : null;
      },
    });
    await sendHeartbeat({ endpoint: config.endpoint, secret, payload });
  };
  do {
    try {
      await once();
      process.stdout.write('heartbeat_acknowledged\n');
    } catch {
      process.stderr.write('heartbeat_unacknowledged\n');
      if (!process.argv.includes('--loop')) process.exitCode = 1;
    }
    if (!process.argv.includes('--loop')) break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  } while (process.argv.includes('--loop'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stderr.write('heartbeat_configuration_failed\n');
    process.exitCode = 1;
  });
}
